# Referencia completa — Modelo de Posts Relacionados (Blog, NU★B Studio)

> Documento de contexto para retomar el trabajo del modelo de **posts
> relacionados** del blog en otra conversación. Todo lo aquí descrito fue
> verificado contra el código y la base de datos real de Neon en el momento
> de escribirlo.
>
> **Ojo:** el blog también tiene un segundo modelo (clasificación/sugerencia
> de etiquetas, supervisado) que **no** se documenta aquí a propósito — este
> archivo es exclusivamente sobre el recomendador de posts relacionados.
> Tampoco cubre el modelo del carrito (SVD colaborativo), que es un proyecto
> aparte.

## ⚠️ Vital antes de hacer nada: crear tu propia conexión a la BD

Esta base de datos es **PostgreSQL en Neon**, sin ORM (se usa `pg` puro). Las
credenciales viven en `Nub_studio_back/.env` (`DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD`, `DB_NAME`). Cualquier chat/sesión nueva **no hereda ninguna
conexión previa** — hay que crear la propia desde cero antes de poder
consultar o modificar cualquier dato. Patrón mínimo en Node (usado en todos los
scripts de este proyecto):

```js
import 'dotenv/config';
import pkg from 'pg'; const { Pool } = pkg;
const pool = new Pool({
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  ssl: { rejectUnauthorized: false },
});
```

O en Python (usado en el notebook y en `ml_service`):
```python
import psycopg2
from dotenv import load_dotenv
load_dotenv(".env")
conn = psycopg2.connect(host=os.environ["DB_HOST"], user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"], dbname=os.environ["DB_NAME"],
    port=os.environ.get("DB_PORT","5432"), sslmode="require")
```

**Regla del proyecto (`CLAUDE.md`): las migraciones del repo NO reflejan el
esquema real de Neon.** Antes de escribir cualquier query nueva, verifica las
columnas reales contra `information_schema.columns`, no contra los `.sql` de
`migrations/`.

---

## 1. El modelo: Posts relacionados (no supervisado)

**Objetivo:** para cada post del blog, encontrar los N más parecidos
(por tema/contenido), **sin usar las etiquetas como respuesta correcta** —
el modelo agrupa el texto por sí solo y de ahí salen los "relacionados".

**Paradigma:** no supervisado. **Técnica:** TF-IDF → SVD (LSA) → K-Means.

**Notebook:** `Nub_studio_back/notebooks/sistema_recomendacion_posts.ipynb`
(generado por el script constructor `_build_recomendacion.py`, en la misma carpeta).

---

## 2. De dónde salen los datos (tablas reales de Neon)

Verificado con `information_schema.columns` — estas son las columnas reales,
no las de la migración:

### `blog_posts` (la materia prima: texto de cada post)
```
id_post (PK), id_categoria (FK), titulo, slug, contenido (text, HTML),
extracto (text), imagen_destacada, meta_description, estado (varchar:
'publicado'|'borrador'|...), fecha_publicacion, vistas, activo, eliminado,
fecha_eliminacion, eliminado_por, fecha_creacion, fecha_actualizacion,
autor_id (FK usuarios), autor_rol
```
El modelo solo usa `titulo + extracto + contenido` de los posts con
`estado = 'publicado'` (no toca borradores).

### `blog_etiquetas` (12 etiquetas curadas — solo se usan para VALIDAR, no para entrenar)
```
id_blog_etiqueta (PK), slug, nombre, activo
```
Slugs reales: `pintura, escultura, ceramica, textil, grabado, fotografia,
ilustracion, huasteca, tradicion, paisaje, retrato, naturaleza`.

### `blog_posts_etiquetas` (relación N:M post↔etiqueta)
```
id (PK), id_post (FK), id_blog_etiqueta (FK), fecha_creacion
```
El notebook las usa **después** de entrenar, solo para revisar si los grupos
que formó K-Means tienen sentido temático (el modelo nunca las ve durante el
entrenamiento — por eso es no supervisado).

### `blog_posts_relacionados` (tabla PRECALCULADA — el resultado final del modelo)
```
id_post (FK), id_post_relacionado (FK), score (similitud coseno)
```
Esta tabla la **reescribe por completo** el `ml_service` cada vez que se
recalcula (ver §4). No se llena a mano, no se hace `UPDATE` parcial: siempre
`TRUNCATE` + reinserción completa.

### `categorias` (7 categorías reales)
```
1 Fotografía · 2 Pintura · 3 Escultura · 4 Artesanía · 5 Ilustración ·
6 Cerámica · 7 Grabado
```

### Volumen de datos (al momento de escribir esto)
~248 posts reales previos + un lote nuevo de 1801 posts sintéticos ya
**aplicado a Neon** (commit confirmado) → **2049 posts totales**. Marca de
posts sintéticos: `slug LIKE 'seed-post-%'`. Los `.joblib`/tablas del modelo
**todavía no se han reentrenado** con este volumen ampliado (ver §7).

---

