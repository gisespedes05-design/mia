import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DIR_SUBIDAS } from './db.js';
import { ErrorHttp } from './auth.js';

const TIPOS_PERMITIDOS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const TAMANO_MAXIMO = 5 * 1024 * 1024; // 5 MB por imagen

/**
 * Recibe un data URL ("data:image/jpeg;base64,...") y lo guarda en disco.
 * Devuelve el nombre de archivo (no la ruta completa) para guardar en la BD.
 */
export function guardarImagenBase64(dataUrl) {
  const coincide = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!coincide) throw new ErrorHttp(400, 'La imagen debe ser JPG, PNG o WEBP.');

  const [, tipo, base64] = coincide;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > TAMANO_MAXIMO) throw new ErrorHttp(413, 'La imagen pesa más de 5 MB.');

  const extension = TIPOS_PERMITIDOS[tipo];
  const archivo = `${Date.now()}-${randomBytes(6).toString('hex')}.${extension}`;
  writeFileSync(join(DIR_SUBIDAS, archivo), buffer);
  return archivo;
}

/** Borra un archivo subido si existe. No falla si ya no está. */
export function borrarImagen(archivo) {
  if (!archivo) return;
  const ruta = join(DIR_SUBIDAS, archivo);
  if (existsSync(ruta)) unlinkSync(ruta);
}
