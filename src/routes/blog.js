import { ejecutar, uno, todos, anotar } from '../db.js';
import { ErrorHttp, exigirRol, exigirSesion } from '../auth.js';
import { ROLES } from '../config.js';
import { texto } from '../negocios.js';
import { avisarNuevoArticulo } from '../correo.js';
import { guardarImagenBase64, borrarImagen } from '../subidas.js';

const esAdmin = (usuario) => usuario?.rol === ROLES.ADMIN;
const TIPOS_REACCION = ['like', 'dislike', 'love'];

function fotosDeArticulo(articuloId) {
  return todos(`SELECT id, archivo, orden FROM articulo_fotos WHERE articulo_id = $id ORDER BY orden, id`, {
    id: articuloId,
  }).map((f) => ({ id: f.id, url: `/subidas/${f.archivo}` }));
}

function comentariosDe(articuloId) {
  return todos(
    `SELECT c.id, c.texto, c.creado_en, c.usuario_id, u.nombre AS autora
       FROM articulo_comentarios c JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.articulo_id = $id ORDER BY c.creado_en ASC`,
    { id: articuloId }
  );
}

function reaccionesDe(articuloId, usuarioId) {
  const conteos = { like: 0, dislike: 0, love: 0 };
  for (const fila of todos(
    `SELECT tipo, COUNT(*) AS n FROM articulo_reacciones WHERE articulo_id = $id GROUP BY tipo`,
    { id: articuloId }
  )) {
    conteos[fila.tipo] = fila.n;
  }
  const mia = usuarioId
    ? uno(`SELECT tipo FROM articulo_reacciones WHERE articulo_id = $id AND usuario_id = $u`, { id: articuloId, u: usuarioId })
    : null;
  return { conteos, mia: mia ? mia.tipo : null };
}

const conFotos = (a) => ({ ...a, publicado: Boolean(a.publicado), fotos: fotosDeArticulo(a.id) });

export function listar(ctx) {
  const filas = esAdmin(ctx.usuario)
    ? todos(`SELECT * FROM articulos ORDER BY creado_en DESC`)
    : todos(`SELECT * FROM articulos WHERE publicado = 1 ORDER BY creado_en DESC`);
  return filas.map(conFotos);
}

export function verDetalle(ctx) {
  const a = uno(`SELECT * FROM articulos WHERE slug = $slug`, { slug: ctx.params.slug });
  if (!a || (!a.publicado && !esAdmin(ctx.usuario))) throw new ErrorHttp(404, 'No encontramos ese artículo.');
  return {
    ...conFotos(a),
    comentarios: comentariosDe(a.id),
    reacciones: reaccionesDe(a.id, ctx.usuario?.id),
  };
}

function generarSlugArticulo(titulo) {
  const base =
    String(titulo)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'articulo';
  let slug = base;
  let n = 2;
  while (uno(`SELECT id FROM articulos WHERE slug = $slug`, { slug })) slug = `${base}-${n++}`;
  return slug;
}

function articuloOFallo(id) {
  const a = uno(`SELECT * FROM articulos WHERE id = $id`, { id: Number(id) });
  if (!a) throw new ErrorHttp(404, 'Ese artículo ya no existe.');
  return a;
}

function articuloPublicadoOFallo(id) {
  const a = uno(`SELECT id, publicado FROM articulos WHERE id = $id`, { id: Number(id) });
  if (!a || !a.publicado) throw new ErrorHttp(404, 'Ese artículo ya no existe.');
  return a;
}

export function crear(ctx) {
  const usuario = exigirRol(ctx, ROLES.ADMIN);
  const titulo = texto(ctx.cuerpo.titulo, 140);
  const cuerpoTexto = texto(ctx.cuerpo.cuerpo, 8000);
  if (!titulo) throw new ErrorHttp(400, 'Ponle título al artículo.');
  if (cuerpoTexto.length < 40) throw new ErrorHttp(400, 'Escribe un poco más de contenido.');

  const slug = generarSlugArticulo(titulo);
  const resumen = texto(ctx.cuerpo.resumen, 200) || cuerpoTexto.slice(0, 120);
  const r = ejecutar(
    `INSERT INTO articulos (slug, titulo, resumen, cuerpo) VALUES ($slug, $titulo, $resumen, $cuerpo)`,
    { slug, titulo, resumen, cuerpo: cuerpoTexto }
  );
  const articuloId = Number(r.lastInsertRowid);

  // Las fotos se suben en el mismo momento de publicar, no después.
  const fotos = Array.isArray(ctx.cuerpo.fotos) ? ctx.cuerpo.fotos.slice(0, 10) : [];
  fotos.forEach((dataUrl, orden) => {
    const archivo = guardarImagenBase64(dataUrl);
    ejecutar(`INSERT INTO articulo_fotos (articulo_id, archivo, orden) VALUES ($id, $archivo, $orden)`, {
      id: articuloId, archivo, orden,
    });
  });

  anotar(usuario.id, 'Artículo publicado', titulo);
  const articulo = uno(`SELECT * FROM articulos WHERE id = $id`, { id: articuloId });
  avisarNuevoArticulo(articulo); // se crea publicado por defecto (ver esquema)
  return conFotos(articulo);
}

