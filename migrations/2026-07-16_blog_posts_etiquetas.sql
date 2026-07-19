-- =========================================================
-- Migración: catálogo curado de etiquetas del BLOG
-- Fecha: 2026-07-16
-- Objetivo: poblar `blog_etiquetas` con un conjunto limpio y
-- coherente para "posts relacionados por etiquetas" y para el
-- modelo de CLASIFICACIÓN (libreta ML).
--
-- ⚠️ NOTA SOBRE EL ESQUEMA REAL (auditado en Neon 2026-07-16):
-- El blog tiene su PROPIO sistema de etiquetas, independiente del
-- de las obras (`etiquetas`/`obras_etiquetas`). Ambas tablas del
-- blog ya existen (creadas a mano en Neon) y estaban vacías:
--   blog_etiquetas(id_blog_etiqueta, nombre, slug, activo,
--                  fecha_creacion, fecha_actualizacion)
--   blog_posts_etiquetas(id, id_post -> blog_posts,
--                        id_blog_etiqueta -> blog_etiquetas,
--                        fecha_creacion)
-- Por eso esta migración NO crea tablas: solo inserta el catálogo.
--
-- Ejecutar en Neon (usuario neondb_owner):
--   psql "$DATABASE_URL" -f migrations/2026-07-16_blog_posts_etiquetas.sql
-- =========================================================

-- Catálogo curado (~12 etiquetas fuertes y temáticas). Idempotente:
-- no duplica si el slug ya existe.
INSERT INTO blog_etiquetas (nombre, slug, activo)
SELECT v.nombre, v.slug, TRUE
FROM (VALUES
  ('Pintura',    'pintura'),
  ('Escultura',  'escultura'),
  ('Cerámica',   'ceramica'),
  ('Textil',     'textil'),
  ('Grabado',    'grabado'),
  ('Fotografía', 'fotografia'),
  ('Ilustración','ilustracion'),
  ('Huasteca',   'huasteca'),
  ('Tradición',  'tradicion'),
  ('Paisaje',    'paisaje'),
  ('Retrato',    'retrato'),
  ('Naturaleza', 'naturaleza')
) AS v(nombre, slug)
WHERE NOT EXISTS (
  SELECT 1 FROM blog_etiquetas be WHERE be.slug = v.slug
);

-- Permisos por rol (RLS por usuario de BD), mismo patrón que blog_reacciones.
-- Público/visitante solo lee; admin y artista gestionan etiquetas de posts.
GRANT SELECT ON blog_etiquetas, blog_posts_etiquetas TO usr_visitante, usr_cliente;
GRANT SELECT, INSERT, UPDATE, DELETE ON blog_etiquetas, blog_posts_etiquetas TO usr_admin, usr_artista;
