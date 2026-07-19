"""Ensambla sistema_recomendacion_posts.ipynb (metodología CRISP-DM, K-Means)."""
import os
import nbformat as nbf

nb = nbf.v4.new_notebook()
cells = []
def md(s):  cells.append(nbf.v4.new_markdown_cell(s))
def code(s): cells.append(nbf.v4.new_code_cell(s))

md("""# Sistema de Recomendación de Posts del Blog — NU★B Studio
### "Posts relacionados" con aprendizaje NO supervisado (K-Means)

Este cuaderno construye el sistema de **recomendación de posts relacionados** siguiendo la
metodología **CRISP-DM**. A diferencia del clasificador (supervisado), aquí el modelo es
**K-Means (no supervisado)**: agrupa los posts por tema sin conocer sus etiquetas, y las
recomendaciones salen del mismo grupo.

**Pipeline:** `Texto → TF-IDF → SVD (reduce dimensiones) → K-Means (agrupa) → Recomienda`
""")

# ============================ 1. COMPRENSIÓN ============================
md("# 1. Comprensión de los datos")
md("## 1.1 Carga de datos\nTraemos los posts con sus etiquetas desde Neon (con respaldo en CSV).")
code("""import os, re, warnings
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
warnings.filterwarnings("ignore")
sns.set_theme(style="whitegrid")
RANDOM_STATE = 42

BASE_DIR = os.getcwd()
CSV_PATH = os.path.join(BASE_DIR, "blog_posts_dataset.csv")
ENV_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", ".env"))

QUERY = '''
  SELECT p.id_post, p.titulo, COALESCE(p.extracto,'') AS extracto,
         COALESCE(p.contenido,'') AS contenido,
         string_agg(be.slug, '|' ORDER BY be.slug) AS etiquetas
  FROM blog_posts p
  JOIN blog_posts_etiquetas bpe ON bpe.id_post = p.id_post
  JOIN blog_etiquetas be ON be.id_blog_etiqueta = bpe.id_blog_etiqueta
  WHERE COALESCE(p.eliminado, false) = false
  GROUP BY p.id_post
'''
try:
    import psycopg2
    from dotenv import load_dotenv
    load_dotenv(ENV_PATH)
    conn = psycopg2.connect(host=os.environ["DB_HOST"], user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"], dbname=os.environ["DB_NAME"],
        port=os.environ.get("DB_PORT","5432"), sslmode="require")
    df = pd.read_sql(QUERY, conn); conn.close()
    print(f"Cargado EN VIVO desde Neon: {len(df)} posts")
except Exception as e:
    print(f"Sin Neon ({type(e).__name__}); uso CSV de respaldo.")
    df = pd.read_csv(CSV_PATH)
    print(f"Cargado desde CSV: {len(df)} posts")

df["etiquetas"] = df["etiquetas"].apply(lambda s: s.split("|") if isinstance(s,str) and s else [])
print("\\n>>> ASÍ SE VE EL DATASET CRUDO (primeras filas):")
df.head()""")

md("## 1.2 Descripción de atributos")
code("""print("Dimensiones del dataset:", df.shape)
print("\\nColumnas y tipos:")
df.info()""")

md("## 1.3 Calidad de los datos")
code("""print("Valores nulos por columna:")
print(df.isnull().sum())
print("\\nTítulos duplicados:", df.titulo.duplicated().sum())
print("Contenidos duplicados:", df.contenido.duplicated().sum())
print("Posts sin etiquetas:", (df.etiquetas.map(len)==0).sum())""")

