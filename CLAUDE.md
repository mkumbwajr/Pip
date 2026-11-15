# Pip

Pip is a free, open-source (MIT) status island for Windows. A notch at the top of the screen shows what AI coding
agents (Claude Code, Codex) are doing, and opens on hover into a panel of small tools. The mascot is Pip.
Publisher: BANG DIGITAL LTD. Repo: https://github.com/mkumbwajr/Pip

## Rules that do not change

1. **Original work only.** Pip was inspired by a commercial app called TwoCode. Never copy its code, artwork,
   mascot, wording, icons or exact visual design. Matching *what a feature does* is fine; matching *how it looks* is
   not. Pip is a coloured rounded-square face with two eyes, and stays that way.
2. **Swahili first.** Every text a user sees goes through `t('English text')`. The translation lives in
   `src/locales/sw.json` and must be Tanzanian street Swahili mixed with the English tech words people really use
   (Swanglish): not textbook Swahili, not Kenyan usage. `test/more.test.cjs` fails if a text is missing or unused.
   The owner reviews wording: list every new string in your summary.
3. **No account required, no paywall, no telemetry.** The Pip account (Google sign-in, preferences sync, `server/`) is
   optional and Pip must work fully without it. Anything that leaves the PC must be switched on by the user and named
   in the README's "Kinachotoka nje ya PC yako" section.
4. **Never break the user's agent config.** `hook-install.js` only touches its own entries, keeps a `.pip-backup`,
   never replaces an existing status line and refuses to write JSON it cannot parse. Keep those guarantees and
   their tests.
5. **Say what was tested.** Most Windows-only code has never run on Windows. Do not claim it works until it has.

## Commands

```
npm install
npm start            # run from source (Ctrl+Alt+Space toggles the island)
npm test             # 20 Node tests, any OS
npm run dist:win     # on Windows: unpacked app + NSIS installer in dist/ (needs makensis on PATH)
npx electron --no-sandbox tools/smoke.js out/   # simulated agent session + screenshots (Linux needs xvfb-run)
node tools/check-helper.js                      # Windows: runs the PowerShell helper for 12 s and prints its state
```

## Layout of the code

| Path | What it is |
| --- | --- |
| `src/main/main.js` | Main process: island window, settings window, tray, shortcuts, all IPC |
| `src/main/hooks-hub.js` | HTTP server on `127.0.0.1:48611` (token header). Routes: `/pip/event`, `/pip/status`, `/pip/wait`. Session state, permission holds, replies, usage |
| `src/main/hook-install.js` | Adds/removes hooks in `~/.claude/settings.json` and `~/.codex/hooks.json` |
| `src/hooks/pip-reply.cjs` | Background Stop hook (`asyncRewake`): waits for an answer typed in the island, exits 2 to wake Claude |
| `src/hooks/pip-status.cjs` | Status line: forwards `rate_limits` to the hub |
| `src/helpers/win-helper.ps1` | One hidden PowerShell: media session, artwork, volume, front window, Wi-Fi/Bluetooth. JSON lines both ways |
| `src/main/win-helper.js` | Starts and talks to that script |
| `src/main/share.js` | Phone transfer over the LAN (random link, QR, one hour) |
| `src/main/buddy.js` | "Ask about your screen": screenshot, then `claude -p` or `codex exec` |
| `src/main/spotify.js`, `lyrics.js`, `ics.js`, `store.js` | Spotify devices (PKCE), LRCLIB lyrics, iCal parser, settings |
| `src/renderer/island.*` | The island. One morphing `#shell`; pages are render functions in `island.js` |
| `src/renderer/settings.*` | Settings window (sidebar, header with live island preview, cards) |
| `src/renderer/guard.*` | Focus-guard pause screen |
| `src/shared/i18n.js`, `src/locales/sw.json` | Translation helper and the Swahili strings |
| `build/pip.nsi` | Installer (plain NSIS; per-user; uninstaller runs `Pip.exe --remove-hooks`) |

Conventions: plain JavaScript, no framework, no bundler. Renderers are sandboxed with a strict CSP (no inline
styles or scripts: set styles from JS). Every IPC handler checks the sender. Comments explain *why*, in English.

## What exists today (0.3.0)

Works in tests or the Linux smoke test: live agent status, Allow/Deny, reply from the island, usage bars, the
"answer in Swahili" instruction, hover-to-open with pin, Attach/Detach, transparency, eyes following the cursor,
settings window, file tray, clips, note, focus timer, phone transfer server, weather, calendar (iCal link), lyrics.