## 3. Pipeline completo dentro del notebook

1. **Carga**: todos los posts publicados desde Neon (fallback a
   `notebooks/blog_posts_relacionados.csv` si no hay conexión), con
   `titulo + extracto + contenido` limpio de HTML.
2. **TF-IDF**: `TfidfVectorizer` (ngramas 1-2, `max_features=5000`, stopwords
   en español escritas a mano, sin librería externa) → matriz *posts × palabras*.
3. **SVD/LSA** (`TruncatedSVD`, `n_components=100`) + `Normalizer` → comprime
   la matriz a ~100 "conceptos" latentes. **Esto es solo compresión de
   dimensiones, no es el modelo final** — el mismo patrón se reutiliza en el
   modelo del carrito, pero ahí el SVD sí es el modelo; aquí es un paso previo.
4. **K-Means** — **este es el modelo real**: agrupa los posts en `k` grupos,
   elegido por método del codo + silhouette score, sin ver nunca las
   etiquetas reales durante el entrenamiento.
5. **Validación**: revisa si las etiquetas dominantes de cada grupo formado
   tienen sentido temático — coherencia post-hoc, ya que el modelo no las usó
   para entrenar.
6. **Recomendación**: dentro del mismo grupo (cluster) que un post dado, se
   ordenan los demás posts del grupo por similitud coseno en el espacio LSA,
   y se toma el top-N (normalmente top-4).
7. **Guarda el modelo entrenado** en `notebooks/modelo_recomendacion.joblib`
   — el bundle contiene: `{tfidf, lsa, kmeans, k}` (el vectorizador, el
   reductor SVD+Normalizer, el K-Means ya ajustado, y el número de clusters usado).
8. **Exporta** el resultado precalculado a `notebooks/recomendaciones_kmeans.csv`
   (top-4 por post) — y ese mismo cálculo es el que puebla la tabla real
   `blog_posts_relacionados` en Neon.

---

## 4. Cómo se sirve en producción — DOS CAMINOS DISTINTOS (no confundir)

### a) Lectura pública desde tabla precalculada
- Archivo: `Nub_studio_back/src/controllers/blogController.js`, función
  **`obtenerRelacionados`** (línea ~1391)
- Endpoint: **`GET /api/blog/posts/:slug/relacionados?n=4`** (público, `optionalAuth`)
- Es una simple `SELECT` a `blog_posts_relacionados` JOIN `blog_posts`,
  filtrando solo posts publicados/activos/no-eliminados, ordenado por `score`.
- **No llama al `ml_service`** — es lectura directa de la tabla, porque los
  relacionados de un post no dependen de quién los pida ni del momento (misma
  respuesta para todos hasta el próximo recálculo). Es la decisión de diseño
  contraria a la del modelo del carrito, que sí se sirve en vivo porque ahí
  el contexto (usuario + carrito) sí cambia constantemente.
- Ruta registrada en `src/routes/blogRoutes.js` (línea ~68):
  `router.get('/posts/:slug/relacionados', optionalAuth, obtenerRelacionados);`
- Consumido por el front en
  `Nub_studio_front/src/pages/public/BlogDetalle.tsx` (línea ~164):
  `fetch(`${API}/api/blog/posts/${slug}/relacionados`)`, mostrado en la
  sección "Posts relacionados" del detalle de un post (línea ~468-478).

### b) Recálculo del modelo (Express dispara, ml_service ejecuta K-Means)
- Archivo: `blogController.js`, función **`dispararRecalculoRelacionados`**
  (línea ~1317) — *fire-and-forget*: no bloquea la respuesta al usuario, solo
  registra un warning si falla.
- Se dispara automáticamente:
  - al **crear** un post que nace publicado (línea ~566):
    `if (estado === 'publicado') dispararRecalculoRelacionados();`
  - al **editar** un post y publicarlo (línea ~678):
    `if (publicando) dispararRecalculoRelacionados();`
- Internamente hace `POST` a `/recalcular-relacionados` en el `ml_service`
  (timeout 30s).
- En `ml_service/app.py`, la función `_recalcular_y_guardar()` (línea ~212)
  hace, en orden:
  1. Relee **todo** el corpus actual desde Neon vía `cargar_corpus()` — esto
     incluye los posts recién publicados/editados.
  2. Entrena un **TF-IDF fresco** con el vocabulario del corpus actual (no
     reutiliza el `.joblib` del notebook — se re-ajusta cada vez).
  3. `TruncatedSVD` + `Normalizer` + `KMeans`, con `k` recalculado según
     cuántos posts haya en ese momento.
  4. Calcula similitud coseno dentro de cada grupo y arma los pares
     `(id_post, id_post_relacionado, score)`.
  5. **`TRUNCATE blog_posts_relacionados`** y reinserta todo con
     `execute_values` (psycopg2) — reescribe la tabla completa, nunca hace
     `UPDATE` parcial.
  6. Refresca la memoria del propio proceso (`STATE["corpus"]`, `STATE["X"]`)
     para que el endpoint en vivo `/relacionados/{id}` también quede al día.
