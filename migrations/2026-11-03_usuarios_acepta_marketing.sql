-- =========================================================
-- Derecho ARCO de Oposición
-- Guarda si el cliente autorizó recibir comunicaciones de marketing.
-- Empieza en FALSE: el Aviso de Privacidad pide autorización previa.
-- Se aplica en la base ANTES de subir el código que la usa.
-- =========================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS acepta_marketing BOOLEAN NOT NULL DEFAULT FALSE;
