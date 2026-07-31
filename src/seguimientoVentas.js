// Le pregunta a un negocio si se concretó la venta de un producto que le
// consultaron: una vez a las 48h, y si no contesta, un único recordatorio a
// las 96h. Nunca más de eso — el objetivo es llevar el registro de ventas
// del negocio, no perseguirlo con avisos.
import { consultasParaPreguntar, consultasParaRecordar, marcarPreguntada, marcarRecordada } from './consultas.js';
import { enviarCorreo, correoConfirmarVenta } from './correo.js';
import { notificar } from './notificaciones.js';

const mensajeAviso = (usuaria, producto) =>
  `${usuaria} preguntó por "${producto}" en tu perfil de MÍA 💛 Esto queda en el registro de ventas de tu negocio — ¿se concretó?`;

async function avisar(c, esRecordatorio) {
  notificar(c.propietaria_id, c.negocio_id, mensajeAviso(c.usuaria_nombre, c.producto_nombre), `#/ventas/${c.negocio_id}`);
  await enviarCorreo({
    para: c.propietaria_correo,
    ...correoConfirmarVenta(c.propietaria_nombre, c.negocio_nombre, c.producto_nombre, c.usuaria_nombre, c.negocio_id, esRecordatorio),
  });
}

export async function revisarConsultasPendientes() {
  try {
    for (const c of consultasParaPreguntar()) {
      await avisar(c, false);
      marcarPreguntada(c.id);
    }
    for (const c of consultasParaRecordar()) {
      await avisar(c, true);
      marcarRecordada(c.id);
    }
  } catch (err) {
    console.error('[MÍA] Error revisando consultas de producto:', err.message);
  }
}
