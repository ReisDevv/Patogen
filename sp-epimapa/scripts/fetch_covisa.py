#!/usr/bin/env python3
"""
Baixa o boletim semanal de arboviroses urbanas da COVISA/SMS-SP (PDF), extrai
os quadros por distrito administrativo (dengue e chikungunya) e grava:

  data/covisa/SE-AAAA-SS.json   snapshot imutável do boletim (nunca reescrito)
  data/casos_distrito.json      derivado dos dois snapshots mais recentes

Uso:
    python scripts/fetch_covisa.py                 # boletim mais recente da página da COVISA
    python scripts/fetch_covisa.py --url URL       # um boletim específico (ex.: semana passada)
    python scripts/fetch_covisa.py --pdf arquivo   # um PDF já baixado
    python scripts/fetch_covisa.py --dry-run       # extrai e valida, não grava nada
    python scripts/fetch_covisa.py --sobrescrever  # aceita regravar o snapshot da mesma SE

O script só grava se os 96 distritos casarem com o GeoJSON e a soma dos distritos
bater com a linha TOTAL do quadro. Qualquer outra coisa é erro, não "melhor esforço".

Depende de pdfplumber (requirements.txt); o resto é biblioteca padrão.
Formato do boletim e por que a extração é assim: docs/covisa-formato.md.
"""

import argparse
import datetime as dt
import io
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit("pdfplumber não instalado: pip install -r requirements.txt")

RAIZ = Path(__file__).resolve().parent.parent
DISTRITOS = RAIZ / "data" / "distritos.geojson"
PASTA_SNAPSHOTS = RAIZ / "data" / "covisa"
SAIDA = RAIZ / "data" / "casos_distrito.json"

PAGINA_ENTRADA = "https://www.prefeitura.sp.gov.br/web/saude/w/vigilancia_em_saude/boletim_covisa/arboviroses"
BASE = "https://www.prefeitura.sp.gov.br"
USER_AGENT = "epimapa-sp/0.1"   # o servidor devolve 403 para o User-Agent padrão do Python

NUM_RE = re.compile(r"^[0-9]+(,[0-9]+)?$")
ANOS_RE = re.compile(r"^(20[0-9]{2}){4,6}$")
# Como a COVISA escreve -> id do GeoJSON. Só o que a normalização não resolve.
APELIDOS = {"jardimsaoluiz": "jardim-sao-luis"}
# Números por ano em cada quadro: dengue traz N° e INC, chikungunya só N°.
COLUNAS_POR_ANO = {"dengue": 2, "chikungunya": 1}


