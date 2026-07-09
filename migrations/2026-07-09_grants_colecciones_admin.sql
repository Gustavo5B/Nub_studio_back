-- =========================================================
-- Migración: permisos de usr_admin sobre colecciones
-- Fecha: 2026-07-09
-- Contexto: los endpoints admin de colecciones ahora usan el
-- pool usr_admin (RLS por usuario de BD) en lugar del pool
-- dueño, pero a usr_admin nunca se le otorgaron permisos
-- sobre la tabla colecciones.
-- El admin solo lista/revisa y cambia estado/destacada:
-- SELECT + UPDATE, sin INSERT ni DELETE (mínimo privilegio).
-- =========================================================

GRANT SELECT, UPDATE ON TABLE colecciones TO usr_admin;
