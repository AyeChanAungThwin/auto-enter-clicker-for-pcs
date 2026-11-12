/* ==========================================================================
   Enter Key Clicker — script.js
   Drift-free interval scheduling, simulated Enter presses (KeyboardEvent,
   keyCode 13), Web Audio click, localStorage settings, and a live
   cross-platform (macOS / Windows / Linux) script generator.
   ========================================================================== */

"use strict";

/* --------------------------------------------------------------------------
 * Small DOM helpers
 * ------------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* --------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------ */
const INTERVAL_MIN = 5;
const INTERVAL_MAX = 9999;
const COUNT_MIN = 1;
const COUNT_MAX = 9999;
const XY_MAX = 99999;
const MAX_LOG_ENTRIES = 300;
const STORAGE_KEY = "enterSim.settings";
const BRIDGE_URL = "http://127.0.0.1:8791"; // managed by bridge.py in this folder

const DEFAULT_SETTINGS = {
  interval: 5,          // seconds between presses
  repeatMode: "infinite", // "infinite" | "custom"
  repeatCount: 10,      // presses per run when repeatMode === "custom"
  clickBeforeEnter: false, // left-click at (clickX, clickY) before each press
  clickX: 0,            // click target, screen X
  clickY: 0,            // click target, screen Y
  sound: true,          // Web Audio click feedback
  theme: "dark",        // "dark" | "light"
  platform: "mac",      // "mac" | "windows" | "linux"
};

/* --------------------------------------------------------------------------
 * Element references
 * ------------------------------------------------------------------------ */
const el = {
  themeToggle: $("#themeToggle"),
  intervalInput: $("#intervalInput"),
  intervalError: $("#intervalError"),
  chips: $$(".chip[data-adjust]"),
  countdownRing: $("#countdownRing"),
  countdown: $("#countdown"),
  countdownLabel: $("#countdownLabel"),
  progressFill: $("#progressFill"),
  startStopBtn: $("#startStopBtn"),
  startStopLabel: $("#startStopLabel"),
  resetBtn: $("#resetBtn"),
  repeatRadios: $$('input[name="repeatMode"]'),
  repeatCountInput: $("#repeatCountInput"),
  countError: $("#countError"),
  clickToggle: $("#clickToggle"),
  clickXInput: $("#clickXInput"),
  clickYInput: $("#clickYInput"),
  clickXYError: $("#clickXYError"),
  pickBtn: $("#pickBtn"),
  aimOverlay: $("#aimOverlay"),
  aimLabel: $("#aimLabel"),
  keycap: $("#keycap"),
  targetForm: $("#targetForm"),
  targetInput: $("#targetInput"),
  soundToggle: $("#soundToggle"),
  bridgeBadge: $("#bridgeBadge"),
  totalPresses: $("#totalPresses"),
  cyclePresses: $("#cyclePresses"),
  statusText: $("#statusText"),
  log: $("#log"),
  logEmpty: $("#logEmpty"),
  clearLogBtn: $("#clearLogBtn"),
  platformTabs: $$(".platform-tab"),
  platformNote: $("#platformNote"),
  scriptCode: $("#scriptCode"),
  copyScriptBtn: $("#copyScriptBtn"),
  copyOsaBtn: $("#copyOsaBtn"),
  primaryOptLabel: $("#primaryOptLabel"),
  optSecondary: $("#optSecondary"),
  scriptCode2: $("#scriptCode2"),
  copyScript2Btn: $("#copyScript2Btn"),
  toast: $("#toast"),
};

/* --------------------------------------------------------------------------
 * Settings — persisted in localStorage
 * ------------------------------------------------------------------------ */
const settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    // Merge over defaults so older saves never leave fields undefined.
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    merged.interval = clamp(toInt(merged.interval, DEFAULT_SETTINGS.interval), INTERVAL_MIN, INTERVAL_MAX);
    merged.repeatCount = clamp(toInt(merged.repeatCount, DEFAULT_SETTINGS.repeatCount), COUNT_MIN, COUNT_MAX);
    merged.clickBeforeEnter = Boolean(merged.clickBeforeEnter);
    merged.clickX = clamp(toInt(merged.clickX, DEFAULT_SETTINGS.clickX), 0, XY_MAX);
    merged.clickY = clamp(toInt(merged.clickY, DEFAULT_SETTINGS.clickY), 0, XY_MAX);
    if (!["infinite", "custom"].includes(merged.repeatMode)) merged.repeatMode = DEFAULT_SETTINGS.repeatMode;
    if (!["mac", "windows", "linux"].includes(merged.platform)) merged.platform = DEFAULT_SETTINGS.platform;
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* Storage may be unavailable (private mode) — simply keep in-memory state. */
  }
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/* --------------------------------------------------------------------------
 * Session state (never persisted — resets on page load)
 * ------------------------------------------------------------------------ */
const session = {
  running: false,
  presses: 0,        // total presses across all runs until Reset
  firedInCycle: 0,   // presses in the current run
  nextFireAt: 0,     // performance.now() timestamp of the next press
  fireTimeoutId: null,
  uiTimerId: null,
  pressedClassTimer: null,
};

/* Bridge run state — real system-wide presses delivered by bridge.py */
const bridge = {
  active: false,
  pollId: null,
  lastPresses: 0,
  startedAt: 0,
};

/* --------------------------------------------------------------------------
 * Web Audio click sound
 * ------------------------------------------------------------------------ */
const audio = { ctx: null };

