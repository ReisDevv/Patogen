"""Testes da trava que impede o InfoDengue de gravar série vazia por cima da válida. Só biblioteca padrão."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import fetch_infodengue as fi  # noqa: E402

SEMANA = {"SE": 202642, "data_iniSE": 1792281600000, "casos": 2, "casos_est": 12.0, "nivel": 1}


class Trava(unittest.TestCase):
    def rodar(self, anterior: dict, buscar):
        with tempfile.TemporaryDirectory() as pasta:
            saida = Path(pasta) / "infodengue.json"
            saida.write_text(json.dumps({"doencas": anterior}), encoding="utf-8")
            with mock.patch.object(fi, "SAIDA", saida), mock.patch.object(fi, "RAIZ", Path(pasta)), \
                    mock.patch.object(fi, "buscar", side_effect=buscar), mock.patch.object(sys, "argv", ["x"]):
                codigo = fi.main()
            return codigo, json.loads(saida.read_text(encoding="utf-8"))

    def test_erro_de_rede_nao_grava(self):
        anterior = {"dengue": {"semanas": [1]}}
        codigo, arquivo = self.rodar(anterior, lambda *a: (_ for _ in ()).throw(TimeoutError("timeout")))
        self.assertEqual(codigo, 1)
        self.assertEqual(arquivo, {"doencas": anterior})

    def test_serie_que_existia_e_voltou_vazia_nao_grava(self):
        anterior = {"dengue": {"semanas": [1]}, "chikungunya": {"semanas": [1]}, "zika": {"semanas": []}}
        codigo, arquivo = self.rodar(anterior, lambda d, *a: [] if d == "dengue" else [SEMANA])
        self.assertEqual(codigo, 1)
        self.assertEqual(arquivo, {"doencas": anterior})

    def test_zika_vazia_como_antes_grava(self):
        anterior = {"dengue": {"semanas": [1]}, "chikungunya": {"semanas": [1]}, "zika": {"semanas": []}}
        codigo, arquivo = self.rodar(anterior, lambda d, *a: [] if d == "zika" else [SEMANA])
        self.assertEqual(codigo, 0)
        self.assertEqual(arquivo["doencas"]["dengue"]["atual"]["se"], 42)
        self.assertEqual(arquivo["doencas"]["zika"]["semanas"], [])


if __name__ == "__main__":
    unittest.main()
