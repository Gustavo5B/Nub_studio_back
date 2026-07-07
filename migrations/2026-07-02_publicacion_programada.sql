-- =========================================================
-- Migración: publicación programada de obras y colecciones
-- Fecha: 2026-07-02
-- Ejecutar en Neon (usuario neondb_owner):
--   psql "$DATABASE_URL" -f migrations/2026-07-02_publicacion_programada.sql
-- =========================================================

-- Fecha a partir de la cual la colección/obra se publica automáticamente.
-- TIMESTAMPTZ para evitar ambigüedad de zona horaria entre cliente, Node y Neon.
ALTER TABLE colecciones ADD COLUMN IF NOT EXISTS fecha_publicacion_programada TIMESTAMPTZ;
ALTER TABLE obras       ADD COLUMN IF NOT EXISTS fecha_publicacion_programada TIMESTAMPTZ;

-- Índices parciales para el cron de publicación (consulta cada 5 minutos)
CREATE INDEX IF NOT EXISTS idx_colecciones_programadas
  ON colecciones (fecha_publicacion_programada)
  WHERE estado = 'programada';

CREATE INDEX IF NOT EXISTS idx_obras_programadas
  ON obras (fecha_publicacion_programada)
  WHERE estado = 'programada';