- Endpoint expuesto: **`POST /recalcular-relacionados`** — sin autenticación
  propia (asume que solo Express lo llama internamente; no está pensado para
  exponerse públicamente sin protección adicional).

### c) Endpoints adicionales del `ml_service` para este modelo (uso en vivo/pruebas)
- **`GET /relacionados/{id_post}?n=4`** — similitud coseno en vivo contra el
  corpus ya vectorizado en memoria. Más usado para debug que en producción,
  ya que el público real usa la ruta (a), que lee la tabla precalculada.
- **`POST /relacionados-texto`** — recibe texto libre (un borrador aún no
  guardado) y devuelve los posts existentes más parecidos; sirve para dar
  una vista previa de "esto se parecería a..." antes de publicar.

---

## 5. El microservicio: `ml_service/app.py`

Archivo único, FastAPI. Arranca con:
```bash
ml_service/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
```

**Al arrancar (`lifespan`)**, entre otras cosas relevantes a este modelo,
carga en memoria el corpus completo de `blog_posts` (para los endpoints en
vivo `/relacionados/{id}` y `/relacionados-texto`).

**Endpoints de este modelo, resumen:**

| Método | Ruta | Quién lo llama |
|---|---|---|
| GET | `/relacionados/{id_post}` | uso interno/pruebas (coseno en vivo) |
| POST | `/relacionados-texto` | borradores sin guardar aún |
| POST | `/recalcular-relacionados` | Express, al publicar/editar un post |
| GET | `/health` | monitoreo — reporta `posts_en_memoria` |

**Variable de entorno clave:** `ML_SERVICE_URL` (en `.env` del backend,
default `http://localhost:8000`) — la URL que usa Express para llamar a este
microservicio. Si no está corriendo, Express degrada con manejo de error
controlado, nunca truena el flujo principal de publicar/ver un post.

---

## 6. Generación / volumen de datos (los scripts de seed)

Ninguno de los dos scripts **entrena el modelo** — solo generan filas de
`blog_posts` (+ etiquetas + comentarios) para tener datos con qué
entrenar/evaluar el notebook.

### `seedBlogPosts.mjs` (el original — 239 posts)
- Genera posts `seed-post-1`..`seed-post-239`, 7 temas (uno por categoría real).
- **Destructivo/idempotente**: borra primero cualquier `seed-post-%` anterior
  (y sus hijos: comentarios, reacciones, etiquetas) antes de regenerar.
- Uso: `node scripts/seedBlogPosts.mjs [--dry-run]`
- Defecto conocido: no verifica títulos duplicados entre sí — hay ~10
  títulos repetidos dentro de este rango (confirmado, no urgente).

### `seedBlogPostsMasivo.mjs` (el nuevo — +1801 posts, YA APLICADO a Neon)
- **No borra nada**: continúa la numeración donde se haya quedado el máximo
  `seed-post-N` existente (lo consulta en vivo).
- Banco de ~100 oraciones combinables por tema (12 propias + 88 genéricas
  parametrizadas), longitud variable por post (corto/medio/largo, 57-200
  palabras), verificación de unicidad de título/contenido **incluyendo
  precarga de los títulos ya existentes en la BD** (para no chocar con los
  del script original).
- **Estado actual: ya se ejecutó con COMMIT real.** Total acumulado tras la
  corrida: 2049 posts `seed-post-%`. Dejó evidencia en
  `migrations/evidencia_seed_blog_masivo_20260731_200221_seed-post-240-a-2040.sql`
  (INSERT literal de lo que quedó en Neon, con ids reales — no pensado para
  re-ejecutarse, es solo auditoría).
- Flags: `--dry-run`, `--force`, `--n=N`, `--sin-evidencia`.

---

## 7. Pendiente para quien retome esto

- **El `.joblib` del modelo (`modelo_recomendacion.joblib`) y el CSV export
  todavía NO conocen los 1801 posts nuevos.** Hay que volver a correr
  `sistema_recomendacion_posts.ipynb` completo para que el notebook reentrene
  con el dataset ampliado (2049 posts) y regenere el `.joblib`.
- **La tabla `blog_posts_relacionados` tampoco refleja el dataset ampliado
  todavía** — solo se actualiza cuando se dispara `/recalcular-relacionados`
  (automático al publicar/editar UN post, no hay un trigger que la recalcule
  por lotes tras un seed masivo). Si se quiere que ya contemple los posts
  nuevos, hay que llamar manualmente:
  ```bash
  curl -X POST http://localhost:8000/recalcular-relacionados
  ```
  (con el `ml_service` corriendo) — esto reentrena K-Means en vivo con el
  corpus actual completo y reescribe la tabla.
- Con ~2049 posts en vez de 248, es buen momento para revisar si el `k`
  (número de clusters) que elige el método del codo/silhouette sigue siendo
  razonable, o si conviene ajustar el rango de `k` que prueba el notebook.
