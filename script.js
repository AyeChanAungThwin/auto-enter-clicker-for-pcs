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
const INTERVAL_MIN = 10;
const INTERVAL_MAX = 9999;
const COUNT_MIN = 1;
const COUNT_MAX = 9999;
const XY_MAX = 99999;
const MAX_TARGETS = 20;        // max entries in the press-target list
const STEP_DELAY_MS = 200;     // gap between the list steps inside one interval
const MAX_LOG_ENTRIES = 300;
const STORAGE_KEY = "enterSim.settings";
const BRIDGE_URL = "http://127.0.0.1:8791"; // managed by bridge.py in this folder

const DEFAULT_SETTINGS = {
  interval: 10,         // seconds between bursts
  repeatMode: "infinite", // "infinite" | "custom"
  repeatCount: 10,      // presses per run when repeatMode === "custom"
  clickBeforeEnter: false, // left-click at each step's target before Tab/Enter
  tabBeforeEnter: false, // press Tab before Enter in every step
  clickTargets: [],     // step targets; presses walk this in order (start empty)
  sound: true,          // Web Audio click feedback
  theme: "dark",        // "dark" | "light"
  platform: "mac",      // "mac" | "windows" | "linux"
  lang: "en",           // "en" | "my" | "zh" | "ko" — UI language, default English
};

/* --------------------------------------------------------------------------
 * Localization — English (default), Myanmar, Chinese, Korean
 * ------------------------------------------------------------------------ */
