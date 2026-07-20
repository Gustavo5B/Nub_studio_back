"""
NU★B Studio — Microservicio de ML

  POST /predecir-etiquetas   → texto del post  → etiquetas sugeridas (Regresión Logística)
  GET  /relacionados/{id}    → post existente  → posts más parecidos (similitud coseno)
  POST /relacionados-texto   → texto libre     → posts parecidos a un borrador aún sin guardar
  POST /recomendaciones-carrito     → usuario + carrito → obras recomendadas (SVD colaborativo)
  POST /recalcular-recomendaciones  → reentrena el SVD con las interacciones actuales de Neon
  GET  /health               → estado del servicio

Un solo pipeline TF-IDF compartido: el clasificador se usa en /predecir-etiquetas,
la similitud coseno en /relacionados. El modelo (.joblib) se carga UNA vez al arrancar.

Arranque:
  ml_service/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
"""
import os
import re
from contextlib import asynccontextmanager

import numpy as np
import pandas as pd
import joblib
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import Normalizer
from sklearn.cluster import KMeans

# Stopwords en español (igual que el notebook) para el TF-IDF del recálculo
STOPWORDS_ES = (
    "a al algo algunas algunos ante antes como con contra cual cuando de del desde donde "
    "dos el ella ellas ellos en entre era erais eran eras es esa esas ese eso esos esta estas "
    "este esto estos fue fueron ha hasta hay la las le les lo los mas me mi mis mucho muy nada "
    "ni no nos nosotros o os otra otras otro otros para pero poco por porque que quien se sea "
    "sean si sin sobre su sus tan te tiene tienen todo todos tu tus un una uno unas unos y ya"
).split()

# --------------------------------------------------------------------------- #
# Rutas y configuración
# --------------------------------------------------------------------------- #
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.environ.get(
    "ML_MODEL_PATH", os.path.join(BASE_DIR, "..", "notebooks", "modelo_clasificacion.joblib"))
CARRITO_MODEL_PATH = os.environ.get(
    "ML_CARRITO_MODEL_PATH",
    os.path.join(BASE_DIR, "..", "notebooks", "modelo_recomendacion_carrito.joblib"))
CSV_PATH = os.path.join(BASE_DIR, "..", "notebooks", "blog_posts_dataset.csv")
ENV_PATH = os.path.join(BASE_DIR, "..", ".env")

# Estado global cargado al arrancar (modelo + corpus vectorizado en memoria)
STATE: dict = {}


def limpiar_html(texto: str) -> str:
    """Misma limpieza que la libreta: quita HTML y normaliza."""
    texto = re.sub(r"<[^>]+>", " ", str(texto))
    texto = re.sub(r"&[a-z]+;", " ", texto)
    texto = re.sub(r"\s+", " ", texto)
    return texto.strip().lower()


def cargar_corpus() -> pd.DataFrame:
    """Carga todos los posts (para 'relacionados'). Intenta Neon; si no, el CSV de respaldo."""
    query = """
      SELECT p.id_post, p.slug, p.titulo, COALESCE(p.extracto,'') AS extracto,
             COALESCE(p.contenido,'') AS contenido,
             string_agg(be.slug, '|' ORDER BY be.slug) AS etiquetas
      FROM blog_posts p
      JOIN blog_posts_etiquetas bpe ON bpe.id_post = p.id_post
      JOIN blog_etiquetas be ON be.id_blog_etiqueta = bpe.id_blog_etiqueta
      WHERE COALESCE(p.eliminado, false) = false
      GROUP BY p.id_post
    """
    try:
        import psycopg2
        from dotenv import load_dotenv
        load_dotenv(ENV_PATH)
        conn = psycopg2.connect(
            host=os.environ["DB_HOST"], user=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"], dbname=os.environ["DB_NAME"],
            port=os.environ.get("DB_PORT", "5432"), sslmode="require")
        df = pd.read_sql(query, conn)
        conn.close()
        print(f"[corpus] Cargado EN VIVO desde Neon: {len(df)} posts")
    except Exception as e:  # noqa: BLE001
        print(f"[corpus] Sin Neon ({type(e).__name__}); uso CSV de respaldo.")
        df = pd.read_csv(CSV_PATH)
        if "slug" not in df.columns:
            df["slug"] = df["id_post"].apply(lambda x: f"post-{x}")
        print(f"[corpus] Cargado desde CSV: {len(df)} posts")

    df["etiquetas"] = df["etiquetas"].apply(
        lambda s: s.split("|") if isinstance(s, str) and s else [])
    df["texto"] = (df["titulo"].fillna("") + ". " +
                   df.get("extracto", "").fillna("") + ". " +
                   df["contenido"].fillna("")).apply(limpiar_html)
    return df.reset_index(drop=True)


