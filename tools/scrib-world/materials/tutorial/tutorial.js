(function () {
  "use strict";

  const slides = Array.from(document.querySelectorAll(".slide"));
  const previous = document.getElementById("prev");
  const next = document.getElementById("next");
  const chapter = document.getElementById("chapter");
  const progress = document.getElementById("progress");
  const fullscreenToggle = document.getElementById("fullscreenToggle");
  const fullscreenLabel = document.getElementById("fullscreenLabel");
  let index = 0;
  let touchStartX = null;

  function resetSlideAnimations(slide) {
    const animated = [slide, ...slide.querySelectorAll("*")];
    animated.forEach((element) => {
      element.style.animation = "none";
    });
    void slide.offsetWidth;
    animated.forEach((element) => element.style.removeProperty("animation"));
  }

  function show(target, direction) {
    const nextIndex = Math.max(0, Math.min(slides.length - 1, target));
    if (nextIndex === index) return;
    const outgoing = slides[index];
    outgoing.classList.remove("is-active");
    outgoing.classList.add(direction > 0 ? "is-exiting-left" : "is-exiting-right");
    window.setTimeout(() => outgoing.classList.remove("is-exiting-left", "is-exiting-right"), 650);
    index = nextIndex;
    slides[index].classList.add("is-active");
    resetSlideAnimations(slides[index]);
    update();
  }

  function update() {
    const slide = slides[index];
    chapter.textContent = slide.dataset.chapter || "";
    progress.style.width = `${((index + 1) / slides.length) * 100}%`;
    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    document.title = `${slide.getAttribute("aria-label")} · <SCRI> B`;
  }

  previous.addEventListener("click", () => show(index - 1, -1));
  next.addEventListener("click", () => show(index + 1, 1));
  fullscreenToggle.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.warn("No se pudo cambiar el modo de pantalla completa.", error);
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const isFullscreen = Boolean(document.fullscreenElement);
    fullscreenToggle.classList.toggle("is-fullscreen", isFullscreen);
    fullscreenLabel.textContent = isFullscreen ? "SALIR" : "PANTALLA COMPLETA";
    fullscreenToggle.setAttribute("aria-label", isFullscreen ? "Salir de pantalla completa" : "Entrar en pantalla completa");
    fullscreenToggle.title = isFullscreen ? "Salir de pantalla completa" : "Entrar en pantalla completa";
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.closest("button, input, textarea, select")) return;
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      show(index + 1, 1);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      show(index - 1, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      show(0, -1);
    } else if (event.key === "End") {
      event.preventDefault();
      show(slides.length - 1, 1);
    }
  });
  document.addEventListener("touchstart", (event) => {
    touchStartX = event.changedTouches[0].clientX;
  }, { passive: true });
  document.addEventListener("touchend", (event) => {
    if (touchStartX === null) return;
    const distance = event.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(distance) < 60) return;
    show(index + (distance < 0 ? 1 : -1), distance < 0 ? 1 : -1);
  }, { passive: true });

  update();
}());