const I18N = {
  /* ---- English (default) ---- */
  en: {
    tagline: 'Automated <kbd>&#9166;</kbd> press simulator &amp; macOS script generator',
    theme_title: "Toggle theme",
    theme_aria: "Toggle light/dark theme",
    lang_aria: "Language",
    stepper_aria: "Quick adjust interval",
    chip_m1: "Decrease interval by 1 second",
    chip_p1: "Increase interval by 1 second",
    chip_p10: "Increase interval by 10 seconds",
    chip_p60: "Increase interval by 60 seconds",
    controls: "Controls",
    bridge_badge_title: "Run `python3 bridge.py` in this folder (double-click start-bridge.command on macOS, start-bridge.bat on Windows) so the Start button presses real Enter in the frontmost app. Windows needs no permission; macOS must allow it: System Settings → Privacy & Security → Accessibility → add the app running the bridge.",
    until_next: "until next press",
    interval_label: "Interval (seconds, 10–9999)",
    interval_error: "Interval must be between 10 and 9999 seconds.",
    seq_legend: "Press sequence",
    click_title: "Mouse left-click first",
    click_hint: "Tap each step's target screen coordinates before Tab/Enter",
    tab_title: "Press Tab before Enter",
    tab_hint: "Moves focus to the next field before each Enter press",
    targets_label: "Press targets",
    targets_hint: 'Each cycle waits the interval first, then fires the whole list as a burst at the end of it — one entry every 0.2 seconds, wrapping around: <strong>click &rarr; tab &rarr; enter</strong>. A full cycle is the interval plus 0.2s per entry (2 targets, 10s interval &rarr; presses at 10.0s and 10.2s). <strong>Pick</strong> adds a target (up to 20); <strong>Reset list</strong> clears everything until new targets are added.',
    pick_title: "Adds a new target to the list: the bridge dims the whole PC screen with a crosshair overlay — click anywhere on the screen to add the target (Esc cancels). Without the bridge, an in-page reticle captures the cursor position after a short countdown.",
    add_target: "Add target manually",
    reset_targets: "Reset list",
    target_remove_aria: "Remove this target",
    targets_error: "All coordinates must be whole numbers between 0 and 99999.",
    repeat_legend: "Repeat mode",
    inf_title: "Run infinitely",
    inf_hint: "Press forever until stopped",
    custom_title: "Stop after custom count",
    custom_hint: "Run a fixed number of presses (1–9999)",
    count_label: "Number of presses",
    count_error: "Count must be between 1 and 9999.",
    reset: "Reset",
    shortcut_hint: "Toggle with <kbd>Space</kbd> / <kbd>Esc</kbd>",
    stats_cycle: "Presses this run",
    stats_status: "Status",
    target_heading: "Test Target",
    total_label: "Total presses",
    target_label: "Target field",
    target_ph: "Focus here — every simulated Enter fires on this field",
    sound_label: "Click sound (Web Audio)",
    log_heading: "Event Log",
    clear_log: "Clear",
    log_aria: "Simulated Enter press log",
    log_empty: "No presses yet — hit Start to begin.",
    script_heading: "System-wide Script Generator",
    script_desc: 'Send a real <kbd>&#9166;</kbd> in any desktop app. Each snippet updates live to match your interval and repeat mode. Pick your platform:',
    tabs_aria: "Target platform",
    copy_terminal: "Copy Terminal command",
    copy_script: "Copy script",
    secondary_heading: "AppleScript &mdash; for the Script Editor app only (do NOT paste this into Terminal)",
    copy_applescript: "Copy AppleScript",
    footer_text: "Browser sandboxes cannot press keys in other apps — use the scripts above for system-wide automation, or run <strong>bridge.py</strong> so the Start button presses real keys on this PC: Windows needs no permission, Linux (X11) just needs <code>xdotool</code>, and macOS requires <strong>Accessibility permission</strong> (System Settings → Privacy &amp; Security → Accessibility) for the app running the bridge, or the keys are silently dropped. Settings are saved locally in your browser.",

    bridge_connected: "Bridge: connected",
    bridge_offline: "Bridge: offline",
    bridge_pressing: "Bridge: pressing",
    start_bridge: "Start bridge",
    stop_bridge: "Stop bridge",
    bridge_stopped: "Bridge stopped — real pressing is unavailable until it starts again",
    start_bridge_title: "For Windows, macOS and Linux — a toggle: when the bridge is offline this starts it silently (no window; the green badge is the sign); online, clicking stops the helper. Register first: Windows — run the bridge once; macOS — run enable-bridge-launch-mac.command once (allow the browser to open Enter Key Clicker Bridge when asked); Linux — run enable-bridge-launch-linux.sh once.",
    bridge_launching_toast: "Launching the bridge — if the browser asks, allow opening Enter Key Clicker Bridge",
    bridge_started_toast: "Bridge is online again — real pressing is available",
    bridge_failed_toast: "Bridge did not come online — if the browser asked to open Enter Key Clicker Bridge, press Allow; if not, allow it in the site's External-handlers permission, run {script}, then click Start bridge again",
    status_idle: "Idle",
    status_local: "Running (local)",
    status_real: "Running (real keys)",
    start: "Start",
    stop: "Stop",
    start_aria: "Start pressing Enter",
    stop_aria: "Stop pressing Enter",
    mode_infinite: "running infinitely",
    mode_custom: "stopping after {n} presses",
    started_local: "Started (local simulation) — interval <strong>{n}s</strong>, {mode}",
    started_real: "Started (REAL keys via bridge) — interval <strong>{n}s</strong>, {mode}",
    finished_log: "Finished — <strong>{n}</strong> presses completed",
    finished_toast: "Done — {n} presses completed",
    stopped_local: "Stopped — reset the countdown or press Start to resume",
    stopped_real: "Stopped — real pressing ended",
    reset_log: "Reset — counters cleared, log emptied",
    reset_toast: "Reset complete",
    log_cleared: "Event log cleared",
    press_local: "Press <strong>#{n}</strong> — {seq} dispatched to test target",
    press_bridge: "Press <strong>#{n}</strong> — {seq} (real events via bridge) sent to the frontmost app",
    bridge_lost_log: "Bridge connection lost — helper (bridge.py) is not reachable",
    bridge_offline_toast: "Bridge offline — run: python3 bridge.py",
    bridge_rejected_log: "Bridge rejected start — falling back to local simulation",
    real_toast: "Real pressing started — focus the target app",
    aim_toast: "Aim anywhere on the PC screen and left-click to set the target (Esc cancels)",
    inpage_toast: "Bridge not available — aim on this page; capture in {n}s · left-click to capture now · Esc cancels",
    aiming_reticle: "{n}…",
    aim_cancel_toast: "Picking cancelled — list unchanged",
    target_added_toast: "Target #{n} added — ({x}, {y}) (global screen coordinates)",
    target_added_page_toast: "Target #{n} added — ({x}, {y}) (page coordinates)",
    reset_targets_toast: "List cleared — presses will only Tab → Enter until you add targets",
    targets_count: "{n} target(s)",
    targets_empty: "No targets — presses will only Tab → Enter",
    list_full_toast: "List is full ({n} targets max) — remove a target first",
    pick_nobridge_toast: "Bridge offline — aim and left-click on this page to add the target",
    seq_prefix: "Sequence per press",
    seq_click: "Click",
    seq_tab: "Tab",
    seq_enter: "Enter",
    primary_mac: "Option 1 — paste this whole block into Terminal, then press Enter",
    primary_windows: "Paste this into a PowerShell window",
    primary_linux: "Paste this into a Terminal/shell window",
    cmd_copied: "Terminal command copied",
    script_copied: "{label} copied to clipboard",
    applescript_copied: "AppleScript copied — open Script Editor and paste",
    copy_failed: "Copy failed — select the code manually",
    label_applescript: "AppleScript",
    label_powershell: "PowerShell script",
    label_bash: "bash script",
    note_mac: "Accessibility permission REQUIRED — Enable: `open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"` → + → add Terminal (GUI only; tccutil cannot grant). Disable: `sudo tccutil reset Accessibility` (revokes for all apps). Then paste the whole block into Terminal and press Enter — presses go to the frontmost app while it runs (Ctrl+C stops). Option 2 is for Script Editor only.",
    note_windows: "Accessibility permission: NOT required — SendKeys works out of the box (only run PowerShell as administrator if the target app is elevated, else presses are blocked by UIPI). If synthetic keys get skipped, turn off the Filter Keys accessibility feature: Settings → Accessibility → Keyboard → Filter Keys. Paste this into a PowerShell window — presses go to the frontmost app while it runs (Ctrl+C stops).",
    note_linux: "Accessibility permission: NOT required on X11 — xdotool works out of the box (`sudo apt install xdotool`). Wayland (ydotool): Enable: `sudo usermod -aG input $USER` (log out/in) + `sudo systemctl enable --now ydotoold`. Disable: `sudo gpasswd -d $USER input` + `sudo systemctl disable --now ydotoold`. Paste into a shell — presses go to the frontmost app while it runs (Ctrl+C stops).",
  },

  /* ---- မြန်မာ (Myanmar) ---- */
  my: {
    tagline: 'အလိုအလျောက် <kbd>&#9166;</kbd> နှိပ်မှု စမ်းသပ်ကိရိယာနှင့် macOS script ဖန်တီးစနစ်',
    theme_title: "Theme ပြောင်းလဲရန်",
    theme_aria: "အလင်း/အမှောင် theme ပြောင်းလဲရန်",
    lang_aria: "ဘာသာစကား",
    stepper_aria: "အချိန်ကာလ လျင်မြန်စွာ ချိန်ညှိရန်",
    chip_m1: "အချိန်ကာလကို ၁ စက္ကန့် လျှော့ရန်",
    chip_p1: "အချိန်ကာလကို ၁ စက္ကန့် တိုးရန်",
    chip_p10: "အချိန်ကာလကို ၁၀ စက္ကန့် တိုးရန်",
    chip_p60: "အချိန်ကာလကို ၆၀ စက္ကန့် တိုးရန်",
    controls: "ထိန်းချုပ်မှုများ",
    bridge_badge_title: "Start ခလုတ်သည် ရှေ့တန်း app တွင် စစ်မှန်သော Enter နှိပ်နိုင်ရန် ဖိုလ်ဒါအတွင်း `python3 bridge.py` ကို လည်ပတ်ပါ (macOS တွင် start-bridge.command၊ Windows တွင် start-bridge.bat ကို နှစ်ချက်နှိပ်၍ ဖွင့်ပါ)။ Windows တွင် ခွင့်ပြုချက် မလိုပါ။ macOS တွင် ခွင့်ပြုရမည် — System Settings → Privacy & Security → Accessibility → bridge လည်ပတ်နေသော app ကို ထည့်ပါ။",
    until_next: "နောက်တစ်ကြိမ် နှိပ်ရန် ကျန်ချိန်",
    interval_label: "အချိန်ကာလ (စက္ကန့်၊ ၁၀–၉၉၉၉)",
    interval_error: "အချိန်ကာလသည် စက္ကန့် ၁၀ မှ ၉၉၉၉ အတွင်း ရှိရမည်။",
    seq_legend: "နှိပ်မှုအစဉ်",
    click_title: "Enter မနှိပ်မှီ မောက်စ်ဘယ်ဘက်နှိပ်မှု",
    click_hint: "Step တစ်ခုစီမတိုင်မီ ပန်းတိုင် screen ညွှန်းကိန်းတွင် ဘယ်ဘက်နှိပ်သည်",
    tab_title: "Enter မနှိပ်မှီ Tab နှိပ်သည်",
    tab_hint: "Enter တစ်ကြိမ်စီမတိုင်မီ focus ကို နောက် field သို့ ရွှေ့သည်",
    targets_label: "နှိပ်မည့်ပန်းတိုင်များ",
    targets_hint: 'စံကာလ စောင့်ပြီးမှ ပတ်လမ်းတစ်ခု၏ အဆုံးပိုင်းတွင် list တစ်ခုလုံးကို 0.2 စက္ကန့်စီဖြင့် အစီအစဉ်တကျ (ပြန်လည်လည်ပတ်၍) နှိပ်သည် — <strong>click &rarr; tab &rarr; enter</strong>။ စံကာလတစ်ပတ်သည် interval + ပန်းတိုင်တစ်ခုလျှင် 0.2 စက္ကန့် ဖြစ်သည် (၂ ခု၊ 10s interval &rarr; 10.0s နှင့် 10.2s တွင် နှိပ်)။ <strong>Pick</strong> ဖြင့် ပန်းတိုင် အသစ် ထည့်သည် (အများဆုံး ၂၀)။ <strong>Reset list</strong> ဖြင့် အားလုံးကို ရှင်းလင်းပြီး ပန်းတိုင်အသစ် ထပ်ထည့်မချင်း လစ်လုပ်သည်။',
    pick_title: "List သို့ ပန်းတိုင် အသစ် ထည့်သည် — Bridge လည်ပတ်နေပါက PC မျက်နှာပြင်တစ်ခုလုံး မှောင်၍ crosshair ပြသည် — မျက်နှာပြင်ရှိ မည်နေရာမဆို နှိပ်၍ ထည့်ပါ (ပယ်ဖျက်ရန် Esc)။ Bridge မရှိလျှင် စာမျက်နှာအတွင်း reticle ဖြင့် ခဏစောင့်ပြီး နေရာဖမ်းယူသည်။",
    add_target: "ပန်းတိုင် ကိုယ်တိုင် ထည့်ရန်",
    reset_targets: "List ပြန်ညှိ",
    target_remove_aria: "ဤပန်းတိုင်ကို ဖယ်ရှားရန်",
    targets_error: "ညွှန်းကိန်းအားလုံးသည် ၀ မှ ၉၉၉၉၉ အတွင်း ကိန်းပြည့်များ ဖြစ်ရမည်။",
    repeat_legend: "ထပ်ခါထပ်ခါ လုပ်ပုံစံ",
    inf_title: "အဆုံးမရှိ လုပ်ဆောင်သည်",
    inf_hint: "ရပ်တည်မည့်အချိန်အထိ ဆက်တိုက်နှိပ်သည်",
    custom_title: "သတ်မှတ်အကြိမ်ရေအထိ လုပ်ပြီး ရပ်သည်",
    custom_hint: "သတ်မှတ်အကြိမ်ရေ (၁–၉၉၉၉) အထိ နှိပ်သည်",
    count_label: "နှိပ်မည့်အကြိမ်ရေ",
    count_error: "အကြိမ်ရေသည် ၁ မှ ၉၉၉၉ အတွင်း ရှိရမည်။",
    reset: "ပြန်ညှိ",
    shortcut_hint: "<kbd>Space</kbd> / <kbd>Esc</kbd> ဖြင့် ပွင့်ပိတ်နိုင်သည်",
    stats_cycle: "ဤအလုပ်အတွင်း နှိပ်မှုအရေအတွက်",
    stats_status: "အခြေအနေ",
    target_heading: "စမ်းသပ်ရန်နေရာ",
    total_label: "စုစုပေါင်း နှိပ်မှုအရေအတွက်",
    target_label: "ပန်းတိုင် field",
    target_ph: "ဤနေရာတွင် focus ထားပါ — ဖြစ်ပေါ်သော Enter တိုင်း ဤကွက်တွင် ရောက်သည်",
    sound_label: "နှိပ်သံ (Web Audio)",
    log_heading: "မှတ်တမ်း",
    clear_log: "ရှင်းလင်း",
    log_aria: "Enter နှိပ်မှုမှတ်တမ်း",
    log_empty: "မှတ်တမ်း မရှိသေးပါ — Start နှိပ်၍ စတင်ပါ။",
    script_heading: "စနစ်တစ်ခုလုံး script ဖန်တီးပေးမှု",
    script_desc: 'Desktop app များအတွင်း စစ်မှန်သော <kbd>&#9166;</kbd> ပို့နိုင်သည်။ Script များသည် သင့် အချိန်ကာလနှင့် repeat ပုံစံနှင့် ကိုက်အောင် ခလုတ်ဆင်သည်။ Platform ရွေးပါ:',
    tabs_aria: "ပန်းတိုင် platform",
    copy_terminal: "Terminal command ကူးယူ",
    copy_script: "Script ကူးယူ",
    secondary_heading: "AppleScript — Script Editor app အတွက်သာ (Terminal တွင် မထည့်ပါနှင့်)",
    copy_applescript: "AppleScript ကူးယူ",
    footer_text: "Browser sandbox သည် အခြား app များတွင် ခလုတ်များ နှိပ်မပေးနိုင်ပါ — စနစ်တစ်ခုလုံး အလိုအလျောက် လုပ်ဆောင်ရန် အထက်ပါ script များကို အသုံးပြုပါ (သို့) ဒီ PC တွင် စစ်မှန်သော ခလုတ်များ နှိပ်စေရန် <strong>bridge.py</strong> ကို လည်ပတ်ပါ- Windows တွင် ခွင့်ပြုချက် မလိုပါ၊ Linux (X11) တွင် <code>xdotool</code> လိုသည်၊ macOS တွင် bridge လည်ပတ်သော app အတွက် <strong>Accessibility ခွင့်ပြုချက်</strong> လိုအပ်သည် (System Settings → Privacy &amp; Security → Accessibility)၊ မရှိလျှင် ခလုတ်များ တိတ်တဆိတ် ပယ်ခံရသည်။ ဆက်တင်များကို browser အတွင်း သိမ်းဆည်းသည်။",

    bridge_connected: "Bridge: ချိတ်ဆက်ထားသည်",
    bridge_offline: "Bridge: အလုပ်မလုပ်ပါ",
    bridge_pressing: "Bridge: နှိပ်နေသည်",
    start_bridge: "ဘရစ်ဇ် စတင်ရန်",
    stop_bridge: "ဘရစ်ဇ် ရပ်ရန်",
    bridge_stopped: "ဘရစ်ဇ် ရပ်ပြီး — နောက်တစ်ကြိမ် စတင်သည့်အထိ စစ်မှန်ခလုတ်များ မနှိပ်နိုင်ပါ",
    start_bridge_title: "Windows, macOS နှင့် Linux အတွက် — toggle ခလုတ်- bridge အလုပ်မလုပ်လျှင် window မပါဘဲ တိတ်တဆိတ် စတင်သည် (အစိမ်းရောင် badge က ချိတ်ဆက်ကြောင်း ပြသည်)၊ လည်ပတ်နေလျှင် နှိပ်၍ ရပ်သည်။ အရင် မှတ်ပုံတင်ပါ- Windows — bridge တစ်ကြိမ် လည်ပတ်ရုံပါ။ macOS — enable-bridge-launch-mac.command ကို တစ်ကြိမ် လည်ပတ်ပါ (browser မေးလျှင် Enter Key Clicker Bridge ဖွင့်ခွင့် ပြုပါ)။ Linux — enable-bridge-launch-linux.sh ကို တစ်ကြိမ် လည်ပတ်ပါ။",
    bridge_launching_toast: "ဘရစ်ဇ် စတင်နေသည် — browser မေးလျှင် Enter Key Clicker Bridge ကို ဖွင့်ခွင့်ပြုပါ",
    bridge_started_toast: "ဘရစ်ဇ် ပြန်လည်ချိတ်ဆက်ပြီး — စစ်မှန်ခလုတ်များ နှိပ်နိုင်ပါပြီ",
    bridge_failed_toast: "ဘရစ်ဇ် မလာပါ — browser က Enter Key Clicker Bridge ဖွင့်ခွင့် မေးလျှင် Allow နှိပ်ပါ၊ မမေးလျှင် site ၏ External-handlers permission တွင် ခွင့်ပြုပါ၊ {script} ကို လည်ပတ်ပြီး Start bridge ကို ထပ်နှိပ်ပါ",
    status_idle: "အနားယူနေသည်",
    status_local: "လည်ပတ်နေသည် (စာမျက်နှာအတွင်း)",
    status_real: "လည်ပတ်နေသည် (စစ်မှန်ခလုတ်များ)",
    start: "စတင်",
    stop: "ရပ်တန့်",
    start_aria: "Enter နှိပ်မှု စတင်ရန်",
    stop_aria: "Enter နှိပ်မှု ရပ်တန့်ရန်",
    mode_infinite: "အဆုံးမရှိ လည်ပတ်နေသည်",
    mode_custom: "{n} ကြိမ် နှိပ်ပြီးလျှင် ရပ်သည်",
    started_local: "စတင်ခဲ့သည် (စာမျက်နှာအတွင်း စမ်းသပ်ချက်) — အချိန်ကာလ <strong>{n} စက္ကန့်</strong>၊ {mode}",
    started_real: "စတင်ခဲ့သည် (bridge မှတဆင့် စစ်မှန်ခလုတ်များ) — အချိန်ကာလ <strong>{n} စက္ကန့်</strong>၊ {mode}",
    finished_log: "ပြီးဆုံးပါပြီ — <strong>{n}</strong> ကြိမ် နှိပ်မှု ပြီးမြောက်",
    finished_toast: "ပြီးဆုံးပါပြီ — {n} ကြိမ် နှိပ်မှု ပြီးမြောက်",
    stopped_local: "ရပ်တန့်ပြီး — countdown ပြန်ညှိပါ (သို့) Start နှိပ်၍ ပြန်စတင်ပါ",
    stopped_real: "ရပ်တန့်ပြီး — စစ်မှန်နှိပ်မှု ပြီးဆုံးသည်",
    reset_log: "ပြန်ညှိခဲ့သည် — အရေအတွက်များ ရှင်းလင်းပြီး မှတ်တမ်း အလွတ်ဖြစ်သည်",
    reset_toast: "ပြန်ညှိမှု ပြီးစီးပါပြီ",
    log_cleared: "မှတ်တမ်း ရှင်းလင်းလိုက်သည်",
    press_local: "နှိပ်မှု <strong>#{n}</strong> — {seq} ကို စမ်းသပ်ရာနေရာသို့ ပို့ခဲ့သည်",
    press_bridge: "နှိပ်မှု <strong>#{n}</strong> — {seq} (bridge မှတဆင့် စစ်မှန်ဖြစ်ရပ်များ) ရှေ့တန်း app သို့ ပို့ခဲ့သည်",
    bridge_lost_log: "Bridge ချိတ်ဆက်မှု ပျက်ပြယ်သည် — helper (bridge.py) ကို ဆက်သွယ်မရပါ",
    bridge_offline_toast: "Bridge အလုပ်မလုပ်ပါ — python3 bridge.py ကို လည်ပတ်ပါ",
    bridge_rejected_log: "Bridge က စတင်ခြင်း ငြင်းပယ်ခဲ့သည် — စာမျက်နှာအတွင်း စမ်းသပ်မှုသို့ ပြန်ကူးသည်",
    real_toast: "စစ်မှန်နှိပ်မှု စတင်ပါပြီ — ပန်းတိုင် app တွင် focus ထားပါ",
    aim_toast: "PC မျက်နှာပြင် မည်နေရာမဆို ပန်းတိုင်ထား၍ ဘယ်ဘက်နှိပ်ပါ (ပယ်ဖျက်ရန် Esc)",
    inpage_toast: "Bridge မရနိုင်ပါ — ဤစာမျက်နှာပေါ်တွင် ပန်းတိုင်ထားပါ။ {n} စက္ကန့်တွင် ဖမ်းယူသည် · ချက်ချင်းဖမ်းရန် ဘယ်ဘက်နှိပ်ပါ · ပယ်ဖျက်ရန် Esc",
    aiming_reticle: "{n}…",
    aim_cancel_toast: "Picking ပယ်ဖျက်လိုက်သည် — list မပြောင်းလဲပါ",
    target_added_toast: "ပန်းတိုင် #{n} ထည့်ပြီး — ({x}, {y}) (မျက်နှာပြင်တစ်ခုလုံးညွှန်းကိန်း)",
    target_added_page_toast: "ပန်းတိုင် #{n} ထည့်ပြီး — ({x}, {y}) (စာမျက်နှာညွှန်းကိန်း)",
    reset_targets_toast: "List ရှင်းလင်းပြီး — ပန်းတိုင် ထပ်ထည့်သည့်အထိ Tab → Enter သာ နှိပ်သည်",
    targets_count: "ပန်းတိုင် {n} ခု",
    targets_empty: "ပန်းတိုင် မရှိပါ — Tab → Enter သာ နှိပ်သည်",
    list_full_toast: "List ပြည့်နေပါပြီ ({n} ခု အများဆုံး) — ပန်းတိုင်တစ်ခု ဖယ်ရှားပါ",
    pick_nobridge_toast: "Bridge အလုပ်မလုပ်ပါ — ဤစာမျက်နှာပေါ်တွင် ပန်းတိုင်ထား၍ ဘယ်ဘက်နှိပ်ပါ",
    seq_prefix: "Press တစ်ကြိမ်လျှင် အစဉ်",
    seq_click: "Click",
    seq_tab: "Tab",
    seq_enter: "Enter",
    primary_mac: "Option ၁ — code block တစ်ခုလုံးကို Terminal တွင် ထည့်၍ Enter နှိပ်ပါ",
    primary_windows: "PowerShell window တွင် ထည့်ပါ",
    primary_linux: "Terminal/shell window တွင် ထည့်ပါ",
    cmd_copied: "Terminal command ကူးယူပြီး",
    script_copied: "{label} ကို clipboard သို့ ကူးယူပြီး",
    applescript_copied: "AppleScript ကူးယူပြီး — Script Editor ဖွင့်၍ ထည့်ပါ",
    copy_failed: "ကူးယူမှု မအောင်မြင်ပါ — code ကို ကိုယ်တိုင် ရွေးချယ်ပါ",
    label_applescript: "AppleScript",
    label_powershell: "PowerShell script",
    label_bash: "bash script",
    note_mac: "Accessibility ခွင့်ပြုချက် လိုအပ်သည် — ဖွင့်ရန်: `open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"` → + → Terminal ထည့်ပါ (GUI သာလျှင်; tccutil မှ ခွင့်ပြုမရ)။ ပယ်ဖျက်ရန်: `sudo tccutil reset Accessibility` (app အားလုံးကို ပြန်ရုပ်သတ်သည်)။ ပြီးလျှင် code block တစ်ခုလုံးကို Terminal တွင် ထည့်၍ Enter နှိပ်ပါ — လည်ပတ်နေစဉ် ရှေ့တန်း app သို့ နှိပ်မှုများ ရောက်သည် (Ctrl+C ဖြင့် ရပ်)။ Option ၂ သည် Script Editor အတွက်သာ။",
    note_windows: "Accessibility ခွင့်ပြုချက် မလိုအပ်ပါ — SendKeys သည် ပုံသွင်းအတိုင်း လုပ်ဆောင်နိုင်သည် (ပန်းတိုင် app သည် administrator ဖြစ်လျှင် PowerShell ကိုလည်း administrator အဖြစ် လည်ပတ်ရမည်; မဟုတ်က UIPI သည် တားမြစ်သည်)။ ခလုတ်များ ကျော်လွှားခံရပါက Filter Keys feature ကို ပိတ်ပါ — Settings → Accessibility → Keyboard → Filter Keys။ PowerShell window တွင် ထည့်ပါ — လည်ပတ်နေစဉ် ရှေ့တန်း app သို့ နှိပ်မှုများ ရောက်သည် (Ctrl+C ဖြင့် ရပ်)။",
    note_linux: "X11 တွင် Accessibility ခွင့်ပြုချက် မလိုအပ်ပါ — xdotool သည် ပုံသွင်းအတိုင်း လုပ်ဆောင်နိုင်သည် (`sudo apt install xdotool`)။ Wayland (ydotool) — ဖွင့်ရန်: `sudo usermod -aG input $USER` (ထွက်ပြီး ပြန်ဝင်) + `sudo systemctl enable --now ydotoold`။ ပိတ်ရန်: `sudo gpasswd -d $USER input` + `sudo systemctl disable --now ydotoold`။ Shell တွင် ထည့်ပါ — လည်ပတ်နေစဉ် ရှေ့တန်း app သို့ နှိပ်မှုများ ရောက်သည် (Ctrl+C ဖြင့် ရပ်)။",
  },

  /* ---- 中文 (Chinese) ---- */
  zh: {
    tagline: '自动 <kbd>&#9166;</kbd> 按键模拟器与 macOS 脚本生成器',
    theme_title: "切换主题",
    theme_aria: "切换浅色/深色主题",
    lang_aria: "语言",
    stepper_aria: "快速调整间隔",
    chip_m1: "将间隔减少 1 秒",
    chip_p1: "将间隔增加 1 秒",
    chip_p10: "将间隔增加 10 秒",
    chip_p60: "将间隔增加 60 秒",
    controls: "控制",
    bridge_badge_title: "在本文件夹中运行 `python3 bridge.py`（macOS 双击 start-bridge.command，Windows 双击 start-bridge.bat），“Start”按钮才能向前台应用发送真实的 Enter。Windows 无需权限；macOS 还需授权：系统设置 → 隐私与安全性 → 辅助功能 → 添加运行 bridge 的应用。",
    until_next: "距下一次按键",
    interval_label: "间隔（秒，10–9999）",
    interval_error: "间隔必须在 10 到 9999 秒之间。",
    seq_legend: "按键流程",
    click_title: "先点击鼠标左键",
    click_hint: "每个步骤前，先在该步骤的目标屏幕坐标处执行左键点击",
    tab_title: "Enter 前先按 Tab",
    tab_hint: "每次按 Enter 前，先将焦点移到下一个字段",
    targets_label: "按键目标",
    targets_hint: '每个周期先等待间隔时间，再在周期末尾将整个列表连续执行一遍，各项间隔 0.2 秒，循环往复：<strong>点击 &rarr; Tab &rarr; Enter</strong>。一个完整周期为间隔 + 每个目标 0.2 秒（2 个目标、10s 间隔 &rarr; 按键落在 10.0s 和 10.2s）。<strong>Pick</strong> 添加目标（最多 20 个）；<strong>重置列表</strong>会清空全部，直到重新添加目标。',
    pick_title: "向列表添加新目标：bridge 运行时会让整个电脑屏幕变暗并显示跟随光标的十字准线 — 在屏幕任意位置左键单击即可添加目标（Esc 取消）。没有 bridge 时，页面内的准线会在短暂倒计时后捕获光标位置。",
    add_target: "手动添加目标",
    reset_targets: "重置列表",
    target_remove_aria: "移除此目标",
    targets_error: "所有坐标必须是 0 到 99999 之间的整数。",
    repeat_legend: "重复模式",
    inf_title: "无限运行",
    inf_hint: "一直按键，直到手动停止",
    custom_title: "按指定次数后停止",
    custom_hint: "运行固定的按键次数（1–9999）",
    count_label: "按键次数",
    count_error: "次数必须在 1 到 9999 之间。",
    reset: "重置",
    shortcut_hint: "按 <kbd>Space</kbd> / <kbd>Esc</kbd> 切换",
    stats_cycle: "本次运行按键数",
    stats_status: "状态",
    target_heading: "测试目标",
    total_label: "总按键数",
    target_label: "目标输入框",
    target_ph: "在此输入框保持焦点 — 每次模拟 Enter 都会作用于这里",
    sound_label: "按键音（Web Audio）",
    log_heading: "事件日志",
    clear_log: "清空",
    log_aria: "模拟 Enter 按键日志",
    log_empty: "暂无按键记录 — 按 Start 开始。",
    script_heading: "系统级脚本生成器",
    script_desc: '向任意桌面应用发送真实的 <kbd>&#9166;</kbd>。脚本会根据间隔和重复模式实时更新。选择平台：',
    tabs_aria: "目标平台",
    copy_terminal: "复制终端命令",
    copy_script: "复制脚本",
    secondary_heading: "AppleScript — 仅用于脚本编辑器（请勿粘贴到终端）",
    copy_applescript: "复制 AppleScript",
    footer_text: "浏览器沙盒无法在其他应用中按键 — 系统级按键请使用上方脚本，或运行 <strong>bridge.py</strong> 让“Start”按钮在这台电脑上发送真实按键：Windows 无需权限，Linux (X11) 只需 <code>xdotool</code>，macOS 需要运行 bridge 的应用具有<strong>辅助功能权限</strong>（系统设置 → 隐私与安全性 → 辅助功能），否则按键会被静默丢弃。设置保存在浏览器本地。",

    bridge_connected: "Bridge：已连接",
    bridge_offline: "Bridge：离线",
    bridge_pressing: "Bridge：按键中",
    stop_bridge: "停止 Bridge",
    bridge_stopped: "Bridge 已停止 — 重新启动前无法发送真实按键",
    start_bridge: "启动 Bridge",
    start_bridge_title: "Windows、macOS 和 Linux — 开关按钮：bridge 未运行时点击会静默启动它，不显示任何窗口，旁边徽标变绿即表示成功；运行中时点击会停止 bridge。先注册：Windows — 运行一次 bridge；macOS — 运行一次 enable-bridge-launch-mac.command（浏览器询问时允许打开 Enter Key Clicker Bridge）；Linux — 运行一次 enable-bridge-launch-linux.sh。",
    bridge_launching_toast: "正在启动 bridge — 如浏览器弹出询问，请允许打开 Enter Key Clicker Bridge",
    bridge_started_toast: "Bridge 已恢复在线 — 可以发送真实按键",
    bridge_failed_toast: "Bridge 未上线 — 若浏览器询问是否打开 Enter Key Clicker Bridge 请按“允许”；若未询问，请在网站 External handlers 权限中允许，运行 {script} 后再点击“启动 Bridge”",
    status_idle: "空闲",
    status_local: "运行中（模拟）",
    status_real: "运行中（真实按键）",
    start: "开始",
    stop: "停止",
    start_aria: "开始按 Enter",
    stop_aria: "停止按 Enter",
    mode_infinite: "无限运行",
    mode_custom: "按 {n} 次后停止",
    started_local: "已开始（本地模拟）— 间隔 <strong>{n} 秒</strong>，{mode}",
    started_real: "已开始（经 bridge 发送真实按键）— 间隔 <strong>{n} 秒</strong>，{mode}",
    finished_log: "已完成 — <strong>{n}</strong> 次按键全部完成",
    finished_toast: "完成 — 共 {n} 次按键",
    stopped_local: "已停止 — 重置倒计时或按 Start 继续",
    stopped_real: "已停止 — 真实按键结束",
    reset_log: "已重置 — 计数清零，日志已清空",
    reset_toast: "重置完成",
    log_cleared: "日志已清空",
    press_local: "第 <strong>#{n}</strong> 次按键 — {seq} 已发送到测试目标",
    press_bridge: "第 <strong>#{n}</strong> 次按键 — {seq}（经 bridge 发送的真实事件）已发送到前台应用",
    bridge_lost_log: "Bridge 连接丢失 — 辅助程序（bridge.py）不可达",
    bridge_offline_toast: "Bridge 离线 — 请运行：python3 bridge.py",
    bridge_rejected_log: "Bridge 拒绝启动 — 回退到本地模拟",
    real_toast: "真实按键已开始 — 请聚焦目标应用",
    aim_toast: "在 PC 屏幕任意位置移动光标并左键单击以设定目标（Esc 取消）",
    inpage_toast: "Bridge 不可用 — 请在本页上瞄准；{n} 秒后捕获 · 左键单击立即捕获 · Esc 取消",
    aiming_reticle: "{n}…",
    aim_cancel_toast: "已取消选取 — 列表未更改",
    target_added_toast: "已添加目标 #{n} — ({x}, {y})（全屏坐标）",
    target_added_page_toast: "已添加目标 #{n} — ({x}, {y})（页面坐标）",
    reset_targets_toast: "列表已清空 — 添加目标前按键将只执行 Tab → Enter",
    targets_count: "共 {n} 个目标",
    targets_empty: "无目标 — 按键将只执行 Tab → Enter",
    list_full_toast: "列表已满（最多 {n} 个）— 请先移除一个目标",
    pick_nobridge_toast: "Bridge 离线 — 请在本页上瞄准并左键单击以添加目标",
    seq_prefix: "每次按键的流程",
    seq_click: "点击",
    seq_tab: "Tab",
    seq_enter: "Enter",
    primary_mac: "选项 1 — 将整个代码块粘贴到终端，然后按回车",
    primary_windows: "将此粘贴到 PowerShell 窗口",
    primary_linux: "将此粘贴到终端/shell 窗口",
    cmd_copied: "终端命令已复制",
    script_copied: "{label} 已复制到剪贴板",
    applescript_copied: "AppleScript 已复制 — 请打开脚本编辑器并粘贴",
    copy_failed: "复制失败 — 请手动选择代码",
    label_applescript: "AppleScript",
    label_powershell: "PowerShell 脚本",
    label_bash: "bash 脚本",
    note_mac: "需要辅助功能权限 — 启用：`open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"` → + → 添加 Terminal（仅限 GUI；tccutil 无法授权）。停用：`sudo tccutil reset Accessibility`（会撤销全部应用）。然后将整个代码块粘贴到终端并按回车 — 运行期间按键发送到前台应用（Ctrl+C 停止）。选项 2 仅用于脚本编辑器。",
    note_windows: "无需辅助功能权限 — SendKeys 开箱即用（若目标应用以管理员运行，也需以管理员运行 PowerShell，否则按键被 UIPI 拦截）。若按键被跳过，请关闭筛选键功能：设置 → 辅助功能 → 键盘 → 筛选键。粘贴到 PowerShell 窗口 — 运行期间按键发送到前台应用（Ctrl+C 停止）。",
    note_linux: "X11 下无需辅助功能权限 — xdotool 开箱即用（`sudo apt install xdotool`）。Wayland（ydotool）：启用：`sudo usermod -aG input $USER`（退出重新登录）+ `sudo systemctl enable --now ydotoold`。停用：`sudo gpasswd -d $USER input` + `sudo systemctl disable --now ydotoold`。粘贴到 shell — 运行期间按键发送到前台应用（Ctrl+C 停止）。",
  },

  /* ---- 한국어 (Korean) ---- */
  ko: {
    tagline: '자동 <kbd>&#9166;</kbd> 키 입력 시뮬레이터 & macOS 스크립트 생성기',
    theme_title: "테마 전환",
    theme_aria: "라이트/다크 테마 전환",
    lang_aria: "언어",
    stepper_aria: "간격 빠른 조정",
    chip_m1: "간격 1초 감소",
    chip_p1: "간격 1초 증가",
    chip_p10: "간격 10초 증가",
    chip_p60: "간격 60초 증가",
    controls: "컨트롤",
    bridge_badge_title: "Start 버튼이 포그라운드 앱에 실제 Enter를 입력하려면 이 폴더에서 `python3 bridge.py`를 실행하세요(macOS는 start-bridge.command, Windows는 start-bridge.bat 더블클릭). Windows에는 권한이 필요 없고, macOS에서는 필요합니다: 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용 → bridge를 실행하는 앱 추가.",
    until_next: "다음 입력까지",
    interval_label: "간격(초, 10–9999)",
    interval_error: "간격은 10초에서 9999초 사이여야 합니다.",
    seq_legend: "입력 순서",
    click_title: "Enter 전에 마우스 왼쪽 클릭",
    click_hint: "각 단계 전 해당 단계의 대상 화면 좌표에서 왼쪽 클릭을 수행합니다",
    tab_title: "Enter 전에 Tab 누르기",
    tab_hint: "Enter를 누르기 전에 포커스를 다음 필드로 이동합니다",
    targets_label: "입력 대상 목록",
    targets_hint: '각 주기는 간격만큼 먼저 기다린 뒤 주기 끝에서 목록 전체를 0.2초 간격으로 순서대로 실행합니다(반복): <strong>클릭 &rarr; Tab &rarr; Enter</strong>. 하나의 전체 주기는 간격 + 항목당 0.2초입니다(대상 2개, 간격 10s &rarr; 10.0s 및 10.2s에 눌림). <strong>Pick</strong>은 대상을 추가하고(최대 20개), <strong>목록 초기화</strong>는 새 대상을 추가하기 전까지 모두 비웁니다.',
    pick_title: "목록에 새 대상을 추가합니다: bridge가 실행 중이면 PC 화면 전체가 어두워지고 커서를 따르는 십자선이 표시됩니다 — 화면 아무 곳이나 왼쪽 클릭하여 대상을 추가하세요(Esc로 취소). bridge가 없으면 페이지 내 십자선이 잠시 카운트다운 후 커서 위치를 캡처합니다.",
    add_target: "대상 직접 추가",
    reset_targets: "목록 초기화",
    target_remove_aria: "이 대상 제거",
    targets_error: "모든 좌표는 0에서 99999 사이의 정수여야 합니다.",
    repeat_legend: "반복 모드",
    inf_title: "무한 실행",
    inf_hint: "중지할 때까지 계속 입력합니다",
    custom_title: "지정 횟수 후 중지",
    custom_hint: "지정한 횟수(1–9999)만큼 입력합니다",
    count_label: "입력 횟수",
    count_error: "횟수는 1에서 9999 사이여야 합니다.",
    reset: "초기화",
    shortcut_hint: "<kbd>Space</kbd> / <kbd>Esc</kbd>로 전환",
    stats_cycle: "이번 실행 입력 수",
    stats_status: "상태",
    target_heading: "테스트 대상",
    total_label: "총 입력 수",
    target_label: "대상 필드",
    target_ph: "여기에 포커스를 두세요 — 시뮬레이트된 Enter가 이 필드로 전달됩니다",
    sound_label: "클릭 사운드(Web Audio)",
    log_heading: "이벤트 로그",
    clear_log: "지우기",
    log_aria: "시뮬레이트된 Enter 입력 로그",
    log_empty: "기록이 없습니다 — Start를 누르세요.",
    script_heading: "시스템 전체 스크립트 생성기",
    script_desc: '어떤 데스크톱 앱에든 실제 <kbd>&#9166;</kbd>를 보냅니다. 스크립트는 간격과 반복 설정에 맞춰 실시간으로 갱신됩니다. 플랫폼을 선택하세요:',
    tabs_aria: "대상 플랫폼",
    copy_terminal: "터미널 명령 복사",
    copy_script: "스크립트 복사",
    secondary_heading: "AppleScript — 스크립트 편집기 전용(터미널에 붙여넣지 마세요)",
    copy_applescript: "AppleScript 복사",
    footer_text: "브라우저 샌드박스는 다른 앱에 키를 보낼 수 없습니다 — 시스템 전체 입력에는 위의 스크립트를 사용하거나, <strong>bridge.py</strong>를 실행하여 Start 버튼이 이 PC에서 실제 키를 누르게 하세요: Windows는 권한이 필요 없고, Linux(X11)는 <code>xdotool</code>만 있으면 되며, macOS는 bridge를 실행하는 앱에 <strong>손쉬운 사용 권한</strong>이 필요합니다(시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용). 권한이 없으면 키 조작이 조용히 무시됩니다. 설정은 브라우저에 로컬로 저장됩니다.",

    bridge_connected: "Bridge: 연결됨",
    bridge_offline: "Bridge: 오프라인",
    bridge_pressing: "Bridge: 입력 중",
    stop_bridge: "브리지 중지",
    bridge_stopped: "브리지가 중지되었습니다 — 다시 시작할 때까지 실제 키 입력을 사용할 수 없습니다",
    start_bridge: "브리지 시작",
    start_bridge_title: "Windows, macOS, Linux — 토글 버튼: bridge가 꺼져 있을 때 클릭하면 창 없이 조용히 시작되고(배지가 초록색으로 바뀌면 성공), 실행 중일 때 클릭하면 bridge가 중지됩니다. 먼저 등록하세요: Windows — bridge를 한 번 실행; macOS — enable-bridge-launch-mac.command를 한 번 실행(브라우저가 묻으면 Enter Key Clicker Bridge 열기를 허용); Linux — enable-bridge-launch-linux.sh를 한 번 실행.",
    bridge_launching_toast: "브리지를 시작하는 중 — 브라우저가 묻는다면 Enter Key Clicker Bridge 열기를 허용하세요",
    bridge_started_toast: "브리지가 다시 온라인 상태입니다 — 실제 키 입력이 가능합니다",
    bridge_failed_toast: "브리지가 온라인이 되지 않았습니다 — 브라우저가 Enter Key Clicker Bridge 열기를 물으면 허용을 누르세요. 묻지 않으면 사이트의 External handlers 권한에서 허용하고 {script}를 실행한 뒤 '브리지 시작'을 다시 누르세요",
    status_idle: "대기 중",
    status_local: "실행 중(페이지 내)",
    status_real: "실행 중(실제 키)",
    start: "시작",
    stop: "정지",
    start_aria: "Enter 입력 시작",
    stop_aria: "Enter 입력 정지",
    mode_infinite: "무한 실행 중",
    mode_custom: "{n}회 입력 후 중지",
    started_local: "시작됨(페이지 내 시뮬레이션) — 간격 <strong>{n}초</strong>, {mode}",
    started_real: "시작됨(bridge를 통한 실제 키) — 간격 <strong>{n}초</strong>, {mode}",
    finished_log: "완료 — <strong>{n}</strong>회 입력 완료",
    finished_toast: "완료 — {n}회 입력 완료",
    stopped_local: "중지됨 — 카운트다운을 초기화하거나 Start를 눌러 재개하세요",
    stopped_real: "중지됨 — 실제 입력이 종료되었습니다",
    reset_log: "초기화됨 — 카운터가 지워지고 로그가 비워졌습니다",
    reset_toast: "초기화 완료",
    log_cleared: "이벤트 로그가 지워졌습니다",
    press_local: "입력 <strong>#{n}</strong> — {seq} → 테스트 대상으로 전송됨",
    press_bridge: "입력 <strong>#{n}</strong> — {seq} (bridge를 통한 실제 이벤트) → 포그라운드 앱으로 전송됨",
    bridge_lost_log: "Bridge 연결 끊김 — helper(bridge.py)에 연결할 수 없습니다",
    bridge_offline_toast: "Bridge 오프라인 — 실행: python3 bridge.py",
    bridge_rejected_log: "Bridge가 시작을 거부했습니다 — 페이지 내 시뮬레이션으로 전환합니다",
    real_toast: "실제 입력이 시작되었습니다 — 대상 앱에 포커스를 두세요",
    aim_toast: "PC 화면 어느 곳이든 조준하고 왼쪽 클릭하여 대상을 지정하세요(Esc로 취소)",
    inpage_toast: "Bridge를 사용할 수 없습니다 — 이 페이지에서 조준하세요. {n}초 후 캡처 · 왼쪽 클릭으로 즉시 캡처 · Esc로 취소",
    aiming_reticle: "{n}…",
    aim_cancel_toast: "선택이 취소되었습니다 — 목록은 변경되지 않았습니다",
    target_added_toast: "대상 #{n} 추가됨 — ({x}, {y}) (전체 화면 좌표)",
    target_added_page_toast: "대상 #{n} 추가됨 — ({x}, {y}) (페이지 좌표)",
    reset_targets_toast: "목록이 비워졌습니다 — 대상을 추가하기 전까지 입력은 Tab → Enter만 수행합니다",
    targets_count: "대상 {n}개",
    targets_empty: "대상 없음 — 입력은 Tab → Enter만 수행합니다",
    list_full_toast: "목록이 가득 찼습니다(최대 {n}개) — 먼저 대상을 제거하세요",
    pick_nobridge_toast: "Bridge 오프라인 — 이 페이지에서 조준하여 왼쪽 클릭으로 대상을 추가하세요",
    seq_prefix: "한 번의 입력 순서",
    seq_click: "클릭",
    seq_tab: "Tab",
    seq_enter: "Enter",
    primary_mac: "옵션 1 — 코드 블록 전체를 터미널에 붙여넣고 Enter를 누르세요",
    primary_windows: "PowerShell 창에 붙여넣으세요",
    primary_linux: "터미널/셸 창에 붙여넣으세요",
    cmd_copied: "터미널 명령이 복사되었습니다",
    script_copied: "{label}이(가) 클립보드에 복사되었습니다",
    applescript_copied: "AppleScript가 복사되었습니다 — 스크립트 편집기를 열어 붙여넣으세요",
    copy_failed: "복사 실패 — 코드를 직접 선택하세요",
    label_applescript: "AppleScript",
    label_powershell: "PowerShell 스크립트",
    label_bash: "bash 스크립트",
    note_mac: "손쉬운 사용 권한 필수 — 활성화: `open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"` → + → Terminal 추가(GUI만 가능; tccutil은 권한 부여 불가). 비활성화: `sudo tccutil reset Accessibility`(모든 앱이 해제됨). 그런 다음 코드 블록 전체를 터미널에 붙여넣고 Enter를 누르세요 — 실행 중 포그라운드 앱으로 입력됩니다(Ctrl+C로 중지). 옵션 2는 스크립트 편집기 전용입니다.",
    note_windows: "손쉬운 사용 권한 불필요 — SendKeys는 별도 설정 없이 동작합니다(대상 앱이 관리자 권한이면 PowerShell도 관리자로 실행해야 하며, 아니면 UIPI가 차단). 키가 건너뛰어지면 필터 키 기능을 끄세요: 설정 → 접근성 → 키보드 → 필터 키. PowerShell 창에 붙여넣으세요 — 실행 중 포그라운드 앱으로 입력됩니다(Ctrl+C로 중지).",
    note_linux: "X11에서는 손쉬운 사용 권한 불필요 — xdotool은 별도 설정 없이 동작합니다(`sudo apt install xdotool`). Wayland(ydotool): 활성화: `sudo usermod -aG input $USER`(로그아웃/로그인) + `sudo systemctl enable --now ydotoold`. 비활성화: `sudo gpasswd -d $USER input` + `sudo systemctl disable --now ydotoold`. 셸에 붙여넣으세요 — 실행 중 포그라운드 앱으로 입력됩니다(Ctrl+C로 중지).",
  },
};

