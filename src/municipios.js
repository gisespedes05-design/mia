import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from './db.js';

// Catálogo completo de municipios (y, en la Ciudad de México, alcaldías) de
// los 32 estados, basado en el catálogo de INEGI. Es información pública que
// no cambia, así que se carga una sola vez al arrancar el servidor.
export const MUNICIPIOS_POR_ESTADO = JSON.parse(
  readFileSync(join(RAIZ, 'src', 'data', 'municipios-por-estado.json'), 'utf8')
);
