#!/usr/bin/env python3
"""Vuelca anuncios de Meta Ads al CRM de Aurialo (Supabase, tabla `aurialo`).

Uso:
    python3 scripts/meta_sync.py <resultado_ads_get_ad_entities.json|txt> [--dry-run]

Entrada: el resultado del tool `ads_get_ad_entities` (level=ad) con los campos
id, name, campaign_name, adset_name, effective_status, created_time,
amount_spent, impressions, link_click, video_play_actions, omni_purchase,
omni_purchase_values. Acepta la respuesta tal cual (con envoltorios de texto).

Cada anuncio se guarda como `crm:creativos:meta_<id_anuncio>`. Se actualizan las
métricas y los datos de Meta; lo que el equipo haya escrito a mano en el CRM
(notas, compras de Shopify, ticket medio, estado forzado, ángulo/formato
corregidos) se conserva.
"""
import json, re, sys, unicodedata, urllib.request
from datetime import datetime, timezone

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

MANUAL = ["notas", "comprasShopify", "ticketMedio", "veredictoManual", "angulo", "ident", "formato", "producto"]


def find_ads(obj):
    """Busca recursivamente la lista de anuncios dentro de la respuesta del tool."""
    if isinstance(obj, str):
        s = obj.strip()
        if s[:1] in "[{":
            try:
                return find_ads(json.loads(s))
            except Exception:
                return None
        return None
    if isinstance(obj, list):
        if obj and isinstance(obj[0], dict) and "amount_spent" in obj[0] and "id" in obj[0]:
            return obj
        out = []
        for x in obj:
            r = find_ads(x)
            if r:
                out += r
        return out or None
    if isinstance(obj, dict):
        for k in ("ad_entities", "text", "result", "content", "data"):
            if k in obj:
                r = find_ads(obj[k])
                if r:
                    return r
    return None


def val(v):
    if v is None:
        return 0.0
    if isinstance(v, dict):
        v = v.get("value")
    try:
        return float(v)
    except Exception:
        return 0.0


def producto(campana, nombre):
    t = (campana + " " + nombre).upper()
    t = unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode()
    for code, keys in [("GLP1", ["GLP"]), ("MENO", ["MENO"]), ("DRENAJE", ["DRENAJE", "LINFATIC"]),
                       ("MAGNESIO", ["MAGNES"]), ("BOTOX", ["BOTOX"]), ("TIRAS", ["TIRAS", "DENTAL"]), ("UNPUFF", ["UNPUFF"])]:
        if any(k in t for k in keys):
            return code
    return ""


def formato(nombre, conjunto):
    t = (nombre + " " + conjunto).lower()
    if t.startswith("imagen") or nombre.lower().startswith("imagen"):
        return "Imagen"
    if "animad" in t:
        return "Animado + música"
    if "almac" in t:
        return "Almacén a cámara"
    if "ugc" in t:
        return "UGC IA"
    if nombre.lower().startswith("video"):
        return "UGC IA"
    return "Otro"


def angulo(nombre):
    base = re.sub(r"^(video|imagen|img)\s*[_\-:]\s*", "", nombre.strip(), flags=re.I)
    base = re.sub(r"^(ugc( ia)?)\s+", "", base, flags=re.I)
    return base.strip()[:80] or nombre


def get_existing():
    req = urllib.request.Request(URL + "?select=clave,valor&clave=like.crm:creativos:*", headers=H)
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.loads(r.read())
    out = {}
    for row in rows:
        v = row["valor"]
        if isinstance(v, str):
            v = json.loads(v)
        out[row["clave"]] = v
    return out


def upsert(rows):
    for i in range(0, len(rows), 100):
        body = json.dumps(rows[i:i + 100]).encode()
        req = urllib.request.Request(URL, data=body, method="POST",
                                     headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"})
        urllib.request.urlopen(req, timeout=60).read()


def main():
    path = sys.argv[1]
    dry = "--dry-run" in sys.argv
    raw = open(path, encoding="utf-8").read()
    ads = find_ads(raw)
    if not ads:
        sys.exit("No encuentro anuncios en el archivo")
    now = datetime.now(timezone.utc).isoformat()
    existing = {} if dry else get_existing()
    rows, resumen = [], {"anuncios": 0, "nuevos": 0, "gasto": 0.0, "compras": 0}
    for a in ads:
        aid = str(a["id"])
        clave = f"crm:creativos:meta_{aid}"
        prev = existing.get(clave, {})
        nombre = a.get("name") or aid
        camp = a.get("campaign_name") or ""
        conj = a.get("adset_name") or ""
        rec = {
            "id": f"meta_{aid}", "metaId": aid, "nombre": nombre,
            "campana": camp, "conjunto": conj, "estadoMeta": a.get("effective_status", ""),
            "producto": producto(camp, nombre), "angulo": angulo(nombre), "ident": "", "formato": formato(nombre, conj),
            "fechaLanz": (a.get("created_time") or "")[:10],
            "gasto": round(val(a.get("amount_spent")), 2), "impresiones": int(val(a.get("impressions"))),
            "clicsEnlace": int(val(a.get("link_click"))), "reprodVideo": int(val(a.get("video_play_actions"))),
            "comprasMeta": int(val(a.get("omni_purchase"))), "ingresos": round(val(a.get("omni_purchase_values")), 2),
            "fuente": "Meta Ads (sync)", "metaSync": now, "_upd": now, "_por": "Agente Meta",
        }
        for k in MANUAL:
            if prev.get(k) not in (None, ""):
                rec[k] = prev[k]
        rows.append({"clave": clave, "valor": rec, "actualizado": now})
        resumen["anuncios"] += 1
        resumen["nuevos"] += 0 if prev else 1
        resumen["gasto"] += rec["gasto"]
        resumen["compras"] += rec["comprasMeta"]
    rows.append({"clave": "crm:sistema:metasync", "valor": {"id": "metasync", "fecha": now, **resumen}, "actualizado": now})
    if not dry:
        upsert(rows)
    resumen["gasto"] = round(resumen["gasto"], 2)
    print(json.dumps({"ok": True, "dry_run": dry, **resumen}, ensure_ascii=False))


if __name__ == "__main__":
    main()
