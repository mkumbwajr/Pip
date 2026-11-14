# Pip

A free, open-source status island for Windows. A small pill at the top of your screen shows what your AI coding
agents (Claude Code and Codex) are doing. The interface is in Tanzanian Swahili by default; English is in Settings.

MIT licence. No account, no paywall, no telemetry.

Download: [Releases](https://github.com/mkumbwajr/pip/releases). The installer is unsigned, so Windows SmartScreen warns;
choose "More info", then "Run anyway". There is no auto-update yet.

## Features

| Feature | State |
| --- | --- |
| Claude Code live status, activity feed, history | Tested with simulated hook events |
| Allow / Deny a Claude Code permission request from the island | Tested with simulated hook events |
| Answer Claude Code from the island (background Stop hook, needs Node.js) | Tested with the real script against the hub |
| Usage bars for the 5-hour and weekly limits (status line, needs Node.js) | Tested with the real script |
| Agents told to answer in Tanzanian Swahili at session start | Hub response tested; not seen in a real session |
| Codex live status (hooks via `curl.exe`) | Installer tested; not run against a real Codex |
| Island, tabs, tray icon, shortcut, Swahili and English | UI tested on Linux; not run on Windows |
| File tray, clipboard history, quick note, focus timer | UI tested on Linux |
| Phone transfer over your own Wi-Fi (QR code, both ways) | Server tested; not tried from a phone |
| Weather, next calendar event, lyrics | Parsers tested |
| Ask about your screen or one window | Written, not run; the Codex flags are a best guess |
| Now playing, media keys, volume, Wi-Fi and Bluetooth switches, focus guard | Written, **not run on Windows** |
| Spotify device switching (your own client ID, PKCE) | Token refresh and device list tested with a fake server; login not run |
| Installer and uninstaller (plain NSIS, `build/pip.nsi`) | Built on Linux, **not run on Windows** |

The `build` workflow runs the tests, the PowerShell helper and the installer build on a real Windows machine on
every push.

## Run it

```
npm install
npm start        # Ctrl+Alt+Space toggles the island
npm test
npm run dist     # Windows installer in dist/ (run on Windows)
```

## How it works

- `src/main/hooks-hub.js`: an HTTP server on `127.0.0.1:48611` guarded by a random token. Agents post hook events to
  it. A permission request is held open until you click Allow or Deny, or answer in the terminal.
- `src/main/hook-install.js`: adds and removes Pip's entries in `~/.claude/settings.json` and `~/.codex/hooks.json`.
  It touches only its own entries, keeps a one-time `.pip-backup`, never replaces a status line you already have, and
  refuses to write a file it cannot parse.
- `src/hooks/pip-reply.cjs`: a background Stop hook (`asyncRewake`). It waits for an answer typed in the island and
  exits with code 2 to wake Claude with it.
- `src/hooks/pip-status.cjs`: a status line that forwards Claude Code's usage figures to the island.
- `src/helpers/win-helper.ps1`: one hidden PowerShell for the media session, volume, front window and radios. It is
  started with `-ExecutionPolicy Bypass` for that one process, because Windows blocks unsigned scripts by default.
- `src/main/share.js`: phone transfer on your own network behind a random link; plain HTTP, stops after an hour.
- `src/locales/sw.json`: every interface text, English to Swahili. A test fails if a text is missing.

Code comments are in English so contributors outside Tanzania can read them.
