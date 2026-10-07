/*
 * Epi — assistente do Epimapa SP (balão no canto inferior direito).
 *
 * Roda inteiro no navegador: entende a pergunta por palavras-chave e responde com os
 * mesmos JSONs que o mapa já carregou (InfoDengue e COVISA) ou com textos fixos sobre
 * as doenças. Não chama API, não guarda e não envia o que a pessoa digita (LGPD):
 * a conversa vive só na memória da página e some ao fechar.
 *
 * Os números vêm só de CONSULTAS (distrito, subprefeitura, comparação, ranking, cidade,
 * tendência). Na fase 5, um LLM com tool use pode chamar essas mesmas funções no lugar
 * do reconhecimento por palavras-chave, sem mudar de onde vêm os números.
 *
 * Uso: mapa.html e a página inicial (index.html) chamam EpiChat.iniciar(ctx) depois de
 * carregar os dados, ou EpiChat.iniciar(null) se o carregamento falhou (aí só os textos
 * fixos funcionam). Na página inicial, selecionar(id) abre o mapa no distrito.
 *   ctx = { distritos: [{id, nome, sub}], distritoDados, cidadeDados,
 *           doenca(), selecionado(), trocarDoenca(d), selecionar(id) }
 */
(function () {
  "use strict";

  const fmt = new Intl.NumberFormat("pt-BR");
  const fmt1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const DOENCAS = ["dengue", "chikungunya", "zika"];
  const NOME = { dengue: "dengue", chikungunya: "chikungunya", zika: "zika" };
  const NIVEL_NOME = { 1: "verde", 2: "amarelo", 3: "laranja", 4: "vermelho" };
  const reduzMovimento = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = () => matchMedia("(max-width: 900px) and (min-height: 500px), (max-width: 560px)").matches; // mesma consulta do CSS do mapa.html e do index.html

  // minúsculas, sem acento, pontuação vira espaço: "M'Boi Mirim?" -> "m boi mirim"
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const dataBR = (s) => s ? new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR") : "—";

  const RE_DOENCA = {
    dengue: /\bdengue\b/,
    chikungunya: /\bchi[ck]+u?n?gu|\bchik\b/,
    zika: /\bzi[kc]a\b/,
  };

  // Bairros conhecidos que não são distritos e grafias comuns. Só os casos sem dúvida
  // sobre o distrito a que pertencem.
  const APELIDOS = {
    "paraisopolis": { id: "vila-andrade", bairro: "Paraisópolis" },
    "heliopolis": { id: "sacoma", bairro: "Heliópolis" },
    "higienopolis": { id: "consolacao", bairro: "Higienópolis" },
    "vila olimpia": { id: "itaim-bibi", bairro: "Vila Olímpia" },
    "aclimacao": { id: "liberdade", bairro: "Aclimação" },
    "guaianazes": { id: "guaianases" },
    "sao miguel paulista": { id: "sao-miguel" },
    "jardim sao luiz": { id: "jardim-sao-luis" },
    "freguesia": { id: "freguesia-do-o" },
    "capao": { id: "capao-redondo" },
    "tiradentes": { id: "cidade-tiradentes" },
    "ermelino": { id: "ermelino-matarazzo" },
  };
  const AMBIGUOS = {
    "itaim": ["itaim-bibi", "itaim-paulista"],
    "centro": ["se", "republica"],
  };
  // Nomes de distrito que também são palavras comuns: só contam com contexto de lugar.
  const EXIGE_CONTEXTO = {
    "se": (t, o) => /(^|[^\p{L}])sé(?!\p{L})/iu.test(o) || /\b(distrito|bairro|regiao|subprefeitura) (da )?se\b/.test(t),
    "saude": (t, o) => /\b(na|distrito( da)?|bairro( da)?|regiao da|subprefeitura( da)?) saude\b/.test(t) || /.\bSa[uú]de\b/.test(o),
    "socorro": (t, o) => /\b(no|distrito( do)?|bairro( do)?|regiao do) socorro\b/.test(t) || /.\bSocorro\b/.test(o),
  };

  // ---------- reconhecimento (sobre o texto normalizado) ----------
  const LUGARISH = /\b(distritos?|bairros?|regia[o]|regioes|lugar(es)?|onde|areas?|subprefeituras?|zonas?)\b/;
  const R = {
    emergencia: /\b(sangr\w*|falta de ar|nao consigo respirar|dificuldade (para |pra |de )?respirar|desmai\w*|convuls\w*|manchas? roxas?|vomit\w* (muito|sem parar|toda hora|o tempo todo)|nao para de vomitar|dor (muito )?(forte|intensa) na barriga|muita dor na barriga|dor abdominal|urgente|emergencia|sonolen\w*|confus[ao]\w* mental)\b|^socorro\b|\bsocorro (estou|to|preciso|me ajud)/,
    saudacao: /^(oi+|ola|opa|e ai|eai|bom dia|boa tarde|boa noite|hey|hi|hello|salve|tudo bem)\b/,
    obrigado: /\b(obrigad[oa]s?|valeu|vlw|brigad[oa]|agradec\w*|thanks|show|perfeito|otimo|entendi)\b/,
    privacidade: /\b(privacidade|lgpd|meus dados|guarda\w*|salva\w*|grava\w*|rastre\w*|anonim\w*|espion\w*|coleta\w*|cookies?)\b/,
    sobre: /\b(quem (fez|faz|criou|desenvolveu)|sobre o (site|projeto|mapa)|o que e (o |esse |este )?(site|epimapa|projeto)|epimapa|quem e (voce|vc)|seu nome|voce e (um )?(robo|humano|ia|bot))\b/,
    ajuda: /\b(ajuda|help|o que (voce|vc) (faz|sabe|responde)|o que (eu )?posso (perguntar|fazer)|menu|opcoes|comandos)\b/,
    usar: /\b(como (eu )?(uso|usar|utiliz\w*|mexo|navego|vejo|seleciono)|como (ver|achar|encontrar|escolher) (o |meu |um )?(distrito|bairro)|como funciona (o )?(mapa|site))\b/,
    aqui: /\b(aqui|meu bairro|minha regiao|meu distrito|minha area|selecionad\w*|ess[ea] distrito|est[ea] distrito|ness[ea] distrito|nest[ea] distrito|dess[ea] distrito|dest[ea] distrito|onde (eu )?moro|perto de mim|por aqui)\b/,
    ranking: /\b(ranking|top( \d+)?|campe\w*|lider\w*)\b/,
    mais: /\b(mais|maior(es)?|pior(es)?|alt[oa]s?)\b/,
    menos: /\b(menos|menor(es)?|melhor(es)?|mais baix\w*|mais tranquil\w*|mais segur\w*)\b/,
    tendencia: /\b(subindo|sobe|aumentando|aumento|aumentou|caindo|cai|caiu|diminu\w*|queda|tendencia|crescendo|cresceu|piorando|piorou|melhorando|melhorou|evolu\w*|pico|epidemia|surto|historico|ultimas semanas|grafico)\b/,
    cidade: /\b(sao paulo|sp|cidade|municipio|capital|geral|total|quantos|quantas|numeros?|situacao|como esta|como anda|como ta|casos|panorama|resumo)\b/,
    ano: /\b(ano|anual|20\d\d|total|acumulad\w*|desde janeiro)\b/,
    cores: /\b(cor|cores|legenda|verde|amarel\w*|laranja|vermelh\w*|cinza|escala|mapa de calor)\b/,
    fonte: /\b(fontes?|de onde (vem|sao|saem|tiram|vieram)|origem|confiave\w*|oficia\w*|covisa|infodengue|fiocruz|boletim|boletins|verdade|reais|real|inventad\w*|mentira)\b/,
    atualizacao: /\b(atualiza\w*|atualizad\w*|quando (sai|saem|muda|mudam)|frequencia|toda semana|todo dia|diari\w*|recente\w*|de quando|data)\b/,
    novos: /\b(novos desde|negativ\w*|revis\w*|diminuiu o acumulado|caiu o acumulado|menos casos que antes)\b/,
    incidencia: /\b(incidencia|100 mil|cem mil|por mil|taxa)\b/,
    se: /\b(semana epidemiologica|semanas epidemiologicas|o que (e|significa) (a )?se)\b/,
    nivel: /\b(nivel|niveis|alerta)\b/,
    sinaisAlarme: /\bsina(l|is) de (alarme|alerta|gravidade|perigo)\b/,
    rua: /\b(rua|ruas|cep|endereco|quadra|quarteirao|meu predio|minha casa|minha rua|condominio|vizinhanca)\b/,
    zona: /\bzona (leste|norte|sul|oeste|central|centro)\b/,
    outras: /\b(covid\w*|coronavirus|gripe|influenza|sarampo|febre amarela|leptospirose|tuberculose|meningite|hepatite\w*|mpox|variola|oropouche|malaria|raiva|esporotricose|leishmaniose|pets?|cachorro|caes|gato|gatos|animal|animais)\b/,
    oque: /\b(o que e|o que significa|que doenca e|defin\w*|explica\w*|me fala sobre|fale sobre)\b/,
    alarme: /\b(grave|graves|gravidade|perig\w*|quando (devo )?(procurar|ir)|hospital|pronto socorro|intern\w*|morre\w*|mata|matar|morte|obito\w*|fatal|hemorragic\w*)\b/,
    vacina: /\b(vacin\w*|imuniz\w*|qdenga|butantan)\b/,
    gestante: /\b(gravid\w*|gestant\w*|gestacao|gravidez|bebe|microcefal\w*|feto|amament\w*|pre ?natal)\b/,
    denuncia: /\b(denunci\w*|156|reclama\w*|terreno (baldio|abandonado)|imovel abandonado|piscina|vistoria|agentes?)\b/,
    reinfeccao: /\b(de novo|novamente|segunda vez|outra vez|mais de uma vez|reinfec\w*|imune|imunidade|ja tive|pegar duas)\b/,
    atendimento: /\b(onde (ir|vou|procur\w*|atend\w*|fazer|faco|tratar)|ubs|posto|upa|ama|atendimento|medic[oa]s?|exames?|testes?|diagnostic\w*|consulta|o que (devo |eu )?fa(zer|co))\b/,
    tratamento: /\b(trat\w*|remedio\w*|medicament\w*|dipirona|paracetamol|ibuprofeno|aas|aspirina|anti ?inflamat\w*|diclofenaco|nimesulida|cura\w*|hidrat\w*|soro|chas?|caseiro|tomar)\b/,
    prevencao: /\b(previn\w*|preven\w*|evit\w*|proteg\w*|repelente\w*|agua parada|criadouro\w*|focos?|larva\w*|combat\w*|limp\w*|cuidados?|telas?|elimin\w*)\b/,
    mosquito: /\b(mosquito\w*|aedes|aegypti|pernilongo\w*|muricoca\w*)\b/,
    transmissao: /\b(transmi\w*|pega\w*|contagi\w*|passa (de|pra|para)|contamin\w*)\b/,
    duracao: /\b(quanto tempo|quantos dias|dura|duracao|incubacao|demora)\b/,
    diferenca: /\b(diferen\w*|distingu\w*|como saber (se|qual)|confund\w*)\b/,
    sintomas: /\b(sintoma\w*|sinais|sinal|como (saber|sei|identific\w*|reconhec\w*)|o que (se )?sente|febre|dor|dores|mancha\w*|coceira|estou com|to com|tenho)\b/,
  };

  // ---------- textos fixos ----------
  // Orientação geral do Ministério da Saúde, em linguagem simples. Não é diagnóstico.
  const TEXTOS = {
    oque: {
      dengue: ["A **dengue** é uma doença causada por um vírus transmitido pela picada do mosquito *Aedes aegypti*. Na maioria das vezes passa em uma ou duas semanas, mas pode ficar grave, principalmente quando a febre começa a baixar.", "Existem 4 tipos do vírus, por isso dá para ter dengue mais de uma vez."],
      chikungunya: ["A **chikungunya** é causada por um vírus transmitido pelo mesmo mosquito da dengue, o *Aedes aegypti*. A marca dela é a dor forte nas articulações, que pode durar meses depois que a febre passa."],
      zika: ["A **zika** é causada por um vírus transmitido pelo *Aedes aegypti* e também por relação sexual. Costuma ser leve, mas na gravidez pode causar microcefalia e outras alterações no bebê."],
      geral: ["Dengue, chikungunya e zika são **arboviroses**: doenças causadas por vírus e transmitidas pelo mosquito *Aedes aegypti*. Os sintomas se parecem, e só o exame confirma qual é."],
    },
    sintomas: {
      dengue: ["Sintomas mais comuns da **dengue**:", "• febre alta (39 °C ou mais) que começa de repente e dura de 2 a 7 dias", "• dor de cabeça e dor atrás dos olhos", "• dores no corpo e nas articulações", "• manchas vermelhas na pele, às vezes com coceira", "• cansaço, falta de apetite e enjoo", "O momento de mais atenção é quando a febre baixa (por volta do 3º ao 7º dia): é aí que podem surgir os sinais de alarme."],
      chikungunya: ["Sintomas mais comuns da **chikungunya**:", "• febre alta que começa de repente", "• **dor forte nas articulações** (mãos, pés, punhos, tornozelos), muitas vezes com inchaço", "• dor de cabeça, dores musculares e manchas vermelhas", "A dor nas articulações pode durar semanas ou meses depois que a febre passa."],
      zika: ["Sintomas mais comuns da **zika**:", "• febre baixa ou nenhuma febre", "• manchas vermelhas na pele, com coceira", "• olhos vermelhos, sem secreção", "• dor leve nas articulações", "Muita gente tem sintomas leves ou nenhum. O maior risco é na gravidez."],
      geral: ["As três se parecem no começo:", "• **Dengue**: febre alta, dor atrás dos olhos e dores no corpo", "• **Chikungunya**: febre alta e dor muito forte nas articulações", "• **Zika**: febre baixa ou nenhuma, manchas com coceira e olhos vermelhos", "Só o exame confirma qual é. Na dúvida, procure uma UBS."],
    },
    alarme: {
      dengue: ["Procure atendimento **imediatamente** se aparecer qualquer um destes sinais de alarme da dengue:", "• dor forte e contínua na barriga", "• vômitos que não param", "• sangramento (gengiva, nariz, urina, fezes) ou manchas roxas", "• tontura, desmaio ou pressão baixa ao levantar", "• sonolência, confusão ou irritação fora do normal", "• falta de ar", "• urina muito pouca", "Eles costumam aparecer quando a febre baixa. Em emergência, ligue **192 (SAMU)**."],
      chikungunya: ["Na **chikungunya**, procure atendimento logo se houver:", "• febre por mais de 5 dias", "• confusão, convulsão ou fraqueza nas pernas", "• sangramento ou falta de ar", "• dor que impede de andar ou de se cuidar", "Bebês, idosos, gestantes e pessoas com doenças crônicas devem ser avaliados mesmo com sintomas leves. Em emergência, ligue **192 (SAMU)**."],
      zika: ["Na **zika**, procure atendimento se houver:", "• fraqueza que começa nas pernas e vai subindo, ou formigamento forte (pode ser síndrome de Guillain-Barré, que é emergência)", "• qualquer sintoma na **gravidez**: vá ao pré-natal ou à UBS logo", "Em emergência, ligue **192 (SAMU)**."],
    },
    tratamento: {
      geral: ["Não existe remédio que mate o vírus; o tratamento alivia os sintomas e evita complicações:", "• **beba muita água** e líquidos (soro de reidratação, sucos, água de coco)", "• repouso", "• para febre e dor, use só o que um profissional indicar, em geral paracetamol ou dipirona", "• **não tome AAS (aspirina) nem anti-inflamatórios** (ibuprofeno, diclofenaco, nimesulida) enquanto não descartar dengue: aumentam o risco de sangramento", "Mesmo com sintomas leves, vale passar numa UBS para ser avaliado."],
    },
    prevencao: {
      geral: ["O mosquito nasce em água parada, então o que mais funciona é acabar com os criadouros. Dez minutos por semana dão conta:", "• garrafas, baldes e potes de boca para baixo", "• pratinhos de vaso com areia até a borda, ou lavados toda semana", "• caixa-d'água, tonéis e cisternas sempre tampados", "• calhas limpas, sem folhas entupindo", "• pneus guardados secos e cobertos; lixo tampado", "• ralos fechados ou com tela", "Para se proteger da picada: repelente (siga o rótulo), roupa comprida e tela nas janelas. O mosquito pica mais **de dia**, de manhã e no fim da tarde."],
    },
    mosquito: {
      geral: ["O ***Aedes aegypti*** é pequeno, escuro e tem listras brancas no corpo e nas pernas. Ele transmite dengue, chikungunya e zika.", "• pica principalmente de dia, de manhã cedo e no fim da tarde", "• põe ovos na parede de recipientes com água parada e limpa", "• os ovos aguentam mais de um ano secos, por isso vale esfregar os recipientes, não só esvaziar", "Quem está doente deve usar repelente: o mosquito pega o vírus picando uma pessoa infectada e passa adiante."],
    },
    denuncia: {
      geral: ["Para pedir vistoria de um possível foco do mosquito (terreno baldio, imóvel abandonado, piscina sem cuidado, entulho), use a **Central SP156** da Prefeitura: ligue **156** ou use o portal ou o app SP156.", "A vistoria é feita pelos agentes da vigilância em saúde da sua região (UVIS)."],
    },
    transmissao: {
      geral: ["As três são transmitidas pela picada da fêmea do mosquito ***Aedes aegypti*** infectada. Não passam de pessoa para pessoa por contato, abraço, tosse ou objetos.", "A **zika** é a exceção: também passa por relação sexual e da gestante para o bebê."],
    },
    vacina: {
      dengue: ["Existe vacina contra a **dengue** no SUS, mas por enquanto só para públicos específicos (faixas etárias e grupos definidos pelo Ministério da Saúde, que vêm sendo ampliados).", "Pergunte na sua UBS se você está no público atual. A vacina não substitui a eliminação de criadouros."],
      chikungunya: ["Até a última revisão deste texto, não havia vacina contra **chikungunya** na rede pública. Confirme na sua UBS: o calendário muda."],
      zika: ["Não existe vacina contra a **zika**. A proteção é evitar a picada e usar preservativo se o parceiro teve zika."],
      geral: ["Existe vacina contra a **dengue** no SUS para públicos específicos, que vêm sendo ampliados; pergunte na sua UBS. Para chikungunya e zika não havia vacina na rede pública até a última revisão deste texto."],
    },
    gestante: {
      geral: ["Na gravidez, a **zika** pode causar microcefalia e outras alterações no bebê, e dengue e chikungunya também pedem mais cuidado:", "• use repelente indicado para gestantes (pergunte no pré-natal)", "• roupa comprida e tela nas janelas", "• com febre ou manchas vermelhas, procure o pré-natal ou a UBS logo", "• use preservativo se o parceiro teve zika"],
    },
    diferenca: {
      geral: ["Como diferenciar, em geral:", "• **Dengue**: febre alta, dor atrás dos olhos e no corpo; o risco de forma grave aparece quando a febre baixa", "• **Chikungunya**: febre alta e dor muito forte nas articulações, que pode durar meses", "• **Zika**: febre baixa ou nenhuma, manchas com coceira e olhos vermelhos; risco maior na gravidez", "Só o exame confirma. Na dúvida, trate como dengue: muita água e nada de AAS ou anti-inflamatório."],
    },
    atendimento: {
      geral: ["Com sintomas, procure a **UBS** mais próxima (dias úteis) ou uma **AMA/UPA** fora desse horário. Para saber qual é a UBS do seu endereço, ligue **156**.", "Com sinais de alarme (dor forte na barriga, vômitos que não param, sangramento, tontura, falta de ar), vá a um pronto-socorro ou ligue **192 (SAMU)**.", "Enquanto isso: muita água, repouso e nada de AAS ou anti-inflamatório."],
    },
    reinfeccao: {
      dengue: ["Sim. Existem **4 tipos** (sorotipos) do vírus da dengue, e pegar um protege só contra aquele. Dá para ter dengue até 4 vezes, e a segunda infecção tem mais chance de ser grave."],
      chikungunya: ["Em geral, quem teve **chikungunya** fica protegido contra ela depois. Mas continua podendo pegar dengue e zika."],
      zika: ["Em geral, quem teve **zika** fica protegido contra ela depois. Mas continua podendo pegar dengue e chikungunya."],
      geral: ["Na **dengue**, sim: são 4 tipos de vírus e dá para pegar até 4 vezes, com a segunda infecção mais arriscada. Chikungunya e zika costumam deixar proteção depois da primeira vez."],
    },
    duracao: {
      dengue: ["Na **dengue**, os sintomas começam de 4 a 10 dias depois da picada. A febre dura de 2 a 7 dias; o cansaço pode seguir por algumas semanas."],
      chikungunya: ["Na **chikungunya**, os sintomas começam de 3 a 7 dias depois da picada. A febre passa em cerca de uma semana, mas a dor nas articulações pode durar meses."],
      zika: ["Na **zika**, os sintomas começam de 3 a 12 dias depois da picada e costumam durar de 3 a 7 dias."],
      geral: ["Os sintomas começam alguns dias depois da picada (de 3 a 12, conforme a doença) e a febre costuma durar até uma semana. Na chikungunya, a dor nas articulações pode durar meses."],
    },
  };

  // APELIDOS também serve às buscas do mapa e da página inicial: todas entendem os mesmos bairros.
  window.EpiChat = { iniciar, APELIDOS };

  function iniciar(ctx) {
    const $ = (id) => document.getElementById(id);
    const botao = $("chat-abrir"), janela = $("chat"), msgs = $("chat-msgs");
    const form = $("chat-form"), campo = $("chat-input"), sugestoes = $("chat-sugestoes");
    if (!botao || !janela) return;

    const dd = ctx && ctx.distritoDados, cd = ctx && ctx.cidadeDados;
    const distritos = ctx ? ctx.distritos : [];
    const porId = Object.fromEntries(distritos.map(d => [d.id, d]));
    const subs = [...new Set(distritos.map(d => d.sub))];

    // Conversa só em memória: o que a pessoa já perguntou, para entender "e chikungunya?".
    const estado = { intencao: null, lugar: null, doenca: null, topico: null };
    let jaAbriu = false;

    // ---------- índice de lugares ----------
    const entradas = [];
    for (const d of distritos) {
      const chave = norm(d.nome);
      entradas.push({ chave, tipo: "distrito", id: d.id, exige: EXIGE_CONTEXTO[chave] });
    }
    for (const [chave, a] of Object.entries(APELIDOS)) if (porId[a.id]) entradas.push({ chave, tipo: "distrito", id: a.id, bairro: a.bairro });
    for (const [chave, ids] of Object.entries(AMBIGUOS)) entradas.push({ chave, tipo: "ambiguo", ids: ids.filter(id => porId[id]) });
    const temSub = (t) => /\bsub(prefeituras?|s)?\b/.test(t);
    for (const s of subs) {
      const partes = s.split("/").map(norm);
      const inteira = partes.join(" ");
      const ehDistrito = entradas.some(e => e.tipo === "distrito" && e.chave === inteira);
      entradas.push({ chave: inteira, tipo: "sub", sub: s, exige: ehDistrito ? temSub : null });
      if (partes.length > 1) for (const p of partes) entradas.push({ chave: p, tipo: "sub", sub: s, exige: temSub });
      if (inteira === "m boi mirim") entradas.push({ chave: "mboi mirim", tipo: "sub", sub: s }, { chave: "m boi", tipo: "sub", sub: s });
    }
    // Mais longo primeiro ("alto de pinheiros" antes de "pinheiros"); no empate, subprefeitura antes,
    // porque ela só entra quando a pessoa escreveu "subprefeitura".
    entradas.sort((a, b) => b.chave.length - a.chave.length || (a.tipo === "sub" ? -1 : 0) - (b.tipo === "sub" ? -1 : 0));

    function acharLugares(t, original) {
      let resto = ` ${t} `;
      const achados = [];
      for (const e of entradas) {
        const alvo = ` ${e.chave} `;
        const i = resto.indexOf(alvo);
        if (i < 0 || (e.exige && !e.exige(t, original))) continue;
        resto = resto.slice(0, i) + " # " + resto.slice(i + alvo.length);
        achados.push({ ...e, pos: i });
      }
      return achados.sort((a, b) => a.pos - b.pos);
    }

    function lev(a, b) {
      if (Math.abs(a.length - b.length) > 2) return 9;
      let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const atual = [i];
        for (let j = 1; j <= b.length; j++) atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        ant = atual;
      }
      return ant[b.length];
    }
    // Só no fim, quando nada mais casou: "itakera" -> Itaquera.
    function parecido(t) {
      const palavras = t.split(" ");
      let melhor = null;
      for (const e of entradas) {
        if (e.tipo !== "distrito" || e.exige) continue;
        const k = e.chave.split(" ").length;
        for (let i = 0; i + k <= palavras.length; i++) {
          const trecho = palavras.slice(i, i + k).join(" ");
          if (trecho.length < 5) continue;
          const d = lev(trecho, e.chave);
          if (d <= (e.chave.length >= 8 ? 2 : 1) && (!melhor || d < melhor.d)) melhor = { id: e.id, d };
        }
      }
      return melhor && melhor.id;
    }

    // ---------- consultas aos dados ----------
    const semDadosDistrito = (d) => !dd || (dd.sem_dados_por_distrito || []).includes(d);
    const dadosDe = (d) => (dd && dd.doencas[d]) || {};
    const medida = (x) => typeof x.inc100k_ano === "number" ? x.inc100k_ano : (x.casos_ano || 0);
    const temIncidencia = (d) => Object.values(dadosDe(d)).some(x => typeof x.inc100k_ano === "number");
    const ordem = (d) => Object.entries(dadosDe(d)).sort((a, b) => medida(b[1]) - medida(a[1])).map(e => e[0]);
    const refCovisa = () => `COVISA/SMS-SP, boletim SE ${dd.se}/${dd.ano}`;
    const pergunta = (rotulo, texto = rotulo) => ({ rotulo, pergunta: texto });
    const noMapa = (id, d) => ({ rotulo: `Ver ${porId[id].nome} no mapa`, mapa: { id, doenca: d } });
    const semCarga = () => ({ linhas: ["Não consegui carregar os dados do mapa agora, então estou sem os números. Tente recarregar a página. Sobre sintomas, prevenção e atendimento eu continuo respondendo."] });
    const casosRotulo = (d) => d === "chikungunya" ? "casos autóctones confirmados" : "casos confirmados";

    const CONSULTAS = {
      distrito(id, d, extras = {}) {
        if (!dd) return semCarga();
        const nome = porId[id].nome;
        const acoes = [];
        if (ctx.selecionado() !== id || ctx.doenca() !== d) acoes.push(noMapa(id, d));
        const linhas = extras.bairro ? [`${extras.bairro} fica no distrito **${nome}**. Os dados oficiais são por distrito.`] : [];
        if (semDadosDistrito(d)) {
          linhas.push(`O boletim da COVISA não traz **${NOME[d]}** por distrito (desde 2018), então não tenho esse número para ${nome}.`);
          return { linhas, acoes: DOENCAS.filter(x => !semDadosDistrito(x)).map(x => pergunta(`${cap(x)} em ${nome}`)) };
        }
        const x = dadosDe(d)[id];
        if (!x || x.casos_ano == null) {
          linhas.push(`O boletim da COVISA da SE ${dd.se}/${dd.ano} não traz número de ${NOME[d]} para ${nome}.`);
          return { linhas, acoes, fonte: refCovisa() };
        }
        const ant = dd.boletim_anterior_se;
        linhas.push(`**${nome}** (subprefeitura ${porId[id].sub}), ${NOME[d]} em ${dd.ano}:`);
        linhas.push(x.casos_ano === 0 ? `• nenhum caso ${d === "chikungunya" ? "autóctone " : ""}confirmado desde janeiro` : `• **${fmt.format(x.casos_ano)}** ${casosRotulo(d)} desde janeiro`);
        if (typeof x.inc100k_ano === "number") linhas.push(`• **${fmt1.format(x.inc100k_ano)}** casos por 100 mil habitantes no ano`);
        if (x.novos_desde_boletim != null && ant) {
          const n = x.novos_desde_boletim;
          linhas.push(n > 0 ? `• +${fmt.format(n)} desde o boletim anterior (SE ${ant.se})`
            : n < 0 ? `• −${fmt.format(-n)} desde o boletim anterior: o acumulado foi revisado para baixo pela COVISA`
            : `• nenhum caso novo desde o boletim anterior (SE ${ant.se})`);
        }
        if (x.casos_ano > 0) {
          const pos = ordem(d).indexOf(id) + 1;
          const crit = temIncidencia(d) ? "ª maior incidência" : "º maior número de casos";
          linhas.push(`• ${pos}${crit} entre os 96 distritos${pos <= 10 ? " (entre os 10 mais altos da cidade)" : ""}`);
        }
        if (extras.nivel) linhas.push("Por distrito a COVISA publica só o acumulado do ano, e não existe nível de alerta por distrito: o nível 1 a 4 vale para a cidade toda.");
        return { linhas, acoes, fonte: refCovisa() };
      },

      subprefeitura(sub, d) {
        if (!dd) return semCarga();
        const ids = distritos.filter(x => x.sub === sub).map(x => x.id);
        if (semDadosDistrito(d)) return { linhas: [`O boletim da COVISA não traz **${NOME[d]}** por distrito, então não tenho números da subprefeitura ${sub}.`] };
        const dados = dadosDe(d);
        const com = ids.filter(id => dados[id] && dados[id].casos_ano != null).sort((a, b) => medida(dados[b]) - medida(dados[a]));
        if (!com.length) return { linhas: [`O boletim não traz ${NOME[d]} para os distritos da subprefeitura ${sub}.`], fonte: refCovisa() };
        const soma = com.reduce((s, id) => s + dados[id].casos_ano, 0);
        const linhas = [`Subprefeitura **${sub}**, ${NOME[d]} em ${dd.ano}, por distrito:`];
        for (const id of com) {
          const x = dados[id];
          linhas.push(`• ${porId[id].nome}: **${fmt.format(x.casos_ano)}** casos${typeof x.inc100k_ano === "number" ? ` (${fmt1.format(x.inc100k_ano)} por 100 mil)` : ""}`);
        }
        if (com.length > 1) linhas.push(`Somando os ${com.length} distritos: ${fmt.format(soma)} ${casosRotulo(d)} desde janeiro.`);
        return { linhas, acoes: com.slice(0, 3).map(id => noMapa(id, d)), fonte: refCovisa() };
      },

      comparar(ids, d) {
        if (!dd) return semCarga();
        if (semDadosDistrito(d)) return { linhas: [`O boletim da COVISA não traz **${NOME[d]}** por distrito, então não dá para comparar.`] };
        const dados = dadosDe(d), inc = temIncidencia(d), ord = ordem(d);
        const linhas = [`Comparando ${NOME[d]} em ${dd.ano}:`];
        for (const id of ids) {
          const x = dados[id];
          if (!x || x.casos_ano == null) { linhas.push(`• **${porId[id].nome}**: sem número no boletim`); continue; }
          linhas.push(`• **${porId[id].nome}**: ${fmt.format(x.casos_ano)} casos${inc && typeof x.inc100k_ano === "number" ? `, ${fmt1.format(x.inc100k_ano)} por 100 mil` : ""} (${ord.indexOf(id) + 1}º de 96)`);
        }
        const [a, b] = ids.map(id => dados[id]);
        if (a && b && a.casos_ano != null && b.casos_ano != null && medida(a) !== medida(b)) {
          const [maior, menor] = medida(a) > medida(b) ? ids : [ids[1], ids[0]];
          linhas.push(inc ? `${porId[maior].nome} tem incidência maior: proporcionalmente à população, teve mais casos que ${porId[menor].nome}.`
            : `${porId[maior].nome} teve mais casos que ${porId[menor].nome}.`);
        }
        return { linhas, acoes: ids.map(id => noMapa(id, d)), fonte: refCovisa() };
      },

      ranking(d, { menores = false } = {}) {
        if (!dd) return semCarga();
        if (semDadosDistrito(d)) return { linhas: [`O boletim da COVISA não traz **${NOME[d]}** por distrito, então não tenho ranking de distritos para ela.`], acoes: [pergunta("Distritos com mais dengue")] };
        const dados = dadosDe(d), inc = temIncidencia(d);
        let ids = ordem(d);
        if (menores) {
          const zerados = ids.filter(id => dados[id].casos_ano === 0);
          if (zerados.length >= 5) {
            return { linhas: [`${zerados.length} dos 96 distritos não têm nenhum caso de ${NOME[d]} ${d === "chikungunya" ? "autóctone " : ""}confirmado em ${dd.ano}. Alguns deles:`, ...zerados.slice(0, 5).map(id => `• ${porId[id].nome}`)], fonte: refCovisa() };
          }
          ids = ids.slice().reverse();
        }
        const top = ids.slice(0, 5);
        const linhas = [`Distritos com ${menores ? "**menor**" : "**maior**"} ${inc ? "incidência" : "número de casos"} de ${NOME[d]} em ${dd.ano}:`];
        top.forEach((id, i) => {
          const x = dados[id];
          linhas.push(`• ${i + 1}. ${porId[id].nome}: ${inc ? `**${fmt1.format(x.inc100k_ano)}** por 100 mil (${fmt.format(x.casos_ano)} casos)` : `**${fmt.format(x.casos_ano)}** ${casosRotulo(d)}`}`);
        });
        if (inc) linhas.push("Incidência é casos por 100 mil habitantes: compara distritos de tamanhos diferentes. É o acumulado desde janeiro.");
        return { linhas, acoes: top.slice(0, 3).map(id => noMapa(id, d)), fonte: refCovisa() };
      },

      cidade(d, { ano = false, nivel = false } = {}) {
        if (!cd) return semCarga();
        const s = cd.doencas[d], a = s && s.atual;
        if (!a) return { linhas: [`O InfoDengue não tem série de **${NOME[d]}** para São Paulo neste momento, então não tenho o número da cidade.`], acoes: [pergunta("Como está a dengue em SP?")] };
        const sem = s.semanas, anterior = sem.length > 1 ? sem[sem.length - 2] : null;
        const linhas = [`**São Paulo**, ${NOME[d]} na semana epidemiológica ${a.se}/${a.ano}:`];
        linhas.push(`• **${fmt.format(a.casos)}** casos notificados na semana`);
        if (anterior) {
          const diff = a.casos - anterior.casos;
          linhas.push(diff === 0 ? "• igual à semana anterior"
            : `• ${diff > 0 ? "+" : "−"}${fmt.format(Math.abs(diff))} casos em relação à semana anterior${anterior.casos ? ` (${diff > 0 ? "+" : "−"}${Math.abs(Math.round(diff / anterior.casos * 100))}%)` : ""}`);
        }
        if (a.nivel) linhas.push(`• nível de alerta **${NIVEL_NOME[a.nivel]}** (${a.nivel} de 4)`);
        const doAno = sem.filter(x => x.ano === a.ano);
        if (ano && doAno.length === a.se) linhas.push(`• **${fmt.format(doAno.reduce((t, x) => t + (x.casos || 0), 0))}** casos notificados em ${a.ano} até agora (soma das semanas)`);
        linhas.push("As últimas semanas ainda sobem: notificações atrasadas entram nas próximas atualizações.");
        if (nivel) linhas.push("O nível vem do InfoDengue e vale para a cidade toda: 1 verde (transmissão baixa), 2 amarelo (clima favorável ao mosquito), 3 laranja (transmissão sustentada), 4 vermelho (incidência acima do esperado). Não existe nível por distrito.");
        return { linhas, acoes: [pergunta("Está subindo ou caindo?"), pergunta(`Distritos com mais ${NOME[d]}`)], fonte: `InfoDengue (Fiocruz/FGV), atualizado em ${dataBR(cd.atualizado_em)}` };
      },

      tendencia(d) {
        if (!cd) return semCarga();
        const s = cd.doencas[d], a = s && s.atual;
        if (!a || s.semanas.length < 8) return { linhas: [`Não tenho série semanal de **${NOME[d]}** para São Paulo no InfoDengue agora.`] };
        const sem = s.semanas, n = sem.length;
        const soma = (arr) => arr.reduce((t, x) => t + (x.casos || 0), 0);
        const rec = sem.slice(n - 4), prev = sem.slice(n - 8, n - 4);
        const sr = soma(rec), sp = soma(prev);
        const doAno = sem.filter(x => x.ano === a.ano);
        const pico = doAno.reduce((m, x) => (x.casos > m.casos ? x : m), doAno[0] || a);
        const var_ = sp ? Math.round((sr - sp) / sp * 100) : null;
        const linhas = [`**São Paulo**, ${NOME[d]}, casos notificados:`,
          `• SE ${rec[0].se} a ${rec[3].se}/${rec[3].ano}: **${fmt.format(sr)}** casos`,
          `• SE ${prev[0].se} a ${prev[3].se}/${prev[3].ano}: **${fmt.format(sp)}** casos`];
        if (var_ != null) linhas.push(var_ === 0 ? "Ficou praticamente igual." : `Isso é ${Math.abs(var_)}% ${var_ > 0 ? "a mais" : "a menos"} nas 4 semanas mais recentes.`);
        linhas.push(`O pico de ${a.ano} foi na SE ${pico.se}, com ${fmt.format(pico.casos)} casos na semana. Nível de alerta atual: **${NIVEL_NOME[a.nivel] || "—"}**.`);
        linhas.push("Atenção: as semanas mais recentes ainda vão subir com notificações atrasadas, então uma queda nelas pode ser menor do que parece.");
        return { linhas, fonte: `InfoDengue (Fiocruz/FGV), atualizado em ${dataBR(cd.atualizado_em)}` };
      },
    };
    const cap = (d) => NOME[d][0].toUpperCase() + NOME[d].slice(1);

    // ---------- textos que dependem dos dados ----------
    const SITE = {
      cores(d) {
        if (semDadosDistrito(d)) return { linhas: [`Para ${NOME[d]} o mapa fica todo **cinza**: o boletim da COVISA não traz essa doença por distrito.`, "Cinza no mapa sempre quer dizer “sem dados”, nunca “zero casos”."] };
        if (!temIncidencia(d)) return { linhas: [`Para ${NOME[d]}, a cor é proporcional ao número de **casos autóctones** (contraídos na cidade) confirmados desde janeiro em cada distrito: verde tem menos, vermelho tem mais. O boletim não traz incidência por distrito para essa doença.`, "Não é nível de alerta: o nível 1 a 4 existe só para a cidade toda."] };
        return { linhas: [`As cores mostram a **incidência acumulada no ano** de ${NOME[d]}: casos confirmados por 100 mil habitantes desde janeiro, por distrito.`, "• verde: menos de 20 por 100 mil", "• amarelo: por volta de 60", "• laranja: por volta de 150", "• vermelho: 300 ou mais", "Não é nível de alerta: o nível 1 a 4 existe só para a cidade toda. Cinza quer dizer “sem dados”."] };
      },
      fonte() {
        return { linhas: ["Todos os números vêm de fontes oficiais:", "• **cidade**: InfoDengue (Fiocruz/FGV), casos notificados por semana e nível de alerta", "• **distritos**: boletim semanal de arboviroses da COVISA, da Secretaria Municipal da Saúde de São Paulo, com casos confirmados acumulados no ano", "• **mapa dos distritos**: GeoSampa, da Prefeitura", "Nada é estimado nem inventado: quando a fonte não traz um número, o mapa mostra “sem dados”."] };
      },
      atualizacao() {
        const l = ["O site busca os dados automaticamente **toda madrugada**. As fontes publicam por semana: o InfoDengue atualiza a série semanal e a COVISA solta um boletim por semana epidemiológica."];
        if (cd && dd) l.push(`Agora estão no ar: InfoDengue atualizado em ${dataBR(cd.atualizado_em)} e boletim COVISA da SE ${dd.se}/${dd.ano}.`);
        return { linhas: l };
      },
      zikaSemDados() {
        const l = ["A COVISA deixou de publicar zika por distrito em 2018, por isso o mapa fica cinza para zika."];
        const z = cd && cd.doencas.zika;
        if (!(z && z.atual)) l.push("E o InfoDengue também não tem série de zika para São Paulo neste momento. Preferimos mostrar “sem dados” a mostrar um número inventado.");
        return { linhas: l, acoes: [pergunta("Sintomas de zika"), pergunta("Zika na gravidez")] };
      },
      novos() {
        return { linhas: ["“Novos desde o boletim anterior” é a diferença do acumulado do ano entre o boletim atual e o anterior da COVISA.", "Não é “casos da semana”: a COVISA revisa semanas passadas, então o número pode ser **negativo** quando casos são reclassificados ou descartados. Isso é esperado."] };
      },
      incidencia() {
        return { linhas: ["**Incidência** é o número de casos por 100 mil habitantes. Ela permite comparar distritos de tamanhos diferentes: 50 casos num distrito pequeno pesam mais que 50 casos num distrito grande.", "No mapa, é a incidência acumulada desde janeiro."] };
      },
      se() {
        const a = cd && cd.doencas.dengue && cd.doencas.dengue.atual;
        const l = ["**Semana epidemiológica (SE)** é como a saúde conta o tempo: o ano é dividido em semanas de domingo a sábado, numeradas de 1 a 52 (às vezes 53)."];
        if (a && a.inicio) l.push(`A SE ${a.se}/${a.ano}, a mais recente no site, começou em ${dataBR(a.inicio)}.`);
        return { linhas: l };
      },
      rua() {
        const sel = ctx && ctx.selecionado();
        return { linhas: ["Não existe dado público por rua, CEP ou endereço. O menor recorte oficial é o **distrito** (são 96 na cidade).", "Toque no seu distrito no mapa ou escreva o nome dele aqui."], acoes: sel ? [pergunta(`Como está ${porId[sel].nome}?`)] : [] };
      },
      zona() {
        return { linhas: ["Os dados oficiais são por distrito e subprefeitura, não por zona. Escreva o nome do distrito ou da subprefeitura, por exemplo “Itaquera” ou “subprefeitura da Penha”."], acoes: [pergunta("Distritos com mais casos")] };
      },
      outras() {
        return { linhas: ["Por enquanto o mapa cobre só as arboviroses urbanas: **dengue, chikungunya e zika**. Não tenho dados de outras doenças aqui."], acoes: [pergunta("Como está a dengue em SP?")] };
      },
      privacidade() {
        return { linhas: ["Eu funciono inteiro no seu navegador: o que você escreve aqui **não é enviado nem guardado** em lugar nenhum e some quando você fecha a página.", "O site não tem login e não coleta dados de saúde de quem usa."] };
      },
      sobre() {
        return { linhas: ["O **Epimapa SP** mostra dengue, chikungunya e zika por distrito da cidade de São Paulo com dados públicos de vigilância (InfoDengue e COVISA).", "Eu sou o **Epi**, um assistente automático: respondo com os números do último boletim e com orientações gerais do Ministério da Saúde. Não sou médico nem substituo atendimento."], acoes: [pergunta("O que você sabe responder?")] };
      },
      usar() {
        return { linhas: ["Como usar o mapa:", "• escolha a doença nos botões do topo", "• toque ou clique num distrito para ver os números dele", "• use a busca para achar um distrito ou uma subprefeitura", "• para voltar ao resumo da cidade, use “Ver a cidade toda”", "Ou me pergunte direto, por exemplo “dengue em Itaquera”."] };
      },
      ajuda() {
        return { linhas: ["Posso responder sobre:", "• números de um distrito ou subprefeitura (“dengue em Itaquera”)", "• como está a cidade e se está subindo ou caindo", "• quais distritos têm mais casos", "• sintomas, sinais de alarme, prevenção e onde procurar atendimento", "• como ler o mapa e de onde vêm os dados"], acoes: sugestoesPadrao().slice(0, 4) };
      },
    };

    function texto(topico, d) {
      const t = TEXTOS[topico];
      return t[d] || t.geral || t.dengue;
    }
    function respostaTexto(topico, d) {
      const r = { linhas: texto(topico, d).slice() };
      const seguintes = {
        sintomas: [pergunta("Quais os sinais de alarme?"), pergunta("O que fazer se eu tiver sintomas?")],
        oque: [pergunta(`Sintomas de ${NOME[d] || "dengue"}`), pergunta("Como evitar o mosquito?")],
        alarme: [pergunta("Onde procurar atendimento?")],
        prevencao: [pergunta("Como denunciar um foco do mosquito?")],
        mosquito: [pergunta("Como evitar o mosquito?")],
        tratamento: [pergunta("Quais os sinais de alarme?")],
        diferenca: [pergunta("O que fazer se eu tiver sintomas?")],
      }[topico];
      if (seguintes) r.acoes = seguintes;
      if (["sintomas", "alarme", "tratamento", "atendimento", "diferenca", "gestante"].includes(topico)) r.fonte = "Orientação geral do Ministério da Saúde. Não substitui avaliação médica.";
      return r;
    }

    function sugestoesPadrao() {
      const sel = ctx && ctx.selecionado();
      const lista = [];
      if (sel) lista.push(pergunta(`Como está ${porId[sel].nome}?`));
      lista.push(pergunta("Como está a dengue em SP?"), pergunta("Onde tem mais casos?"), pergunta("Sintomas de dengue"),
        pergunta("Como evitar o mosquito?"), pergunta("O que as cores significam?"), pergunta("De onde vêm os dados?"));
      return lista;
    }

    // ---------- interpretação ----------
    function responder(original) {
      const t = norm(original);
      if (!t) return null;
      const tem = (re) => re.test(t);
      const citadas = DOENCAS.filter(d => RE_DOENCA[d].test(t));
      const doencaCitada = citadas[0] || null;
      // A doença da pergunta anterior vale para a seguinte ("dengue em Itaquera" → "e na Penha?"),
      // menos zika, que não tem número em lugar nenhum e deixaria as próximas respostas vazias.
      const lembrada = estado.doenca && estado.doenca !== "zika" ? estado.doenca : null;
      const doencaDados = doencaCitada || lembrada || (ctx ? ctx.doenca() : "dengue");
      const lugares = acharLugares(t, original);
      const lugar = lugares.find(l => l.tipo !== "ambiguo");
      const ambiguo = lugares.find(l => l.tipo === "ambiguo");
      const placeish = tem(LUGARISH);
      const lembrar = (intencao, extra = {}) => Object.assign(estado, { intencao, topico: null, doenca: doencaCitada || estado.doenca }, extra);
      const topico = (nome, d = doencaCitada) => { Object.assign(estado, { intencao: "topico", topico: nome, doenca: doencaCitada || estado.doenca }); return respostaTexto(nome, d); };

      // 1. urgência vem antes de tudo
      if (tem(R.emergencia)) {
        estado.topico = "alarme";
        const r = respostaTexto("alarme", doencaCitada || "dengue");
        r.linhas.unshift("**Se isso está acontecendo agora**, procure um pronto-socorro ou ligue **192 (SAMU)**. Não espere a febre passar.");
        return r;
      }
      // 2. conversa
      const palavras = t.split(" ").length;
      if (tem(R.saudacao) && palavras <= 4 && !lugar && !citadas.length) return { linhas: ["Oi! Eu sou o **Epi**. Pergunte sobre o mapa, os números de um distrito ou sobre dengue, chikungunya e zika."], acoes: sugestoesPadrao().slice(0, 4) };
      if (tem(R.obrigado) && palavras <= 5 && !lugar && !citadas.length) return { linhas: ["Por nada! Se tiver outra dúvida, é só perguntar."] };
      if (tem(R.privacidade)) return SITE.privacidade();
      if (tem(R.sobre)) return SITE.sobre();
      if (tem(R.ajuda)) return SITE.ajuda();
      if (tem(R.usar)) return SITE.usar();

      // 3. lugar com nome
      if (ambiguo && !lugar) {
        return { linhas: [`Tem mais de um distrito com esse nome. Qual deles?`], acoes: ambiguo.ids.map(id => pergunta(porId[id].nome, `${cap(doencaDados)} em ${porId[id].nome}`)) };
      }
      const distritosAchados = lugares.filter(l => l.tipo === "distrito");
      if (distritosAchados.length >= 2 && distritosAchados[0].id !== distritosAchados[1].id) {
        lembrar("comparar", { lugar: null });
        return CONSULTAS.comparar([distritosAchados[0].id, distritosAchados[1].id], doencaDados);
      }
      if (lugar && lugar.tipo === "sub") { lembrar("sub", { lugar }); return CONSULTAS.subprefeitura(lugar.sub, doencaDados); }
      if (lugar) { lembrar("distrito", { lugar }); return CONSULTAS.distrito(lugar.id, doencaDados, { bairro: lugar.bairro, nivel: tem(R.nivel) }); }

      // 4. perguntas sobre os números da cidade
      if (tem(R.sinaisAlarme)) return topico("alarme", doencaCitada || "dengue");
      if ((tem(R.ranking) || (tem(R.mais) && placeish)) && !tem(R.menos)) { lembrar("ranking"); return CONSULTAS.ranking(doencaDados); }
      if (tem(R.menos) && placeish) { lembrar("ranking-menos"); return CONSULTAS.ranking(doencaDados, { menores: true }); }
      if (tem(R.tendencia)) { lembrar("tendencia"); return CONSULTAS.tendencia(doencaDados); }

      // 5. sobre o site e os dados
      if (citadas.includes("zika") && /\b(sem dados?|cinza|vazio|nao aparece|nao tem|por que|porque)\b/.test(t)) return SITE.zikaSemDados();
      if (tem(R.rua)) return SITE.rua();
      if (tem(R.zona)) return SITE.zona();
      if (tem(R.outras)) return SITE.outras();
      if (tem(R.novos)) return SITE.novos();
      if (tem(R.cores)) return SITE.cores(doencaDados);
      if (tem(R.incidencia)) return SITE.incidencia();
      if (tem(R.se)) return SITE.se();
      if (tem(R.fonte)) return SITE.fonte();
      if (tem(R.atualizacao)) return SITE.atualizacao();
      if (tem(R.nivel)) { lembrar("cidade"); return CONSULTAS.cidade(doencaDados, { nivel: true }); }

      // 6. sobre as doenças (ordem importa: "pegar de novo" é reinfecção, não transmissão)
      if (tem(R.vacina)) return topico("vacina");
      if (tem(R.gestante)) return topico("gestante");
      if (tem(R.alarme)) {
        const r = topico("alarme", doencaCitada || "dengue");
        if (/\b(morre\w*|mata|matar|morte|obito\w*|fatal)\b/.test(t)) r.linhas.unshift("A maioria das pessoas melhora sem complicações, mas a forma grave pode matar, principalmente quando os sinais de alarme não são percebidos a tempo. Por isso vale conhecer:");
        return r;
      }
      if (tem(R.denuncia)) return topico("denuncia");
      if (tem(R.reinfeccao)) return topico("reinfeccao");
      if (tem(R.atendimento)) return topico("atendimento");
      if (tem(R.tratamento)) return topico("tratamento");
      if (tem(R.prevencao)) return topico("prevencao");
      if (tem(R.mosquito)) return topico("mosquito");
      if (tem(R.transmissao)) return topico("transmissao");
      if (tem(R.duracao)) return topico("duracao");
      if (tem(R.diferenca) || citadas.length >= 2) return topico("diferenca");
      if (tem(R.oque) && citadas.length) return topico("oque");
      if (tem(R.sintomas)) return topico("sintomas");

      // 7. "aqui", "meu bairro": usa o distrito selecionado no mapa
      if (tem(R.aqui)) {
        const sel = ctx && ctx.selecionado();
        if (sel) { lembrar("distrito", { lugar: { tipo: "distrito", id: sel } }); return CONSULTAS.distrito(sel, doencaDados, { nivel: tem(R.nivel) }); }
        return { linhas: ["Qual é o seu distrito? Escreva o nome dele aqui ou toque nele no mapa. Os dados oficiais são por distrito (são 96 na cidade)."] };
      }

      // 8. número da cidade
      if (tem(R.cidade)) { lembrar("cidade"); return CONSULTAS.cidade(doencaDados, { ano: tem(R.ano) }); }

      // 9. só o nome de uma doença: continua o assunto anterior com a outra doença ("e chikungunya?")
      if (doencaCitada) {
        const d = doencaCitada;
        estado.doenca = d;
        if (estado.intencao === "distrito" && estado.lugar) return CONSULTAS.distrito(estado.lugar.id, d);
        if (estado.intencao === "sub" && estado.lugar) return CONSULTAS.subprefeitura(estado.lugar.sub, d);
        if (estado.intencao === "ranking") return CONSULTAS.ranking(d);
        if (estado.intencao === "ranking-menos") return CONSULTAS.ranking(d, { menores: true });
        if (estado.intencao === "tendencia") return CONSULTAS.tendencia(d);
        if (estado.intencao === "topico" && estado.topico) return respostaTexto(estado.topico, d);
        estado.intencao = "cidade";
        const r = CONSULTAS.cidade(d);
        r.acoes = [pergunta(`Sintomas de ${NOME[d]}`), pergunta(`Distritos com mais ${NOME[d]}`)];
        return r;
      }

      // 10. não entendi
      const quase = parecido(t);
      if (quase) return { linhas: [`Você quis dizer **${porId[quase].nome}**?`], acoes: [pergunta(`Sim, ${porId[quase].nome}`, `${cap(doencaDados)} em ${porId[quase].nome}`)] };
      return { linhas: ["Não entendi essa. Tente perguntar de outro jeito, por exemplo “dengue em Itaquera”, “sintomas de chikungunya” ou “o que as cores significam”."], acoes: sugestoesPadrao().slice(0, 4) };
    }

    // ---------- interface ----------
    const esc = (s) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const inline = (s) => esc(s).replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
    function montarHTML(linhas) {
      let html = "", itens = null;
      for (const l of linhas) {
        if (l.startsWith("• ")) { (itens = itens || []).push(`<li>${inline(l.slice(2))}</li>`); continue; }
        if (itens) { html += `<ul>${itens.join("")}</ul>`; itens = null; }
        html += `<p>${inline(l)}</p>`;
      }
      if (itens) html += `<ul>${itens.join("")}</ul>`;
      return html;
    }
    function botoes(acoes, classe) {
      return acoes.map(a => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = classe + (a.mapa ? " chip--acao" : "");
        b.textContent = a.rotulo;
        b.addEventListener("click", () => agir(a));
        return b;
      });
    }
    const rolar = () => { msgs.scrollTop = msgs.scrollHeight; };

    function mostrarBot(r) {
      const el = document.createElement("div");
      el.className = "msg msg--bot";
      el.innerHTML = montarHTML(r.linhas);
      if (r.fonte) {
        const f = document.createElement("p");
        f.className = "msg__fonte";
        f.textContent = `Fonte: ${r.fonte}${r.fonte.endsWith(".") ? "" : "."}`;
        el.appendChild(f);
      }
      if (r.acoes && r.acoes.length) {
        const caixa = document.createElement("div");
        caixa.className = "msg__acoes";
        caixa.append(...botoes(r.acoes, "chip"));
        el.appendChild(caixa);
      }
      msgs.appendChild(el);
      rolar();
    }
    function mostrarEu(texto) {
      const el = document.createElement("div");
      el.className = "msg msg--eu";
      el.textContent = texto;
      msgs.appendChild(el);
      rolar();
    }
    function atualizarSugestoes() {
      sugestoes.replaceChildren(...botoes(sugestoesPadrao(), "chip"));
    }

    let ocupado = false;
    function enviar(texto) {
      texto = texto.trim().slice(0, 300);
      if (!texto || ocupado) return;
      mostrarEu(texto);
      const r = responder(texto);
      if (!r) return;
      if (reduzMovimento) { mostrarBot(r); atualizarSugestoes(); return; }
      ocupado = true;
      const pensando = document.createElement("div");
      pensando.className = "msg msg--bot";
      pensando.setAttribute("aria-label", "Epi está escrevendo");
      pensando.innerHTML = '<span class="digitando"><i></i><i></i><i></i></span>';
      msgs.appendChild(pensando);
      rolar();
      setTimeout(() => { pensando.remove(); mostrarBot(r); atualizarSugestoes(); ocupado = false; }, 450);
    }

    function agir(a) {
      if (a.pergunta) { enviar(a.pergunta); return; }
      if (a.mapa && ctx) {
        if (ctx.doenca() !== a.mapa.doenca) ctx.trocarDoenca(a.mapa.doenca);
        // no celular o assistente cobre a tela: fecha para mostrar o distrito no mapa
        if (mobile()) fechar();
        ctx.selecionar(a.mapa.id);
        atualizarSugestoes();
      }
    }

    function abrir() {
      janela.hidden = false;
      document.body.classList.add("chat-aberto");
      botao.setAttribute("aria-expanded", "true");
      if (!jaAbriu) {
        jaAbriu = true;
        const sel = ctx && ctx.selecionado();
        mostrarBot({
          linhas: [
            "Oi! Eu sou o **Epi**, o assistente do mapa. Respondo sobre os números por distrito e da cidade, e sobre dengue, chikungunya e zika.",
            sel ? `Você está vendo **${porId[sel].nome}** no mapa. Quer saber como está lá?` : "Pergunte do seu jeito ou escolha uma sugestão abaixo.",
          ],
          acoes: sel ? [pergunta(`Como está ${porId[sel].nome}?`)] : [],
        });
      }
      atualizarSugestoes();
      rolar();
      vigiarVoltar(true);
      // No celular, focar o campo abriria o teclado por cima da mensagem de boas-vindas.
      if (mobile()) $("chat-fechar").focus(); else campo.focus();
    }
    function fechar() {
      vigiarVoltar(false);
      janela.hidden = true;
      document.body.classList.remove("chat-aberto");
      botao.setAttribute("aria-expanded", "false");
      botao.focus({ preventScroll: true });
    }
    // No celular o assistente cobre a tela: o "voltar" do Android fecha o Epi em vez de sair do site.
    let vigia = null;
    function vigiarVoltar(ativo) {
      if (!("CloseWatcher" in window) || !matchMedia("(pointer: coarse)").matches) return;
      if (ativo && !vigia) {
        try { vigia = new CloseWatcher(); vigia.onclose = () => { vigia = null; fechar(); }; } catch { vigia = null; }
      } else if (!ativo && vigia) {
        const v = vigia; vigia = null; v.destroy();
      }
    }

    botao.addEventListener("click", abrir);
    $("chat-fechar").addEventListener("click", fechar);
    janela.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); fechar(); } });
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = campo.value; campo.value = ""; enviar(v); });

    // Para testar o reconhecimento sem a interface (console do navegador).
    window.EpiChat.responder = responder;
  }
})();