export function subirFoto(ctx) {
  exigirRol(ctx, ROLES.ADMIN);
  const a = articuloOFallo(ctx.params.id);
  const archivo = guardarImagenBase64(ctx.cuerpo.imagen);
  const orden = uno(`SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM articulo_fotos WHERE articulo_id = $id`, {
    id: a.id,
  }).n;
  ejecutar(`INSERT INTO articulo_fotos (articulo_id, archivo, orden) VALUES ($id, $archivo, $orden)`, {
    id: a.id, archivo, orden,
  });
  return conFotos(a);
}

export function quitarFoto(ctx) {
  exigirRol(ctx, ROLES.ADMIN);
  const a = articuloOFallo(ctx.params.id);
  const foto = uno(`SELECT * FROM articulo_fotos WHERE id = $id AND articulo_id = $articuloId`, {
    id: Number(ctx.params.fotoId), articuloId: a.id,
  });
  if (!foto) throw new ErrorHttp(404, 'Esa fotografía ya no existe.');
  borrarImagen(foto.archivo);
  ejecutar(`DELETE FROM articulo_fotos WHERE id = $id`, { id: foto.id });
  return conFotos(a);
}

export function alternarPublicado(ctx) {
  const usuario = exigirRol(ctx, ROLES.ADMIN);
  const a = articuloOFallo(ctx.params.id);
  ejecutar(`UPDATE articulos SET publicado = 1 - publicado WHERE id = $id`, { id: a.id });
  anotar(usuario.id, a.publicado ? 'Artículo ocultado' : 'Artículo publicado', a.titulo);
  if (!a.publicado) avisarNuevoArticulo(a); // pasó de oculto a publicado
  return conFotos({ ...a, publicado: a.publicado ? 0 : 1 });
}

export function borrar(ctx) {
  const usuario = exigirRol(ctx, ROLES.ADMIN);
  const a = articuloOFallo(ctx.params.id);
  for (const f of todos(`SELECT archivo FROM articulo_fotos WHERE articulo_id = $id`, { id: a.id })) {
    borrarImagen(f.archivo);
  }
  ejecutar(`DELETE FROM articulos WHERE id = $id`, { id: a.id });
  anotar(usuario.id, 'Artículo borrado', a.titulo);
  return { ok: true };
}

/* ============================================================ comentarios === */

export function comentar(ctx) {
  const usuario = exigirSesion(ctx);
  const a = articuloPublicadoOFallo(ctx.params.id);
  const texto2 = texto(ctx.cuerpo.texto, 1000);
  if (texto2.length < 2) throw new ErrorHttp(400, 'Escribe tu comentario.');
  ejecutar(`INSERT INTO articulo_comentarios (articulo_id, usuario_id, texto) VALUES ($id, $u, $texto)`, {
    id: a.id, u: usuario.id, texto: texto2,
  });
  return comentariosDe(a.id);
}

export function borrarComentario(ctx) {
  const usuario = exigirSesion(ctx);
  const c = uno(`SELECT * FROM articulo_comentarios WHERE id = $id`, { id: Number(ctx.params.id) });
  if (!c) throw new ErrorHttp(404, 'Ese comentario ya no existe.');
  if (usuario.rol !== 'admin' && c.usuario_id !== usuario.id) {
    throw new ErrorHttp(403, 'Ese comentario no es tuyo.');
  }
  ejecutar(`DELETE FROM articulo_comentarios WHERE id = $id`, { id: c.id });
  return comentariosDe(c.articulo_id);
}

/* ============================================================= reacciones === */

export function reaccionar(ctx) {
  const usuario = exigirSesion(ctx);
  const a = articuloPublicadoOFallo(ctx.params.id);
  const tipo = ctx.cuerpo.tipo;
  if (!TIPOS_REACCION.includes(tipo)) throw new ErrorHttp(400, 'Esa reacción no existe.');

  const existente = uno(`SELECT * FROM articulo_reacciones WHERE articulo_id = $id AND usuario_id = $u`, {
    id: a.id, u: usuario.id,
  });
  if (existente && existente.tipo === tipo) {
    ejecutar(`DELETE FROM articulo_reacciones WHERE id = $id`, { id: existente.id }); // vuelve a tocarla: la quita
  } else if (existente) {
    ejecutar(`UPDATE articulo_reacciones SET tipo = $tipo WHERE id = $id`, { tipo, id: existente.id });
  } else {
    ejecutar(`INSERT INTO articulo_reacciones (articulo_id, usuario_id, tipo) VALUES ($id, $u, $tipo)`, {
      id: a.id, u: usuario.id, tipo,
    });
  }
  return reaccionesDe(a.id, usuario.id);
}
