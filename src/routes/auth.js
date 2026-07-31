import { ejecutar, uno, anotar } from '../db.js';
import {
  cifrarContrasena, verificarContrasena, cookieDeSesion, cookieDeCierre, ErrorHttp, exigirSesion,
} from '../auth.js';
import { exigirTexto, exigirCorreo, generarSlug, normalizarCategoria2, normalizarSub, normalizarRedes } from '../negocios.js';
import { PLANES, ROLES } from '../config.js';
import { enviarCorreo, correoBienvenidaUsuaria, correoBienvenidaNegocio } from '../correo.js';

function crearCuenta({ nombre, correo, clave, telefono = '', rol, terminos, noticias }) {
  const yaExiste = uno(`SELECT id FROM usuarios WHERE correo = $correo`, { correo });
  if (yaExiste) throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo. Entra con tu contraseña.');
  if (String(clave).length < 8) throw new ErrorHttp(400, 'La contraseña necesita al menos 8 caracteres.');
  if (!terminos) throw new ErrorHttp(400, 'Debes aceptar el aviso de privacidad y seguridad para continuar.');

  const hash = cifrarContrasena(clave);
  const r = ejecutar(
    `INSERT INTO usuarios (nombre, correo, hash, rol, telefono, acepta_noticias, terminos_aceptados_en)
     VALUES ($nombre, $correo, $hash, $rol, $telefono, $noticias, datetime('now'))`,
    { nombre, correo, hash, rol, telefono, noticias: noticias ? 1 : 0 }
  );
  return Number(r.lastInsertRowid);
}

/** Registro de una clienta: solo correo y contraseña, sin negocio. */
export async function registrarClienta(ctx) {
  const nombre = exigirTexto(ctx.cuerpo.nombre, 'nombre', { min: 2, max: 120 });
  const correo = exigirCorreo(ctx.cuerpo.correo);
  const clave = String(ctx.cuerpo.clave || '');
  const terminos = ctx.cuerpo.terminos === true;
  const noticias = ctx.cuerpo.noticias !== false;

  const id = crearCuenta({ nombre, correo, clave, rol: ROLES.USUARIO, terminos, noticias });
  ctx.cookies.push(cookieDeSesion(id));
  await enviarCorreo({ para: correo, ...correoBienvenidaUsuaria(nombre) });
  return { id, nombre, correo, rol: ROLES.USUARIO };
}

/**
 * Registro de un negocio. Cada plan tiene su propio formulario en el
 * frontend, pero todos llegan aquí: lo que cambia es qué campos manda cada
 * uno (una dueña con plan Gratuito no manda redes, por ejemplo).
 */
