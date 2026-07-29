import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ErrorHttp, usuarioDeLaPeticion } from './auth.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const LIMITE_CUERPO = 8 * 1024 * 1024; // 8 MB: permite subir una foto en base64

export class Enrutador {
  constructor() {
    this.rutas = [];
  }

  agregar(metodo, patron, manejador) {
    // "/api/negocios/:id/fotos"  ->  regex con grupos nombrados
    const nombres = [];
    const regex = new RegExp(
      '^' +
        patron
          .split('/')
          .map((seg) => {
            if (!seg.startsWith(':')) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            nombres.push(seg.slice(1));
            return '([^/]+)';
          })
          .join('/') +
        '/?$'
    );
    this.rutas.push({ metodo, regex, nombres, manejador });
    return this;
  }

  get(p, m) { return this.agregar('GET', p, m); }
  post(p, m) { return this.agregar('POST', p, m); }
  patch(p, m) { return this.agregar('PATCH', p, m); }
  put(p, m) { return this.agregar('PUT', p, m); }
  delete(p, m) { return this.agregar('DELETE', p, m); }

  resolver(metodo, ruta) {
    let rutaConocida = false;
    for (const r of this.rutas) {
      const m = r.regex.exec(ruta);
      if (!m) continue;
      rutaConocida = true;
      if (r.metodo !== metodo) continue;
      const params = {};
      r.nombres.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      return { manejador: r.manejador, params };
    }
    return rutaConocida ? { metodoNoPermitido: true } : null;
  }
}

async function leerCrudo(req) {
  const trozos = [];
  let total = 0;
  for await (const trozo of req) {
    total += trozo.length;
    if (total > LIMITE_CUERPO) throw new ErrorHttp(413, 'El archivo es demasiado grande (máximo 8 MB).');
    trozos.push(trozo);
  }
  return Buffer.concat(trozos);
}

async function leerCuerpo(req) {
  const buffer = await leerCrudo(req);
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new ErrorHttp(400, 'El formato de la petición no es válido.');
  }
}

function responderJson(res, codigo, datos, cookies = []) {
  const cuerpo = JSON.stringify(datos);
  const cabeceras = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'X-Content-Type-Options': 'nosniff',
  };
  if (cookies.length) cabeceras['Set-Cookie'] = cookies;
  res.writeHead(codigo, cabeceras);
  res.end(cuerpo);
}

function servirArchivo(res, ruta, { cache = false } = {}) {
  const info = statSync(ruta);
  res.writeHead(200, {
    'Content-Type': TIPOS[extname(ruta).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': cache ? 'public, max-age=604800' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(ruta).pipe(res);
}

/**
 * Resuelve una ruta dentro de una carpeta base sin permitir salirse de ella.
 */
function rutaSegura(base, solicitada) {
  const limpia = normalize(decodeURIComponent(solicitada)).replace(/^(\.\.[/\\])+/, '');
  const destino = join(base, limpia);
  return destino.startsWith(base) ? destino : null;
}

export function crearManejador({ enrutador, dirPublico, dirSubidas }) {
  return async function manejar(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const ruta = url.pathname;

    try {
      // 1) Imágenes subidas por las usuarias
      if (ruta.startsWith('/subidas/')) {
        const archivo = rutaSegura(dirSubidas, ruta.slice('/subidas/'.length));
        if (archivo && existsSync(archivo) && statSync(archivo).isFile()) {
          return servirArchivo(res, archivo, { cache: true });
        }
        return responderJson(res, 404, { error: 'Imagen no encontrada.' });
      }

      // 2) API
      if (ruta.startsWith('/api/')) {
        const encontrada = enrutador.resolver(req.method, ruta);
        if (!encontrada) return responderJson(res, 404, { error: 'Recurso no encontrado.' });
        if (encontrada.metodoNoPermitido) {
          return responderJson(res, 405, { error: 'Método no permitido.' });
        }

        // El webhook de Stripe firma los bytes exactos del cuerpo: si aquí se
        // parsea a JSON y se reconstruye, la firma ya no coincide con nada.
        // Por eso esta única ruta recibe el cuerpo crudo en vez de parseado.
        const esWebhookStripe = ruta === '/api/pagos/webhook' && req.method === 'POST';

        const ctx = {
          req,
          res,
          url,
          params: encontrada.params,
          consulta: Object.fromEntries(url.searchParams),
          usuario: esWebhookStripe ? null : usuarioDeLaPeticion(req),
          cuerpo: esWebhookStripe || req.method === 'GET' || req.method === 'DELETE' ? {} : await leerCuerpo(req),
          cuerpoCrudo: esWebhookStripe ? await leerCrudo(req) : null,
          cookies: [],
        };

        const resultado = await encontrada.manejador(ctx);
        if (res.writableEnded) return undefined;
        const codigo = resultado?.__codigo ?? 200;
        const datos = resultado?.__codigo ? resultado.datos : resultado;
        return responderJson(res, codigo, datos ?? {}, ctx.cookies);
      }

      // 3) Archivos estáticos del sitio
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return responderJson(res, 405, { error: 'Método no permitido.' });
      }

      let archivo = rutaSegura(dirPublico, ruta === '/' ? '/index.html' : ruta);
      if (archivo && existsSync(archivo) && statSync(archivo).isDirectory()) {
        archivo = join(archivo, 'index.html');
      }
      // URLs bonitas: /planes -> /planes.html
      if (archivo && !existsSync(archivo) && !extname(archivo)) {
        archivo = `${archivo}.html`;
      }
      if (archivo && existsSync(archivo)) {
        return servirArchivo(res, archivo, { cache: /\.(css|js|svg|png|jpg|webp|woff2)$/i.test(archivo) });
      }

      const noEncontrada = join(dirPublico, '404.html');
      if (existsSync(noEncontrada)) {
        res.writeHead(404, { 'Content-Type': TIPOS['.html'] });
        return createReadStream(noEncontrada).pipe(res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Página no encontrada');
    } catch (err) {
      // Un ErrorHttp siempre trae un mensaje escrito a propósito para
      // mostrarse, sin importar el código; lo que se oculta es la excepción
      // cruda e inesperada, que sí podría filtrar detalles internos.
      const esperado = err instanceof ErrorHttp;
      const codigo = esperado ? err.codigo : 500;
      if (!esperado) console.error('[MÍA]', err);
      if (res.writableEnded) return undefined;
      return responderJson(res, codigo, {
        error: esperado ? err.message : 'Ocurrió un error en el servidor.',
      });
    }
  };
}

/** Ayuda para devolver un código distinto de 200 desde un manejador. */
export const conCodigo = (codigo, datos) => ({ __codigo: codigo, datos });
