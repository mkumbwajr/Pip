# Pip

**Agents wako wote Juu ya Screen.** Kisiwa kidogo juu ya screen yako ya Windows au Mac kinachokuonyesha ma-agent wako wa AI
(Claude Code na Codex) wanafanya nini, sasa hivi. Pip, kale ka-mascot, anakushtua agent akikuhitaji au akimaliza kazi.

![Pip ikiwa imefunguka: saa, agent kazini, muziki na focus](site/img/pip-home.png)

Open source (MIT). Siku 7 za kwanza ni bure, kila kitu kikiwa wazi; baadaye island na hali ya ma-agent vinabaki bure, na tabs
nyingine zinahitaji leseni ya TSh 5,000 mara moja (M-Pesa, Mixx by Yas, Airtel Money, HaloPesa au kadi, kupitia EvPay).
Leseni inakaa kwenye akaunti ya Pip (Google au email), ambayo pia ina-sync mipangilio kati ya vifaa. Hakuna telemetry. App nzima iko kwa Kiswahili cha mtaani
cha Tanzania; English ipo kwenye Settings. [English README](README.en.md)

**Pakua:** [pip.bang.co.tz](https://pip.bang.co.tz) · Windows 10 na 11 · macOS (Intel na Apple silicon) · toleo 1.0.1

Installer haina signature bado, kwa hiyo Windows SmartScreen itakuonya: bonyeza "More info" kisha "Run anyway".
Kwenye Mac, Pip bado haijathibitishwa na Apple: mara ya kwanza fungua System Settings → Privacy & Security, shuka chini
ubonyeze **Open Anyway**. Ukisasisha, funga Pip ya zamani kwanza (Quit Pip).
Pip mpya ikitoka kwenye pip.bang.co.tz, Pip inakuletea notification (bonyeza u-download) na kidoti kwenye menu ya `•••` →
**Updates**. Inaangalia ikiwaka na kila baada ya masaa sita; unaweza kuzima kwenye Settings → General.

## Inafanya nini

**Ma-agent**
- **Live:** unaona Claude Code na Codex wanasoma, wana-edit au wana-run nini, pamoja na historia ya kazi.
- **Ruhusa kwenye kisiwa:** agent akiomba ruhusa (mfano `git push`), swali linakaa kwenye kisiwa kilichojikunja;
  bonyeza Ruhusu au Kataa bila kukifungua.
- **Mjibu hapa hapa:** Claude akimaliza au akiuliza swali, unamjibu kwenye kisiwa bila kurudi kwenye terminal.
- **Matumizi ya Claude:** asilimia ya limit ya masaa 5 na muda hadi irudi, pembeni ya saa.
- **Ma-agent wanajibu kwa Kiswahili** (unaweza kuzima).
- **Chat na Pip:** muulize Pip chochote hapa hapa kwenye kisiwa, eleza / sahihisha / tafsiri ulicho-copy, au muulize
  kuhusu screen yako. Anajibu kupitia Claude Code au Codex yako, bila kufungua browser.

**Kila siku**
- **Muziki:** wimbo unaopiga, picha ya album (inajazwa yenyewe ikikosekana), mwaka wa wimbo, play/pause/ruka,
  kusogeza wimbo, na **lyrics** zinazoenda na wimbo: zi-scroll, bonyeza mstari wimbo uende hapo.
- **Simu kama chanzo cha muziki:** Windows: unganisha simu kwenye Bluetooth, kisha PC inakuwa spika yake (jina la wimbo
  halipiti, kwa hiyo hakuna lyrics). Mac: AirPlay kutoka iPhone, wimbo na lyrics zinaonekana.
- **iPhone kwenye Mac:** meseji mpya (aliyetuma na mstari wa kwanza) na simu inayoingia zinaonekana kwenye kisiwa. Zinasomwa
  kwenye Mac tu (Messages na Contacts kwa Full Disk Access, alert ya simu kwa Accessibility); hakuna kinachotoka nje.
- **Focus na Modes:** chora mstari wa dakika 1–60; modes za Kazi, Kusoma, Kulala na Game zenye timer, kuzuia YouTube
  na TikTok, na kurudisha kila kitu ukimaliza. **Mlinzi wa focus** anakuomba upumue kabla ya kufungua tovuti hizo.
- **Kalenda na Barua:** ingia na Google uone mchongo wa leo na mwezi, na idadi ya email ambazo hujasoma.
- **Mafaili:** dondosha mafaili kwenye kisiwa, yavute nje kwenda app nyingine, au yatume kati ya simu na PC kwa QR code
  kwenye mtandao wowote: Wi-Fi moja inaenda moja kwa moja, la sivyo kupitia relay ya Pip (encrypted end-to-end).
- **Noti** (mstari wa `[ ]` unakuwa kiduara cha kutiki), **ulizo-copy**, Wi-Fi na Bluetooth, sauti, hali ya hewa.
- **Akaunti ya Pip (hiari):** ingia na Google au email (code ya tarakimu 6, hakuna password); mipangilio, noti, mji na
  link ya kalenda vinakufuata kwenye kila PC au Mac yenye Pip.
- **Mac:** kisiwa kinakaa juu ya notch ya kamera, macho ya Pip pembeni kushoto; kila "PC" kwenye app inasomeka "Mac".
- **Kisiwa chako:** mwangaza wa background, ukubwa wa kisiwa (80–140%), uwazi, rangi na kofia ya Pip, kuficha tabs.

## Kuiwasha (kwa developers)

```
npm install
npm start           # kisiwa kinatokea juu ya screen; Ctrl+Alt+Space kinakifungua na kukifunga
npm test            # tests 38 za Node (OS yoyote)
npm run dist:win    # kwenye Windows: Pip.exe na installer ndani ya dist/ (inahitaji makensis kwenye PATH)
npm run dist:mac    # kwenye Mac: dist/Pip-<version>-mac.dmg (GitHub Actions inaitengeneza kila push)
PIP_HUB_PORT=48699 npx electron --no-sandbox tools/smoke.js out/   # smoke test kamili, pembeni ya Pip inayo-run
```

Kwenye Pip fungua **Settings → Ma-agent** kisha unganisha Claude Code au Codex. Codex itakuomba uzikubali hooks mpya
(andika `/hooks` ndani ya Codex). Kujibu kutoka kwenye kisiwa na asilimia ya matumizi vinahitaji Node.js kwenye PC.
Ukiwa tayari una status line yako kwenye Claude Code, Pip haiigusi.

## Kimejaribiwa mpaka wapi

Kwenye Windows 11 halisi: installer (kufunguka), jina na icon ya Pip, muziki (wimbo, picha, mwaka, lyrics), hali ya Wi-Fi na Bluetooth,
mlinzi wa focus, Google sign-in (kalenda na idadi ya email), kushiriki na simu kwenye Wi-Fi moja, na smoke test kamili
ya agent (session, ruhusa, kujibu, status line). Kwenye Mac halisi (mwenye project, Novemba 2026): vipengele vyote vinafanya kazi, pamoja na kisiwa juu ya notch, muziki,
Wi-Fi na Bluetooth, mlinzi wa focus na akaunti ya Pip. Hakijajaribiwa bado: Codex halisi, kuingia Spotify, kubadilisha
Wi-Fi/Bluetooth kwa kubonyeza, kusogeza wimbo kwa bar, Pip agent kufungua chat, na hali ya hewa (card ilionekana tupu).

## Ukiwa unatoka kwenye Peep

Pip zamani iliitwa **Peep**. Installer ya Pip inaondoa Peep na kuchukua nafasi yake: settings, login za Google na
Spotify, historia, mafaili na ma-agent uliounganisha vinahamia Pip vyenyewe. Hooks za Peep zinaendelea kufanya kazi
mpaka Pip izibadilishe kwa zake mara ya kwanza inapowaka.

## Kinachotoka nje ya PC yako

Ni vile ulivyowasha tu: jina la mji linaenda Open-Meteo (hali ya hewa); jina la wimbo na msanii vinaenda lrclib.net
(lyrics) na iTunes Search (mwaka na picha ya wimbo; Deezer kwa picha ambazo iTunes haina); link ya kalenda inasomwa; swali la screen na chat ya Pip vinaenda kwa
agent uliyemchagua kupitia akaunti yako; mipangilio, noti, mji na link ya kalenda ukiingia kwenye akaunti ya Pip
(inahifadhiwa pip.bang.co.tz; ukiingia kwa email, email yako inatumika kukutumia code tu); mafaili ya simu yakipita
relay ya pip.bang.co.tz (yame-encrypt-iwa, key haipiti server, yanafutwa baada ya saa moja); Spotify ukiiunganisha;
Google ukiingia (kalenda yako na idadi tu ya email ambazo hujasoma, sio nani wala nini); na pip.bang.co.tz kuangalia kama
kuna Pip mpya (ikiwaka na kila masaa sita, unaweza kuzima); kuangalia leseni, hash ya kitambulisho cha kifaa hiki tu
(sio kitambulisho chenyewe), kwenda pip.bang.co.tz ikiwaka na kila masaa sita; na ukinunua Pip kwa simu, namba yako
kwenda EvPay kupitia pip.bang.co.tz (kwa kadi unalipa kwenye ukurasa wa EvPay wenyewe). Hooks, ulivyo-copy, noti na mafaili vinabaki kwenye PC. Sera kamili: [pip.bang.co.tz/privacy](https://pip.bang.co.tz/privacy).

## Kutafsiri

Maneno yote yako kwenye `src/locales/sw.json` (English kushoto, Kiswahili kulia). Badilisha neno lolote usilolipenda;
test moja inahakikisha hakuna neno lililosahaulika. Lugha nyingine ni faili jipya la `<code>.json` kwenye folder hiyo.

## Kuitoa

Settings za Windows → Apps → Pip → Uninstall. Uninstaller inaondoa hooks za Pip kwenye Claude Code na Codex. Ukiitoa
kwa mkono, toa tiki za ma-agent kwenye Settings kwanza, au run `Pip.exe --remove-hooks`. Kwenye Mac: toa tiki za
ma-agent kwenye Settings, kisha futa Pip kwenye Applications.

Pip ni project ya BANG DIGITAL LTD inayojitegemea. Haitumii code wala michoro ya app nyingine yoyote ya aina hii.
