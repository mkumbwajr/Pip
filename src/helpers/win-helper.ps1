# Pip's Windows helper. One hidden PowerShell that stays running while Pip runs.
# It reports, as one JSON object per line: what is playing (Windows media session), the master volume,
# the window in front, and whether Wi-Fi and Bluetooth are on. It can switch those two on and off. It takes commands as JSON lines on stdin. It exits when stdin closes.
# Nothing is written to disk or sent anywhere.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System; using System.Text; using System.IO; using System.Threading; using System.Collections.Concurrent; using System.Runtime.InteropServices;
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
public static class PipAudio {
  static IAudioEndpointVolume Endpoint() {
    var e = (IMMDeviceEnumerator)(new MMDeviceEnumerator()); IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
    Guid id = typeof(IAudioEndpointVolume).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, IntPtr.Zero, out o)); return (IAudioEndpointVolume)o;
  }
  public static int Level() { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return (int)Math.Round(v * 100); }
  public static bool Muted() { bool m; Endpoint().GetMute(out m); return m; }
  public static void Set(int level) { Endpoint().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, level)) / 100f, Guid.Empty); }
}
// Commands from Pip arrive on stdin. Windows PowerShell's [Console]::In.ReadLineAsync() blocks until a whole line
// arrives, which froze the loop below until Pip sent a command; a background thread reads them into a queue instead.
public static class PipInput {
  static readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
  public static volatile bool Closed;
  public static void Start() {
    var t = new Thread(() => {
      try { var r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)); string l; while ((l = r.ReadLine()) != null) lines.Enqueue(l); } catch { }
      Closed = true;
    });
    t.IsBackground = true; t.Start();
  }
  public static string Next() { string l; return lines.TryDequeue(out l) ? l : null; }
}
public static class PipWin {
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
  $t = $s.GetTimelineProperties(); $i = $s.GetPlaybackInfo(); $playing = ("$($i.PlaybackStatus)" -eq 'Playing')
  # Windows reports the position as it was at LastUpdatedTime, so add the time played since then
  $pos = $t.Position.TotalMilliseconds; $end = $t.EndTime.TotalMilliseconds
  if ($playing -and $t.LastUpdatedTime.Year -gt 2000) { $pos += ([DateTimeOffset]::UtcNow - $t.LastUpdatedTime).TotalMilliseconds }
  if ($end -gt 0 -and $pos -gt $end) { $pos = $end }
  $script:props = $p
  @{ title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; albumArtist = $p.AlbumArtist; track = $p.TrackNumber; canSeek = [bool]$i.Controls.IsPlaybackPositionEnabled; app = $s.SourceAppUserModelId; playing = $playing; positionMs = [long]$pos; durationMs = [long]$end }
}
# The song's cover picture as base64 (empty when the player gives none). Sent once per song.
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
function Artwork {
  try {
    $ref = $script:props.Thumbnail; if (-not $ref) { return '' }
    $stream = Await ($ref.OpenReadAsync()) $streamType; if (-not $stream -or $stream.Size -gt 3MB) { return '' }
    $in = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream); $mem = New-Object System.IO.MemoryStream
    $in.CopyTo($mem); $in.Dispose(); [Convert]::ToBase64String($mem.ToArray())
  } catch { '' }
}
function FrontState {
  $h = [PipWin]::Front(); if ($h -eq 0) { return $null }
  $name = ''; $proc = Get-Process -Id ([PipWin]::Pid($h)); if ($proc) { $name = $proc.ProcessName }
  @{ hwnd = $h; title = [PipWin]::Title($h); proc = $name }
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
# A phone as the music source: Windows 10 2004+ can be a Bluetooth speaker (A2DP sink) for a paired phone
# (Windows.Media.Audio.AudioPlaybackConnection). The sound goes to the default output. Windows does not pass on the
# song's name, so the island only says which phone is playing. Only phones the user paired in Bluetooth settings appear.
$asAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
$apcType = $null; try { $apcType = [Windows.Media.Audio.AudioPlaybackConnection, Windows.Media.Audio, ContentType = WindowsRuntime] } catch {}
$devType = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
$devList = [Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
$openType = $null; try { $openType = [Windows.Media.Audio.AudioPlaybackConnectionOpenResult, Windows.Media.Audio, ContentType = WindowsRuntime] } catch {}
$phoneConn = $null; $phoneName = ''; $phoneId = ''
function PhoneState {
  if (-not $apcType) { return $null }
  $list = @(); try { $list = @(Await ($devType::FindAllAsync($apcType::GetDeviceSelector())) $devList) } catch {}
  $on = [bool]($script:phoneConn -and "$($script:phoneConn.State)" -eq 'Opened')
  @{ list = @($list | ForEach-Object { @{ id = $_.Id; name = $_.Name } }); id = $script:phoneId; name = $script:phoneName; on = $on }
}
function PhoneOff { if ($script:phoneConn) { try { $script:phoneConn.Dispose() } catch {} }; $script:phoneConn = $null; $script:phoneId = ''; $script:phoneName = '' }
function PhoneOn($id) {
  PhoneOff
  $c = $apcType::TryCreateFromId([string]$id); if (-not $c) { return }
  $t = $asAction.Invoke($null, @($c.StartAsync())); $t.Wait(5000) | Out-Null
  $o = $asTask.MakeGenericMethod($openType).Invoke($null, @($c.OpenAsync())); $o.Wait(20000) | Out-Null # the phone may take a while to answer
  $script:phoneConn = $c; $script:phoneId = [string]$id
  $d = $null; try { $d = Await ($devType::CreateFromIdAsync([string]$id)) $devType } catch {}; if ($d) { $script:phoneName = $d.Name }
}

function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

[PipInput]::Start(); $lastKey = ''; $lastAt = [DateTime]::MinValue; $tick = 0; $net = $null; $artKey = ''; $soon = 0; $phones = $null
while ($true) {
  $closed = [PipInput]::Closed # read before draining, so a last command sent just before stdin closed still runs
  while ($null -ne ($text = [PipInput]::Next())) {
    try {
      $c = $text | ConvertFrom-Json
      switch ($c.cmd) {
        'media' { $s = Session; if ($s) { switch ($c.action) { 'toggle' { $s.TryTogglePlayPauseAsync() | Out-Null } 'next' { $s.TrySkipNextAsync() | Out-Null } 'prev' { $s.TrySkipPreviousAsync() | Out-Null } } } }
        'seek' { $s = Session; if ($s) { $s.TryChangePlaybackPositionAsync([long]$c.ms * 10000) | Out-Null } } # position in 100 ns ticks
        'volume' { [PipAudio]::Set([int]$c.level) }
        'phone' { if ($c.id -and $apcType) { PhoneOn $c.id } else { PhoneOff }; $phones = PhoneState }
        'minimize' { [PipWin]::Minimize([long]$c.hwnd) }
        'radio' {
          Await ($radioType::RequestAccessAsync()) $accessType | Out-Null
          $r = Radio "$($c.kind)"; $to = 'Off'; if ($c.on) { $to = 'On' }
          if ($r) { Await ($r.SetStateAsync($to)) $accessType | Out-Null }
          $net = NetState
        }
      }
    } catch {}
    $lastKey = ''; $soon = 3 # look again a few times right after a command
  }
  if ($closed) { break } # Pip has gone
  if ($tick % 50 -eq 0) { $net = NetState; $phones = PhoneState }
  if ($tick % 2 -eq 0 -or $soon -gt 0) {
    if ($soon -gt 0) { $soon-- }
    $media = MediaState; $front = FrontState
    $vol = $null; try { $vol = @{ level = [PipAudio]::Level(); muted = [PipAudio]::Muted() } } catch {}
    $key = "$($media.title)|$($media.artist)|$($media.playing)|$($vol.level)|$($vol.muted)|$($front.hwnd)|$($front.title)|$($net.wifi.on)|$($net.wifi.ssid)|$($net.bt.on)|$($phones.on)|$($phones.list.Count)"
    if ($key -ne $lastKey -or ([DateTime]::UtcNow - $lastAt).TotalSeconds -ge 5) {
      Emit @{ type = 'state'; media = $media; volume = $vol; front = $front; net = $net; phones = $phones }
      $lastKey = $key; $lastAt = [DateTime]::UtcNow
    }
    if ($media) { $k = "$($media.title)|$($media.artist)"; if ($k -ne $artKey) { $artKey = $k; Emit @{ type = 'art'; key = $k; data = (Artwork) } } }
  }
  $tick++; Start-Sleep -Milliseconds 200
}
