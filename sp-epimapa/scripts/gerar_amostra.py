#!/usr/bin/env python3
"""
Gera dados DE AMOSTRA para o mapa abrir preenchido quando ainda não há snapshot
real da COVISA em data/covisa/ (ver scripts/fetch_covisa.py).

Grava:
  data/casos_distrito.json  -> casos por distrito, por doença (SINTÉTICO), no
                               mesmo schema que fetch_covisa.py produz
  data/infodengue.json      -> só se ainda não existir; o fetch_infodengue.py
                               sobrescreve com dados reais.

Tudo que sai daqui leva "fonte": "amostra". O site mostra um aviso enquanto
esse for o caso. Nunca suba isso como se fosse dado oficial.

Uso:
    python scripts/gerar_amostra.py
"""

import datetime as dt
import hashlib
import json
import math
import random
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DISTRITOS = RAIZ / "data" / "distritos.geojson"
SAIDA_DISTRITO = RAIZ / "data" / "casos_distrito.json"
SAIDA_INFODENGUE = RAIZ / "data" / "infodengue.json"

random.seed(2026)

# Semana epidemiológica de referência da amostra.
HOJE = dt.date.today()
ANO, SE = HOJE.isocalendar()[0], HOJE.isocalendar()[1]

# Acumulado do ano, na escala de um ano moderado (parecido com 2026 até agosto).
# Chikungunya por distrito é só autóctone, por isso tão pouco. Zika não tem
# quadro por distrito no boletim da COVISA — e a amostra respeita isso.
ACUMULADO_ANO = {"dengue": 9900, "chikungunya": 30}


def centroide(feature) -> tuple[float, float]:
    geom = feature["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    xs, ys, n = 0.0, 0.0, 0
    for poly in polys:
        for x, y in poly[0]:
            xs += x; ys += y; n += 1
    return xs / n, ys / n


def peso_espacial(lon: float, lat: float, doenca: str) -> float:
    """Um gradiente suave + dois focos, só para o mapa não parecer ruído."""
    # Periferia leste/sul mais carregada que o centro expandido.
    dist_centro = math.hypot(lon + 46.63, lat + 23.55)
    base = 0.6 + 1.4 * min(dist_centro / 0.25, 1.0)
    focos = {
        "dengue": [(-46.42, -23.53, 0.08), (-46.72, -23.70, 0.07)],
        "chikungunya": [(-46.47, -23.60, 0.06)],
    }[doenca]
    for fx, fy, r in focos:
        base += 1.8 * math.exp(-(math.hypot(lon - fx, lat - fy) / r) ** 2)
    return base


def nivel_por_incidencia(inc: float) -> int:
    if inc < 20: return 1
    if inc < 60: return 2
    if inc < 150: return 3
    return 4


def main():
    g = json.loads(DISTRITOS.read_text(encoding="utf-8"))
    feats = g["features"]
    pesos = {f["properties"]["id"]: centroide(f) for f in feats}

    doencas = {}
    for doenca, total in ACUMULADO_ANO.items():
        brutos = {}
        for pid, (lon, lat) in pesos.items():
            brutos[pid] = peso_espacial(lon, lat, doenca) * (0.7 + random.random() * 0.6)
        soma = sum(brutos.values())
        por_distrito = {}
        for pid, w in brutos.items():
            casos_ano = int(round(total * w / soma))
            # Diferença para o "boletim anterior": normalmente positiva, às vezes
            # negativa, como acontece quando a COVISA revisa semanas passadas.
            novos = int(round(casos_ano * random.uniform(-0.02, 0.06)))
            pop_fict = 60_000 + (int(hashlib.md5(pid.encode()).hexdigest(), 16) % 120_000)
            inc = casos_ano / pop_fict * 100_000 if doenca == "dengue" else None
            por_distrito[pid] = {
                "casos_ano": casos_ano,
                "inc100k_ano": round(inc, 1) if inc is not None else None,
                "novos_desde_boletim": novos,
            }
        doencas[doenca] = por_distrito
    doencas["zika"] = {}

    SAIDA_DISTRITO.write_text(json.dumps({
        "fonte": "amostra",
        "aviso": "Dados sintéticos gerados por scripts/gerar_amostra.py. Não representam casos reais.",
        "ano": ANO, "se": SE,
        "gerado_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "boletim_anterior_se": {"ano": ANO, "se": SE - 1} if SE > 1 else None,
        "sem_dados_por_distrito": ["zika"],
        "doencas": doencas,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"gravado {SAIDA_DISTRITO.relative_to(RAIZ)} ({len(feats)} distritos x {len(ACUMULADO_ANO)} doenças; zika sem dado por distrito)")

    if SAIDA_INFODENGUE.exists():
        print(f"{SAIDA_INFODENGUE.relative_to(RAIZ)} já existe, mantido")
        return

    # Série municipal fictícia de 26 semanas com formato idêntico ao real.
    base_semanal = {"dengue": 7500, "chikungunya": 260, "zika": 60}
    saida = {
        "fonte": "amostra",
        "aviso": "Série sintética. Rode scripts/fetch_infodengue.py para dados reais.",
        "municipio": "São Paulo", "geocode": 3550308,
        "atualizado_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "doencas": {},
    }
    for doenca, total in base_semanal.items():
        semanas = []
        inicio = HOJE - dt.timedelta(weeks=25, days=HOJE.weekday())
        for i in range(26):
            d = inicio + dt.timedelta(weeks=i)
            iso = d.isocalendar()
            # Curva sazonal decaindo com um leve repique no fim.
            fator = 2.2 * math.exp(-i / 9) + 0.6 + 0.35 * math.sin(i / 3)
            est = int(total * fator * (0.9 + random.random() * 0.2))
            inc = est / 11_450_000 * 100_000
            nivel = nivel_por_incidencia(inc * 8)  # escala municipal é outra; só ilustrativo
            semanas.append({
                "se": iso[1], "ano": iso[0], "inicio": d.isoformat(),
                "casos": int(est * 0.85), "casos_est": est,
                "casos_est_min": int(est * 0.9), "casos_est_max": int(est * 1.15),
                "inc100k": round(inc, 2), "nivel": nivel,
                "nivel_nome": {1: "verde", 2: "amarelo", 3: "laranja", 4: "vermelho"}[nivel],
                "rt": round(0.8 + random.random() * 0.5, 2), "pop": 11_450_000,
            })
        saida["doencas"][doenca] = {
            "semanas": semanas, "atual": semanas[-1],
            "variacao_semana": semanas[-1]["casos_est"] - semanas[-2]["casos_est"],
        }
    SAIDA_INFODENGUE.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"gravado {SAIDA_INFODENGUE.relative_to(RAIZ)} (amostra)")


if __name__ == "__main__":
    main()
