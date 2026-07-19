-- =========================================================
-- Tarjeta ② — Posts relacionados del blog (precalculados)
-- Tabla que guarda, por cada post, sus N posts más parecidos
-- según la similitud coseno (TF-IDF) calculada en el notebook
-- clasificacion_posts.ipynb. El endpoint público solo la LEE.
-- =========================================================

CREATE TABLE IF NOT EXISTS blog_posts_relacionados (
  id_post             INTEGER NOT NULL REFERENCES blog_posts(id_post) ON DELETE CASCADE,
  id_post_relacionado INTEGER NOT NULL REFERENCES blog_posts(id_post) ON DELETE CASCADE,
  score               NUMERIC(6,4) NOT NULL,
  PRIMARY KEY (id_post, id_post_relacionado)
);

CREATE INDEX IF NOT EXISTS idx_bpr_id_post ON blog_posts_relacionados (id_post);

-- Lectura para todos los roles (la vista de blog es pública y también
-- la ven usuarios logueados → cada uno usa su pool de rol).
GRANT SELECT ON blog_posts_relacionados
  TO usr_visitante, usr_cliente, usr_artista, usr_admin;
