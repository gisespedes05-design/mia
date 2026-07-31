import { ejecutar, uno, todos, anotar } from '../db.js';
import { ErrorHttp, exigirSesion, exigirRol } from '../auth.js';
import { CATEGORIAS, ESTADO_VISIBLE } from '../config.js';
import {
  buscarNegocios, negociosEnMapa, obtenerNegocioPorId, obtenerNegocioPorSlug,
  vistaPublica, vistaPanel, exigirPropiedad, esVisiblePara, texto, normalizarCategoria2, normalizarSub, normalizarRedes,
  TIPOS_INTERACCION,
} from '../negocios.js';
import { guardarImagenBase64, borrarImagen } from '../subidas.js';

export function listar(ctx) {
  return buscarNegocios({
    q: ctx.consulta.q, categoria: ctx.consulta.categoria, sub: ctx.consulta.sub,
    ciudad: ctx.consulta.ciudad, pagina: ctx.consulta.pagina, porPagina: ctx.consulta.porPagina,
  });
}

export function mapa() {
  return negociosEnMapa();
}

/**
 * El perfil público del negocio: lo ve cualquiera si está publicado, y la
 * dueña o MÍA lo ven aunque todavía no se publique (para revisar cómo va
 * quedando). Para editar existe una ruta aparte: /api/negocios/:id/panel.
 */
export function verDetalle(ctx) {
  const negocio = obtenerNegocioPorSlug(ctx.params.slug);
  if (!negocio || !esVisiblePara(negocio, ctx.usuario)) throw new ErrorHttp(404, 'No encontramos ese negocio.');

  if (negocio.estado === 'publicado' && ctx.consulta.contar === '1') {
    ejecutar(`UPDATE negocios SET vistas = vistas + 1 WHERE id = $id`, { id: negocio.id });
  }
  return vistaPublica(negocio, { conDetalle: true });
}

/** Datos completos para editar: solo la dueña o la organización MÍA. */
export function verPanel(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  return vistaPanel(negocio);
}

export function misNegocios(ctx) {
  const usuario = exigirSesion(ctx);
  const filas = todos(`SELECT id FROM negocios WHERE propietaria_id = $id ORDER BY id`, { id: usuario.id });
  return filas.map((f) => vistaPanel(obtenerNegocioPorId(f.id)));
}

