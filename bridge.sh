#!/usr/bin/env bash
# Enter Key Clicker — local helper bridge (bash-only, python fallback).
#
# Serves the same 127.0.0.1:8791 API as bridge.py:
#   GET  /ping     -> {"ok":true,"running":bool,"presses":int,"interval":int,
#                     "count":int} (+ "accessibility" on macOS, answered by
#                     the EnterClickerBridge stub app on port 8792)
#   GET  /pick     -> {"ok":true,"x":float,"y":float} — cursor position
#   POST /aim      {"timeout": 1-60} -> python3 bridge.py --aim-overlay child
#                     (no python -> {"ok":false,"reason":"unavailable"})
#   POST /start    {"interval","count","click","tab","clickList"} — waits the
#                     interval, then fires the whole list as a burst 0.2s
#                     apart. On macOS the presses are posted by the stub app
#                     (8792 /press — it owns the Accessibility grant, which
#                     never flows down to this script's children; if the stub
#                     is absent, e.g. manual run from a trusted Terminal,
#                     an osascript/JXA child is used like bridge.py does).
#                     On Linux the burst loop runs here in a child via xdotool.
#   POST /stop     -> stops any running press loop
#   POST /shutdown -> stops the press loop and exits this helper
#
# The server is a plain `nc -l` loop with two FIFOs, so a machine with
# neither python3 nor GUI toolkits can still run the bridge. If nc is
# unusable (missing, or its listen syntax does not work), this script execs
# the original `python3 bridge.py` so behavior never degrades below it.

set -u

PORT="${ECH_BRIDGE_PORT:-8791}"
STUB_PORT=8792
DIR="$(cd "$(dirname "$0")" && pwd)"
TMPD="/tmp/ech-bridge-sh.$$"
FIFO_IN="$TMPD/in"
FIFO_OUT="$TMPD/out"
SD_FLAG="$TMPD/shutdown"
TARGETS_FILE="$TMPD/targets"
JXA_PICK_FILE="$TMPD/pick.js"

CURL="$(command -v curl 2>/dev/null || true)"
STUB_ACTIVE=0
INTERVAL_S=0
COUNT_N=0
STEPS_N=1
STARTED_AT=0
REQ_BODY=""

log() { printf '%s\n' "$*"; }

# --- nc listen syntax differs between BSD (macOS: `nc -l PORT`) and the
# --- traditional netcat (`nc -l -p PORT`); probe which one this machine has.
probe_nc() {
    local words alive i
    for words in "-l $PORT" "-l -p $PORT"; do
        ( exec nc $words < /dev/null > /dev/null 2>&1 ) &
        alive=$!
        i=0
        while kill -0 "$alive" 2>/dev/null && [ "$i" -lt 3 ]; do
            sleep 0.1; i=$((i + 1))
        done
        if kill -0 "$alive" 2>/dev/null; then
            kill "$alive" 2>/dev/null
            wait "$alive" 2>/dev/null
            printf '%s' "$words"
            return 0
        fi
        wait "$alive" 2>/dev/null
    done
    return 1
}

# ---------------------------------------------------------------------------
# Stub-app (macOS) calls over loopback HTTP.
# ---------------------------------------------------------------------------
stub_get() { "$CURL" -s --max-time 1 "http://127.0.0.1:$STUB_PORT$1" 2>/dev/null; }
stub_post() {
    [ -n "$CURL" ] || return 1
    "$CURL" -s --max-time 2 -X POST -H 'Content-Type: application/json' \
        --data-binary "$2" "http://127.0.0.1:$STUB_PORT$1" 2>/dev/null
}

