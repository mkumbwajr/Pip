# Google OAuth verification: justification and demo video

For the Google Cloud project that holds Pip's OAuth client (consent screen name **Pip**, homepage
https://pip.bang.co.tz, privacy policy https://pip.bang.co.tz/privacy, terms https://pip.bang.co.tz/terms).

> If you verify a **new** project, Pip must use that project's OAuth client: create a *Desktop app* client there and
> save its ID and secret into `src/main/google-client.json` (`{"clientId": "...", "secret": "..."}`), and set
> `PIP_GOOGLE_CLIENT_IDS` on the server to the new ID (`node tools/deploy-site.js --api` does it from that file).
> The video must show the client ID of the project being verified.

## Scopes Pip asks for

| Scope | Sensitivity | Where in Pip |
| --- | --- | --- |
| `openid`, `email` | non-sensitive | Optional Pip account: who you are, to sync your Pip preferences between devices |
| `https://www.googleapis.com/auth/calendar.readonly` | sensitive | Calendar tab: today's timeline, the month view, the next event on Home |
| `https://www.googleapis.com/auth/gmail.labels` | sensitive | Mail tab: the number of unread emails in the inbox, nothing else |

## Justification (paste into the "How will the scopes be used?" box)

Pip is a free, open-source desktop app for Windows and macOS (https://github.com/mkumbwajr/Pip). It shows a small
"island" at the top of the screen with the status of the user's AI coding agents and a few everyday tools.

calendar.readonly: Pip's Calendar tab shows the user's own events for today (as a timeline) and for the current month,
and the Home tab shows the next event. Pip only reads the event title, start and end time of the primary calendar. It
never creates, changes or deletes events, so the read-only scope is the narrowest one that works. Events are held in
memory while they are on screen and are never sent to our servers or anyone else.

gmail.labels: Pip's Mail tab shows one number: how many unread emails are in the inbox. Pip reads only the
messagesUnread count of the INBOX label (users.labels.get). gmail.labels cannot read, list or open any message, sender
or subject, which is why we chose it over gmail.readonly or gmail.metadata. The number stays on the user's computer.

openid email: optional sign-in for a Pip account, which keeps the user's Pip preferences so their other computers can
use them. Only the Google account ID (stored as a one-way hash) is used; no Google data is stored.

Tokens are stored encrypted on the user's computer (Windows DPAPI / macOS Keychain through Electron safeStorage).
Users can sign out in Pip's settings, which deletes them. Use of Google user data follows the Google API Services User
Data Policy, including the Limited Use requirements (stated in the privacy policy).

## The demo video (about 2 minutes, unlisted on YouTube)

Record the whole screen in English, with the browser's address bar visible. On Windows: Snipping Tool, Record (or
Win + Shift + R). Speak or add captions for each step.

1. **Pip running.** Show the island at the top of the screen, hover it open. Say: "This is Pip, a desktop app by
   BANG DIGITAL. It shows calendar events and the unread email count."
2. **Start sign-in.** Open the Calendar tab, click **Sign in with Google**. The browser opens.
3. **Show the client ID.** Click the address bar and slowly scroll through the URL so `client_id=...` is readable
   (it must match the client in the project you submit), and `scope=` shows calendar.readonly and gmail.labels.
4. **Consent screen.** Choose the Google account. Show the screen with the app name **Pip**, the two permissions
   listed, the privacy and terms links. Click **Continue / Allow**. The browser says "Pip: tayari".
5. **calendar.readonly in use.** Back in Pip: Calendar tab, show today's timeline with real events, switch to the
   month view, then Home with the next event. Say: "Pip only reads event titles and times. It cannot change them."
6. **gmail.labels in use.** Open the Mail tab: the unread number. Open Gmail in the browser and show the inbox unread
   count is the same. Say: "Pip shows only how many unread emails there are, never who sent them or what they say."
7. **Optional account (openid email).** Settings, Connections, Pip account, **Sign in with Google**: show the consent
   (only your name and email), then "Signed in". Say what syncs.
8. **Removing access.** Settings, Connections, Google, **Sign out**. Then show
   https://myaccount.google.com/permissions where Pip can be removed.

Tip: use English for the recording (Settings, General, Language, English) so reviewers can follow.
