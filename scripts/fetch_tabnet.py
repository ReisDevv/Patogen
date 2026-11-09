#!/usr/bin/env python3
"""
Busca no TabNet da Secretaria Municipal da Saúde de São Paulo os casos do ano por distrito
administrativo de residência de SRAG, covid-19, tuberculose, meningite e sarampo, e grava
data/tabnet_distrito.json.

Uso:
    python scripts/fetch_tabnet.py              # todas as doenças
    python scripts/fetch_tabnet.py srag covid   # só algumas
    python scripts/fetch_tabnet.py --dry-run    # consulta e valida, não grava

Cada doença só é gravada se todos os nomes de distrito casarem com o GeoJSON (os 96, sem
repetição) e a soma dos distritos + "sem distrito" bater com o Total do TabNet. Uma doença
que falha mantém o conjunto anterior no arquivo; as outras são gravadas, e o script sai com 1.
Só biblioteca padrão. Como o TabNet é por dentro: docs/tabnet-formato.md.
"""

import argparse
import datetime as dt
import html
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DISTRITOS = RAIZ / "data" / "distritos.geojson"
SAIDA = RAIZ / "data" / "tabnet_distrito.json"

TABNET = "https://tabnet.saude.prefeitura.sp.gov.br/cgi/"   # http:// não responde fora do navegador
PASTA = "secretarias/saude/TABNET/"
USER_AGENT = "Mozilla/5.0 (compatible; epimapa-sp/0.1)"

# arquivos: "ano" = opção cujo rótulo é o ano ("2026"); "meses" = todas as do ano ("Jan/2026", "Fev/2026"...).
# filtros: nome do campo -> rótulo da opção; "{ano}" vira o ano. Os códigos das opções são resolvidos na página,
# porque mudam quando o TabNet ganha um ano novo.
DOENCAS: dict[str, dict] = {
    "srag": {
        "def": "RSRAG/sragh.def", "linha": "Distrito_Administ(Res)", "arquivos": "ano", "filtros": {},
        "fonte": "SIVEP-Gripe/DVE/COVISA/SMS-SP",
        "medida": "internações por SRAG no ano",
        "observacao": "síndrome respiratória aguda grave hospitalizada, todas as causas (gripe, covid-19, VSR e outros vírus)",
    },
    "covid": {
        "def": "RCOVID19/covid19.def", "linha": "Distrito_Administ(Res)", "arquivos": "meses",
        "filtros": {"SClassificação_Final": "Caso Confirmado de COVID-19"},
        "fonte": "e-SUS VE/DVE/COVISA/SMS-SP",
        "medida": "casos confirmados no ano",
        "observacao": "casos de síndrome gripal confirmados para covid-19, por mês de notificação",
    },
    "tuberculose": {
        "def": "TBWEB/TBWEB.def", "linha": "Distrito_Administ(Res)", "arquivos": "ano",
        "filtros": {"SAno_incidência": "{ano}", "SMunicípio_de_residência": "SAO PAULO", "STipo_de_caso": "Novo"},
        "fonte": "TBWEB/COVISA/SMS-SP",
        "medida": "casos novos no ano",
        "observacao": "casos novos de residentes na capital (sem recidivas e retratamentos), por ano de incidência",
    },
    "meningite": {
        "def": "RMENIN/RmeningeN.def", "linha": "Distrito_Administrativo(Res)", "arquivos": "ano", "filtros": {},
        "fonte": "SINAN NET/COVISA/SMS-SP",
        "medida": "casos confirmados no ano",
        "observacao": "todas as causas (viral, bacteriana e outras), por ano de notificação",
    },
    "sarampo": {
        "def": "REXANT/Rexantn.def", "linha": "Distrito_Administrativo(Res)", "arquivos": "ano",
        "filtros": {"SClassificação_Final": "SARAMPO"},
        "fonte": "SINAN NET/COVISA/SMS-SP",
        "medida": "casos confirmados no ano",
        "observacao": "casos confirmados, por ano de notificação",
    },
}