export async function registrarNegocio(ctx) {
  const { negocio } = ctx.cuerpo;
  if (!negocio || typeof negocio !== 'object') throw new ErrorHttp(400, 'Faltan los datos del negocio.');

  const plan = PLANES[ctx.cuerpo.plan] ? ctx.cuerpo.plan : 'gratuito';
  const nombre = exigirTexto(ctx.cuerpo.nombre, 'nombre', { min: 2, max: 120 });
  const correo = exigirCorreo(ctx.cuerpo.correo);
  const clave = String(ctx.cuerpo.clave || '');
  const telefono = String(ctx.cuerpo.telefono || '').slice(0, 20);
  const terminos = ctx.cuerpo.terminos === true;
  const noticias = ctx.cuerpo.noticias !== false;

  const nombreNegocio = exigirTexto(negocio.nombre, 'nombre del negocio', { min: 2, max: 120 });
  const categoria = exigirTexto(negocio.categoria, 'categoría', { min: 1, max: 40 });
  const categoria2 = normalizarCategoria2(categoria, negocio.categoria2);
  const sub = normalizarSub(categoria, categoria2, negocio.sub);
  const descripcion = exigirTexto(negocio.descripcion, 'descripción', { min: 20, max: 6000 });
  const ciudad = exigirTexto(negocio.ciudad, 'ciudad', { min: 1, max: 80 });
  const alcaldiaMunicipio = exigirTexto(negocio.alcaldiaMunicipio, 'alcaldía o municipio', { min: 1, max: 100 });
  const direccion = String(negocio.direccion || '').slice(0, 200);
  const redes = normalizarRedes(negocio.redes);
  const mensaje = String(ctx.cuerpo.mensaje || '').slice(0, 2000);

  const usuarioId = crearCuenta({ nombre, correo, clave, telefono, rol: ROLES.NEGOCIO, terminos, noticias });

  const esPago = PLANES[plan].precioMensual > 0;
  const slug = generarSlug(nombreNegocio);
  const rNegocio = ejecutar(
    `INSERT INTO negocios (
       propietaria_id, nombre, slug, categoria, categoria2, sub, descripcion, ciudad, alcaldia_municipio, direccion,
       telefono, redes, plan, plan_vence, pago_confirmado, estado
     ) VALUES (
       $duena, $nombre, $slug, $categoria, $categoria2, $sub, $descripcion, $ciudad, $alcaldiaMunicipio, $direccion,
       $telefono, $redes, $plan, $vence, $pago, 'pendiente'
     )`,
    {
      duena: usuarioId, nombre: nombreNegocio, slug, categoria, categoria2: categoria2 || null, sub: JSON.stringify(sub),
      descripcion, ciudad, alcaldiaMunicipio, direccion, telefono, redes: JSON.stringify(redes), plan,
      vence: esPago ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) : null,
      pago: esPago ? 0 : 1,
    }
  );
  const negocioId = Number(rNegocio.lastInsertRowid);

  ejecutar(
    `INSERT INTO solicitudes (
       negocio_id, tipo, plan_nombre, nombre, correo, telefono, negocio_nombre,
       ciudad, categoria, subcategorias, descripcion, mensaje
     ) VALUES (
       $negocioId, $tipo, $planNombre, $nombre, $correo, $telefono, $negocioNombre,
       $ciudad, $categoria, $sub, $descripcion, $mensaje
     )`,
    {
      negocioId, tipo: plan, planNombre: PLANES[plan].nombre, nombre, correo, telefono,
      negocioNombre: nombreNegocio, ciudad, categoria: categoria2 ? `${categoria} + ${categoria2}` : categoria,
      sub: sub.join(' | '), descripcion, mensaje,
    }
  );

  anotar(usuarioId, 'Registro recibido', `${nombreNegocio} — plan ${PLANES[plan].nombre}`);
  ctx.cookies.push(cookieDeSesion(usuarioId));
  await enviarCorreo({ para: correo, ...correoBienvenidaNegocio(nombre, nombreNegocio, plan) });
  return { usuarioId, negocioId, slug, plan };
}

export function entrar(ctx) {
  const correo = String(ctx.cuerpo.correo || '').toLowerCase().trim();
  const clave = String(ctx.cuerpo.clave || '');

  const fila = uno(`SELECT id, hash, estado FROM usuarios WHERE correo = $correo`, { correo });
  if (!fila || !verificarContrasena(clave, fila.hash)) {
    throw new ErrorHttp(401, 'Ese correo o esa contraseña no coinciden. Revísalos e inténtalo otra vez.');
  }
  if (fila.estado !== 'activo') throw new ErrorHttp(403, 'Esta cuenta está suspendida. Escribe a MÍA para reactivarla.');

  ctx.cookies.push(cookieDeSesion(fila.id));
  return uno(`SELECT id, nombre, correo, rol, estado, telefono FROM usuarios WHERE id = $id`, { id: fila.id });
}

export function salir(ctx) {
  ctx.cookies.push(cookieDeCierre());
  return { ok: true };
}

export function yo(ctx) {
  return ctx.usuario || null;
}

export function cambiarClave(ctx) {
  const usuario = exigirSesion(ctx);
  const actual = String(ctx.cuerpo.actual || '');
  const nueva = String(ctx.cuerpo.nueva || '');
  const fila = uno(`SELECT hash FROM usuarios WHERE id = $id`, { id: usuario.id });
  if (!verificarContrasena(actual, fila.hash)) throw new ErrorHttp(401, 'Tu contraseña actual no es correcta.');
  if (nueva.length < 8) throw new ErrorHttp(400, 'La contraseña nueva necesita al menos 8 caracteres.');
  ejecutar(`UPDATE usuarios SET hash = $hash WHERE id = $id`, { hash: cifrarContrasena(nueva), id: usuario.id });
  return { ok: true };
}
