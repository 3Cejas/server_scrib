(function () {
    "use strict";

    const STORAGE_KEY = "scrib.s7.draft.v1";
    const MODE_LABELS = {
        s7: "S+7",
        v7: "V+7",
        a7: "A+7",
        sav7: "SAV+7",
        eclipse: "Eclipse",
        caradec: "Caradec"
    };

    const els = {
        source: document.getElementById("source_text"),
        sourceMetric: document.getElementById("source_metric"),
        result: document.getElementById("result_text"),
        resultMetric: document.getElementById("result_metric"),
        log: document.getElementById("replacement_log"),
        modeButtons: Array.from(document.querySelectorAll(".mode-button")),
        step: document.getElementById("step_value"),
        stepDown: document.getElementById("step_down"),
        stepUp: document.getElementById("step_up"),
        caradecGroup: document.getElementById("caradec_group"),
        caradecLength: document.getElementById("caradec_length"),
        instrument: document.getElementById("instrument_select"),
        auxPanel: document.getElementById("aux_panel"),
        auxText: document.getElementById("aux_text"),
        autoPreview: document.getElementById("auto_preview"),
        transform: document.getElementById("transform_button"),
        apply: document.getElementById("apply_button"),
        copy: document.getElementById("copy_button"),
        clear: document.getElementById("clear_button"),
        status: document.getElementById("status_line"),
        draftStatus: document.getElementById("draft_status")
    };

    let currentMode = "s7";
    let renderTimer = 0;
    let lastResult = null;

    function clampNumber(value, min, max, fallback) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    function readOptions() {
        return {
            mode: currentMode,
            step: clampNumber(els.step.value, -40, 40, 7),
            instrument: els.instrument.value,
            auxiliaryText: els.auxText.value,
            caradecLength: clampNumber(els.caradecLength.value, 2, 40, 12)
        };
    }

    function setMode(mode) {
        currentMode = MODE_LABELS[mode] ? mode : "s7";
        els.modeButtons.forEach((button) => {
            button.setAttribute("aria-pressed", button.dataset.mode === currentMode ? "true" : "false");
        });
        els.caradecGroup.classList.toggle("is-hidden", currentMode !== "caradec");
        saveDraft();
        requestRender();
    }

    function setInstrument(value) {
        els.instrument.value = value === "auxiliary" ? "auxiliary" : "default";
        els.auxPanel.classList.toggle("is-visible", els.instrument.value === "auxiliary");
        saveDraft();
        requestRender();
    }

    function updateSourceMetric() {
        const count = window.ScribS7
            ? window.ScribS7.tokenize(els.source.value).filter((token) => /^[A-Za-zÀ-ÖØ-öø-ÿÑñÜü]/.test(token)).length
            : 0;
        els.sourceMetric.textContent = `${count} ${count === 1 ? "palabra" : "palabras"}`;
    }

    function requestRender() {
        updateSourceMetric();
        if (!els.autoPreview.checked) return;
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderTransformation, 120);
    }

    function renderTransformation() {
        if (!window.ScribS7) {
            setStatus("Motor S+7 no disponible.");
            return;
        }

        const options = readOptions();
        els.step.value = String(options.step);
        els.caradecLength.value = String(options.caradecLength);

        lastResult = window.ScribS7.transformText(els.source.value, options);
        els.result.value = lastResult.text;
        renderReplacementLog(lastResult.replacements);

        const replacementCount = lastResult.replacements.length;
        els.resultMetric.textContent = `${replacementCount} ${replacementCount === 1 ? "sustitución" : "sustituciones"}`;
        setStatus(`${MODE_LABELS[currentMode]} con salto ${formatStep(options.step)}.`);
        saveDraft();
    }

    function renderReplacementLog(replacements) {
        if (!replacements.length) {
            els.log.innerHTML = '<p class="log-empty">No hay sustituciones con el modo y el instrumento actuales.</p>';
            return;
        }

        const rows = replacements.map((item) => `
            <tr>
                <td>${escapeHtml(item.label)}</td>
                <td>${escapeHtml(item.original)}</td>
                <td>${escapeHtml(item.replacement)}</td>
                <td>${escapeHtml(item.base)}</td>
                <td>${escapeHtml(item.note || "")}</td>
            </tr>
        `).join("");

        els.log.innerHTML = `
            <table class="replacement-table">
                <thead>
                    <tr>
                        <th>Tipo</th>
                        <th>Original</th>
                        <th>Resultado</th>
                        <th>Base</th>
                        <th>Nota</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatStep(step) {
        return step >= 0 ? `+${step}` : String(step);
    }

    function setStatus(text) {
        els.status.textContent = text || "";
    }

    function saveDraft() {
        const payload = {
            source: els.source.value,
            result: els.result.value,
            mode: currentMode,
            step: els.step.value,
            caradecLength: els.caradecLength.value,
            instrument: els.instrument.value,
            auxiliaryText: els.auxText.value,
            autoPreview: els.autoPreview.checked
        };

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            if (els.draftStatus) {
                els.draftStatus.textContent = `Borrador guardado ${new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.`;
            }
        } catch (_error) {
            if (els.draftStatus) {
                els.draftStatus.textContent = "Borrador local no disponible.";
            }
        }
    }

    function loadDraft() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const payload = JSON.parse(raw);
            if (typeof payload.source === "string") els.source.value = payload.source;
            if (typeof payload.result === "string") els.result.value = payload.result;
            if (typeof payload.step === "string") els.step.value = payload.step;
            if (typeof payload.caradecLength === "string") els.caradecLength.value = payload.caradecLength;
            if (typeof payload.auxiliaryText === "string") els.auxText.value = payload.auxiliaryText;
            els.autoPreview.checked = payload.autoPreview !== false;
            setInstrument(payload.instrument);
            setMode(payload.mode);
        } catch (_error) {
            setStatus("No se pudo leer el borrador local.");
        }
    }

    function clearDraft() {
        els.source.value = "";
        els.result.value = "";
        lastResult = null;
        renderReplacementLog([]);
        updateSourceMetric();
        els.resultMetric.textContent = "0 sustituciones";
        setStatus("Texto limpio.");
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (_error) {
            // No pasa nada si el navegador no permite almacenamiento local.
        }
    }

    async function copyResult() {
        const text = els.result.value;
        if (!text) {
            setStatus("No hay resultado que copiar.");
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            setStatus("Resultado copiado.");
        } catch (_error) {
            els.result.focus();
            els.result.select();
            setStatus("Selecciona el resultado para copiarlo.");
        }
    }

    function applyResult() {
        if (!els.result.value) {
            setStatus("No hay resultado que aplicar.");
            return;
        }
        els.source.value = els.result.value;
        renderTransformation();
        els.source.focus();
    }

    function nudgeStep(delta) {
        els.step.value = String(clampNumber(Number(els.step.value) + delta, -40, 40, 7));
        saveDraft();
        requestRender();
    }

    els.modeButtons.forEach((button) => {
        button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    els.source.addEventListener("input", () => {
        saveDraft();
        requestRender();
    });
    els.step.addEventListener("input", () => {
        saveDraft();
        requestRender();
    });
    els.caradecLength.addEventListener("input", () => {
        saveDraft();
        requestRender();
    });
    els.auxText.addEventListener("input", () => {
        saveDraft();
        requestRender();
    });
    els.instrument.addEventListener("change", () => setInstrument(els.instrument.value));
    els.autoPreview.addEventListener("change", () => {
        saveDraft();
        if (els.autoPreview.checked) renderTransformation();
    });
    els.stepDown.addEventListener("click", () => nudgeStep(-1));
    els.stepUp.addEventListener("click", () => nudgeStep(1));
    els.transform.addEventListener("click", renderTransformation);
    els.apply.addEventListener("click", applyResult);
    els.copy.addEventListener("click", copyResult);
    els.clear.addEventListener("click", clearDraft);

    loadDraft();
    updateSourceMetric();
    if (!lastResult && els.autoPreview.checked) {
        renderTransformation();
    } else if (!els.result.value) {
        renderReplacementLog([]);
    }
})();