# --- Press-count estimate, same burst-tail model as bridge.py's status():
# --- each cycle waits the interval first, then fires STEPS_N entries 0.2s
# --- apart. Integer seconds only — the page interpolates the countdown.
presses_estimate() {
    local elapsed cycles rem within done
    elapsed=$(( $(date +%s) - STARTED_AT ))
    [ "$elapsed" -lt 0 ] && elapsed=0
    cycles=$(( elapsed / (INTERVAL_S + (STEPS_N + 4) / 5) ))
    rem=$(( elapsed - cycles * (INTERVAL_S + (STEPS_N + 4) / 5) ))
    done=$(( cycles * STEPS_N ))
    if [ "$rem" -ge "$INTERVAL_S" ]; then
        within=$(( rem - INTERVAL_S ))
        n=$(( 1 + within * 5 ))
        [ "$n" -gt "$STEPS_N" ] && n=$STEPS_N
        done=$(( done + n ))
    fi
    if [ "$COUNT_N" -gt 0 ] && [ "$done" -gt "$COUNT_N" ]; then
        done=$COUNT_N
    fi
    printf '%s' "$done"
}

# --- Press children register their pid in files: handlers run inside the
# --- per-request subshell, so plain variables never reach the parent that
# --- runs cleanup (and the JXA press child of an earlier request must still
# --- be stoppable by a later one).
pid_kill_file() { # $1 pid file
    [ -f "$1" ] || return 0
    local p; read -r p < "$1"
    [ -n "$p" ] && kill "$p" 2>/dev/null
    rm -f "$1"
}