const I18N_LANGS = Object.keys(I18N);

/** Translates a key in the current UI language, with {param} substitution. */
function t(key, params) {
  const pack = I18N[settings.lang] || I18N.en;
  let str = pack[key] !== undefined ? pack[key] : (I18N.en[key] !== undefined ? I18N.en[key] : key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return str;
}

/** Applies every [data-i18n*] element in the DOM for the current language
 *  and refreshes the state-dependent (dynamic) text. */
function applyLanguage() {
  const pack = I18N[settings.lang] || I18N.en;
  document.documentElement.lang =
    settings.lang === "zh" ? "zh-CN" : settings.lang;

  $$("[data-i18n]").forEach((node) => {
    node.innerHTML = t(node.dataset.i18n);
  });
  $$("[data-i18n-title]").forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });
  $$("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAria));
  });
  $$("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });

  // State-dependent labels (Start/Stop button, status, bridge badge).
  const running = session.running || bridge.active;
  el.startStopLabel.textContent = t(running ? "stop" : "start");
  el.startStopBtn.setAttribute("aria-label", t(running ? "stop_aria" : "start_aria"));
  if (session.statusKey && session.statusKey !== "status_idle") {
    el.statusText.textContent = t(session.statusKey);
  } else {
    el.statusText.textContent = t("status_idle");
  }
  el.bridgeBadge.textContent = t(bridge.badgeKey || "bridge_offline");
  updateStartBridgeBtn();
  updateScript();
}

