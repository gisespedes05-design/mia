import { todos, uno } from './db.js';
import { ErrorHttp } from './auth.js';
import { CATEGORIAS, ESTADOS_NEGOCIO, ESTADO_VISIBLE, PLANES, MAX_SUBCATEGORIAS, reglasVigentes } from './config.js';

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

const cat = (id) => CATEGORIAS.find((c) => c.id === id) || CATEGORIAS[CATEGORIAS.length - 1];

/**
 * La segunda categoría es opcional: sirve para negocios que cruzan dos
 * rubros (una repostería que también hace golosinas para mascotas). Debe
 * existir y no repetir la principal; si no, simplemente no hay segunda.
 */
export function normalizarCategoria2(categoriaId, categoria2Id) {
  const id = texto(categoria2Id, 40);
  if (!id || id === categoriaId) return '';
  if (!CATEGORIAS.some((c) => c.id === id)) throw new ErrorHttp(400, 'Esa segunda categoría no existe.');
  return id;
}

/**
 * Hasta MAX_SUBCATEGORIAS subcategorías en total, tomadas de la categoría
 * principal y, si se eligió, de la segunda categoría.
 */
export function normalizarSub(categoriaId, categoria2Id, sub) {
  const validas = new Set([...cat(categoriaId).sub, ...(categoria2Id ? cat(categoria2Id).sub : [])]);
  const limpio = [...new Set((Array.isArray(sub) ? sub : []).map((s) => texto(s, 60)))].filter((s) =>
    validas.has(s)
  );
  if (!limpio.length) throw new ErrorHttp(400, 'Elige al menos una subcategoría.');
  return limpio.slice(0, MAX_SUBCATEGORIAS);
}

export function normalizarRedes(redes = {}) {
  return {
    whatsapp: texto(redes.whatsapp, 300),
    instagram: texto(redes.instagram, 300),
    facebook: texto(redes.facebook, 300),
    tiktok: texto(redes.tiktok, 300),
  };
}

/**
 * Cada red se guarda como el link que la dueña pegó (a su chat de WhatsApp,
 * a su perfil de Instagram/Facebook/TikTok). Si ya trae "http", se usa tal
 * cual; si solo le falta "https://" se lo agrega. Lo único que se sigue
 * armando a mano es lo que quedó guardado desde antes de este cambio, cuando
 * el campo era nada más un teléfono o un @usuario.
 */
const DOMINIOS_RED = {
  whatsapp: /wa\.me|whatsapp\.com/i,
  instagram: /instagram\.com/i,
  facebook: /facebook\.com|fb\.com|fb\.me/i,
  tiktok: /tiktok\.com/i,
};
export function enlaceRed(tipo, valor) {
  const v = texto(valor, 300);
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (DOMINIOS_RED[tipo] && DOMINIOS_RED[tipo].test(v)) return 'https://' + v;
  const usuario = v.replace(/^@/, '');
  if (tipo === 'whatsapp') return 'https://wa.me/52' + usuario.replace(/\D/g, '');
  if (tipo === 'instagram') return 'https://instagram.com/' + usuario;
  if (tipo === 'facebook') return 'https://facebook.com/' + usuario;
  if (tipo === 'tiktok') return 'https://tiktok.com/@' + usuario;
  return v;
}

const parsearSub = (fila) => {
  try {
    return JSON.parse(fila.sub || '[]');
  } catch {
    return [];
  }
};
const parsearRedes = (fila) => {
  try {
    return { whatsapp: '', instagram: '', facebook: '', tiktok: '', ...JSON.parse(fila.redes || '{}') };
  } catch {
    return { whatsapp: '', instagram: '', facebook: '', tiktok: '' };
  }
};

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
  return uno(
    `SELECT ${CAMPOS} FROM negocios n JOIN usuarios u ON u.id = n.propietaria_id WHERE n.id = $id`,
    { id: Number(id) }
  );
}

export function obtenerNegocioPorSlug(slug) {
  return uno(
    `SELECT ${CAMPOS} FROM negocios n JOIN usuarios u ON u.id = n.propietaria_id WHERE n.slug = $slug`,
    { slug }
  );
}

export function fotosDe(negocioId) {
  return todos(`SELECT id, archivo, orden FROM fotos WHERE negocio_id = $id ORDER BY orden, id`, { id: negocioId });
}