pid_alive_file() { # $1 pid file
    [ -f "$1" ] || return 1
    local p; read -r p < "$1"
    [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

stop_presses() {
    if [ "$STUB_ACTIVE" = 1 ]; then
        stub_post /stop "{}"
        STUB_ACTIVE=0
    fi
    pid_kill_file "$TMPD/osa.pid"
    pid_kill_file "$TMPD/loop.pid"
}

cleanup() {
    stop_presses
    rm -rf "$TMPD" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Request parsing + replies (one request per connection; curl/browser send
# a lone JSON body whose byte length Content-Length carries).
# ---------------------------------------------------------------------------
reply() { # $1 code reason, $2 json body
    printf 'HTTP/1.0 %s\r\nAccess-Control-Allow-Origin: *\r\n' "$1"
    printf 'Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n'
    printf 'Access-Control-Allow-Headers: Content-Type\r\n'
    # GitHub Pages (https) -> this http://127.0.0.1 helper needs Chrome's
    # Private Network Access opt-in, same as bridge.py sends.
    printf 'Access-Control-Allow-Private-Network: true\r\n'
    printf 'Content-Type: application/json\r\nContent-Length: %s\r\n' "${#2}"
    printf 'Connection: close\r\n\r\n%s' "$2"
}

json_int() { # $1 json, $2 key → first non-negative integer for "key": N, else ""
    printf '%s' "$1" | tr -d '\n\r' | sed -E -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p'
}

json_pairs() { # $1 json → clickList rows "[x, y]" one per line (x/y digits)
    printf '%s' "$1" | tr -d '\n\r' | grep -oE '"clickList"[[:space:]]*:[[:space:]]*\[[^]]*\]\]*' \
        | grep -oE '\[[0-9]+, *[0-9]+\]'
}

validate_start() { # sets INTERVAL_S/COUNT_N/CLICK_N/TAB_N/STEPS_N + RESULT
    RESULT=""
    INTERVAL_S="$(json_int "$REQ_BODY" interval)"
    COUNT_N="$(json_int "$REQ_BODY" count)"
    CLICK_N="$(json_int "$REQ_BODY" click)"
    TAB_N="$(json_int "$REQ_BODY" tab)"
    if [ -z "$INTERVAL_S" ] || [ "$INTERVAL_S" -lt 10 ] || [ "$INTERVAL_S" -gt 9999 ]; then
        RESULT="interval out of range"
        return 0
    fi
    if [ -z "$COUNT_N" ] || [ "$COUNT_N" -lt 0 ] || [ "$COUNT_N" -gt 9999 ]; then
        RESULT="count out of range"
        return 0
    fi
    if [ -z "$CLICK_N" ] || [ "$CLICK_N" -gt 1 ] || [ -z "$TAB_N" ] || [ "$TAB_N" -gt 1 ]; then
        RESULT="click/tab must be 0 or 1"
        return 0
    fi
    : > "$TARGETS_FILE"
    json_pairs "$REQ_BODY" | sed 's/[[:space:]]//g' > "$TARGETS_FILE"
    if [ ! -s "$TARGETS_FILE" ]; then
        # legacy single-target form the page never sends but bridge.py kept
        local lx ly
        lx="$(json_int "$REQ_BODY" clickX)"
        ly="$(json_int "$REQ_BODY" clickY)"
        if [ -n "$lx" ] && [ -n "$ly" ]; then
            printf '[%s,%s]\n' "$lx" "$ly" >> "$TARGETS_FILE"
        fi
    fi
    local pair x y
    while IFS= read -r pair; do
        x="${pair%%,*}"; x="${x#[}"
        y="${pair##*,}"; y="${y%]}"
        if [ -z "$x" ] || [ -z "$y" ] || [ "$x" -lt 0 ] || [ "$x" -gt 99999 ] \
           || [ "$y" -lt 0 ] || [ "$y" -gt 99999 ]; then
            RESULT="click coordinates out of range"
            return 0
        fi
    done < "$TARGETS_FILE"
    local n; n="$(wc -l < "$TARGETS_FILE" | tr -d ' ')"
    if [ "$n" -gt 20 ]; then
        RESULT="clickList must hold 0-20 entries"
        return 0
    fi
    STEPS_N=$([ "$n" -gt 0 ] && echo "$n" || echo 1)
}

# --- Linux burst loop: xdotool child of this script, identical timing to
# --- bridge.py's NativePressLoop.
linux_loop() {
    local click="$CLICK_N" tab="$TAB_N" count="$COUNT_N" interval="$INTERVAL_S"
    local done=0 j x y line
    local n; n="$(wc -l < "$TARGETS_FILE" | tr -d ' ')"
    [ "$n" -gt 0 ] || n=1
    while [ "$count" -eq 0 ] || [ "$done" -lt "$count" ]; do
        j=0
        while [ "$j" -lt "$n" ]; do
            [ "$count" -ne 0 ] && [ "$done" -ge "$count" ] && break 2
            if [ "$click" -eq 1 ] && [ -s "$TARGETS_FILE" ]; then
                line="$(sed -n "$((j + 1))p" "$TARGETS_FILE")"
                x="${line%%,*}"; x="${x#[}"
                y="${line##*,}"; y="${y%]}"
                xdotool mousemove "$x" "$y" click 1 >/dev/null 2>&1
                sleep 0.05
            else
                sleep 0.001
            fi
            [ "$tab" -eq 1 ] && { xdotool key Tab >/dev/null 2>&1; sleep 0.02; }
            xdotool key Return >/dev/null 2>&1
            done=$((done + 1))
            [ "$j" -lt "$((n - 1))" ] && sleep 0.2
            j=$((j + 1))
        done
        [ "$count" -ne 0 ] && [ "$done" -ge "$count" ] && break 2
        sleep "$interval"
        [ "$n" -gt 0 ] && sleep 0.2
    done
}

# --- macOS fallback when no stub owns 8792 (manual run inside a trusted
# --- Terminal): same JXA script bridge.py generates, via a temp file.
mac_jxa_start() {
    local jsf="$TMPD/press.js"
    local targets="["
    local first=1 pair
    if [ -s "$TARGETS_FILE" ]; then
        while IFS= read -r pair; do
            [ "$first" = 1 ] || targets="$targets,"
            targets="$targets$(printf '%s' "$pair" | sed 's/[[:space:]]//g')"
            first=0
        done < "$TARGETS_FILE"
    fi
    targets="$targets]"
    {
        printf 'ObjC.import("CoreGraphics");\n'
        printf 'ObjC.import("Foundation");\n'
        printf 'var N=%s, I=%s;\n' "$COUNT_N" "$INTERVAL_S"
        printf 'var CLICK=%s, TAB=%s;\n' "$CLICK_N" "$TAB_N"
        printf 'var TARGETS=%s;\n' "$targets"
        cat <<'JS'
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
  if (TARGETS.length > 0 && CLICK === 1) { var p = TARGETS[idx % TARGETS.length]; clickXY(p[0], p[1]); }
  if (TAB === 1) keyTap(48);
  keyTap(36);
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
JS
    } > "$jsf"
    # </dev/null matters: any background child left holding the FIFO fds
    # keeps them open forever and the nc loop wedges on the next request.
    osascript -l JavaScript "$jsf" < /dev/null > /dev/null 2>&1 &
    echo $! > "$TMPD/osa.pid"
}

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
do_ping() {
    local running presses ax trusted acc=""
    if [ "$(uname)" = "Darwin" ]; then
        ax="$(stub_get /ax)"
        running=0
        case "$ax" in
            *'"pressing":true'*) running=1 ;;
        esac
        # No stub answering (manual run from a trusted Terminal): the JXA
        # child carries the presses then, like bridge.py's --press-loop does
        # on the other platforms.
        if [ "$running" = 0 ] && pid_alive_file "$TMPD/osa.pid"; then
            running=1
        fi
        trusted="true"
        case "$ax" in
            *'"trusted":false'*) trusted="false" ;;
            *'"trusted":true'*) trusted="true" ;;
            *) trusted="" ;;
        esac
        if [ -n "$trusted" ]; then
            acc=",\"accessibility\":$trusted"
        fi
    else
        if pid_alive_file "$TMPD/loop.pid"; then
            running=1
        else
            running=0
        fi
    fi
    if [ "$running" = 1 ] && [ "$STARTED_AT" -gt 0 ]; then
        presses="$(presses_estimate)"
    else
        presses=0
    fi
    printf '{"ok":true,"running":%s,"presses":%s,"interval":%s,"count":%s%s}' \
        "$([ "$running" = 1 ] && echo true || echo false)" \
        "$presses" "$INTERVAL_S" "$COUNT_N" "$acc"
}