md("## 1.4 Análisis Exploratorio (EDA)\nEntendemos la distribución de etiquetas y la longitud de los textos.")
code("""from collections import Counter
df["n_etiquetas"] = df.etiquetas.map(len)
df["n_palabras"]  = (df.titulo+" "+df.contenido).str.split().map(len)

tag_counts = pd.Series(Counter(t for lst in df.etiquetas for t in lst)).sort_values()

fig, ax = plt.subplots(1, 3, figsize=(16,4))
tag_counts.plot.barh(ax=ax[0], color="#4C72B0"); ax[0].set_title("Posts por etiqueta")
df.n_etiquetas.value_counts().sort_index().plot.bar(ax=ax[1], color="#55A868"); ax[1].set_title("Etiquetas por post")
df.n_palabras.plot.hist(bins=20, ax=ax[2], color="#C44E52"); ax[2].set_title("Palabras por post")
plt.tight_layout(); plt.show()

print(f"Palabras por post: media {df.n_palabras.mean():.0f}, min {df.n_palabras.min()}, max {df.n_palabras.max()}")""")

# ============================ 2. PREPARACIÓN ============================
md("# 2. Preparación de los datos")
md("## 2.1 Limpieza del texto\nQuitamos el HTML y unimos **título + extracto + contenido** en un solo campo.")
code("""def limpiar_html(t):
    t = re.sub(r"<[^>]+>", " ", str(t))
    t = re.sub(r"&[a-z]+;", " ", t)
    t = re.sub(r"\\s+", " ", t)
    return t.strip().lower()

df["texto"] = (df.titulo.fillna("")+". "+df.extracto.fillna("")+". "+df.contenido.fillna("")).apply(limpiar_html)
print(">>> DATASET DESPUÉS DE LIMPIAR (columna 'texto' lista para el modelo):")
df[["id_post","titulo","texto"]].head()""")

# ============================ 3. TRANSFORMACIÓN ============================
md("""# 3. Selección y transformación de características

Aquí el texto se convierte en números. Dos pasos (ambos son *complementos*, no el modelo):
1. **TF-IDF** → texto a números (pesa las palabras características).
2. **SVD (LSA)** → comprime esos números a sus "conceptos" esenciales (como el PCA, pero para texto).""")
md("## 3.1 TF-IDF")
code("""from sklearn.feature_extraction.text import TfidfVectorizer

STOPWORDS_ES = ("a al algo algunas algunos ante antes como con contra cual cuando de del desde donde "
    "dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta estas este esto estos "
    "fue fueron ha hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos o os otra "
    "otras otro otros para pero poco por porque que quien se sea si sin sobre su sus tan te tiene "
    "tienen todo todos tu tus un una uno unas unos y ya").split()

tfidf = TfidfVectorizer(ngram_range=(1,2), min_df=2, max_features=5000, stop_words=STOPWORDS_ES)
X_tfidf = tfidf.fit_transform(df["texto"])
print(f">>> MATRIZ TF-IDF: {X_tfidf.shape[0]} posts x {X_tfidf.shape[1]} palabras")
print("   (dispersa: la mayoría son ceros)")
# peek: las 8 palabras con más peso del primer post
fila0 = X_tfidf[0].toarray()[0]
top = sorted(zip(tfidf.get_feature_names_out(), fila0), key=lambda x:x[1], reverse=True)[:8]
print(f"\\nPalabras con más peso en el post '{df.iloc[0].titulo}':")
for pal, peso in top:
    if peso>0: print(f"   {pal:<22} {peso:.3f}")""")

md("## 3.2 SVD / LSA — reducción de dimensiones\nComprimimos las miles de palabras a ~100 'conceptos', y vemos cuánta información conservamos.")
code("""from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import Normalizer
from sklearn.pipeline import make_pipeline

N_COMPONENTES = 100
svd = TruncatedSVD(n_components=N_COMPONENTES, random_state=RANDOM_STATE)
lsa = make_pipeline(svd, Normalizer(copy=False))
X_lsa = lsa.fit_transform(X_tfidf)

var = svd.explained_variance_ratio_.sum()
print(f">>> DATASET REDUCIDO: {X_lsa.shape[0]} posts x {X_lsa.shape[1]} conceptos")
print(f"   Varianza (información) conservada: {var:.1%}")

plt.figure(figsize=(7,4))
plt.plot(np.cumsum(svd.explained_variance_ratio_), color="#4C72B0")
plt.xlabel("nº de conceptos (componentes SVD)"); plt.ylabel("varianza acumulada")
plt.title("Cuánta información conservamos al reducir dimensiones"); plt.tight_layout(); plt.show()""")

