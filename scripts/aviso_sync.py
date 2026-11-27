#!/usr/bin/env python3
"""Guarda en el CRM el resumen de lo que ha comunicado un agente (Panel → Hoy → «Lo que dicen los agentes»).

Uso:
    python3 scripts/aviso_sync.py aviso.json

aviso.json:
{"agente": "Informe Meta Ads", "titular": "frase corta con lo más importante",
 "puntos": ["3 a 6 puntos breves y concretos, con cifras"], "enlace": "https://... (opcional)"}
Cada agente tiene su propio registro (crm:sistema:aviso_<agente>); el CRM muestra los de los últimos días.
"""
import json, re, sys, unicodedata, urllib.request
from datetime import datetime, timezone

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"


def main():
    src = json.load(open(sys.argv[1], encoding="utf-8"))
    agente = (src.get("agente") or "Agente").strip()
    slug = re.sub(r"[^a-z0-9]+", "_", unicodedata.normalize("NFD", agente.lower()).encode("ascii", "ignore").decode()).strip("_")
    now = datetime.now(timezone.utc).isoformat()
    rec = {"id": "aviso_" + slug, "agente": agente, "fecha": now, "titular": src.get("titular", ""),
           "puntos": [str(p) for p in src.get("puntos", [])][:8], "enlace": src.get("enlace", "")}
    body = json.dumps([{"clave": f"crm:sistema:{rec['id']}", "valor": rec, "actualizado": now}]).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                                 "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    urllib.request.urlopen(req, timeout=30).read()
    print(json.dumps({"ok": True, "id": rec["id"], "puntos": len(rec["puntos"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
