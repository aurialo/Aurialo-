#!/usr/bin/env python3
"""Guarda en la app las propuestas del «Cerebro Meta» para que Cristian las apruebe o descarte.

Uso:
    python3 scripts/propuestas_sync.py /tmp/propuestas.json

/tmp/propuestas.json:
{
  "resumen": "2–3 frases: qué está funcionando y hacia dónde ir esta semana",
  "estrategia": {"GLP1": "qué toca ahora con este producto, en 1–2 frases", "MENO": "...", "DRENAJE": "..."},
  "propuestas": [
    {"producto": "GLP1", "tipo": "Iterar | Nuevo ángulo | Nuevo formato | Escalar | Pausar | Oferta | Landing",
     "prioridad": "Alta | Media | Baja", "titulo": "frase corta",
     "que": "qué hacer exactamente (pasos concretos)", "porque": "datos que lo justifican (nuestros y/o competencia)",
     "origen": "Nuestros datos | Competencia | Ambos",
     "angulo": "Clienta Enfadada", "ident": "AlmacenVar2", "formato": "Vídeo UGC",
     "hooks": ["hook 1", "hook 2", "hook 3"], "guion": "guion breve o estructura (opcional)",
     "kpi": "cómo sabremos si funciona (p. ej. CPA < 9,22 € con 3 días y 5 compras)"}
  ]
}
Se guardan como crm:propuestas:<id> en estado «Pendiente». No repite una propuesta pendiente con el mismo título.
"""
import json, re, sys, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
TIPOS = ["Iterar", "Nuevo ángulo", "Nuevo formato", "Escalar", "Pausar", "Oferta", "Landing"]
PRIOR = ["Alta", "Media", "Baja"]


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()).strip()


def get_all(prefix):
    q = f"{URL}?select=valor&clave=like.{prefix}*&limit=2000"
    out = []
    for r in json.load(urllib.request.urlopen(urllib.request.Request(q, headers=H), timeout=60)):
        v = r["valor"]
        try: out.append(json.loads(v) if isinstance(v, str) else v)
        except Exception: pass
    return out


def put(clave, valor):
    now = datetime.now(timezone.utc).isoformat()
    body = json.dumps([{"clave": clave, "valor": json.dumps(valor, ensure_ascii=False), "actualizado": now}]).encode()
    urllib.request.urlopen(urllib.request.Request(URL, data=body, method="POST", headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}), timeout=30).read()


def main():
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    ahora = datetime.now(ZoneInfo("Europe/Madrid"))
    hoy = ahora.date().isoformat()
    previas = get_all("crm:propuestas:")
    pend = {norm(p.get("titulo")) for p in previas if p.get("estado") == "Pendiente"}
    nuevas, saltadas = 0, 0
    for i, p in enumerate(d.get("propuestas", []), 1):
        if not p.get("titulo") or not p.get("producto"):
            saltadas += 1; continue
        if norm(p["titulo"]) in pend:
            saltadas += 1; continue
        tipo = p.get("tipo") if p.get("tipo") in TIPOS else next((t for t in TIPOS if norm(t) in norm(p.get("tipo"))), "Nuevo ángulo")
        rec = {"id": f"cer_{ahora.strftime('%Y%m%d%H%M')}_{i}", "fecha": ahora.isoformat(), "producto": p["producto"].upper(), "tipo": tipo,
               "prioridad": p.get("prioridad") if p.get("prioridad") in PRIOR else "Media", "titulo": p["titulo"].strip()[:140],
               "que": p.get("que", ""), "porque": p.get("porque", ""), "origen": p.get("origen", ""), "angulo": p.get("angulo", ""),
               "ident": p.get("ident", ""), "formato": p.get("formato", ""), "hooks": [h for h in (p.get("hooks") or []) if h][:5],
               "guion": p.get("guion", ""), "kpi": p.get("kpi", ""), "estado": "Pendiente", "_upd": datetime.now(timezone.utc).isoformat(), "_por": "Cerebro Meta"}
        put(f"crm:propuestas:{rec['id']}", rec)
        pend.add(norm(rec["titulo"])); nuevas += 1
    put("crm:sistema:cerebro", {"id": "cerebro", "fecha": datetime.now(timezone.utc).isoformat(), "resumen": d.get("resumen", ""), "estrategia": d.get("estrategia", {})})
    print(json.dumps({"ok": True, "nuevas": nuevas, "saltadas": saltadas, "pendientesTotal": len(pend)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
