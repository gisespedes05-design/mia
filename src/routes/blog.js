import { ejecutar, uno, todos, anotar } from '../db.js';
import { ErrorHttp, exigirRol } from '../auth.js';
import { ROLES } from '../config.js';
import { texto } from '../negocios.js';
import { avisarNuevoArticulo } from '../correo.js';

const esAdmin = (usuario) => usuario?.rol === ROLES.ADMIN;

export function listar(ctx) {
  const filas = esAdmin(ctx.usuario)
    ? todos(`SELECT * FROM articulos ORDER BY creado_en DESC`)
    : todos(`SELECT * FROM articulos WHERE publicado = 1 ORDER BY creado_en DESC`);
  return filas.map((a) => ({ ...a, publicado: Boolean(a.publicado) }));
}

export function verDetalle(ctx) {
  const a = uno(`SELECT * FROM articulos WHERE slug = $slug`, { slug: ctx.params.slug });
  if (!a || (!a.publicado && !esAdmin(ctx.usuario))) throw new ErrorHttp(404, 'No encontramos ese artículo.');
  return { ...a, publicado: Boolean(a.publicado) };
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
  anotar(usuario.id, 'Artículo publicado', titulo);
  const articulo = uno(`SELECT * FROM articulos WHERE id = $id`, { id: Number(r.lastInsertRowid) });
  avisarNuevoArticulo(articulo); // se crea publicado por defecto (ver esquema)
  return articulo;
}

export function alternarPublicado(ctx) {
  const usuario = exigirRol(ctx, ROLES.ADMIN);
  const a = uno(`SELECT * FROM articulos WHERE id = $id`, { id: Number(ctx.params.id) });
  if (!a) throw new ErrorHttp(404, 'Ese artículo ya no existe.');
  ejecutar(`UPDATE articulos SET publicado = 1 - publicado WHERE id = $id`, { id: a.id });
  anotar(usuario.id, a.publicado ? 'Artículo ocultado' : 'Artículo publicado', a.titulo);
  if (!a.publicado) avisarNuevoArticulo(a); // pasó de oculto a publicado
  return { ...a, publicado: !a.publicado };
}

export function borrar(ctx) {
  const usuario = exigirRol(ctx, ROLES.ADMIN);
  const a = uno(`SELECT * FROM articulos WHERE id = $id`, { id: Number(ctx.params.id) });
  if (!a) throw new ErrorHttp(404, 'Ese artículo ya no existe.');
  ejecutar(`DELETE FROM articulos WHERE id = $id`, { id: a.id });
  anotar(usuario.id, 'Artículo borrado', a.titulo);
  return { ok: true };
}
