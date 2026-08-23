import { ejecutar, todos, uno } from '../db.js';
import { exigirRol, ErrorHttp } from '../auth.js';
import { ROLES } from '../config.js';
import { obtenerNegocioPorId, vistaPublica, cat } from '../negocios.js';

export function listar(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const filas = todos(
    `SELECT n.id FROM favoritos f JOIN negocios n ON n.id = f.negocio_id
      WHERE f.usuario_id = $u AND n.estado = 'publicado' ORDER BY f.creado_en DESC`,
    { u: usuario.id }
  );
  return filas.map((f) => vistaPublica(obtenerNegocioPorId(f.id)));
}

export function agregar(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const negocio = obtenerNegocioPorId(ctx.params.negocioId);
  if (!negocio || negocio.estado !== 'publicado') throw new ErrorHttp(404, 'No encontramos ese negocio.');
  ejecutar(`INSERT OR IGNORE INTO favoritos (usuario_id, negocio_id) VALUES ($u, $n)`, {
    u: usuario.id, n: negocio.id,
  });
  return { ok: true };
}

export function quitar(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  ejecutar(`DELETE FROM favoritos WHERE usuario_id = $u AND negocio_id = $n`, {
    u: usuario.id, n: Number(ctx.params.negocioId),
  });
  return { ok: true };
}

/* ------------------------------------------------------- favoritos de producto -- */
// "Me gusta y quiero guardarlo" (esto) es una acción totalmente distinta de
// "quiero preguntar por él" (consultarProducto, en mensajes.js): un favorito
// de producto NUNCA escribe en conversaciones/consultas_producto/interacciones,
// así que no puede tocar "Contactos generados" — no hay ningún camino de código
// que los conecte.
export function listarProductos(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const filas = todos(
    `SELECT fp.id, fp.producto_id, fp.producto_nombre, fp.creado_en,
            p.descripcion, p.precio, p.imagen, p.destacado,
            n.id AS negocio_id, n.slug AS negocio_slug, n.nombre AS negocio_nombre,
            n.categoria AS negocio_categoria, n.ciudad AS negocio_ciudad,
            n.alcaldia_municipio AS negocio_alcaldia, n.verificado AS negocio_verificado,
            n.estado AS negocio_estado
       FROM favoritos_productos fp
       LEFT JOIN productos p ON p.id = fp.producto_id
       JOIN negocios n ON n.id = fp.negocio_id
      WHERE fp.usuario_id = $u
      ORDER BY fp.creado_en DESC`,
    { u: usuario.id }
  );
  return filas
    // Un negocio suspendido/no publicado no debe seguir mostrando su
    // producto como favorito consultable, igual que ya pasa con negocios.
    .filter((f) => f.negocio_estado === 'publicado')
    .map((f) => {
      const disponible = f.producto_id !== null;
      const c = cat(f.negocio_categoria);
      return {
        id: f.id,
        productoId: f.producto_id,
        disponible,
        nombre: f.producto_nombre,
        descripcion: disponible ? f.descripcion : '',
        precio: disponible ? f.precio : null,
        imagen: disponible && f.imagen ? `/subidas/${f.imagen}` : null,
        destacado: disponible ? Boolean(f.destacado) : false,
        guardadoEn: f.creado_en,
        negocio: {
          id: f.negocio_id, slug: f.negocio_slug, nombre: f.negocio_nombre,
          categoriaIcono: c.icono, ciudad: f.negocio_ciudad, alcaldiaMunicipio: f.negocio_alcaldia || '',
          verificado: Boolean(f.negocio_verificado),
        },
      };
    });
}

export function agregarProducto(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  const producto = uno(`SELECT * FROM productos WHERE id = $id`, { id: Number(ctx.params.productoId) });
  if (!producto) throw new ErrorHttp(404, 'Ese producto ya no existe.');
  const negocio = obtenerNegocioPorId(producto.negocio_id);
  if (!negocio || negocio.estado !== 'publicado') throw new ErrorHttp(404, 'Ese producto ya no existe.');
  ejecutar(
    `INSERT OR IGNORE INTO favoritos_productos (usuario_id, producto_id, producto_nombre, negocio_id)
     VALUES ($u, $p, $nombre, $n)`,
    { u: usuario.id, p: producto.id, nombre: producto.nombre, n: negocio.id }
  );
  return { ok: true };
}

export function quitarProducto(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  ejecutar(`DELETE FROM favoritos_productos WHERE usuario_id = $u AND producto_id = $p`, {
    u: usuario.id, p: Number(ctx.params.productoId),
  });
  return { ok: true };
}

/** Para limpiar de la lista un favorito cuyo producto ya se borró (producto_id
 * quedó en NULL, así que ya no se puede localizar por producto_id). */
export function quitarRegistro(ctx) {
  const usuario = exigirRol(ctx, ROLES.USUARIO);
  ejecutar(`DELETE FROM favoritos_productos WHERE usuario_id = $u AND id = $id`, {
    u: usuario.id, id: Number(ctx.params.id),
  });
  return { ok: true };
}
