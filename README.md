# Auto Enter Key Clicker for PCs

[](#auto-enter-key-clicker-for-pcs)

## How it looks like

[](#how-it-looks-like)

Run it by pressing [here](https://ayechanaungthwin.github.io/auto-enter-clicker-for-pcs) — no installs, no dependencies. To make the Start button press **real** Enter keys system-wide, double-click `start-bridge.command` (macOS) or drag the folder's scripts onto any machine (Windows/Linux versions are generated inside the app).

[](#permissions)

## Permissions (all platforms)

[](#permissions)

- **macOS** — accessibility permission **required**; synthetic keystrokes are blocked until you grant it to the app that runs the presses (Terminal, or whatever launches `bridge.py`).
  - Enable: open the pane with `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`, click **+**, and add your terminal app (GUI only — `tccutil` can only reset, not grant).
  - Disable: `sudo tccutil reset Accessibility` (revokes the permission for **all** apps).
- **Windows** — accessibility permission **not required**; `SendKeys` works out of the box. Only caveats: if the target app runs as administrator, run PowerShell as administrator too or presses are blocked (UIPI), and if keystrokes get skipped, turn off the Filter Keys accessibility feature (Settings → Accessibility → Keyboard → Filter Keys).
- **Linux** — accessibility permission **not required** on X11 (`xdotool` works out of the box). On Wayland (`ydotool`):
  - Enable: `sudo usermod -aG input $USER` (log out and back in) and `sudo systemctl enable --now ydotoold`.
  - Disable: `sudo gpasswd -d $USER input` and `sudo systemctl disable --now ydotoold`.

[](#run-it)

## Features

[](#features)

- Automated **Enter key press simulator** (keyCode 13) with a live countdown, adjustable interval from 10–9999 seconds, quick-adjust buttons (−1s, +1s, +10s, +60s), infinite or custom-count repeat modes, and a scrollable timestamped event log.
- **Press sequence per press: Click → Tab → Enter** — every interval fires the whole **press-target list** as a burst, one entry every **0.2 seconds** in order (wrapping around): a real mouse left-click at that entry's screen coordinates (X, Y), an optional Tab to move focus, then Enter. A full cycle spans **interval + 0.2s per entry** (a 10s interval with 2 targets starts a new burst every 10.4s, and the countdown ring covers that whole cycle). The list holds up to **20 targets**. **Pick** adds a new target: with `bridge.py` running, the whole PC screen is dimmed with a crosshair overlay — left-click anywhere on the screen to add the target (Esc cancels); without the bridge, an in-page cursor reticle captures the position after a short countdown. Coordinates can also be typed directly, and **Reset list** clears the list entirely (presses then perform only Tab → Enter until new targets are added — the list starts empty, so **Add target manually** or **Pick** create the entries; by default both the mouse-click and Tab toggles are off — the default sequence is just Enter, and each toggle adds its step back).
- **System-wide pressing** — generates ready-to-run scripts for **macOS** (AppleScript / HID-level Terminal command), **Windows** (PowerShell `SendKeys`), and **Linux** (`xdotool`), updated live to match your interval, click, and repeat settings, with one-click copy.
- **Local bridge helper** (`bridge.py`) that lets the browser's Start button send real clicks and Enter presses to the frontmost app, with in-page simulation fallback, Web Audio click sound, light/dark mode, and localStorage-saved settings.
- **Localized UI** — switch the entire interface (labels, hints, toasts, logs, generated-script notes) via the header language dropdown between **English** (default), **မြန်မာ** (Myanmar), **中文** (Chinese), and **한국어** (Korean). The choice is saved locally like every other setting.

## Electronics Engineer-cum-J2EE Backend Developer

[](#electronics-engineer-cum-j2ee-backend-developer)

* Created by - [Aye Chan Aung Thwin](https://github.com/AyeChanAungThwin)
