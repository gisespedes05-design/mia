import { ejecutar, todos } from './db.js';

/** El registro privado de ventas de un negocio: nadie más lo ve. */
export function consultasDe(negocioId) {
  return todos(
    `SELECT cp.*, u.nombre AS usuaria_nombre
       FROM consultas_producto cp
       JOIN usuarios u ON u.id = cp.usuario_id
      WHERE cp.negocio_id = $id
      ORDER BY cp.creado_en DESC`,
    { id: negocioId }
  );
}

export function resolverConsulta(id, negocioId, resultado) {
  ejecutar(
    `UPDATE consultas_producto SET resultado = $resultado, respondido_en = datetime('now')
      WHERE id = $id AND negocio_id = $negocioId`,
    { id, negocioId, resultado }
  );
}

const CAMPOS_SEGUIMIENTO = `
  cp.id, cp.negocio_id, cp.producto_nombre,
  n.nombre AS negocio_nombre, n.propietaria_id,
  u2.nombre AS propietaria_nombre, u2.correo AS propietaria_correo,
  u.nombre AS usuaria_nombre
`;

/** Llevan 48h esperando y todavía no se les preguntó nada. */
export function consultasParaPreguntar() {
  return todos(`
    SELECT ${CAMPOS_SEGUIMIENTO}
      FROM consultas_producto cp
      JOIN negocios n ON n.id = cp.negocio_id
      JOIN usuarios u2 ON u2.id = n.propietaria_id
      JOIN usuarios u ON u.id = cp.usuario_id
     WHERE cp.resultado = 'pendiente'
       AND cp.preguntado_en IS NULL
       AND cp.creado_en <= datetime('now', '-48 hours')
  `);
}

/** Ya se les preguntó hace 48h y no contestaron: el único recordatorio. */
export function consultasParaRecordar() {
  return todos(`
    SELECT ${CAMPOS_SEGUIMIENTO}
      FROM consultas_producto cp
      JOIN negocios n ON n.id = cp.negocio_id
      JOIN usuarios u2 ON u2.id = n.propietaria_id
      JOIN usuarios u ON u.id = cp.usuario_id
     WHERE cp.resultado = 'pendiente'
       AND cp.preguntado_en IS NOT NULL
       AND cp.recordado_en IS NULL
       AND cp.preguntado_en <= datetime('now', '-48 hours')
  `);
}

export function marcarPreguntada(id) {
  ejecutar(`UPDATE consultas_producto SET preguntado_en = datetime('now') WHERE id = $id`, { id });
}

export function marcarRecordada(id) {
  ejecutar(`UPDATE consultas_producto SET recordado_en = datetime('now') WHERE id = $id`, { id });
}
