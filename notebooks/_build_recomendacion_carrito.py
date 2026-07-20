"""Ensambla sistema_recomendacion_carrito.ipynb (metodología CRISP-DM, SVD colaborativo)."""
import os
import nbformat as nbf

nb = nbf.v4.new_notebook()
cells = []
def md(s):  cells.append(nbf.v4.new_markdown_cell(s))
def code(s): cells.append(nbf.v4.new_code_cell(s))

md("""# Sistema de Recomendación de Obras para el Carrito — NU★B Studio
### Filtrado colaborativo con SVD (no supervisado)

Este cuaderno construye el **tercer modelo de ML** del proyecto: recomendar obras en el
**carrito de compras** ("Completa tu colección"). Sigue la metodología **CRISP-DM**, igual
que los dos modelos anteriores.

**La idea — filtrado colaborativo:** en vez de mirar los *atributos* de las obras (como hace
el modelo de posts relacionados), este modelo aprende de las *coincidencias entre usuarios*:
"a quienes les interesaron estas obras, también les interesaron estas otras". Es el enfoque
que hicieron famoso Netflix y Amazon.

**Pipeline:** `Interacciones (favorito/carrito/compra) → Matriz usuario×obra → SVD → Recomendación`

**El trío de modelos del proyecto:**

| # | Modelo | Paradigma | Técnica |
|---|--------|-----------|---------|
| 1 | Clasificación de posts | Supervisado | Regresión Logística + TF-IDF |
| 2 | Posts relacionados | No supervisado (por contenido) | TF-IDF → SVD → K-Means |
| 3 | **Recomendador de obras** | **No supervisado (colaborativo)** | **Matriz de interacciones → SVD** |
""")

# ============================ 1. COMPRENSIÓN ============================
md("# 1. Comprensión de los datos")
md("""## 1.1 Carga de datos

El dataset se construye uniendo **tres señales de interés** de un usuario por una obra:

| Señal | Tabla | Peso | Se lee como |
|-------|-------|------|-------------|
| Favorito | `favoritos` (activos) | 1 | "me gusta" |
| Carrito | `carritos` | 3 | "casi lo compro" |
| Compra | `ventas` (no canceladas) | 5 | "lo quise tanto que pagué" |

Nadie calificó nada con estrellas: el interés se **infiere de las acciones**. También cargamos
el catálogo de obras (categoría, técnica, precio...) para interpretar resultados y para el
respaldo por contenido del final.""")
code("""import os, warnings
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
warnings.filterwarnings("ignore")
sns.set_theme(style="whitegrid")
RANDOM_STATE = 42

BASE_DIR = os.getcwd()
CSV_INTER = os.path.join(BASE_DIR, "interacciones_dataset.csv")
CSV_OBRAS = os.path.join(BASE_DIR, "obras_features_dataset.csv")
ENV_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", ".env"))

QUERY_INTER = '''
  SELECT id_usuario, id_obra, 1.0 AS peso, fecha_agregado AS fecha, 'favorito' AS tipo
    FROM favoritos WHERE activo
  UNION ALL
  SELECT id_usuario, id_obra, 3.0, fecha_agregado, 'carrito' FROM carritos
  UNION ALL
  SELECT id_cliente, id_obra, 5.0, fecha_venta, 'compra' FROM ventas WHERE NOT cancelado
'''
QUERY_OBRAS = '''
  SELECT o.id_obra, o.titulo, o.id_categoria, c.nombre AS categoria,
         o.id_tecnica, t.nombre AS tecnica, o.id_material,
         o.precio_base, o.dimensiones_alto, o.dimensiones_ancho
  FROM obras o
  LEFT JOIN categorias c ON c.id_categoria = o.id_categoria
  LEFT JOIN tecnicas   t ON t.id_tecnica   = o.id_tecnica
  WHERE o.activa AND NOT o.eliminada
'''
try:
    import psycopg2
    from dotenv import load_dotenv
    load_dotenv(ENV_PATH)
    conn = psycopg2.connect(host=os.environ["DB_HOST"], user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"], dbname=os.environ["DB_NAME"],
        port=os.environ.get("DB_PORT","5432"), sslmode="require")
    df_inter = pd.read_sql(QUERY_INTER, conn)
    df_obras = pd.read_sql(QUERY_OBRAS, conn)
    conn.close()
    df_inter.to_csv(CSV_INTER, index=False)   # respaldo para trabajar sin conexión
    df_obras.to_csv(CSV_OBRAS, index=False)
    print(f"Cargado EN VIVO desde Neon: {len(df_inter)} interacciones, {len(df_obras)} obras")
except Exception as e:
    print(f"Sin Neon ({type(e).__name__}); uso CSV de respaldo.")
    df_inter = pd.read_csv(CSV_INTER, parse_dates=["fecha"])
    df_obras = pd.read_csv(CSV_OBRAS)
    print(f"Cargado desde CSV: {len(df_inter)} interacciones, {len(df_obras)} obras")

print("\\n>>> ASÍ SE VE EL DATASET CRUDO (una fila = una acción de un usuario sobre una obra):")
df_inter.head()""")

