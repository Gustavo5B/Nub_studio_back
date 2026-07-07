-- =========================================================
-- Migración: reacciones con emoji en posts del foro/blog
-- Fecha: 2026-07-03
-- Ejecutar en Neon (usuario neondb_owner):
--   psql "$DATABASE_URL" -f migrations/2026-07-03_blog_reacciones.sql
-- =========================================================

-- Una reacción por usuario por post (UNIQUE id_post + id_usuario).
-- El emoji se valida también en la app contra una lista blanca.
CREATE TABLE IF NOT EXISTS blog_reacciones (
  id_reaccion         SERIAL PRIMARY KEY,
  id_post             INTEGER NOT NULL REFERENCES blog_posts(id_post) ON DELETE CASCADE,
  id_usuario          INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  emoji               VARCHAR(16) NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  fecha_creacion      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_blog_reacciones_post_usuario UNIQUE (id_post, id_usuario)
);

-- Conteos por post (query principal del endpoint público)
CREATE INDEX IF NOT EXISTS idx_blog_reacciones_post ON blog_reacciones (id_post);

-- Permisos para los usuarios de rol (RLS por usuario de BD)
GRANT SELECT ON blog_reacciones TO usr_visitante;
GRANT SELECT, INSERT, UPDATE, DELETE ON blog_reacciones TO usr_admin, usr_artista, usr_cliente;
GRANT USAGE, SELECT ON SEQUENCE blog_reacciones_id_reaccion_seq TO usr_admin, usr_artista, usr_cliente;