Written but **never run on Windows**: media controls, artwork, volume, Wi-Fi/Bluetooth, focus guard, screen
questions, Spotify login, the installer. First job: run on Windows and fix what breaks.

Known open bug: the weather card stayed empty for the owner. Settings now has an "Angalia" button that shows the
real error; get that error and fix the cause.

## Work to do: features to reach

The owner wants every function below. Build them in Pip's own layout (next section), not the reference's.
Legend: ✅ have, ◐ partial, ☐ missing.

**Status strip (always visible in the open island)**
- ◐ Wi-Fi and Bluetooth indicators (switches exist on Home; make them compact indicators that toggle on click)
- ☐ Today's date
- ◐ Usage chip: percentage used and a live countdown to reset (bars exist on Home; add the chip)
- ✅ Clock
- ☐ Overflow menu: volume slider, all tools, customise (reorder/hide tabs), settings, check for updates, fold, quit

**Home**
- ◐ Large clock (have a small one)
- ◐ Three quick tiles: agent status or "connect" prompt, now playing with artwork, focus timer with a start button

**Navigation**
- ◐ Icon tabs with tooltips; the active tab shows icon and label (have text tabs)
- ☐ "Add your own app": user-defined launchers (name, icon, path or URL) shown as extra tabs
- ☐ Quick volume control reachable from every tab

**Agents**
- ✅ Sessions, activity, Allow/Deny, reply, history
- ☐ First-use card with a Connect button that connects without opening Settings

**Music**
- ◐ Seek bar that can be dragged (have a read-only bar; needs a `seek` command in the helper)
- ✅ Previous, play/pause, next · ◐ artwork and lyrics (unverified on Windows)
- ◐ Output device picker (Spotify only today)

**Pip (assistant)**
- ◐ Ask box (have; currently always sends a screenshot)
- ☐ Quick actions on the current clipboard or selection: Explain, Check my spelling, Translate, Summarise
- ☐ Voice input (microphone button; Web Speech API or the agent's own dictation)
- ☐ Link to connect an agent when none is connected

**Focus**
- ◐ Timer (have 15/25/50 presets): add a minute ruler/slider from 0 to 60 and a "finishes at HH:MM" line

**Modes** ☐
- Presets (Work, Study, Sleep, Game), each with its own duration and three switches: block distracting windows
  (reuse focus guard), only let agent notifications through, keep music playing
- Starting a mode starts its timer and applies its switches; stopping restores the previous state

**Files**
- ✅ Drop zone, open on click, send to/from phone
- ☐ Drag a file *out* of the island into another app (`webContents.startDrag`)

**Clips**
- ◐ History (have text only, memory only): add an age label, a type label, and "Clear history"

**Note**
- ◐ Auto-saving note: lines starting with `[ ]` become tick boxes

**Calendar**
- ◐ Next event from an iCal link: add a Day/Month switch, a timeline of today, and "Nothing planned"
- ☐ Add an event; ☐ Google sign-in (needs the owner's own OAuth client; keep the iCal route as the default)

**Mail** ☐
- Unread count only, never senders or subjects. Needs Google sign-in (same OAuth client as Calendar)

**Island behaviour**
- ✅ Idle notch, hover to open, fold in, per-tab colour glow, spring motion
- ☐ Auto-update (removed: design it for the plain NSIS installer, e.g. check GitHub Releases and offer the download)

## Pip's own layout (use this, not the reference's placement)

- **Navigation is a vertical rail on the left edge** of the open panel: icons only, the active one with its label
  beside it. Custom launchers sit at the bottom of the rail.
- **The status strip is the pill row at the top**: Pip on the left, then the activity text, then date, Wi-Fi,
  Bluetooth, usage chip and clock on the right. The overflow menu opens from Pip, not from a "…" button.
- **Home is two columns**: a tall agent card on the left; clock, now playing and focus stacked on the right.
- **Colour** comes from Pip's colour and the per-tab tints already in `island.css` (`--tint`). Keep the dark,
  flat cards; no copied gradients or iconography. Draw icons as simple original SVGs in one `icons.js` file.

## How to work

- One feature per commit. Add or update a test for anything in `src/main/` that can run under Node.
- After UI changes run the smoke test and look at the screenshots.
- Bump `version` in `package.json` and `VERSION` in `build/pip.nsi` together.
- Ask the owner before: adding a dependency, sending any data off the PC, or changing wording he has reviewed.