export function productosDe(negocioId) {
  return todos(
    `SELECT id, nombre, descripcion, precio, imagen, destacado, orden FROM productos WHERE negocio_id = $id ORDER BY orden, id`,
    { id: negocioId }
  ).map((p) => ({ ...p, imagen: p.imagen ? `/subidas/${p.imagen}` : null }));
}

export function publicacionesDe(negocioId) {
  return todos(
    `SELECT p.id, p.titulo, p.texto, p.imagen, p.vistas, p.destacada, p.creado_en,
            (SELECT COUNT(*) FROM publicacion_comentarios c WHERE c.publicacion_id = p.id) AS total_comentarios
       FROM publicaciones p WHERE p.negocio_id = $id
      ORDER BY p.destacada DESC, p.creado_en DESC`,
    { id: negocioId }
  ).map((p) => ({ ...p, imagen: p.imagen ? `/subidas/${p.imagen}` : null }));
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

export const TIPOS_INTERACCION = ['whatsapp', 'instagram', 'facebook', 'tiktok', 'telefono'];

/** Cuántas veces le tocaron cada botón de contacto, para el panel de la dueña. */
export function interaccionesDe(negocioId) {
  const filas = todos(
    `SELECT tipo, COUNT(*) AS total FROM interacciones WHERE negocio_id = $id GROUP BY tipo`,
    { id: negocioId }
  );
  const conteos = Object.fromEntries(TIPOS_INTERACCION.map((t) => [t, 0]));
  for (const f of filas) conteos[f.tipo] = f.total;
  return conteos;
}

/**
 * Vistas e interacciones agrupadas por mes (los últimos 12), para el
 * reporte mensual de negocios verificados. El mes más reciente va primero.
 */
export function reporteMensual(negocioId) {
  const vistasPorMes = todos(
    `SELECT strftime('%Y-%m', creado_en) AS mes, COUNT(*) AS total
       FROM vistas_perfil WHERE negocio_id = $id GROUP BY mes`,
    { id: negocioId }
  );
  const interaccionesPorMes = todos(
    `SELECT strftime('%Y-%m', creado_en) AS mes, tipo, COUNT(*) AS total
       FROM interacciones WHERE negocio_id = $id GROUP BY mes, tipo`,
    { id: negocioId }
  );

  const meses = new Map();
  const mesDe = (mes) => {
    if (!meses.has(mes)) meses.set(mes, { mes, vistas: 0, ...Object.fromEntries(TIPOS_INTERACCION.map((t) => [t, 0])) });
    return meses.get(mes);
  };
  for (const v of vistasPorMes) mesDe(v.mes).vistas = v.total;
  for (const i of interaccionesPorMes) mesDe(i.mes)[i.tipo] = i.total;

  return [...meses.values()].sort((a, b) => b.mes.localeCompare(a.mes)).slice(0, 12);
}

/* ----------------------- aplicación de límites del plan -------------------- */
// Sólo tres cosas se recortan por plan: fotos, publicaciones y el largo de la
// descripción. Los productos siempre se muestran completos: lo único que
// depende del plan es si su insignia "destacado" se respeta.

export function vistaPublica(negocio, { conDetalle = false } = {}) {
  const reglas = reglasVigentes(negocio);
  const { limites, permisos } = reglas;
  const categoria = cat(negocio.categoria);
  const categoria2 = negocio.categoria2 ? cat(negocio.categoria2) : null;

  const fotos = fotosDe(negocio.id)
    .slice(0, limites.fotos)
    .map((f) => `/subidas/${f.archivo}`);
  const redesGuardadas = permisos.redes ? parsearRedes(negocio) : { whatsapp: '', instagram: '', facebook: '', tiktok: '' };
  const redes = Object.fromEntries(
    Object.entries(redesGuardadas).map(([tipo, valor]) => [tipo, enlaceRed(tipo, valor)])
  );

  // Solo la más reciente y visible: alcanza para mostrarla en tarjetas y en
  // el inicio sin tener que pedir el detalle completo del negocio.
  const [ultima] = publicacionesDe(negocio.id);
  const ultimaPublicacion = ultima ? { ...ultima, destacada: Boolean(ultima.destacada) && permisos.publicacionesDestacadas } : null;

  const base = {
    id: negocio.id,
    slug: negocio.slug,
    nombre: negocio.nombre,
    estado: negocio.estado,
    categoria: negocio.categoria,
    categoriaNombre: categoria.nombre,
    categoriaIcono: categoria.icono,
    categoria2: negocio.categoria2 || null,
    categoria2Nombre: categoria2 ? categoria2.nombre : null,
    categoria2Icono: categoria2 ? categoria2.icono : null,
    sub: parsearSub(negocio),
    descripcion: texto(negocio.descripcion, limites.caracteresDescripcion),
    ciudad: negocio.ciudad,
    alcaldiaMunicipio: negocio.alcaldia_municipio || '',
    telefono: negocio.telefono,
    logo: negocio.logo ? `/subidas/${negocio.logo}` : null,
    banner: negocio.banner ? `/subidas/${negocio.banner}` : null,
    fotoDestacada: negocio.foto_destacada ? `/subidas/${negocio.foto_destacada}` : null,
    redes,
    fotos,
    portada: fotos[0] || null,
    verificado: Boolean(negocio.verificado) && permisos.verificado,
    plan: reglas.planEfectivo,
    calificacion: negocio.calificacion ?? null,
    totalResenas: negocio.total_resenas ?? 0,
    propietaria: negocio.propietaria_nombre,
    creadoEn: negocio.creado_en,
    ultimaPublicacion,
  };

  if (!conDetalle) return base;

  const pubs = publicacionesDe(negocio.id);
  const tope = limites.publicaciones === Infinity ? pubs.length : limites.publicaciones;

  return {
    ...base,
    direccion: negocio.direccion,
    comoLlegar: Boolean(permisos.mapa && negocio.direccion),
    // "Sobre mi negocio" es un beneficio de negocios verificados: se sigue
    // guardando aunque se pierda la verificación, pero deja de mostrarse.
    sobreNegocio: base.verificado ? (negocio.sobre_negocio || '') : '',
    vistas: negocio.vistas,
    productos: productosDe(negocio.id).map((p) => ({ ...p, destacado: Boolean(p.destacado) && permisos.productosDestacados })),
    publicaciones: pubs.slice(0, tope).map((p) => ({ ...p, destacada: Boolean(p.destacada) && permisos.publicacionesDestacadas })),
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
  const redes = parsearRedes(negocio);

  const fotos = fotosDe(negocio.id);
  const publicaciones = publicacionesDe(negocio.id);
  const productos = productosDe(negocio.id);

  const bloqueos = [];
  if (reglas.sinPago) {
    bloqueos.push(
      `MÍA todavía no confirma tu pago del plan ${PLANES[reglas.planContratado].nombre}. Mientras tanto tu perfil opera con las reglas del plan Gratuito.`
    );
  }
  if (reglas.vencida) {
    bloqueos.push(
      `Tu plan ${PLANES[reglas.planContratado].nombre} venció el ${negocio.plan_vence}. Nada se borró: al renovar vuelve a aparecer todo.`
    );
  }
  if (fotos.length > limites.fotos) {
    bloqueos.push(
      limites.fotos === 0
        ? `Tus ${fotos.length} fotografías están ocultas. Las fotografías empiezan en el plan Suscripción.`
        : `${fotos.length - limites.fotos} de tus ${fotos.length} fotografías no se muestran.`
    );
  }
  if (limites.publicaciones !== Infinity && publicaciones.length > limites.publicaciones) {
    bloqueos.push(
      `${publicaciones.length - limites.publicaciones} de tus ${publicaciones.length} publicaciones no se muestran. El plan Gratuito incluye ${limites.publicaciones}.`
    );
  }
  if (!permisos.redes && (redes.instagram || redes.facebook || redes.tiktok || redes.whatsapp)) {
    bloqueos.push('Tus redes sociales y tu WhatsApp están ocultos. Empiezan en el plan Suscripción.');
  }
  if (!permisos.mapa) bloqueos.push('Tu negocio no aparece en el mapa. El mapa empieza en el plan Suscripción.');
  if ((negocio.descripcion || '').length > limites.caracteresDescripcion) {
    bloqueos.push(`Tu descripción se muestra recortada a ${limites.caracteresDescripcion} caracteres.`);
  }
  if (negocio.verificado && !permisos.verificado) {
    bloqueos.push('MÍA te verificó, pero la insignia solo se muestra con Membresía.');
  }
  const estaVerificado = Boolean(negocio.verificado) && permisos.verificado;
  if ((negocio.sobre_negocio || '').trim() && !estaVerificado) {
    bloqueos.push('Tu texto de "Sobre mi negocio" está guardado, pero solo se muestra en negocios verificados.');
  }

  return {
    id: negocio.id,
    slug: negocio.slug,
    nombre: negocio.nombre,
    categoria: negocio.categoria,
    categoria2: negocio.categoria2 || null,
    sub: parsearSub(negocio),
    descripcion: negocio.descripcion,
    sobreNegocio: negocio.sobre_negocio || '',
    sobreNegocioVisible: estaVerificado,
    ciudad: negocio.ciudad,
    alcaldiaMunicipio: negocio.alcaldia_municipio || '',
    direccion: negocio.direccion,
    telefono: negocio.telefono,
    logo: negocio.logo ? `/subidas/${negocio.logo}` : null,
    banner: negocio.banner ? `/subidas/${negocio.banner}` : null,
    fotoDestacada: negocio.foto_destacada ? `/subidas/${negocio.foto_destacada}` : null,
    redes,
    estado: negocio.estado,
    notaRevision: negocio.nota_revision,
    verificado: Boolean(negocio.verificado),
    vistas: negocio.vistas,
    plan: reglas.planContratado,
    planEfectivo: reglas.planEfectivo,
    planVence: negocio.plan_vence,
    pagoConfirmado: Boolean(negocio.pago_confirmado),
    membresiaVencida: reglas.vencida,
    descuentoPorcentaje: negocio.descuento_porcentaje || 0,
    limites,
    permisos,
    bloqueos,
    fotos: fotos.map((f, i) => ({ id: f.id, url: `/subidas/${f.archivo}`, visible: i < limites.fotos })),
    productos,
    publicaciones: publicaciones.map((p, i) => ({
      ...p,
      visible: limites.publicaciones === Infinity || i < limites.publicaciones,
    })),
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
    enlacePagoCrece: negocio.enlace_pago_crece || null,
    interacciones: interaccionesDe(negocio.id),
  };
}

/* --------------------------------- búsqueda -------------------------------- */
// El directorio es pequeño (un negocio real, no un marketplace masivo), así
// que se trae lo que cumple los filtros de SQL y se ordena/pagina en JS según
// el plan EFECTIVO (que depende de si la membresía venció), igual que en la
// demostración de mia.html.

export function buscarNegocios({ q = '', categoria = '', sub = '', ciudad = '', pagina = 1, porPagina = 12 }) {
  const filtros = [`n.estado = $visible`];
  const params = { visible: ESTADO_VISIBLE };

  if (q) {
    filtros.push(`(n.nombre LIKE $q OR n.descripcion LIKE $q OR n.ciudad LIKE $q)`);
    params.q = `%${texto(q, 80)}%`;
  }
  if (categoria && CATEGORIAS.some((c) => c.id === categoria)) {
    filtros.push(`(n.categoria = $categoria OR n.categoria2 = $categoria)`);
    params.categoria = categoria;
  }
  if (ciudad) {
    filtros.push(`n.ciudad = $ciudad`);
    params.ciudad = texto(ciudad, 80);
  }

  const filas = todos(
    `SELECT ${CAMPOS} FROM negocios n JOIN usuarios u ON u.id = n.propietaria_id WHERE ${filtros.join(' AND ')}`,
    params
  ).filter((n) => !sub || parsearSub(n).includes(sub));

  filas.sort((a, b) => {
    const pa = PLANES[reglasVigentes(a).planEfectivo].peso;
    const pb = PLANES[reglasVigentes(b).planEfectivo].peso;
    if (pa !== pb) return pb - pa;
    return (b.calificacion ?? 0) - (a.calificacion ?? 0) || String(b.creado_en).localeCompare(a.creado_en);
  });

  const limite = Math.min(Math.max(Number(porPagina) || 12, 1), 48);
  const paginaActual = Math.max(Number(pagina) || 1, 1);
  const salto = (paginaActual - 1) * limite;

  return {
    total: filas.length,
    pagina: paginaActual,
    porPagina: limite,
    paginas: Math.max(Math.ceil(filas.length / limite), 1),
    resultados: filas.slice(salto, salto + limite).map((n) => vistaPublica(n)),
  };
}

/** Negocios visibles en el mapa: sólo los que su plan lo permite y tienen ciudad. */
export function negociosEnMapa() {
  const filas = todos(`SELECT ${CAMPOS} FROM negocios n JOIN usuarios u ON u.id = n.propietaria_id WHERE n.estado = $visible`, {
    visible: ESTADO_VISIBLE,
  }).filter((n) => reglasVigentes(n).permisos.mapa && n.ciudad);
  return filas.map((n) => vistaPublica(n));
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