# Linhas do TabNet que não são distrito (endereço sem distrito, fora da cidade, em branco). Qualquer outro nome
# que não case com o GeoJSON é erro.
SEM_DISTRITO = {"naolocalizado", "naolocalizadoouseminformacaovalida", "danaoclassificado", "embranco", "ignorado", "ignbranco"}
FORA_DO_MUNICIPIO = {"localizadoforadomsp"}   # mora fora da capital: fica fora do total da cidade
APELIDOS = {"jardimsaoluiz": "jardim-sao-luis", "capeladosocorro": "socorro"}


def letras(s: str) -> str:
    """Só letras e dígitos, minúsculas, sem acento. Igual a fetch_covisa.letras (que exige pdfplumber para importar)."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def pedir(caminho: str, campos: list[tuple[str, str]] | None = None) -> str:
    dados = urllib.parse.urlencode(campos, encoding="cp1252").encode() if campos else None
    req = urllib.request.Request(TABNET + caminho, data=dados, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read().decode("cp1252")


def opcoes(pagina: str, campo: str) -> list[tuple[str, str]]:
    """[(valor, rótulo)] do <SELECT NAME=campo> do formulário do TabNet."""
    m = re.search(r'<SELECT[^>]*NAME="' + re.escape(campo) + r'"[^>]*>(.*?)</SELECT>', pagina, re.S | re.I)
    if not m:
        raise RuntimeError(f"campo {campo!r} não existe no formulário do TabNet")
    return [(v, html.unescape(r).strip()) for v, r in re.findall(r'VALUE="([^"]*)"[^>]*>([^<]*)', m.group(1), re.I)]


def valor(pagina: str, campo: str, rotulo: str) -> str:
    achados = [v for v, r in opcoes(pagina, campo) if r == rotulo]
    if len(achados) != 1:
        raise RuntimeError(f"{campo}: esperava uma opção {rotulo!r}, achei {len(achados)}")
    return achados[0]


def arquivos(pagina: str, modo: str, ano: int) -> list[str]:
    ok = (lambda r: r == str(ano)) if modo == "ano" else (lambda r: r.endswith(f"/{ano}"))
    achados = [v for v, r in opcoes(pagina, "Arquivos") if ok(r)]
    if not achados:
        raise RuntimeError(f"o TabNet ainda não tem arquivo de {ano}")
    return achados


def atualizado_em(pagina: str) -> str:
    """Maior data de 'atualizado em DD/MM/AAAA' do rodapé (a tuberculose traz uma por período)."""
    datas = re.findall(r"atualiza\w*(?:\s+em)?:?\s*(\d{2})/(\d{2})/(\d{4})", pagina, re.I)
    if not datas:
        raise RuntimeError("rodapé sem data de atualização")
    return max(f"{a}-{m}-{d}" for d, m, a in datas)


def tabela(prn: str) -> tuple[list[tuple[str, int]], int]:
    """Resultado em 'colunas separadas por ;' -> ([(rótulo, casos)], total)."""
    m = re.search(r"<PRE>(.*?)</PRE>", prn, re.S | re.I)
    if not m:
        raise RuntimeError("o TabNet não devolveu tabela (consulta recusada ou fora do ar)")
    linhas, total = [], None
    for rot, num in re.findall(r'^"([^"]*)";\s*([\d.\-]+)\s*$', html.unescape(m.group(1)), re.M):
        n = 0 if num == "-" else int(num.replace(".", ""))
        if rot == "Total":
            total = n
        else:
            linhas.append((rot, n))
    if total is None:
        raise RuntimeError("tabela sem linha Total")
    return linhas, total


def casar(linhas: list[tuple[str, int]], total: int, ids: set[str]) -> tuple[dict[str, int], int, int]:
    """-> (casos por id, sem distrito, fora do município). Falha alto em qualquer coisa que não feche."""
    por_letras = {letras(i): i for i in ids}
    distritos: dict[str, int] = {}
    sem_distrito, fora, sem_par = 0, 0, []
    for rot, n in linhas:
        chave = letras(rot)
        rid = por_letras.get(chave) or APELIDOS.get(chave)
        if rid:
            if rid in distritos:
                raise RuntimeError(f"distrito casou duas vezes: {rid}")
            distritos[rid] = n
        elif chave in SEM_DISTRITO:
            sem_distrito += n
        elif chave in FORA_DO_MUNICIPIO:
            fora += n
        else:
            sem_par.append(rot)
    faltando = sorted(ids - set(distritos))
    if sem_par or faltando:
        raise RuntimeError(f"sem correspondência no GeoJSON: {sem_par}; ids sem linha no TabNet: {faltando}")
    soma = sum(distritos.values()) + sem_distrito + fora
    if soma != total:
        raise RuntimeError(f"distritos + sem distrito + fora = {soma}, Total do TabNet = {total}")
    return distritos, sem_distrito, fora


def buscar(doenca: str, ano: int, ids: set[str]) -> dict:
    cfg = DOENCAS[doenca]
    caminho = PASTA + cfg["def"]
    pagina = pedir("deftohtm3.exe?" + caminho)
    campos = [("Linha", cfg["linha"]), ("Coluna", "--Não-Ativa--"), ("Incremento", "Nº_de_Casos")]
    campos += [("Arquivos", a) for a in arquivos(pagina, cfg["arquivos"], ano)]
    campos += [(c, valor(pagina, c, r.format(ano=ano))) for c, r in cfg["filtros"].items()]
    campos += [("zeradas", "exibirlz"), ("formato", "prn"), ("mostre", "Mostra")]   # zeradas: distrito com 0 vem como 0
    distritos, sem_distrito, fora = casar(*tabela(pedir("tabcgi.exe?" + caminho, campos)), ids)
    return {
        "fonte": cfg["fonte"], "url": TABNET + "deftohtm3.exe?" + caminho,
        "ano": ano, "atualizado_em": atualizado_em(pagina),
        "extraido_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "medida": cfg["medida"], "observacao": cfg["observacao"],
        # total = moradores da capital (com ou sem distrito); quem mora fora fica só em fora_do_municipio
        "total": sum(distritos.values()) + sem_distrito, "sem_distrito": sem_distrito, "fora_do_municipio": fora,
        "distritos": {i: {"casos_ano": distritos[i]} for i in sorted(distritos)},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("doencas", nargs="*", help=f"padrão: todas ({', '.join(DOENCAS)})")
    ap.add_argument("--ano", type=int, default=dt.date.today().year)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if desconhecidas := set(args.doencas) - set(DOENCAS):
        ap.error(f"doença desconhecida: {', '.join(sorted(desconhecidas))}")
    args.doencas = args.doencas or list(DOENCAS)

    ids = {f["properties"]["id"] for f in json.loads(DISTRITOS.read_text(encoding="utf-8"))["features"]}
    saida = json.loads(SAIDA.read_text(encoding="utf-8")) if SAIDA.exists() else {"doencas": {}}
    falhas = []
    for d in args.doencas:
        try:
            bloco = buscar(d, args.ano, ids)
        except Exception as e:   # uma doença que falha não derruba as outras
            falhas.append(d)
            print(f"{d}: FALHOU ({e}); mantido o conjunto anterior", file=sys.stderr)
            continue
        saida["doencas"][d] = bloco
        print(f"{d}: {bloco['total']} ({bloco['sem_distrito']} sem distrito), TabNet atualizado em {bloco['atualizado_em']}")
    if len(falhas) < len(args.doencas) and not args.dry_run:
        saida["fonte"] = "TabNet da Secretaria Municipal da Saúde de São Paulo"
        saida["gerado_em"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        saida["doencas"] = {d: saida["doencas"][d] for d in DOENCAS if d in saida["doencas"]}
        SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
