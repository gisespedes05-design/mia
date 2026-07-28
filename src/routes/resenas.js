import { ejecutar, uno, anotar } from '../db.js';
import { ErrorHttp, exigirRol } from '../auth.js';
import { ROLES } from '../config.js';
import { obtenerNegocioPorId, texto, vistaPublica } from '../negocios.js';

export function crearOActualizar(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const negocio = obtenerNegocioPorId(ctx.params.id);
  if (!negocio || negocio.estado !== 'publicado') throw new ErrorHttp(404, 'No encontramos ese negocio.');

  const calificacion = Number(ctx.cuerpo.calificacion);
  if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
    throw new ErrorHttp(400, 'Elige de 1 a 5 estrellas.');
  }
  const comentario = texto(ctx.cuerpo.comentario, 1000);
  if (comentario.length < 4) throw new ErrorHttp(400, 'Escribe unas palabras sobre tu experiencia.');

  const existente = uno(`SELECT id FROM resenas WHERE negocio_id = $n AND usuario_id = $u`, {
    n: negocio.id, u: usuario.id,
  });
  if (existente) {
    ejecutar(`UPDATE resenas SET calificacion = $cal, comentario = $c WHERE id = $id`, {
      cal: calificacion, c: comentario, id: existente.id,
    });
  } else {
    ejecutar(
      `INSERT INTO resenas (negocio_id, usuario_id, calificacion, comentario) VALUES ($n, $u, $cal, $c)`,
      { n: negocio.id, u: usuario.id, cal: calificacion, c: comentario }
    );
  }
  return vistaPublica(obtenerNegocioPorId(negocio.id), { conDetalle: true });
}

export function borrar(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const resena = uno(`SELECT * FROM resenas WHERE id = $id`, { id: Number(ctx.params.id) });
  if (!resena || resena.usuario_id !== usuario.id) throw new ErrorHttp(404, 'Esa reseña ya no existe.');
  ejecutar(`DELETE FROM resenas WHERE id = $id`, { id: resena.id });
  return vistaPublica(obtenerNegocioPorId(resena.negocio_id), { conDetalle: true });
}

export function responder(ctx) {
  const usuario = exigirRol(ctx, ROLES.NEGOCIO, ROLES.ADMIN);
  const resena = uno(`SELECT * FROM resenas WHERE id = $id`, { id: Number(ctx.params.id) });
  if (!resena) throw new ErrorHttp(404, 'Esa reseña ya no existe.');

  const negocio = obtenerNegocioPorId(resena.negocio_id);
  if (usuario.rol !== 'admin' && negocio.propietaria_id !== usuario.id) {
    throw new ErrorHttp(403, 'Esta reseña no es de tu negocio.');
  }
  const respuesta = texto(ctx.cuerpo.respuesta, 1000);
  if (!respuesta) throw new ErrorHttp(400, 'Escribe tu respuesta.');

  ejecutar(`UPDATE resenas SET respuesta = $r WHERE id = $id`, { r: respuesta, id: resena.id });
  anotar(usuario.id, 'Respondió una reseña', negocio.nombre);
  return vistaPublica(obtenerNegocioPorId(negocio.id), { conDetalle: true });
}
