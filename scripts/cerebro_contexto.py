#!/usr/bin/env python3
"""Prepara el contexto del «Cerebro Meta» de Aurialo.

Uso:
    python3 scripts/cerebro_contexto.py > /tmp/cerebro_contexto.json

Junta en un solo JSON compacto, por producto, todo lo que el agente necesita para proponer:
  - economía del producto (CPA máximo, ROAS breakeven, oferta mínima) y reglas creativas (config.js)
  - nuestros creativos con métricas (ganadores, perdedores, activos) y rendimiento por ángulo y formato
  - las últimas recomendaciones del agente Analíticas Meta Ads
  - lo que hace la competencia (resumen, acciones sugeridas, anuncios más longevos y ángulos)
  - lo que ya está en producción (para no repetir) y el historial de propuestas aprobadas/descartadas
  - stock disponible (no empujar un producto que se va a quedar sin stock)
"""
import json, os, re, subprocess, sys, urllib.request
from collections import defaultdict
from datetime import datetime, timezone

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
AQUI = os.path.dirname(os.path.abspath(__file__))


def todos(prefijo):
    out, off = [], 0
    while True:
        q = f"{URL}?select=clave,valor&clave=like.{prefijo}*&limit=1000&offset={off}"
        rows = json.load(urllib.request.urlopen(urllib.request.Request(q, headers=H), timeout=60))
        for r in rows:
            v = r["valor"]
            try: v = json.loads(v) if isinstance(v, str) else v
            except Exception: continue
            out.append(v)
        if len(rows) < 1000: return out
        off += 1000


def config():
    js = os.path.join(AQUI, "..", "config.js")
    try:
        txt = subprocess.run(["node", "-e", f"global.window={{}};require({json.dumps(js)});console.log(JSON.stringify(window.AURIALO_CONFIG))"],
                             capture_output=True, text=True, timeout=30).stdout
        return json.loads(txt)
    except Exception:
        return {}


def f(v):
    try: return float(v or 0)
    except (TypeError, ValueError): return 0.0


def metr(c):
    g = f(c.get("gasto")); comp = f(c.get("comprasShopify")) or f(c.get("comprasMeta")); ing = f(c.get("ingresos"))
    imp = f(c.get("impresiones")); clk = f(c.get("clicsEnlace")); h3 = f(c.get("reprod3s"))
    return {"gasto": round(g, 2), "compras": comp, "roas": round(ing / g, 2) if g else None, "cpa": round(g / comp, 2) if comp else None,
            "ctr": round(clk / imp * 100, 2) if imp else None, "hook": round(h3 / imp * 100, 1) if imp and h3 else None}


