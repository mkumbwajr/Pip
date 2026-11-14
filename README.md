# Peep

Kisiwa kidogo juu ya screen yako ya Windows kinachokuonyesha ma-agent wako wa AI (Claude Code na Codex) wanafanya
nini. Pip, kale ka-mascot, anakushtua agent akikuhitaji na akimaliza kazi.

Ni bure na open source (MIT). Hakuna akaunti, hakuna malipo, hakuna telemetry. App nzima iko kwa Kiswahili cha
mtaani cha Tanzania; English ipo kwenye Settings ukiitaka. [English README](README.en.md)

Download: [Releases](https://github.com/mkumbwajr/peep/releases). Installer haina signature bado, kwa hiyo Windows SmartScreen
itakuonya; bonyeza "More info" kisha "Run anyway". Bado hakuna auto-update.

## Inafanya nini

- **Ma-agent live:** unaona Claude Code na Codex wanasoma, wana-edit au wana-run nini, pamoja na history ya kazi.
- **Ruhusa:** Claude Code akiomba ruhusa, unabonyeza Ruhusu au Kataa hapo hapo kwenye kisiwa.
- **Mjibu hapa hapa:** Claude Code akimaliza au akiuliza swali, unamjibu kwenye kisiwa bila kurudi kwenye terminal.
- **Ma-agent wanajibu kwa Kiswahili:** kila session mpya inaambiwa ijibu kwa Kiswahili cha Tanzania (unaweza kuzima).
- **Matumizi ya Claude:** bar za limit ya masaa 5 na ya wiki.
- **Uliza kuhusu screen:** Pip anapiga screenshot ya screen nzima au ya window moja, kisha anamuuliza agent wako.
- **Muziki:** wimbo unaopiga, play/pause, sauti, lyrics, na kuchagua kifaa cha Spotify.
- **Mafaili na simu:** dondosha mafaili yawe karibu, kisha yatume kwenye simu (au kutoka simu) kwa QR kupitia Wi-Fi yako.
- **Vingine:** ulizo-copy karibuni, noti ya haraka, focus timer, hali ya hewa, kalenda, Wi-Fi na Bluetooth, mlinzi wa focus.

## Kuiwasha

```
npm install
npm start        # kisiwa kinatokea juu ya screen; Ctrl+Alt+Space kinakifungua na kukifunga
npm test         # tests (Node tu, zinafanya kazi kwenye OS yoyote)
npm run dist     # installer ya Windows ndani ya dist/ (i-run kwenye Windows)
```

Fungua **Settings** kwenye kisiwa, kisha tiki **Fuatilia Claude Code** au **Fuatilia Codex**. Codex itakuomba
uzikubali hooks mpya (andika `/hooks` ndani ya Codex).

Kujibu ukiwa kwenye kisiwa na bar za matumizi vinahitaji Node.js kwenye PC. Ukiwa tayari una status line yako kwenye
Claude Code, Peep haiigusi; bar za matumizi hazitaonekana mpaka uiondoe.

## Kimejaribiwa mpaka wapi

Bado hakijawahi ku-run kwenye Windows halisi. Kilichojaribiwa ni tests 20 za Node na smoke test kwenye Linux
(hooks, ruhusa, kujibu, matumizi, UI). Vya Windows tu (muziki, sauti, Wi-Fi/Bluetooth, mlinzi wa focus, installer)
vimeandikwa lakini havijajaribiwa. Ukipush kwenye GitHub, workflow ya `build` inavijaribu kwenye Windows na
kutengeneza installer.

## Kinachotoka nje ya PC yako

Ni vile ulivyowasha tu: jina la mji linaenda Open-Meteo, jina la wimbo na msanii vinaenda lrclib.net (lyrics) na iTunes Search (mwaka wa wimbo), link ya kalenda
inasomwa, swali la screen linaenda kwa agent uliyemchagua kupitia akaunti yako, Spotify ukiiunganisha, Google ukiingia (kalenda yako, idadi ya email ambazo hujasoma, na mtumaji na subject ya email 5 za karibuni; maandishi ya email hayasomwi kamwe), na GitHub
ukibonyeza Updates (kuangalia toleo jipya). Hooks,
ulivyo-copy, noti na mafaili vinabaki kwenye PC.

## Kutafsiri

Maneno yote yako kwenye `src/locales/sw.json` (English upande wa kushoto, Kiswahili upande wa kulia). Badilisha neno
lolote usilolipenda humo; test moja inahakikisha hakuna neno lililosahaulika. Lugha nyingine ni faili jipya la
`<code>.json` kwenye folder hiyo hiyo.

## Kuitoa

Uninstaller inaondoa hooks zenyewe. Ukiitoa kwa mkono, toa tiki za ma-agent kwenye Settings kwanza, au run
`Peep.exe --remove-hooks`.

Peep ni project inayojitegemea. Haitumii code wala michoro ya app nyingine yoyote ya aina hii.