/* --------------------------------------------------------------------------
 * Element references
 * ------------------------------------------------------------------------ */
const el = {
  themeToggle: $("#themeToggle"),
  langSelect: $("#langSelect"),
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
  tabToggle: $("#tabToggle"),
  clickXYError: $("#clickXYError"),
  targetList: $("#targetList"),
  addTargetBtn: $("#addTargetBtn"),
  resetTargetsBtn: $("#resetTargetsBtn"),
  pickBtn: $("#pickBtn"),
  aimOverlay: $("#aimOverlay"),
  aimLabel: $("#aimLabel"),
  keycap: $("#keycap"),
  targetForm: $("#targetForm"),
  targetInput: $("#targetInput"),
  soundToggle: $("#soundToggle"),
  bridgeBadge: $("#bridgeBadge"),
  startBridgeBtn: $("#startBridgeBtn"),
  startBridgeLabel: $("#startBridgeLabel"),
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
    merged.tabBeforeEnter = merged.tabBeforeEnter !== undefined ? Boolean(merged.tabBeforeEnter) : DEFAULT_SETTINGS.tabBeforeEnter;
    // Target list: no targets by default — only a saved clickTargets list
    // is honored; legacy clickX/clickY saves are ignored.
    merged.clickTargets = Array.isArray(parsed.clickTargets)
      ? parsed.clickTargets
          .map((p) => ({ x: clamp(toInt(p && p.x, 0), 0, XY_MAX), y: clamp(toInt(p && p.y, 0), 0, XY_MAX) }))
          .slice(0, MAX_TARGETS)
      : [];
    if (!["infinite", "custom"].includes(merged.repeatMode)) merged.repeatMode = DEFAULT_SETTINGS.repeatMode;
    if (!["mac", "windows", "linux"].includes(merged.platform)) merged.platform = DEFAULT_SETTINGS.platform;
    if (!I18N_LANGS.includes(merged.lang)) merged.lang = DEFAULT_SETTINGS.lang;
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
  stepTimers: [],    // timeouts of the current burst (one per list step)
  uiTimerId: null,
  pressedClassTimer: null,
  statusKey: "status_idle", // i18n key of the current status line
  statusClass: "is-idle",
};