function playClick() {
  if (!settings.sound) return;
  try {
    audio.ctx = audio.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.ctx.state === "suspended") audio.ctx.resume();

    const ctx = audio.ctx;
    const now = ctx.currentTime;

    // Layer 1 — low "thock": the mechanical body of the keyswitch.
    const thock = ctx.createOscillator();
    const thockGain = ctx.createGain();
    thock.type = "triangle";
    thock.frequency.setValueAtTime(180, now);
    thock.frequency.exponentialRampToValueAtTime(60, now + 0.09);
    thockGain.gain.setValueAtTime(0.28, now);
    thockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    thock.connect(thockGain).connect(ctx.destination);
    thock.start(now);
    thock.stop(now + 0.1);

    // Layer 2 — high "tick": the plastic click contact.
    const tick = ctx.createOscillator();
    const tickGain = ctx.createGain();
    tick.type = "square";
    tick.frequency.setValueAtTime(760, now);
    tickGain.gain.setValueAtTime(0.05, now);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    tick.connect(tickGain).connect(ctx.destination);
    tick.start(now);
    tick.stop(now + 0.04);
  } catch {
    /* Audio may be blocked before a user gesture — fail silently. */
  }
}

/* --------------------------------------------------------------------------
 * Countdown / progress rendering
 * ------------------------------------------------------------------------ */
function startUiLoop() {
  stopUiLoop();
  updateCountdown();
  session.uiTimerId = setInterval(updateCountdown, 100);
}

function stopUiLoop() {
  if (session.uiTimerId !== null) {
    clearInterval(session.uiTimerId);
    session.uiTimerId = null;
  }
}

function updateCountdown() {
  const intervalMs = settings.interval * 1000;
  let remainingMs;

  if (bridge.active) {
    // Bridge timing: first press at t=0, then one per interval — mirror that.
    const elapsed = Date.now() - bridge.startedAt;
    const sincePress = elapsed % intervalMs;
    remainingMs = sincePress === 0 ? intervalMs : intervalMs - sincePress;
  } else {
    remainingMs = Math.max(0, session.nextFireAt - performance.now());
  }
  const remainingSec = Math.ceil(remainingMs / 1000);

  // Whole seconds remaining until the next press, clamped to the interval.
  const isRunning = session.running || bridge.active;
  el.countdown.textContent = (isRunning ? clamp(remainingSec, 0, settings.interval) : settings.interval);

  // Progress within the current interval window (0 → 1), drives ring + bar.
  const fraction = isRunning ? 1 - remainingMs / intervalMs : 0;
  const clampedFraction = clamp(fraction, 0, 1);

  el.countdownRing.style.setProperty("--progress", `${(clampedFraction * 360).toFixed(1)}deg`);
  el.progressFill.style.width = `${(clampedFraction * 100).toFixed(1)}%`;
}

function renderIdleCountdown() {
  el.countdown.textContent = settings.interval;
  el.countdownRing.style.setProperty("--progress", "0deg");
  el.progressFill.style.width = "0%";
}

/* --------------------------------------------------------------------------
 * Scheduling — drift-free via absolute target timestamps
 * ------------------------------------------------------------------------ */
function scheduleNextPress() {
  const delayMs = Math.max(0, session.nextFireAt - performance.now());
  session.fireTimeoutId = setTimeout(onIntervalElapsed, delayMs);
}

function onIntervalElapsed() {
  if (!session.running) return;

  firePress();

  // Honour the custom count (if enabled) before scheduling another press.
  if (settings.repeatMode === "custom" && session.firedInCycle >= settings.repeatCount) {
    stopRun("done");
    return;
  }

  // Advance the target by exactly one interval — clock drift never accumulates.
  session.nextFireAt += settings.interval * 1000;
  scheduleNextPress();
}

/* --------------------------------------------------------------------------
 * Simulating the Enter press
 * ------------------------------------------------------------------------ */
/** Shared press visuals: keycap travel + glow and target-field flash. */
function animateKeycap() {
  el.keycap.classList.remove("is-pressed", "is-flash");
  void el.keycap.offsetWidth;
  el.keycap.classList.add("is-pressed");
  clearTimeout(session.pressedClassTimer);
  session.pressedClassTimer = setTimeout(() => {
    el.keycap.classList.add("is-flash");
    el.keycap.classList.remove("is-pressed");
  }, 130);

  el.targetInput.classList.add("is-event");
  setTimeout(() => el.targetInput.classList.remove("is-event"), 200);
}

function bumpCounters() {
  el.totalPresses.textContent = session.presses;
  el.totalPresses.classList.remove("is-bump");
  void el.totalPresses.offsetWidth;
  el.totalPresses.classList.add("is-bump");
  el.cyclePresses.textContent = session.firedInCycle;
}

/** Describes the current press sequence for log/status messages. */
function sequenceParts() {
  const parts = [];
  if (settings.clickBeforeEnter) parts.push(`Click(${settings.clickX},${settings.clickY})`);
  parts.push("Enter");
  return parts.join(" → ");
}

/**
 * Simulates a left-click at (x, y) in page coordinates: a brief marker,
 * then real mousedown / mouseup / click MouseEvents on the element there.
 */
