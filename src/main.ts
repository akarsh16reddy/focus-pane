import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

type FocusState = {
  active: boolean;
  opacity: number;
  bandHeight: number;
  bandPosition: number;
  monitorCount: number;
  platform: string;
  displayServer: string | null;
};

const DEFAULT_OPACITY = 45;
const isOverlay = new URLSearchParams(window.location.search).has("overlay");

function applyOverlayOpacity(opacity: number) {
  document.documentElement.style.setProperty("--overlay-opacity", String(opacity / 100));
}

function applyFocusBand(state: Pick<FocusState, "bandHeight" | "bandPosition">) {
  const center = window.innerHeight * (state.bandPosition / 100);
  const halfHeight = state.bandHeight / 2;
  const top = Math.max(0, center - halfHeight);
  const bottom = Math.min(window.innerHeight, center + halfHeight);
  document.documentElement.style.setProperty("--band-top", `${top}px`);
  document.documentElement.style.setProperty("--band-bottom", `${bottom}px`);
}

async function renderOverlay() {
  document.body.className = "overlay-page";
  document.body.innerHTML = `
    <div class="screen-dimmer" aria-hidden="true">
      <div class="dim-region dim-region-top"></div>
      <div class="dim-region dim-region-bottom"></div>
    </div>
  `;

  const state = await invoke<FocusState>("get_focus_state");
  applyOverlayOpacity(state.opacity);
  applyFocusBand(state);
  window.addEventListener("resize", async () =>
    applyFocusBand(await invoke<FocusState>("get_focus_state")),
  );

  // Tauri events provide immediate updates. This small reconciliation loop
  // makes the overlay self-healing if a platform webview misses an event.
  window.setInterval(async () => {
    try {
      const current = await invoke<FocusState>("get_focus_state");
      applyOverlayOpacity(current.opacity);
      applyFocusBand(current);
    } catch {
      // The app is likely shutting down; keep the click-through overlay inert.
    }
  }, 100);

  void listen<number>("focus://opacity", ({ payload }) => applyOverlayOpacity(payload));
  void listen<FocusState>("focus://band", ({ payload }) => applyFocusBand(payload));
}

function platformDescription(state: FocusState) {
  if (state.platform !== "linux") return `${state.platform} · native click-through`;
  const server = state.displayServer ?? "unknown display server";
  return `Linux · ${server} · GTK click-through`;
}

function updatePlatformNote(element: HTMLElement, state: FocusState) {
  element.textContent = `${state.monitorCount} ${state.monitorCount === 1 ? "display" : "displays"} · ${platformDescription(state)}`;
}