do_pick() {
    if [ "$(uname)" = "Darwin" ]; then
        {
            printf 'ObjC.import("CoreGraphics");\n'
            printf 'var loc = $.CGEventGetLocation($.CGEventCreate($()));\n'
            printf 'JSON.stringify({x: loc.x, y: loc.y});\n'
        } > "$JXA_PICK_FILE"
        local out x y
        out="$(osascript -l JavaScript "$JXA_PICK_FILE" 2>/dev/null)"
        x="$(printf '%s' "$out" | sed -E -n 's/.*"x"[[:space:]]*:[[:space:]]*([0-9.]+).*/\1/p')"
        y="$(printf '%s' "$out" | sed -E -n 's/.*"y"[[:space:]]*:[[:space:]]*([0-9.]+).*/\1/p')"
        if [ -n "$x" ] && [ -n "$y" ]; then
            reply "200 OK" "{\"ok\":true,\"x\":$x,\"y\":$y}"
        else
            reply "500 Internal Server Error" '{"ok":false,"error":"could not read the cursor position"}'
        fi
        return 0
    fi
    if ! command -v xdotool > /dev/null 2>&1; then
        reply "500 Internal Server Error" '{"ok":false,"error":"xdotool is required on Linux (X11): sudo apt install xdotool"}'
        return 0
    fi
    local out x y
    out="$(xdotool getmouselocation 2>/dev/null)"
    x="$(printf '%s' "$out" | sed -E -n 's/.*x:([0-9]+).*/\1/p')"
    y="$(printf '%s' "$out" | sed -E -n 's/.*y:([0-9]+).*/\1/p')"
    if [ -n "$x" ] && [ -n "$y" ]; then
        reply "200 OK" "{\"ok\":true,\"x\":$x,\"y\":$y}"
    else
        reply "500 Internal Server Error" '{"ok":false,"error":"could not read the cursor position"}'
    fi
}

