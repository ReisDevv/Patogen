# CLAUDE.md — Epimapa SP

Guia para trabalhar neste repositório. Leia inteiro antes de mexer em qualquer coisa.

## O que é o projeto

Site que mostra um mapa de calor de doenças em alta na cidade de São Paulo, por distrito,
com dados públicos de vigilância epidemiológica. Público: qualquer morador que quer saber
"a dengue está alta no meu bairro?". Idioma do produto e do código (nomes, comentários,
commits): **português do Brasil**.

Visão completa, em fases:

1. **Mapa de arboviroses por distrito** (dengue, chikungunya, zika) — feito, estático.
2. Pipeline InfoDengue → Postgres/PostGIS → API própria.
3. Scraper do boletim semanal da COVISA para dados por distrito (substitui a amostra).
4. Login leve (sem CPF/gov.br) e relatos da comunidade, em camada separada dos dados oficiais.
5. Chatbot que responde com números da última atualização.
6. Mapa de doenças de pets e parcerias com clínicas veterinárias.
7. Monetização: anúncios contextuais; depois plano pago sem anúncios.

Não pule fases nem construa infraestrutura de fases futuras "já deixando pronto".
Cada fase entra quando a anterior estiver validada.

## Estado atual

Site estático, sem backend. Publica no GitHub Pages.

```
index.html                         # página única: mapa + painel (Leaflet, CSS e JS inline)
data/distritos.geojson             # 96 distritos, simplificado (~230 KB), NÃO regenerar sem motivo
data/infodengue.json               # série semanal municipal (InfoDengue)
data/casos_distrito.json           # casos por distrito, por doença — HOJE É AMOSTRA SINTÉTICA
scripts/fetch_infodengue.py        # rotina 1: busca InfoDengue e grava data/infodengue.json
scripts/gerar_amostra.py           # gera dados sintéticos marcados com "fonte": "amostra"
.github/workflows/atualizar-dados.yml  # roda fetch_infodengue.py toda madrugada e commita
```

