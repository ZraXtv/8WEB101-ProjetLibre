// Chargé dans <head>, avant le premier rendu : sans cela, une personne ayant
// choisi le thème clair verrait un éclair sombre à chaque changement de page.
(function () {
  try {
    var theme = localStorage.getItem("theme");
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (erreur) {
    /* navigation privée : on garde le thème par défaut */
  }
})();
