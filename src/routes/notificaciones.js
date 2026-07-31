import { todos } from '../db.js';
import { exigirSesion, exigirRol, ErrorHttp } from '../auth.js';
import { obtenerNegocioPorId, vistaPublica } from '../negocios.js';
import { ROLES } from '../config.js';
import * as N from '../notificaciones.js';

/** Solo clientas siguen negocios (los negocios no siguen negocios). */
export function alternarSeguir(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const negocio = obtenerNegocioPorId(ctx.params.id);
  if (!negocio) throw new ErrorHttp(404, 'No encontramos ese negocio.');

  const yaSeguia = N.siguiendo(usuario.id, negocio.id);
  if (yaSeguia) N.dejarDeSeguir(usuario.id, negocio.id);
  else N.seguir(usuario.id, negocio.id);
  return { siguiendo: !yaSeguia };
}

export function misSeguidos(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const filas = todos(
    `SELECT n.id FROM seguidores s JOIN negocios n ON n.id = s.negocio_id
      WHERE s.usuario_id = $u AND n.estado = 'publicado' ORDER BY s.creado_en DESC`,
    { u: usuario.id }
  );
  return filas.map((f) => vistaPublica(obtenerNegocioPorId(f.id)));
}

export function misNotificaciones(ctx) {
  const usuario = exigirSesion(ctx);
  return { noLeidas: N.noLeidasDe(usuario.id), notificaciones: N.notificacionesDe(usuario.id) };
}

export function marcarLeida(ctx) {
  const usuario = exigirSesion(ctx);
  N.marcarLeida(Number(ctx.params.id), usuario.id);
  return { ok: true };
}

export function marcarTodasLeidas(ctx) {
  const usuario = exigirSesion(ctx);
  N.marcarTodasLeidas(usuario.id);
  return { ok: true };
}