# ============================ 4. MODELADO ============================
md("# 4. Modelado — K-Means (no supervisado)")
md("""## 4.1 Elección del número de grupos (k)
K-Means necesita saber cuántos grupos formar. Probamos varios **k** y elegimos con dos criterios:
- **Método del codo** (inercia): dónde deja de bajar fuerte.
- **Silhouette**: qué tan bien separados quedan los grupos (más alto = mejor).""")
code("""from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

ks = range(4, 16)
inercias, silhouettes = [], []
for k in ks:
    km = KMeans(n_clusters=k, random_state=RANDOM_STATE, n_init=10)
    labels = km.fit_predict(X_lsa)
    inercias.append(km.inertia_)
    silhouettes.append(silhouette_score(X_lsa, labels))

fig, ax = plt.subplots(1,2, figsize=(14,4))
ax[0].plot(list(ks), inercias, "o-", color="#4C72B0"); ax[0].set_title("Método del codo"); ax[0].set_xlabel("k"); ax[0].set_ylabel("inercia")
ax[1].plot(list(ks), silhouettes, "o-", color="#55A868"); ax[1].set_title("Silhouette (más alto = mejor)"); ax[1].set_xlabel("k")
plt.tight_layout(); plt.show()

K_OPTIMO = list(ks)[int(np.argmax(silhouettes))]
print(f">>> Mejor k según silhouette: {K_OPTIMO}  (silhouette={max(silhouettes):.3f})")""")

md("## 4.2 Entrenar K-Means con el k elegido\nEste es **el modelo**: aprende los grupos.")
code("""modelo_kmeans = KMeans(n_clusters=K_OPTIMO, random_state=RANDOM_STATE, n_init=10)
df["cluster"] = modelo_kmeans.fit_predict(X_lsa)
print(f">>> MODELO ENTRENADO: K-Means con {K_OPTIMO} grupos")
print("\\nCuántos posts quedaron en cada grupo:")
print(df.cluster.value_counts().sort_index())
print("\\n>>> DATASET CON SU GRUPO ASIGNADO:")
df[["id_post","titulo","etiquetas","cluster"]].head(10)""")

# ============================ 5. EVALUACIÓN ============================
md("# 5. Evaluación del modelo")
md("""## 5.1 ¿Los grupos tienen sentido? (coherencia con las etiquetas)
Como K-Means NO vio las etiquetas, revisamos si los grupos que formó **coinciden** con los temas reales.
Si cada grupo está dominado por unas pocas etiquetas → el modelo agrupó bien.""")
code("""from collections import Counter
print("Etiquetas dominantes en cada grupo:\\n")
resumen = []
for c in sorted(df.cluster.unique()):
    tags = Counter(t for lst in df[df.cluster==c].etiquetas for t in lst)
    top = ", ".join(f"{t}({n})" for t,n in tags.most_common(3))
    n_posts = (df.cluster==c).sum()
    resumen.append({"grupo": c, "posts": n_posts, "etiquetas dominantes": top})
pd.DataFrame(resumen)""")

md("## 5.2 Métrica global de calidad")
code("""sil = silhouette_score(X_lsa, df.cluster)
print(f"Silhouette score del modelo final: {sil:.3f}")
print("(rango -1 a 1; >0.1 ya indica estructura de grupos razonable en texto)")""")

md("## 5.3 Visualización de los grupos (2D)\nReducimos a 2 dimensiones solo para poder dibujar los grupos.")
code("""svd2d = TruncatedSVD(n_components=2, random_state=RANDOM_STATE)
coords = svd2d.fit_transform(X_tfidf)
plt.figure(figsize=(9,7))
sc = plt.scatter(coords[:,0], coords[:,1], c=df.cluster, cmap="tab20", s=40, alpha=0.8)
plt.title(f"Los {K_OPTIMO} grupos de posts que descubrió K-Means")
plt.xlabel("componente 1"); plt.ylabel("componente 2")
plt.colorbar(sc, label="grupo"); plt.tight_layout(); plt.show()""")

