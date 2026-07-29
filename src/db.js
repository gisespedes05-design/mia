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
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS negocios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  propietaria_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  categoria       TEXT NOT NULL DEFAULT 'otros',
  sub             TEXT NOT NULL DEFAULT '[]',
  descripcion     TEXT NOT NULL DEFAULT '',
  ciudad          TEXT NOT NULL DEFAULT '',
  direccion       TEXT NOT NULL DEFAULT '',
  telefono        TEXT NOT NULL DEFAULT '',
  logo            TEXT,
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
