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
data/casos_distrito.json           # casos por distrito, por doença — derivado dos 2 últimos snapshots da COVISA
data/covisa/SE-AAAA-SS.json        # snapshot imutável de cada boletim COVISA já extraído (um por semana)
scripts/fetch_infodengue.py        # rotina 1: busca InfoDengue e grava data/infodengue.json
scripts/fetch_covisa.py            # rotina 1: baixa o boletim COVISA (PDF), extrai por distrito, grava snapshot + casos_distrito.json
docs/covisa-formato.md             # como o boletim COVISA é por dentro e como o scraper o lê
requirements.txt                   # pdfplumber, só para fetch_covisa.py
.github/workflows/atualizar-dados.yml  # roda os dois fetch toda madrugada e commita
.github/workflows/deploy-pages.yml     # publica o site no GitHub Pages a cada push na main
```

O projeto ocupa a raiz do repositório (`Patogen/`). Isso é requisito do GitHub
Pages: ele publica a raiz da branch, então `index.html` precisa estar ali para
que `https://reisdevv.github.io/Patogen/` abra o site em vez de um 404. Não mova
o site para uma subpasta.

Rodar local: `python -m http.server 8000` (fetch de JSON não funciona via file://).

## Fontes de dados — o que existe de verdade

Isso é o que mais confunde. Não invente APIs.

| Fonte | Granularidade | Cadência | Formato | Status no projeto |
|---|---|---|---|---|
| InfoDengue (Fiocruz/FGV) `info.dengue.mat.br/api/alertcity` | município (geocode 3550308) | semanal, com nowcast | JSON/CSV, sem chave | integrado |
| Boletim COVISA/SMS-SP (arboviroses urbanas) | **distrito administrativo** | semanal | PDF de 13 págs., link direto (ver `docs/covisa-formato.md`) | integrado (fase 3): dengue e chikungunya, **acumulado do ano** |
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
- **Por distrito, a COVISA só publica acumulado do ano** (casos confirmados desde janeiro,
  por ano de início de sintomas), não casos da semana. Não existe nível de alerta por
  distrito — o nível 1–4 é só municipal (InfoDengue). Não invente um.
- Chikungunya por distrito é só de casos **autóctones** confirmados e sem incidência.
  Zika não tem quadro por distrito desde 2018: o mapa fica vazio com "sem dados por distrito".
- A COVISA revisa o acumulado de semanas anteriores. `novos_desde_boletim` pode ser
  negativo; mostre como está, com esse rótulo, nunca como "casos na semana".

## Honestidade com dados

Decisão do dono do produto (2026-09-04): **não existe dado sintético, mockado ou "estimado"
no projeto.** Tudo que o site mostra vem de uma fonte oficial e diz qual é.

- Sem gerador de amostra. Se uma fonte não tem o dado, a UI mostra "sem dados" — nunca
  um número inventado para o mapa ficar bonito.
- Município: mostrar **casos notificados** (`casos`), não o nowcast (`casos_est`). O
  `casos_est` continua no JSON por vir da API, mas não é o número em destaque. A UI avisa
  que as últimas semanas ainda sobem com a entrada de notificações.
- Todo número na tela tem a fonte e a semana do boletim por perto (`renderFonte()`,
  popup das bolhas, subtítulo do distrito). Não remova.

Formato de `casos_distrito.json`:

```json
{
  "fonte": "COVISA/SMS-SP, boletim SE NN/AAAA",
  "ano": 2026, "se": 33, "gerado_em": "ISO-8601",
  "boletim_anterior_se": { "ano": 2026, "se": 32 },
  "sem_dados_por_distrito": ["zika"],
  "doencas": {
    "dengue":      { "<id_distrito>": { "casos_ano": 287, "inc100k_ano": 100.0, "novos_desde_boletim": 4 } },
    "chikungunya": { "<id_distrito>": { "casos_ano": 1, "inc100k_ano": null, "novos_desde_boletim": 0 } },
    "zika": {}
  }
}
```

- `casos_ano` / `inc100k_ano`: acumulado desde janeiro do `ano`, como vem no boletim.
- `novos_desde_boletim`: `casos_ano` deste boletim − `casos_ano` do boletim em
  `boletim_anterior_se`. `null` quando não há boletim anterior salvo. Pode ser negativo.
- `boletim_anterior_se` é `null` só no primeiro boletim.
- Cada boletim extraído fica congelado em `data/covisa/SE-AAAA-SS.json` (nunca reescrever;
  se a COVISA republicar a mesma SE, o script falha e a decisão é manual).
  `casos_distrito.json` é sempre derivado dos dois snapshots mais recentes.

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
- Mapa: Leaflet + tiles **Esri Light Gray** (`World_Light_Gray_Base` sem rótulos embaixo do
  choropleth, `World_Light_Gray_Reference` só rótulos em cima, zoom máx. 16, sem chave).
  Era CARTO até 2026-09, quando os tiles passaram a vir com "API key required". Se a Esri
  fizer o mesmo, o próximo candidato é OpenFreeMap (vetorial, exige MapLibre).
  Interação: tooltip simples no hover (nome + casos no ano) e clique seleciona o distrito
  no painel. Bolhas com popup foram testadas e rejeitadas pelo dono (2026-09) — não voltar.
- Backend (fase 2): FastAPI + PostgreSQL + PostGIS. Uma base só. O chatbot consulta uma
  materialized view, não um banco separado.
- Pipelines: rotina 1 coleta (InfoDengue via API, COVISA via scraper), rotina 2 upsert em
  `casos_semana`, rotina 3 recalcula agregados. JSON/Parquet entre etapas, não XML.
  Enquanto não houver banco, a rotina 1 roda no GitHub Actions e commita JSON.
- Chatbot (fase 5): LLM com tool use sobre 4–6 funções pré-definidas de consulta aos
  agregados. Nada de text-to-SQL livre.
- Scripts Python só com biblioteca padrão enquanto der. Se precisar de dependência, crie
  `requirements.txt` e justifique no commit. Única exceção aceita até agora: `pdfplumber`
  em `fetch_covisa.py` (tabela em PDF sem grade; não dá com stdlib).

## Convenções

- Commits em português, imperativo curto: `adiciona scraper covisa`, `corrige acento em jaçanã`.
- Prefixos quando fizer sentido: `dados:`, `site:`, `scripts:`, `ci:`.
- Python: 3.12, type hints, `pathlib`, sem `print` de debug esquecido. Scripts têm docstring
  no topo explicando uso.
- JS: sem transpilação; funciona no navegador direto. Nomes em português.
- Não formate o GeoJSON com indentação (tamanho importa). JSON de dados pode ter `indent=1`.
- Tamanho de página: manter `index.html` + dados abaixo de 500 KB no total.
- Acessibilidade: foco visível, `aria-pressed`/`aria-expanded` mantidos, `prefers-reduced-motion` respeitado.
- Visual (definido no redesign de 2026-09): fonte Geist; um acento só (`--accent`, azul-petróleo);
  cinzas frios; sombras tingidas com a tinta, nunca preto puro; raios fixos — contêineres 12px,
  controles 8px, badges pílula. Toda cor e medida vem dos tokens em `:root`; não crie valores soltos.
  Estados obrigatórios em tudo que é interativo: hover, ativo, foco; e o painel tem esqueleto de
  carregamento, estado vazio composto (top 5) e estado de erro.

## Como verificar o trabalho

- Depois de mudar `index.html`: sobe `python -m http.server`, abre no navegador, testa
  os três botões de doença, busca com e sem acento, clique em distrito, redimensiona
  para mobile. Se tiver Playwright disponível, tira screenshot desktop (1440×900) e
  mobile (390×844).
- Depois de mudar scripts: roda `python scripts/fetch_infodengue.py` e valida o JSON com
  `python -m json.tool`.
- Depois de mudar `fetch_covisa.py`: roda `python scripts/fetch_covisa.py --pdf <boletim.pdf> --dry-run`
  num boletim salvo. O script só aceita o resultado se os 96 distritos casarem e a soma
  dos distritos (+ "em investigação") bater com a linha TOTAL do quadro. Se falhar, é
  mudança de layout da COVISA — leia `docs/covisa-formato.md` antes de mexer.
- Depois de mudar o workflow: dispara manualmente em Actions → *Atualizar dados (InfoDengue e COVISA)*.

## Próximo passo concreto

Fase 3 em validação. O scraper (`scripts/fetch_covisa.py`) existe e foi conferido contra o
boletim da SE 33/2026. Falta:

1. Colocar `fetch_covisa.py` no workflow `atualizar-dados.yml` (precisa de
   `pip install -r requirements.txt`) e commitar snapshot + `casos_distrito.json` toda segunda.
2. Acompanhar 2–3 boletins seguidos para ver se o layout se mantém e se
   `novos_desde_boletim` faz sentido (revisões negativas são esperadas, não bug).
3. Só depois disso abrir a fase 2 (Postgres/PostGIS + API). Os snapshots em `data/covisa/`
   já são o histórico que a rotina 2 vai carregar.

## Quando estiver em dúvida

- Sobre dado: prefira mostrar menos com fonte clara a mostrar mais sem fonte.
- Sobre escopo: prefira a fase atual bem-feita a começar a próxima.
- Sobre privacidade: prefira não coletar.
- Pergunte antes de: adicionar dependência, mudar o formato dos JSONs, tocar no GeoJSON,
  criar qualquer coisa que armazene dado de usuário.