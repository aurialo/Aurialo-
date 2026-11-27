#!/usr/bin/env python3
"""Resumen de pedidos de Shopify para el CRM (Panel → Hoy): hoy, ayer y últimos 7 días, por producto.

Uso:
    python3 scripts/shopify_sync.py pedidos.json [--dry-run]

pedidos.json: la respuesta de la consulta GraphQL de Shopify (tal cual, aunque venga envuelta en texto)
    { orders(first: 100, sortKey: CREATED_AT, reverse: true) { edges { node { name createdAt cancelledAt sourceName
      totalPriceSet { shopMoney { amount } } lineItems(first: 5) { edges { node { title quantity } } } } } pageInfo { hasNextPage endCursor } } }
o una lista de pedidos [{"name", "createdAt", "cancelledAt", "sourceName", "total", "items": [["título", cantidad], ...]}].
Se pueden pasar varios archivos (páginas) separados por espacios.
Los días se cuentan en hora de Madrid. Los pedidos manuales (sourceName shopify_draft_order: carritos recuperados,
cambios…) se cuentan aparte. Guarda en Supabase la clave crm:sistema:shopify.
"""
import json, re, sys, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
MAD = ZoneInfo("Europe/Madrid")


def producto(titulo):
    t = titulo.lower()
    if "unpuff" in t: return "UNPUFF"
    if "drenaje" in t or "lymph" in t: return "DRENAJE"
    if "menopausia" in t or "meno" in t or "hormonal" in t: return "MENO"
    if "glp" in t or "control de peso" in t: return "GLP1"
    return "OTRO"


def extraer(raw):
    """Devuelve la lista de pedidos de cualquiera de los formatos admitidos."""
    i = raw.find("{\"data\"")
    if i >= 0:
        j = json.JSONDecoder().raw_decode(raw[i:])[0]
        return [{"name": e["node"]["name"], "createdAt": e["node"]["createdAt"], "cancelledAt": e["node"].get("cancelledAt"),
                 "sourceName": e["node"].get("sourceName"), "total": float(e["node"]["totalPriceSet"]["shopMoney"]["amount"]),
                 "items": [[x["node"]["title"], x["node"]["quantity"]] for x in e["node"]["lineItems"]["edges"]]}
                for e in j["data"]["orders"]["edges"]]
    d = json.loads(raw)
    return d if isinstance(d, list) else d.get("pedidos", [])


def main():
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    pedidos = {}
    for f in files:
        for p in extraer(open(f, encoding="utf-8").read()):
            pedidos[p["name"]] = p
    hoy = datetime.now(MAD).date()
    dias = defaultdict(lambda: {"pedidos": 0, "ventas": 0.0, "manuales": 0, "cancelados": 0, "porProducto": defaultdict(lambda: {"pedidos": 0, "uds": 0, "ventas": 0.0})})
    for p in pedidos.values():
        d = datetime.fromisoformat(p["createdAt"].replace("Z", "+00:00")).astimezone(MAD).date()
        if (hoy - d).days > 7:
            continue
        o = dias[d.isoformat()]
        if p.get("cancelledAt"):
            o["cancelados"] += 1
            continue
        o["pedidos"] += 1
        o["ventas"] += p["total"]
        if p.get("sourceName") == "shopify_draft_order":
            o["manuales"] += 1
        items = p.get("items") or []
        principal = producto(items[0][0]) if items else "OTRO"
        pp = o["porProducto"][principal]
        pp["pedidos"] += 1
        pp["ventas"] += p["total"]
        for t, q in items:
            o["porProducto"][producto(t)]["uds"] += int(q)
    fechas = sorted(dias)
    serie = [{"fecha": f, **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in dias[f].items() if k != "porProducto"},
              "porProducto": {k: {"pedidos": v["pedidos"], "uds": v["uds"], "ventas": round(v["ventas"], 2)} for k, v in dias[f]["porProducto"].items()}}
             for f in fechas]
    now = datetime.now(timezone.utc).isoformat()
    ultimo = max(pedidos.values(), key=lambda p: p["createdAt"]) if pedidos else None
    rec = {"id": "shopify", "fecha": now, "hoy": hoy.isoformat(), "ultimoPedido": ultimo and {"name": ultimo["name"], "createdAt": ultimo["createdAt"]}, "dias": serie}
    if not dry:
        body = json.dumps([{"clave": "crm:sistema:shopify", "valor": rec, "actualizado": now}]).encode()
        req = urllib.request.Request(URL, data=body, method="POST", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                                     "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
        urllib.request.urlopen(req, timeout=30).read()
    print(json.dumps({"ok": True, "dry_run": dry, "dias": [{"fecha": s["fecha"], "pedidos": s["pedidos"], "ventas": s["ventas"], "manuales": s["manuales"]} for s in serie]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
