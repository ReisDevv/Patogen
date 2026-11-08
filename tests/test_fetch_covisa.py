"""
Testes do scraper da COVISA (scripts/fetch_covisa.py). Só biblioteca padrão.

    python -m unittest discover -s tests -v

Para rodar também contra boletins reais (PDFs baixados da página da COVISA):

    COVISA_PDFS=pasta/com/pdfs python -m unittest discover -s tests -v

Os números usados aqui são entradas do parser (tokens), não dados epidemiológicos.
"""

import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))

import fetch_covisa as fc  # noqa: E402

ANOS = [2022, 2023, 2024, 2025, 2026]


class Numeros(unittest.TestCase):
    def test_aceita_ponto_de_milhar(self):
        # Desde a SE 40/2026 a COVISA escreve 11.920 em vez de 11920.
        for tok in ("0", "86,1", "16225", "11.920", "629.403", "1.012", "6.693,3"):
            self.assertRegex(tok, fc.NUM_RE, tok)

    def test_rejeita_o_que_nao_e_celula(self):
        for tok in ("16.10.2026", "40/2026", "1.23", "12.3456", "a1", ""):
            self.assertNotRegex(tok, fc.NUM_RE, tok)

    def test_valores_do_ano_com_milhar(self):
        toks = ["11.920", "99,70", "14.052", "117", "629.403", "5243", "66.891", "557,2", "10.437", "86,9"]
        self.assertEqual(fc.valores_do_ano(ANOS, toks, 2, 2026), (10437, 86.9))
        self.assertEqual(fc.valores_do_ano(ANOS, toks, 2, 2024), (629403, 5243.0))

    def test_valores_do_ano_sem_incidencia(self):
        self.assertEqual(fc.valores_do_ano(ANOS, ["15", "25", "30", "10", "29"], 1, 2026), (29, None))

    def test_ano_fora_do_cabecalho_falha(self):
        with self.assertRaises(RuntimeError):
            fc.valores_do_ano(ANOS, ["1"] * 5, 1, 2027)


def palavra(texto: str, x0: float = 100.0, passo: float = 4.0) -> dict:
    """Palavra no formato do extract_words(return_chars=True), uma letra a cada `passo` pontos."""
    chars = [{"text": c, "x0": x0 + i * passo, "x1": x0 + (i + 1) * passo, "top": 250.0} for i, c in enumerate(texto)]
    return {"text": texto, "x0": x0, "x1": x0 + len(texto) * passo, "top": 250.0, "chars": chars}


class PalavrasColadas(unittest.TestCase):
    # SE 42/2026: o pdfplumber leu "AricanduvaCARRÃO" (subprefeitura + distrito) como uma palavra só.
    def test_separa_subprefeitura_do_distrito(self):
        a, b = fc.separar_colados(palavra("AricanduvaCARRÃO"))
        self.assertEqual((a["text"], b["text"]), ("Aricanduva", "CARRÃO"))
        self.assertEqual(b["x0"], 140.0)
        self.assertEqual(a["x1"], 140.0)

    def test_nao_mexe_no_que_nao_esta_colado(self):
        for t in ("CARRÃO", "Mooca/", "Aricanduva", "JD.ÂNGELA", "ooca/", "11.920", "BrasilândiaCA"):
            self.assertEqual([w["text"] for w in fc.separar_colados(palavra(t))], [t], t)