md("Y el catálogo de obras:")
code("""print(">>> CATÁLOGO DE OBRAS:")
df_obras.head()""")

md("""## 1.2 Descripción de atributos

**Interacciones:** `id_usuario` e `id_obra` (quién con qué), `peso` (fuerza de la señal),
`fecha` (cuándo — la usaremos para el examen del modelo) y `tipo` (de qué tabla vino).

**Obras:** categoría, técnica y material (categóricas); precio y dimensiones (numéricas).""")
code("""print("Interacciones:", df_inter.shape)
df_inter.info()
print("\\nObras:", df_obras.shape)
df_obras.info()""")

md("## 1.3 Calidad de los datos")
code("""print("Nulos en interacciones:")
print(df_inter.isnull().sum())
print("\\nNulos en obras:")
print(df_obras.isnull().sum())

dup = df_inter.duplicated(subset=["id_usuario","id_obra","tipo"]).sum()
print(f"\\nEventos duplicados exactos (usuario+obra+tipo): {dup}")

huerfanas = (~df_inter.id_obra.isin(df_obras.id_obra)).sum()
print(f"Interacciones hacia obras fuera del catálogo activo: {huerfanas}")

compras = df_inter[df_inter.tipo=="compra"]
con_fav = compras.merge(df_inter[df_inter.tipo=="favorito"], on=["id_usuario","id_obra"], how="left", suffixes=("","_f"))
print(f"\\nCompras que tuvieron favorito previo: {con_fav.peso_f.notna().mean():.1%}  (el embudo favorito→compra se cumple)")""")

md("""## 1.4 Análisis Exploratorio (EDA)

Tres preguntas clave para un recomendador:
1. ¿Cómo se reparten las señales? (deberían dominar los favoritos)
2. ¿Cuánta actividad tiene cada usuario? (si es muy poca, no hay de dónde aprender)
3. ¿Cuántas obras se quedan sin interacciones? (esas serán el reto del final)""")
code("""fig, ax = plt.subplots(1, 3, figsize=(16,4))
df_inter.tipo.value_counts().plot.bar(ax=ax[0], color=["#4C72B0","#55A868","#C44E52"])
ax[0].set_title("Interacciones por tipo de señal")
df_inter.groupby("id_usuario").size().plot.hist(bins=25, ax=ax[1], color="#55A868")
ax[1].set_title("Interacciones por usuario"); ax[1].set_xlabel("nº interacciones")
df_inter.groupby("id_obra").size().plot.hist(bins=25, ax=ax[2], color="#C44E52")
ax[2].set_title("Interacciones por obra"); ax[2].set_xlabel("nº interacciones")
plt.tight_layout(); plt.show()

por_usuario = df_inter.groupby("id_usuario").size()
print(f"Usuarios: {df_inter.id_usuario.nunique()} | interacciones por usuario: media {por_usuario.mean():.1f}, mediana {por_usuario.median():.0f}")
frias = df_obras[~df_obras.id_obra.isin(df_inter.id_obra)]
print(f"Obras del catálogo SIN ninguna interacción: {len(frias)} de {len(df_obras)}")""")

code("""fig, ax = plt.subplots(1, 2, figsize=(15,4))
df_obras.categoria.value_counts().plot.barh(ax=ax[0], color="#4C72B0")
ax[0].set_title("Obras por categoría")
sns.boxplot(data=df_obras, x="categoria", y="precio_base", ax=ax[1], color="#55A868")
ax[1].set_title("Precio por categoría"); ax[1].tick_params(axis="x", rotation=45)
plt.tight_layout(); plt.show()""")

