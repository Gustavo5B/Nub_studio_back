# Handoff — Tarjeta ② "Clasificación": posts relacionados por etiquetas (blog)

> Guion para ejecutar en el **chat donde está la importación de datos sintéticos (seed ML)**.
> Orden obligatorio: **1) migrar BD → 2) sembrar posts con etiquetas → 3) libreta de clasificación → 4) feature en la app.**
> El modelo necesita datos etiquetados para aprender, por eso la BD va primero.

## Qué existe hoy (AUDITADO en Neon 2026-07-16)

- El blog tiene su **propio** sistema de etiquetas, **independiente del de obras**:
  - `blog_etiquetas(id_blog_etiqueta, nombre, slug, activo, ...)` — **ya poblada con 12 etiquetas curadas** (ids 1..12): `pintura, escultura, ceramica, textil, grabado, fotografia, ilustracion, huasteca, tradicion, paisaje, retrato, naturaleza`.
  - `blog_posts_etiquetas(id, id_post → blog_posts, id_blog_etiqueta → blog_etiquetas, fecha_creacion)` — **vacía**.
  - ⚠️ NO uses la tabla `etiquetas`/`obras_etiquetas`: esas son de obras.
- `blog_posts`: 13 filas (3 reales + 10 'seed-post-%' de plantilla idéntica, inservibles para ML).
- El seed ML actual es de **obras/clientes**, **no** de blog. Hay que generar posts.

---

## Paso 1 — Migración BD (ya está el .sql listo)

**✅ HECHO (2026-07-16).** Las tablas `blog_etiquetas` y `blog_posts_etiquetas` ya
existían en Neon (hechas a mano). Se auditaron y se pobló `blog_etiquetas` con 12
etiquetas curadas vía `migrations/2026-07-16_blog_posts_etiquetas.sql` (aplicado).
No hay nada pendiente en este paso.

---

## Paso 2 — Sembrar posts del blog con etiquetas (datos para ML)

El clasificador necesita ~cientos de posts **con texto y etiquetas** para entrenar. Como el blog está casi vacío, hay que generarlos igual que se hizo con las obras.

**Diseño del seed de blog (pídelo en el otro chat así):**

- Generar **~200–300 posts** marcados como seed. Sugerencia de marca: `slug LIKE 'seed-post-%'` (para poder limpiarlos después, igual que `seed-obra-%`).
- Cada post: `titulo` (≥5 chars), `contenido` (≥50 chars de texto real, no lorem puro — que las palabras reflejen su tema), `estado='publicado'`, `activo=true`, `autor_id` de un artista/admin seed existente.
- Reutilizar los **temas/categorías** ya existentes (Pintura, Escultura/Cerámica, Textil, Grabado, Paisaje, Retrato…) para que el texto sea coherente con las etiquetas.
- Asignar a cada post **2–4 etiquetas** en `blog_posts_etiquetas`, coherentes con el tema del texto → esto es el **ground truth** (la "etiqueta verdadera") que el modelo debe aprender a predecir.
- Distribución realista: que unas etiquetas sean frecuentes y otras raras (cola larga), no uniforme.

> Clave para que el proyecto tenga sentido: el **texto** del post debe "delatar" sus etiquetas (un post sobre cerámica menciona barro, torno, esmalte…). Si el texto es aleatorio, el modelo no puede aprender nada y la tarjeta pierde sentido.

---

## Paso 3 — Libreta de Jupyter: **Clasificación** (el modelo)

Este es el entregable académico. Es **clasificación de texto multi-etiqueta**: entrada = texto del post, salida = etiquetas.

Estructura sugerida del notebook (`notebooks/clasificacion_posts.ipynb`):

```python
# 1. Cargar datos desde Neon
import pandas as pd
from sqlalchemy import create_engine
engine = create_engine(DATABASE_URL)   # el mismo del backend

posts = pd.read_sql("""
  SELECT bp.id_post, bp.titulo, bp.contenido,
         array_agg(be.slug) AS etiquetas
  FROM blog_posts bp
  JOIN blog_posts_etiquetas bpe ON bpe.id_post = bp.id_post
  JOIN blog_etiquetas be ON be.id_blog_etiqueta = bpe.id_blog_etiqueta
  WHERE bp.eliminado = false
  GROUP BY bp.id_post
""", engine)

# 2. Limpiar texto (quitar HTML del contenido) + juntar título+contenido
# 3. Vectorizar: TF-IDF con stopwords en español
from sklearn.feature_extraction.text import TfidfVectorizer
# 4. Etiquetas a formato multi-label
from sklearn.preprocessing import MultiLabelBinarizer
# 5. Modelo: One-vs-Rest (LogisticRegression o LinearSVC)
from sklearn.multiclass import OneVsRestClassifier
from sklearn.linear_model import LogisticRegression
# 6. train/test split + entrenar
# 7. Evaluar: precision/recall/F1 (micro y macro), hamming_loss, matriz de confusión por etiqueta
# 8. Guardar el modelo entrenado (joblib.dump) para usarlo/re-aplicarlo
```

**Además, "posts relacionados" con el mismo notebook** (esto es lo que pide literalmente la tarjeta):

```python
# Similitud de contenido entre posts con los vectores TF-IDF
from sklearn.metrics.pairwise import cosine_similarity
# Para cada post → top-N posts más parecidos (relacionados)
# Se puede exportar a una tabla (p.ej. blog_posts_relacionados) o
# calcular en caliente en el backend a partir de las etiquetas.
```

Dependencias del notebook: `pandas`, `scikit-learn`, `sqlalchemy`, `psycopg2-binary`, `joblib`, `jupyter`.

**Cómo el modelo "trabaja dentro" (tu pregunta):** dos opciones —
- **A (recomendación por etiquetas, simple):** el modelo/seed deja las etiquetas en `blog_posts_etiquetas` y el backend calcula relacionados con SQL (posts que comparten más etiquetas). El notebook justifica/genera las etiquetas.
- **B (modelo servido):** exportas el modelo (`joblib`) y un endpoint del backend lo consulta, o precalculas una tabla `blog_posts_relacionados`. Más complejo; solo si la materia exige el modelo "en vivo".

---

## Paso 4 — Feature en la app (este chat, después del seed)

Cuando la BD ya tenga la relación y datos, aquí se hace (con la skill `nub-new-endpoint`):

- **Endpoint** `GET /api/blog/posts/:slug/relacionados` (pool `usr_visitante`): trae los N posts publicados que comparten más etiquetas con el post actual, excluyéndolo.
- Incluir las **etiquetas del post** en `obtenerPostPorSlug` (agregar el `array_agg` de etiquetas).
- **Frontend** (skill `nub-new-page` / servicio en `src/services/`): sección "Posts relacionados" en la vista de detalle del blog (diseño ALTAR).

---

## Resumen del orden

1. ✅ Etiquetas del blog: `blog_etiquetas` poblada con 12 etiquetas curadas (aplicado en Neon).
2. ⏳ Seed de ~200–300 posts con texto temático + 2–4 etiquetas c/u → usar `blog_posts_etiquetas` (id_post, id_blog_etiqueta). Ver `PROMPT_para_otro_chat.txt`.
3. ⏳ Notebook `clasificacion_posts.ipynb` — TF-IDF + One-vs-Rest + evaluación + similitud.
4. ⏳ Endpoint `relacionados` + sección en el detalle del blog.