def main():
    C = config()
    prods = {p["code"]: p for p in C.get("productos", [])}
    sistema = {s.get("id"): s for s in todos("crm:sistema:")}
    creativos = todos("crm:creativos:")
    prod_items = todos("crm:produccion:")
    propuestas = todos("crm:propuestas:")
    competidores = todos("crm:competidores:")
    anuncios = todos("crm:anuncios:")
    hoy = datetime.now(timezone.utc).date().isoformat()
    nombre_comp = {**{c.get("id"): c.get("nombre") for c in competidores}, **{c.get("nombre"): c.get("nombre") for c in competidores}}
    prod_comp = {**{c.get("id"): c.get("producto") for c in competidores}, **{c.get("nombre"): c.get("producto") for c in competidores}}

    por = defaultdict(lambda: {"creativos": []})
    for c in creativos:
        code = c.get("producto") or "OTRO"
        m = metr(c)
        por[code]["creativos"].append({"nombre": c.get("nombre"), "conjunto": c.get("conjunto"), "angulo": c.get("angulo"), "formato": c.get("formato"),
                                       "activo": c.get("estadoMeta") == "ACTIVE", "lanzado": c.get("fechaLanz"), **m, "notas": (c.get("notas") or "")[:160]})
    salida = {"generado": hoy, "reglasDecision": C.get("reglas"), "reglasCreativas": C.get("reglasCreativas"), "formatos": C.get("formatos"),
              "productos": {}, "accionesAnalíticas": None, "competenciaResumen": None}
    ac = sistema.get("acciones")
    if ac: salida["accionesAnalíticas"] = {k: ac.get(k) for k in ("fecha", "titular", "totales", "escalar", "apagar", "iterar", "esperar", "sano", "vigilar")}
    comp = sistema.get("competencia")
    if comp: salida["competenciaResumen"] = {k: comp.get(k) for k in ("fecha", "resumen", "acciones", "docUrl")}
    stock = {p.get("code"): p for p in (sistema.get("stock") or {}).get("productos", [])}

    for code in sorted(set(list(prods) + list(por))):
        P = prods.get(code, {})
        cs = por[code]["creativos"]
        if not cs and not P.get("cpaMax") and not any(c.get("producto") == code for c in competidores): continue
        con_ventas = [c for c in cs if c["compras"] and c["gasto"] >= 15]
        top = sorted(con_ventas, key=lambda c: -(c["roas"] or 0))[:8]
        malos = sorted([c for c in cs if c["gasto"] >= 30 and (not c["compras"] or (c["roas"] or 0) < 1.5)], key=lambda c: -c["gasto"])[:6]
        activos = [c for c in cs if c["activo"]][:15]
        agg = lambda key: sorted(({"valor": k, "creativos": len(v), "gasto": round(sum(x["gasto"] for x in v), 2), "compras": sum(x["compras"] for x in v),
                                   "roas": round(sum((x["roas"] or 0) * x["gasto"] for x in v) / max(sum(x["gasto"] for x in v), 1), 2)}
                                  for k, v in _grupos(cs, key).items()), key=lambda d: -d["gasto"])[:10]
        st = next((s for s in stock.values() if code in (s.get("nombre", "") + s.get("code", "")).upper() or
                   (code == "GLP1" and "GLP" in s.get("nombre", "").upper() and s.get("disponible", 0) > 0) or
                   (code == "DRENAJE" and "DRENAJE" in s.get("nombre", "").upper())), None)
        salida["productos"][code] = {
            "nombre": P.get("nombre", code), "economia": {k: P.get(k) for k in ("precio", "aov", "cpaMax", "roasBE", "cpaObj", "roasObj", "ofertaMin", "cpaMaxMin", "roasBEMin") if P.get(k) is not None},
            "stock": {k: st.get(k) for k in ("disponible", "porDia", "diasCobertura", "estado", "agotaEl")} if st else None,
            "ganadores": top, "perdedores": malos, "activos": activos, "porAngulo": agg("angulo"), "porFormato": agg("formato"),
            "competidores": [{k: c.get(k) for k in ("nombre", "anunciosActivos", "nuevos7d", "masLongevoDias", "formatos", "angulos", "oferta", "notas")}
                             for c in competidores if c.get("producto") == code],
            "anunciosCompetencia": sorted([{**{k: a.get(k) for k in ("angulo", "formato", "diasActivo", "hook", "oferta", "notas")}, "competidor": nombre_comp.get(a.get("competidor"), a.get("competidor"))}
                                           for a in anuncios if a.get("producto") == code or prod_comp.get(a.get("competidor")) == code],
                                          key=lambda a: -(a.get("diasActivo") or 0))[:15],
            "enProduccion": [{k: p.get(k) for k in ("angulo", "ident", "formato", "estado", "fechaPrev")} for p in prod_items
                             if p.get("producto") == code and p.get("estado") not in ("Descartado",)][-20:],
            "propuestasPrevias": [{k: p.get(k) for k in ("fecha", "tipo", "titulo", "estado", "motivoDescarte")} for p in sorted(propuestas, key=lambda p: p.get("fecha", ""))
                                  if p.get("producto") == code][-20:],
        }
    json.dump(salida, sys.stdout, ensure_ascii=False, separators=(",", ":"))


def _grupos(cs, key):
    g = defaultdict(list)
    for c in cs:
        k = (c.get(key) or "").strip()
        if k: g[k].append(c)
    return g


if __name__ == "__main__":
    main()
