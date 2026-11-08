// Tema claro/escuro (Design System: "Relatórios" claro e "Dashboard" escuro). Carregado no <head>, antes do CSS
// pintar, para não piscar. Segue o sistema; só grava "pathogen:tema" no navegador quando a pessoa usa o botão.
(function () {
  "use strict";
  const CHAVE = "pathogen:tema";
  const raiz = document.documentElement;
  const sistema = () => (matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro");
  let salvo = null;
  try { salvo = localStorage.getItem(CHAVE); } catch (e) { /* navegação privada: segue o sistema */ }
  raiz.dataset.tema = salvo === "escuro" || salvo === "claro" ? salvo : sistema();

  function aplicar(tema, avisar = true) {
    raiz.dataset.tema = tema;
    document.querySelectorAll("[data-tema-btn]").forEach((b) => {
      const escuro = tema === "escuro";
      b.setAttribute("aria-pressed", String(escuro));
      b.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
      b.title = b.getAttribute("aria-label");
    });
    if (avisar) dispatchEvent(new CustomEvent("pathogen:tema", { detail: tema }));
  }

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    let fixo = null;
    try { fixo = localStorage.getItem(CHAVE); } catch (e) {}
    if (!fixo) aplicar(sistema());
  });

  document.addEventListener("DOMContentLoaded", () => {
    aplicar(raiz.dataset.tema, false);
    document.querySelectorAll("[data-tema-btn]").forEach((b) => b.addEventListener("click", () => {
      const novo = raiz.dataset.tema === "escuro" ? "claro" : "escuro";
      try { localStorage.setItem(CHAVE, novo); } catch (e) {}
      aplicar(novo);
    }));
  });

  window.PathogenTema = { atual: () => raiz.dataset.tema };
})();
