import { todos, uno } from './db.js';
import { ErrorHttp } from './auth.js';
import {
  CATEGORIAS, ENTIDADES, ESTADOS_NEGOCIO, ESTADO_VISIBLE,
  PLANES, reglasVigentes,
} from './config.js';

/* --------------------------------- utilidades ----------------------------- */

export function generarSlug(nombre, idExcluido = null) {
  const base =
    String(nombre)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'negocio';

  let slug = base;
  let n = 2;
  while (true) {
    const choque = uno(
      `SELECT id FROM negocios WHERE slug = $slug AND ($id IS NULL OR id != $id)`,
      { slug, id: idExcluido }
    );
    if (!choque) return slug;
    slug = `${base}-${n++}`;
  }
}

export function texto(valor, maximo = 500) {
  return String(valor ?? '').trim().slice(0, maximo);
}

export function exigirTexto(valor, campo, { min = 1, max = 500 } = {}) {
  const limpio = texto(valor, max);
  if (limpio.length < min) throw new ErrorHttp(400, `El campo "${campo}" es obligatorio.`);
  return limpio;
}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function exigirCorreo(valor) {
  const correo = texto(valor, 160).toLowerCase();
  if (!RE_CORREO.test(correo)) throw new ErrorHttp(400, 'El correo electrónico no es válido.');
  return correo;
}

