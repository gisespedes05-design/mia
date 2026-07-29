import { todos, uno, ejecutar } from './db.js';
import { ErrorHttp } from './auth.js';

const CAMPOS_CONVERSACION = `
  c.*,
  n.propietaria_id,
  n.nombre AS negocio_nombre, n.slug AS negocio_slug, n.telefono AS negocio_telefono,
  u.nombre AS propietaria_nombre, u.correo AS propietaria_correo,
  cl.nombre AS usuaria_nombre,
  (SELECT cuerpo FROM mensajes m WHERE m.conversacion_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultimo_mensaje,
  (SELECT creado_en FROM mensajes m WHERE m.conversacion_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultimo_en
`;

function obtenerOCrearConversacion(negocioId, usuarioId) {
  const existente = uno(`SELECT id FROM conversaciones WHERE negocio_id = $n AND usuario_id = $u`, {
    n: negocioId, u: usuarioId,
  });
  if (existente) return existente.id;
  const r = ejecutar(`INSERT INTO conversaciones (negocio_id, usuario_id) VALUES ($n, $u)`, {
    n: negocioId, u: usuarioId,
  });
  return Number(r.lastInsertRowid);
}

/** Cuenta cuántos mensajes de la otra parte siguen sin leer, por conversación. */
function conNoLeidos(autorContrario) {
  return `(SELECT COUNT(*) FROM mensajes m WHERE m.conversacion_id = c.id
            AND m.autor = '${autorContrario}' AND m.leido = 0) AS no_leidos`;
}

export function conversacionesDeNegocio(negocioId) {
  return todos(
    `SELECT ${CAMPOS_CONVERSACION}, ${conNoLeidos('usuario')}
       FROM conversaciones c
       JOIN negocios n ON n.id = c.negocio_id
       JOIN usuarios u ON u.id = n.propietaria_id
       JOIN usuarios cl ON cl.id = c.usuario_id
      WHERE c.negocio_id = $id
      ORDER BY ultimo_en DESC`,
    { id: negocioId }
  );
}

export function conversacionesDeUsuaria(usuarioId) {
  return todos(
    `SELECT ${CAMPOS_CONVERSACION}, ${conNoLeidos('negocio')}
       FROM conversaciones c
       JOIN negocios n ON n.id = c.negocio_id
       JOIN usuarios u ON u.id = n.propietaria_id
       JOIN usuarios cl ON cl.id = c.usuario_id
      WHERE c.usuario_id = $id
      ORDER BY ultimo_en DESC`,
    { id: usuarioId }
  );
}

export function obtenerConversacion(id) {
  return uno(
    `SELECT ${CAMPOS_CONVERSACION}
       FROM conversaciones c
       JOIN negocios n ON n.id = c.negocio_id
       JOIN usuarios u ON u.id = n.propietaria_id
       JOIN usuarios cl ON cl.id = c.usuario_id
      WHERE c.id = $id`,
    { id }
  );
}

/** Solo la usuaria dueña de la conversación o quien administra el negocio pueden verla. */
export function exigirParteDe(conversacion, usuario) {
  if (!conversacion) throw new ErrorHttp(404, 'Esa conversación ya no existe.');
  const esUsuaria = conversacion.usuario_id === usuario.id;
  const esNegocio = usuario.rol === 'admin' || conversacion.propietaria_id === usuario.id;
  if (!esUsuaria && !esNegocio) throw new ErrorHttp(403, 'Esta conversación no es tuya.');
  return esUsuaria ? 'usuario' : 'negocio';
}

export function mensajesDe(conversacionId) {
  return todos(
    `SELECT id, autor, cuerpo, leido, creado_en FROM mensajes
      WHERE conversacion_id = $id ORDER BY id ASC`,
    { id: conversacionId }
  );
}

export function marcarLeidos(conversacionId, quienLee) {
  const autorContrario = quienLee === 'usuario' ? 'negocio' : 'usuario';
  ejecutar(
    `UPDATE mensajes SET leido = 1 WHERE conversacion_id = $id AND autor = $autor AND leido = 0`,
    { id: conversacionId, autor: autorContrario }
  );
}

/** Crea la conversación si hace falta y agrega el primer o siguiente mensaje. */
export function escribirA({ negocioId, usuarioId, autor, cuerpo }) {
  const conversacionId = obtenerOCrearConversacion(negocioId, usuarioId);
  ejecutar(`INSERT INTO mensajes (conversacion_id, autor, cuerpo) VALUES ($id, $autor, $cuerpo)`, {
    id: conversacionId, autor, cuerpo,
  });
  return conversacionId;
}
