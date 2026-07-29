import { ejecutar, uno, todos, anotar } from '../db.js';
import { ErrorHttp, exigirRol } from '../auth.js';
import { ROLES, PLANES, ORDEN_PLANES, reglasVigentes } from '../config.js';
import { obtenerNegocioPorId, vistaPanel, texto } from '../negocios.js';

const soloAdmin = (ctx) => exigirRol(ctx, ROLES.ADMIN);

/* ---------------------------------------------------------------- resumen */

export function resumen(ctx) {
  soloAdmin(ctx);
  const negocios = todos(`SELECT * FROM negocios`);
  const conReglas = negocios.map((n) => ({ n, r: reglasDe(n) }));

  const publicados = negocios.filter((n) => n.estado === 'publicado').length;
  const pendientes = negocios.filter((n) => n.estado === 'pendiente').length;
  const nuevasSolicitudes = uno(`SELECT COUNT(*) c FROM solicitudes WHERE estado = 'nueva'`).c;
  const enMapa = conReglas.filter(({ n, r }) => n.estado === 'publicado' && r.permisos.mapa && n.ciudad).length;
  const ingresoMensual = conReglas.reduce(
    (acc, { r }) => acc + (r.planEfectivo === 'gratuito' ? 0 : PLANES[r.planEfectivo].precioMensual),
    0
  );
  const totalUsuarios = uno(`SELECT COUNT(*) c FROM usuarios`).c;

  const porPlan = {};
  for (const plan of ORDEN_PLANES) {
    porPlan[plan] = conReglas.filter(({ r }) => r.planEfectivo === plan).length;
  }

  return {
    publicados, pendientes, nuevasSolicitudes, enMapa, ingresoMensual, totalUsuarios, porPlan,
    sinPagoConfirmar: conReglas.filter(({ r }) => r.sinPago).length,
    membresiasVencidas: conReglas.filter(({ r }) => r.vencida).length,
  };
}

const reglasDe = (negocioFila) => reglasVigentes(negocioFila);

/* ------------------------------------------------------------ solicitudes */

export function listarSolicitudes(ctx) {
  soloAdmin(ctx);
  return todos(`SELECT * FROM solicitudes ORDER BY creado_en DESC`);
}

export function alternarSolicitud(ctx) {
  const admin = soloAdmin(ctx);
  const s = uno(`SELECT * FROM solicitudes WHERE id = $id`, { id: Number(ctx.params.id) });
  if (!s) throw new ErrorHttp(404, 'Esa solicitud ya no existe.');
  const nuevoEstado = s.estado === 'nueva' ? 'atendida' : 'nueva';
  ejecutar(`UPDATE solicitudes SET estado = $estado WHERE id = $id`, { estado: nuevoEstado, id: s.id });
  anotar(admin.id, nuevoEstado === 'atendida' ? 'Solicitud atendida' : 'Solicitud reabierta', s.negocio_nombre || s.nombre);
  return { ...s, estado: nuevoEstado };
}

/* ---------------------------------------------------------------- negocios */

export function listarNegocios(ctx) {
  soloAdmin(ctx);
  const filas = todos(
    `SELECT n.*, u.nombre AS propietaria_nombre, u.correo AS propietaria_correo
       FROM negocios n JOIN usuarios u ON u.id = n.propietaria_id
      ORDER BY (n.estado = 'pendiente') DESC, n.creado_en DESC`
  );
  return filas.map((n) => ({ ...vistaPanel(n), propietariaNombre: n.propietaria_nombre, propietariaCorreo: n.propietaria_correo }));
}

function negocioOFallo(id) {
  const negocio = obtenerNegocioPorId(id);
  if (!negocio) throw new ErrorHttp(404, 'Ese negocio ya no existe.');
  return negocio;
}