do_aim() { # $1 body
    local t
    t="$(json_int "$1" timeout)"
    [ -z "$t" ] && t=15
    if [ "$t" -lt 1 ] || [ "$t" -gt 60 ]; then
        reply "400 Bad Request" '{"ok":false,"error":"timeout out of range"}'
        return 0
    fi
    if ! command -v python3 > /dev/null 2>&1; then
        reply "200 OK" '{"ok":false,"reason":"unavailable"}'
        return 0
    fi
    local out
    out="$(cd "$DIR" && python3 bridge.py --aim-overlay "$t" 2>/dev/null)"
    case "$out" in
        "PICK "*)
            local x y _
            read -r _ x y _ <<<"$(printf '%s' "$out" | tr -s ' ')"
            reply "200 OK" "{\"ok\":true,\"x\":$x,\"y\":$y}"
            ;;
        "UNAVAILABLE") reply "200 OK" '{"ok":false,"reason":"unavailable"}' ;;
        *) reply "200 OK" '{"ok":false,"reason":"cancelled"}' ;;
    esac
}

do_start() {
    validate_start
    if [ -n "$RESULT" ]; then
        reply "400 Bad Request" "{\"ok\":false,\"error\":\"$RESULT\"}"
        return 0
    fi
    STARTED_AT="$(date +%s)"
    if [ "$(uname)" = "Darwin" ]; then
        # Preferred: the stub posts the presses itself — its bundle holds the
        # Accessibility grant, and child events of it were silently dropped.
        local tl="[" first=1 pair mac_body req1
        if [ -s "$TARGETS_FILE" ]; then
            while IFS= read -r pair; do
                [ "$first" = 1 ] || tl="$tl,"
                tl="$tl$(printf '%s' "$pair" | sed 's/[[:space:]]//g')"
                first=0
            done < "$TARGETS_FILE"
            tl="$tl]"
        else
            tl="[]"
        fi
        mac_body=$(printf '{"interval":%s,"count":%s,"click":%s,"tab":%s,"targets":%s}' \
            "$INTERVAL_S" "$COUNT_N" "$CLICK_N" "$TAB_N" "$tl")
        req1="$(stub_post /press "$mac_body")"
        case "$req1" in *'"ok":true'*) STUB_ACTIVE=1
            reply "200 OK" "$(do_ping)"; return 0 ;; esac
        case "$req1" in
            *busy*)
                stub_post /stop "{}"
                sleep 0.6
                req1="$(stub_post /press "$mac_body")"
                case "$req1" in *'"ok":true'*) STUB_ACTIVE=1
                    reply "200 OK" "$(do_ping)"; return 0 ;; esac
                ;;
        esac
        stop_presses
        # No stub on 8792 (manual run inside a trusted Terminal): the JXA
        # child still works there, where trust flows down from the terminal.
        mac_jxa_start
        reply "200 OK" "$(do_ping)"
        return 0
    fi
    # Linux
    if ! command -v xdotool > /dev/null 2>&1; then
        reply "500 Internal Server Error" '{"ok":false,"error":"xdotool is required on Linux (X11): sudo apt install xdotool"}'
        return 0
    fi
    stop_presses
    linux_loop < /dev/null > /dev/null 2>&1 &
    echo $! > "$TMPD/loop.pid"
    reply "200 OK" "$(do_ping)"
}

do_stop() {
    stop_presses
    STARTED_AT=0
    reply "200 OK" "$(do_ping)"
}

do_shutdown() {
    stop_presses
    reply "200 OK" '{"ok":true,"stopping":true}'
    if [ -n "${ECH_STOP_FILE:-}" ]; then
        printf '1' > "$ECH_STOP_FILE" 2>/dev/null
    fi
    : > "$SD_FLAG"
}

# ---------------------------------------------------------------------------
# One request per connection: stdin is the raw HTTP request; stdout goes
# back through nc into the socket.
# ---------------------------------------------------------------------------
serve_request() {
    local req line method path len=0 body=""
    IFS= read -r -t 5 req || return 0
    req="${req%$'\r'}"
    method="${req%% *}"
    path="${req#* }"
    path="${path%% *}"
    while IFS= read -r -t 2 line; do
        line="${line%$'\r'}"
        case "$line" in
            "") break ;;
            [Cc]ontent-[Ll]ength:*) len="$(printf '%s' "${line#*:}" | tr -d ' ')"; len=$((len + 0)) ;;
        esac
    done
    [ "$len" -gt 0 ] && body="$(head -c "$len")"
    REQ_BODY="$body"
    case "$method:$path" in
        "OPTIONS:"*) reply "204 No Content" "" ;;
        "GET:"*) case "$path" in
            /ping*) reply "200 OK" "$(do_ping)" ;;
            /pick*) do_pick ;;
            *) reply "404 Not Found" '{"ok":false}' ;;
        esac ;;
        "POST:"*) case "$path" in
            /ping*|/status*) reply "200 OK" "$(do_ping)" ;;
            /aim*) do_aim "$body" ;;
            /start*) do_start ;;
            /stop*) do_stop ;;
            /shutdown*) do_shutdown ;;
            *) reply "404 Not Found" '{"ok":false}' ;;
        esac ;;
        *) reply "404 Not Found" '{"ok":false}' ;;
    esac
}