def letras(s: str) -> str:
    """Só letras e dígitos, minúsculas, sem acento. É assim que nomes são comparados."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def baixar(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def descobrir_mais_recente() -> tuple[str, int]:
    """Primeiro link de boletim urbano na página de entrada (a lista vem do mais novo)."""
    html = baixar(PAGINA_ENTRADA).decode("utf-8", "replace")
    links = re.findall(
        r'href="(/documents/d/saude/boletimarbo-se\d+[^"]*)"[^>]*>\s*Semana\s+Epidemiol\S*\s+(\d+)', html, re.I
    )
    if not links:
        raise RuntimeError("nenhum link de boletim na página de entrada; o HTML mudou?")
    caminho, se = links[0]
    return BASE + caminho, int(se)


def ler_capa(pdf) -> dict:
    texto = pdf.pages[0].extract_text() or ""
    semana = re.search(r"SEMANA\s+(\d{1,2})/(\d{4})", texto)
    if not semana:
        raise RuntimeError("capa sem 'SEMANA NN/AAAA'")
    publicado = None
    pub = re.search(r"PUBLICADO EM:\s*(\d{2})/(\d{2})/(\d{2,4})", texto)
    if pub:
        d, m, a = (int(x) for x in pub.groups())
        publicado = dt.date(a + 2000 if a < 100 else a, m, d).isoformat()
    periodo = re.search(r"\((\d{2}/\d{2})\s+A\s+(\d{2}/\d{2})\)", texto)
    return {
        "se": int(semana.group(1)),
        "ano": int(semana.group(2)),
        "publicado_em": publicado,
        "periodo": f"{periodo.group(1)} a {periodo.group(2)}" if periodo else None,
    }


def localizar_quadros(pdf) -> dict[str, list]:
    """Páginas do quadro por distrito de cada doença, achadas pela legenda
    'Quadro N – ... Distrito administrativo (DA) ...'. Devolve {doença: [(página, legenda)]}."""
    quadros: dict[str, list] = {}
    for pagina in pdf.pages:
        texto = pagina.extract_text() or ""
        for linha in texto.split("\n"):
            if not re.match(r"^Quadro \d+", linha):
                continue
            inicio = texto.index(linha)
            legenda = texto[inicio:inicio + 400].split("Fonte")[0]
            if "distritoadministrativo" not in letras(legenda):
                continue
            for doenca in ("dengue", "chikungunya", "zika"):
                if doenca in letras(legenda):
                    quadros.setdefault(doenca, []).append((pagina, legenda))
                    break
            break
    return quadros


def caixa_alta(t: str) -> bool:
    l = [c for c in t if c.isalpha()]
    return bool(l) and all(c.isupper() for c in l)


def agrupar_linhas(palavras: list[dict], tol: float = 2.0) -> list[dict]:
    linhas: list[dict] = []
    for w in sorted(palavras, key=lambda w: w["top"]):
        if linhas and abs(linhas[-1]["top"] - w["top"]) <= tol:
            linhas[-1]["palavras"].append(w)
        else:
            linhas.append({"top": w["top"], "palavras": [w]})
    return linhas


def extrair_pagina(pagina, por_ano: int) -> tuple[list[int], dict[str, list[str]], dict[str, list[str]]]:
    """Uma página do quadro por distrito -> (anos do cabeçalho, {nome: números}, {rótulo: números}).

    O PDF não tem grade de tabela, então a leitura é por posição das palavras.
    Os parâmetros (tolerâncias, janelas) estão justificados em docs/covisa-formato.md.
    """
    palavras = pagina.extract_words(x_tolerance=5, y_tolerance=1)
    guarda = pagina.width * 0.15     # descarta o rótulo CRS rotacionado na margem
    numeros = [w for w in palavras if NUM_RE.match(w["text"]) and w["x0"] > guarda]
    caps = [w for w in palavras if not NUM_RE.match(w["text"]) and caixa_alta(w["text"]) and w["x0"] > guarda]

    anos: list[int] | None = None
    ancoras: list[tuple[float, list[str]]] = []
    for ln in agrupar_linhas(numeros):
        toks = sorted(ln["palavras"], key=lambda w: w["x0"])
        junto = "".join(t["text"] for t in toks)
        if anos is None and ANOS_RE.match(junto):
            anos = [int(a) for a in re.findall(r"20[0-9]{2}", junto)]
            continue
        ancoras.append((ln["top"], [t["text"] for t in toks]))
    if anos is None:
        raise RuntimeError(f"página {pagina.page_number}: cabeçalho de anos não encontrado")
    esperado = len(anos) * por_ano

    def janela(top: float) -> list[dict]:
        return [c for c in caps if abs(c["top"] - top) <= 6.5]

    borda = min(
        (c["x0"] for top, toks in ancoras if len(toks) == esperado for c in janela(top) if len(c["text"]) >= 3),
        default=None,
    )
    if borda is None:
        raise RuntimeError(f"página {pagina.page_number}: coluna de distrito não encontrada")

    linhas: dict[str, list[str]] = {}
    extras: dict[str, list[str]] = {}
    for top, toks in ancoras:
        nome = "".join(
            c["text"] for c in sorted((c for c in janela(top) if c["x0"] >= borda - 2), key=lambda c: (c["top"], c["x0"]))
        )
        rotulo = letras("".join(w["text"] for w in palavras if abs(w["top"] - top) <= 6 and w["x0"] < borda - 2))
        if len(toks) == esperado and nome and rotulo != "total":
            if nome in linhas:
                raise RuntimeError(f"página {pagina.page_number}: distrito repetido: {nome}")
            linhas[nome] = toks
        else:
            extras[rotulo] = toks
    return anos, linhas, extras


def extrair_quadro(paginas: list, por_ano: int) -> tuple[list[int], dict[str, list[str]], dict[str, list[str]]]:
    anos_ref, linhas, extras = None, {}, {}
    for pagina, _ in paginas:
        anos, l, e = extrair_pagina(pagina, por_ano)
        if anos_ref is not None and anos != anos_ref:
            raise RuntimeError(f"anos diferentes entre as páginas do quadro: {anos_ref} vs {anos}")
        anos_ref = anos
        repetidos = set(l) & set(linhas)
        if repetidos:
            raise RuntimeError(f"distritos repetidos entre páginas: {sorted(repetidos)}")
        linhas.update(l)
        extras.update(e)
    return anos_ref, linhas, extras


def casar_distritos(linhas: dict[str, list[str]], ids: set[str]) -> dict[str, list[str]]:
    por_letras = {letras(i): i for i in ids}
    achados: dict[str, list[str]] = {}
    sem_par = []
    for nome, toks in linhas.items():
        chave = letras(nome)
        rid = por_letras.get(chave) or APELIDOS.get(chave)
        if rid is None:
            sem_par.append(nome)
        elif rid in achados:
            raise RuntimeError(f"distrito casou duas vezes: {rid}")
        else:
            achados[rid] = toks
    faltando = sorted(ids - set(achados))
    if sem_par or faltando:
        raise RuntimeError(f"sem correspondência no GeoJSON: {sem_par}; ids sem linha no quadro: {faltando}")
    return achados


def valores_do_ano(anos: list[int], toks: list[str], por_ano: int, ano: int) -> tuple[int, float | None]:
    if ano not in anos:
        raise RuntimeError(f"ano {ano} do boletim não está no cabeçalho do quadro {anos}")
    i = anos.index(ano) * por_ano
    casos = int(toks[i])
    inc = float(toks[i + 1].replace(",", ".")) if por_ano == 2 else None
    return casos, inc


def extrair_doenca(doenca: str, paginas: list, ano: int, ids: set[str]) -> dict:
    por_ano = COLUNAS_POR_ANO[doenca]
    anos, linhas, extras = extrair_quadro(paginas, por_ano)
    por_id = casar_distritos(linhas, ids)

    distritos = {}
    for rid, toks in sorted(por_id.items()):
        casos, inc = valores_do_ano(anos, toks, por_ano, ano)
        distritos[rid] = {"casos_ano": casos} if inc is None else {"casos_ano": casos, "inc100k_ano": inc}

    total_toks = extras.get("total")
    if not total_toks or len(total_toks) != len(anos) * por_ano:
        raise RuntimeError(f"{doenca}: linha TOTAL não encontrada ou ilegível: {total_toks}")
    total, _ = valores_do_ano(anos, total_toks, por_ano, ano)
    inv_toks = extras.get("eminvestigacao")
    investigacao = None
    if inv_toks is not None:
        if len(inv_toks) != len(anos):
            raise RuntimeError(f"{doenca}: linha EM INVESTIGAÇÃO ilegível: {inv_toks}")
        investigacao = int(inv_toks[anos.index(ano)])
    soma = sum(d["casos_ano"] for d in distritos.values())
    if soma + (investigacao or 0) != total:
        raise RuntimeError(f"{doenca}: soma dos distritos {soma} + em investigação {investigacao} != TOTAL {total}")

    bloco = {"total": total, "em_investigacao": investigacao, "anos_no_quadro": anos, "distritos": distritos}
    if doenca == "chikungunya":
        bloco["observacao"] = "só casos confirmados autóctones (o boletim não traz importados nem incidência por distrito)"
    return bloco


def dados_ate(paginas: list) -> str | None:
    for pagina, _ in paginas:
        m = re.search(r"dados provis[óo]rios at[ée]\s*(\d{2})[./](\d{2})[./](\d{4})", pagina.extract_text() or "")
        if m:
            d, mes, a = (int(x) for x in m.groups())
            return dt.date(a, mes, d).isoformat()
    return None


def montar_snapshot(pdf, url: str | None, ids: set[str]) -> dict:
    capa = ler_capa(pdf)
    quadros = localizar_quadros(pdf)
    for doenca in COLUNAS_POR_ANO:
        if doenca not in quadros:
            raise RuntimeError(f"quadro por distrito de {doenca} não encontrado no PDF")
    if any(str(capa["ano"]) in legenda for _, legenda in quadros.get("zika", [])):
        raise RuntimeError("zika passou a ter quadro por distrito no ano corrente; atualize o script e o schema")

    doencas = {d: extrair_doenca(d, quadros[d], capa["ano"], ids) for d in COLUNAS_POR_ANO}
    doencas["zika"] = {
        "sem_dados_por_distrito": True,
        "observacao": "o quadro por distrito de zika só cobre 2016–2017; sem caso autóctone desde 2018",
    }
    return {
        "fonte": f"COVISA/SMS-SP, boletim SE {capa['se']}/{capa['ano']}",
        "url": url,
        **capa,
        "dados_ate": dados_ate(quadros["dengue"]),
        "extraido_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "doencas": doencas,
    }


def derivar(snapshots: list[dict]) -> dict:
    """casos_distrito.json a partir dos dois snapshots mais recentes."""
    ordenados = sorted(snapshots, key=lambda s: (s["ano"], s["se"]))
    atual = ordenados[-1]
    anterior = ordenados[-2] if len(ordenados) > 1 else None
    doencas, sem_dados = {}, []
    for doenca in ("dengue", "chikungunya", "zika"):
        bloco = atual["doencas"].get(doenca, {})
        if bloco.get("sem_dados_por_distrito") or "distritos" not in bloco:
            doencas[doenca] = {}
            sem_dados.append(doenca)
            continue
        ant = anterior["doencas"].get(doenca, {}).get("distritos") if anterior else None
        doencas[doenca] = {
            rid: {
                "casos_ano": v["casos_ano"],
                "inc100k_ano": v.get("inc100k_ano"),
                "novos_desde_boletim": v["casos_ano"] - ant[rid]["casos_ano"] if ant and rid in ant else None,
            }
            for rid, v in bloco["distritos"].items()
        }
    return {
        "fonte": atual["fonte"],
        "ano": atual["ano"],
        "se": atual["se"],
        "gerado_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "boletim_anterior_se": {"ano": anterior["ano"], "se": anterior["se"]} if anterior else None,
        "sem_dados_por_distrito": sem_dados,
        "doencas": doencas,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Extrai o boletim COVISA de arboviroses por distrito.")
    ap.add_argument("--url", help="URL de um boletim específico")
    ap.add_argument("--pdf", type=Path, help="PDF já baixado (não acessa a rede)")
    ap.add_argument("--dry-run", action="store_true", help="só extrai e valida; não grava")
    ap.add_argument("--sobrescrever", action="store_true", help="aceita regravar snapshot já existente da mesma SE")
    args = ap.parse_args()
    if args.pdf and args.url:
        ap.error("use --pdf ou --url, não os dois")

    se_esperada = None
    if args.pdf:
        url, conteudo = None, args.pdf.read_bytes()
        print(f"lendo {args.pdf}")
    else:
        url = args.url
        if not url:
            url, se_esperada = descobrir_mais_recente()
            print(f"boletim mais recente na página da COVISA: SE {se_esperada}")
        conteudo = baixar(url)
        print(f"baixado {url} ({len(conteudo) // 1024} KB)")

    ids = {f["properties"]["id"] for f in json.loads(DISTRITOS.read_text(encoding="utf-8"))["features"]}
    with pdfplumber.open(io.BytesIO(conteudo)) as pdf:
        snapshot = montar_snapshot(pdf, url, ids)
    if se_esperada is not None and se_esperada != snapshot["se"]:
        raise RuntimeError(f"a página diz SE {se_esperada}, a capa do PDF diz SE {snapshot['se']}")

    print(f"SE {snapshot['se']}/{snapshot['ano']} ({snapshot['periodo']}), publicado em {snapshot['publicado_em']}, dados até {snapshot['dados_ate']}")
    for doenca in COLUNAS_POR_ANO:
        b = snapshot["doencas"][doenca]
        inv = f", {b['em_investigacao']} em investigação" if b["em_investigacao"] is not None else ""
        print(f"  {doenca}: {len(b['distritos'])} distritos, total {b['total']}{inv} — soma confere")

    destino = PASTA_SNAPSHOTS / f"SE-{snapshot['ano']}-{snapshot['se']:02d}.json"
    if destino.exists() and not args.sobrescrever and not args.dry_run:
        raise RuntimeError(f"{destino.relative_to(RAIZ)} já existe. A COVISA republicou a SE? Confira e use --sobrescrever se for o caso.")
    existentes = [
        json.loads(p.read_text(encoding="utf-8")) for p in sorted(PASTA_SNAPSHOTS.glob("SE-*.json")) if p != destino
    ]
    derivado = derivar(existentes + [snapshot])
    ant = derivado["boletim_anterior_se"]
    resumo = f"casos_distrito.json -> SE {derivado['se']}/{derivado['ano']}" + (f", comparado com SE {ant['se']}/{ant['ano']}" if ant else ", sem boletim anterior")
    if args.dry_run:
        print(f"dry-run: nada gravado ({resumo})")
        return 0

    PASTA_SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
    SAIDA.write_text(json.dumps(derivado, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"gravado {destino.relative_to(RAIZ)}; {resumo}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f"erro: {e}", file=sys.stderr)
        sys.exit(1)
