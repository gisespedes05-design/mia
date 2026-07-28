import { ejecutar, todos } from '../db.js';
import { exigirRol, ErrorHttp } from '../auth.js';
import { ROLES } from '../config.js';
import { obtenerNegocioPorId, vistaPublica } from '../negocios.js';

export function listar(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const filas = todos(
    `SELECT n.id FROM favoritos f JOIN negocios n ON n.id = f.negocio_id
      WHERE f.usuario_id = $u AND n.estado = 'publicado' ORDER BY f.creado_en DESC`,
    { u: usuario.id }
  );
  return filas.map((f) => vistaPublica(obtenerNegocioPorId(f.id)));
}

export function agregar(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const negocio = obtenerNegocioPorId(ctx.params.negocioId);
  if (!negocio || negocio.estado !== 'publicado') throw new ErrorHttp(404, 'No encontramos ese negocio.');
  ejecutar(`INSERT OR IGNORE INTO favoritos (usuario_id, negocio_id) VALUES ($u, $n)`, {
    u: usuario.id, n: negocio.id,
  });
  return { ok: true };
}

export function quitar(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  ejecutar(`DELETE FROM favoritos WHERE usuario_id = $u AND negocio_id = $n`, {
    u: usuario.id, n: Number(ctx.params.negocioId),
  });
  return { ok: true };
}
