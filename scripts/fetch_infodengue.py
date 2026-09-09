#!/usr/bin/env python3
"""
Busca a série semanal de dengue, chikungunya e zika para o município de
São Paulo na API do InfoDengue (Fiocruz/FGV) e grava em data/infodengue.json.

Uso:
    python scripts/fetch_infodengue.py            # últimas ~2 temporadas
    python scripts/fetch_infodengue.py --anos 3   # mais histórico

Não precisa de chave. Só depende da biblioteca padrão do Python.
Documentação da API: https://info.dengue.mat.br/services/api/doc
"""

import argparse
import datetime as dt
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://info.dengue.mat.br/api/alertcity"
GEOCODE_SP = 3550308          # código IBGE do município de São Paulo
DOENCAS = ("dengue", "chikungunya", "zika")
NIVEIS = {1: "verde", 2: "amarelo", 3: "laranja", 4: "vermelho"}

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "data" / "infodengue.json"


def buscar(doenca: str, ano_ini: int, ano_fim: int) -> list[dict]:
    params = {
        "geocode": GEOCODE_SP,
        "disease": doenca,
        "format": "json",
        "ew_start": 1,
        "ew_end": 53,
        "ey_start": ano_ini,
        "ey_end": ano_fim,
    }
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "epimapa-sp/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def normalizar(linha: dict) -> dict:
    """Mantém só o que o site usa, com nomes estáveis.

    A API devolve muitas colunas (clima, Rt, tweets...). Se o esquema mudar,
    os .get() abaixo evitam que o script quebre — o campo vira null.
    """
    inicio = linha.get("data_iniSE")
    if isinstance(inicio, (int, float)):           # epoch em milissegundos
        inicio = dt.datetime.utcfromtimestamp(inicio / 1000).date().isoformat()

    se = int(linha.get("SE", 0))                    # formato AAAASS, ex. 202634
    nivel = int(linha.get("nivel") or 0)
    return {
        "se": se % 100,
        "ano": se // 100,
        "inicio": inicio,
        "casos": linha.get("casos"),
        "casos_est": _arred(linha.get("casos_est")),
        "casos_est_min": _arred(linha.get("casos_est_min")),
        "casos_est_max": _arred(linha.get("casos_est_max")),
        "inc100k": _arred(linha.get("p_inc100k"), 2),
        "nivel": nivel,
        "nivel_nome": NIVEIS.get(nivel),
        "rt": _arred(linha.get("Rt"), 2),
        "pop": linha.get("pop"),
    }


def _arred(v, casas=0):
    if v is None:
        return None
    try:
        return round(float(v), casas) if casas else int(round(float(v)))
    except (TypeError, ValueError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--anos", type=int, default=2, help="quantos anos de histórico")
    args = ap.parse_args()

    hoje = dt.date.today()
    ano_ini = hoje.year - (args.anos - 1)

    saida = {
        "fonte": "InfoDengue (Fiocruz/FGV) — info.dengue.mat.br",
        "municipio": "São Paulo",
        "geocode": GEOCODE_SP,
        "atualizado_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "doencas": {},
    }

    for doenca in DOENCAS:
        print(f"[{doenca}] buscando {ano_ini}–{hoje.year}...", end=" ", flush=True)
        try:
            bruto = buscar(doenca, ano_ini, hoje.year)
        except Exception as e:  # rede, timeout, JSON inválido
            print(f"falhou: {e}")
            saida["doencas"][doenca] = {"erro": str(e), "semanas": []}
            continue

        semanas = sorted((normalizar(l) for l in bruto), key=lambda s: (s["ano"], s["se"]))
        # A API às vezes devolve a semana corrente ainda vazia; descarta.
        semanas = [s for s in semanas if s["casos_est"] is not None]
        atual = semanas[-1] if semanas else None
        anterior = semanas[-2] if len(semanas) > 1 else None

        saida["doencas"][doenca] = {
            "semanas": semanas,
            "atual": atual,
            "variacao_semana": (
                atual["casos_est"] - anterior["casos_est"]
                if atual and anterior and anterior["casos_est"] else None
            ),
        }
        print(f"{len(semanas)} semanas, última SE {atual['se']}/{atual['ano']}" if atual else "sem dados")

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"gravado em {SAIDA.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