export function actualizar(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  const c = ctx.cuerpo;

  const nombre = c.nombre !== undefined ? texto(c.nombre, 120) : negocio.nombre;
  if (!nombre) throw new ErrorHttp(400, 'El negocio necesita un nombre.');

  const categoria = c.categoria !== undefined ? texto(c.categoria, 40) : negocio.categoria;
  if (!CATEGORIAS.some((cat) => cat.id === categoria)) throw new ErrorHttp(400, 'Esa categoría no existe.');

  const categoria2 = c.categoria2 !== undefined
    ? normalizarCategoria2(categoria, c.categoria2)
    : normalizarCategoria2(categoria, negocio.categoria2 || '');
  const cambioDeCategoria = categoria !== negocio.categoria || categoria2 !== (negocio.categoria2 || '');

  const subActual = JSON.parse(negocio.sub || '[]');
  // Si además cambió alguna categoría, un sub:[] es la dueña vaciando a
  // propósito para volver a elegir (las subcategorías viejas ya no aplican),
  // no una lista vacía inválida.
  const sub = c.sub === undefined
    ? subActual
    : Array.isArray(c.sub) && c.sub.length === 0 && cambioDeCategoria
      ? []
      : normalizarSub(categoria, categoria2, c.sub);
  const redesActuales = JSON.parse(negocio.redes || '{}');
  const redes = c.redes !== undefined ? normalizarRedes(c.redes) : redesActuales;

  ejecutar(
    `UPDATE negocios SET
       nombre = $nombre, categoria = $categoria, categoria2 = $categoria2, sub = $sub, descripcion = $descripcion,
       ciudad = $ciudad, direccion = $direccion, telefono = $telefono, redes = $redes,
       actualizado_en = datetime('now')
     WHERE id = $id`,
    {
      id: negocio.id, nombre, categoria, categoria2: categoria2 || null, sub: JSON.stringify(sub),
      descripcion: c.descripcion !== undefined ? texto(c.descripcion, 6000) : negocio.descripcion,
      ciudad: c.ciudad !== undefined ? texto(c.ciudad, 80) : negocio.ciudad,
      direccion: c.direccion !== undefined ? texto(c.direccion, 200) : negocio.direccion,
      telefono: c.telefono !== undefined ? texto(c.telefono, 20) : negocio.telefono,
      redes: JSON.stringify(redes),
    }
  );
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function enviarRevision(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  if (!negocio.nombre.trim()) throw new ErrorHttp(400, 'Ponle nombre a tu negocio.');
  if (!(negocio.descripcion || '').trim()) throw new ErrorHttp(400, 'Escribe de qué se trata tu negocio.');

  ejecutar(`UPDATE negocios SET estado = 'pendiente', nota_revision = '' WHERE id = $id`, { id: negocio.id });
  anotar(usuario.id, 'Perfil enviado a revisión', negocio.nombre);
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

/* ------------------------------------------------------------------ logo -- */

export function subirLogo(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  const archivo = guardarImagenBase64(ctx.cuerpo.imagen);
  borrarImagen(negocio.logo);
  ejecutar(`UPDATE negocios SET logo = $logo WHERE id = $id`, { logo: archivo, id: negocio.id });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function quitarLogo(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  borrarImagen(negocio.logo);
  ejecutar(`UPDATE negocios SET logo = NULL WHERE id = $id`, { id: negocio.id });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

/* ---------------------------------------------------------------- banner -- */

export function subirBanner(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  const archivo = guardarImagenBase64(ctx.cuerpo.imagen);
  borrarImagen(negocio.banner);
  ejecutar(`UPDATE negocios SET banner = $banner WHERE id = $id`, { banner: archivo, id: negocio.id });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function quitarBanner(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  borrarImagen(negocio.banner);
  ejecutar(`UPDATE negocios SET banner = NULL WHERE id = $id`, { id: negocio.id });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

/* ----------------------------------------------------------------- fotos -- */

export function subirFoto(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  const archivo = guardarImagenBase64(ctx.cuerpo.imagen);
  const orden = uno(`SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM fotos WHERE negocio_id = $id`, { id: negocio.id }).n;
  ejecutar(`INSERT INTO fotos (negocio_id, archivo, orden) VALUES ($id, $archivo, $orden)`, {
    id: negocio.id, archivo, orden,
  });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function quitarFoto(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  const foto = uno(`SELECT * FROM fotos WHERE id = $id AND negocio_id = $negocioId`, {
    id: Number(ctx.params.fotoId), negocioId: negocio.id,
  });
  if (!foto) throw new ErrorHttp(404, 'Esa fotografía ya no existe.');
  borrarImagen(foto.archivo);
  ejecutar(`DELETE FROM fotos WHERE id = $id`, { id: foto.id });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

/* ------------------------------------------------------------- productos -- */

export function agregarProducto(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  const nombre = texto(ctx.cuerpo.nombre, 120);
  if (!nombre) throw new ErrorHttp(400, 'Escribe el nombre del producto.');
  const precio = ctx.cuerpo.precio !== undefined && ctx.cuerpo.precio !== '' ? Number(ctx.cuerpo.precio) : null;
  const orden = uno(`SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM productos WHERE negocio_id = $id`, { id: negocio.id }).n;

  ejecutar(
    `INSERT INTO productos (negocio_id, nombre, descripcion, precio, orden)
     VALUES ($id, $nombre, $desc, $precio, $orden)`,
    { id: negocio.id, nombre, desc: texto(ctx.cuerpo.descripcion, 300), precio, orden }
  );
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function quitarProducto(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  ejecutar(`DELETE FROM productos WHERE id = $id AND negocio_id = $negocioId`, {
    id: Number(ctx.params.productoId), negocioId: negocio.id,
  });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function alternarProductoDestacado(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  ejecutar(
    `UPDATE productos SET destacado = 1 - destacado WHERE id = $id AND negocio_id = $negocioId`,
    { id: Number(ctx.params.productoId), negocioId: negocio.id }
  );
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

/* --------------------------------------------------------- publicaciones -- */

export function agregarPublicacion(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  const titulo = texto(ctx.cuerpo.titulo, 140);
  const cuerpoTexto = texto(ctx.cuerpo.texto, 3000);
  if (!titulo) throw new ErrorHttp(400, 'Ponle título a tu publicación.');
  if (cuerpoTexto.length < 10) throw new ErrorHttp(400, 'Escribe un poco más en tu publicación.');

  ejecutar(`INSERT INTO publicaciones (negocio_id, titulo, texto) VALUES ($id, $titulo, $texto)`, {
    id: negocio.id, titulo, texto: cuerpoTexto,
  });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function quitarPublicacion(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  ejecutar(`DELETE FROM publicaciones WHERE id = $id AND negocio_id = $negocioId`, {
    id: Number(ctx.params.publicacionId), negocioId: negocio.id,
  });
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

export function alternarPublicacionDestacada(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);
  ejecutar(
    `UPDATE publicaciones SET destacada = 1 - destacada WHERE id = $id AND negocio_id = $negocioId`,
    { id: Number(ctx.params.publicacionId), negocioId: negocio.id }
  );
  return vistaPanel(obtenerNegocioPorId(negocio.id));
}

/* -------------------------------------------------------------- clics -- */
// Público, sin sesión: cualquiera que toque el botón de WhatsApp, redes o
// teléfono en un perfil publicado deja un registro, para que la dueña vea
// cuánto la están contactando.

export function registrarInteraccion(ctx) {
  const negocio = obtenerNegocioPorId(ctx.params.id);
  if (!negocio || negocio.estado !== ESTADO_VISIBLE) throw new ErrorHttp(404, 'No encontramos ese negocio.');
  const tipo = String(ctx.cuerpo.tipo || '');
  if (!TIPOS_INTERACCION.includes(tipo)) throw new ErrorHttp(400, 'Ese tipo de interacción no existe.');
  ejecutar(`INSERT INTO interacciones (negocio_id, tipo) VALUES ($id, $tipo)`, { id: negocio.id, tipo });
  return { ok: true };
}
