# FlowKeep — AI Session Manager (V1)

Live token tracking, pre-flight checks, auto snapshots, and one-click handoff so you
never lose flow when Claude hits its limit. Built as a standard WebExtension — runs on
Chrome, Brave, Edge, Opera, Arc, Vivaldi, and Firefox from one codebase.

## What V1 does

- **Live gauge** — a draggable badge on claude.ai showing estimated session usage with a
  color-graded bar (teal → amber → red) and a reset countdown.
- **Pre-flight check** — as you type, warns when a prompt is projected to overrun your
  remaining budget before you get a full answer.
- **Auto snapshot** — at 80% usage it quietly saves a compressed summary of the session
  (the goal + recent context + a resume instruction), stored locally.
- **One-click handoff** — copies the snapshot to your clipboard and opens Gemini / ChatGPT
  / Groq so you can paste and keep going.

## Install (Chrome / Brave / Edge / Opera / Arc)

1. Go to `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `flowkeep` folder.
4. Open [claude.ai](https://claude.ai) — the gauge appears bottom-right.

## Install (Firefox)

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick `manifest.json` inside this folder.
   (Temporary add-ons clear on restart; a signed build is needed for permanent install.)

## Honest limitations (read this)

- **Token counts are estimates.** Anthropic doesn't publish Claude's tokenizer, so usage
  is computed heuristically from the conversation text. Expect roughly ±10–15%. If Claude's
  own API returns real rate-limit data, the extension uses that instead — but that's
  best-effort and the endpoints can change.
- **Session budget is a setting, not a fact.** Plan caps aren't public and shift over time.
  Pick the closest preset in the popup and nudge it to match when you actually hit a wall.
- **Handoff pastes, it doesn't auto-inject.** V1 puts your snapshot on the clipboard and
  opens the other model; you paste it in. Auto-injection per platform is a later version.
- **DOM selectors are defensive but fragile.** If Claude restructures its UI, scanning may
  need an update.

## File map

```
manifest.json          cross-browser MV3 manifest
background.js           service worker — notifications + handoff tabs
lib/browser-polyfill.js chrome/browser namespace shim
src/tokenizer.js        token estimation heuristic
src/inject.js           page-context network interceptor (real usage capture)
src/content.js          badge, live estimation, pre-flight, snapshot, handoff
src/badge.css           injected gauge styles
popup/                  toolbar popup (control panel)
icons/                  gauge-motif icons
```

## Roadmap

- V1.5 — same features on ChatGPT, Gemini, Perplexity
- Paid — Mission Mode, prompt compression, model-agnostic continuity, usage dashboard

## Author

Karthik K — B.Tech CSE, Mahindra University · [GitHub](https://github.com/plimmgoesbrr)
