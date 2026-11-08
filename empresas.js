// Página para empresas (organizacoes.html): mosaico dos 96 distritos na abertura e as amostras das "duas telas".
// Usa os mesmos arquivos do Epimapa SP e o nivel.js; unidades são de exemplo, números são do boletim.
(async function () {
  "use strict";
  const svg = document.getElementById("mosaico");
  if (!svg) return;
  const pegar = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
  let geo, dd;
  try {
    [geo, dd] = await Promise.all([pegar("data/distritos.geojson"), pegar("data/casos_distrito.json")]);
  } catch (e) {
    svg.closest("figure").hidden = true;
    document.getElementById("amostra-rh").innerHTML = '<tr><td colspan="4" class="sem-dados">Não foi possível carregar o boletim agora.</td></tr>';
    return;
  }
  const N = window.PathogenNivel, den = dd.doencas.dengue || {}, aj = N.ajustar(den);
  const fmt = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const incDe = (id) => (den[id] && typeof den[id].inc100k_ano === "number" ? den[id].inc100k_ano : null);
  const incCor = (id) => (aj[id] ? aj[id].inc : incDe(id));
  const faixa = (id) => { const i = incCor(id); return i == null ? null : N.nivel(i, den[id].casos_ano); };
  const badge = (n) => (n ? `<span class="badge" data-nivel="${n}">${n} · ${N.NOMES[n]}</span>` : '<span class="sem-dados">sem dados</span>');

  // Projeção equirretangular local, suficiente para uma cidade.
  const kx = Math.cos((-23.68 * Math.PI) / 180);
  const aneis = (g) => (g.type === "Polygon" ? g.coordinates : g.coordinates.flat());
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of geo.features) for (const r of aneis(f.geometry)) for (const [lon, lat] of r) {
    const x = lon * kx, y = -lat;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const W = 600, s = W / (x1 - x0), H = (y1 - y0) * s;
  svg.setAttribute("viewBox", `-8 -8 ${W + 16} ${(H + 16).toFixed(0)}`);
  const ns = "http://www.w3.org/2000/svg";
  const centros = {}, nomes = {};
  const g = document.createElementNS(ns, "g");
  const cx = W / 2, cy = H * 0.42;
  for (const f of geo.features) {
    const id = f.properties.id;
    nomes[id] = f.properties.nome;
    let d = "", sx = 0, sy = 0, n = 0;
    aneis(f.geometry).forEach((r, k) => {
      d += "M" + r.map(([lon, lat]) => {
        const x = (lon * kx - x0) * s, y = (-lat - y0) * s;
        if (k === 0) { sx += x; sy += y; n++; }
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join("L") + "Z";
    });
    centros[id] = [sx / n, sy / n];
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    const inc = incCor(id);
    p.style.setProperty("--cor", inc == null ? "var(--sem-dado)" : N.cor(inc));
    // Revelação em varredura, como um radar: o atraso segue o ângulo em torno do centro da cidade.
    const ang = (Math.atan2(centros[id][1] - cy, centros[id][0] - cx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    p.style.setProperty("--atraso", `${Math.round((ang / (2 * Math.PI)) * 1400)}ms`);
    g.appendChild(p);
  }
  svg.appendChild(g);

  const EXEMPLOS = [["A", "Escritório", "se"], ["B", "Escola", "itaquera"], ["C", "Loja", "pinheiros"], ["D", "Condomínio", "cidade-tiradentes"]];
  for (const [letra, , id] of EXEMPLOS) {
    if (!centros[id]) continue;
    const pino = document.createElementNS(ns, "g");
    pino.setAttribute("class", "pino");
    pino.setAttribute("transform", `translate(${centros[id][0].toFixed(1)} ${centros[id][1].toFixed(1)})`);
    pino.innerHTML = `<circle r="13"/><text y="4.5" text-anchor="middle">${letra}</text>`;
    svg.appendChild(pino);
  }
  document.getElementById("mosaico-se").textContent = `SE ${dd.se}/${dd.ano}`;
  requestAnimationFrame(() => svg.classList.add("revelado"));

  document.getElementById("amostra-rh").innerHTML = EXEMPLOS.map(([letra, tipo, id]) => {
    const inc = incDe(id);
    return `<tr><td><span class="pino-txt">${letra}</span>${tipo}</td><td>${nomes[id] || "—"}</td>` +
      `<td class="num">${inc == null ? "—" : fmt(inc)}</td><td>${badge(faixa(id))}</td></tr>`;
  }).join("");

  const cel = "itaquera", incCel = incDe(cel);
  document.getElementById("cel-nome").textContent = nomes[cel] || "Itaquera";
  document.getElementById("cel-v").textContent = incCel == null ? "—" : fmt(incCel);
  document.getElementById("cel-faixa").innerHTML = badge(faixa(cel));
})();
