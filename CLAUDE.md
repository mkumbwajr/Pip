# Pip

Pip is a free, open-source (MIT) status island for Windows and Mac. A notch at the top of the screen shows what AI
coding agents (Claude Code, Codex) are doing, and opens on hover into a panel of small tools. The mascot is Pip.
Publisher: BANG DIGITAL LTD. Repo: https://github.com/mkumbwajr/Pip

## Rules that do not change

1. **Original work only.** Pip was inspired by a commercial app called TwoCode. Never copy its code, artwork,
   mascot, wording, icons or exact visual design. Matching *what a feature does* is fine; matching *how it looks* is
   not. Pip is a coloured rounded-square face with two eyes, and stays that way.
2. **Swahili first.** Every text a user sees goes through `t('English text')`. The translation lives in
   `src/locales/sw.json` and must be Tanzanian street Swahili mixed with the English tech words people really use
   (Swanglish): not textbook Swahili, not Kenyan usage. `test/more.test.cjs` fails if a text is missing or unused.
   The owner reviews wording: list every new string in your summary.
3. **Free for everyone, no telemetry.** The paywall is removed (2026-11-16, on the owner's instruction): every tab is
   free, with no trial and nothing to buy. The trial/license machinery (`src/main/license.js`, `server/license.py`,
   EvPay, same merchant account as M-Chaja) stays in the code for an account that bought before then, but
   `license.js`'s `view()` always returns `locked: false` now — do not reintroduce gating without asking first.
   Donations of any amount (through the same EvPay integration, in Settings → Support) are separate: they grant
   nothing and never touch the license. The Pip account is optional, for settings sync across devices. Anything that
   leaves the PC — including account sync, donations, the any-network phone relay, and the iTunes lookup for cover
   art — must be switched on by the user, or be the license check, and be named in the README's "Kinachotoka nje ya
   PC yako" section and on the privacy page.
4. **Never break the user's agent config.** `hook-install.js` only touches its own entries, keeps a `.pip-backup`,
   never replaces an existing status line and refuses to write JSON it cannot parse. Keep those guarantees and
   their tests.
5. **Say what was tested.** Pip now runs for real on both Windows and Mac (see "What exists today"), but most of the
   code is still only smoke-tested or read, not run. Do not claim a feature works until you have actually run it and
   checked, not just made it compile or pass the Linux smoke test.

## Commands

```
npm install
npm start            # run from source (Ctrl+Alt+Space toggles the island)
npm test             # Node tests, any OS
npm run dist:win     # on Windows: unpacked app + NSIS installer in dist/ (needs makensis on PATH)
npm run dist:mac     # on Mac: universal .dmg in dist/
npx electron --no-sandbox tools/smoke.js out/   # simulated agent session + screenshots (Linux needs xvfb-run)
node tools/check-helper.js                      # Windows: runs the PowerShell helper for 12 s and prints its state
```

## Layout of the code

| Path | What it is |
| --- | --- |
| `src/main/main.js` | Main process: island window, settings/welcome windows, tray, shortcuts, the license lifecycle, all IPC |
| `src/main/hooks-hub.js` | HTTP server on `127.0.0.1:48611` (token header). Routes: `/pip/event`, `/pip/status`, `/pip/wait`. Session state, permission holds, replies, usage |
| `src/main/hook-install.js` | Adds/removes hooks in `~/.claude/settings.json` and `~/.codex/hooks.json` |
| `src/hooks/pip-reply.cjs` | Background Stop hook (`asyncRewake`): waits for an answer typed in the island, exits 2 to wake Claude |
| `src/hooks/pip-status.cjs` | Status line: forwards `rate_limits` to the hub |
| `src/helpers/win-helper.ps1` | One hidden PowerShell: media session, artwork, volume, front window, Wi-Fi/Bluetooth. JSON lines both ways |
| `src/main/win-helper.js` | Starts and talks to the PowerShell helper (Windows) |
| `src/main/mac-helper.js` | The Mac equivalent: media session, artwork, volume, front app, Wi-Fi/Bluetooth (installs `blueutil` via Homebrew if needed) |
| `src/main/mac-alerts.js` | iPhone messages (from the Mac's Messages alert, no Full Disk Access needed) and calls, shown in the island |
| `src/main/firewall.js` | Opens the Windows Firewall for phone sharing, on request |
| `src/main/share.js` | Phone transfer over the LAN (random link, QR, one hour) |
| `src/main/relay.js` | Phone transfer over *any* network, through Pip's own server, end-to-end encrypted (the QR code prefers this) |
| `src/main/buddy.js` | "Ask about your screen": a screenshot, or plain chat, then `claude -p` or `codex exec` |
| `src/main/spotify.js` | Spotify devices and playback (PKCE login) |
| `src/main/songinfo.js` | Cover art / release-year lookup (iTunes Search) for songs the player gives no artwork for |
| `src/main/lyrics.js` | LRCLIB synced lyrics |
| `src/main/ics.js` | iCal parser for the calendar link |
| `src/main/google.js` | Google sign-in (OAuth, the owner's own client) for Calendar events and Mail's unread count |
| `src/main/account.js` | The optional Pip account: email-code sign-in, settings sync across devices, feeds the license |
| `src/main/license.js` | Legacy trial/license state (kept, never locks) plus donations; talks to `server/license.py` (EvPay) |
| `src/main/update.js` | Checks GitHub Releases for a newer build |
| `src/main/store.js` | Settings persistence |
| `src/renderer/island.*` | The island. One morphing `#shell`; pages are render functions in `island.js` |
| `src/renderer/settings.*` | Settings window (sidebar, header with live island preview, cards, the license section) |
| `src/renderer/welcome.*` | First-run welcome window (also where the first agent gets connected) |
| `src/renderer/guard.*` | Focus-guard pause screen |
| `src/renderer/icons.js` | Every tab/UI icon, drawn as original inline SVG |
| `src/shared/i18n.js`, `src/locales/sw.json` | Translation helper and the Swahili strings |
| `build/pip.nsi` | Windows installer (plain NSIS; per-user; uninstaller runs `Pip.exe --remove-hooks`) |
| `server/` | The Python backend: `license.py` (EvPay checkout/webhook), `mail.py`, `pip-api.py` (account sync, relay) |
| `site/` | The marketing/support site (pip.bang.co.tz): landing page, terms, privacy, "paid" and "send" pages |

Conventions: plain JavaScript, no framework, no bundler. Renderers are sandboxed with a strict CSP (no inline
styles or scripts: set styles from JS). Every IPC handler checks the sender. Comments explain *why*, in English.

## What exists today (1.0.2)

Cross-platform now, not Windows-only: `main.js` branches on `process.platform` throughout (keychain handling, the
helper, media/Bluetooth, iPhone alerts, restart-on-replace for Mac app updates). Real, not just smoke-tested:
- Mobile-money payment through EvPay (live API, `api.evpay.co.tz`) — tested for real, prompt and signed webhook
  both arrived correctly (the test order itself failed on insufficient M-Pesa balance, which is expected).
- Phone Bluetooth audio: tested on a real Pixel 10 — Windows' AVRCP exposes no title/artist over the stock A2DP
  sink, so Pip shows "Playing from <phone>" with a speaker picker only. A real fix (Android companion app over
  RFCOMM, or AMS on iPhone) is deferred — the owner said to skip it for now.
- Card payment through EvPay is wired up (`license:payCard`) but **not yet tested for real**: EvPay had not turned
  on card collection on the merchant account as of 2026-11-15; confirm the webhook grants a license once it has.

Still just smoke-tested or read, not run for real: media controls/artwork/volume/Wi-Fi/Bluetooth on Windows and Mac
beyond the two cases above, focus guard, screen questions, Spotify login, Google sign-in, the account sync, the
any-network relay, and both installers.

Known open bug (status unconfirmed since last reported): the weather card stayed empty for the owner. Settings has
an "Angalia" button that shows the real error (`weather:get` returns `{error}}` on failure) — get that error and fix
the cause if it is still happening.

## Work to do: features to reach

The owner wants every function below. Build them in Pip's own layout (next section), not the reference's.
Legend: ✅ have, ◐ partial, ☐ missing. (Checked against `main.js` and `island.js` on `main`, 2026-11-16 — UI items
not visible from the main process were checked by reading the renderer directly.)

**Status strip (always visible in the open island)** — all done
- ✅ Wi-Fi and Bluetooth indicators: compact, lit when on/dim when off, click to toggle
- ✅ Today's date (`#pill-date`)
- ✅ Usage chip: percentage and a live countdown to reset
- ✅ Clock
- ✅ Overflow menu (opens from Pip): volume slider, all tools, customise (hide/reorder tabs), settings, check for
  updates (with a "new" dot), fold, quit

**Home**
- ◐ Large clock — still the small one (`hm-clock sm`) in every layout
- ✅ Quick tiles, and then some: the default layout has four — agent status, now playing with artwork, focus timer,
  next calendar event — plus two more selectable home layouts not in the original spec: a dial view (usage/focus/
  song as rings) and an apps grid. Worth deciding which of the three is the real default; "Pip's own layout" below
  still only describes the two-column tile version.

**Navigation**
- ✅ Icon tabs with tooltips; the active tab shows icon and label
- ☐ "Add your own app": user-defined launchers (name, icon, path or URL) shown as extra tabs
- ✅ Quick volume control reachable from every tab (lives in the persistent bar, not per-tab)

**Agents**
- ✅ Sessions, activity, Allow/Deny, reply, history
- ✅ First-use card with a Connect button that connects without opening Settings ("No agent connected yet. Connect
  Claude Code" — appears on both the Agents tab and the Pip ask page)

**Music**
- ✅ Seek bar that can be dragged (`<input type="range" id="seek">`, gated on `media.canSeek`)
- ✅ Previous, play/pause, next
- ◐ Artwork and lyrics: fully built (synced scrollable lyrics, click a line to jump, cover art fetched/cached) but
  not run for real on Windows or Mac yet
- ◐ Output device picker: now covers a paired phone's playback target too, not just Spotify — still not one
  unified "all outputs" list

**Pip (assistant)**
- ✅ Ask box — can now send plain chat *or* a screenshot (`api.chat` vs `api.ask`), no longer always a screenshot
- ✅ Quick actions on the current clipboard: Explain, Check my spelling, Translate to English, Translate to Swahili
  (spec said "Summarise" instead of the second translate direction — close enough, confirm with the owner which he
  wants)
- ☐ Voice input (microphone button; Web Speech API or the agent's own dictation) — no trace of this yet
- ✅ Link to connect an agent when none is connected ("Connect Claude Code" on the ask page)

**Focus**
- ◐ Timer: now has the 0–60 drag ruler (replacing the 15/25/50 presets), but no "finishes at HH:MM" line found yet

**Modes** — built (was entirely missing)
- ✅ Presets stored per mode (`S.settings.modes`), minutes adjustable by drag or scroll, a `block` switch that
  reuses the focus guard and is applied live while a mode runs
- ✅ Starting a mode starts its timer and applies its switches; stopping restores the guard to how it was before
  (`modeRestore`), including if Pip is closed while a mode is running

**Files**
- ✅ Drop zone, open on click, send to/from phone
- ✅ Drag a file *out* of the island into another app (`dragstart` on `[data-drag]` → `tray:drag` → `startDrag`)

**Clips**
- ✅ Age label (`cl-age`)
- ✅ Clear history
- ☐ Type label — still text-only, memory-only; no type to label

**Note**
- ✅ Auto-saving note: lines starting with `[ ]` toggle to `[x]` and back as tick circles

**Calendar**
- ✅ Day/Month switch, a timeline of today, "Nothing planned"
- ✅ Google sign-in, alongside the iCal route (which stays the default)
- ☐ Add an event — still missing

**Mail** — built (was entirely missing)
- ✅ Unread count only, never senders or subjects, through the same Google sign-in as Calendar

**Island behaviour**
- ✅ Idle notch, hover to open, fold in, per-tab colour glow, spring motion
- ✅ Auto-update: checks GitHub Releases, notifies, and shows a dot in the overflow menu's Updates tile until
  installed

**Platform & backend** (not in the original checklist, now load-bearing)
- ✅ Mac support: its own helper (media/volume/radios), ad-hoc code signing verified in CI, restart-into-newer-copy
  when an update is dragged over a running Pip, no-keychain-prompt storage
- ✅ iPhone messages (sender only, no Full Disk Access) and calls, shown in the island on Mac
- ✅ Pip account: optional, email-code sign-in, syncs settings across a user's devices
- ✅ Phone transfer over any network via a server relay (end-to-end encrypted), alongside the original LAN-only path
- ✅ Licensing: a dedicated Settings section (status, purchase, account, payment, refund policy), EvPay mobile
  money live-tested, card payment wired but unverified (see "What exists today")
- ✅ A real marketing/support site (`site/`) and Python backend (`server/`) behind all of the above — this is no
  longer just the Electron app

## Pip's own layout (use this, not the reference's placement)

- **Navigation is a vertical rail on the left edge** of the open panel: icons only, the active one with its label
  beside it. Custom launchers sit at the bottom of the rail.
- **The status strip is the pill row at the top**: Pip on the left, then the activity text, then date, Wi-Fi,
  Bluetooth, usage chip and clock on the right. The overflow menu opens from Pip, not from a "…" button.
- **Home is two columns**: a tall agent card on the left; clock, now playing and focus stacked on the right. (Two
  other home layouts exist in the code today — a dial view and an apps grid — not described here; pick one owner
  intent before treating either as settled.)
- **Colour** comes from Pip's colour and the per-tab tints already in `island.css` (`--tint`). Keep the dark,
  flat cards; no copied gradients or iconography. Draw icons as simple original SVGs in `icons.js`.

## How to work

- One feature per commit. Add or update a test for anything in `src/main/` that can run under Node.
- After UI changes run the smoke test and look at the screenshots.
- Bump `version` in `package.json` and `VERSION` in `build/pip.nsi` together.
- Ask the owner before: adding a dependency, sending any data off the PC, or changing wording he has reviewed.
