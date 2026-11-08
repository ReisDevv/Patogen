// Faixas de incidência da Pathogen e ajuste para distrito pequeno (docs/design-system.pdf, "Escala de alerta").
// Usado por index.html e mapa.html: mude só aqui.
(function () {
  "use strict";
  // Convenção da Pathogen, por 100 mil hab. Não é o nível do InfoDengue (que é municipal, por clima e transmissão).
  const NOMES = { 1: "Baixo risco", 2: "Atenção", 3: "Transmissão sustentada", 4: "Epidemia" };
  const POP_MIN = 50000;   // abaixo disso, poucos casos movem muito a taxa
  const CASOS_MIN = 5;

  // Nível pela incidência; nível 3 exige 5 casos e o 4 exige 10. O boletim só traz o acumulado do ano por distrito,
  // então o mínimo vale sobre o ano (o Design System pede por semana, dado que a COVISA não publica por distrito).
  function nivel(inc, casos) {
    if (typeof inc !== "number") return null;
    let n = inc < 20 ? 1 : inc < 60 ? 2 : inc < 300 ? 3 : 4;
    if (n === 4 && casos < 10) n = 3;
    if (n === 3 && casos < CASOS_MIN) n = 2;
    return n;
  }

  // Bayes empírico (estimador global de Marshall): puxa a taxa de cada distrito para a média da cidade, com mais força
  // quanto menor a população. A população sai do próprio boletim: casos ÷ incidência × 100 mil.
  // Devolve { id: { pop, inc } } só para distritos com casos e incidência publicados.
  function ajustar(porDistrito) {
    const base = Object.entries(porDistrito || {})
      .filter(([, d]) => typeof d.inc100k_ano === "number" && d.inc100k_ano > 0 && d.casos_ano > 0)
      .map(([id, d]) => ({ id, c: d.casos_ano, pop: d.casos_ano / d.inc100k_ano * 1e5 }));
    const saida = {};
    if (base.length < 2) return saida;
    const C = base.reduce((s, b) => s + b.c, 0), P = base.reduce((s, b) => s + b.pop, 0);
    const m = C / P;
    const s2 = Math.max(0, base.reduce((s, b) => s + b.pop * (b.c / b.pop - m) ** 2, 0) / P - m / (P / base.length));
    for (const b of base) {
      const peso = s2 / (s2 + m / b.pop);
      saida[b.id] = { pop: b.pop, inc: (m + peso * (b.c / b.pop - m)) * 1e5 };
    }
    return saida;
  }

  // "Dado instável": menos de 5 casos no ano, ou menos de 50 mil habitantes.
  function instavel(d, aj) {
    if (!d || d.casos_ano == null) return false;
    return d.casos_ano < CASOS_MIN || (!!aj && aj.pop < POP_MIN);
  }

  // Selo da faixa + aviso de dado instável, igual no mapa e na página inicial. Só números e textos fixos entram no HTML.
  function renderFaixa(el, d) {
    if (!el) return;
    if (!d || d.casos_ano == null) { el.hidden = true; return; }
    const fmt = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    const inc = d.aj ? d.aj.inc : d.inc100k_ano;
    const n = nivel(inc, d.casos_ano), inst = instavel(d, d.aj);
    if (!n && !inst) { el.hidden = true; return; }
    const ajustou = d.aj && Math.abs(d.aj.inc - d.inc100k_ano) >= 0.5;
    el.innerHTML =
      (n ? `<span class="badge" data-nivel="${n}">Nível ${n} · ${NOMES[n]}</span>` : "") +
      (inst ? `<span class="instavel">dado instável</span>` : "") +
      `<span class="faixa-dist__nota">` +
      (n ? `Faixa da Pathogen pela incidência${ajustou ? `, ajustada ao tamanho do distrito: ${fmt(d.aj.inc)} por 100 mil` : ""}.` : "") +
      (inst ? ` Poucos casos ou menos de 50 mil habitantes: um ou dois casos a mais mudam muito a taxa.` : "") +
      `</span>`;
    el.hidden = false;
  }

  // Escala contínua de cor do mapa (mapa.html: LIMIARES e NIVEL_COR). Usada pela página de empresas; se mudar lá, mude aqui.
  const LIMIARES = [0, 20, 60, 150, 300];
  const CORES = ["#3d9a6a", "#3d9a6a", "#e8c04a", "#e8802f", "#c8322b"];
  function misturar(a, b, t) {
    const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
    return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
  }
  function cor(inc) {
    for (let i = 1; i < LIMIARES.length; i++) {
      if (inc < LIMIARES[i]) return misturar(CORES[i - 1], CORES[i], Math.max(0, Math.min(1, (inc - LIMIARES[i - 1]) / (LIMIARES[i] - LIMIARES[i - 1]))));
    }
    return CORES[4];
  }

  window.PathogenNivel = { NOMES, POP_MIN, CASOS_MIN, nivel, ajustar, instavel, renderFaixa, cor };
})();