function simulateClick(x, y) {
  const marker = document.createElement("div");
  marker.className = "click-marker";
  marker.style.left = `${x}px`;
  marker.style.top = `${y}px`;
  document.body.appendChild(marker);
  setTimeout(() => marker.remove(), 500);

  const target = document.elementFromPoint(x, y) || document.body;
  const init = {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  };
  target.dispatchEvent(new MouseEvent("mousedown", init));
  target.dispatchEvent(new MouseEvent("mouseup", init));
  target.dispatchEvent(new MouseEvent("click", init));

  if (target === el.targetInput || el.targetInput.contains(target)) {
    el.targetInput.classList.add("is-event");
    setTimeout(() => el.targetInput.classList.remove("is-event"), 200);
  }
}

function firePress() {
  session.presses += 1;
  session.firedInCycle += 1;

  // 1. Per-press sequence: optional click at the target point, then Enter.
  if (settings.clickBeforeEnter) simulateClick(settings.clickX, settings.clickY);

  // 2. Keycap animation + target-field flash.
  animateKeycap();

  // 3. Fire a genuine Enter KeyboardEvent (key: "Enter", keyCode 13) on the field.
  const eventInit = {
    key: "Enter",
    code: "Enter",
    location: 0,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  el.targetInput.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  el.targetInput.dispatchEvent(new KeyboardEvent("keyup", eventInit));

  // 4. Sound + counters + log.
  playClick();
  bumpCounters();

  addLogEntry(`Press <strong>#${session.presses}</strong> — ${sequenceParts()} dispatched to test target`);
}

/* --------------------------------------------------------------------------
 * Event log
 * ------------------------------------------------------------------------ */
function timestamp() {
  const d = new Date();
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function addLogEntry(html) {
  // Remove the empty-state placeholder once real entries arrive.
  if (el.logEmpty && el.logEmpty.parentNode === el.log) el.logEmpty.remove();

  const entry = document.createElement("div");
  entry.className = "log-entry";

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = `[${timestamp()}]`;

  const msg = document.createElement("span");
  msg.className = "log-msg";
  msg.innerHTML = html;

  entry.append(time, msg);

  // Newest entries appear at the top of the scroll list.
  el.log.prepend(entry);

  // Keep the DOM light by trimming the oldest entries.
  while (el.log.children.length > MAX_LOG_ENTRIES) {
    el.log.lastElementChild.remove();
  }
}

function clearLog() {
  el.log.replaceChildren(el.logEmpty);
  addSystemLog("Event log cleared");
}

function addSystemLog(html) {
  if (el.logEmpty && el.logEmpty.parentNode === el.log) el.logEmpty.remove();
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `<span class="log-time">[${timestamp()}]</span><span class="log-msg">${html}</span>`;
  el.log.prepend(entry);
}

/* --------------------------------------------------------------------------
 * Local bridge — REAL system-wide presses via the optional bridge.py helper
 * ------------------------------------------------------------------------ */
function setBridgeBadge(text, cssClass) {
  el.bridgeBadge.textContent = text;
  el.bridgeBadge.classList.remove("is-on", "is-off");
  if (cssClass) el.bridgeBadge.classList.add(cssClass);
}

async function probeBridge() {
  let data = null;
  try {
    const res = await fetch(`${BRIDGE_URL}/ping`, { cache: "no-store" });
    data = await res.json();
  } catch {
    data = null;
  }
  if (data && data.ok) {
    setBridgeBadge(data.running ? "Bridge: pressing" : "Bridge: connected", "is-on");
  } else {
    setBridgeBadge("Bridge: offline", "is-off");
  }
  return data;
}

async function bridgeStartRequest() {
  const res = await fetch(`${BRIDGE_URL}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      interval: settings.interval,
      count: settings.repeatMode === "custom" ? settings.repeatCount : 0,
      click: settings.clickBeforeEnter ? 1 : 0,
      clickX: settings.clickX,
      clickY: settings.clickY,
    }),
  });
  if (!res.ok) throw new Error(`bridge /start → ${res.status}`);
  return res.json();
}

async function bridgeStopRequest() {
  try {
    await fetch(`${BRIDGE_URL}/stop`, { method: "POST" });
  } catch {
    /* helper may already be gone */
  }
}

function startBridgePoll() {
  stopBridgePoll();
  bridge.pollId = setInterval(bridgePollTick, 500);
}

function stopBridgePoll() {
  if (bridge.pollId !== null) {
    clearInterval(bridge.pollId);
    bridge.pollId = null;
  }
}

async function bridgePollTick() {
  let data = null;
  try {
    const res = await fetch(`${BRIDGE_URL}/ping`, { cache: "no-store" });
    data = await res.json();
  } catch {
    data = null;
  }

  if (!data || !data.ok) {
    bridge.active = false;
    stopBridgePoll();
    stopRun("manual");
    addSystemLog("Bridge connection lost — helper (bridge.py) is not reachable");
    showToast("Bridge offline — run: python3 bridge.py");
    return;
  }

  // Log each press the helper reports since the previous tick.
  while (bridge.lastPresses < data.presses) {
    bridge.lastPresses += 1;
    session.presses += 1;
    session.firedInCycle += 1;
    animateKeycap();
    playClick();
    bumpCounters();
    addLogEntry(`Press <strong>#${session.presses}</strong> — ${sequenceParts()} (real events via bridge) sent to the frontmost app`);
  }

  // The helper finished a custom-count run on its own.
  if (!data.running && bridge.active) stopRun("done");
}

/* --------------------------------------------------------------------------
 * Start / stop / reset
 * ------------------------------------------------------------------------ */
function modeText() {
  return settings.repeatMode === "custom"
    ? `stopping after ${settings.repeatCount} presses`
    : "running infinitely";
}

function setRunUi(isRunning, isReal) {
  el.startStopBtn.classList.toggle("is-running", isRunning);
  el.startStopLabel.textContent = isRunning ? "Stop" : "Start";
  el.startStopBtn.setAttribute("aria-label", isRunning ? "Stop pressing Enter" : "Start pressing Enter");
  el.countdownRing.classList.toggle("is-running", isRunning);
  if (isRunning) setStatus(isReal ? "Running (real keys)" : "Running (local)", "is-running");
}

function startLocalRun() {
  session.running = true;
  session.firedInCycle = 0;

  session.nextFireAt = performance.now() + settings.interval * 1000;
  scheduleNextPress();
  startUiLoop();

  setRunUi(true, false);
  addSystemLog(`Started (local simulation) — interval <strong>${settings.interval}s</strong>, ${modeText()}`);
}

async function startRun() {
  const ok = applyIntervalFromInput();
  if (!ok) return;

  // Prefer the bridge (real keys) when the helper is running.
  const data = await probeBridge();
  if (data && data.ok) {
    try {
      await bridgeStartRequest();
      bridge.active = true;
      bridge.lastPresses = 0;
      bridge.startedAt = Date.now();
      session.firedInCycle = 0;
      session.running = false;

      startBridgePoll();
      startUiLoop();
      setRunUi(true, true);
      addSystemLog(`Started (REAL keys via bridge) — interval <strong>${settings.interval}s</strong>, ${modeText()}`);
      showToast("Real pressing started — focus the target app");
      return;
    } catch {
      addSystemLog("Bridge rejected start — falling back to local simulation");
    }
  }

  // No helper (or it failed the request): simulate inside the page.
  startLocalRun();
}

function stopRun(reason = "manual") {
  const wasBridge = bridge.active;
  if (wasBridge) {
    bridge.active = false;
    stopBridgePoll();
    bridgeStopRequest();
  }

  session.running = false;
  clearTimeout(session.fireTimeoutId);
  session.fireTimeoutId = null;
  stopUiLoop();
  renderIdleCountdown();

  el.startStopBtn.classList.remove("is-running");
  el.startStopLabel.textContent = "Start";
  el.startStopBtn.setAttribute("aria-label", "Start pressing Enter");
  el.countdownRing.classList.remove("is-running");
  el.countdownLabel.textContent = "until next press";
  setStatus("Idle", "is-idle");

  if (reason === "done") {
    addSystemLog(`Finished — <strong>${settings.repeatCount}</strong> presses completed`);
    showToast(`Done — ${settings.repeatCount} presses completed`);
  } else if (reason === "manual") {
    addSystemLog(wasBridge ? "Stopped — real pressing ended" : "Stopped — reset the countdown or press Start to resume");
  }

  probeBridge();
}

function toggleRun() {
  if (session.running || bridge.active) stopRun("manual");
  else startRun();
}

function resetAll() {
  stopRun("manual");
  session.presses = 0;
  session.firedInCycle = 0;

  el.totalPresses.textContent = "0";
  el.cyclePresses.textContent = "0";
  el.log.replaceChildren(el.logEmpty);
  renderIdleCountdown();
  addSystemLog("Reset — counters cleared, log emptied");
  showToast("Reset complete");
}

function setStatus(text, cssClass) {
  el.statusText.textContent = text;
  el.statusText.classList.remove("is-running", "is-idle");
  if (cssClass) el.statusText.classList.add(cssClass);
}

/* --------------------------------------------------------------------------
 * Interval & repeat-count input handling
 * ------------------------------------------------------------------------ */
function showFieldError(errorEl, show) {
  errorEl.hidden = !show;
}

/**
 * Reads + validates the interval input. Returns false if invalid.
 * While running, the countdown restarts so the new interval applies instantly.
 */
function applyIntervalFromInput() {
  const raw = el.intervalInput.value;
  const value = Number.parseInt(raw, 10);

  if (raw === "" || !Number.isFinite(value) || value < INTERVAL_MIN || value > INTERVAL_MAX) {
    showFieldError(el.intervalError, true);
    return false;
  }

  showFieldError(el.intervalError, false);
  settings.interval = clamp(value, INTERVAL_MIN, INTERVAL_MAX);
  el.intervalInput.value = settings.interval;
  saveSettings();
  updateScript();

  if (session.running) {
    // Re-anchor the next press so the change takes effect immediately.
    clearTimeout(session.fireTimeoutId);
    session.nextFireAt = performance.now() + settings.interval * 1000;
    scheduleNextPress();
  } else {
    renderIdleCountdown();
  }
  return true;
}

function adjustInterval(delta) {
  const current = Number.parseInt(el.intervalInput.value, 10) || settings.interval;
  const next = clamp(current + delta, INTERVAL_MIN, INTERVAL_MAX);
  if (next === current) return;
  el.intervalInput.value = next;
  applyIntervalFromInput();
}

function applyRepeatCountFromInput() {
  const raw = el.repeatCountInput.value;
  const value = Number.parseInt(raw, 10);

  if (raw === "" || !Number.isFinite(value) || value < COUNT_MIN || value > COUNT_MAX) {
    showFieldError(el.countError, true);
    return;
  }

  showFieldError(el.countError, false);
  settings.repeatCount = clamp(value, COUNT_MIN, COUNT_MAX);
  el.repeatCountInput.value = settings.repeatCount;
  saveSettings();
  updateScript();

  // If already running and the (reduced) target has been met, finish now.
  if (session.running && session.firedInCycle >= settings.repeatCount) {
    stopRun("done");
  }
}

function applyRepeatMode(mode) {
  settings.repeatMode = mode;
  saveSettings();

  // The custom-count field only accepts input in "custom" mode.
  el.repeatCountInput.disabled = mode !== "custom";
  if (mode !== "custom") showFieldError(el.countError, false);

  updateScript();
}

/* --------------------------------------------------------------------------
 * Click target inputs
 * ------------------------------------------------------------------------ */
/**
 * Cursor picking — "Pick" first asks the bridge to open a full-screen aim
 * overlay: a crosshair follows the cursor across the ENTIRE PC screen and a
 * left-click anywhere sets the target (Esc cancels). Without the bridge
 * (or if no GUI can be shown), it falls back to in-page aiming: a reticle
 * tracks the cursor and the position is captured when the countdown ends.
 */
const AIM_SECONDS = 5;
const aim = {
  timerId: null,
  onMove: null,
  onDown: null,
  onKey: null,
  endedAt: 0,
};

async function pickPosition() {
  if (aim.timerId !== null || aim.blocked) return; // already aiming
  // The mousedown that just ended a pick also clicks this button.
  if (Date.now() - aim.endedAt < 300) return;

  const data = await probeBridge();
  if (data && data.ok) {
    // Screen-wide overlay — click anywhere on the PC screen.
    aim.blocked = true;
    showToast("Aim anywhere on the PC screen and left-click to set the target (Esc cancels)", 12000);
    try {
      const res = await fetch(`${BRIDGE_URL}/aim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout: 30 }),
      });
      const picked = await res.json();
      if (picked && picked.ok) {
        el.clickXInput.value = Math.round(picked.x);
        el.clickYInput.value = Math.round(picked.y);
        applyClickXYFromInput();
        showToast(`Click target picked — (${el.clickXInput.value}, ${el.clickYInput.value}) (global screen coordinates)`);
        return;
      }
      if (picked && picked.reason === "cancelled") {
        showToast("Picking cancelled — click target unchanged");
        return;
      }
      // "unavailable": fall back to in-page aiming below.
    } catch {
      /* fall back to in-page aiming */
    } finally {
      aim.blocked = false;
    }
  }
  startInPageAim();
}

function startInPageAim() {
  if (aim.timerId !== null) return;

  let left = AIM_SECONDS;
  document.body.classList.add("is-picking");
  showAimReticle(window.innerWidth / 2, window.innerHeight / 2, `${left}…`);
  showToast(`Bridge not available — aim on this page; capture in ${left}s · left-click to capture now · Esc cancels`, AIM_SECONDS * 1000 + 500);

  aim.onMove = (e) => showAimReticle(e.clientX, e.clientY, `${left}…`);
  aim.onDown = (e) => {
    if (e.target && e.target.closest && e.target.closest("#pickBtn")) return;
    endAim();
    e.preventDefault();
    e.stopPropagation();
    setTargetFromPick(e);
  };
  aim.onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation(); // keep the global Esc → toggle shortcut out
    endAim();
    showToast("Picking cancelled — click target unchanged");
  };
  document.addEventListener("mousemove", aim.onMove, true);
  document.addEventListener("mousedown", aim.onDown, true);
  document.addEventListener("keydown", aim.onKey, true);

  aim.timerId = setInterval(() => {
    left -= 1;
    if (left > 0) {
      el.aimLabel.textContent = `${left}…`;
      return;
    }
    endAim();
    setTargetFromPick(null);
  }, 1000);
}

function showAimReticle(x, y, text) {
  el.aimOverlay.hidden = false;
  el.aimOverlay.style.left = `${x}px`;
  el.aimOverlay.style.top = `${y}px`;
  el.aimLabel.textContent = text;
}

function endAim() {
  clearInterval(aim.timerId);
  aim.timerId = null;
  document.removeEventListener("mousemove", aim.onMove, true);
  document.removeEventListener("mousedown", aim.onDown, true);
  document.removeEventListener("keydown", aim.onKey, true);
  aim.onMove = aim.onDown = aim.onKey = null;
  el.aimOverlay.hidden = true;
  document.body.classList.remove("is-picking");
  aim.endedAt = Date.now();
}

/**
 * Saves the click target from the in-page flow: fetches the bridge's global
 * cursor read at the capture instant, or falls back to the click's page
 * coordinates.
 */
async function setTargetFromPick(ev) {
  try {
    const res = await fetch(`${BRIDGE_URL}/pick`, { cache: "no-store" });
    const picked = await res.json();
    if (picked && picked.ok) {
      el.clickXInput.value = Math.round(picked.x);
      el.clickYInput.value = Math.round(picked.y);
      applyClickXYFromInput();
      showToast(`Click target picked — (${el.clickXInput.value}, ${el.clickYInput.value}) (global screen coordinates)`);
      return;
    }
  } catch {
    /* fall through */
  }
  if (ev) {
    el.clickXInput.value = Math.round(ev.clientX);
    el.clickYInput.value = Math.round(ev.clientY);
    applyClickXYFromInput();
    showToast(`Click target picked — (${el.clickXInput.value}, ${el.clickYInput.value}) (page coordinates)`);
    return;
  }
  showToast("Bridge offline — aim and left-click on this page to set the target", 5000);
}

function applyClickXYFromInput() {
  const x = Number.parseInt(el.clickXInput.value, 10);
  const y = Number.parseInt(el.clickYInput.value, 10);
  const invalid =
    el.clickXInput.value === "" || !Number.isFinite(x) || x < 0 || x > XY_MAX ||
    el.clickYInput.value === "" || !Number.isFinite(y) || y < 0 || y > XY_MAX;

  if (invalid) {
    showFieldError(el.clickXYError, true);
    return false;
  }

  showFieldError(el.clickXYError, false);
  settings.clickX = clamp(x, 0, XY_MAX);
  settings.clickY = clamp(y, 0, XY_MAX);
  el.clickXInput.value = settings.clickX;
  el.clickYInput.value = settings.clickY;
  saveSettings();
  updateScript();
  return true;
}

function applyClickEnabled(enabled) {
  settings.clickBeforeEnter = enabled;
  saveSettings();

  // Coordinates are only editable while the click step is enabled.
  el.clickXInput.disabled = !enabled;
  el.clickYInput.disabled = !enabled;
  el.pickBtn.disabled = !enabled;
  if (!enabled) showFieldError(el.clickXYError, false);

  updateScript();
}

/* --------------------------------------------------------------------------
 * Cross-platform script generation (macOS / Windows / Linux)
 * ------------------------------------------------------------------------ */
const PLATFORM_NOTES = {
  mac: "Accessibility permission REQUIRED — Enable: `open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"` → + → add Terminal (GUI only; tccutil cannot grant). Disable: `sudo tccutil reset Accessibility` (revokes for all apps). Then paste the whole block into Terminal and press Enter — presses go to the frontmost app while it runs (Ctrl+C stops). Option 2 is for Script Editor only.",
  windows: "Accessibility permission: NOT required — SendKeys works out of the box (only run PowerShell as administrator if the target app is elevated, else presses are blocked by UIPI). If synthetic keys get skipped, turn off the Filter Keys accessibility feature: Settings → Accessibility → Keyboard → Filter Keys. Paste this into a PowerShell window — presses go to the frontmost app while it runs (Ctrl+C stops).",
  linux: "Accessibility permission: NOT required on X11 — xdotool works out of the box (`sudo apt install xdotool`). Wayland (ydotool): Enable: `sudo usermod -aG input $USER` (log out/in) + `sudo systemctl enable --now ydotoold`. Disable: `sudo gpasswd -d $USER input` + `sudo systemctl disable --now ydotoold`. Paste into a shell — presses go to the frontmost app while it runs (Ctrl+C stops).",
};

function buildAppleScript(interval, mode, count) {
  const stamp = new Date().toLocaleString();
  const header =
    `-- Generated by Enter Key Clicker on ${stamp}\n` +
    `-- Interval: ${interval}s | Mode: ${mode === "infinite" ? "infinite" : `${count} presses`}\n\n`;
  const steps =
    (settings.clickBeforeEnter
      ? `\t\tclick at {${settings.clickX}, ${settings.clickY}} -- left-click at the target point\n`
      : "") +
    `\t\tkey code 36 -- Enter / Return (keyCode 13)\n`;
  const body =
    `${mode === "infinite" ? "repeat" : `repeat ${count} times`}\n` +
    `\ttell application "System Events"\n` +
    steps +
    `\tend tell\n` +
    `\tdelay ${interval}\n` +
    `end repeat`;
  return `${header}${body}\n`;
}

function buildScript(platform, interval, mode, count) {
  const stamp = new Date().toLocaleString();
  const header =
    `-- Generated by Enter Key Clicker on ${stamp}\n` +
    `-- Interval: ${interval}s | Mode: ${mode === "infinite" ? "infinite" : `${count} presses`}\n`;

  // On macOS the primary block is the osascript Terminal command.
  if (platform === "mac") {
    return buildOsaCommand();
  }

  const clickEnabled = settings.clickBeforeEnter;

  if (platform === "windows") {
    const comment = header.replace(/^--/gm, "#");
    let prelude = "Add-Type -AssemblyName System.Windows.Forms\n";
    if (clickEnabled) {
      prelude +=
        `Add-Type @"\n` +
        `using System;\n` +
        `using System.Runtime.InteropServices;\n` +
        `public static class MouseTap {\n` +
        `    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);\n` +
        `    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);\n` +
        `}\n` +
        `"@\n`;
    }

    const bodyLines = [];
    if (clickEnabled) {
      bodyLines.push(`    [MouseTap]::SetCursorPos(${settings.clickX}, ${settings.clickY})`);
      bodyLines.push("    Start-Sleep -Milliseconds 50");
      bodyLines.push("    [MouseTap]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)  # left button down");
      bodyLines.push("    Start-Sleep -Milliseconds 50");
      bodyLines.push("    [MouseTap]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)  # left button up");
      bodyLines.push("    Start-Sleep -Milliseconds 50");
    }
    bodyLines.push('    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")');

    const body = bodyLines.join("\n");
    const loop =
      mode === "infinite"
        ? `while ($true) {\n${body}\n    Start-Sleep -Seconds ${interval}\n}`
        : `for ($i = 1; $i -le ${count}; $i++) {\n${body}\n    Start-Sleep -Seconds ${interval}\n}`;
    return `${comment}${prelude}\n${loop}\n`;
  }

  // linux — bash + xdotool
  const comment = header.replace(/^--/gm, "#");
  const stepLines = [];
  if (clickEnabled) stepLines.push(`  xdotool mousemove ${settings.clickX} ${settings.clickY} click 1`);
  stepLines.push("  xdotool key Return");
  const body = stepLines.join("\n");
  const loop =
    mode === "infinite"
      ? `while true; do\n${body}\n  sleep ${interval}\ndone`
      : `for i in $(seq 1 ${count}); do\n${body}\n  sleep ${interval}\ndone`;
  return `${comment}${loop}\n`;
}

function updateScript() {
  const { platform, interval, repeatMode, repeatCount } = settings;
  const isMac = platform === "mac";

  // Primary block — paste-and-run for Terminal / PowerShell / bash.
  el.scriptCode.textContent = buildScript(platform, interval, repeatMode, repeatCount);
  el.platformNote.textContent = `${PLATFORM_NOTES[platform]} Sequence per press: ${sequenceParts()}.`;

  if (isMac) {
    // Show the Script Editor flavour as a clearly separated secondary option.
    el.optSecondary.hidden = false;
    el.scriptCode2.textContent = buildAppleScript(interval, repeatMode, repeatCount);
    el.primaryOptLabel.textContent = "Option 1 — paste this whole block into Terminal, then press Enter";
    el.copyOsaBtn.hidden = false;
    el.copyScriptBtn.hidden = true;
  } else {
    el.optSecondary.hidden = true;
    el.primaryOptLabel.textContent =
      platform === "windows" ? "Paste this into a PowerShell window" : "Paste this into a Terminal/shell window";
    el.copyOsaBtn.hidden = true;
    el.copyScriptBtn.hidden = false;
  }
}

/**
 * Paste-ready `osascript` shell command that injects Enter at the HID event
 * level from the macOS Terminal (JXA + CoreGraphics).
 *  - CGEventSourceStateHIDSystemState (1): event source pretends to be the
 *    hardware HID system, so the event also carries the keyboard's own state.
 *  - kCGHIDEventTap (0): posts at the lowest event tap userland can reach.
 *  - Explicit keydown + 20ms hold + keyup mimics a human key press.
 *  - Optional pre-press steps: left-click at (X, Y) via CGEventCreateMouseEvent
 *    (types 5/1/2 = moved / left-down / left-up) before the Enter keyTap.
 */
function buildOsaCommand() {
  const n = settings.repeatMode === "infinite" ? 0 : settings.repeatCount; // 0 = infinite
  const i = settings.interval;
  const click = settings.clickBeforeEnter ? 1 : 0;
  return `osascript -l JavaScript -e '
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
// N = presses (0 = run forever); I = seconds between presses
// Sequence per press: Click(X, Y) -> Enter (the click step is optional)
var N = ${n}, I = ${i};
var CLICK = ${click}, X = ${settings.clickX}, Y = ${settings.clickY};
var src = $.CGEventSourceCreate(1);
function clickXY() {
  var mv = $.CGEventCreateMouseEvent(src, 5, {x: X, y: Y}, 0);
  $.CGEventPost(0, mv);
  $.NSThread.sleepForTimeInterval(0.02);
  var d = $.CGEventCreateMouseEvent(src, 1, {x: X, y: Y}, 0);
  $.CGEventPost(0, d);
  $.NSThread.sleepForTimeInterval(0.02);
  var u = $.CGEventCreateMouseEvent(src, 2, {x: X, y: Y}, 0);
  $.CGEventPost(0, u);
  $.NSThread.sleepForTimeInterval(0.05);
}
function keyTap(code) {
  var d = $.CGEventCreateKeyboardEvent(src, code, true);
  $.CGEventPost(0, d);
  $.NSThread.sleepForTimeInterval(0.02);
  var u = $.CGEventCreateKeyboardEvent(src, code, false);
  $.CGEventPost(0, u);
}
function press() {
  if (CLICK === 1) clickXY();
  keyTap(36); // Enter / Return (keyCode 13)
}
var i = 0;
while (N === 0 || i < N) {
  press();
  i += 1;
  if (N === 0 || i < N) $.NSThread.sleepForTimeInterval(I);
}
"done"'`;
}

function copyOsaCommand() {
  const command = buildOsaCommand();

  const onFail = () => {
    const helper = document.createElement("textarea");
    helper.value = command;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    try {
      document.execCommand("copy");
      showToast("Terminal command copied");
    } catch {
      showToast("Copy failed — select the code manually");
    }
    helper.remove();
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(command).then(
      () => showToast("Terminal command copied"),
      onFail
    );
  } else {
    onFail();
  }
}

function selectPlatform(platform) {
  settings.platform = platform;
  saveSettings();

  el.platformTabs.forEach((tab) => {
    const isActive = tab.dataset.platform === platform;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  // The osascript shortcut is macOS-only — hide it for other platforms.
  el.copyOsaBtn.hidden = platform !== "mac";

  updateScript();
}

/* --------------------------------------------------------------------------
 * Clipboard + toast
 * ------------------------------------------------------------------------ */
function showToast(message, duration = 2200) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  el.toast.classList.add("is-visible");
  clearTimeout(showToast.timerId);
  showToast.timerId = setTimeout(() => {
    el.toast.classList.remove("is-visible");
  }, duration);
}

function copyScript() {
  const text = el.scriptCode.textContent;
  const label = { mac: "AppleScript", windows: "PowerShell script", linux: "bash script" }[settings.platform];

  const onFail = () => {
    // Legacy fallback for browsers without the async Clipboard API.
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    try {
      document.execCommand("copy");
      showToast(`${label} copied to clipboard`);
    } catch {
      showToast("Copy failed — select the code manually");
    }
    helper.remove();
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast(`${label} copied to clipboard`),
      onFail
    );
  } else {
    onFail();
  }
}

/* --------------------------------------------------------------------------
 * Theme
 * ------------------------------------------------------------------------ */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  settings.theme = theme;
  saveSettings();
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  applyTheme(next);
}

/* --------------------------------------------------------------------------
 * Event wiring
 * ------------------------------------------------------------------------ */
el.themeToggle.addEventListener("click", toggleTheme);

// Start/Stop and Reset are mouse-only controls: blur them after clicking so a
// real (bridge) Enter landing on the page can never re-activate the focused
// button and toggle the automation off/on by itself.
el.startStopBtn.addEventListener("click", (e) => {
  toggleRun();
  e.currentTarget.blur();
});
el.resetBtn.addEventListener("click", (e) => {
  resetAll();
  e.currentTarget.blur();
});

el.chips.forEach((chip) => {
  chip.addEventListener("click", () => adjustInterval(Number.parseInt(chip.dataset.adjust, 10)));
});

el.intervalInput.addEventListener("input", () => {
  // Live validation feedback only; clamping happens on change/blur.
  const value = Number.parseInt(el.intervalInput.value, 10);
  const invalid = el.intervalInput.value === "" || !Number.isFinite(value) || value < INTERVAL_MIN || value > INTERVAL_MAX;
  showFieldError(el.intervalError, invalid);
  if (!invalid) applyIntervalFromInput();
});

el.intervalInput.addEventListener("blur", applyIntervalFromInput);
el.intervalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
});

el.repeatRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (radio.checked) applyRepeatMode(radio.value);
  });
});

