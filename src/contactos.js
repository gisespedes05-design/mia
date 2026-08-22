// "Contactos generados": cada vez que una clienta le escribe por primera vez
// a un negocio, pregunta por un producto, o toca WhatsApp/teléfono/redes
// desde su perfil. Es la métrica que le importa de verdad a una dueña — más
// que las visitas — porque mide oportunidades de venta reales, no curiosidad.
//
// Es una suma de acciones, no de personas distintas: los clics de contacto
// (interacciones) son anónimos a propósito, porque la mayoría de quien toca
// WhatsApp nunca creó una cuenta. Conversaciones y consultas de producto sí
// quedan ligadas a una clienta, pero para que el número tenga un solo
// significado consistente en los cinco tipos, aquí se cuenta todo como
// acción, no como persona única.
import { todos } from './db.js';

const MES_VACIO = (mes) => ({ mes, conversaciones: 0, consultas: 0, whatsapp: 0, telefono: 0, redes: 0, total: 0 });

/** Contactos de un negocio, agrupados por mes ("YYYY-MM"), el más reciente primero. */
export function contactosPorMes(negocioId) {
  const conversaciones = todos(
    `SELECT strftime('%Y-%m', creado_en) AS mes, COUNT(*) AS n FROM conversaciones WHERE negocio_id = $id GROUP BY mes`,
    { id: negocioId }
  );
  const consultas = todos(
    `SELECT strftime('%Y-%m', creado_en) AS mes, COUNT(*) AS n FROM consultas_producto WHERE negocio_id = $id GROUP BY mes`,
    { id: negocioId }
  );
  const interacciones = todos(
    `SELECT strftime('%Y-%m', creado_en) AS mes, tipo, COUNT(*) AS n FROM interacciones WHERE negocio_id = $id GROUP BY mes, tipo`,
    { id: negocioId }
  );

  const meses = new Map();
  const filaDe = (mes) => {
    if (!meses.has(mes)) meses.set(mes, MES_VACIO(mes));
    return meses.get(mes);
  };
  for (const c of conversaciones) filaDe(c.mes).conversaciones = c.n;
  for (const c of consultas) filaDe(c.mes).consultas = c.n;
  for (const i of interacciones) {
    const f = filaDe(i.mes);
    if (i.tipo === 'whatsapp') f.whatsapp = i.n;
    else if (i.tipo === 'telefono') f.telefono = i.n;
    else f.redes += i.n; // instagram, facebook, tiktok: un solo bloque, como lo pidió el negocio
  }
  for (const f of meses.values()) {
    f.total = f.conversaciones + f.consultas + f.whatsapp + f.telefono + f.redes;
  }
  return [...meses.values()].sort((a, b) => b.mes.localeCompare(a.mes));
}

const mesISO = (fecha) => fecha.toISOString().slice(0, 7);

/**
 * Mes actual vs. el anterior, para un negocio: el número grande que ve la
 * dueña en "Mi negocio" y el "+35% vs. mes anterior". Si el mes anterior
 * quedó en cero, el porcentaje no significa nada (crecer de 0 a lo que sea
 * es infinito) — se marca como "nuevo" en vez de inventar una cifra.
 */
export function resumenContactos(negocioId) {
  const porMes = contactosPorMes(negocioId);
  const hoy = new Date();
  const mesActual = mesISO(hoy);
  const mesAnterior = mesISO(new Date(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));

  const actual = porMes.find((m) => m.mes === mesActual) || MES_VACIO(mesActual);
  const anterior = porMes.find((m) => m.mes === mesAnterior) || MES_VACIO(mesAnterior);

  const cambioPorcentual = anterior.total > 0
    ? Math.round(((actual.total - anterior.total) / anterior.total) * 100)
    : null;

  return { actual, anterior, cambioPorcentual, historico: porMes };
}
