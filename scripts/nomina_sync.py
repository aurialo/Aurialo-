#!/usr/bin/env python3
"""Nómina del equipo logístico de Aurialo (Florencia y Mayra) → CRM.

Uso:
    python3 scripts/nomina_sync.py horas.txt pedidos.txt [--dry-run]

horas.txt   = contenido del Sheet "Registro_horas_equipo_logístico_Aurialo" tal cual lo
              devuelve el conector de Google Drive (también vale la exportación a texto).
pedidos.txt = contenido del Sheet "PEDIDOS E INCIDENCIAS" (pestaña Carritos recuperados).

Reglas de pago (las mismas que muestra el CRM, ver config.js → nomina):
  - 3 € por hora trabajada, se paga el día 12 del mes siguiente.
  - 0,50 € por carrito recuperado que acaba ENTREGADO (cuenta en el mes en que se ve entregado
    por primera vez), a partes iguales entre las dos.
  - Bonus sobre el beneficio neto del mes (Beeping): confirmación ≥ 80 % → 5 %, ≥ 88 % → 10 %;
    entrega ≥ 80 % → 5 %, ≥ 85 % → 10 %. Se reparte a partes iguales. Bonus y carritos se pagan
    más tarde (día 25 del mes siguiente) porque hasta entonces hay pedidos en el aire.
Guarda crm:sistema:nomina y crea/actualiza en Gastos los dos pagos de cada mes (si no están pagados).
"""
import json, re, sys, unicodedata, urllib.request, urllib.parse
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

EQUIPO = ["Florencia", "Mayra"]
PRECIO_HORA = 3.0
PRECIO_CARRITO = 0.5
DIA_PAGO_HORAS = 12
DIA_PAGO_BONUS = 25
TRAMOS_CONF = [(0.88, 0.10), (0.80, 0.05)]
TRAMOS_ENT = [(0.85, 0.10), (0.80, 0.05)]
MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
         "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
NOMBRE_MES = {v: k for k, v in MESES.items()}


def num(s):
    s = str(s or "").strip().replace(".", "").replace(",", ".") if "," in str(s or "") else str(s or "").strip()
    try: return float(s)
    except ValueError: return 0.0


