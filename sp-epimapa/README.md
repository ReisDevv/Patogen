# Epimapa SP

Mapa de dengue, chikungunya e zika por distrito da cidade de São Paulo.
Esta é a **etapa 1** do projeto: um site estático que já mostra o produto
funcionando de ponta a ponta — malha dos 96 distritos, busca por distrito ou
subprefeitura, resumo municipal com série de 26 semanas e detalhe por distrito.

Não há backend nem banco ainda. Tudo é HTML + JSON, o que permite publicar
de graça no GitHub Pages e validar a ideia antes de gastar com servidor.

## Rodar localmente

O navegador bloqueia `fetch` de arquivos locais, então precisa de um servidor
HTTP simples:

```bash
python -m http.server 8000
# abra http://localhost:8000
```

## Dados

| Arquivo | O que é | De onde vem |
|---|---|---|
| `data/distritos.geojson` | polígonos dos 96 distritos, simplificados para 230 KB | Prefeitura de São Paulo (GeoSampa), via [codigourbano/distritos-sp](https://github.com/codigourbano/distritos-sp) |
| `data/infodengue.json` | série semanal municipal (casos estimados, nível de alerta, Rt) | [InfoDengue](https://info.dengue.mat.br) — Fiocruz/FGV |
| `data/casos_distrito.json` | casos por distrito, por doença | **amostra sintética** por enquanto (ver abaixo) |

### Trazer dados reais do InfoDengue

```bash
python scripts/fetch_infodengue.py
```

Só usa a biblioteca padrão do Python. Sobrescreve `data/infodengue.json` e
o aviso amarelo do site some para a série municipal. O workflow em
`.github/workflows/atualizar-dados.yml` faz isso toda madrugada e commita o
resultado — é a rotina 1 do projeto rodando no GitHub Actions, sem servidor.

### Por que os dados por distrito são amostra

O InfoDengue entrega dados por **município**. A única fonte pública com quebra
por distrito é o boletim semanal de arboviroses da COVISA (Prefeitura de SP),
que sai em PDF/tabela e não em API. Extrair isso é a etapa 3 do roteiro.

Até lá, `scripts/gerar_amostra.py` gera números sintéticos com um padrão
espacial plausível, para o mapa exibir toda a escala de cores. O arquivo
leva `"fonte": "amostra"` e o site mostra um aviso enquanto isso for verdade.
**Não apresente esses números como reais.**

Quando o scraper da COVISA existir, basta ele gravar `data/casos_distrito.json`
no mesmo formato:

```json
{
  "fonte": "COVISA/SMS-SP, boletim SE 36/2026",
  "ano": 2026, "se": 36,
  "doencas": {
    "dengue": {
      "itaquera": { "casos": 152, "casos_anterior": 178, "inc100k": 249.0, "nivel": 4 }
    }
  }
}
```

As chaves de distrito são os `id` do GeoJSON (nome sem acento, em minúsculas,
com hífen: `freguesia-do-o`, `jardim-sao-luis`).

## Publicar no GitHub Pages

1. Suba o repositório.
2. Em *Settings → Pages*, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. Em *Settings → Actions → General*, marque *Read and write permissions* para o workflow conseguir commitar.

## Roteiro

- [x] **1.** Malha + choropleth + busca + série municipal do InfoDengue
- [ ] **2.** Pipeline InfoDengue → Postgres/PostGIS → API própria
- [ ] **3.** Scraper do boletim COVISA para dados por distrito
- [ ] **4.** Login leve e relatos da comunidade (camada separada dos dados oficiais)
- [ ] **5.** Chatbot sobre os agregados
- [ ] **6.** Pets e parcerias com clínicas

## Créditos e licenças dos dados

- Malha de distritos: Prefeitura de São Paulo / GeoSampa, dados abertos.
- Série epidemiológica: InfoDengue (PROCC/Fiocruz e EMAp/FGV), com dados do SINAN/Ministério da Saúde.
- Mapa-base: © OpenStreetMap contributors, tiles CARTO.
