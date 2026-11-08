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
index.html                         # página inicial: busca com a ficha do distrito, a cidade agora, as três doenças, prevenção, privacidade, perguntas, notas
mapa.html                          # o mapa: mapa + painel + "Sobre" + lista dos 96 distritos (Leaflet, CSS e JS inline)
organizacoes.html                  # página para empresas: abertura com os 96 distritos, duas telas (gestor x colaborador), passos, painel demonstrativo, piloto, patrocínio (#impacto), contato
impacto.html                       # só redireciona para organizacoes.html#impacto (links antigos)
institucional.css                  # estilo de organizacoes.html (mesmos tokens da página inicial)
nivel.js                           # faixas 1–4 por distrito, ajuste para distrito pequeno e escala de cor; usado por index, mapa e empresas
tema.js                            # tema claro/escuro (no <head> de todas as páginas)
empresas.js                        # mosaico dos 96 distritos e amostras da página para empresas
tests/                             # testes (unittest, só stdlib) de fetch_covisa.py e fetch_infodengue.py
chat.js                            # Epi, assistente do canto inferior direito (regras + dados já carregados, sem API)
404.html                           # página de endereço inexistente (o GitHub Pages serve sozinho)
manifest.webmanifest               # nome e ícones para "Adicionar à tela inicial"
img/                               # ícones (192, 512, maskable, 180) e compartilhar.jpg, a prévia de link 1200×630
img/marca/                         # marca da Pathogen: símbolo e ícone em SVG, assinaturas em PNG, folha da marca
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
que `https://reisdevv.github.io/Patogen/` abra o site em vez de um 404. Desde 2026-11-08 o
endereço oficial é `https://pathogen-sp.vercel.app/` (projeto `patogen` na Vercel, publica a
cada push na `main`, inclusive os commits diários de dados; `vercel.json` sem build e
`.vercelignore` sem scripts/testes, porque o `requirements.txt` fazia a Vercel tentar um app
Python). `pathogen.vercel.app` já era de outro projeto. O GitHub Pages continua como espelho. Não mova
o site para uma subpasta. A página inicial (`index.html`) e o mapa (`mapa.html`)
ficam os dois na raiz.

