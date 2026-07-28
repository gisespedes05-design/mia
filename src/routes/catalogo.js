import { CATEGORIAS, PLANES, ORDEN_PLANES } from '../config.js';

export function categorias() {
  return CATEGORIAS;
}

/**
 * `Infinity` no existe en JSON: se convierte a `null`, que el frontend
 * interpreta como "sin límite".
 */
export function planes() {
  return ORDEN_PLANES.map((id) => {
    const plan = PLANES[id];
    return {
      ...plan,
      limites: Object.fromEntries(
        Object.entries(plan.limites).map(([k, v]) => [k, v === Infinity ? null : v])
      ),
    };
  });
}
