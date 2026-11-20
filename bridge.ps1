# Enter Key Clicker — local helper bridge (Windows, PowerShell).
#
# Serves the same 127.0.0.1:8791 API as bridge.py, python-free:
#   GET  /ping     -> {"ok":true,"running":bool,"presses":int,"interval":int,
#                     "count":int}
#   GET  /pick     -> {"ok":true,"x":float,"y":float} — cursor position
#   POST /aim      {"timeout": 1-60} -> full-screen WinForms overlay; prints
#                     PICK x y on click, CANCELLED on Esc/timeout
#   POST /start    {"interval","count","click","tab","clickList"} — spawns a
#                     hidden child of this file for the burst loop (click ->
#                     Tab? -> Enter, whole list 0.2s apart at the tail)
#   POST /stop     -> stops any running press loop child
#   POST /shutdown -> stops the loop and exits this helper
#
# Every serve run (re)registers the enterclickerbridge:// handler in HKCU so
# the web page's Start bridge button / on-load attempt can relaunch the
# helper silently (hidden window; the badge turning green is the sign).

param(
    [Parameter(Position = 0)] [string] $LaunchUrl,
    [string] $PressLoop = "",
    [int] $AimOverlay = -1
)

$ErrorActionPreference = "SilentlyContinue"
$script:Port = 8791
$script:SelfPath = $PSCommandPath

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EchNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(20);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(20);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(50);
  }
  public static void TapKey(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(20);
    keybd_event(vk, 0, 0x0002, UIntPtr.Zero);
  }
}
"@

# ---------------------------------------------------------------------------
function Invoke-PressLoop {
    $raw = Get-Content -Raw -Path (Join-Path $env:TEMP "ech-press-payload.json")
    $cfg = $raw | ConvertFrom-Json
    $targets = @()
    if ($cfg.targets -and $cfg.targets.Count -gt 0) {
        foreach ($t in $cfg.targets) { $targets += ,@( [int]$t[0], [int]$t[1] ) }
    }
    $click = [bool]$cfg.click
    $tab = [bool]$cfg.tab
    $interval = [double]$cfg.interval
    $count = [int]$cfg.count
    $steps = [Math]::Max($targets.Count, 1)
    $done = 0
    while ($count -eq 0 -or $done -lt $count) {
        for ($j = 0; $j -lt $steps; $j++) {
            if ($count -ne 0 -and $done -ge $count) { break }
            if ($targets.Count -gt 0) {
                if ($click) {
                    $p = $targets[$j % $targets.Count]
                    [EchNative]::Click($p[0], $p[1])
                }
            } else {
                Start-Sleep -Milliseconds 1
            }
            if ($tab) { [EchNative]::TapKey(0x09) }
            [EchNative]::TapKey(0x0D)
            $done++
            if ($j -lt $steps - 1) { Start-Sleep -Milliseconds 200 }
        }
        if ($count -ne 0 -and $done -ge $count) { break }
        Start-Sleep -Milliseconds ([int](($interval + ($(if ($targets.Count -gt 0) { 0.2 } else { 0 }))) * 1000))
    }
}

function Invoke-AimOverlay([int]$timeout) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $resultPath = [System.IO.Path]::GetTempFileName()
    $sw = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $script:Picked = $false
    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = "None"
    $form.StartPosition = "Manual"
    $form.Bounds = New-Object System.Drawing.Rectangle(0, 0, $sw.Width, $sw.Height)
    $form.TopMost = $true
    $form.Opacity = 0.15
    $form.BackColor = [System.Drawing.Color]::Black
    $form.KeyPreview = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Crosshair
    $form.ShowInTaskbar = $false
    $label = New-Object System.Windows.Forms.Label
    $label.Dock = "Fill"
    $label.TextAlign = "MiddleCenter"
    $label.ForeColor = [System.Drawing.Color]::White
    $label.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
    $label.Text = "Click anywhere on the screen to set the click target`n(Esc cancels)"
    $form.Controls.Add($label)
    $finish = {
        $script:Picked = $true
        Set-Content -Path $resultPath -Value (("PICK {0} {1}" -f [System.Windows.Forms.Cursor]::Position.X, [System.Windows.Forms.Cursor]::Position.Y))
        $form.Close()
    }
    $form.Add_Click($finish)
    $form.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq "Escape") { Set-Content -Path $resultPath -Value "CANCELLED"; $form.Close() } })
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = $timeout * 1000
    $timer.Add_Tick({
        if (-not $script:Picked) { Set-Content -Path $resultPath -Value "CANCELLED" }
        $form.Close()
    })
    $timer.Start()
    [System.Windows.Forms.Application]::Run($form)
    if (-not (Test-Path $resultPath)) { Set-Content -Path $resultPath -Value "CANCELLED" }
    Get-Content $resultPath
}