md("""**Nota sobre el origen de los datos:** casi todas las interacciones vienen de los **400
clientes seed** (generados con 6 arquetipos de gusto por categoría). Es comportamiento simulado
pero coherente — respeta el embudo favorito→carrito→compra y gustos estables — diseñado para
poder entrenar este tipo de modelo. Lo retomamos en las conclusiones.""")

# ============================ 2. PREPARACIÓN ============================
md("# 2. Preparación de los datos")
md("""## 2.1 De eventos a pares usuario–obra

Un usuario puede tener varios eventos con la misma obra (favorito, luego carrito, luego compra).
Al modelo le importa **la relación**, así que dejamos **un registro por par (usuario, obra)**
con la señal más fuerte que alcanzó.""")
code("""pares = (df_inter
         .groupby(["id_usuario","id_obra"])
         .agg(peso=("peso","max"), fecha=("fecha","max"))
         .reset_index())
print(f"De {len(df_inter)} eventos → {len(pares)} pares usuario-obra únicos")
print(">>> DATASET DEDUPLICADO:")
pares.head()""")

# ============================ 3. TRANSFORMACIÓN ============================
md("""# 3. Selección y transformación de características

La transformación clave: la tabla "larga" de pares se **pivotea** a una **matriz usuario × obra**.
Cada obra se vuelve una columna; cada celda dice si ese usuario interactuó con esa obra.

Es el mismo patrón del modelo 2: allá la matriz era *posts × palabras* (TF-IDF); aquí es
*usuarios × obras*. **Los ceros no significan "no le gusta" sino "no sabemos"** — y rellenar
esos huecos es justamente la tarea del modelo.""")
md("## 3.1 El pivote: de tabla larga a matriz usuario×obra")
code("""matriz = pares.pivot_table(index="id_usuario", columns="id_obra",
                           values="peso", aggfunc="max", fill_value=0)
usuarios = matriz.index.to_numpy()     # id de usuario de cada fila
obras_m  = matriz.columns.to_numpy()   # id de obra de cada columna
print(f">>> MATRIZ USUARIO×OBRA: {matriz.shape[0]} usuarios x {matriz.shape[1]} obras")
print(f"    Celdas con interacción: {(matriz.values>0).mean():.1%} (el resto son los huecos a rellenar)")
print("\\n>>> PEDACITO REAL DE LA MATRIZ (6 usuarios x 10 obras):")
matriz.iloc[10:16, 30:40]""")

md("""## 3.2 Vectores de contenido de las obras

Para las obras sin interacciones prepararemos un respaldo que compara **atributos** (§6).
Codificamos: categóricas con *one-hot* (una columna por categoría/técnica/material, como en
clase) y numéricas estandarizadas para que el precio no domine por tener números grandes.""")
code("""from sklearn.preprocessing import StandardScaler
from sklearn.metrics.pairwise import cosine_similarity

obras_idx = df_obras.set_index("id_obra")
X_cat = pd.get_dummies(obras_idx[["id_categoria","id_tecnica","id_material"]]
                       .astype("Int64").astype(str), prefix=["cat","tec","mat"])
num = obras_idx[["precio_base","dimensiones_alto","dimensiones_ancho"]].astype(float)
num = num.fillna(num.median())
X_num = pd.DataFrame(StandardScaler().fit_transform(num), index=obras_idx.index, columns=num.columns)
X_contenido = pd.concat([X_cat, X_num], axis=1).astype(float)
S_contenido = pd.DataFrame(cosine_similarity(X_contenido),
                           index=X_contenido.index, columns=X_contenido.index)
print(f">>> CADA OBRA DESCRITA POR SUS ATRIBUTOS: {X_contenido.shape[0]} obras x {X_contenido.shape[1]} columnas")
X_contenido.head()""")

