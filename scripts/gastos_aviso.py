#!/usr/bin/env python3
"""Recordatorio de gastos de Aurialo.

Lee los gastos del CRM (Supabase, claves crm:gastos:*) y lista los cargos que
caen justo dentro de N días (avisoDias de cada gasto, 4 por defecto), mañana,
hoy o que están vencidos sin marcar como pagados. Imprime JSON:
{"ok": true, "avisar": [...], "mensaje": "..."}; "mensaje" vacío = nada que avisar.
"""
import json, urllib.request, calendar
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}

def num(v):
    try: return float(v)
    except Exception: return 0.0

def sumar(f, frec, dia_base):
    if frec == "Semanal": return f + timedelta(days=7)
    meses = {"Mensual": 1, "Trimestral": 3, "Anual": 12}.get(frec)
    if not meses: return None
    m = f.month - 1 + meses; y = f.year + m // 12; m = m % 12 + 1
    dia = int(dia_base or f.day)
    return date(y, m, min(dia, calendar.monthrange(y, m)[1]))

def eur(v): return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")

def main():
    req = urllib.request.Request(URL + "?select=valor&clave=like.crm:gastos:*", headers=H)
    rows = json.load(urllib.request.urlopen(req, timeout=30))
    hoy = datetime.now(ZoneInfo("Europe/Madrid")).date()
    avisar = []
    for r in rows:
        g = r["valor"]
        if isinstance(g, str): g = json.loads(g)
        if g.get("activo") == "No" or not g.get("fecha"): continue
        if g.get("frecuencia") == "Único" and g.get("pagado"): continue
        aviso = int(num(g.get("avisoDias")) or 4)
        f = date.fromisoformat(g["fecha"])
        for _ in range(60):  # recorre los cobros de los próximos días
            d = (f - hoy).days
            if d > aviso: break
            if d < 0 and f != date.fromisoformat(g["fecha"]): pass
            elif d < 0 or d in (0, 1, aviso):
                avisar.append({"concepto": g.get("concepto", ""), "importe": num(g.get("importe")), "fecha": f.isoformat(),
                               "dias": d, "metodo": g.get("metodo", ""), "categoria": g.get("categoria", "")})
            if g.get("frecuencia") == "Único": break
            f = sumar(f, g.get("frecuencia"), g.get("diaBase"))
            if not f: break
    avisar.sort(key=lambda x: x["fecha"])
    lineas = []
    for a in avisar:
        cuando = (f"vencido hace {-a['dias']} días (márcalo como pagado)" if a["dias"] < 0 else "HOY" if a["dias"] == 0
                  else "mañana" if a["dias"] == 1 else f"en {a['dias']} días")
        dia = date.fromisoformat(a["fecha"]).strftime("%d/%m")
        lineas.append(f"• {a['concepto']}: {eur(a['importe'])} · {cuando} ({dia}{', ' + a['metodo'] if a['metodo'] else ''})")
    total = sum(a["importe"] for a in avisar if a["dias"] >= 0)
    msg = ""
    if lineas:
        msg = f"💸 Próximos cargos de la tienda ({eur(total)}):\n" + "\n".join(lineas) + \
              "\nDetalle: https://aurialo.github.io/Aurialo-/#gastos"
    print(json.dumps({"ok": True, "gastos": len(rows), "avisar": avisar, "mensaje": msg}, ensure_ascii=False))

if __name__ == "__main__":
    main()
