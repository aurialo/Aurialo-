#!/usr/bin/env python3
"""Vuelca al CRM de Aurialo el análisis de competencia (agente "Informe competencia Aurialo").

Uso:
    python3 scripts/competencia_sync.py competencia.json [--dry-run]

competencia.json:
{
  "fecha": "2026-11-30",
  "docUrl": "https://claude.ai/...",                     # enlace al documento del informe (opcional)
  "resumen": ["línea 1", "línea 2", ...],                 # resumen ejecutivo
  "acciones": ["acción 1", ...],                          # qué debería probar Aurialo esta semana
  "competidores": [
    {"nombre": "Sonvital", "producto": "DRENAJE", "anunciosActivos": 363, "nuevos7d": 30,
     "masLongevoDias": 120, "formatos": "estático + vídeo largo", "angulos": "líquido retenido; vuelve a…",
     "oferta": "29,90 € · pack 3 a 19,97 €/ud · 50 % dto.", "web": "https://sonvital.com",
     "adsLibraryUrl": "https://www.facebook.com/ads/library/?...", "notas": "..."}
  ],
  "anuncios": [
    {"libraryId": "1234567890", "competidor": "Sonvital", "angulo": "No es grasa, es líquido retenido",
     "formato": "Vídeo UGC", "diasActivo": 45, "fechaInicio": "2026-10-15", "oferta": "Pack 3",
     "hook": "frase corta", "link": "https://www.facebook.com/ads/library/?id=1234567890", "notas": "qué copiar"}
  ]
}
productos válidos: GLP1, MENO, DRENAJE, MAGNESIO, BOTOX, TIRAS, UNPUFF.

- Competidores: se actualizan por nombre (sin distinguir mayúsculas); los nuevos se crean.
- Anuncios: uno por libraryId (o por competidor+ángulo+formato si no hay id); se actualizan los días activos.
- Lo que el equipo escribió a mano en el CRM (notas de un competidor, notas de un anuncio) se conserva.
"""
import hashlib, json, re, sys, urllib.request
from datetime import datetime, timezone

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
CAMPOS_COMP = ["producto", "anunciosActivos", "nuevos7d", "masLongevoDias", "formatos", "angulos", "oferta", "web", "adsLibraryUrl"]
CAMPOS_ANU = ["angulo", "formato", "diasActivo", "fechaInicio", "oferta", "hook", "link"]


def get(prefix):
    req = urllib.request.Request(URL + f"?select=clave,valor&clave=like.{prefix}*", headers=H)
    out = {}
    for row in json.loads(urllib.request.urlopen(req, timeout=30).read()):
        v = row["valor"]
        out[row["clave"]] = json.loads(v) if isinstance(v, str) else v
    return out


def upsert(rows):
    for i in range(0, len(rows), 100):
        req = urllib.request.Request(URL, data=json.dumps(rows[i:i + 100]).encode(), method="POST",
                                     headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"})
        urllib.request.urlopen(req, timeout=60).read()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:40]


def main():
    src = json.load(open(sys.argv[1], encoding="utf-8"))
    dry = "--dry-run" in sys.argv
    now = datetime.now(timezone.utc).isoformat()
    comps = {} if dry else get("crm:competidores:")
    anus = {} if dry else get("crm:anuncios:")
    por_nombre = {v.get("nombre", "").strip().lower(): v for v in comps.values()}
    rows, n_new_c, n_new_a = [], 0, 0

    for c in src.get("competidores", []):
        nombre = (c.get("nombre") or "").strip()
        if not nombre:
            continue
        prev = por_nombre.get(nombre.lower())
        rec = dict(prev) if prev else {"id": "c_" + slug(nombre), "nombre": nombre}
        n_new_c += 0 if prev else 1
        for k in CAMPOS_COMP:
            if c.get(k) not in (None, ""):
                rec[k] = c[k]
        if c.get("notas") and not (prev or {}).get("notas"):
            rec["notas"] = c["notas"]
        rec["analisis"] = c.get("notas") or rec.get("analisis", "")
        rec.update({"actualizadoAgente": now, "_upd": now, "_por": "Agente competencia"})
        por_nombre[nombre.lower()] = rec
        rows.append({"clave": f"crm:competidores:{rec['id']}", "valor": rec, "actualizado": now})

    for a in src.get("anuncios", []):
        comp = por_nombre.get((a.get("competidor") or "").strip().lower())
        if not comp:
            continue
        lib = str(a.get("libraryId") or "").strip()
        aid = "lib_" + lib if lib else "lib_" + hashlib.md5(f"{comp['id']}|{a.get('angulo')}|{a.get('formato')}".encode()).hexdigest()[:12]
        prev = anus.get(f"crm:anuncios:{aid}")
        rec = dict(prev) if prev else {"id": aid, "competidor": comp["id"], "fechaVisto": src.get("fecha") or now[:10]}
        n_new_a += 0 if prev else 1
        for k in CAMPOS_ANU:
            if a.get(k) not in (None, ""):
                rec[k] = a[k]
        if a.get("notas") and not (prev or {}).get("notas"):
            rec["notas"] = a["notas"]
        rec.update({"ultimaVez": src.get("fecha") or now[:10], "_upd": now, "_por": "Agente competencia"})
        rows.append({"clave": f"crm:anuncios:{aid}", "valor": rec, "actualizado": now})

    rows.append({"clave": "crm:sistema:competencia", "actualizado": now, "valor": {
        "id": "competencia", "fecha": now, "semana": src.get("fecha"), "docUrl": src.get("docUrl", ""),
        "resumen": src.get("resumen", []), "acciones": src.get("acciones", [])}})
    if not dry:
        upsert(rows)
    print(json.dumps({"ok": True, "dry_run": dry, "competidores": len(src.get("competidores", [])), "competidores_nuevos": n_new_c,
                      "anuncios": len(src.get("anuncios", [])), "anuncios_nuevos": n_new_a}, ensure_ascii=False))


if __name__ == "__main__":
    main()