Rodar local: `python -m http.server 8000` (fetch de JSON não funciona via file://).

## Fontes de dados — o que existe de verdade

Isso é o que mais confunde. Não invente APIs.

| Fonte | Granularidade | Cadência | Formato | Status no projeto |
|---|---|---|---|---|
| InfoDengue (Fiocruz/FGV) `info.dengue.mat.br/api/alertcity` | município (geocode 3550308) | semanal, com nowcast | JSON/CSV, sem chave | integrado |
| Boletim COVISA/SMS-SP (arboviroses) | **distrito administrativo** | semanal | PDF/tabela em página HTML | fase 3, a fazer |
| OpenDataSUS / SINAN | município | atraso de semanas ou meses | CSV grandes, API Elasticsearch p/ síndrome gripal | avaliar depois |
| GeoSampa (Prefeitura) | polígonos de distritos, subprefeituras, logradouros | estática | shapefile/GeoJSON | integrado (distritos) |
| Pets (CCZ, CVE) | boletins esparsos | irregular | PDF | fase 6, sem API pública |

Regras derivadas disso:

- **Não existe dado diário nem por rua.** A unidade do mapa é o distrito (96) ou a
  subprefeitura (32). Cadência real é semanal. Ruas aparecem só no mapa-base.
- Dados retroativos mudam (a COVISA revisa semanas anteriores). Toda carga é **upsert**
  por `(distrito, doença, ano, se)`, nunca append cego.
- Níveis de alerta seguem a convenção InfoDengue: 1 verde, 2 amarelo, 3 laranja, 4 vermelho.
  As cores no site são `#3d9a6a`, `#e8c04a`, `#e8802f`, `#c8322b`. Não troque.

## Honestidade com dados de amostra

`data/casos_distrito.json` é sintético. O arquivo carrega `"fonte": "amostra"` e o site
exibe um aviso enquanto isso for verdade. Regras:

- Nunca remova o aviso, o campo `fonte` ou a checagem em `renderFonte()` sem que a fonte real exista.
- Nunca escreva texto (README, UI, commit) que apresente a amostra como dado real.
- Quando o scraper da COVISA existir, ele grava no **mesmo formato** e muda `fonte` para
  algo como `"COVISA/SMS-SP, boletim SE 36/2026"`. O site não precisa mudar.

Formato de `casos_distrito.json`:

```json
{
  "fonte": "amostra | COVISA/SMS-SP, boletim SE NN/AAAA",
  "ano": 2026, "se": 36, "gerado_em": "ISO-8601",
  "doencas": {
    "dengue": { "<id_distrito>": { "casos": 152, "casos_anterior": 178, "inc100k": 249.0, "nivel": 4 } }
  }
}
```

`<id_distrito>` é o `id` do GeoJSON: nome em minúsculas, sem acento, espaços viram hífen
(`freguesia-do-o`, `jardim-sao-luis`, `vila-curuca`). Ao cruzar nomes vindos da COVISA,
normalize com NFKD + remoção de acentos + lower + hífen e valide contra os 96 ids do GeoJSON;
qualquer nome sem correspondência deve **falhar alto**, não ser ignorado.

## LGPD — restrições que moldam o produto

Dado de saúde é dado pessoal sensível (LGPD art. 11). Isso não é detalhe jurídico para
depois; define o que pode ser construído.

- **Nunca** vincule busca por doença, distrito consultado ou relato de sintoma a um usuário
  identificável para fins de anúncio. Anúncios são **contextuais** (dependem da página/região
  exibida), nunca comportamentais sobre sinal de saúde.
- Analytics só agregado e anonimizado (contagens por distrito/doença), sem ID de usuário.
- Relatos da comunidade (fase 4): sem identificador reversível de quem relatou. Se precisar
  de anti-abuso, use hash com salt rotativo, nunca o ID da conta na mesma tabela.
- Cadastro pede o mínimo: e-mail (para login), faixa etária, sexo. Sem data de nascimento
  completa, sem CPF, sem endereço exato — distrito é o máximo de localização.
- Menores de 18: não coletar relatos.
- Se uma feature pedida colidir com isso, pare e explique o conflito em vez de implementar.

## Decisões de arquitetura já tomadas

- Frontend: HTML/CSS/JS sem framework por enquanto. Migrar para Next.js só quando houver
  login (fase 4). Não introduza React/Vite/bundler antes disso.
- Mapa: Leaflet + tiles CARTO (`light_nolabels` embaixo do choropleth, `light_only_labels`
  em cima). Manter.
- Backend (fase 2): FastAPI + PostgreSQL + PostGIS. Uma base só. O chatbot consulta uma
  materialized view, não um banco separado.
- Pipelines: rotina 1 coleta (InfoDengue via API, COVISA via scraper), rotina 2 upsert em
  `casos_semana`, rotina 3 recalcula agregados. JSON/Parquet entre etapas, não XML.
  Enquanto não houver banco, a rotina 1 roda no GitHub Actions e commita JSON.
- Chatbot (fase 5): LLM com tool use sobre 4–6 funções pré-definidas de consulta aos
  agregados. Nada de text-to-SQL livre.
- Scripts Python só com biblioteca padrão enquanto der. Se precisar de dependência, crie
  `requirements.txt` e justifique no commit.

## Convenções

- Commits em português, imperativo curto: `adiciona scraper covisa`, `corrige acento em jaçanã`.
- Prefixos quando fizer sentido: `dados:`, `site:`, `scripts:`, `ci:`.
- Python: 3.12, type hints, `pathlib`, sem `print` de debug esquecido. Scripts têm docstring
  no topo explicando uso.
- JS: sem transpilação; funciona no navegador direto. Nomes em português.
- Não formate o GeoJSON com indentação (tamanho importa). JSON de dados pode ter `indent=1`.
- Tamanho de página: manter `index.html` + dados abaixo de 500 KB no total.
- Acessibilidade: foco visível, `aria-pressed`/`aria-expanded` mantidos, `prefers-reduced-motion` respeitado.

## Como verificar o trabalho

- Depois de mudar `index.html`: sobe `python -m http.server`, abre no navegador, testa
  os três botões de doença, busca com e sem acento, clique em distrito, redimensiona
  para mobile. Se tiver Playwright disponível, tira screenshot desktop (1440×900) e
  mobile (390×844).
- Depois de mudar scripts: roda `python scripts/gerar_amostra.py` e
  `python scripts/fetch_infodengue.py` e valida o JSON com `python -m json.tool`.
- Depois de mudar o workflow: dispara manualmente em Actions → *Atualizar dados do InfoDengue*.
- Nunca commite `data/infodengue.json` gerado pela amostra por cima de um real.

## Próximo passo concreto

Fase 3: scraper do boletim de arboviroses da COVISA.
Página de entrada: `prefeitura.sp.gov.br/web/saude/w/vigilancia_em_saude/boletim_covisa/arboviroses`.
Antes de codar, baixe o boletim mais recente, inspecione o formato (PDF? tabela HTML? XLSX?)
e documente em `docs/covisa-formato.md` quais tabelas trazem casos por distrito e como
identificar a semana epidemiológica. Só depois escreva `scripts/fetch_covisa.py`.

## Quando estiver em dúvida

- Sobre dado: prefira mostrar menos com fonte clara a mostrar mais sem fonte.
- Sobre escopo: prefira a fase atual bem-feita a começar a próxima.
- Sobre privacidade: prefira não coletar.
- Pergunte antes de: adicionar dependência, mudar o formato dos JSONs, tocar no GeoJSON,
  criar qualquer coisa que armazene dado de usuário.