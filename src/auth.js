import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_DATOS, uno } from './db.js';
import { ROLES } from './config.js';

const NOMBRE_COOKIE = 'mia_sesion';
const DIAS_SESION = 30;

// La llave se genera una sola vez y se guarda; así las sesiones sobreviven
// a un reinicio del servidor. En producción se define MIA_SECRETO.
const LLAVE = (() => {
  if (process.env.MIA_SECRETO) return process.env.MIA_SECRETO;
  const ruta = join(DIR_DATOS, '.llave');
  if (!existsSync(ruta)) writeFileSync(ruta, randomBytes(48).toString('hex'), { mode: 0o600 });
  return readFileSync(ruta, 'utf8').trim();
})();

/* ---------------------------------- contraseñas --------------------------- */

export function cifrarContrasena(texto) {
  const sal = randomBytes(16);
  const derivada = scryptSync(texto, sal, 64);
  return `scrypt$${sal.toString('hex')}$${derivada.toString('hex')}`;
}

export function verificarContrasena(texto, guardado) {
  try {
    const [algoritmo, salHex, hashHex] = String(guardado).split('$');
    if (algoritmo !== 'scrypt') return false;
    const esperado = Buffer.from(hashHex, 'hex');
    const derivada = scryptSync(texto, Buffer.from(salHex, 'hex'), esperado.length);
    return timingSafeEqual(esperado, derivada);
  } catch {
    return false;
  }
}

/* ----------------------------------- sesión ------------------------------- */

function firmar(carga) {
  const cuerpo = Buffer.from(JSON.stringify(carga)).toString('base64url');
  const firma = createHmac('sha256', LLAVE).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

function abrir(token) {
  if (!token || !token.includes('.')) return null;
  const [cuerpo, firma] = token.split('.');
  const esperada = createHmac('sha256', LLAVE).update(cuerpo).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const carga = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    if (!carga.exp || carga.exp < Date.now()) return null;
    return carga;
  } catch {
    return null;
  }
}

export function cookieDeSesion(usuarioId) {
  const exp = Date.now() + DIAS_SESION * 24 * 60 * 60 * 1000;
  const token = firmar({ uid: usuarioId, exp });
  const maxEdad = DIAS_SESION * 24 * 60 * 60;
  return `${NOMBRE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxEdad}`;
}

export function cookieDeCierre() {
  return `${NOMBRE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function leerCookies(cabecera = '') {
  const salida = {};
  for (const parte of cabecera.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) salida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return salida;
}

/**
 * Lee la cookie y devuelve la usuaria actual, o null.
 * Se consulta la base en cada petición: si MÍA suspende una cuenta,
 * la sesión deja de servir de inmediato.
 */
export function usuarioDeLaPeticion(req) {
  const carga = abrir(leerCookies(req.headers.cookie || '')[NOMBRE_COOKIE]);
  if (!carga) return null;
  const usuario = uno(
    `SELECT id, nombre, correo, rol, estado, telefono, creado_en
       FROM usuarios WHERE id = $id`,
    { id: carga.uid }
  );
  if (!usuario || usuario.estado !== 'activo') return null;
  return usuario;
}

/* ----------------------------------- guardas ------------------------------ */

export class ErrorHttp extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export function exigirSesion(ctx) {
  if (!ctx.usuario) throw new ErrorHttp(401, 'Necesitas iniciar sesión para continuar.');
  return ctx.usuario;
}

export function exigirRol(ctx, ...roles) {
  const usuario = exigirSesion(ctx);
  if (!roles.includes(usuario.rol)) {
    throw new ErrorHttp(403, 'Tu tipo de cuenta no tiene acceso a esta sección.');
  }
  return usuario;
}

export const esAdmin = (usuario) => usuario?.rol === ROLES.ADMIN;