export function aprobar(ctx) {
  const admin = soloAdmin(ctx);
  const negocio = negocioOFallo(ctx.params.id);
  ejecutar(`UPDATE negocios SET estado = 'publicado', nota_revision = '' WHERE id = $id`, { id: negocio.id });
  anotar(admin.id, 'Perfil publicado', negocio.nombre);
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function rechazar(ctx) {
  const admin = soloAdmin(ctx);
  const negocio = negocioOFallo(ctx.params.id);
  const nota = texto(ctx.cuerpo.nota, 500);
  if (!nota) throw new ErrorHttp(400, 'Escribe qué necesita corregir.');
  ejecutar(`UPDATE negocios SET estado = 'rechazado', nota_revision = $nota WHERE id = $id`, { nota, id: negocio.id });
  anotar(admin.id, 'Cambios solicitados', `${negocio.nombre}: ${nota}`);
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function suspender(ctx) {
  const admin = soloAdmin(ctx);
  const negocio = negocioOFallo(ctx.params.id);
  const nota = texto(ctx.cuerpo.nota, 500);
  if (!nota) throw new ErrorHttp(400, 'Escribe el motivo de la suspensión.');
  ejecutar(`UPDATE negocios SET estado = 'suspendido', nota_revision = $nota WHERE id = $id`, { nota, id: negocio.id });
  anotar(admin.id, 'Perfil suspendido', `${negocio.nombre}: ${nota}`);
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function alternarVerificado(ctx) {
  const admin = soloAdmin(ctx);
  const negocio = negocioOFallo(ctx.params.id);
  ejecutar(`UPDATE negocios SET verificado = 1 - verificado WHERE id = $id`, { id: negocio.id });
  const actualizado = obtenerNegocioPorId(negocio.id);
  anotar(admin.id, actualizado.verificado ? 'Perfil verificado' : 'Verificación retirada', negocio.nombre);
  return vistaPanel(actualizado);
}

export function cambiarPlan(ctx) {
  const admin = soloAdmin(ctx);
  const negocio = negocioOFallo(ctx.params.id);
  const plan = ctx.cuerpo.plan;
  if (!PLANES[plan]) throw new ErrorHttp(400, 'Ese plan no existe.');

  const vence = plan === 'gratuito' ? null : new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  ejecutar(`UPDATE negocios SET plan = $plan, plan_vence = $vence, pago_confirmado = 1 WHERE id = $id`, {
    plan, vence, id: negocio.id,
  });
  anotar(admin.id, 'Plan cambiado', `${negocio.nombre} → ${PLANES[plan].nombre}`);
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function confirmarPago(ctx) {
  const admin = soloAdmin(ctx);
  const negocio = negocioOFallo(ctx.params.id);
  const vence = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  ejecutar(`UPDATE negocios SET pago_confirmado = 1, plan_vence = $vence WHERE id = $id`, { vence, id: negocio.id });
  anotar(admin.id, 'Pago confirmado', `${negocio.nombre} — ${PLANES[negocio.plan].nombre}`);
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

/* ---------------------------------------------------------------- usuarias */

export function listarUsuarias(ctx) {
  soloAdmin(ctx);
  const filas = todos(
    `SELECT u.id, u.nombre, u.correo, u.rol, u.estado, u.creado_en,
            (SELECT COUNT(*) FROM negocios n WHERE n.propietaria_id = u.id) AS total_negocios
       FROM usuarios u ORDER BY u.creado_en`
  );
  return filas;
}

export function cambiarRol(ctx) {
  const admin = soloAdmin(ctx);
  const id = Number(ctx.params.id);
  if (id === admin.id) throw new ErrorHttp(400, 'No puedes cambiar tu propio tipo de cuenta.');
  const rol = ctx.cuerpo.rol;
  if (!Object.values(ROLES).includes(rol)) throw new ErrorHttp(400, 'Ese tipo de cuenta no existe.');

  const usuaria = uno(`SELECT * FROM usuarios WHERE id = $id`, { id });
  if (!usuaria) throw new ErrorHttp(404, 'Esa cuenta ya no existe.');

  ejecutar(`UPDATE usuarios SET rol = $rol WHERE id = $id`, { rol, id });
  anotar(admin.id, 'Tipo de cuenta cambiado', `${usuaria.nombre} → ${rol}`);
  return { ...usuaria, rol };
}

export function alternarSuspensionUsuaria(ctx) {
  const admin = soloAdmin(ctx);
  const id = Number(ctx.params.id);
  if (id === admin.id) throw new ErrorHttp(400, 'No puedes suspenderte a ti misma.');
  const usuaria = uno(`SELECT * FROM usuarios WHERE id = $id`, { id });
  if (!usuaria) throw new ErrorHttp(404, 'Esa cuenta ya no existe.');

  const nuevoEstado = usuaria.estado === 'activo' ? 'suspendido' : 'activo';
  ejecutar(`UPDATE usuarios SET estado = $estado WHERE id = $id`, { estado: nuevoEstado, id });
  anotar(admin.id, nuevoEstado === 'activo' ? 'Cuenta reactivada' : 'Cuenta suspendida', usuaria.nombre);
  return { ...usuaria, estado: nuevoEstado };
}

/* ----------------------------------------------------------------- reseñas */

export function listarResenas(ctx) {
  soloAdmin(ctx);
  return todos(
    `SELECT r.*, n.nombre AS negocio_nombre, u.nombre AS autora
       FROM resenas r
       JOIN negocios n ON n.id = r.negocio_id
       JOIN usuarios u ON u.id = r.usuario_id
      ORDER BY r.creado_en DESC`
  );
}

export function alternarResenaOculta(ctx) {
  const admin = soloAdmin(ctx);
  const r = uno(`SELECT * FROM resenas WHERE id = $id`, { id: Number(ctx.params.id) });
  if (!r) throw new ErrorHttp(404, 'Esa reseña ya no existe.');
  const nuevoEstado = r.estado === 'publicada' ? 'oculta' : 'publicada';
  ejecutar(`UPDATE resenas SET estado = $estado WHERE id = $id`, { estado: nuevoEstado, id: r.id });
  const negocio = obtenerNegocioPorId(r.negocio_id);
  anotar(admin.id, nuevoEstado === 'oculta' ? 'Reseña ocultada' : 'Reseña restituida', negocio?.nombre || '');
  return { ...r, estado: nuevoEstado };
}

/* ---------------------------------------------------------------- bitácora */

export function listarBitacora(ctx) {
  soloAdmin(ctx);
  return todos(
    `SELECT b.*, u.nombre AS actor_nombre FROM bitacora b
       LEFT JOIN usuarios u ON u.id = b.actor_id
      ORDER BY b.creado_en DESC LIMIT 200`
  );
}

/* ------------------------------------------------------------------ pagos */

export function listarPagos(ctx) {
  soloAdmin(ctx);
  return todos(
    `SELECT p.*, n.nombre AS negocio_nombre, n.slug AS negocio_slug
       FROM pagos_stripe p
       LEFT JOIN negocios n ON n.id = p.negocio_id
      ORDER BY p.creado_en DESC LIMIT 200`
  );
}
