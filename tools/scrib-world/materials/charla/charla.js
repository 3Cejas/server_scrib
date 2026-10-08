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
    if (advanceEvolution(target)) {
      update();
      return;
    }
    const nextIndex = Math.max(0, Math.min(slides.length - 1, target));
    if (nextIndex === index) return;
    const outgoing = slides[index];
    outgoing.querySelectorAll("video").forEach((video) => video.pause());
    outgoing.querySelectorAll(".origin-video__frame").forEach((frame) => frame.classList.remove("has-frame"));
    outgoing.classList.remove("is-active");
    outgoing.classList.add(direction > 0 ? "is-exiting-left" : "is-exiting-right");
    window.setTimeout(() => outgoing.classList.remove("is-exiting-left", "is-exiting-right"), 650);
    index = nextIndex;
    prepareEvolution(slides[index], direction);
    slides[index].classList.add("is-active");
    resetSlideAnimations(slides[index]);
    update();
  }

  function update() {
    const slide = slides[index];
    slide.querySelectorAll("video[data-auto]").forEach(startSlideVideo);
    chapter.textContent = slide.dataset.chapter || "";
    progress.style.width = `${evolutionProgress()}%`;
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
    if (event.target.closest("button, input, textarea, select, video, a, dialog")) return;
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
    touchStartX = event.target.closest("video, button, a, dialog") ? null : event.changedTouches[0].clientX;
  }, { passive: true });
  document.addEventListener("touchend", (event) => {
    if (touchStartX === null) return;
    const distance = event.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(distance) < 60) return;
    show(index + (distance < 0 ? 1 : -1), distance < 0 ? 1 : -1);
  }, { passive: true });

  function startSlideVideo(video) {
    if (!video.closest(".slide.is-active")) return;
    if (video.ended) video.currentTime = 0;
    video.play().catch((error) => {
      if (error.name === "NotAllowedError" && video.closest(".slide.is-active")) {
        video.muted = true;
        video.play().catch(() => {});
      }
    });
  }
  document.querySelectorAll(".origin-video__player").forEach((video) => {
    const frame = video.closest(".origin-video__frame");
    const markFrameReady = () => {
      if (video.closest(".slide.is-active")) frame.classList.add("has-frame");
    };
    video.addEventListener("playing", () => {
      if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(markFrameReady);
      else markFrameReady();
    });
    video.addEventListener("error", () => frame.classList.remove("has-frame"));
    const toggleVideo = () => {
      video.muted = false;
      if (video.paused || video.ended) startSlideVideo(video);
      else video.pause();
    };
    video.addEventListener("click", toggleVideo);
    video.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        toggleVideo();
      }
    });
  });

  const evolutionNow = document.querySelector(".evolution-now");
  const evolutionIndex = slides.indexOf(evolutionNow);
  const evolutionPhases = [{"key": "preshow", "label": "Preshow", "time": "0–10 min"}, {"key": "entrada", "label": "Entrada", "time": "10–25 min"}, {"key": "escritura", "label": "Escritura", "time": "25–55 min"}, {"key": "interludio", "label": "Interludio", "time": "55–65 min"}, {"key": "interpretacion", "label": "Interpretación", "time": "65–90 min"}, {"key": "cierre", "label": "Cierre", "time": "90–100 min"}];
  let evolutionStep = 0;

  function setEvolutionStep(step) {
    evolutionStep = Math.max(0, Math.min(evolutionPhases.length, step));
    const phase = evolutionPhases[evolutionStep - 1];
    const key = phase ? phase.key : "";
    evolutionNow.dataset.evolutionStep = key;
    evolutionNow.setAttribute("aria-label", phase ? `Ahora: ${phase.label}` : "Ahora");
    evolutionNow.querySelectorAll("[data-phase]").forEach((cell) => {
      cell.classList.toggle("is-phase-focused", Boolean(key) && cell.dataset.phase === key);
      cell.classList.toggle("is-phase-muted", Boolean(key) && cell.dataset.phase !== key);
      if (cell.matches("thead th") && cell.dataset.phase === key) cell.setAttribute("aria-current", "step");
      else cell.removeAttribute("aria-current");
    });
    evolutionNow.querySelector(".evolution-step-status").textContent = phase ? `${phase.label}, ${phase.time}` : "Sin etapa seleccionada";
  }

  function advanceEvolution(target) {
    if (slides[index] !== evolutionNow || Math.abs(target - index) !== 1) return false;
    const step = evolutionStep + (target > index ? 1 : -1);
    if (step < 0 || step > evolutionPhases.length) return false;
    setEvolutionStep(step);
    return true;
  }

  function prepareEvolution(slide, direction) {
    if (slide === evolutionNow) setEvolutionStep(direction > 0 ? 0 : evolutionPhases.length);
  }

  function evolutionProgress() {
    const extra = index > evolutionIndex ? evolutionPhases.length : index === evolutionIndex ? evolutionStep : 0;
    return ((index + 1 + extra) / (slides.length + evolutionPhases.length)) * 100;
  }

  const evolutionSource = document.getElementById("evolution-source-dialog");
  document.querySelectorAll("[data-open-evolution-source]").forEach((button) => {
    button.addEventListener("click", () => {
      const era = button.dataset.openEvolutionSource;
      evolutionSource.querySelectorAll("[data-source-era]").forEach((figure) => { figure.hidden = figure.dataset.sourceEra !== era; });
      document.getElementById("evolution-source-title").textContent = `Diagrama original · ${era === "before" ? "Antes" : "Ahora"}`;
      document.querySelector(".evolution-source__images").style.setProperty("--source-zoom", "100%");
      document.getElementById("evolution-source-zoom").value = "100";
      document.getElementById("evolution-zoom-value").value = "100 %";
      evolutionSource.showModal();
    });
  });
  document.querySelector("[data-close-evolution-source]").addEventListener("click", () => evolutionSource.close());
  document.getElementById("evolution-source-zoom").addEventListener("input", (event) => {
    document.querySelector(".evolution-source__images").style.setProperty("--source-zoom", event.target.value + "%");
    document.getElementById("evolution-zoom-value").value = event.target.value + " %";
  });

  function fitSlides() {
    const area = document.querySelector(".slides");
    if (!area.clientWidth || !area.clientHeight) return;
    slides.forEach((slide) => {
      let height = 758;
      slide.style.setProperty("--canvas-height", `${height}px`);
      // offset measurements ignore the entrance animations and the scale.
      const children = Array.from(slide.children).filter((child) => !child.hidden);
      for (let attempt = 0; attempt < 3; attempt++) {
        const top = Math.min(...children.map((child) => child.offsetTop));
        const bottom = Math.max(...children.map((child) => child.offsetTop + child.offsetHeight));
        const overflow = Math.max(0, 24 - top, bottom - height + 24);
        if (overflow < 1) break;
        height += Math.ceil(overflow * 2);
        slide.style.setProperty("--canvas-height", `${height}px`);
      }
      const scale = Math.min(area.clientWidth / 1440, area.clientHeight / height);
      slide.style.setProperty("--canvas-scale", scale);
    });
  }
  new ResizeObserver(fitSlides).observe(document.querySelector(".slides"));
  document.fonts.ready.then(fitSlides);
  window.addEventListener("load", fitSlides, { once: true });
  fitSlides();

  update();
}());
