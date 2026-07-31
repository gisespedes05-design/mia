import { ejecutar, uno, todos } from './db.js';

export function siguiendo(usuarioId, negocioId) {
  return Boolean(uno(`SELECT 1 AS x FROM seguidores WHERE usuario_id = $u AND negocio_id = $n`, { u: usuarioId, n: negocioId }));
}

export function seguir(usuarioId, negocioId) {
  ejecutar(`INSERT OR IGNORE INTO seguidores (usuario_id, negocio_id) VALUES ($u, $n)`, { u: usuarioId, n: negocioId });
}

export function dejarDeSeguir(usuarioId, negocioId) {
  ejecutar(`DELETE FROM seguidores WHERE usuario_id = $u AND negocio_id = $n`, { u: usuarioId, n: negocioId });
}

function seguidoresDe(negocioId) {
  return todos(`SELECT usuario_id FROM seguidores WHERE negocio_id = $n`, { n: negocioId });
}

/** Le avisa a cada seguidora de un negocio; nunca truena la acción que lo dispara. */
export function notificarASeguidoras(negocioId, mensaje) {
  try {
    for (const s of seguidoresDe(negocioId)) {
      ejecutar(
        `INSERT INTO notificaciones (usuario_id, negocio_id, mensaje) VALUES ($u, $n, $m)`,
        { u: s.usuario_id, n: negocioId, m: mensaje }
      );
    }
  } catch (err) {
    console.error('[MÍA] Error creando notificaciones:', err.message);
  }
}

export function notificacionesDe(usuarioId) {
  return todos(
    `SELECT no.id, no.mensaje, no.leida, no.creado_en, no.negocio_id,
            n.nombre AS negocio_nombre, n.slug AS negocio_slug
       FROM notificaciones no
       LEFT JOIN negocios n ON n.id = no.negocio_id
      WHERE no.usuario_id = $u
      ORDER BY no.creado_en DESC
      LIMIT 100`,
    { u: usuarioId }
  );
}

export function noLeidasDe(usuarioId) {
  return uno(`SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = $u AND leida = 0`, { u: usuarioId }).n;
}

export function marcarLeida(id, usuarioId) {
  ejecutar(`UPDATE notificaciones SET leida = 1 WHERE id = $id AND usuario_id = $u`, { id, u: usuarioId });
}

export function marcarTodasLeidas(usuarioId) {
  ejecutar(`UPDATE notificaciones SET leida = 1 WHERE usuario_id = $u AND leida = 0`, { u: usuarioId });
}
