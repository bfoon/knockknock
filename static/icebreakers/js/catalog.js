// Filter chip behaviour for the icebreakers catalog.
// All-cards-visible by default; clicking a chip narrows the grid.
(function () {
  const chips = document.querySelectorAll(".kk-ice-chip");
  const cards = document.querySelectorAll(".kk-ice-card");

  function applyFilter(filter) {
    cards.forEach((card) => {
      let show = true;
      if (filter === "seated")   show = card.dataset.intensity === "seated";
      if (filter === "standing") show = card.dataset.intensity === "standing";
      if (filter === "phones")   show = card.dataset.phones === "yes";
      if (filter === "screen")   show = card.dataset.phones === "no";
      card.classList.toggle("is-hidden", !show);
    });
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => {
        c.classList.remove("is-active");
        c.setAttribute("aria-selected", "false");
      });
      chip.classList.add("is-active");
      chip.setAttribute("aria-selected", "true");
      applyFilter(chip.dataset.filter);
    });
  });
})();
