# Peep's Windows helper. One hidden PowerShell that stays running while Peep runs.
# It reports, as one JSON object per line: what is playing (Windows media session), the master volume,
# the window in front, and whether Wi-Fi and Bluetooth are on. It can switch those two on and off. It takes commands as JSON lines on stdin. It exits when stdin closes.
# Nothing is written to disk or sent anywhere.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out int n);
  int SetMasterVolumeLevel(float db, Guid ctx); int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int GetMasterVolumeLevel(out float db); int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint ch, float db, Guid ctx); int SetChannelVolumeLevelScalar(uint ch, float level, Guid ctx);
  int GetChannelVolumeLevel(uint ch, out float db); int GetChannelVolumeLevelScalar(uint ch, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IntPtr list); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class PeepAudio {
  static IAudioEndpointVolume Endpoint() {
    var e = (IMMDeviceEnumerator)(new MMDeviceEnumerator()); IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
    Guid id = typeof(IAudioEndpointVolume).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, IntPtr.Zero, out o)); return (IAudioEndpointVolume)o;
  }
  public static int Level() { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return (int)Math.Round(v * 100); }
  public static bool Muted() { bool m; Endpoint().GetMute(out m); return m; }
  public static void Set(int level) { Endpoint().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, level)) / 100f, Guid.Empty); }
}
public static class PeepWin {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int cmd);
  public static long Front() { return GetForegroundWindow().ToInt64(); }
  public static string Title(long h) { var s = new StringBuilder(512); GetWindowText(new IntPtr(h), s, 512); return s.ToString(); }
  public static uint Pid(long h) { uint p; GetWindowThreadProcessId(new IntPtr(h), out p); return p; }
  public static void Minimize(long h) { ShowWindowAsync(new IntPtr(h), 6); }
}
'@

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(3000) | Out-Null; $t.Result }
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = $null
function Session { if (-not $script:manager) { $script:manager = Await ($mgrType::RequestAsync()) $mgrType }; if ($script:manager) { $script:manager.GetCurrentSession() } }

function MediaState {
  $s = Session; if (-not $s) { return $null }
  $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType; if (-not $p -or -not $p.Title) { return $null }
  $t = $s.GetTimelineProperties(); $i = $s.GetPlaybackInfo()
  @{ title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; app = $s.SourceAppUserModelId
     playing = ("$($i.PlaybackStatus)" -eq 'Playing'); positionMs = [long]$t.Position.TotalMilliseconds; durationMs = [long]$t.EndTime.TotalMilliseconds }
}
function FrontState {
  $h = [PeepWin]::Front(); if ($h -eq 0) { return $null }
  $name = ''; $proc = Get-Process -Id ([PeepWin]::Pid($h)); if ($proc) { $name = $proc.ProcessName }
  @{ hwnd = $h; title = [PeepWin]::Title($h); proc = $name }
}
# Wi-Fi and Bluetooth: the same switches as in Windows Settings (Windows.Devices.Radios)
$radioType = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
$radioList = [System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]
$accessType = [Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime]
function Radio($kind) { (Await ($radioType::GetRadiosAsync()) $radioList) | Where-Object { "$($_.Kind)" -eq $kind } | Select-Object -First 1 }
function NetState {
  $w = Radio 'WiFi'; $b = Radio 'Bluetooth'; $wifi = $null; $bt = $null
  if ($w) {
    $ssid = ''
    if ("$($w.State)" -eq 'On') { $m = (netsh wlan show interfaces) | Select-String '^\s+SSID\s+:\s(.+)$' | Select-Object -First 1; if ($m) { $ssid = $m.Matches[0].Groups[1].Value.Trim() } }
    $wifi = @{ on = ("$($w.State)" -eq 'On'); ssid = $ssid }
  }
  if ($b) { $bt = @{ on = ("$($b.State)" -eq 'On') } }
  @{ wifi = $wifi; bt = $bt }
}
function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

$line = [Console]::In.ReadLineAsync(); $lastKey = ''; $lastAt = [DateTime]::MinValue; $tick = 0; $net = $null
while ($true) {
  if ($line.IsCompleted) {
    if ($null -eq $line.Result) { break }
    try {
      $c = $line.Result | ConvertFrom-Json
      switch ($c.cmd) {
        'media' { $s = Session; if ($s) { switch ($c.action) { 'toggle' { $s.TryTogglePlayPauseAsync() | Out-Null } 'next' { $s.TrySkipNextAsync() | Out-Null } 'prev' { $s.TrySkipPreviousAsync() | Out-Null } } } }
        'volume' { [PeepAudio]::Set([int]$c.level) }
        'minimize' { [PeepWin]::Minimize([long]$c.hwnd) }
        'radio' {
          Await ($radioType::RequestAccessAsync()) $accessType | Out-Null
          $r = Radio "$($c.kind)"; $to = 'Off'; if ($c.on) { $to = 'On' }
          if ($r) { Await ($r.SetStateAsync($to)) $accessType | Out-Null }
          $net = NetState
        }
      }
    } catch {}
    $line = [Console]::In.ReadLineAsync(); $lastKey = ''
  }
  if ($tick % 40 -eq 0) { $net = NetState }
  if ($tick % 4 -eq 0) {
    $media = MediaState; $front = FrontState
    $vol = $null; try { $vol = @{ level = [PeepAudio]::Level(); muted = [PeepAudio]::Muted() } } catch {}
    $key = "$($media.title)|$($media.artist)|$($media.playing)|$($vol.level)|$($vol.muted)|$($front.hwnd)|$($front.title)|$($net.wifi.on)|$($net.wifi.ssid)|$($net.bt.on)"
    if ($key -ne $lastKey -or ([DateTime]::UtcNow - $lastAt).TotalSeconds -ge 5) {
      Emit @{ type = 'state'; media = $media; volume = $vol; front = $front; net = $net }
      $lastKey = $key; $lastAt = [DateTime]::UtcNow
    }
  }
  $tick++; Start-Sleep -Milliseconds 250
}
