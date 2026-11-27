#!/usr/bin/env python3
"""Guarda en el CRM las recomendaciones del día del agente "Analíticas Meta Ads" (pestaña Panel → Hoy).

Uso:
    python3 scripts/acciones_sync.py acciones.json

acciones.json:
{
  "titular": "Lanzamientos del jueves + de cara al finde",
  "totales": "Gasto 412 € · 31 compras · ROAS 2,9×",
  "escalar": [{"conjunto": "...", "nombre": "<creativo, opcional>", "producto": "GLP1|MENO|DRENAJE|...", "gasto": 120.5, "compras": 9, "roas": 3.4, "cpa": 13.4, "motivo": "una frase"}],
  "apagar":  [...],   # parar
  "iterar":  [...],   # creativos ganadores para sacar variaciones
  "esperar": [...],   # en aprendizaje, con señales tempranas en "motivo"
  "sano":    [...],   # rentables, mantener
  "vigilar": [...]    # en observación
}
"""
import json, sys, urllib.request
from datetime import datetime, timezone

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
LISTAS = ["escalar", "apagar", "iterar", "esperar", "sano", "vigilar"]


def main():
    src = json.load(open(sys.argv[1], encoding="utf-8"))
    now = datetime.now(timezone.utc).isoformat()
    rec = {"id": "acciones", "fecha": now, "titular": src.get("titular", ""), "totales": src.get("totales", "")}
    for k in LISTAS:
        rec[k] = [i for i in src.get(k, []) if isinstance(i, dict)]
    body = json.dumps([{"clave": "crm:sistema:acciones", "valor": rec, "actualizado": now}]).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                                 "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    urllib.request.urlopen(req, timeout=30).read()
    print(json.dumps({"ok": True, **{k: len(rec[k]) for k in LISTAS}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