# ---------------------------------------------------------------------------
# Registry launch registration (re)written on every serve run, like the
# protocol handler bridge.py used to register.
# ---------------------------------------------------------------------------
function Register-Launcher {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\enterclickerbridge")
    $key.SetValue("", "URL:Enter Key Clicker Bridge")
    $key.SetValue("URL Protocol", "")
    $cmd = $key.CreateSubKey("shell\open\command")
    $shell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $cmd.SetValue("", ('"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" "%1"' -f $shell, $script:SelfPath))
}

# ---------------------------------------------------------------------------
# Press-loop child bookkeeping (files survive across requests in this single
# powershell process anyway, but Get-Presses mirrors bridge.py's math).
# ---------------------------------------------------------------------------
$script:LoopPid = 0
$script:Interval = 0
$script:Count = 0
$script:Steps = 1
$script:StartedAt = [DateTime]::MinValue

function Get-LoopRunning {
    if ($script:LoopPid -gt 0) {
        $p = Get-Process -Id $script:LoopPid
        if ($p) { return $true }
    }
    return $false
}

function Stop-Presses {
    if ($script:LoopPid -gt 0) {
        Stop-Process -Id $script:LoopPid -Force -ErrorAction SilentlyContinue
        $script:LoopPid = 0
    }
    $script:StartedAt = [DateTime]::MinValue
}

function Get-Presses {
    if (-not (Get-LoopRunning)) { return 0 }
    $elapsed = ([DateTime]::UtcNow - $script:StartedAt).TotalSeconds
    $period = $script:Interval + $script:Steps * 0.2
    $cycles = [Math]::Floor($elapsed / $period)
    $rem = $elapsed - $cycles * $period
    $done = $cycles * $script:Steps
    if ($rem -ge $script:Interval) {
        $within = [Math]::Min($script:Steps, 1 + [int][Math]::Floor(($rem - $script:Interval) / 0.2))
        $done += $within
    }
    if ($script:Count -gt 0 -and $done -gt $script:Count) { $done = $script:Count }
    return [int]$done
}

function Reply($stream, [int]$code, [string]$json) {
    # Raw HTTP/1.0 over the TCP stream: http.sys (HttpListener) would demand
    # an admin URLACL for binding, which python never needed.
    $reason = switch ($code) { 200 { "200 OK" } 204 { "204 No Content" } 400 { "400 Bad Request" } 404 { "404 Not Found" } 500 { "500 Internal Server Error" } default { "200 OK" } }
    $headers = "HTTP/1.0 $reason`r`n" +
        "Access-Control-Allow-Origin: *`r`n" +
        "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
        "Access-Control-Allow-Headers: Content-Type`r`n" +
        # GitHub Pages (https) -> this http://127.0.0.1 helper: Chrome's
        # Private Network Access check needs the opt-in, as with bridge.py.
        "Access-Control-Allow-Private-Network: true`r`n" +
        "Content-Type: application/json`r`n" +
        "Content-Length: $([System.Text.Encoding]::UTF8.GetBytes($json).Length)`r`n" +
        "Connection: close`r`n`r`n" + $json
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($headers)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
}