# ============================ 6. RECOMENDACIÓN ============================
md("""# 6. Recomendación (uso del modelo)

Para recomendar los relacionados de un post: buscamos su **grupo (K-Means)** y devolvemos los
otros posts del mismo grupo, **ordenados por cercanía** (similitud coseno en el espacio LSA).""")
code("""from sklearn.metrics.pairwise import cosine_similarity

def recomendar(idx, n=4):
    grupo = df.iloc[idx].cluster
    mismos = df[(df.cluster==grupo) & (df.index!=idx)].index
    if len(mismos)==0: return []
    sims = cosine_similarity(X_lsa[idx].reshape(1,-1), X_lsa[mismos])[0]
    orden = mismos[np.argsort(sims)[::-1][:n]]
    return [(df.loc[j].titulo, df.loc[j].etiquetas, round(float(cosine_similarity(X_lsa[idx].reshape(1,-1), X_lsa[j].reshape(1,-1))[0][0]),3)) for j in orden]

i = 0
print(f"POST BASE: {df.iloc[i].titulo}  |  grupo {df.iloc[i].cluster}  |  {df.iloc[i].etiquetas}\\n")
print("Recomendados (mismo grupo, ordenados por cercanía):")
for tit, tags, s in recomendar(i):
    print(f"   [{s}] {tit[:45]:<45} {tags}")""")

# ============================ 7. DESPLIEGUE ============================
md("""# 7. Despliegue del modelo

El modelo entrenado se guarda y sus recomendaciones se precalculan en una tabla que la app consume.""")
code("""import joblib

# Guardar el modelo completo (TF-IDF + LSA + K-Means)
joblib.dump({"tfidf": tfidf, "lsa": lsa, "kmeans": modelo_kmeans, "k": K_OPTIMO},
            os.path.join(BASE_DIR, "modelo_recomendacion.joblib"))
print("Modelo guardado: modelo_recomendacion.joblib")

# Generar la tabla de recomendaciones (top-4 por post): mismo grupo, ordenados por cercanía
registros = []
for i in range(len(df)):
    grupo = df.iloc[i].cluster
    mismos = df[(df.cluster==grupo) & (df.index!=i)].index
    if len(mismos)==0: continue
    sims = cosine_similarity(X_lsa[i].reshape(1,-1), X_lsa[mismos])[0]
    for j, s in sorted(zip(mismos, sims), key=lambda x:x[1], reverse=True)[:4]:
        registros.append({"id_post": int(df.iloc[i].id_post),
                          "id_post_relacionado": int(df.loc[j].id_post),
                          "score": round(float(s),4)})
rec_df = pd.DataFrame(registros)
rec_df.to_csv(os.path.join(BASE_DIR, "recomendaciones_kmeans.csv"), index=False)
print(f"Tabla de recomendaciones generada: {len(rec_df)} pares para {rec_df.id_post.nunique()} posts")
rec_df.head()""")

# ============================ 8. CONCLUSIONES ============================
md("""# 8. Conclusiones

- **Modelo:** K-Means (no supervisado) agrupó los posts por tema **sin conocer sus etiquetas**.
- **Validación:** los grupos coinciden con las etiquetas reales (§5.1) → el modelo capturó los temas.
- **Recomendación:** para cada post, los relacionados salen de su mismo grupo, ordenados por cercanía.
- **Pareja completa de ML del proyecto:**
  - Clasificación de etiquetas → **Regresión Logística (supervisado)**
  - Recomendación de posts → **K-Means (no supervisado)**
""")

nb["cells"] = cells
nb.metadata = {
    "kernelspec": {"display_name": "Python (NUB blog ML)", "language": "python", "name": "nub-blog-ml"},
    "language_info": {"name": "python"},
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sistema_recomendacion_posts.ipynb"), "w", encoding="utf-8") as f:
    nbf.write(nb, f)
print("Notebook escrito:", len(cells), "celdas")
