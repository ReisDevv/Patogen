# Boletim COVISA de arboviroses urbanas — formato e como o scraper lê

Investigado em 2026-09-04 com o boletim da SE 33/2026. Página de entrada:
`https://www.prefeitura.sp.gov.br/web/saude/w/vigilancia_em_saude/boletim_covisa/arboviroses`

## O que é

PDF de 13 páginas (~300 KB), semanal, com link direto para o arquivo. Não é HTML nem XLSX.
Há também um boletim **mensal** de arboviroses *silvestres* (febre amarela, Oropouche) na
mesma página — slug `arbo_silvestre`, ignorar.

### Página de entrada (HTML)

Os links são âncoras simples, mais recente primeiro:

```html
<a href="/documents/d/saude/boletimarbo-se33_28ago26-pdf">Semana Epidemiológica 33 - 31 de agosto de 2026</a>
<a href="/documents/d/saude/boletimarbo-se32_21ago26-pdf">Semana Epidemiológica 32 - 24 de agosto de 2026</a>
```

- O **texto** do link traz a SE e a data de publicação (bate com a capa do PDF).
- O sufixo de data no **slug** (`28ago26`) **não** é a data de publicação (31/08). Não use.
- O servidor devolve **403 para o User-Agent padrão do Python** (`Python-urllib/…`).
  Qualquer UA próprio passa (`epimapa-sp/0.1`).
- O PDF vem com `Content-Type: application/pdf` direto no `GET` do slug, sem redirect.

## Estrutura do PDF

| Página | Conteúdo |
|---|---|
| 1 | Capa: `SEMANA NN/AAAA`, período `(DD/MM A DD/MM)`, `PUBLICADO EM: DD/MM/AA` |
| 2 | Apresentação (texto fixo) |
| 3–7 | **Dengue**: Quadro 1 (anual), 2 (mês × ano), 3 (SE × ano), **Quadro 4 (por distrito, págs. 6–7)** |
| 8–11 | **Chikungunya**: Quadros 5–7 (município), **Quadro 8 (por distrito, págs. 10–11)** — só casos **autóctones**, sem incidência |
| 12 | **Zika**: Quadro 9 (mês × ano) e Quadro 10 (por distrito, **só 2016–2017**; não há autóctone desde 2018) |
| 13 | Quadro 11: óbitos por doença, só município |

O scraper não usa número de página nem número de quadro. Ele procura páginas cuja legenda
comece com `Quadro N` e mencione "Distrito administrativo (DA)", e classifica a doença pela
palavra na legenda (`dengue` / `chikungunya` / `zika`). Zika é reconhecida e ignorada.

## O quadro por distrito (Quadro 4 / Quadro 8)

Colunas: `CRS` (texto rotacionado, 5 regionais) | `UVIS` (~30, células mescladas) | `DA`
(96 distritos, CAIXA ALTA) | um bloco por ano, últimos 5 anos.

- Dengue: cada ano tem `N°` (casos confirmados) e `INC` (por 100 mil hab.) → 10 números por linha.
- Chikungunya: cada ano tem só `N°` → 5 números por linha.
- Os valores são **acumulados do ano** (por ano de início de sintomas, até a data do
  boletim). Não existe "casos da semana" por distrito.
- Linhas extras no fim: `EM INVESTIGAÇÃO` (só dengue, só `N°`) e `TOTAL`.
- A tabela quebra em duas páginas ("Continua" / "Continuação"); a segunda repete o cabeçalho.
- Rodapé: `Fonte: SINAN Online - dados provisórios até DD.MM.AAAA`.

## Como extrair (o que funcionou, e por quê)

O PDF **não tem grade de tabela** — `find_tables()` do pdfplumber acha 0 tabelas nessas
páginas, e a estratégia `text` fragmenta tudo em caracteres. Regex sobre `extract_text()`
também não serve: a ordem do texto não segue a ordem visual. O que funciona é trabalhar
com `extract_words()` e posições:

1. `extract_words(x_tolerance=5)`. O padrão (3) separa dígito por dígito (`1`,`5`,`6` em vez
   de `156`), porque o espaçamento dentro dos números é ~3,8 pt. Acima de ~8 começa a
   colar a coluna UVIS na coluna DA (`AricanduvaCARRÃO`). 5 é o ponto seguro.
2. Nomes em CAIXA ALTA podem vir fragmentados (`VILA`, `CU`, `RU`, `ÇA`). É inofensivo:
   o casamento com o GeoJSON compara só letras (NFKD, sem acento, sem espaço/hífen).
3. Linha = agrupamento de palavras por `top` com tolerância 2 pt. Uma linha de dados é a
   que tem exatamente 10 (dengue) ou 5 (chikungunya) tokens numéricos (`^\d+(,\d+)?$`).
4. O nome do distrito é o texto em caixa alta numa janela de ±6,5 pt em torno do `top`
   da linha numérica — nomes longos quebram em duas linhas (`ERMELINO` / `MATARAZZO`) e a
   linha de números fica no meio.
5. A borda esquerda da coluna DA é calculada dos próprios dados (menor `x0` das palavras em
   caixa alta com 3+ letras nas linhas de dados). O cabeçalho `DA` está centralizado e não
   serve de referência; e a coluna UVIS às vezes empurra um `Ó/` para dentro da faixa.
   Palavras à esquerda da borda (UVIS, CRS rotacionado) são descartadas.
6. Anos: a linha cujos tokens numéricos, concatenados, formam `(20\d\d){4,6}`. No
   cabeçalho de chikungunya os anos vêm quebrados (`2`,`0`,`20`,`2`), por isso concatena
   antes de casar.
7. `Sé` sai como `SÉ` sem problema. **`JARDIM SÃO LUIZ`** (com Z) é como a COVISA escreve;
   o GeoJSON tem `jardim-sao-luis`. Único apelido hardcoded.
8. Integridade: soma de `N°` dos 96 distritos (+ `EM INVESTIGAÇÃO`, na dengue) tem que
   bater com a linha `TOTAL` do ano corrente. Conferido na SE 33/2026:
   dengue 9 864 + 26 = 9 890; chikungunya 29.

Se qualquer etapa falhar (distrito sem par, distrito faltando, soma não bate, ano do
boletim não está no cabeçalho), o script **para com erro**. Não há modo "melhor esforço".

## Semana epidemiológica

Vem da capa: `SEMANA 33/2026`. Não deduzir da data de hoje nem do slug.

## Decisões de schema (2026-09-04)

Confirmadas com o responsável pelo produto após a investigação:

- Por distrito: `casos_ano`, `inc100k_ano` (só dengue), `novos_desde_boletim`. Sem `casos`,
  `casos_anterior` ou `nivel` — nada disso existe na fonte e não vamos inferir.
- `novos_desde_boletim` = `casos_ano` de hoje − `casos_ano` do snapshot anterior. Negativo
  quando a COVISA revisa para baixo; mostrar como está.
- Cada boletim vira um snapshot imutável `data/covisa/SE-AAAA-SS.json`.
  `data/casos_distrito.json` é derivado dos dois mais recentes.
- Zika: `sem_dados_por_distrito: ["zika"]`; o mapa fica vazio e só o card municipal aparece.
- UI, junto da SE: "acumulado desde janeiro; reflete o pico do primeiro semestre, não só
  as últimas semanas".
