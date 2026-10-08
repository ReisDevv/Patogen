# Epimapa SP

Mapa de dengue, chikungunya e zika por distrito da cidade de São Paulo.
Esta é a **etapa 1** do projeto: um site estático que já mostra o produto
funcionando de ponta a ponta — malha dos 96 distritos, busca por distrito ou
subprefeitura, resumo municipal com série de 26 semanas e detalhe por distrito.

O site tem duas páginas: a **página inicial** (`index.html`), que explica o projeto,
mostra a situação da semana com os dados ao vivo, abre a ficha de qualquer distrito ali mesmo
e leva ao **mapa** (`mapa.html`).

O que dá para fazer no site:

- ver dengue, chikungunya e zika por distrito, com a fonte e a semana do boletim ao lado de cada número;
- achar o distrito pela busca (inclusive alguns bairros conhecidos), pelo mapa ou por **Meu distrito**,
  que usa a localização do aparelho sem enviá-la a lugar nenhum;
- abrir a **lista dos 96 distritos**, ordenar, filtrar e baixar em CSV;
- compartilhar o link de um distrito (`…/Patogen/mapa.html#dengue/pinheiros` abre direto nele);
- perguntar ao **Epi**, o assistente do canto da tela;
- ler o **Sobre**: como ler o mapa, fontes, prevenção e privacidade.

Não há backend nem banco ainda. Tudo é HTML + JSON, o que permite publicar
de graça no GitHub Pages e validar a ideia antes de gastar com servidor.

## Rodar localmente

O navegador bloqueia `fetch` de arquivos locais, então precisa de um servidor
HTTP simples:

```bash
python -m http.server 8000
# página inicial: http://localhost:8000
# mapa:           http://localhost:8000/mapa.html
```

## Dados

| Arquivo | O que é | De onde vem |
|---|---|---|
| `data/distritos.geojson` | polígonos dos 96 distritos, simplificados para 230 KB | Prefeitura de São Paulo (GeoSampa), via [codigourbano/distritos-sp](https://github.com/codigourbano/distritos-sp) |
| `data/infodengue.json` | série semanal municipal (casos estimados, nível de alerta, Rt) | [InfoDengue](https://info.dengue.mat.br) — Fiocruz/FGV |
| `data/casos_distrito.json` | casos por distrito, por doença (acumulado do ano) | boletim semanal de arboviroses da COVISA/SMS-SP, via `scripts/fetch_covisa.py` (ver abaixo) |
| `data/covisa/SE-AAAA-SS.json` | snapshot imutável de cada boletim já lido | idem |

### Trazer dados reais do InfoDengue

```bash
python scripts/fetch_infodengue.py
```

Só usa a biblioteca padrão do Python. Sobrescreve `data/infodengue.json` e
o aviso amarelo do site some para a série municipal. O workflow em
`.github/workflows/atualizar-dados.yml` faz isso toda madrugada e commita o
resultado — é a rotina 1 do projeto rodando no GitHub Actions, sem servidor.

### Dados por distrito: boletim da COVISA

O InfoDengue entrega dados por **município**. A única fonte pública com quebra
por distrito é o boletim semanal de arboviroses urbanas da COVISA (Prefeitura
de SP), um PDF sem API. `scripts/fetch_covisa.py` baixa o boletim mais recente,
lê os quadros por distrito e grava:

```bash
pip install -r requirements.txt     # pdfplumber, só para este script
python scripts/fetch_covisa.py      # ou --url URL, --pdf arquivo.pdf, --dry-run
```

O que o boletim traz — e o que o site mostra — é o **acumulado do ano** por
distrito (casos confirmados desde janeiro), não casos da semana. Detalhes do
formato e da extração em [`docs/covisa-formato.md`](docs/covisa-formato.md).

- **Dengue**: casos confirmados e incidência por 100 mil hab., por distrito.
- **Chikungunya**: só casos confirmados autóctones, sem incidência.
- **Zika**: o boletim não tem quadro por distrito desde 2018; o mapa fica
  vazio e só o resumo municipal aparece.
- `novos_desde_boletim` é a diferença do acumulado entre o boletim atual e o
  anterior. Pode ser negativo quando a COVISA revisa semanas passadas.

Cada boletim fica congelado em `data/covisa/SE-AAAA-SS.json`;
`data/casos_distrito.json` é derivado dos dois mais recentes:

```json
{
  "fonte": "COVISA/SMS-SP, boletim SE 33/2026",
  "ano": 2026, "se": 33,
  "boletim_anterior_se": { "ano": 2026, "se": 32 },
  "sem_dados_por_distrito": ["zika"],
  "doencas": {
    "dengue": {
      "itaquera": { "casos_ano": 298, "inc100k_ano": 139.6, "novos_desde_boletim": 4 }
    }
  }
}
```

As chaves de distrito são os `id` do GeoJSON (nome sem acento, em minúsculas,
com hífen: `freguesia-do-o`, `jardim-sao-luis`).

Não há dado sintético nem estimado no projeto: o resumo municipal mostra casos
**notificados** (não o nowcast do InfoDengue) e, quando uma fonte não tem o dado,
o site diz "sem dados".

## Publicar no GitHub Pages

1. Suba o repositório.
2. Em *Settings → Pages*, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. Em *Settings → Actions → General*, marque *Read and write permissions* para o workflow conseguir commitar.

## Roteiro

- [x] **1.** Malha + choropleth + busca + série municipal do InfoDengue
- [x] **2.** Scraper do boletim COVISA para dados por distrito (em validação; falta entrar no workflow)
- [ ] **3.** Login leve e relatos da comunidade (camada separada dos dados oficiais)
- [ ] **4.** Chatbot sobre os agregados

## Créditos e licenças dos dados

- Malha de distritos: Prefeitura de São Paulo / GeoSampa, dados abertos.
- Série epidemiológica: InfoDengue (PROCC/Fiocruz e EMAp/FGV), com dados do SINAN/Ministério da Saúde.
- Mapa-base: tiles Esri Light Gray Canvas (Esri, HERE, Garmin, © OpenStreetMap contributors).