/* Bridge run state — real system-wide presses delivered by bridge.py */
const bridge = {
  active: false,
  pollId: null,
  lastPresses: 0,
  startedAt: 0,
  badgeKey: "bridge_offline", // i18n key of the current badge label
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
  const periodMs = cyclePeriodMs();
  let remainingMs;

  if (bridge.active) {
    // Bridge timing: burst-to-burst period is cyclePeriodMs — mirror that.
    const elapsed = Date.now() - bridge.startedAt;
    const sincePress = elapsed % periodMs;
    remainingMs = sincePress === 0 ? periodMs : periodMs - sincePress;
  } else {
    remainingMs = Math.max(0, session.nextFireAt - performance.now());
  }

  // Tenths so a 10.4s cycle reads 10.4, not 11.
  const periodSec = periodMs / 1000;
  const remainingSec = clamp(Math.ceil(remainingMs / 100) / 10, 0, periodSec);
  const displayText = Number.isInteger(remainingSec) ? String(remainingSec) : remainingSec.toFixed(1);

  const isRunning = session.running || bridge.active;
  el.countdown.textContent = isRunning ? displayText : cycleIdleText();

  // Progress within the current cycle window (0 → 1), drives ring + bar.
  const fraction = isRunning ? 1 - remainingMs / periodMs : 0;
  const clampedFraction = clamp(fraction, 0, 1);

  el.countdownRing.style.setProperty("--progress", `${(clampedFraction * 360).toFixed(1)}deg`);
  el.progressFill.style.width = `${(clampedFraction * 100).toFixed(1)}%`;
}