class PaginaDeEntrada(unittest.TestCase):
    HTML = """
      <strong>Arbovirose Urbanas</strong>
      <a href="/documents/d/saude/boletimarbo-se41_23out26-pdf">Semana Epidemiológica 41- 26 de outubro de 2026</a>
      <a href="/documents/d/saude/boletimarbo-se40_15out26-pdf" target="_blank">Semana Epidemiológica 40- 19 de outubro de 2026</a>
      <a href="https://prefeitura.sp.gov.br/documents/d/saude/boletimarbo-se11_urbanas-pdf">Semana Epidemiológica 11 - 30 de março de 2026</a>
      <a href="/documents/d/saude/1-arbo-urbana_-se07_27fev26-pdf" target="_blank">Semana Epidemiológica 07 - 02 de março de 2026</a>
      <strong>Arbovirose Silvestres</strong>
      <a href="/documents/d/saude/2-arbo_silvestre_se38_02out26-pdf" target="_blank">Semana Epidemiológica 38 - 05 de outubro de 2026</a>
    """

    def test_lista_so_os_urbanos_na_ordem_da_pagina(self):
        links = fc.links_urbanos(self.HTML)
        self.assertEqual([se for _, se in links], [41, 40, 11, 7])
        self.assertEqual(links[0][0], "https://prefeitura.sp.gov.br/documents/d/saude/boletimarbo-se41_23out26-pdf")
        self.assertEqual(links[2][0], "https://prefeitura.sp.gov.br/documents/d/saude/boletimarbo-se11_urbanas-pdf")
        self.assertFalse(any("silvestre" in url for url, _ in links))

    def test_pagina_sem_boletim_falha(self):
        with mock.patch.object(fc, "baixar", return_value=b"<html>nada</html>"):
            with self.assertRaises(RuntimeError):
                fc.descobrir_mais_recente()


class Distritos(unittest.TestCase):
    IDS = {"jardim-sao-luis", "se", "vila-curuca"}

    def test_casa_por_letras_e_apelido(self):
        linhas = {"JARDIM SÃO LUIZ": ["1"], "SÉ": ["2"], "VILA CURUÇA": ["3"]}
        self.assertEqual(fc.casar_distritos(linhas, self.IDS), {"jardim-sao-luis": ["1"], "se": ["2"], "vila-curuca": ["3"]})

    def test_nome_desconhecido_falha(self):
        with self.assertRaises(RuntimeError):
            fc.casar_distritos({"JARDIM SÃO LUIZ": ["1"], "SÉ": ["2"], "VILA CURUÇA": ["3"], "ATLÂNTIDA": ["4"]}, self.IDS)

    def test_distrito_faltando_falha(self):
        with self.assertRaises(RuntimeError):
            fc.casar_distritos({"SÉ": ["2"], "VILA CURUÇA": ["3"]}, self.IDS)

    def test_distrito_duplicado_falha(self):
        # "JARDIM SAO LUIS" e "JARDIM SÃO LUIZ" caem no mesmo id.
        with self.assertRaises(RuntimeError):
            fc.casar_distritos({"JARDIM SAO LUIS": ["1"], "JARDIM SÃO LUIZ": ["1"], "SÉ": ["2"], "VILA CURUÇA": ["3"]}, self.IDS)


class Totais(unittest.TestCase):
    IDS = {"se", "vila-curuca"}

    def extrair(self, linhas, extras):
        with mock.patch.object(fc, "extrair_quadro", return_value=(ANOS, linhas, extras)):
            return fc.extrair_doenca("dengue", [], 2026, self.IDS)

    def linha(self, casos_2026):
        return ["1", "1,0", "1", "1,0", "1.000", "1,0", "1", "1,0", casos_2026, "9,9"]

    def test_soma_confere_com_milhar(self):
        bloco = self.extrair(
            {"SÉ": self.linha("1.200"), "VILA CURUÇA": self.linha("30")},
            {"total": self.linha("1.235"), "eminvestigacao": ["0", "0", "0", "0", "5"]},
        )
        self.assertEqual(bloco["total"], 1235)
        self.assertEqual(bloco["em_investigacao"], 5)
        self.assertEqual(bloco["distritos"]["se"], {"casos_ano": 1200, "inc100k_ano": 9.9})

    def test_soma_diferente_do_total_falha(self):
        with self.assertRaises(RuntimeError):
            self.extrair({"SÉ": self.linha("1.200"), "VILA CURUÇA": self.linha("30")}, {"total": self.linha("1.231")})

    def test_total_ilegivel_falha(self):
        # Era o erro real da SE 40: o TOTAL perdeu os números com ponto de milhar.
        with self.assertRaises(RuntimeError):
            self.extrair({"SÉ": self.linha("1"), "VILA CURUÇA": self.linha("1")}, {"total": ["99,70", "117", "5243", "557,2", "86,9"]})