# ---------------------------------------------------------------------------
main() {
    local NC_MODE ncrc srv i
    # Port already serving? (scheme relaunch while an instance is alive)
    if [ -n "$CURL" ] && [ -n "$("$CURL" -s --max-time 1 "http://127.0.0.1:$PORT/ping" 2>/dev/null | grep -o '"ok"')" ]; then
        return 0
    fi
    NC_MODE="$(probe_nc)" || true
    if [ -z "${NC_MODE:-}" ]; then
        # Another instance may have just bound the port (the stub can spawn
        # this again while the first one is still coming up) — only fall
        # back to the python helper when nobody is serving.
        sleep 1
        if [ -n "$("$CURL" -s --max-time 1 "http://127.0.0.1:$PORT/ping" 2>/dev/null)" ]; then
            return 0
        fi
        # bash-only is not possible here — never degrade: exec the python
        # helper (it retries a busy port and exits politely like today).
        if command -v python3 > /dev/null 2>&1; then
            log "bridge.sh: no usable nc tool — falling back to python3 bridge.py"
            cd "$DIR" && exec python3 -u bridge.py
        fi
        log "bridge.sh: neither nc nor python3 found — cannot run the bridge."
        return 1
    fi
    umask 077
    mkdir -p "$TMPD"
    mkfifo "$FIFO_IN" "$FIFO_OUT"
    trap cleanup EXIT
    trap 'cleanup; exit 130' INT
    trap 'cleanup; exit 143' TERM
    log "Enter Key Clicker bridge (bash) listening on http://127.0.0.1:$PORT"
    echo "Open the web app and press Start — presses will land in the frontmost app."
    echo "Stop this helper with Ctrl+C (or just close this window)."
    while :; do
        [ -f "$SD_FLAG" ] && break
        serve_request <> "$FIFO_OUT" > "$FIFO_IN" &
        srv=$!
        # NC_MODE is e.g. "-l 8791" or "-l -p 8791" — word-split on purpose.
        nc $NC_MODE <> "$FIFO_IN" > "$FIFO_OUT"
        ncrc=$?
        # reap serve_request; a client that vanished early could otherwise
        # leave it blocked on a fifo with no reader forever.
        i=0
        while kill -0 "$srv" 2>/dev/null && [ "$i" -lt 50 ]; do
            sleep 0.1; i=$((i + 1))
        done
        if kill -0 "$srv" 2>/dev/null; then
            kill -9 "$srv" 2>/dev/null
        fi
        wait "$srv" 2>/dev/null
        if [ "$ncrc" -ne 0 ] && ! [ -f "$SD_FLAG" ]; then
            # A bind can fail transiently (TIME_WAIT of the previous
            # connection); only give up if the port is really ours no more.
            local gaveup=1
            local t
            for t in 1 2 3 4 5 6 7 8; do
                sleep 0.3
                [ -f "$SD_FLAG" ] && gaveup=0 && break
                nc $NC_MODE <> "$FIFO_IN" > "$FIFO_OUT"
                if [ $? -eq 0 ]; then gaveup=0; break; fi
            done
            if [ "$gaveup" = 1 ]; then
                log "bridge.sh: port $PORT busy — exiting (the running instance keeps the bridge up)."
                sleep 2  # never quit instantly: LaunchServices counts that
                break
            fi
        fi
    done
    return 0
}

main "$@"