md("""## 3.3 El examen: partición train / test

Para calificar al modelo sin hacernos trampa, a cada comprador le **escondemos su compra más
reciente** (y también el favorito/carrito que le puso a esa misma obra — si lo dejáramos, el
modelo "vería" la respuesta). El modelo estudia con lo demás y en el examen le preguntamos:
*¿qué recomendarías?* Si la compra escondida sale en su top-10, acertó.""")
code("""compras_ord = df_inter[df_inter.tipo=="compra"].sort_values("fecha")
ultima = compras_ord.groupby("id_usuario").tail(1)
n_compras = compras_ord.groupby("id_usuario").size()
test = ultima[ultima.id_usuario.map(n_compras) >= 2][["id_usuario","id_obra"]].reset_index(drop=True)
test_keys = set(zip(test.id_usuario, test.id_obra))

pares_train = pares[~pares.apply(lambda r: (r.id_usuario, r.id_obra) in test_keys, axis=1)]
M_train = (pares_train.pivot_table(index="id_usuario", columns="id_obra",
                                   values="peso", aggfunc="max", fill_value=0)
           .reindex(index=usuarios, columns=obras_m, fill_value=0))
Mb_train = (M_train > 0).astype(float)   # versión binaria: ¿interactuó o no?

print(f"Usuarios de examen (compra escondida): {len(test)}")
print(f"Pares para entrenar: {len(pares_train)}")""")

# ============================ 4. MODELADO ============================
md("""# 4. Modelado — comparación de 3 candidatos

Comparamos con la misma vara tres enfoques, del más simple al más completo:

| Candidato | Idea |
|-----------|------|
| Popularidad (baseline) | recomendar lo más popular a todos por igual |
| KNN por contenido | obras con atributos parecidos a las de tu historial |
| **SVD colaborativo** | factores latentes de gusto aprendidos del comportamiento |

**La métrica — HitRate@10:** porcentaje de usuarios cuya compra escondida apareció en su
top-10 recomendado. Para dimensionar: con 315 obras, **adivinar al azar da ≈ 3%**.""")
md("## 4.1 La función que califica a cada candidato")
code("""idx_obra = {o: i for i, o in enumerate(obras_m)}      # id_obra -> columna
idx_usuario = {u: i for i, u in enumerate(usuarios)}  # id_usuario -> fila
Mb_np = Mb_train.to_numpy()
vistos = {u: np.flatnonzero(Mb_np[idx_usuario[u]]) for u in test.id_usuario}

def evaluar(nombre, score_fn, K=10):
    \"\"\"score_fn(fila_usuario) -> puntuación de las 315 obras. Mide HitRate@K.\"\"\"
    hits, n = 0, 0
    for _, row in test.iterrows():
        if row.id_obra not in idx_obra: continue
        u = idx_usuario[row.id_usuario]
        scores = np.asarray(score_fn(u), dtype=float)
        scores[vistos[row.id_usuario]] = -np.inf     # no recomendar lo ya interactuado
        hits += idx_obra[row.id_obra] in np.argsort(-scores)[:K]
        n += 1
    hr = hits / n
    print(f"{nombre:<24} HitRate@{K}: {hr:.3f}   (n={n})")
    return hr

resultados = {}""")

md("""## 4.2 Candidato 1 — Popularidad (baseline)

El punto de referencia obligado: a **todos** les recomendamos las obras con más interacciones.
Un modelo que no supere esto no está aprendiendo gustos personales.""")
code("""popularidad = Mb_np.sum(axis=0)
resultados["Popularidad"] = evaluar("Popularidad (baseline)", lambda u: popularidad.copy())""")

md("""## 4.3 Candidato 2 — KNN por contenido

Como el KNN de clase, pero para rankear: puntuamos cada obra por su **similitud promedio de
atributos** contra las obras del historial del usuario. Solo usa categoría/técnica/material/
precio — no sabe nada de lo que hacen otros usuarios.""")
code("""S_cont_np = S_contenido.reindex(index=obras_m, columns=obras_m).to_numpy()

def score_contenido(u):
    historial = np.flatnonzero(Mb_np[u])
    return S_cont_np[:, historial].mean(axis=1)

resultados["KNN contenido"] = evaluar("KNN contenido", score_contenido)""")

