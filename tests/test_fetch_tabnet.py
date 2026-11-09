"""Testes da leitura e da validação do TabNet municipal (fetch_tabnet.py), sem rede. Só biblioteca padrão."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import fetch_tabnet as ft  # noqa: E402

IDS = {"agua-rasa", "socorro", "jardim-sao-luis"}

PAGINA = """<SELECT NAME="Arquivos" MULTIPLE><OPTION VALUE="x2611.dbf" SELECTED >Nov/2026
<OPTION VALUE="x2610.dbf">Out/2026<OPTION VALUE="x2512.dbf">Dez/2025</SELECT>
<SELECT NAME="SAno_incidência"><OPTION VALUE="TODAS_AS_CATEGORIAS__" SELECTED >Todas as categorias
<OPTION VALUE="18">2025<OPTION VALUE="19">2026</SELECT>
Dados do período de: - 2015 a 2020 atualizados em 31/01/2026 - 2021 a 2026 atualizados em 31/10/2026"""


def prn(*linhas: str) -> str:
    return '<PRE>\n"Distrito Administ(Res)";"Nº de Casos"\n' + "\n".join(linhas) + "\n&\n</PRE>"


class Formulario(unittest.TestCase):
    def test_resolve_codigo_pelo_rotulo(self):
        self.assertEqual(ft.valor(PAGINA, "SAno_incidência", "2026"), "19")

    def test_arquivos_do_ano_por_mes(self):
        self.assertEqual(ft.arquivos(PAGINA, "meses", 2026), ["x2611.dbf", "x2610.dbf"])

    def test_ano_sem_arquivo_falha(self):
        with self.assertRaises(RuntimeError):
            ft.arquivos(PAGINA, "meses", 2027)

    def test_campo_inexistente_falha(self):
        with self.assertRaises(RuntimeError):
            ft.valor(PAGINA, "SNaoExiste", "2026")

    def test_data_mais_recente_do_rodape(self):
        self.assertEqual(ft.atualizado_em(PAGINA), "2026-10-31")


class Tabela(unittest.TestCase):
    def test_le_linhas_e_total(self):
        linhas, total = ft.tabela(prn('"&Aacute;gua Rasa";1.234', '"Socorro";-', '"Total";1234'))
        self.assertEqual(linhas, [("Água Rasa", 1234), ("Socorro", 0)])
        self.assertEqual(total, 1234)

    def test_sem_tabela_falha(self):
        with self.assertRaises(RuntimeError):
            ft.tabela("<html>erro</html>")


class Casar(unittest.TestCase):
    def test_casa_apelidos_e_separa_sem_distrito_e_fora(self):
        linhas = [("ÁGUA RASA", 5), ("CAPELA DO SOCORRO", 2), ("Jardim São Luiz", 1),
                  ("Não localizado", 3), ("Localizado fora do MSP", 4)]
        self.assertEqual(ft.casar(linhas, 15, IDS), ({"agua-rasa": 5, "socorro": 2, "jardim-sao-luis": 1}, 3, 4))

    def test_nome_desconhecido_falha(self):
        with self.assertRaisesRegex(RuntimeError, "Atlântida"):
            ft.casar([("Água Rasa", 1), ("Socorro", 1), ("Jardim São Luís", 1), ("Atlântida", 1)], 4, IDS)

    def test_distrito_faltando_falha(self):
        with self.assertRaisesRegex(RuntimeError, "socorro"):
            ft.casar([("Água Rasa", 1), ("Jardim São Luís", 1)], 2, IDS)

    def test_soma_diferente_do_total_falha(self):
        with self.assertRaisesRegex(RuntimeError, "Total"):
            ft.casar([("Água Rasa", 1), ("Socorro", 1), ("Jardim São Luís", 1)], 4, IDS)


if __name__ == "__main__":
    unittest.main()
