# TabNet da Secretaria Municipal da Saúde — como o `fetch_tabnet.py` lê

Investigado em 2026-11-09. Página de entrada: `https://prefeitura.sp.gov.br/web/saude/tabnet/`
(seção *Doenças e Agravos*). Cada base é um formulário CGI do TabNet (DATASUS) servido pela Prefeitura.

## Por que o TabNet

É a única fonte pública encontrada com **distrito administrativo de residência** para doenças além
das arboviroses. Bases usadas (todas com o campo de distrito, conferido em 2026-11-09):

| Doença | Base (`.def`) | Sistema | O que conta | 2026 até a consulta |
|---|---|---|---|---|
| SRAG | `RSRAG/sragh.def` | SIVEP-Gripe | internações por SRAG, todas as causas | 10 589 |
| Covid-19 | `RCOVID19/covid19.def` | e-SUS VE | síndrome gripal com `Caso Confirmado de COVID-19`; um arquivo por mês | 12 605 |
| Tuberculose | `TBWEB/TBWEB.def` | TBWEB | `Tipo de caso = Novo`, residentes em `SAO PAULO`, ano de incidência | 6 053 |
| Meningite | `RMENIN/RmeningeN.def` | SINAN | casos confirmados (todos têm critério de confirmação), todas as etiologias | 1 471 |
| Sarampo | `REXANT/Rexantn.def` | SINAN | `Classificação Final = SARAMPO` (confirmados) | 37 |

Ficaram de fora: coqueluche (17 casos em 2026), gripe separada da SRAG (o SRAG municipal só separa
covid-19; influenza cai em "outro agente etiológico"), mpox e varicela (sem base no TabNet municipal),
varíola (erradicada em 1980).

## Como a consulta funciona

- `GET deftohtm3.exe?secretarias/saude/TABNET/<base>.def` devolve o formulário (Windows-1252). Dele saem
  os códigos das opções (`<SELECT NAME="...">`) e a data de atualização do rodapé
  (`Data de atualização: DD/MM/AAAA` ou `Atualizado em DD/MM/AAAA`; a tuberculose traz uma por período,
  o script pega a maior).
- `POST tabcgi.exe?<mesmo caminho>` com `Linha=<campo do distrito>`, `Coluna=--Não-Ativa--`,
  `Incremento=Nº_de_Casos`, um `Arquivos=` por arquivo, filtros `S<campo>=<código>`, `zeradas=exibirlz`
  (distrito sem caso vem como 0, não some) e `formato=prn`. O corpo vai em **cp1252**.
- A resposta tem um `<PRE>` com `"rótulo";número` e a linha `"Total"`.
- Só **https** responde fora do navegador; `http://` fica pendurado.
- Os códigos das opções são posição na lista (o ano 2026 era `19` na tuberculose): mudam quando entra um
  ano novo. Por isso o script resolve tudo pelo **rótulo**, nunca por código fixo.

## Nomes que não são distrito

| Rótulo no TabNet | Tratamento |
|---|---|
| `Não localizado`, `Não localizado ou sem informação válida`, `DA não classificado`, `Em branco` | `sem_distrito`: entra no total da cidade, fica fora do mapa |
| `Localizado fora do MSP` | `fora_do_municipio`: fica fora do total da cidade |
| `CAPELA DO SOCORRO` (tuberculose) | apelido de `socorro` |
| `Jardim São Luiz` | apelido de `jardim-sao-luis` (mesmo da COVISA) |

Qualquer outro nome sem par no GeoJSON, distrito faltando ou soma diferente do `Total` faz a doença falhar;
o bloco anterior dela continua no arquivo.

## Formato de `data/tabnet_distrito.json`

```json
{
 "fonte": "TabNet da Secretaria Municipal da Saúde de São Paulo",
 "gerado_em": "ISO-8601",
 "doencas": {
  "srag": {
   "fonte": "SIVEP-Gripe/DVE/COVISA/SMS-SP", "url": "formulário do TabNet",
   "ano": 2026, "atualizado_em": "AAAA-MM-DD", "extraido_em": "ISO-8601",
   "medida": "internações por SRAG no ano", "observacao": "...",
   "total": 10589, "sem_distrito": 422, "fora_do_municipio": 0,
   "distritos": { "<id_distrito>": { "casos_ano": 608 } }
  }
 }
}
```

`total` = soma dos distritos + `sem_distrito` (moradores da capital). Sem incidência: o TabNet não traz
população, e o site não estima. O mapa usa a cor proporcional a casos, como já fazia com a chikungunya.

## Virada de ano

O script consulta o ano corrente. Enquanto o TabNet não tiver arquivo (ou opção) do ano novo, a doença falha
com "o TabNet ainda não tem arquivo de AAAA" e o site continua mostrando o ano anterior, com o ano escrito.
