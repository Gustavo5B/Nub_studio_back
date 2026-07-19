"""Prueba rápida del microservicio ML (con el servicio ya corriendo en :8000)."""
import json, urllib.request

BASE = "http://127.0.0.1:8000"

def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))

def get(path):
    return json.load(urllib.request.urlopen(BASE + path))

print("=== 1) PREDECIR ETIQUETAS — texto de cerámica ===")
r = post("/predecir-etiquetas", {"texto":
    "En el taller modelamos el barro con el torno y luego cocemos la pieza de "
    "ceramica en el horno con esmaltes tradicionales de la Huasteca."})
for e in r["etiquetas_sugeridas"]:
    print(f"   · {e['etiqueta']:<12} {e['probabilidad']:.0%}")

print("\n=== 2) PREDECIR ETIQUETAS — texto de textil ===")
r = post("/predecir-etiquetas", {"texto":
    "El telar de cintura permite tejer fibras naturales y bordar figuras con "
    "hilos de colores, una tradicion textil de las artesanas."})
for e in r["etiquetas_sugeridas"]:
    print(f"   · {e['etiqueta']:<12} {e['probabilidad']:.0%}")

print("\n=== 3) RELACIONADOS a un borrador (texto libre, post que no existe) ===")
r = post("/relacionados-texto", {"texto":
    "fotografia del paisaje serrano con luz natural de la manana", "top": 4})
base_id = r["relacionados"][0]["id_post"]
for x in r["relacionados"]:
    print(f"   [{x['score']}] {x['titulo'][:45]:<45} {x['etiquetas']}")

print(f"\n=== 4) RELACIONADOS a un post EXISTENTE (id={base_id}) ===")
r = get(f"/relacionados/{base_id}")
for x in r["relacionados"]:
    print(f"   [{x['score']}] {x['titulo'][:45]:<45} {x['etiquetas']}")
