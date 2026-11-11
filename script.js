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
const INTERVAL_MIN = 1;
const INTERVAL_MAX = 9999;
const COUNT_MIN = 1;
const COUNT_MAX = 9999;
const MAX_LOG_ENTRIES = 300;
const STORAGE_KEY = "enterSim.settings";
const BRIDGE_URL = "http://127.0.0.1:8791"; // managed by bridge.py in this folder

const DEFAULT_SETTINGS = {
  interval: 5,          // seconds between presses
  repeatMode: "infinite", // "infinite" | "custom"
  repeatCount: 10,      // presses per run when repeatMode === "custom"
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

function firePress() {
  session.presses += 1;
  session.firedInCycle += 1;

  // 1. Keycap animation + target-field flash.
  animateKeycap();

  // 2. Fire a genuine Enter KeyboardEvent (key: "Enter", keyCode 13) on the field.
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

  // 3. Sound + counters + log.
  playClick();
  bumpCounters();

  addLogEntry(`Press <strong>#${session.presses}</strong> — Enter (keyCode 13) dispatched to test target`);
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
    addLogEntry(`Press <strong>#${session.presses}</strong> — REAL Enter (bridge) sent to the frontmost app`);
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
  const body =
    `${mode === "infinite" ? "repeat" : `repeat ${count} times`}\n` +
    `\ttell application "System Events"\n` +
    `\t\tkey code 36 -- Enter / Return (keyCode 13)\n` +
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

  if (platform === "windows") {
    const comment = header.replace(/^--/gm, "#");
    const loop =
      mode === "infinite"
        ? `while ($true) {\n    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")\n    Start-Sleep -Seconds ${interval}\n}`
        : `for ($i = 1; $i -le ${count}; $i++) {\n    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")\n    Start-Sleep -Seconds ${interval}\n}`;
    return `${comment}Add-Type -AssemblyName System.Windows.Forms\n\n${loop}\n`;
  }

  // linux — bash + xdotool
  const comment = header.replace(/^--/gm, "#");
  const loop =
    mode === "infinite"
      ? `while true; do\n  xdotool key Return\n  sleep ${interval}\ndone`
      : `for i in $(seq 1 ${count}); do\n  xdotool key Return\n  sleep ${interval}\ndone`;
  return `${comment}${loop}\n`;
}

function updateScript() {
  const { platform, interval, repeatMode, repeatCount } = settings;
  const isMac = platform === "mac";

  // Primary block — paste-and-run for Terminal / PowerShell / bash.
  el.scriptCode.textContent = buildScript(platform, interval, repeatMode, repeatCount);
  el.platformNote.textContent = PLATFORM_NOTES[platform];

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
 */
function buildOsaCommand() {
  const n = settings.repeatMode === "infinite" ? 0 : settings.repeatCount; // 0 = infinite
  const i = settings.interval;
  return `osascript -l JavaScript -e '
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
// N = presses (0 = run forever); I = seconds between presses
var N = ${n}, I = ${i};
var src = $.CGEventSourceCreate(1);
function press() {
  var d = $.CGEventCreateKeyboardEvent(src, 36, true);
  $.CGEventPost(0, d);
  $.NSThread.sleepForTimeInterval(0.02);
  var u = $.CGEventCreateKeyboardEvent(src, 36, false);
  $.CGEventPost(0, u);
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

  // Sound + platform
  el.soundToggle.checked = settings.sound;
  selectPlatform(settings.platform);
  updateScript();

  // Idle countdown preview
  renderIdleCountdown();
  setStatus("Idle", "is-idle");
  el.totalPresses.textContent = "0";
  el.cyclePresses.textContent = "0";
}

init();
