import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
export const DIR_DATOS = join(RAIZ, 'data');
export const DIR_SUBIDAS = join(DIR_DATOS, 'uploads');

mkdirSync(DIR_SUBIDAS, { recursive: true });

export const db = new DatabaseSync(join(DIR_DATOS, 'mia.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// `sub` y `redes` se guardan como JSON en una columna TEXT: son datos que
// siempre se leen y se escriben completos junto con el negocio, nunca se
// filtran fila por fila, así que no ganan nada con una tabla aparte.
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  correo        TEXT NOT NULL UNIQUE,
  hash          TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'usuario',
  estado        TEXT NOT NULL DEFAULT 'activo',
  telefono      TEXT NOT NULL DEFAULT '',
  acepta_noticias        INTEGER NOT NULL DEFAULT 1,
  terminos_aceptados_en  TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS negocios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  propietaria_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  categoria       TEXT NOT NULL DEFAULT 'otros',
  categoria2      TEXT,
  sub             TEXT NOT NULL DEFAULT '[]',
  descripcion     TEXT NOT NULL DEFAULT '',
  sobre_negocio   TEXT NOT NULL DEFAULT '',
  ciudad          TEXT NOT NULL DEFAULT '',
  alcaldia_municipio TEXT NOT NULL DEFAULT '',
  direccion       TEXT NOT NULL DEFAULT '',
  telefono        TEXT NOT NULL DEFAULT '',
  logo            TEXT,
  banner          TEXT,
  foto_destacada  TEXT,
  redes           TEXT NOT NULL DEFAULT '{"whatsapp":"","instagram":"","facebook":"","tiktok":""}',
  plan            TEXT NOT NULL DEFAULT 'gratuito',
  plan_vence      TEXT,
  pago_confirmado INTEGER NOT NULL DEFAULT 1,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  estado          TEXT NOT NULL DEFAULT 'borrador',
  verificado      INTEGER NOT NULL DEFAULT 0,
  vistas          INTEGER NOT NULL DEFAULT 0,
  nota_revision   TEXT NOT NULL DEFAULT '',
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fotos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  archivo     TEXT NOT NULL,
  orden       INTEGER NOT NULL DEFAULT 0,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS productos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  precio      REAL,
  destacado   INTEGER NOT NULL DEFAULT 0,
  orden       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS publicaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  texto       TEXT NOT NULL DEFAULT '',
  destacada   INTEGER NOT NULL DEFAULT 0,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resenas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id    INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  calificacion  INTEGER NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
  comentario    TEXT NOT NULL DEFAULT '',
  respuesta     TEXT NOT NULL DEFAULT '',
  estado        TEXT NOT NULL DEFAULT 'publicada',
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS favoritos (
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (usuario_id, negocio_id)
);

-- Una usuaria sigue a un negocio: cuando ese negocio publica, le llega una
-- notificación (tabla de abajo). Distinta de "favoritos" porque un favorito
-- es privado y esto SÍ dispara avisos.
CREATE TABLE IF NOT EXISTS seguidores (
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (usuario_id, negocio_id)
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  negocio_id  INTEGER REFERENCES negocios(id) ON DELETE CASCADE,
  mensaje     TEXT NOT NULL,
  enlace      TEXT,
  leida       INTEGER NOT NULL DEFAULT 0,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lo que deja cada formulario de registro. No se exporta a ningún lado:
-- se revisa y se marca como atendida desde el propio panel.
CREATE TABLE IF NOT EXISTS solicitudes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id      INTEGER REFERENCES negocios(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL,
  plan_nombre     TEXT NOT NULL DEFAULT '',
  nombre          TEXT NOT NULL DEFAULT '',
  correo          TEXT NOT NULL DEFAULT '',
  telefono        TEXT NOT NULL DEFAULT '',
  negocio_nombre  TEXT NOT NULL DEFAULT '',
  ciudad          TEXT NOT NULL DEFAULT '',
  categoria       TEXT NOT NULL DEFAULT '',
  subcategorias   TEXT NOT NULL DEFAULT '',
  descripcion     TEXT NOT NULL DEFAULT '',
  mensaje         TEXT NOT NULL DEFAULT '',
  estado          TEXT NOT NULL DEFAULT 'nueva',
  creado_en       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articulos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  titulo      TEXT NOT NULL,
  resumen     TEXT NOT NULL DEFAULT '',
  cuerpo      TEXT NOT NULL DEFAULT '',
  autora      TEXT NOT NULL DEFAULT 'Equipo MÍA',
  publicado   INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articulo_fotos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  articulo_id  INTEGER NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  archivo      TEXT NOT NULL,
  orden        INTEGER NOT NULL DEFAULT 0,
  creado_en    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articulo_comentarios (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  articulo_id  INTEGER NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  texto        TEXT NOT NULL,
  creado_en    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Una sola reacción por persona y artículo; tocar la misma la quita,
-- tocar otra la reemplaza (se resuelve en la ruta, no aquí).
CREATE TABLE IF NOT EXISTS articulo_reacciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  articulo_id  INTEGER NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('like', 'dislike', 'love')),
  creado_en    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (articulo_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS bitacora (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  accion     TEXT NOT NULL,
  detalle    TEXT NOT NULL DEFAULT '',
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cada evento de Stripe que se procesa queda aquí: es el historial de pagos
-- que ve la administradora, y evita.procesar dos veces el mismo evento si
-- Stripe lo reintenta (les pasa seguido, no es un error).
CREATE TABLE IF NOT EXISTS pagos_stripe (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id        INTEGER REFERENCES negocios(id) ON DELETE SET NULL,
  evento_stripe_id  TEXT NOT NULL UNIQUE,
  tipo              TEXT NOT NULL,
  plan              TEXT NOT NULL DEFAULT '',
  monto             REAL,
  moneda            TEXT NOT NULL DEFAULT '',
  estado            TEXT NOT NULL DEFAULT 'pagado',
  creado_en         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Una usuaria le escribe a un negocio: una sola conversación por pareja
-- negocio-usuaria, con los mensajes de ida y vuelta en la tabla de abajo.
CREATE TABLE IF NOT EXISTS conversaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, usuario_id)
);

-- "leido" se refiere a si ya lo vio la otra parte (no quien lo escribió).
CREATE TABLE IF NOT EXISTS mensajes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversacion_id  INTEGER NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  autor            TEXT NOT NULL CHECK (autor IN ('usuario', 'negocio')),
  cuerpo           TEXT NOT NULL,
  leido            INTEGER NOT NULL DEFAULT 0,
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cuando una clienta toca "¿Aún disponible?" o "Me interesa" en un producto,
-- queda aquí para poder preguntarle al negocio (a las 48h y, si no contesta,
-- a las 96h) si se concretó la venta. Es el registro privado de ventas del
-- negocio: nadie más lo ve, ni siquiera la clienta que preguntó.
CREATE TABLE IF NOT EXISTS consultas_producto (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id       INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  producto_id      INTEGER REFERENCES productos(id) ON DELETE SET NULL,
  producto_nombre  TEXT NOT NULL,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  conversacion_id  INTEGER REFERENCES conversaciones(id) ON DELETE SET NULL,
  mensaje_tipo     TEXT NOT NULL CHECK (mensaje_tipo IN ('disponible', 'interesa')),
  resultado        TEXT NOT NULL DEFAULT 'pendiente'
                     CHECK (resultado IN ('pendiente', 'vendido', 'en_platicas', 'no_concretado')),
  preguntado_en    TEXT,
  recordado_en     TEXT,
  respondido_en    TEXT,
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Clics en los botones de contacto del perfil público (WhatsApp, redes,
-- teléfono). Guardado como eventos con fecha, no como contadores planos,
-- para poder armar más adelante el reporte mensual de negocios verificados.
CREATE TABLE IF NOT EXISTS interacciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('whatsapp', 'instagram', 'facebook', 'tiktok', 'telefono')),
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Una fila por cada visita al perfil público, para poder agrupar por mes en
-- el reporte de negocios verificados. "negocios.vistas" (el contador plano)
-- se sigue llevando aparte para no tener que sumar esta tabla en cada carga.
CREATE TABLE IF NOT EXISTS vistas_perfil (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interacciones_neg  ON interacciones(negocio_id);
CREATE INDEX IF NOT EXISTS idx_vistas_perfil_neg  ON vistas_perfil(negocio_id);
CREATE INDEX IF NOT EXISTS idx_seguidores_negocio ON seguidores(negocio_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_usu ON notificaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_consultas_negocio   ON consultas_producto(negocio_id);
CREATE INDEX IF NOT EXISTS idx_consultas_resultado ON consultas_producto(resultado);
CREATE INDEX IF NOT EXISTS idx_negocios_estado     ON negocios(estado);
CREATE INDEX IF NOT EXISTS idx_negocios_categoria  ON negocios(categoria);
CREATE INDEX IF NOT EXISTS idx_negocios_duena      ON negocios(propietaria_id);
CREATE INDEX IF NOT EXISTS idx_resenas_negocio     ON resenas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_fotos_negocio       ON fotos(negocio_id);
CREATE INDEX IF NOT EXISTS idx_productos_negocio   ON productos(negocio_id);
CREATE INDEX IF NOT EXISTS idx_publicaciones_neg   ON publicaciones(negocio_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado  ON solicitudes(estado);
CREATE INDEX IF NOT EXISTS idx_pagos_negocio       ON pagos_stripe(negocio_id);
CREATE INDEX IF NOT EXISTS idx_conversaciones_neg  ON conversaciones(negocio_id);
CREATE INDEX IF NOT EXISTS idx_conversaciones_usu  ON conversaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_conv       ON mensajes(conversacion_id);
CREATE INDEX IF NOT EXISTS idx_articulo_fotos_art  ON articulo_fotos(articulo_id);
CREATE INDEX IF NOT EXISTS idx_articulo_com_art     ON articulo_comentarios(articulo_id);
CREATE INDEX IF NOT EXISTS idx_articulo_reac_art    ON articulo_reacciones(articulo_id);
`);

// Migración ligera: si la base ya existía antes de sumar el cobro con
// Stripe, le faltan estas dos columnas. CREATE TABLE IF NOT EXISTS no las
// agrega sola porque la tabla ya está creada, así que se revisan a mano.
const columnasNegocios = todos(`SELECT name FROM pragma_table_info('negocios')`).map((c) => c.name);
if (!columnasNegocios.includes('stripe_customer_id')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN stripe_customer_id TEXT`);
}
if (!columnasNegocios.includes('stripe_subscription_id')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN stripe_subscription_id TEXT`);
}
// Crece con MÍA se cotiza a mano: este es el Payment Link que la
// administradora crea en Stripe para ESE negocio en particular, con su
// precio personalizado. Sin esto, ese plan no tiene forma de cobrarse solo.
if (!columnasNegocios.includes('enlace_pago_crece')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN enlace_pago_crece TEXT`);
}
// Segunda categoría opcional: un negocio puede cruzar dos rubros (una
// repostería que también hace golosinas para mascotas, por ejemplo).
if (!columnasNegocios.includes('categoria2')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN categoria2 TEXT`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_negocios_categoria2 ON negocios(categoria2)`);

// Consentimiento de privacidad (obligatorio al registrarse) y de noticias
// por correo (opcional). Las cuentas creadas antes de esto quedan con
// terminos_aceptados_en en NULL — no se les exige retroactivamente.
const columnasUsuarios = todos(`SELECT name FROM pragma_table_info('usuarios')`).map((c) => c.name);
if (!columnasUsuarios.includes('acepta_noticias')) {
  db.exec(`ALTER TABLE usuarios ADD COLUMN acepta_noticias INTEGER NOT NULL DEFAULT 1`);
}
if (!columnasUsuarios.includes('terminos_aceptados_en')) {
  db.exec(`ALTER TABLE usuarios ADD COLUMN terminos_aceptados_en TEXT`);
}
// Foto de banner/portada del perfil, aparte del logo (foto de perfil) y de
// la galería. Se llama "banner" para no chocar con el campo "portada" que ya
// usa la vista pública (la primera foto de la galería, como miniatura de tarjeta).
if (!columnasNegocios.includes('banner')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN banner TEXT`);
}
// Foto para la tarjeta del directorio: aparte del logo, de la portada del
// perfil (banner) y de la galería, para que la dueña pueda mostrar ahí algo
// representativo de su negocio (su barra, su producto) sin que se repita la
// misma imagen que ya se ve en su perfil.
if (!columnasNegocios.includes('foto_destacada')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN foto_destacada TEXT`);
}
// Más fino que la ciudad: la alcaldía (en la Ciudad de México) o el
// municipio (en el resto del país) donde de verdad está el negocio.
if (!columnasNegocios.includes('alcaldia_municipio')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN alcaldia_municipio TEXT NOT NULL DEFAULT ''`);
}
// Texto adicional para negocios verificados: "Sobre mi negocio".
if (!columnasNegocios.includes('sobre_negocio')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN sobre_negocio TEXT NOT NULL DEFAULT ''`);
}
// Descuento permanente que la organización le da a un negocio (0 a 100),
// para negocios de cortesía o convenio que nunca pasan por Stripe. Se
// descuenta del precio de lista al calcular el ingreso mensual real, para
// no contar como ganancia lo que en realidad no se cobra.
if (!columnasNegocios.includes('descuento_porcentaje')) {
  db.exec(`ALTER TABLE negocios ADD COLUMN descuento_porcentaje INTEGER NOT NULL DEFAULT 0`);
}
// A dónde navegar al tocar la notificación: el perfil del negocio (nueva
// publicación de quien sigues) o el registro de ventas (confirmar una venta).
const columnasNotificaciones = todos(`SELECT name FROM pragma_table_info('notificaciones')`).map((c) => c.name);
if (columnasNotificaciones.length && !columnasNotificaciones.includes('enlace')) {
  db.exec(`ALTER TABLE notificaciones ADD COLUMN enlace TEXT`);
}
// Foto del producto: para que el catálogo de cada negocio se vea como una
// tarjeta (foto, nombre, descripción, precio), no solo texto.
const columnasProductos = todos(`SELECT name FROM pragma_table_info('productos')`).map((c) => c.name);
if (!columnasProductos.includes('imagen')) {
  db.exec(`ALTER TABLE productos ADD COLUMN imagen TEXT`);
}
// Foto y contador de vistas en publicaciones, para que funcionen como el
// feed de un negocio: cada publicación puede traer una foto y sabe cuántas
// veces se abrió. Los comentarios viven en su propia tabla, igual que los
// de un artículo del blog.
const columnasPublicaciones = todos(`SELECT name FROM pragma_table_info('publicaciones')`).map((c) => c.name);
if (!columnasPublicaciones.includes('imagen')) {
  db.exec(`ALTER TABLE publicaciones ADD COLUMN imagen TEXT`);
}
if (!columnasPublicaciones.includes('vistas')) {
  db.exec(`ALTER TABLE publicaciones ADD COLUMN vistas INTEGER NOT NULL DEFAULT 0`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS publicacion_comentarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  publicacion_id  INTEGER NOT NULL REFERENCES publicaciones(id) ON DELETE CASCADE,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  texto           TEXT NOT NULL,
  creado_en       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_publicacion_com_pub ON publicacion_comentarios(publicacion_id);
`);

/** Consulta que devuelve varias filas. */
export function todos(sql, params = {}) {
  return db.prepare(sql).all(params);
}

/** Consulta que devuelve una fila (o undefined). */
export function uno(sql, params = {}) {
  return db.prepare(sql).get(params);
}

/** INSERT / UPDATE / DELETE. Devuelve { changes, lastInsertRowid }. */
export function ejecutar(sql, params = {}) {
  return db.prepare(sql).run(params);
}

/** Registra una acción administrativa para poder auditarla después. */
export function anotar(actorId, accion, detalle = '') {
  ejecutar(
    `INSERT INTO bitacora (actor_id, accion, detalle) VALUES ($actor, $accion, $detalle)`,
    { actor: actorId ?? null, accion, detalle }
  );
}

/** Ejecuta varias operaciones como una sola transacción. */
export function transaccion(fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
