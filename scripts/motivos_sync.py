#!/usr/bin/env python3
"""Clasifica los motivos de rechazo del Sheet "PEDIDOS E INCIDENCIAS" y los vuelca al CRM.

Uso:
    python3 scripts/motivos_sync.py datos.json [--dry-run]

datos.json (lo prepara el agente leyendo el Sheet con el conector de Google Drive):
{
  "cancelados":  [["7184", "Clienta indica que no confirma el pedido."], ...],   # pestaña Pedidos cancelados
  "devueltos":   [["7100", "No quiere el pedido. No aceptó descuento..."], ...], # pestaña Incidencias devueltas
  "carritos":    [["#D1773", "Se crea pedido #7248.", "ENTREGADO"], ...],       # pestaña Carritos recuperados
  "confirmados": 37                                                            # nº de pedidos en Pedidos confirmados
}
Guarda en Supabase la clave crm:sistema:motivos (el CRM la muestra en Equipo logístico → Motivos).
"""
import json, re, sys, unicodedata, urllib.request
from collections import Counter
from datetime import datetime, timezone

URL = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo"
KEY = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82"

# Orden = prioridad: la primera regla que encaja decide la categoría.
REGLAS = [
    ("Devuelto automático por Beeping", r"automatic"),
    ("No contactable", r"no recibe llamadas|no le llegan|sin acceso|no existe n|no contesta|no responde|ilocalizable|telefono (erroneo|incorrecto)"),
    ("Sin dinero", r"dinero|no puede pagar|no tiene para|pedira en|cobra"),
    ("Desconfianza / miedo a estafa", r"estafa|miedo|desconf|fraude|no se fia"),
    ("Consejo médico", r"medic|doctor|salud|embaraz|medicacion"),
    ("Pedido duplicado / ya lo recibió", r"ya recibi|duplicad|repetid|ya tiene"),
    ("Pedido por error", r"por error|se equivoc|sin querer"),
    ("Cambio de circunstancias", r"trabajar fuera|portugal|viaj|mudanz|se va |extranjero|regreso|fuera de"),
    ("Ya no lo quiere (sin motivo)", r".*"),
]
DESC = re.compile(r"desc|10 ?%|5 euros|rebaja")
NO_ACEPTA = re.compile(r"no acept|ni acept|rechaz")


def norm(s):
    return unicodedata.normalize("NFD", (s or "").lower()).encode("ascii", "ignore").decode()


def clasifica(obs):
    t = norm(obs)
    cat = next(c for c, rx in REGLAS if re.search(rx, t))
    return cat, bool(DESC.search(t) and NO_ACEPTA.search(t)), bool(re.search(r"colg", t))


def registros(lista, tipo):
    out, vistos = [], set()
    for fila in lista:
        ped, obs = str(fila[0]).strip().lstrip("#"), str(fila[1] if len(fila) > 1 else "").strip()
        if not ped or not obs or (ped, obs) in vistos:
            continue
        vistos.add((ped, obs))
        cat, desc, colgo = clasifica(obs)
        out.append({"tipo": tipo, "pedido": ped, "obs": obs, "categoria": cat, "rechazaDescuento": desc, "colgo": colgo})
    return out


def resumen(regs, confirmados, carritos):
    canc = [r for r in regs if r["tipo"] == "cancelado"]
    dev = [r for r in regs if r["tipo"] == "devuelto"]
    lineas = []
    if canc:
        c = Counter(r["categoria"] for r in canc)
        top = c.most_common(3)
        sin = c.get("Ya no lo quiere (sin motivo)", 0)
        lineas.append(f"Cancelados ({len(canc)}): " + ", ".join(f"{k.lower()} {v}" for k, v in top) + ".")
        if sin:
            lineas.append(f"En {sin} de {len(canc)} cancelaciones ({round(sin * 100 / len(canc))} %) no consta el motivo real: conviene preguntar siempre por qué.")
        d = sum(r["rechazaDescuento"] for r in canc)
        if d:
            lineas.append(f"{d} clientes rechazaron el descuento ofrecido al cancelar: el descuento no está salvando pedidos.")
    if dev:
        auto = sum(r["categoria"] == "Devuelto automático por Beeping" for r in dev)
        lineas.append(f"Incidencias devueltas ({len(dev)}): {auto} automáticas por Beeping sin gestión ({round(auto * 100 / len(dev))} %); "
                      f"el resto, sobre todo «ya no lo quiere» y falta de dinero.")
    if carritos:
        ent = sum(1 for c in carritos if "ENTREG" in str(c[2] if len(c) > 2 else "").upper())
        lineas.append(f"Carritos recuperados: {len(carritos)}, de ellos {ent} ya entregados.")
    return lineas


def main():
    src = json.load(open(sys.argv[1], encoding="utf-8"))
    dry = "--dry-run" in sys.argv
    regs = registros(src.get("cancelados", []), "cancelado") + registros(src.get("devueltos", []), "devuelto")
    carritos = [c for c in src.get("carritos", []) if c and str(c[0]).strip()]
    now = datetime.now(timezone.utc).isoformat()
    rec = {"id": "motivos", "fecha": now, "fuente": "Sheet PEDIDOS E INCIDENCIAS", "registros": regs,
           "carritos": [{"carrito": str(c[0]).strip(), "obs": str(c[1]) if len(c) > 1 else "", "estado": str(c[2]) if len(c) > 2 else ""} for c in carritos],
           "confirmados": int(src.get("confirmados") or 0), "resumen": src.get("resumen") or resumen(regs, int(src.get("confirmados") or 0), carritos)}
    if not dry:
        body = json.dumps([{"clave": "crm:sistema:motivos", "valor": rec, "actualizado": now}]).encode()
        req = urllib.request.Request(URL, data=body, method="POST", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                                     "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
        urllib.request.urlopen(req, timeout=30).read()
    print(json.dumps({"ok": True, "dry_run": dry, "registros": len(regs),
                      "por_categoria": Counter(r["categoria"] for r in regs), "resumen": rec["resumen"]}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