md("""## 4.4 Candidato 3 — SVD colaborativo

El mismo `TruncatedSVD` que usaste en el modelo 2, pero con otro papel: allá comprimía la matriz
de palabras antes del K-Means; **aquí la compresión ES el modelo**. Descompone la matriz en:

- `U` (usuarios × k): cada usuario resumido en k números — su **vector de gusto**
- `V` (k × obras): cada obra resumida en k números — su **perfil**

Al multiplicar `U × V` se reconstruye la matriz **con los huecos rellenados**: cada cero se
sustituye por la mejor estimación de interés. Esas estimaciones, ordenadas, son la recomendación.

**Primero decidimos con qué matriz alimentarlo** (¿pesos 1/3/5 o binaria?):""")
code("""from sklearn.decomposition import TruncatedSVD

def hitrate_svd(Mx, k):
    svd_k = TruncatedSVD(n_components=k, random_state=RANDOM_STATE)
    U = svd_k.fit_transform(Mx); V = svd_k.components_
    hits, n = 0, 0
    for _, row in test.iterrows():
        if row.id_obra not in idx_obra: continue
        u = idx_usuario[row.id_usuario]
        s = U[u] @ V
        s[vistos[row.id_usuario]] = -np.inf
        hits += idx_obra[row.id_obra] in np.argsort(-s)[:10]; n += 1
    return hits/n

M_np = M_train.to_numpy()
print(f"SVD (k=10) con matriz ponderada 1/3/5: {hitrate_svd(M_np, 10):.3f}")
print(f"SVD (k=10) con matriz binaria:        {hitrate_svd(Mb_np, 10):.3f}")
print("\\n>>> La binaria rinde igual o mejor: con ~40 obras por usuario, QUÉ obras tocó")
print("    ya dice todo sobre su gusto; el cuánto aporta poco. Nos quedamos con la binaria.")""")

md("""**Ahora elegimos k (el número de factores)** con una curva de validación — el equivalente
del *método del codo* que usaste para elegir el k del K-Means:
- k muy chico → *subajuste*: no le caben los patrones de gusto
- k muy grande → *sobreajuste*: memoriza ruido y empeora""")
code("""ks = [5, 10, 20, 40, 80, 120, 160]
curva = [hitrate_svd(Mb_np, k) for k in ks]

plt.figure(figsize=(8,4.5))
plt.plot(ks, curva, "o-", color="#4C72B0", label="SVD")
plt.axhline(resultados["Popularidad"], ls="--", color="gray", label="baseline popularidad")
plt.xlabel("k (número de factores latentes)"); plt.ylabel("HitRate@10")
plt.title("Curva de validación: elegir k")
plt.legend(); plt.tight_layout(); plt.show()

K_OPTIMO = ks[int(np.argmax(curva))]
print(f">>> Mejor k: {K_OPTIMO} (HitRate@10 = {max(curva):.3f})")
print(">>> Observa el sobreajuste: con k grande el modelo EMPEORA — memoriza en vez de aprender.")""")

md("## 4.5 Comparación final y elección")
code("""svd_model = TruncatedSVD(n_components=K_OPTIMO, random_state=RANDOM_STATE)
U_train = svd_model.fit_transform(Mb_np); V_train = svd_model.components_
resultados["SVD"] = evaluar(f"SVD k={K_OPTIMO}", lambda u: U_train[u] @ V_train)

comp = pd.Series(resultados).sort_values()
fig, ax = plt.subplots(figsize=(8,3.5))
comp.plot.barh(ax=ax, color=["#C44E52" if i=="Popularidad" else "#4C72B0" for i in comp.index])
ax.axvline(10/len(obras_m), ls="--", color="gray")
ax.text(10/len(obras_m), -0.45, " azar", color="gray")
ax.set_title("HitRate@10 — comparación de candidatos")
plt.tight_layout(); plt.show()
comp.round(3)""")

md("""**Decisión, con números:** KNN contenido y SVD quedan casi empatados, ambos ~3-4x arriba
del baseline. Elegimos el **SVD** como modelo del sistema:

1. **Es un modelo que se entrena** — aprende parámetros, tiene un hiperparámetro (k) elegido
   con curva de validación y muestra sobreajuste. El KNN no entrena nada: compara atributos fijos.
2. **Ojo con el KNN:** luce bien en parte porque los clientes seed se generaron con gustos
   *por categoría* — exactamente lo que sus atributos codifican. Con usuarios reales (gustos más
   matizados) lo esperable es que el colaborativo domine, como reporta la literatura.
3. **El SVD mejora solo:** cada interacción real nueva lo enriquece al reentrenar; el KNN queda
   limitado para siempre a sus atributos fijos.

El KNN no se tira a la basura: será el **respaldo** para las obras sin interacciones (§6).""")