el.clickToggle.addEventListener("change", () => applyClickEnabled(el.clickToggle.checked));
el.pickBtn.addEventListener("click", pickPosition);

[el.clickXInput, el.clickYInput].forEach((input) => {
  input.addEventListener("change", applyClickXYFromInput);
  input.addEventListener("input", () => {
    const both = [el.clickXInput, el.clickYInput];
    const invalid = both.some((i) => {
      const v = Number.parseInt(i.value, 10);
      return i.value === "" || !Number.isFinite(v) || v < 0 || v > XY_MAX;
    });
    showFieldError(el.clickXYError, invalid);
    if (!invalid) applyClickXYFromInput();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  });
});

el.repeatCountInput.addEventListener("change", applyRepeatCountFromInput);
el.repeatCountInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
});

el.clearLogBtn.addEventListener("click", clearLog);

el.soundToggle.addEventListener("change", () => {
  settings.sound = el.soundToggle.checked;
  saveSettings();
  if (settings.sound) playClick(); // instant audible confirmation
});

el.copyScriptBtn.addEventListener("click", copyScript);
el.copyOsaBtn.addEventListener("click", copyOsaCommand);
el.copyScript2Btn.addEventListener("click", () => {
  const text = el.scriptCode2.textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast("AppleScript copied — open Script Editor and paste"),
      () => showToast("Copy failed — select the code manually")
    );
  } else {
    showToast("Copy failed — select the code manually");
  }
});

