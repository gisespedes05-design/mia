import { CATEGORIAS, PLANES, ORDEN_PLANES } from '../config.js';
import { MUNICIPIOS_POR_ESTADO } from '../municipios.js';

export function categorias() {
  return CATEGORIAS;
}

export function municipios() {
  return MUNICIPIOS_POR_ESTADO;
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
