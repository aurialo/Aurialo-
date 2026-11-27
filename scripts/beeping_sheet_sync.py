#!/usr/bin/env python3
"""Registro-Base del Sheet «Control Contable de Tienda Aurialo» → CRM (crm:sistema:beeping).

Uso:
    python3 scripts/beeping_sheet_sync.py <ID_DEL_SHEET>

Descarga solo la pestaña Registro-Base como CSV, la convierte a filas diarias
(fecha, inversión, ventas, generados, confirmados, entregados, devueltos, ingresos y costes)
y la guarda en Supabase. Es lo que usan Panel, Equipo logístico → Resultados, el panel del
equipo y la nómina. El ID del Sheet no se guarda en el repositorio (es público): se pasa
como argumento desde la tarea programada.
"""
import csv, io, json, re, sys, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
CAMPOS = {"inversion": "inversion publicitaria", "ventas": "importe total", "generados": "generados", "confirmados": "confirmados",
          "entregados": "entregados", "devueltos": "devueltos", "ingresos": "importe entregado", "costeProducto": "coste total de producto",
          "envio": "coste por envio", "picking": "coste por picking", "cod": "coste por cod", "financiero": "coste financiero", "costes": "total costes"}


def norm(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()).strip()


def num(s):
    s = str(s or "").strip()
    if not s or s == "-": return 0.0
    neg = s.startswith("(") or s.startswith("-")
    s = re.sub(r"[()€%\s-]", "", s).replace(".", "").replace(",", ".")
    try: v = float(s)
    except ValueError: return 0.0
    return -v if neg else v


def main():
    sid = sys.argv[1]
    u = f"https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote('Registro-Base')}"
    txt = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read().decode("utf-8")
    rows = list(csv.reader(io.StringIO(txt)))
    hi = next(i for i, r in enumerate(rows) if any(norm(c).endswith("fecha") for c in r) and any("generados" in norm(c) for c in r))
    h = [norm(c) for c in rows[hi]]
    fcol = next(i for i, c in enumerate(h) if c.endswith("fecha"))
    idx = {}
    for k, name in CAMPOS.items():
        cand = [i for i, c in enumerate(h) if c == name or c.endswith(" " + name) or c.startswith(name)]
        idx[k] = cand[0] if cand else -1
    filas = []
    for r in rows[hi + 1:]:
        m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", (r[fcol] if fcol < len(r) else "").strip())
        if not m: continue
        o = {"fecha": f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"}
        for k, i in idx.items():
            o[k] = abs(num(r[i])) if 0 <= i < len(r) else 0.0
        filas.append(o)
    if not filas: raise SystemExit("No encuentro filas en Registro-Base")
    falta = [k for k, i in idx.items() if i < 0]
    now = datetime.now(timezone.utc).isoformat()
    valor = {"id": "beeping", "fecha": now, "fuente": "Google Sheet (agente cada 30 min)", "filas": filas, "_upd": now, "_por": "Agente"}
    body = json.dumps([{"clave": "crm:sistema:beeping", "valor": json.dumps(valor), "actualizado": now}]).encode()
    urllib.request.urlopen(urllib.request.Request(URL, data=body, method="POST", headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}), timeout=30).read()
    print(json.dumps({"ok": True, "filas": len(filas), "desde": filas[0]["fecha"], "hasta": filas[-1]["fecha"], "columnasSinEncontrar": falta}, ensure_ascii=False))


if __name__ == "__main__":
    main()