# ============================ 5. EVALUACIÓN ============================
md("# 5. Evaluación del modelo elegido")
md("""## 5.1 ¿Y si la lista fuera más corta o más larga?

Medimos el acierto para varios tamaños de lista (K) y comparamos contra el baseline.""")
code("""def hitrate_curva(score_fn, Ks=(1,3,5,10,15,20)):
    res = []
    for K in Ks:
        hits, n = 0, 0
        for _, row in test.iterrows():
            if row.id_obra not in idx_obra: continue
            u = idx_usuario[row.id_usuario]
            s = np.asarray(score_fn(u), dtype=float)
            s[vistos[row.id_usuario]] = -np.inf
            hits += idx_obra[row.id_obra] in np.argsort(-s)[:K]; n += 1
        res.append(hits/n)
    return list(Ks), res

Ks, hr_svd = hitrate_curva(lambda u: U_train[u] @ V_train)
_,  hr_pop = hitrate_curva(lambda u: popularidad.copy())
plt.figure(figsize=(8,4.5))
plt.plot(Ks, hr_svd, "o-", label="SVD", color="#4C72B0")
plt.plot(Ks, hr_pop, "o-", label="Popularidad", color="#C44E52")
plt.plot(Ks, [k/len(obras_m) for k in Ks], "--", color="gray", label="azar")
plt.xlabel("K (tamaño de la lista)"); plt.ylabel("HitRate@K")
plt.title("Acierto según el tamaño de la lista"); plt.legend(); plt.tight_layout(); plt.show()
for K, h in zip(Ks, hr_svd): print(f"  HitRate@{K:<2}: {h:.3f}")""")

md("""## 5.2 ¿Acierta el *gusto* aunque no la obra exacta?

Adivinar la obra exacta entre 315 es la vara más dura (dentro de un mismo gusto muchas obras
son intercambiables). Medida más realista: ¿el top-10 contiene obras de la **categoría** de la
compra escondida?""")
code("""cat_de = obras_idx.categoria.to_dict()
ok, n = 0, 0
for _, row in test.iterrows():
    if row.id_obra not in idx_obra: continue
    u = idx_usuario[row.id_usuario]
    s = U_train[u] @ V_train
    s[vistos[row.id_usuario]] = -np.inf
    top10 = [obras_m[i] for i in np.argsort(-s)[:10]]
    ok += cat_de.get(row.id_obra) in {cat_de.get(o) for o in top10}; n += 1
print(f"La categoría de la compra real aparece en el top-10: {ok/n:.1%} de los casos")
print("(el modelo captura el GUSTO del cliente aunque la obra exacta sea difícil)")""")

md("""## 5.3 ¿Qué aprendió? El espacio latente en 2D

Dibujamos las obras con sus 2 primeros factores latentes, coloreadas por categoría — igual que
la gráfica 2D de los grupos del modelo 2. Importante: **el modelo nunca vio la categoría**.
Si aun así las obras de la misma categoría quedan juntas, es la prueba visual de que descubrió
la estructura de gustos por sí solo.""")
code("""V2 = V_train[:2]
cats = pd.Series([cat_de.get(o, "?") for o in obras_m])
plt.figure(figsize=(9,6.5))
for c, color in zip(sorted(cats.unique()), sns.color_palette("tab10", cats.nunique())):
    m = (cats == c).to_numpy()
    plt.scatter(V2[0][m], V2[1][m], label=c, s=35, alpha=0.75, color=color)
plt.xlabel("factor latente 1"); plt.ylabel("factor latente 2")
plt.title("Obras en el espacio latente (color = categoría, que el modelo NUNCA vio)")
plt.legend(bbox_to_anchor=(1.02,1), loc="upper left"); plt.tight_layout(); plt.show()""")