el.platformTabs.forEach((tab) => {
  tab.addEventListener("click", () => selectPlatform(tab.dataset.platform));
});

// Global keyboard shortcut: Space / Escape toggles the runner — but never
// while the user is interacting with a control (typing or activating buttons).
document.addEventListener("keydown", (e) => {
  if (e.repeat || e.isComposing) return;
  if (e.key !== " " && e.key !== "Escape") return;

  const target = e.target;
  const typingSomewhere =
    target instanceof Element &&
    (target.matches("input, textarea, select, button, a, [contenteditable]") || target.closest("input, textarea, select, button, a, [contenteditable]"));
  if (typingSomewhere) return;

  e.preventDefault();
  toggleRun();
});

// The target field must not treat real user typing as automated presses —
// prevent the form from submitting on Enter so focus stays in the field.
el.targetForm.addEventListener("submit", (e) => e.preventDefault());

// Keep the theme in sync if the user has not explicitly chosen one.
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  const savedRaw = localStorage.getItem(STORAGE_KEY);
  if (savedRaw && savedRaw.includes('"theme"')) return;
  applyTheme(e.matches ? "light" : "dark");
});

/* --------------------------------------------------------------------------
 * Initial render — restore saved settings into the UI
 * ------------------------------------------------------------------------ */
function init() {
  applyTheme(settings.theme);
  probeBridge();

  // Interval + repeat controls
  el.intervalInput.value = settings.interval;
  el.repeatCountInput.value = settings.repeatCount;
  const customRadio = el.repeatRadios.find((r) => r.value === settings.repeatMode);
  if (customRadio) {
    customRadio.checked = true;
    el.repeatCountInput.disabled = settings.repeatMode !== "custom";
  }

  // Sound + sequence + platform
  el.soundToggle.checked = settings.sound;
  el.clickToggle.checked = settings.clickBeforeEnter;
  el.clickXInput.value = settings.clickX;
  el.clickYInput.value = settings.clickY;
  el.clickXInput.disabled = !settings.clickBeforeEnter;
  el.clickYInput.disabled = !settings.clickBeforeEnter;
  el.pickBtn.disabled = !settings.clickBeforeEnter;
  selectPlatform(settings.platform);
  updateScript();

  // Idle countdown preview
  renderIdleCountdown();
  setStatus("Idle", "is-idle");
  el.totalPresses.textContent = "0";
  el.cyclePresses.textContent = "0";
}

init();