function cycleIdleText() {
  const sec = cyclePeriodMs() / 1000;
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
}

function renderIdleCountdown() {
  el.countdown.textContent = cycleIdleText();
  el.countdownRing.style.setProperty("--progress", "0deg");
  el.progressFill.style.width = "0%";
}

/* --------------------------------------------------------------------------
 * Scheduling — drift-free via absolute target timestamps
 * Each cycle WAITS the interval first, then fires the WHOLE target list in
 * a burst (one step every STEP_DELAY_MS) at the end of the cycle: with a
 * 10s interval and a 2-entry list, presses land at 10.0s and 10.2s of each
 * 10.4s cycle. With the list empty, one plain Tab → Enter at the mark.
 * ------------------------------------------------------------------------ */
function cancelStepTimers() {
  session.stepTimers.forEach((id) => clearTimeout(id));
  session.stepTimers = [];
}

function cyclePeriodMs() {
  const entries = settings.clickTargets.length;
  return settings.interval * 1000 + (entries > 0 ? entries * STEP_DELAY_MS : 0);
}

/* List add/remove/reset changes the burst length, so the full cycle must
 * be re-anchored right away — while running the next burst moves, while
 * idle the countdown label re-renders. */
function rescheduleForCyclePeriod() {
  if (session.running) {
    clearTimeout(session.fireTimeoutId);
    session.nextFireAt = performance.now();
    runCycle();
  } else {
    renderIdleCountdown();
  }
}

function scheduleNextCycle() {
  const delayMs = Math.max(0, session.nextFireAt - performance.now());
  session.fireTimeoutId = setTimeout(onIntervalElapsed, delayMs);
}

function onIntervalElapsed() {
  if (!session.running) return;
  runCycle();
}

function runCycle() {
  cancelStepTimers();

  // Presses come after the interval wait — at the tail of each cycle.
  const steps = settings.clickTargets.length || 1;
  const burstStartMs = settings.interval * 1000;
  for (let i = 0; i < steps; i++) {
    session.stepTimers.push(setTimeout(() => fireStep(i), burstStartMs + i * STEP_DELAY_MS));
  }

  session.nextFireAt += cyclePeriodMs();
  scheduleNextCycle();
}