function Handle-Start([string]$body, $res) {
    $cfg = $null
    try { $cfg = $body | ConvertFrom-Json } catch {}
    if (-not $cfg) { Reply $res 400 '{"ok":false,"error":"invalid JSON"}'; return }
    $interval = [int]$(if ($cfg.PSObject.Properties["interval"] -and $cfg.interval -ne $null) { $cfg.interval } else { 0 })
    $count = [int]$(if ($cfg.PSObject.Properties["count"] -and $cfg.count -ne $null) { $cfg.count } else { 0 })
    $click = [int]$(if ($cfg.PSObject.Properties["click"] -and $cfg.click -ne $null) { $cfg.click } else { 0 })
    $tab = [int]$(if ($cfg.PSObject.Properties["tab"] -and $cfg.tab -ne $null) { $cfg.tab } else { 0 })
    if ($interval -lt 10 -or $interval -gt 9999) { Reply $res 400 '{"ok":false,"error":"interval out of range"}'; return }
    if ($count -lt 0 -or $count -gt 9999) { Reply $res 400 '{"ok":false,"error":"count out of range"}'; return }
    if ($click -ne 0 -and $click -ne 1) { Reply $res 400 '{"ok":false,"error":"click must be 0 or 1"}'; return }
    if ($tab -ne 0 -and $tab -ne 1) { Reply $res 400 '{"ok":false,"error":"tab must be 0 or 1"}'; return }
    $targets = @()
    if ($cfg.PSObject.Properties["clickList"] -and $null -ne $cfg.clickList) {
        foreach ($entry in $cfg.clickList) {
            if (-not $entry) { continue }
            $x = [int]$entry[0]; $y = [int]$entry[1]
            if ($x -lt 0 -or $x -gt 99999 -or $y -lt 0 -or $y -gt 99999) {
                Reply $res 400 '{"ok":false,"error":"click coordinates out of range"}'
                return
            }
            $targets += ,@( $x, $y )
        }
        if ($targets.Count -gt 20) { Reply $res 400 '{"ok":false,"error":"clickList must hold 0-20 entries"}'; return }
    }
    $inner = ($targets | ForEach-Object { "[{0},{1}]" -f $_[0], $_[1] }) -join ","
    $payloadJson = '{{"interval":{0},"count":{1},"click":{2},"tab":{3},"targets":[{4}]}}' -f $interval, $count, $click, $tab, $inner
    Set-Content -Path (Join-Path $env:TEMP "ech-press-payload.json") -Value $payloadJson -Encoding ASCII
    Stop-Presses
    $shell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $proc = Start-Process -FilePath $shell `
        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$script:SelfPath`"", '-PressLoop', '1' `
        -PassThru -WindowStyle Hidden
    $script:LoopPid = $proc.Id
    $script:Interval = $interval
    $script:Count = $count
    if ($targets.Count -gt 0) { $script:Steps = $targets.Count } else { $script:Steps = 1 }
    $script:StartedAt = [DateTime]::UtcNow
    $json = '{{"ok":true,"running":true,"interval":{0},"count":{1},"presses":0}}' -f $interval, $count
    Reply $res 200 $json
}

function Serve {
    Register-Launcher
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $script:Port)
    # A just-stopped instance can still be unwinding: retry the bind briefly.
    $started = $false
    for ($i = 0; $i -lt 10 -and -not $started; $i++) {
        try { $listener.Start(); $started = $true } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $started) {
        Write-Host "Bridge already running (port $script:Port busy) — open the web app and press Start."
        Start-Sleep 2
        return
    }
    Write-Host "Enter Key Clicker bridge listening on http://127.0.0.1:$script:Port"
    Write-Host "Open the web app and press Start — presses will land in the frontmost app."
    Write-Host "Stop this helper with Ctrl+C (or just close this window)."
    $script:Shutdown = $false
    while (-not $script:Shutdown) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            $reqline = $reader.ReadLine()
            if (-not $reqline) { $client.Close(); continue }
            $parts = $reqline.Split(' ')
            $m = $parts[0]
            $path = $parts[1]
            $len = 0
            while ($true) {
                $h = $reader.ReadLine()
                if ($null -eq $h -or $h -eq "") { break }
                if ($h -like "Content-Length:*") {
                    [int]::TryParse(($h -replace '^Content-Length:\s*', '' ), [ref]$len) | Out-Null
                }
            }
            $body = ""
            if ($len -gt 0) {
                $buf = New-Object 'System.Char[]' $len
                $n = $reader.Read($buf, 0, $len)
                $body = -join $buf[0..($n - 1)]
            }
            if ($m -eq "OPTIONS") {
                Reply $stream 204 ""
            }
            elseif ($m -eq "GET" -and $path -like "/ping*") {
                $running = Get-LoopRunning
                $p = Get-Presses
                $json = '{{"ok":true,"running":{0},"presses":{1},"interval":{2},"count":{3}}}' -f `
                    ($(if ($running) { "true" } else { "false" })), $p, $script:Interval, $script:Count
                Reply $stream 200 $json
            }
            elseif ($m -eq "GET" -and $path -like "/pick*") {
                $pt = New-Object "EchNative+POINT"
                if ([EchNative]::GetCursorPos([ref]$pt)) {
                    Reply $stream 200 ('{{"ok":true,"x":{0},"y":{1}}}' -f $pt.X, $pt.Y)
                } else {
                    Reply $stream 500 '{"ok":false,"error":"could not read the cursor position"}'
                }
            }
            elseif ($m -eq "POST" -and $path -like "/aim*") {
                $cfg = $null
                try { $cfg = $body | ConvertFrom-Json } catch {}
                $t = 15
                if ($cfg -and $cfg.PSObject.Properties["timeout"] -and $cfg.timeout) { $t = [int]$cfg.timeout }
                if ($t -lt 1 -or $t -gt 60) {
                    Reply $stream 400 '{"ok":false,"error":"timeout out of range"}'
                } else {
                    $shell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
                    $out = [System.IO.Path]::GetTempFileName()
                    Start-Process -FilePath $shell `
                        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$script:SelfPath`"", '-AimOverlay', "$t" `
                        -Wait -WindowStyle Hidden -RedirectStandardOutput $out
                    $line = (Get-Content -Raw $out).Trim()
                    Set-Content -Path $out -Value ""
                    $parts = ($line -replace '\s+', ' ').Split(' ')
                    if ($parts[0] -eq "PICK" -and $parts.Count -ge 3) {
                        Reply $stream 200 ('{{"ok":true,"x":{0},"y":{1}}}' -f $parts[1], $parts[2])
                    } elseif ($line -eq "UNAVAILABLE") {
                        Reply $stream 200 '{"ok":false,"reason":"unavailable"}'
                    } else {
                        Reply $stream 200 '{"ok":false,"reason":"cancelled"}'
                    }
                }
            }
            elseif ($m -eq "POST" -and $path -like "/start*") {
                Handle-Start $body $stream
            }
            elseif ($m -eq "POST" -and $path -like "/stop*") {
                Stop-Presses
                Reply $stream 200 '{{"ok":true,"running":false,"interval":{0},"count":{1},"presses":0}}' -f $script:Interval, $script:Count
            }
            elseif ($m -eq "POST" -and $path -like "/shutdown*") {
                Stop-Presses
                Reply $stream 200 '{"ok":true,"stopping":true}'
                $script:Shutdown = $true
            }
            else {
                Reply $stream 404 '{"ok":false}'
            }
        } catch {
            if ($stream) { $stream.Close() }
        }
        $client.Close()
    }
    Stop-Presses
    $listener.Stop()
}

"Enter Key Clicker bridge" | Write-Host
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
if ($PressLoop -ne "") { Invoke-PressLoop; exit 0 }
if ($AimOverlay -ge 0) { Invoke-AimOverlay $AimOverlay; exit 0 }
Serve