export function normalizarUrl(valor) {
  const v = texto(valor, 300);
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export function soloDigitos(valor, max = 20) {
  return String(valor ?? '').replace(/[^\d+\s()-]/g, '').trim().slice(0, max);
}

/* ------------------------------- consultas base --------------------------- */

const CAMPOS = `
  n.*,
  u.nombre  AS propietaria_nombre,
  u.correo  AS propietaria_correo,
  (SELECT COUNT(*) FROM resenas r WHERE r.negocio_id = n.id AND r.estado = 'publicada') AS total_resenas,
  (SELECT ROUND(AVG(r.calificacion), 2) FROM resenas r WHERE r.negocio_id = n.id AND r.estado = 'publicada') AS calificacion,
  (SELECT COUNT(*) FROM favoritos f WHERE f.negocio_id = n.id) AS total_favoritos
`;

export function obtenerNegocioPorId(id) {
  return uno(`SELECT ${CAMPOS} FROM negocios n JOIN usuarios u ON u.id = n.propietaria_id WHERE n.id = $id`, { id: Number(id) });
}

export function obtenerNegocioPorSlug(slug) {
  return uno(`SELECT ${CAMPOS} FROM negocios n JOIN usuarios u ON u.id = n.propietaria_id WHERE n.slug = $slug`, { slug });
}

export function fotosDe(negocioId) {
  return todos(`SELECT id, archivo, orden FROM fotos WHERE negocio_id = $id ORDER BY orden, id`, { id: negocioId });
}

export function productosDe(negocioId) {
  return todos(
    `SELECT id, nombre, descripcion, precio, orden FROM productos WHERE negocio_id = $id ORDER BY orden, id`,
    { id: negocioId }
  );
}

export function resenasDe(negocioId, { incluirOcultas = false } = {}) {
  return todos(
    `SELECT r.id, r.calificacion, r.comentario, r.respuesta, r.estado, r.creado_en,
            r.usuario_id, u.nombre AS autora
       FROM resenas r JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.negocio_id = $id ${incluirOcultas ? '' : "AND r.estado = 'publicada'"}
      ORDER BY r.creado_en DESC`,
    { id: negocioId }
  );
}

/* ----------------------- aplicación de límites del plan -------------------- */

/**
 * Construye lo que el público puede ver de un negocio.
 * Todo lo que exceda el plan vigente se recorta AQUÍ, en el servidor.
 */
export function vistaPublica(negocio, { conDetalle = false } = {}) {
  const reglas = reglasVigentes(negocio);
  const { limites, permisos } = reglas;

  const fotos = fotosDe(negocio.id).slice(0, limites.fotos).map((f) => `/subidas/${f.archivo}`);
  const categoria = CATEGORIAS.find((c) => c.id === negocio.categoria) || CATEGORIAS.at(-1);

  const base = {
    id: negocio.id,
    slug: negocio.slug,
    nombre: negocio.nombre,
    categoria: negocio.categoria,
    categoriaNombre: categoria.nombre,
    categoriaIcono: categoria.icono,
    descripcion: texto(negocio.descripcion, limites.caracteresDescripcion),
    entidad: negocio.entidad,
    municipio: negocio.municipio,
    telefono: negocio.telefono,
    whatsapp: permisos.redes ? negocio.whatsapp : '',
    sitioWeb: permisos.redes ? negocio.sitio_web : '',
    redes: permisos.redes
      ? { instagram: negocio.instagram, facebook: negocio.facebook, tiktok: negocio.tiktok }
      : { instagram: '', facebook: '', tiktok: '' },
    fotos,
    portada: fotos[0] || null,
    verificado: Boolean(negocio.verificado) && permisos.verificado,
    destacado: Boolean(negocio.destacado) && permisos.prioridad,
    plan: reglas.planEfectivo,
    calificacion: negocio.calificacion ?? null,
    totalResenas: negocio.total_resenas ?? 0,
    propietaria: negocio.propietaria_nombre,
    creadoEn: negocio.creado_en,
  };

  if (!conDetalle) return base;

  return {
    ...base,
    direccion: negocio.direccion,
    vistas: negocio.vistas,
    productos: permisos.productosDestacados ? productosDe(negocio.id).slice(0, limites.publicaciones) : [],
    resenas: resenasDe(negocio.id),
    puedeResponderResenas: permisos.responder,
  };
}

/**
 * Vista para la dueña: ve TODO lo que ha capturado, y además qué le está
 * ocultando su plan actual. Nada se borra al bajar de plan.
 */
export function vistaPanel(negocio) {
  const reglas = reglasVigentes(negocio);
  const { limites, permisos } = reglas;

  const fotos = fotosDe(negocio.id);
  const productos = productosDe(negocio.id);

  const bloqueos = [];
  if (fotos.length > limites.fotos) {
    bloqueos.push(`${fotos.length - limites.fotos} fotografía(s) no se muestran: tu plan permite ${limites.fotos}.`);
  }
  if (!permisos.productosDestacados && productos.length) {
    bloqueos.push(`Tu catálogo de ${productos.length} producto(s) está oculto: requiere plan Suscripción o superior.`);
  } else if (productos.length > limites.publicaciones) {
    bloqueos.push(`${productos.length - limites.publicaciones} producto(s) no se muestran: tu plan permite ${limites.publicaciones}.`);
  }
  if (!permisos.redes && negocio.whatsapp) bloqueos.push('Tu botón de WhatsApp está oculto: requiere plan Suscripción.');
  if (!permisos.redes && negocio.sitio_web) bloqueos.push('Tu sitio web está oculto: requiere plan Suscripción.');
  if (!permisos.redes && (negocio.instagram || negocio.facebook || negocio.tiktok)) {
    bloqueos.push('Tus redes sociales están ocultas: requieren plan Emprende.');
  }
  if ((negocio.descripcion || '').length > limites.caracteresDescripcion) {
    bloqueos.push(`Tu descripción se recorta a ${limites.caracteresDescripcion} caracteres con tu plan.`);
  }
  if (reglas.vencida) {
    bloqueos.unshift(`Tu membresía ${PLANES[reglas.planContratado].nombre} venció el ${negocio.plan_vence}. Renueva para recuperar tus beneficios.`);
  }

  return {
    id: negocio.id,
    slug: negocio.slug,
    nombre: negocio.nombre,
    categoria: negocio.categoria,
    descripcion: negocio.descripcion,
    entidad: negocio.entidad,
    municipio: negocio.municipio,
    direccion: negocio.direccion,
    telefono: negocio.telefono,
    whatsapp: negocio.whatsapp,
    sitioWeb: negocio.sitio_web,
    instagram: negocio.instagram,
    facebook: negocio.facebook,
    tiktok: negocio.tiktok,
    estado: negocio.estado,
    notaRevision: negocio.nota_revision,
    verificado: Boolean(negocio.verificado),
    destacado: Boolean(negocio.destacado),
    plan: reglas.planContratado,
    planEfectivo: reglas.planEfectivo,
    planVence: negocio.plan_vence,
    membresiaVencida: reglas.vencida,
    limites,
    permisos,
    bloqueos,
    fotos: fotos.map((f) => ({ id: f.id, url: `/subidas/${f.archivo}`, visible: f.orden < limites.fotos })),
    productos,
    resenas: resenasDe(negocio.id, { incluirOcultas: true }),
    estadisticas: permisos.estadisticas
      ? {
          vistas: negocio.vistas,
          favoritos: negocio.total_favoritos ?? 0,
          resenas: negocio.total_resenas ?? 0,
          calificacion: negocio.calificacion ?? null,
        }
      : null,
    propietariaId: negocio.propietaria_id,
  };
}

/* --------------------------------- búsqueda -------------------------------- */

export function buscarNegocios({ q = '', categoria = '', entidad = '', pagina = 1, porPagina = 12 }) {
  const filtros = [`n.estado = $visible`];
  const params = { visible: ESTADO_VISIBLE };

  if (q) {
    filtros.push(`(n.nombre LIKE $q OR n.descripcion LIKE $q OR n.municipio LIKE $q)`);
    params.q = `%${texto(q, 80)}%`;
  }
  if (categoria && CATEGORIAS.some((c) => c.id === categoria)) {
    filtros.push(`n.categoria = $categoria`);
    params.categoria = categoria;
  }
  if (entidad && ENTIDADES.includes(entidad)) {
    filtros.push(`n.entidad = $entidad`);
    params.entidad = entidad;
  }

  const donde = filtros.join(' AND ');
  const total = uno(`SELECT COUNT(*) AS n FROM negocios n WHERE ${donde}`, params).n;

  const limite = Math.min(Math.max(Number(porPagina) || 12, 1), 48);
  const salto = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  // Los negocios con prioridad de búsqueda (plan Impulsa vigente) van primero.
  const filas = todos(
    `SELECT ${CAMPOS}
       FROM negocios n JOIN usuarios u ON u.id = n.propietaria_id
      WHERE ${donde}
      ORDER BY
        (n.destacado = 1 AND n.plan = 'impulsa'
          AND (n.plan_vence IS NULL OR n.plan_vence >= date('now'))) DESC,
        (n.plan = 'impulsa' AND (n.plan_vence IS NULL OR n.plan_vence >= date('now'))) DESC,
        (n.plan = 'emprende' AND (n.plan_vence IS NULL OR n.plan_vence >= date('now'))) DESC,
        calificacion DESC NULLS LAST,
        n.creado_en DESC
      LIMIT $limite OFFSET $salto`,
    { ...params, limite, salto }
  );

  return {
    total,
    pagina: Math.max(Number(pagina) || 1, 1),
    porPagina: limite,
    paginas: Math.max(Math.ceil(total / limite), 1),
    resultados: filas.map((n) => vistaPublica(n)),
  };
}

/* --------------------------------- permisos -------------------------------- */

export function exigirPropiedad(negocio, usuario) {
  if (!negocio) throw new ErrorHttp(404, 'No encontramos ese negocio.');
  if (usuario.rol === 'admin') return negocio;
  if (negocio.propietaria_id !== usuario.id) {
    throw new ErrorHttp(403, 'Este negocio no está a tu nombre.');
  }
  return negocio;
}

/** El público sólo ve negocios publicados; la dueña y MÍA ven los suyos siempre. */
export function esVisiblePara(negocio, usuario) {
  if (negocio.estado === ESTADOS_NEGOCIO.PUBLICADO) return true;
  if (!usuario) return false;
  return usuario.rol === 'admin' || negocio.propietaria_id === usuario.id;
}