async function renderController() {
  document.body.className = "controller-page";
  document.body.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <div class="brand-mark" aria-hidden="true"><span></span></div>
        <div>
          <p class="eyebrow">Screen focus utility</p>
          <h1>Focus Pane</h1>
        </div>
      </header>

      <section class="status-panel" aria-labelledby="focus-heading">
        <div class="status-copy">
          <div class="status-line">
            <span class="status-dot" aria-hidden="true"></span>
            <span id="status-label">Focus dimming is off</span>
          </div>
          <h2 id="focus-heading">Keep your eyes on one reading band.</h2>
          <p>Leave one clear area visible while dimming the content above and below it.</p>
        </div>
        <button id="toggle" class="primary-action" type="button" aria-pressed="false">
          <span class="button-icon" aria-hidden="true">◐</span>
          <span id="toggle-label">Start focusing</span>
        </button>
      </section>

      <section class="settings-panel band-settings" aria-labelledby="band-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Focus window</p>
            <h2 id="band-heading">Reading band</h2>
          </div>
          <output id="band-height-value" for="band-height">180 px</output>
        </div>
        <label class="control-label" for="band-height">Band height</label>
        <input id="band-height" type="range" min="80" max="480" step="20" value="180" />
        <label class="control-label position-label" for="band-position">Vertical position</label>
        <input id="band-position" type="range" min="10" max="90" step="5" value="50" />
        <div class="shortcut-hint">Move anytime with <kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>↑</kbd> or <kbd>↓</kbd></div>
      </section>

      <section class="settings-panel" aria-labelledby="settings-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Appearance</p>
            <h2 id="settings-heading">Dim strength</h2>
          </div>
          <output id="opacity-value" for="opacity">${DEFAULT_OPACITY}%</output>
        </div>
        <input id="opacity" type="range" min="10" max="80" step="1" value="${DEFAULT_OPACITY}" aria-label="Dim strength" />
        <div class="range-labels" aria-hidden="true"><span>Gentle</span><span>Deep</span></div>
      </section>

      <footer class="app-footer">
        <div>
          <span class="meta-label">Global shortcut</span>
          <kbd>Ctrl</kbd><span class="key-plus">+</span><kbd>Shift</kbd><span class="key-plus">+</span><kbd>D</kbd>
        </div>
        <p id="platform-note">Detecting display support…</p>
      </footer>
      <p id="settings-error" class="settings-error" role="alert" hidden></p>
    </main>
  `;

  const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
  const toggleLabel = document.querySelector<HTMLElement>("#toggle-label")!;
  const statusLabel = document.querySelector<HTMLElement>("#status-label")!;
  const statusDot = document.querySelector<HTMLElement>(".status-dot")!;
  const opacity = document.querySelector<HTMLInputElement>("#opacity")!;
  const opacityValue = document.querySelector<HTMLOutputElement>("#opacity-value")!;
  const platformNote = document.querySelector<HTMLElement>("#platform-note")!;
  const bandHeight = document.querySelector<HTMLInputElement>("#band-height")!;
  const bandPosition = document.querySelector<HTMLInputElement>("#band-position")!;
  const bandHeightValue = document.querySelector<HTMLOutputElement>("#band-height-value")!;
  const settingsError = document.querySelector<HTMLElement>("#settings-error")!;

  const reportSettingsError = (error: unknown) => {
    settingsError.textContent = `Could not update the overlay: ${String(error)}`;
    settingsError.hidden = false;
  };

  const clearSettingsError = () => {
    settingsError.hidden = true;
    settingsError.textContent = "";
  };

  const updateActiveState = (active: boolean) => {
    toggle.ariaPressed = String(active);
    toggleLabel.textContent = active ? "Stop focusing" : "Start focusing";
    statusLabel.textContent = `Focus dimming is ${active ? "on" : "off"}`;
    statusDot.classList.toggle("is-active", active);
    document.body.classList.toggle("focus-active", active);
  };

  const savedOpacity = Number(localStorage.getItem("focus-pane-opacity"));
  if (savedOpacity >= 10 && savedOpacity <= 80) opacity.value = String(savedOpacity);
  const savedBandHeight = Number(localStorage.getItem("focus-pane-band-height"));
  const savedBandPosition = Number(localStorage.getItem("focus-pane-band-position"));
  if (savedBandHeight >= 80 && savedBandHeight <= 480) bandHeight.value = String(savedBandHeight);
  if (savedBandPosition >= 10 && savedBandPosition <= 90) bandPosition.value = String(savedBandPosition);

  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      const state = await invoke<FocusState>("toggle_focus");
      updateActiveState(state.active);
    } finally {
      toggle.disabled = false;
    }
  });

  let updateTimer: number | undefined;
  const scheduleOverlayUpdate = () => {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(async () => {
      try {
        await Promise.all([
          invoke("set_opacity", { opacity: Number(opacity.value) }),
          invoke("set_band", {
            bandHeight: Number(bandHeight.value),
            bandPosition: Number(bandPosition.value),
          }),
        ]);
        clearSettingsError();
      } catch (error) {
        reportSettingsError(error);
      }
    }, 16);
  };

  opacity.addEventListener("input", () => {
    opacityValue.value = `${opacity.value}%`;
    scheduleOverlayUpdate();
  });

  opacity.addEventListener("change", () => {
    localStorage.setItem("focus-pane-opacity", opacity.value);
  });

  bandHeight.addEventListener("input", () => {
    bandHeightValue.value = `${bandHeight.value} px`;
    scheduleOverlayUpdate();
  });

  bandPosition.addEventListener("input", scheduleOverlayUpdate);

  const saveBand = () => {
    localStorage.setItem("focus-pane-band-height", bandHeight.value);
    localStorage.setItem("focus-pane-band-position", bandPosition.value);
  };

  bandHeight.addEventListener("change", saveBand);
  bandPosition.addEventListener("change", saveBand);

  try {
    const initialState = await invoke<FocusState>("set_opacity", {
      opacity: Number(opacity.value),
    });
    const initialBand = await invoke<FocusState>("set_band", {
      bandHeight: Number(bandHeight.value),
      bandPosition: Number(bandPosition.value),
    });
    updateActiveState(initialState.active);
    opacityValue.value = `${initialState.opacity}%`;
    bandHeightValue.value = `${initialBand.bandHeight} px`;
    updatePlatformNote(platformNote, initialState);
    if (initialState.monitorCount === 0) {
      window.setTimeout(async () => {
        try {
          updatePlatformNote(platformNote, await invoke<FocusState>("get_focus_state"));
        } catch (error) {
          reportSettingsError(error);
        }
      }, 250);
    }
    clearSettingsError();
  } catch (error) {
    reportSettingsError(error);
  }

  void listen<FocusState>("focus://band", ({ payload }) => {
    bandPosition.value = String(payload.bandPosition);
  });

  void listen<FocusState>("focus://state", ({ payload }) => updateActiveState(payload.active));
}

window.addEventListener("DOMContentLoaded", () => {
  void (isOverlay ? renderOverlay() : renderController());
});
