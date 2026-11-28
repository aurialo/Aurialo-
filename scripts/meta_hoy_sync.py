#!/usr/bin/env python3
"""Conjuntos activos de Meta HOY → app de Aurialo (crm:sistema:meta_hoy).

Uso:
    python3 scripts/meta_hoy_sync.py /tmp/meta_hoy.json

El archivo es la respuesta tal cual de ads_get_ad_entities (cuenta 1562121651418412, level "adset",
date_preset "today", filtro effective_status IN ["ACTIVE"], campos id, name, campaign_name,
effective_status, daily_budget, amount_spent, impressions, link_click, omni_purchase,
omni_purchase_values). Guarda por conjunto: producto, presupuesto, gasto, compras, facturación,
CPA, ROAS y CTR de hoy, más el total del día.
"""
import json, re, sys, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}


def v(x):
    if isinstance(x, dict): x = x.get("value")
    try: return float(x or 0)
    except (TypeError, ValueError): return 0.0


def producto(campana, nombre):
    t = (campana + " " + nombre).upper()
    if "GLP" in t: return "GLP1"
    if "MENO" in t: return "MENO"
    if "DRENAJE" in t or "LINF" in t: return "DRENAJE"
    if "UNPUFF" in t: return "UNPUFF"
    return ""


def main():
    raw = json.load(open(sys.argv[1], encoding="utf-8"))
    ents = raw.get("ad_entities", raw) if isinstance(raw, dict) else raw
    if isinstance(ents, str): ents = json.loads(ents)
    conj = []
    for e in ents:
        g, c, ing = v(e.get("amount_spent")), v(e.get("omni_purchase")), v(e.get("omni_purchase_values"))
        imp, clk = v(e.get("impressions")), v(e.get("link_click"))
        conj.append({"id": e.get("id"), "nombre": re.sub(r"^conjunto\s*", "", re.sub(r"\s+", " ", e.get("name") or ""), flags=re.I).strip(),
                     "campana": e.get("campaign_name"), "producto": producto(e.get("campaign_name") or "", e.get("name") or ""),
                     "presupuesto": v(e.get("daily_budget")), "gasto": round(g, 2), "compras": int(c), "ingresos": round(ing, 2),
                     "cpa": round(g / c, 2) if c else None, "roas": round(ing / g, 2) if g else None, "ctr": round(clk / imp * 100, 2) if imp else None})
    conj.sort(key=lambda x: -x["gasto"])
    g = sum(x["gasto"] for x in conj); c = sum(x["compras"] for x in conj); ing = sum(x["ingresos"] for x in conj)
    ahora = datetime.now(timezone.utc)
    valor = {"id": "meta_hoy", "fecha": ahora.isoformat(), "dia": datetime.now(ZoneInfo("Europe/Madrid")).date().isoformat(), "conjuntos": conj,
             "total": {"gasto": round(g, 2), "compras": c, "ingresos": round(ing, 2), "cpa": round(g / c, 2) if c else None, "roas": round(ing / g, 2) if g else None}}
    body = json.dumps([{"clave": "crm:sistema:meta_hoy", "valor": json.dumps(valor, ensure_ascii=False), "actualizado": valor["fecha"]}]).encode()
    urllib.request.urlopen(urllib.request.Request(URL, data=body, method="POST", headers=H), timeout=30).read()
    print(json.dumps({"ok": True, "conjuntos": len(conj), **valor["total"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