def norm(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


def get(clave):
    q = URL + "?select=valor&clave=eq." + urllib.parse.quote(clave)
    rows = json.load(urllib.request.urlopen(urllib.request.Request(q, headers=H), timeout=30))
    if not rows: return None
    v = rows[0]["valor"]
    return json.loads(v) if isinstance(v, str) else v


def put(clave, valor, dry):
    if dry: return
    body = json.dumps([{"clave": clave, "valor": valor, "actualizado": datetime.now(timezone.utc).isoformat()}]).encode()
    req = urllib.request.Request(URL, data=body, method="POST",
                                 headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"})
    urllib.request.urlopen(req, timeout=30).read()


def parse_horas(txt):
    """{'2026-11': {'Florencia': {'horas': 8.0, 'dias': 3}, ...}}"""
    out = {}
    bloques = re.split(r"(?=Registro diario de )", txt)
    for b in bloques[1:]:
        m = re.match(r"Registro diario de (\w+), (\w+) (\d{4})", b)
        if not m: continue
        persona, mes, anio = m.group(1), MESES.get(norm(m.group(2))), int(m.group(3))
        if not mes: continue
        h = re.search(r"Total horas del mes\W+([\d.,]+)", b)
        d = re.search(r"D.as trabajados\W+(\d+)", b)
        k = f"{anio}-{mes:02d}"
        out.setdefault(k, {})[persona] = {"horas": num(h.group(1)) if h else 0.0, "dias": int(d.group(1)) if d else 0}
    return out


def parse_carritos(txt):
    """[(carrito, pedido, entregado)] de la pestaña Carritos recuperados."""
    i = txt.find("Carritos recuperados")
    if i < 0: return []
    sec = txt[i:]
    j = sec.find("Sheet Name:", 30)
    sec = sec[:j] if j > 0 else sec
    sec = sec.split("Table Columns")[0]
    out, vistos = [], set()
    for linea in sec.splitlines():
        m = re.search(r"#?\\?#?(D\d{3,})", linea)
        if not m or m.group(1) in vistos: continue
        vistos.add(m.group(1))
        p = re.search(r"#\s*(\d{4,})", linea.replace("\\", ""))
        out.append((m.group(1), p.group(1) if p else "", "ENTREGADO" in linea.upper()))
    return out


def tramo(v, tramos):
    if v is None: return 0.0
    for lim, pct in tramos:
        if v >= lim - 1e-9: return pct
    return 0.0


def beeping_mes(filas, mes):
    t = {k: 0.0 for k in ("generados", "confirmados", "entregados", "ingresos", "costes", "inversion")}
    for r in filas:
        if str(r.get("fecha", "")).startswith(mes):
            for k in t: t[k] += num(r.get(k)) if isinstance(r.get(k), str) else float(r.get(k) or 0)
    t["beneficio"] = t["ingresos"] - t["costes"] - t["inversion"]
    t["pConf"] = t["confirmados"] / t["generados"] if t["generados"] else None
    t["pEnt"] = t["entregados"] / t["confirmados"] if t["confirmados"] else None
    return t


def mes_siguiente(mes, dia):
    y, m = map(int, mes.split("-"))
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return date(y, m, dia).isoformat()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    horas = parse_horas(open(args[0], encoding="utf-8").read())
    carritos = parse_carritos(open(args[1], encoding="utf-8").read()) if len(args) > 1 else []
    hoy = datetime.now(ZoneInfo("Europe/Madrid")).date()
    prev = get("crm:sistema:nomina") or {}
    mapa = prev.get("carritos", {})
    for c, ped, ent in carritos:
        r = mapa.get(c, {})
        r["pedido"] = ped or r.get("pedido", "")
        if ent and not r.get("entregado"): r["entregado"] = hoy.isoformat()
        if not ent and r.get("entregado") and not r.get("pagado"): r.pop("entregado")   # se desmarcó en el Sheet
        mapa[c] = r
    snap = get("crm:sistema:beeping") or {}
    filas = snap.get("filas", [])
    meses_set = {k for k, v in horas.items() if any(p.get("horas") for p in v.values())}
    meses_set |= {r["entregado"][:7] for r in mapa.values() if r.get("entregado")}
    meses = {}
    for mes in sorted(meses_set):
        hm = horas.get(mes, {})
        b = beeping_mes(filas, mes)
        n_carr = sum(1 for r in mapa.values() if (r.get("entregado") or "").startswith(mes))
        pc, pe = tramo(b["pConf"], TRAMOS_CONF), tramo(b["pEnt"], TRAMOS_ENT)
        bote = max(b["beneficio"], 0) * (pc + pe)
        fin = date.fromisoformat(mes_siguiente(mes, 1))
        per = {}
        for p in EQUIPO:
            h = (hm.get(p) or {}).get("horas", 0.0)
            per[p] = {"horas": h, "dias": (hm.get(p) or {}).get("dias", 0), "pagoHoras": round(h * PRECIO_HORA, 2),
                      "carritos": round(n_carr * PRECIO_CARRITO / len(EQUIPO), 2), "bonus": round(bote / len(EQUIPO), 2)}
            per[p]["total"] = round(per[p]["pagoHoras"] + per[p]["carritos"] + per[p]["bonus"], 2)
        meses[mes] = {"personas": per, "carritosEntregados": n_carr,
                      "beeping": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in b.items()},
                      "pctConf": pc, "pctEnt": pe, "bote": round(bote, 2),
                      "provisional": hoy < date.fromisoformat(mes_siguiente(mes, DIA_PAGO_BONUS)),
                      "enCurso": hoy < fin,
                      "pagoHorasFecha": mes_siguiente(mes, DIA_PAGO_HORAS), "pagoBonusFecha": mes_siguiente(mes, DIA_PAGO_BONUS)}
        # Pagos en Gastos (no se tocan si ya están marcados como pagados)
        y, mm = map(int, mes.split("-"))
        etiqueta = f"{NOMBRE_MES[mm]} {y}"
        tot_h = round(sum(x["pagoHoras"] for x in per.values()), 2)
        tot_b = round(sum(x["carritos"] + x["bonus"] for x in per.values()), 2)
        for gid, concepto, fecha, importe, nota in [
            (f"nomina_horas_{mes}", f"Equipo logístico · horas {etiqueta}", meses[mes]["pagoHorasFecha"], tot_h,
             " · ".join(f"{p} {per[p]['horas']:.2f} h = {per[p]['pagoHoras']:.2f} €" for p in EQUIPO)),
            (f"nomina_bonus_{mes}", f"Equipo logístico · bonus y carritos {etiqueta}", meses[mes]["pagoBonusFecha"], tot_b,
             f"{n_carr} carritos entregados · bonus {int((pc + pe) * 100)} % del neto ({b['beneficio']:.2f} €) · confirmación "
             f"{(b['pConf'] or 0) * 100:.1f} % · entrega {(b['pEnt'] or 0) * 100:.1f} % · {'PROVISIONAL' if meses[mes]['provisional'] else 'definitivo'}"),
        ]:
            g = get(f"crm:gastos:{gid}")
            if g and g.get("pagado"): continue
            if not g and importe <= 0: continue
            g = {**(g or {}), "id": gid, "concepto": concepto, "importe": importe, "categoria": "Colaboradores / nóminas",
                 "frecuencia": "Único", "fecha": fecha, "diaBase": int(fecha[8:]), "metodo": (g or {}).get("metodo", "Transferencia"),
                 "avisoDias": (g or {}).get("avisoDias", 4), "activo": "Sí", "notas": nota, "auto": "nomina",
                 "_upd": datetime.now(timezone.utc).isoformat(), "_por": "Agente nómina"}
            put(f"crm:gastos:{gid}", g, dry)
    valor = {"id": "nomina", "fecha": datetime.now(timezone.utc).isoformat(), "carritos": mapa, "meses": meses,
             "beepingHasta": filas[-1]["fecha"] if filas else None, "beepingFecha": snap.get("fecha"),
             "reglas": {"precioHora": PRECIO_HORA, "precioCarrito": PRECIO_CARRITO, "diaPagoHoras": DIA_PAGO_HORAS,
                        "diaPagoBonus": DIA_PAGO_BONUS, "tramosConf": TRAMOS_CONF, "tramosEnt": TRAMOS_ENT}}
    put("crm:sistema:nomina", valor, dry)
    print(json.dumps({"ok": True, "meses": {m: {p: v["total"] for p, v in x["personas"].items()} for m, x in meses.items()},
                      "carritos": len(mapa), "dry": dry}, ensure_ascii=False))


if __name__ == "__main__":
    main()