Rodar local: `python -m http.server 8000` (fetch de JSON não funciona via file://).
Página inicial em `http://localhost:8000/`, mapa em `http://localhost:8000/mapa.html`.

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
  distrito pelo InfoDengue — o nível de alerta 1–4 dele é só municipal. Desde 2026-11-08 (pedido do
  dono, Design System) cada distrito tem uma **faixa da Pathogen** 1–4 pela incidência (<20, 20–60,
  60–300, ≥300; nível 3 exige 5 casos e o 4 exige 10), calculada sobre a taxa ajustada para distrito
  pequeno (Bayes empírico, população = casos ÷ incidência) e com "dado instável" abaixo de 50 mil
  habitantes ou 5 casos. Tudo em `nivel.js`. Sempre escrita como convenção da Pathogen, com o número
  oficial ao lado; a cor do mapa usa a taxa ajustada. Não chame de nível de alerta nem de risco.
- Chikungunya por distrito é só de casos **autóctones** confirmados e sem incidência.
  Zika não tem quadro por distrito desde 2018: o mapa fica vazio com "sem dados por distrito".
- A COVISA revisa o acumulado de semanas anteriores. `novos_desde_boletim` continua no JSON
  (histórico técnico), mas **não aparece na interface** desde 2026-11-01: a diferença entre dois
  boletins mistura casos novos com confirmações tardias, descartes e reclassificações, e não há
  metodologia que permita lê-la como casos novos. No lugar, a UI mostra a semana do boletim e a
  data de corte (`dados_ate`).

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
  "url": "PDF oficial", "publicado_em": "AAAA-MM-DD", "periodo": "DD/MM a DD/MM",
  "dados_ate": "AAAA-MM-DD", "extraido_em": "ISO-8601",
  "validacao": { "status": "aprovada", "distritos": { "dengue": 96, "chikungunya": 96 }, "conferencias": "..." },
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
- `url`, `publicado_em`, `periodo`, `dados_ate` (data de corte do SINAN) e `extraido_em` vêm do
  snapshot atual. `validacao.status` é sempre `aprovada`: o script só grava o que passou em todas
  as conferências. `0` é zero casos; ausência da chave ou `null` é "sem dados", nunca zero.
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
- Assistente da pré-banca (2026-10, pedido do time): `chat.js` antecipa a interface da fase 5
  sem LLM. Reconhece a pergunta por palavras-chave e responde com os JSONs que o mapa já
  carregou (`CONSULTAS`: distrito, subprefeitura, comparação, ranking, cidade, tendência) ou
  com textos fixos de orientação do Ministério da Saúde. Roda só no navegador: não envia nem
  guarda o que a pessoa digita. Na fase 5 o LLM chama as mesmas `CONSULTAS` como ferramentas.
  Teste no console: `EpiChat.responder("dengue em Itaquera")`. `EpiChat.APELIDOS` (bairros que
  não são distritos) também alimenta as buscas do mapa e da página inicial: mantenha uma lista só.
- Duas páginas (2026-10, pré-banca). A raiz é a página inicial: explica o site, mostra a situação
  agora com os mesmos JSONs (prévia SVG dos 96 distritos com as cores do mapa, cidade, top 5) e
  leva ao mapa. O mapa (`mapa.html`) abre direto, sem janela por cima, igual ao vídeo da banca.
  A página inicial copia de `mapa.html` os tokens, os componentes (seletor, busca, badges,
  gráfico, escala, Epi) e as regras de cor: se mudar o desenho ou as cores lá, replique aqui.
  O caminho inverso não vale: o visual do mapa (cores, modelo, formato) fica igual ao vídeo da
  banca, decisão do dono (2026-10). Não mude o mapa para acompanhar a página inicial. A única
  exceção aprovada foi o símbolo da marca no topo e o ícone da aba.
- Marca (2026-11-08, escolhida pelo time; substitui a "Lente" de 2026-10): a empresa é a
  **Pathogen**; o **Epimapa SP** é o produto ("Epimapa SP, da Pathogen"). O símbolo é o **Radar-O**
  do Design System do time (`docs/design-system.pdf`): anel = território, arco de varredura ciano,
  nó teal = o dado que vira decisão. Os SVGs em `img/marca/` são a fonte (o `.marca__logo` das
  páginas e o ícone da aba usam o mesmo desenho embutido). Cores no tema claro: tinta `#0F172A`,
  destaque (`--accent`) teal `#0F766E`, arco `#0E7490`; no escuro, anel `#F8FAFC`, arco `#22D3EE`,
  nó `#14B8A6`. A marca nunca usa as cores de nível do mapa. O choropleth continua com as cores
  do vídeo da banca (`--n1`…`--n4`); só o destaque e a tinta mudaram.
  Do Design System entraram em 2026-11-08: fontes Space Grotesk (títulos), Inter (texto) e
  JetBrains Mono (números); tema claro/escuro (`tema.js`, tokens em `:root[data-tema="escuro"]`,
  mapa com Esri Dark Gray no escuro); faixas e ajuste para distrito pequeno (`nivel.js`). O DS fala em
  "inteligência preditiva do Epi": o produto não prevê nada, o Epi é por regras. Não escreva isso
  no site. No topo das páginas
  vai o símbolo com "Epimapa SP"; "da Pathogen" aparece no rodapé e na prévia de link.
  Visual da página inicial (2026-10, pedido do dono): sóbrio, com os mesmos tokens do mapa
  (branco, cinzas frios, tinta `#0F172A` e teal só nas ações) e as fontes do Design System. A
  estrutura segue sites de produto bem organizados (referência: páginas do iPhone na Apple):
  título grande à esquerda, fileira de atalhos com ícone, painéis cinza-claros, botão "+" que abre
  detalhes num `<dialog>`, notas numeradas no fim com a fonte de cada número. Não copie layout
  nem recursos de outros sites (o dono recusou uma versão parecida com a de um concorrente).
  A busca, o toque na prévia e "Meu distrito" abrem a ficha do distrito na própria página
  (números do boletim, posição entre os 96, faixa dos 96, distritos da mesma subprefeitura);
  "Ver no mapa" leva ao mapa no distrito. A seleção não vai para o endereço, porque `#doença/...`
  na raiz é levado ao mapa. Os textos de saúde dos detalhes são os `EpiChat.TEXTOS` do
  `chat.js`: mantenha um texto só. A checagem da prevenção não grava nada; o lembrete semanal é
  um arquivo `.ics` gerado no aparelho.
- Navegação no mapa: "Sobre" (projeto, como ler, fontes, prevenção, privacidade), lista dos 96
  distritos com CSV e "Meu distrito" (geolocalização calculada no aparelho, nunca enviada), em
  `<dialog>` nativo por cima do mapa. O endereço guarda a seleção como `#doença/distrito`
  (`history.replaceState`, não polui o histórico); `#doença/lista` abre a lista. Endereços
  `#doença/...` na raiz são levados ao mapa. O Epimapa não grava nada no navegador (o mapa apaga
  a sobra `epimapa:intro-vista` de uma versão anterior). Não grave nada sem perguntar. Única
  exceção aprovada (pedido do time, 2026-11-01): o painel demonstrativo de `organizacoes.html`
  guarda unidades, plano e o último boletim visto em `localStorage["pathogen:organizacoes-demo"]`,
  com aviso na página e botão "Limpar dados locais". Só grava depois que a pessoa muda algo.
  Segunda exceção (pedido do dono, 2026-11-08): `localStorage["pathogen:tema"]` guarda só "claro"
  ou "escuro", e só depois que a pessoa usa o botão de tema; sem isso o site segue o sistema.
- `img/compartilhar.jpg` mostra só o contorno dos distritos, sem cor de incidência nem número:
  a prévia fica meses no cache do WhatsApp e não pode parecer dado. Se regenerar, mesma regra.
- Produtos (2026-11-01, pedido do time): a **Pathogen** é a empresa; **Epimapa SP** (cidadão,
  gratuito), **Pathogen Organizações** (painel por unidade para empresas, condomínios, escolas)
  e **Pathogen Impacto** (patrocínio de campanhas) são módulos da mesma solução, não três sites.
  Desde 2026-11-08 Organizações e Impacto são uma página só, "Para empresas" (organizacoes.html),
  com o patrocínio na seção #impacto; impacto.html só redireciona.
  O cidadão vem primeiro: a página inicial só ganhou uma linha sobre a Pathogen e o botão "Para
  organizações". Organizações e Impacto são protótipo e apresentação: sem login, sem banco, sem
  backend, sem e-mail/push. Unidades são só nome + distrito; o painel não pede endereço nem dado
  de pessoas, não chama a incidência do distrito de risco da unidade e não cria índice próprio.
  O relatório separa "Dados epidemiológicos oficiais" de "Informações de execução fornecidas
  pela organização". Colaboradores (2026-11-08, opção escolhida pelo dono): a organização manda
  o link `index.html?de=<nome>` (gerado em "Link para os colaboradores"); a página inicial só mostra
  o nome com `textContent` e cada pessoa usa a busca ou "Meu distrito" no próprio aparelho. Nada
  sobre a consulta volta para a organização: não há contagem de acessos, distrito de colaborador
  nem cruzamento com localização de pessoas. Assinatura mensal (valor a definir) e Selo Pathogen
  aparecem como proposta no piloto; o Selo atesta engajamento, não ausência de casos, e ainda
  não é emitido. Não há canal comercial: o contato está marcado para a equipe preencher
  (comentário `EQUIPE:` nas duas páginas). Fora do escopo por ora: IA preditiva, previsão de
  demanda, índice de vulnerabilidade, marketplace, vacinas, denúncia própria (o site leva ao
  SP156), cadastro de sintomas, FastAPI/PostGIS, login empresarial, app nativo, pets.
- Scripts Python só com biblioteca padrão enquanto der. Se precisar de dependência, crie
  `requirements.txt` e justifique no commit. Única exceção aceita até agora: `pdfplumber`
  em `fetch_covisa.py` (tabela em PDF sem grade; não dá com stdlib).

## Convenções

- Commits em português, imperativo curto: `adiciona scraper covisa`, `corrige acento em jaçanã`.
- Prefixos quando fizer sentido: `dados:`, `site:`, `scripts:`, `ci:`.
- Python: 3.12, type hints, `pathlib`, sem `print` de debug esquecido. Scripts têm docstring
  no topo explicando uso.
- JS: sem transpilação; funciona no navegador direto. Nomes em português.
- CSS/JS compartilhados (institucional.css, 
ivel.js, 	ema.js, empresas.js, chat.js) entram com `?v=<commit>`: ao mudar um deles, troque o `v` em todas as páginas, senão o navegador (GitHub Pages guarda 10 min) mostra a página nova com o CSS velho.
- Não formate o GeoJSON com indentação (tamanho importa). JSON de dados pode ter `indent=1`.
- Tamanho de página: cada página (`index.html` ou `mapa.html`, mais `chat.js`) + dados abaixo de 500 KB no total.
- Acessibilidade: foco visível, `aria-pressed`/`aria-expanded` mantidos, `prefers-reduced-motion` respeitado.
- Visual (redesign de 2026-09, Design System em 2026-11-08): fontes por papel (`--f-titulo`, `--f-texto`,
  `--f-num`); um acento só (`--accent`, teal); tema escuro redefine os mesmos tokens;
  cinzas frios; sombras tingidas com a tinta, nunca preto puro; raios fixos — contêineres 12px,
  controles 8px, badges pílula. Toda cor e medida vem dos tokens em `:root`; não crie valores soltos.
  Estados obrigatórios em tudo que é interativo: hover, ativo, foco; e o painel tem esqueleto de
  carregamento, estado vazio composto (top 5) e estado de erro.

## Como verificar o trabalho

- Depois de mudar `mapa.html`: sobe `python -m http.server`, abre no navegador, testa
  os três botões de doença, busca com e sem acento, clique em distrito, redimensiona
  para mobile. Se tiver Playwright disponível, tira screenshot desktop (1440×900) e
  mobile (390×844). Teste também: "Sobre" e as abas, lista dos distritos (ordenar,
  filtrar, CSV), um link `mapa.html#dengue/pinheiros` em aba nova, arrastar a alça do
  painel no celular e o estado de erro (sirva uma cópia sem `data/infodengue.json`).
- Depois de mudar `index.html`: a prévia desenha os 96 distritos e muda com a doença; a
  busca (distrito, bairro, subprefeitura), o toque na prévia, "Meu distrito" e o top 5 abrem a
  ficha com os mesmos números do painel do mapa; "Ver no mapa", "Os 96 distritos" e o "Ver no
  mapa" do Epi abrem `mapa.html` no lugar certo; os "+" abrem e fecham (Esc e toque fora); a
  zika mostra "sem dados" na ficha; nada estoura na horizontal de 320px ao desktop; sem dados,
  os avisos aparecem e o texto da página continua.
- Depois de mudar scripts: `python -m unittest discover -s tests -v` (o workflow roda isso antes
  de buscar dados e para se falhar). Para testar contra boletins reais, baixe os PDFs numa pasta e
  rode com `COVISA_PDFS=pasta`. Depois `python scripts/fetch_infodengue.py` e valide o JSON com
  `python -m json.tool`.
- Depois de mudar `organizacoes.html`: as unidades de exemplo mostram os mesmos números do
  `casos_distrito.json`; distrito sem número aparece "Sem dados" (nunca 0); nome de unidade com
  `<tag>` aparece como texto; a comparação diz métrica e período; "Gerar relatório" imprime só o
  relatório; "Limpar dados locais" apaga a chave do `localStorage`.
- Depois de mudar `fetch_covisa.py`: roda `python scripts/fetch_covisa.py --pdf <boletim.pdf> --dry-run`
  num boletim salvo. O script só aceita o resultado se os 96 distritos casarem e a soma
  dos distritos (+ "em investigação") bater com a linha TOTAL do quadro. Se falhar, é
  mudança de layout da COVISA — leia `docs/covisa-formato.md` antes de mexer.
- Depois de mudar o workflow: dispara manualmente em Actions → *Atualizar dados (InfoDengue e COVISA)*.

## Próximo passo concreto

Fase 3 em operação desde 2026-09; quebrou na SE 40/2026 (ponto de milhar, ver
`docs/covisa-formato.md`) e foi corrigida em 2026-11-01. O workflow agora roda os testes, grava
InfoDengue e COVISA de forma independente (uma falha não trava a outra) e falha em vermelho
dizendo qual fonte não atualizou. O site é republicado depois de cada atualização
(`workflow_run` no `deploy-pages.yml`), porque push feito com `GITHUB_TOKEN` não dispara o
deploy: foi por isso que o site ficou parado no commit de 2026-10-08.

1. Depois do merge, disparar manualmente *Atualizar dados* e conferir que o *Publicar site* roda em seguida.
2. Acompanhar os próximos boletins: se a COVISA mudar o layout de novo, o script para e o
   último conjunto válido continua no ar.
3. Só depois disso abrir a fase 2 (Postgres/PostGIS + API). Os snapshots em `data/covisa/`
   já são o histórico que a rotina 2 vai carregar.

## Quando estiver em dúvida

- Sobre dado: prefira mostrar menos com fonte clara a mostrar mais sem fonte.
- Sobre escopo: prefira a fase atual bem-feita a começar a próxima.
- Sobre privacidade: prefira não coletar.
- Pergunte antes de: adicionar dependência, mudar o formato dos JSONs, tocar no GeoJSON,
  criar qualquer coisa que armazene dado de usuário.