function fireStep(stepIndex) {
  if (!session.running) return;
  firePress(stepIndex);

  // Honour the custom count — the burst stops as soon as it is met.
  if (settings.repeatMode === "custom" && session.firedInCycle >= settings.repeatCount) {
    cancelStepTimers();
    stopRun("done");
  }
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

/** Describes the press sequence for one step (one target entry).
 *  With the list empty (or the click step off), pressing is Tab → Enter only. */
function clickStepEnabled() {
  return settings.clickBeforeEnter && settings.clickTargets.length > 0;
}

function stepSequence(x, y) {
  const parts = [];
  if (clickStepEnabled()) parts.push(`${t("seq_click")}(${x},${y})`);
  if (settings.tabBeforeEnter) parts.push(t("seq_tab"));
  parts.push(t("seq_enter"));
  return parts.join(" → ");
}

/** The list-level sequence description used in notes and logs. */
function sequenceParts() {
  return stepSequence(
    settings.clickTargets.length ? settings.clickTargets[0].x : 0,
    settings.clickTargets.length ? settings.clickTargets[0].y : 0
  );
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

/** Fires one burst step: click at the step's target, then Tab/Enter. */
function firePress(stepIndex) {
  const target = settings.clickTargets.length
    ? settings.clickTargets[stepIndex % settings.clickTargets.length]
    : null;
  session.presses += 1;
  session.firedInCycle += 1;

  // 1. Optional click at this step's target point.
  if (target && clickStepEnabled()) simulateClick(target.x, target.y);

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

  addLogEntry(t("press_local", {
    n: session.presses,
    seq: target ? stepSequence(target.x, target.y) : stepSequence(0, 0),
  }));
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
  addSystemLog(t("log_cleared"));
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
function setBridgeBadge(key, cssClass) {
  bridge.badgeKey = key;
  el.bridgeBadge.textContent = t(key);
  el.bridgeBadge.classList.remove("is-on", "is-off");
  if (cssClass) el.bridgeBadge.classList.add(cssClass);
}

function bridgeOnline() {
  return bridge.badgeKey === "bridge_connected" || bridge.badgeKey === "bridge_pressing";
}

/** The launcher-platform toggle: offline -> "Start bridge" (fires the
 *  launcher), online -> "Stop bridge" (shuts the helper down). */
function updateStartBridgeBtn() {
  if (!isBridgeLauncherBrowser()) return; // Windows + macOS + Linux
  if (bridgeLaunchTimerId !== null) return; // a launch attempt is in flight
  if (bridgeStopTimerId !== null) return;   // a stop attempt is in flight
  el.startBridgeBtn.hidden = false;
  el.startBridgeBtn.disabled = false;
  const online = bridgeOnline();
  el.startBridgeBtn.classList.toggle("is-stop", online);
  el.startBridgeLabel.textContent = t(online ? "stop_bridge" : "start_bridge");
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
    setBridgeBadge(data.running ? "bridge_pressing" : "bridge_connected", "is-on");
  } else {
    setBridgeBadge("bridge_offline", "is-off");
  }
  updateStartBridgeBtn();
  return data;
}

/* --------------------------------------------------------------------------
 * Bridge launcher (Windows + macOS + Linux) — fires the enterclickerbridge://
 * handler and polls /ping until the helper answers. Windows registers the
 * handler with the registry every bridge run; macOS registers the
 * EnterClickerBridge.app bundle via enable-bridge-launch-mac.command; Linux
 * associates EnterClickerBridge.desktop via enable-bridge-launch-linux.sh
 * (xdg-mime). All three platforms get the auto-attempt on page load plus
 * the Start bridge button; the helper starts silently on every one.
 * ------------------------------------------------------------------------ */
const BRIDGE_PROTOCOL = "enterclickerbridge:";
const BRIDGE_LAUNCH_WAIT_MS = 20000;
let bridgeLaunchTimerId = null;
let bridgeStopTimerId = null;

/** Stop side of the toggle: end any pressing, then ask the helper to exit
 *  and poll until /ping stops answering. */
function stopBridgeProcess() {
  if (bridgeStopTimerId !== null || bridgeLaunchTimerId !== null) return;
  el.startBridgeBtn.disabled = true;
  if (session.running || bridge.active) stopRun("manual");
  fetch(`${BRIDGE_URL}/shutdown`, { method: "POST" }).catch(() => {});

  let waited = 0;
  bridgeStopTimerId = setInterval(async () => {
    waited += 500;
    let offline = false;
    try {
      const res = await fetch(`${BRIDGE_URL}/ping`, { cache: "no-store" });
      const data = await res.json();
      offline = !(data && data.ok);
    } catch {
      offline = true;
    }
    if (offline || waited >= 8000) {
      clearInterval(bridgeStopTimerId);
      bridgeStopTimerId = null;
      if (offline) {
        setBridgeBadge("bridge_offline", "is-off");
        addSystemLog(t("bridge_stopped"));
        showToast(t("bridge_stopped"));
      }
      updateStartBridgeBtn();
    }
  }, 500);
}

function isWindowsBrowser() {
  return /Windows/i.test(navigator.userAgent);
}

function isMacBrowser() {
  return /Mac/i.test(navigator.userAgent);
}

function isLinuxBrowser() {
  return /Linux/i.test(navigator.userAgent) && !isAndroidBrowser();
}

function isAndroidBrowser() {
  return /Android/i.test(navigator.userAgent);
}

/** Platforms where the one-click enterclickerbridge:// launcher exists:
 *  Windows (protocol handler, registered by every bridge run), macOS
 *  (EnterClickerBridge.app, registered by enable-bridge-launch-mac.command)
 *  and Linux (EnterClickerBridge.desktop, registered by
 *  enable-bridge-launch-linux.sh). */
function isBridgeLauncherBrowser() {
  return isWindowsBrowser() || isMacBrowser() || isLinuxBrowser();
}

function fireBridgeProtocol() {
  // Launch from the TOP frame inside the click's user-activation window:
  // Chrome ignores custom-scheme navigations from a freshly created iframe
  // (activation is per-frame), so an `<a>` click is the reliable trigger.
  // Without a registered handler nothing happens and the poll below times out.
  const anchor = document.createElement("a");
  anchor.href = `${BRIDGE_PROTOCOL}start`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function bridgeLaunchScriptName() {
  if (isWindowsBrowser()) return "enable-bridge-launch-windows.bat";
  if (isMacBrowser()) return "enable-bridge-launch-mac.command";
  return "enable-bridge-launch-linux.sh";
}

function launchBridge(auto) {
  // Manual clicks always (re)start the attempt — they carry the user
  // activation the fire needs; auto-starts never interrupt one in flight.
  if (auto && bridgeLaunchTimerId !== null) return;
  clearInterval(bridgeLaunchTimerId);
  bridgeLaunchTimerId = null;
  // The button stays ENABLED during the wait: until the user grants the
  // one-time browser permission, the page-load auto-attempt fires into the
  // void — a disabled button would then swallow the first real click too.
  if (!auto) showToast(t("bridge_launching_toast"), 10000);

  fireBridgeProtocol();

  let waited = 0;
  bridgeLaunchTimerId = setInterval(async () => {
    waited += 1000;
    const data = await probeBridge();
    if (data && data.ok) {
      clearInterval(bridgeLaunchTimerId);
      bridgeLaunchTimerId = null;
      // probeBridge ran while the launch guard was still set, so its label
      // update was skipped — repaint now that the attempt is settled.
      updateStartBridgeBtn();
      addSystemLog(t("bridge_started_toast"));
      if (!auto) showToast(t("bridge_started_toast"));
      return;
    }
    if (waited >= BRIDGE_LAUNCH_WAIT_MS) {
      clearInterval(bridgeLaunchTimerId);
      bridgeLaunchTimerId = null;
      updateStartBridgeBtn();
      addSystemLog(t("bridge_failed_toast", { script: bridgeLaunchScriptName() }));
      if (!auto) {
        showToast(t("bridge_failed_toast", { script: bridgeLaunchScriptName() }), 8000);
      }
    }
  }, 1000);
}

async function bridgeStartRequest() {
  const res = await fetch(`${BRIDGE_URL}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      interval: settings.interval,
      count: settings.repeatMode === "custom" ? settings.repeatCount : 0,
      click: clickStepEnabled() ? 1 : 0,
      tab: settings.tabBeforeEnter ? 1 : 0,
      clickList: settings.clickTargets.map((p) => [p.x, p.y]),
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
  // 100ms: localhost is cheap, and the keycap animation + click sound mirror
  // real helper presses — a slower poll made them lag up to a poll tick
  // behind the actual presses.
  bridge.pollId = setInterval(bridgePollTick, 100);
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
    addSystemLog(t("bridge_lost_log"));
    showToast(t("bridge_offline_toast"));
    updateStartBridgeBtn();
    return;
  }

  // Log each press the helper reports since the previous tick.
  // The helper walks the target list by press index — mirror that here.
  while (bridge.lastPresses < data.presses) {
    const target = settings.clickTargets.length
      ? settings.clickTargets[bridge.lastPresses % settings.clickTargets.length]
      : null;
    bridge.lastPresses += 1;
    session.presses += 1;
    session.firedInCycle += 1;
    animateKeycap();
    playClick();
    bumpCounters();
    addLogEntry(t("press_bridge", {
      n: session.presses,
      seq: target ? stepSequence(target.x, target.y) : stepSequence(0, 0),
    }));
  }

  // The helper finished a custom-count run on its own.
  if (!data.running && bridge.active) stopRun("done");
}

/* --------------------------------------------------------------------------
 * Start / stop / reset
 * ------------------------------------------------------------------------ */
function modeText() {
  return settings.repeatMode === "custom"
    ? t("mode_custom", { n: settings.repeatCount })
    : t("mode_infinite");
}

function setRunUi(isRunning, isReal) {
  el.startStopBtn.classList.toggle("is-running", isRunning);
  el.startStopLabel.textContent = t(isRunning ? "stop" : "start");
  el.startStopBtn.setAttribute("aria-label", t(isRunning ? "stop_aria" : "start_aria"));
  el.countdownRing.classList.toggle("is-running", isRunning);
  if (isRunning) setStatus(isReal ? "status_real" : "status_local", "is-running");
}

function startLocalRun() {
  session.running = true;
  session.firedInCycle = 0;

  session.nextFireAt = performance.now();
  runCycle();
  startUiLoop();

  setRunUi(true, false);
  addSystemLog(t("started_local", { n: settings.interval, mode: modeText() }));
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
      addSystemLog(t("started_real", { n: settings.interval, mode: modeText() }));
      showToast(t("real_toast"));
      return;
    } catch {
      addSystemLog(t("bridge_rejected_log"));
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
  cancelStepTimers();
  stopUiLoop();
  renderIdleCountdown();

  el.startStopBtn.classList.remove("is-running");
  el.startStopLabel.textContent = t("start");
  el.startStopBtn.setAttribute("aria-label", t("start_aria"));
  el.countdownRing.classList.remove("is-running");
  el.countdownLabel.textContent = t("until_next");
  setStatus("status_idle", "is-idle");

  if (reason === "done") {
    addSystemLog(t("finished_log", { n: settings.repeatCount }));
    showToast(t("finished_toast", { n: settings.repeatCount }));
  } else if (reason === "manual") {
    addSystemLog(wasBridge ? t("stopped_real") : t("stopped_local"));
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
  addSystemLog(t("reset_log"));
  showToast(t("reset_toast"));
}

function setStatus(statusKey, cssClass) {
  session.statusKey = statusKey;
  session.statusClass = cssClass || null;
  el.statusText.textContent = t(statusKey);
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
    session.nextFireAt = performance.now();
    runCycle();
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
    showToast(t("aim_toast"), 12000);
    try {
      const res = await fetch(`${BRIDGE_URL}/aim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout: 30 }),
      });
      const picked = await res.json();
      if (picked && picked.ok) {
        const entry = addClickTarget(Math.round(picked.x), Math.round(picked.y));
        showToast(t("target_added_toast", { n: settings.clickTargets.length, x: entry.x, y: entry.y }));
        return;
      }
      if (picked && picked.reason === "cancelled") {
        showToast(t("aim_cancel_toast"));
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
  showAimReticle(window.innerWidth / 2, window.innerHeight / 2, t("aiming_reticle", { n: left }));
  showToast(t("inpage_toast", { n: left }), AIM_SECONDS * 1000 + 500);

  aim.onMove = (e) => showAimReticle(e.clientX, e.clientY, t("aiming_reticle", { n: left }));
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
    showToast(t("aim_cancel_toast"));
  };
  document.addEventListener("mousemove", aim.onMove, true);
  document.addEventListener("mousedown", aim.onDown, true);
  document.addEventListener("keydown", aim.onKey, true);

  aim.timerId = setInterval(() => {
    left -= 1;
    if (left > 0) {
      el.aimLabel.textContent = t("aiming_reticle", { n: left });
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
      const entry = addClickTarget(Math.round(picked.x), Math.round(picked.y));
      showToast(t("target_added_toast", { n: settings.clickTargets.length, x: entry.x, y: entry.y }));
      return;
    }
  } catch {
    /* fall through */
  }
  if (ev) {
    const entry = addClickTarget(Math.round(ev.clientX), Math.round(ev.clientY));
    showToast(t("target_added_page_toast", { n: settings.clickTargets.length, x: entry.x, y: entry.y }));
    return;
  }
  showToast(t("pick_nobridge_toast"), 5000);
}

/* --------------------------------------------------------------------------
 * Press-target list: each interval fires the whole list as a burst (one
 * entry every STEP_DELAY_MS), each step performing click(x, y) → Tab →
 * Enter, in order and wrapping around. Pick appends an entry (max 20);
 * "Reset list" clears everything until new targets are added.
 * ------------------------------------------------------------------------ */
function renderTargetList() {
  el.targetList.replaceChildren();

  if (settings.clickTargets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "targets-empty";
    empty.textContent = t("targets_empty");
    el.targetList.appendChild(empty);
    return;
  }

  settings.clickTargets.forEach((target, index) => {
    const row = document.createElement("div");
    row.className = "target-row";

    const label = document.createElement("span");
    label.className = "target-n";
    label.textContent = `#${index + 1}`;

    const axisX = document.createElement("span");
    axisX.className = "xy-axis";
    axisX.setAttribute("aria-hidden", "true");
    axisX.textContent = "X";

    const inputX = document.createElement("input");
    inputX.className = "target-x";
    inputX.type = "number";
    inputX.inputMode = "numeric";
    inputX.min = "0";
    inputX.max = String(XY_MAX);
    inputX.step = "1";
    inputX.value = String(target.x);
    inputX.autocomplete = "off";
    inputX.disabled = !settings.clickBeforeEnter;

    const axisY = document.createElement("span");
    axisY.className = "xy-axis";
    axisY.setAttribute("aria-hidden", "true");
    axisY.textContent = "Y";

    const inputY = document.createElement("input");
    inputY.className = "target-y";
    inputY.type = "number";
    inputY.inputMode = "numeric";
    inputY.min = "0";
    inputY.max = String(XY_MAX);
    inputY.step = "1";
    inputY.value = String(target.y);
    inputY.autocomplete = "off";
    inputY.disabled = !settings.clickBeforeEnter;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "target-remove";
    removeBtn.innerHTML = "&times;";
    removeBtn.setAttribute("aria-label", t("target_remove_aria"));
    removeBtn.title = t("target_remove_aria");
    removeBtn.disabled = !settings.clickBeforeEnter;

    row.append(label, axisX, inputX, axisY, inputY, removeBtn);
    el.targetList.appendChild(row);
  });
}

function saveClickTargets() {
  saveSettings();
  updateScript();
}

/** Validates + commits a list row's inputs. Returns false if invalid. */
function applyTargetRowFromInputs(row) {
  const inputX = row.querySelector(".target-x");
  const inputY = row.querySelector(".target-y");
  // Index within .target-row elements only (an empty-state node may exist).
  const index = Array.from(el.targetList.querySelectorAll(".target-row")).indexOf(row);
  const x = Number.parseInt(inputX.value, 10);
  const y = Number.parseInt(inputY.value, 10);
  const invalid =
    inputX.value === "" || !Number.isFinite(x) || x < 0 || x > XY_MAX ||
    inputY.value === "" || !Number.isFinite(y) || y < 0 || y > XY_MAX;

  if (invalid) {
    showFieldError(el.clickXYError, true);
    return false;
  }

  showFieldError(el.clickXYError, false);
  if (index >= 0) {
    settings.clickTargets[index] = { x: clamp(x, 0, XY_MAX), y: clamp(y, 0, XY_MAX) };
    inputX.value = String(settings.clickTargets[index].x);
    inputY.value = String(settings.clickTargets[index].y);
    saveClickTargets();
  }
  return true;
}

/** Appends a validated + clamped target entry and rerenders the list. */
function addClickTarget(x, y) {
  const entry = { x: clamp(Math.round(x) || 0, 0, XY_MAX), y: clamp(Math.round(y) || 0, 0, XY_MAX) };
  if (settings.clickTargets.length >= MAX_TARGETS) {
    showToast(t("list_full_toast", { n: MAX_TARGETS }));
    return settings.clickTargets[settings.clickTargets.length - 1];
  }
  settings.clickTargets.push(entry);
  showFieldError(el.clickXYError, false);
  renderTargetList();
  saveClickTargets();
  rescheduleForCyclePeriod();
  return entry;
}

function removeClickTarget(index) {
  if (index < 0 || index >= settings.clickTargets.length) return;
  settings.clickTargets.splice(index, 1);
  showFieldError(el.clickXYError, false);
  renderTargetList();
  saveClickTargets();
  rescheduleForCyclePeriod();
}

/** Clears every target: presses then perform only Tab → Enter. */
function resetClickTargets() {
  settings.clickTargets = [];
  showFieldError(el.clickXYError, false);
  renderTargetList();
  saveClickTargets();
  rescheduleForCyclePeriod();
  showToast(t("reset_targets_toast"));
}

function applyClickEnabled(enabled) {
  settings.clickBeforeEnter = enabled;
  saveSettings();

  // Targets are only editable while the click step is enabled
  // (renderTargetList disables each row's inputs accordingly).
  el.pickBtn.disabled = !enabled;
  el.addTargetBtn.disabled = !enabled;
  el.resetTargetsBtn.disabled = !enabled;
  if (!enabled) showFieldError(el.clickXYError, false);

  renderTargetList();
  updateScript();
}

/* --------------------------------------------------------------------------
 * Cross-platform script generation (macOS / Windows / Linux)
 * ------------------------------------------------------------------------ */
function buildAppleScript(interval, mode, count) {
  const stamp = new Date().toLocaleString();
  const header =
    `-- Generated by Enter Key Clicker on ${stamp}\n` +
    `-- Interval: ${interval}s | Mode: ${mode === "infinite" ? "infinite" : `${count} presses`}\n` +
    `-- Sequence: each cycle waits the interval, then fires the WHOLE list, one entry every 0.2s${settings.tabBeforeEnter ? " (each step: Tab + Enter after the click)" : " (each step: Enter after the click)"}\n\n`;

  // Each cycle WAITS the interval first, then walks the whole target list
  // (0.2s between steps) at the tail, so a cycle = interval + 0.2s per
  // entry. An empty list = one plain Tab/Enter step per interval.
  const clickEnabled = clickStepEnabled();
  const cycleLen = clickEnabled ? settings.clickTargets.length : 1;
  const stepLines =
    (clickEnabled
      ? `\t\tset pt to item ((n mod (count of targetPoints)) + 1) of targetPoints\n` +
        `\t\tclick at pt -- left-click at the step's target point\n`
      : "") +
    (settings.tabBeforeEnter ? `\t\tkey code 48 -- Tab\n` : "") +
    `\t\tkey code 36 -- Enter / Return (keyCode 13)\n`;
  const body =
    (clickEnabled
      ? `set targetPoints to {${settings.clickTargets.map((p) => `{${p.x}, ${p.y}}`).join(", ")}}\n`
      : "") +
    `set cycleLen to ${cycleLen}\n` +
    `set n to 0\n` +
    `${mode === "infinite" ? "repeat" : `repeat ${count} times`}\n` +
    `\tif ((n mod cycleLen) is 0) then\n` +
    `\t\tdelay ${interval} -- cycle wait: the burst lands after the interval\n` +
    `\telse\n` +
    `\t\tdelay 0.2 -- next list step follows shortly\n` +
    `\tend if\n` +
    `\ttell application "System Events"\n` +
    stepLines +
    `\tend tell\n` +
    `\tset n to n + 1\n` +
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

  const clickEnabled = clickStepEnabled();

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
        `"@\n` +
        `# Each cycle waits the interval, then runs the WHOLE list, one entry every 0.2s (wrapping around)\n` +
        `$targets = @(\n` +
        settings.clickTargets.map((p) => `    @(${p.x}, ${p.y})`).join(",\n") +
        `\n)\n`;
    }
    const cycleLen = clickEnabled ? settings.clickTargets.length : 1;

    const bodyLines = [
      "    $count = " + (clickEnabled ? "$targets.Count" : "1"),
      "    for ($j = 0; $j -lt $count; $j++) {",
    ];
    if (clickEnabled) {
      bodyLines.push(
        "        $t = $targets[$j % $targets.Count]",
        "        [MouseTap]::SetCursorPos($t[0], $t[1])",
        "        Start-Sleep -Milliseconds 50",
        "        [MouseTap]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)  # left button down",
        "        Start-Sleep -Milliseconds 50",
        "        [MouseTap]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)  # left button up",
        "        Start-Sleep -Milliseconds 50"
      );
    }
    if (settings.tabBeforeEnter) {
      bodyLines.push('        [System.Windows.Forms.SendKeys]::SendWait("{TAB}")');
    }
    bodyLines.push('        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")');
    bodyLines.push("        if ($j -lt ($count - 1)) { Start-Sleep -Milliseconds 200 }");
    bodyLines.push("    }");

    const body = bodyLines.join("\n");
    const burstLoop = [
      "    # A cycle waits the interval first, then the burst lands",
      `    Start-Sleep -Seconds ${interval}`,
      body,
    ].join("\n") + "\n";
    const loop =
      mode === "infinite"
        ? `while ($true) {\n${burstLoop}}`
        : `for ($i = 1; $i -le ${count}; $i++) {\n${burstLoop}}`;
    return `${comment}${prelude}\n${loop}\n`;
  }

  // linux — bash + xdotool
  const comment = header.replace(/^--/gm, "#");
  const targetsDecl = clickEnabled
    ? `# Each cycle waits the interval, then runs the WHOLE list, one entry every 0.2s (wrapping around)\n` +
      `tx=(${settings.clickTargets.map((p) => p.x).join(" ")})\n` +
      `ty=(${settings.clickTargets.map((p) => p.y).join(" ")})\n`
    : "";
  const innerLines = [
    `  cycle=${clickEnabled ? "${#tx[@]}" : "1"}`,
    "  for ((j = 0; j < cycle; j++)); do",
  ];
  if (clickEnabled) {
    innerLines.push("    idx=$(( j % ${#tx[@]} ))");
    innerLines.push("    xdotool mousemove ${tx[$idx]} ${ty[$idx]} click 1");
  }
  if (settings.tabBeforeEnter) innerLines.push("    xdotool key Tab");
  innerLines.push("    xdotool key Return");
  innerLines.push('    [ "$j" -lt $((cycle - 1)) ] && sleep 0.2');
  innerLines.push("  done");

  const body = innerLines.join("\n");
  const burstLoop =
    `  # A cycle waits the interval first, then the burst lands\n` +
    `  sleep ${interval}\n` +
    body + "\n";
  const loop =
    mode === "infinite"
      ? `while true; do\n${burstLoop}done`
      : `for i in $(seq 1 ${count}); do\n${burstLoop}done`;
  return `${comment}${targetsDecl}${loop}\n`;
}