def _preparar_estado_carrito(bundle: dict) -> None:
    """Deja en STATE todo lo necesario para responder recomendaciones del carrito."""
    matriz = bundle["matriz_binaria"]          # DataFrame usuarios x obras (0/1)
    STATE["car_svd"] = bundle["svd"]
    STATE["car_k"] = bundle["k"]
    STATE["car_matriz"] = matriz.to_numpy()
    STATE["car_obras"] = np.asarray(bundle["obras_orden"])
    STATE["car_idx_obra"] = {int(o): i for i, o in enumerate(STATE["car_obras"])}
    STATE["car_idx_usuario"] = {int(u): i for i, u in enumerate(matriz.index)}
    STATE["car_V"] = bundle["svd"].components_
    STATE["car_sim_contenido"] = bundle["similitud_contenido"]  # DataFrame obras x obras
    STATE["car_popularidad"] = np.asarray(bundle["popularidad"], dtype=float)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Se ejecuta una vez al arrancar: carga modelo + vectoriza el corpus."""
    bundle = joblib.load(MODEL_PATH)
    STATE["vectorizer"] = bundle["vectorizer"]
    STATE["modelo"] = bundle["modelo"]
    STATE["clases"] = list(bundle["clases"])

    corpus = cargar_corpus()
    STATE["corpus"] = corpus
    # Vectoriza TODO el corpus una sola vez (matriz en memoria para el coseno)
    STATE["X"] = STATE["vectorizer"].transform(corpus["texto"])
    # Índice id_post -> fila
    STATE["idx_por_id"] = {int(pid): i for i, pid in enumerate(corpus["id_post"])}
    print(f"[startup] Modelo cargado. {len(STATE['clases'])} etiquetas, "
          f"{STATE['X'].shape[0]} posts vectorizados.")

    # Modelo del carrito: si el .joblib no existe, el servicio arranca igual
    # (solo quedan deshabilitados sus endpoints).
    try:
        _preparar_estado_carrito(joblib.load(CARRITO_MODEL_PATH))
        print(f"[startup] Recomendador de carrito cargado: SVD k={STATE['car_k']}, "
              f"matriz {STATE['car_matriz'].shape}.")
    except Exception as e:  # noqa: BLE001
        print(f"[startup] Recomendador de carrito NO disponible ({type(e).__name__}: {e}).")
    yield
    STATE.clear()


app = FastAPI(title="NU★B Studio — ML Service", version="1.0.0", lifespan=lifespan)

# CORS: permite que el frontend (o Express) lo llame en desarrollo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Modelos de entrada/salida
# --------------------------------------------------------------------------- #
class TextoIn(BaseModel):
    texto: str
    umbral: float = 0.30
    top: int = 4


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    return {
        "estado": "ok",
        "modelo_cargado": "modelo" in STATE,
        "etiquetas": STATE.get("clases", []),
        "posts_en_memoria": STATE["X"].shape[0] if "X" in STATE else 0,
        "recomendador_carrito": "car_svd" in STATE,
        "recomendador_k": STATE.get("car_k"),
    }


@app.post("/predecir-etiquetas")
def predecir_etiquetas(inp: TextoIn):
    """EL MODELO CORRE AQUÍ: vectoriza el texto y clasifica con Regresión Logística."""
    if not inp.texto.strip():
        raise HTTPException(status_code=400, detail="El texto está vacío.")
    v = STATE["vectorizer"].transform([limpiar_html(inp.texto)])
    probs = STATE["modelo"].predict_proba(v)[0]
    ranking = sorted(zip(STATE["clases"], probs), key=lambda x: x[1], reverse=True)

    elegidas = [{"etiqueta": c, "probabilidad": round(float(p), 4)}
                for c, p in ranking if p >= inp.umbral][:inp.top]
    if not elegidas:  # siempre devolver al menos la más probable
        c, p = ranking[0]
        elegidas = [{"etiqueta": c, "probabilidad": round(float(p), 4)}]

    return {
        "etiquetas_sugeridas": elegidas,
        "ranking_completo": [{"etiqueta": c, "probabilidad": round(float(p), 4)}
                             for c, p in ranking],
    }


def _relacionados_desde_vector(vec, excluir_idx=None, n=4):
    """Coseno EN VIVO del vector dado contra todo el corpus."""
    sims = cosine_similarity(vec, STATE["X"])[0]
    if excluir_idx is not None:
        sims[excluir_idx] = -1.0
    orden = np.argsort(sims)[::-1][:n]
    corpus = STATE["corpus"]
    return [{
        "id_post": int(corpus.iloc[j]["id_post"]),
        "slug": corpus.iloc[j]["slug"],
        "titulo": corpus.iloc[j]["titulo"],
        "etiquetas": corpus.iloc[j]["etiquetas"],
        "score": round(float(sims[j]), 4),
    } for j in orden]


@app.get("/relacionados/{id_post}")
def relacionados(id_post: int, n: int = 4):
    """EL MODELO CORRE AQUÍ: coseno del post contra todos, en vivo."""
    idx = STATE["idx_por_id"].get(int(id_post))
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Post {id_post} no encontrado.")
    vec = STATE["X"][idx]
    return {
        "id_post": id_post,
        "relacionados": _relacionados_desde_vector(vec, excluir_idx=idx, n=n),
    }


@app.post("/relacionados-texto")
def relacionados_texto(inp: TextoIn):
    """Relacionados a un borrador aún NO guardado (texto libre)."""
    if not inp.texto.strip():
        raise HTTPException(status_code=400, detail="El texto está vacío.")
    vec = STATE["vectorizer"].transform([limpiar_html(inp.texto)])
    return {"relacionados": _relacionados_desde_vector(vec, excluir_idx=None, n=inp.top)}


def _recalcular_y_guardar(top_n: int = 4, k: int = 7) -> dict:
    """Recalcula los posts relacionados de TODO el blog con el modelo NO SUPERVISADO
    (K-Means) y reescribe la tabla blog_posts_relacionados. Pipeline:
    TF-IDF → SVD (LSA) → K-Means agrupa por tema → relacionados = mismo grupo
    ordenados por cercanía. Incluye los posts recién publicados."""
    import psycopg2
    from psycopg2.extras import execute_values
    from dotenv import load_dotenv

    df = cargar_corpus()  # relee la BD → incluye los posts recién publicados
    if len(df) < 2:
        return {"posts": len(df), "pares": 0, "grupos": 0}

    # 1) TF-IDF fresco sobre el corpus actual (aprende vocabulario de posts nuevos)
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=5000, stop_words=STOPWORDS_ES)
    X_tfidf = vec.fit_transform(df["texto"])

    # 2) SVD/LSA: reduce dimensiones (nunca más que nº posts-1 ni nº términos-1)
    n_comp = max(2, min(100, X_tfidf.shape[1] - 1, X_tfidf.shape[0] - 1))
    svd = TruncatedSVD(n_components=n_comp, random_state=42)
    X_lsa = Normalizer(copy=False).fit_transform(svd.fit_transform(X_tfidf))

    # 3) K-Means: agrupa los posts por tema (no más grupos que posts)
    k_eff = max(2, min(k, len(df) - 1))
    kmeans = KMeans(n_clusters=k_eff, random_state=42, n_init=10)
    clusters = kmeans.fit_predict(X_lsa)

    # 4) Relacionados = posts del MISMO grupo, ordenados por cercanía (coseno en LSA)
    ids = [int(x) for x in df["id_post"]]
    filas = []
    for i in range(len(ids)):
        mismos = [j for j in range(len(ids)) if clusters[j] == clusters[i] and j != i]
        if not mismos:
            continue
        sims = cosine_similarity(X_lsa[i:i + 1], X_lsa[mismos])[0]
        for j, s in sorted(zip(mismos, sims), key=lambda x: x[1], reverse=True)[:top_n]:
            if s <= 0:
                continue
            filas.append((ids[i], ids[int(j)], round(float(s), 4)))

    load_dotenv(ENV_PATH)
    conn = psycopg2.connect(
        host=os.environ["DB_HOST"], user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"], dbname=os.environ["DB_NAME"],
        port=os.environ.get("DB_PORT", "5432"), sslmode="require")
    cur = conn.cursor()
    cur.execute("TRUNCATE blog_posts_relacionados")
    if filas:
        execute_values(
            cur,
            "INSERT INTO blog_posts_relacionados (id_post, id_post_relacionado, score) "
            "VALUES %s ON CONFLICT DO NOTHING",
            filas)
    conn.commit()
    cur.close()
    conn.close()

    # Refrescar memoria para el endpoint /relacionados en vivo
    STATE["corpus"] = df
    STATE["X"] = STATE["vectorizer"].transform(df["texto"])
    STATE["idx_por_id"] = {int(pid): idx for idx, pid in enumerate(df["id_post"])}

    return {"posts": len(ids), "pares": len(filas), "grupos": k_eff}


@app.post("/recalcular-relacionados")
def recalcular_relacionados():
    """Recalcula y reescribe la tabla de relacionados. Lo llama el backend
    (fire-and-forget) cuando se publica o edita un post."""
    try:
        r = _recalcular_y_guardar()
        return {"ok": True, **r}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Error al recalcular: {e}")


# --------------------------------------------------------------------------- #
# Recomendador de obras para el carrito (SVD colaborativo + respaldos)
# --------------------------------------------------------------------------- #
class CarritoIn(BaseModel):
    id_usuario: int | None = None
    ids_carrito: list[int] = []
    n: int = 6


def _top_carrito(scores, ids_orden, excluir, n):
    """scores alineado a ids_orden; regresa el top-n excluyendo lo indicado."""
    serie = pd.Series(np.asarray(scores, dtype=float), index=ids_orden)
    serie = serie.drop(index=[o for o in set(excluir) if o in serie.index])
    top = serie.sort_values(ascending=False).head(n)
    return [{"id_obra": int(o), "score": round(float(s), 4)} for o, s in top.items()]


@app.post("/recomendaciones-carrito")
def recomendaciones_carrito(inp: CarritoIn):
    """EL MODELO CORRE AQUÍ: SVD en vivo; si no puede (usuario/obras sin
    interacciones), responden los respaldos de contenido o popularidad."""
    if "car_svd" not in STATE:
        raise HTTPException(status_code=503, detail="Recomendador de carrito no cargado.")

    S_cont = STATE["car_sim_contenido"]
    ids_carrito = [int(o) for o in inp.ids_carrito if int(o) in S_cont.index]
    conocidas = [o for o in ids_carrito if o in STATE["car_idx_obra"]]
    u = STATE["car_idx_usuario"].get(inp.id_usuario) if inp.id_usuario is not None else None
    obras = STATE["car_obras"]

    # 1) SVD: fila = historial del usuario + carrito pesando doble
    fila = STATE["car_matriz"][u].copy() if u is not None else np.zeros(len(obras))
    ya_visto = [int(obras[i]) for i in np.flatnonzero(fila)]
    for o in conocidas:
        fila[STATE["car_idx_obra"][o]] += 2.0
    if fila.sum() > 0:
        gusto = STATE["car_svd"].transform(fila.reshape(1, -1))[0]
        scores = gusto @ STATE["car_V"]
        return {"nivel": "svd",
                "recomendaciones": _top_carrito(scores, obras, ya_visto + ids_carrito, inp.n)}

    # 2) Respaldo por contenido: solo obras desconocidas en el carrito
    if ids_carrito:
        scores = S_cont[ids_carrito].mean(axis=1)
        return {"nivel": "contenido",
                "recomendaciones": _top_carrito(scores.to_numpy(), S_cont.index.to_numpy(),
                                                ids_carrito, inp.n)}

    # 3) Respaldo de popularidad
    return {"nivel": "popularidad",
            "recomendaciones": _top_carrito(STATE["car_popularidad"], obras, [], inp.n)}


def _reentrenar_carrito() -> dict:
    """Relee las interacciones y el catálogo desde Neon, reentrena el SVD y
    actualiza memoria + .joblib. Mismo pipeline que el cuaderno."""
    import psycopg2
    from dotenv import load_dotenv
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics.pairwise import cosine_similarity as _cos

    load_dotenv(ENV_PATH)
    conn = psycopg2.connect(
        host=os.environ["DB_HOST"], user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"], dbname=os.environ["DB_NAME"],
        port=os.environ.get("DB_PORT", "5432"), sslmode="require")
    df_inter = pd.read_sql("""
        SELECT id_usuario, id_obra, 1.0 AS peso FROM favoritos WHERE activo
        UNION ALL SELECT id_usuario, id_obra, 3.0 FROM carritos
        UNION ALL SELECT id_cliente, id_obra, 5.0 FROM ventas WHERE NOT cancelado
    """, conn)
    df_obras = pd.read_sql("""
        SELECT o.id_obra, o.titulo, o.id_categoria, c.nombre AS categoria,
               o.id_tecnica, t.nombre AS tecnica, o.id_material,
               o.precio_base, o.dimensiones_alto, o.dimensiones_ancho
        FROM obras o
        LEFT JOIN categorias c ON c.id_categoria = o.id_categoria
        LEFT JOIN tecnicas   t ON t.id_tecnica   = o.id_tecnica
        WHERE o.activa AND NOT o.eliminada
    """, conn)
    conn.close()

    matriz = (df_inter.pivot_table(index="id_usuario", columns="id_obra",
                                   values="peso", aggfunc="max", fill_value=0) > 0).astype(float)

    k = int(STATE.get("car_k", 10))
    n_comp = max(2, min(k, matriz.shape[1] - 1, matriz.shape[0] - 1))
    svd = TruncatedSVD(n_components=n_comp, random_state=42)
    svd.fit(matriz.to_numpy())

    obras_idx = df_obras.set_index("id_obra")
    x_cat = pd.get_dummies(obras_idx[["id_categoria", "id_tecnica", "id_material"]]
                           .astype("Int64").astype(str), prefix=["cat", "tec", "mat"])
    num = obras_idx[["precio_base", "dimensiones_alto", "dimensiones_ancho"]].astype(float)
    num = num.fillna(num.median())
    x_num = pd.DataFrame(StandardScaler().fit_transform(num),
                         index=obras_idx.index, columns=num.columns)
    x_contenido = pd.concat([x_cat, x_num], axis=1).astype(float)
    s_contenido = pd.DataFrame(_cos(x_contenido),
                               index=x_contenido.index, columns=x_contenido.index)

    bundle = {
        "svd": svd,
        "k": n_comp,
        "matriz_binaria": matriz,
        "obras_orden": matriz.columns.to_numpy(),
        "similitud_contenido": s_contenido,
        "popularidad": matriz.to_numpy().sum(axis=0),
        "obras_meta": obras_idx[["titulo", "categoria", "tecnica", "precio_base"]],
    }
    joblib.dump(bundle, CARRITO_MODEL_PATH)
    _preparar_estado_carrito(bundle)
    return {"usuarios": int(matriz.shape[0]), "obras": int(matriz.shape[1]), "k": n_comp}


@app.post("/recalcular-recomendaciones")
def recalcular_recomendaciones():
    """Reentrena el recomendador del carrito con los datos actuales. Lo llama el
    backend (fire-and-forget) cuando se confirma una compra."""
    try:
        r = _reentrenar_carrito()
        return {"ok": True, **r}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Error al reentrenar: {e}")