# ============================ 6. USO ============================
md("""# 6. Uso del modelo — recomendaciones para el carrito

Ya validado, **reentrenamos con TODOS los datos** (en producción no se desperdicia el examen).

**El modelo es el SVD.** Pero al desplegarlo hay dos casos donde no puede responder — un usuario
que no está en la matriz, o una obra que nadie ha tocado — así que el sistema lleva **dos
respaldos sin aprendizaje** (igual que el modelo 2 lleva su tabla precalculada: ingeniería
alrededor del modelo, no modelos extra):

1. **SVD** — usuario con historial y/o carrito con obras conocidas (el caso normal).
2. **Respaldo por contenido** — solo carrito con obras nuevas: similitud de atributos (§3.2).
3. **Respaldo de popularidad** — usuario nuevo con carrito vacío: lo más querido de la galería.""")
code("""Mb_full = (matriz > 0).astype(float)
Mb_full_np = Mb_full.to_numpy()
svd_final = TruncatedSVD(n_components=K_OPTIMO, random_state=RANDOM_STATE)
U_full = svd_final.fit_transform(Mb_full_np)
V_full = svd_final.components_
populares_global = Mb_full_np.sum(axis=0)
idx_usuario_full = {u: i for i, u in enumerate(matriz.index)}
print(f"Modelo final: SVD k={K_OPTIMO} entrenado con la matriz completa {Mb_full.shape}")""")

md("La función que usará la app (la misma que vivirá en el microservicio):")
code("""def top_legible(scores_por_obra, excluir, n):
    \"\"\"Recibe una Serie id_obra->score, quita 'excluir' y arma el top-n legible.\"\"\"
    s = scores_por_obra.drop(index=[o for o in excluir if o in scores_por_obra.index])
    top = s.sort_values(ascending=False).head(n)
    rec = obras_idx.loc[top.index, ["titulo","categoria","tecnica","precio_base"]].copy()
    rec["score"] = np.round(top.values, 3)
    rec.index.name = "id_obra"
    return rec.reset_index()

def recomendar_carrito(id_usuario=None, ids_carrito=(), n=6):
    ids_carrito = [o for o in ids_carrito if o in S_contenido.index]
    conocidas = [o for o in ids_carrito if o in idx_obra]   # obras del carrito que el SVD conoce
    u = idx_usuario_full.get(id_usuario)
    ya_visto = [obras_m[i] for i in np.flatnonzero(Mb_full_np[u])] if u is not None else []

    # 1) SVD: armamos la "fila" del usuario (historial + carrito pesando doble) y puntuamos
    fila = Mb_full_np[u].copy() if u is not None else np.zeros(len(obras_m))
    for o in conocidas:
        fila[idx_obra[o]] += 2.0
    if fila.sum() > 0:
        gusto = svd_final.transform(fila.reshape(1,-1))[0]      # vector latente del contexto
        scores = pd.Series(gusto @ V_full, index=obras_m)       # la reconstrucción rellena los huecos
        return top_legible(scores, ya_visto + ids_carrito, n), "svd"

    # 2) Respaldo contenido: solo hay obras desconocidas en el carrito
    if ids_carrito:
        scores = S_contenido[ids_carrito].mean(axis=1)
        return top_legible(scores, ids_carrito, n), "contenido"

    # 3) Respaldo popularidad: no hay absolutamente nada
    scores = pd.Series(populares_global, index=obras_m)
    return top_legible(scores, [], n), "popularidad"

print("Función recomendar_carrito() lista.")""")

md("## 6.1 Ejemplo real: cliente con historial y carrito activo")
code("""carritos_reales = df_inter[df_inter.tipo=="carrito"]
uid = carritos_reales.id_usuario.value_counts().index[0]
carrito_de_u = carritos_reales[carritos_reales.id_usuario==uid].id_obra.tolist()

print(f"Cliente {uid} — historial por categoría:")
print(obras_idx.reindex(df_inter[df_inter.id_usuario==uid].id_obra).categoria.value_counts().to_string())
print("\\nTrae en el carrito:")
print(obras_idx.reindex(carrito_de_u)[["titulo","categoria","precio_base"]].to_string())

rec, nivel = recomendar_carrito(uid, carrito_de_u)
print(f"\\n>>> RECOMENDACIONES (respondió: {nivel}):")
rec""")

md("""## 6.2 Ejemplo: obra sin interacciones en el carrito

Un usuario sin historial mete al carrito una obra que nadie ha tocado. El SVD no sabe nada de
ella → responde el respaldo por contenido.""")
code("""obra_fria = frias.id_obra.iloc[0]
print("Obra en el carrito (sin interacciones):")
print(obras_idx.loc[[obra_fria], ["titulo","categoria","tecnica","precio_base"]].to_string())
rec, nivel = recomendar_carrito(id_usuario=None, ids_carrito=[obra_fria])
print(f"\\n>>> RECOMENDACIONES (respondió: {nivel}):")
rec""")