function updateScript() {
  const { platform, interval, repeatMode, repeatCount } = settings;
  const isMac = platform === "mac";

  // Primary block — paste-and-run for Terminal / PowerShell / bash.
  el.scriptCode.textContent = buildScript(platform, interval, repeatMode, repeatCount);
  el.platformNote.textContent =
    `${t(`note_${platform}`)} ${t("seq_prefix")}: ${sequenceParts()} — ${t("targets_count", { n: settings.clickTargets.length })}.`;

  if (isMac) {
    // Show the Script Editor flavour as a clearly separated secondary option.
    el.optSecondary.hidden = false;
    el.scriptCode2.textContent = buildAppleScript(interval, repeatMode, repeatCount);
    el.primaryOptLabel.textContent = t("primary_mac");
    el.copyOsaBtn.hidden = false;
    el.copyScriptBtn.hidden = true;
  } else {
    el.optSecondary.hidden = true;
    el.primaryOptLabel.textContent = t(platform === "windows" ? "primary_windows" : "primary_linux");
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
 *  - Optional pre-press steps: left-click at the step's target via
 *    CGEventCreateMouseEvent (types 5/1/2 = moved / left-down / left-up) and
 *    optional Tab keyTap (keyCode 48) before the Enter keyTap (keyCode 36).
 *  - Each press walks the TARGETS list in order, wrapping around.
 */
function buildOsaCommand() {
  const n = settings.repeatMode === "infinite" ? 0 : settings.repeatCount; // 0 = infinite
  const i = settings.interval;
  const click = clickStepEnabled() ? 1 : 0;
  const tab = settings.tabBeforeEnter ? 1 : 0;
  const targets = JSON.stringify(settings.clickTargets.map((p) => [p.x, p.y]));
  return `osascript -l JavaScript -e '
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
// N = presses (0 = run forever); I = seconds each cycle waits first
// TARGETS = [[x, y], ...] — each cycle WAITS I, then runs the WHOLE list
// as a burst, one entry every 0.2s, so presses land I seconds after each
// cycle mark; a full cycle span is I + 0.2s per entry; an empty
// list is a single Tab/Enter step.
// Sequence per step: Click(x, y)${tab ? " -> Tab" : ""} -> Enter
var N = ${n}, I = ${i};
var CLICK = ${click}, TAB = ${tab};
var TARGETS = ${targets};
var src = $.CGEventSourceCreate(1);
function clickXY(x, y) {
  var mv = $.CGEventCreateMouseEvent(src, 5, {x: x, y: y}, 0);
  $.CGEventPost(0, mv);
  $.NSThread.sleepForTimeInterval(0.02);
  var d = $.CGEventCreateMouseEvent(src, 1, {x: x, y: y}, 0);
  $.CGEventPost(0, d);
  $.NSThread.sleepForTimeInterval(0.02);
  var u = $.CGEventCreateMouseEvent(src, 2, {x: x, y: y}, 0);
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
function press(idx) {
  var p = TARGETS[idx % TARGETS.length];
  if (CLICK === 1 && TARGETS.length > 0) clickXY(p[0], p[1]);
  if (TAB === 1) keyTap(48); // Tab (keyCode 48)
  keyTap(36); // Enter / Return (keyCode 13)
}
var steps = TARGETS.length > 0 ? TARGETS.length : 1;
var done = 0;
while (N === 0 || done < N) {
  $.NSThread.sleepForTimeInterval(I);
  for (var j = 0; j < steps; j++) {
    if (N !== 0 && done >= N) break;
    press(TARGETS.length > 0 ? j : 0);
    done += 1;
    if (j < steps - 1) $.NSThread.sleepForTimeInterval(0.2);
  }
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
      showToast(t("cmd_copied"));
    } catch {
      showToast(t("copy_failed"));
    }
    helper.remove();
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(command).then(
      () => showToast(t("cmd_copied")),
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
  const label = t({ mac: "label_applescript", windows: "label_powershell", linux: "label_bash" }[settings.platform]);

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
      showToast(t("script_copied", { label }));
    } catch {
      showToast(t("copy_failed"));
    }
    helper.remove();
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast(t("script_copied", { label })),
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

// Language: switching re-translates every static element and refreshes the
// state-dependent labels (status, bridge badge, Start/Stop, script notes).
el.langSelect.addEventListener("change", () => {
  const lang = el.langSelect.value;
  if (!I18N_LANGS.includes(lang)) return;
  settings.lang = lang;
  saveSettings();
  applyLanguage();
});

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
el.tabToggle.addEventListener("change", () => {
  settings.tabBeforeEnter = el.tabToggle.checked;
  saveSettings();
  updateScript();
});
el.pickBtn.addEventListener("click", pickPosition);
el.addTargetBtn.addEventListener("click", () => addClickTarget(0, 0));
el.resetTargetsBtn.addEventListener("click", resetClickTargets);

// Target list rows: value edits validate + save; the × button removes.
el.targetList.addEventListener("change", (e) => {
  const row = e.target.closest(".target-row");
  if (row) applyTargetRowFromInputs(row);
});
el.targetList.addEventListener("input", (e) => {
  if (!e.target.classList.contains("target-x") && !e.target.classList.contains("target-y")) return;
  const row = e.target.closest(".target-row");
  const inputs = [row.querySelector(".target-x"), row.querySelector(".target-y")];
  const invalid = inputs.some((i) => {
    const v = Number.parseInt(i.value, 10);
    return i.value === "" || !Number.isFinite(v) || v < 0 || v > XY_MAX;
  });
  showFieldError(el.clickXYError, invalid);
});
el.targetList.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (!e.target.classList.contains("target-x") && !e.target.classList.contains("target-y")) return;
  e.preventDefault();
  e.target.blur();
});
el.targetList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".target-remove");
  if (!removeBtn) return;
  removeClickTarget(
    Array.from(el.targetList.querySelectorAll(".target-row")).indexOf(removeBtn.closest(".target-row"))
  );
});

el.repeatCountInput.addEventListener("change", applyRepeatCountFromInput);
el.repeatCountInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
});

el.clearLogBtn.addEventListener("click", clearLog);

// Start/Stop bridge toggle: offline -> fire the enterclickerbridge://
// launcher and poll until the helper is reachable; online -> shut it down.
el.startBridgeBtn.addEventListener("click", (e) => {
  e.currentTarget.blur();
  if (bridgeOnline()) stopBridgeProcess();
  else launchBridge(false);
});

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
      () => showToast(t("applescript_copied")),
      () => showToast(t("copy_failed"))
    );
  } else {
    showToast(t("copy_failed"));
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
  el.langSelect.value = settings.lang;
  applyLanguage();
  // Auto-start the bridge on first page access (Windows only). If there is
  // no registered launcher yet, or the browser blocks the fire until the
  // user allows it, the attempt times out quietly and the Start bridge
  // button — already shown — repeats it on click.
  probeBridge().then((data) => {
    if ((!data || !data.ok) && isBridgeLauncherBrowser()) launchBridge(true);
  });

  // Interval + repeat controls
  el.intervalInput.value = settings.interval;
  el.repeatCountInput.value = settings.repeatCount;
  const customRadio = el.repeatRadios.find((r) => r.value === settings.repeatMode);
  if (customRadio) {
    customRadio.checked = true;
    el.repeatCountInput.disabled = settings.repeatMode !== "custom";
  }

  // Sound + sequence + targets + platform
  el.soundToggle.checked = settings.sound;
  el.clickToggle.checked = settings.clickBeforeEnter;
  el.tabToggle.checked = settings.tabBeforeEnter;
  el.pickBtn.disabled = !settings.clickBeforeEnter;
  el.addTargetBtn.disabled = !settings.clickBeforeEnter;
  el.resetTargetsBtn.disabled = !settings.clickBeforeEnter;
  renderTargetList();
  selectPlatform(settings.platform);
  updateScript();

  // Idle countdown preview
  renderIdleCountdown();
  setStatus("status_idle", "is-idle");
  el.totalPresses.textContent = "0";
  el.cyclePresses.textContent = "0";
}

init();