class Derivado(unittest.TestCase):
    def snapshot(self, se, casos):
        return {
            "fonte": f"COVISA/SMS-SP, boletim SE {se}/2026", "url": f"https://exemplo/se{se}", "se": se, "ano": 2026,
            "publicado_em": "2026-10-26", "periodo": "11/10 a 17/10", "dados_ate": "2026-10-23",
            "extraido_em": "2026-10-27T06:15:00+00:00",
            "doencas": {
                "dengue": {"distritos": {"se": {"casos_ano": casos, "inc100k_ano": 1.5}}},
                "chikungunya": {"distritos": {"se": {"casos_ano": 0}}},
                "zika": {"sem_dados_por_distrito": True},
            },
        }

    def test_metadados_de_rastreabilidade(self):
        d = fc.derivar([self.snapshot(41, 12), self.snapshot(40, 10)])
        self.assertEqual((d["se"], d["ano"]), (41, 2026))
        for campo, valor in (("url", "https://exemplo/se41"), ("publicado_em", "2026-10-26"),
                             ("dados_ate", "2026-10-23"), ("periodo", "11/10 a 17/10"),
                             ("extraido_em", "2026-10-27T06:15:00+00:00")):
            self.assertEqual(d[campo], valor, campo)
        self.assertEqual(d["validacao"]["status"], "aprovada")
        self.assertEqual(d["validacao"]["distritos"], {"dengue": 1, "chikungunya": 1})
        self.assertEqual(d["sem_dados_por_distrito"], ["zika"])
        self.assertEqual(d["doencas"]["zika"], {})

    def test_zero_e_zero_e_inc_ausente_e_null(self):
        d = fc.derivar([self.snapshot(41, 12)])
        self.assertEqual(d["doencas"]["chikungunya"]["se"]["casos_ano"], 0)
        self.assertIsNone(d["doencas"]["chikungunya"]["se"]["inc100k_ano"])
        self.assertIsNone(d["boletim_anterior_se"])


class Datas(unittest.TestCase):
    def test_capa_sem_data_de_publicacao_falha(self):
        pdf = mock.Mock()
        pdf.pages = [mock.Mock(extract_text=lambda: "BOLETIM ... SEMANA 41/2026 (11/10 A 17/10)")]
        with mock.patch.object(fc, "localizar_quadros", return_value={}), self.assertRaisesRegex(RuntimeError, "publicação"):
            fc.montar_snapshot(pdf, None, set())


@unittest.skipUnless(os.environ.get("COVISA_PDFS"), "defina COVISA_PDFS com a pasta dos PDFs para testar boletins reais")
class BoletinsReais(unittest.TestCase):
    def test_cada_pdf_extrai_96_distritos_com_soma_conferida(self):
        import io
        ids = {f["properties"]["id"] for f in json.loads((RAIZ / "data" / "distritos.geojson").read_text(encoding="utf-8"))["features"]}
        pdfs = sorted(Path(os.environ["COVISA_PDFS"]).glob("*.pdf"))
        self.assertTrue(pdfs, "nenhum PDF na pasta")
        for arq in pdfs:
            with self.subTest(pdf=arq.name), fc.pdfplumber.open(io.BytesIO(arq.read_bytes())) as pdf:
                s = fc.montar_snapshot(pdf, None, ids)
                for doenca in ("dengue", "chikungunya"):
                    self.assertEqual(len(s["doencas"][doenca]["distritos"]), 96)
                self.assertTrue(s["dados_ate"] and s["publicado_em"])


if __name__ == "__main__":
    unittest.main()
