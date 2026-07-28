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

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  correo        TEXT NOT NULL UNIQUE,
  hash          TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'usuario',
  estado        TEXT NOT NULL DEFAULT 'activo',
  telefono      TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS negocios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  propietaria_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  categoria       TEXT NOT NULL DEFAULT 'otros',
  descripcion     TEXT NOT NULL DEFAULT '',
  entidad         TEXT NOT NULL DEFAULT '',
  municipio       TEXT NOT NULL DEFAULT '',
  direccion       TEXT NOT NULL DEFAULT '',
  telefono        TEXT NOT NULL DEFAULT '',
  whatsapp        TEXT NOT NULL DEFAULT '',
  sitio_web       TEXT NOT NULL DEFAULT '',
  instagram       TEXT NOT NULL DEFAULT '',
  facebook        TEXT NOT NULL DEFAULT '',
  tiktok          TEXT NOT NULL DEFAULT '',
  plan            TEXT NOT NULL DEFAULT 'gratis',
  plan_vence      TEXT,
  estado          TEXT NOT NULL DEFAULT 'borrador',
  verificado      INTEGER NOT NULL DEFAULT 0,
  destacado       INTEGER NOT NULL DEFAULT 0,
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
  orden       INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS bitacora (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  accion     TEXT NOT NULL,
  entidad    TEXT NOT NULL,
  entidad_id INTEGER,
  detalle    TEXT NOT NULL DEFAULT '',
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_negocios_estado    ON negocios(estado);
CREATE INDEX IF NOT EXISTS idx_negocios_categoria ON negocios(categoria);
CREATE INDEX IF NOT EXISTS idx_negocios_duena     ON negocios(propietaria_id);
CREATE INDEX IF NOT EXISTS idx_resenas_negocio    ON resenas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_fotos_negocio      ON fotos(negocio_id);
CREATE INDEX IF NOT EXISTS idx_productos_negocio  ON productos(negocio_id);
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
export function anotar(actorId, accion, entidad, entidadId, detalle = '') {
  ejecutar(
    `INSERT INTO bitacora (actor_id, accion, entidad, entidad_id, detalle)
     VALUES ($actor, $accion, $entidad, $entidadId, $detalle)`,
    { actor: actorId ?? null, accion, entidad, entidadId: entidadId ?? null, detalle }
  );
}