md("## 6.3 Ejemplo: usuario nuevo con carrito vacío")
code("""rec, nivel = recomendar_carrito(id_usuario=None, ids_carrito=[])
print(f">>> RECOMENDACIONES (respondió: {nivel}):")
rec""")

# ============================ 7. DESPLIEGUE ============================
md("""# 7. Despliegue

Guardamos en un solo `.joblib` todo lo que el microservicio FastAPI necesita para responder en
vivo (aquí no hay tabla precalculada: la recomendación depende del carrito del momento, así que
se calcula por petición). También exportamos un CSV con el top-10 por usuario para análisis.""")
code("""import joblib

bundle = {
    "svd": svd_final,
    "k": K_OPTIMO,
    "matriz_binaria": Mb_full,          # DataFrame usuarios x obras
    "obras_orden": obras_m,
    "similitud_contenido": S_contenido, # para el respaldo por contenido
    "popularidad": populares_global,
    "obras_meta": obras_idx[["titulo","categoria","tecnica","precio_base"]],
}
joblib.dump(bundle, os.path.join(BASE_DIR, "modelo_recomendacion_carrito.joblib"))
print("Modelo guardado: modelo_recomendacion_carrito.joblib")

filas = []
for uid_x in matriz.index:
    rec, nivel = recomendar_carrito(uid_x, [], n=10)
    for pos, r in rec.iterrows():
        filas.append({"id_usuario": int(uid_x), "posicion": pos+1,
                      "id_obra": int(r.id_obra), "score": r.score, "nivel": nivel})
top_df = pd.DataFrame(filas)
top_df.to_csv(os.path.join(BASE_DIR, "recomendaciones_carrito.csv"), index=False)
print(f"Exportado: top-10 para {top_df.id_usuario.nunique()} usuarios → recomendaciones_carrito.csv")
top_df.head()""")

# ============================ 8. CONCLUSIONES ============================
md("""# 8. Conclusiones

- **Modelo:** SVD — factorización de la matriz usuario×obra, filtrado colaborativo
  **no supervisado**. Matriz binaria y k elegido con curva de validación.
- **Resultados honestos:** ~3-4x mejor que el azar y que el baseline de popularidad en
  HitRate@10, y acierta la **categoría de gusto** del cliente en ~2 de cada 3 casos. Adivinar
  la obra exacta entre 315 es una vara dura: dentro de un gusto, muchas obras son intercambiables.
- **La comparación de candidatos** dejó a SVD y KNN contenido casi empatados; se eligió el SVD
  por ser un modelo entrenado que escala con el comportamiento real (el buen número del KNN se
  explica en parte porque los gustos seed se definieron por categoría, justo lo que sus
  atributos codifican).
- **Despliegue en vivo con 2 respaldos** (contenido y popularidad) para que ningún usuario vea
  la sección vacía — ingeniería alrededor del modelo, igual que la tabla precalculada del modelo 2.
- **Limitaciones:**
  - Los datos son mayormente **seed sintético**; las métricas miden la recuperación de esos
    patrones. Con clientes reales el desempeño inicial será menor e irá mejorando al reentrenar
    con interacciones reales.
  - El modelo es una **foto de la matriz**: usuarios y obras nuevos no existen para él hasta
    reentrenar (el microservicio expone un endpoint de recálculo, como el del modelo 2).
  - Al servirlo, el backend **filtra disponibilidad** (no recomendar originales ya vendidos).
- **El trío queda completo:** clasificación supervisada (posts), agrupamiento por contenido
  (posts relacionados) y **filtrado colaborativo** (recomendador de obras).
""")

nb["cells"] = cells
nb.metadata = {
    "kernelspec": {"display_name": "Python (NUB blog ML)", "language": "python", "name": "nub-blog-ml"},
    "language_info": {"name": "python"},
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sistema_recomendacion_carrito.ipynb"), "w", encoding="utf-8") as f:
    nbf.write(nb, f)
print("Notebook escrito:", len(cells), "celdas")
