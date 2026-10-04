@AGENTS.md

# KSK Attendance MiniApp (Maharashtra)

A mobile-first attendance MiniApp for **ITI craft instructors and principals in Maharashtra**, opened inside the **SwiftChat Android WebView**. Instructors mark student attendance once per batch (or per half-day / period, by configuration). Principals see the whole institute, mark staff, and correct same-day mistakes with a reason and an audit trail. This build runs entirely on **mock data** behind repository interfaces, with a floating **demo panel** for stakeholder demos. Real APIs plug in later without UI changes.

## Sources of truth (in this order)

1. `Doc/PRD.pdf`: product rules, configuration registry, invariants.
2. `prototype/Prototype.html`: the approved clickable prototype. It is authoritative for layout, copy and flow.
3. `Doc/swiftchat-design-system.md`: SwiftChat DS. It is authoritative for tokens and components. Use light mode only.
4. `Doc/mh_ksk_logo.png`: the brand logo. **Never modify the original.** Derived icons come from `npm run icons`.

`Doc/swiftchat.png` was referenced by the brief but is missing (see `docs/DECISIONS.md` D-004). Features the PRD doesn't have (Home announcements, per-batch refresh, the at-risk report, Voice mode) are extensions, recorded in D-053–D-055 and D-078–D-132.

Deeper docs are in `docs/`: PRODUCT_CONTEXT, ARCHITECTURE, DESIGN_SYSTEM, CONFIGURATION, DATA_MODEL, DEMO_GUIDE, TESTING, DECISIONS. Voice mode has its own folder, `docs/voice/` (design spec, plan, `REPO_MAP.md`, `RUNBOOK.md`).

## Commands

```bash
npm install
npm run dev          # http://localhost:3000 (demo mode via .env.development); predev copies the MediaPipe wasm into public/vendor
npm run lint         # ESLint 9 flat config, including the architecture boundaries below
npm run typecheck    # tsc --noEmit
npm test             # Vitest: unit + integration (tests/unit, tests/integration)
npm run e2e          # Playwright: builds, serves on :3200, Pixel 5 at 360px, Asia/Kolkata
npm run build        # production build (all pages static, one route handler: /api/voice/token); prebuild runs scripts/vendor-mediapipe.mjs
npm run check        # lint + typecheck + test + build
npm run check:demo   # builds with NEXT_PUBLIC_DEMO_MODE=false into .next-nodemo and greps that no demo code shipped
npm run icons        # regenerate public/branding/* and src/app/{icon,apple-icon}.png, favicon.ico from the logo
npm run test:voice-live    # opt-in: text turns through the real executor and gemini-3.8-live (needs GEMINI_API_KEY in .env.development)
npm run voice:spike-token  # opt-in: mint a token, connect, time to first audio
npm run voice:spike-voices # opt-in: render sample lines with 8 prebuilt voices to WAV in os.tmpdir()/ksk-voice-spike
```

`.env.development` is git-ignored, so a fresh clone has none: `cp .env.example .env.development`, then set `GEMINI_API_KEY=`. Without the file the three voice commands stop with "not found" (Node's `--env-file`); with the file but no key, `test:voice-live` skips.

The Node range is `>=20.9 <27`. This is Next.js **16** with React 19.2. Read `node_modules/next/dist/docs/` before using an unfamiliar API (see AGENTS.md).

## Architecture rules (enforced by ESLint; see `eslint.config.mjs`)

```
UI (src/app, src/features, src/components, src/hooks)
  → services (src/services)          ← composition root: src/services/container.ts
    → repository interfaces (src/repositories/interfaces)
      → mock impl (src/repositories/mock) | API impl (src/repositories/api, stubs)
domain (src/domain) and config (src/config) are pure TypeScript: no React, Next, services or storage.
```

- The UI **never** imports `@/data/*`, `@/repositories/mock|api`, `@/demo/*` or `@/server/*`. It reads data only through `useServices()` / `useQuery()`.
- `src/server` (voice token mint and guards) is server-only: only `src/app/api/**` may import it, and it never imports React, hooks, components, features, services, demo code, mock data or mock repositories.
- The UI **never branches on a role or a person**. `journey.isPrincipal` is lint-forbidden in UI code. Voice exists only when `journey.voice.enabled`. Screens read capabilities from `useJourney()` (`src/config/journey.ts` is the only place that decides what exists). A disabled feature is *absent*, not hidden.
- Integrity rules (submit once, no backdating, principal-only same-day corrections with a reason, time fence, verification before the list, one staff mark per day) live in `src/domain/rules.ts`. Services and repositories enforce them. Hiding a button is never the only guard.
- Corrections are append-only. The original submission is never modified. `effectiveMarks()` folds corrections over it.
- All dates and times are IST (`src/lib/time.ts`). Inject `Clock`; never call `new Date()` in domain code.
- CSS Modules only. Every colour, radius, type size and spacing value is a token from `src/styles/tokens.css` / `typography.css` (a unit test lints this). No UI libraries.
- Files over 300 lines trigger a lint warning. Split them.

## SwiftChat Design System rule

Use SwiftChat semantic tokens and the kit in `src/components/ui`. Montserrat is the English font and Mukta the Marathi font (`:lang(mr)` switches the type variables). Status is always icon + text + colour. Every roster that marks attendance uses `AttendanceStatusSelect` (one native select per person, options only from configuration, OJT and saved marks as `LockedStatus`, D-062) on a white row (no status tints; follow-ups inside the row, D-070). Every attendance total uses `AttendanceSummary` (one tile per configured status; Present counts by presence weight, half day ½ and OJT 1, D-069). Short row states use `StatusLine`, quiet guidance `InlineNote`, list cards `Card divided`, and waiting records the `SyncPendingCard` (D-064, D-068). Home never manages offline data (D-071). Touch targets are ≥ 44px and primary CTAs are 56px. The only deviations from the DS and prototype are documented in `docs/DECISIONS.md` (for example, the AA contrast overrides in D-010). Do not restyle beyond them.

## Responsive rule: mobile-first is not a fixed mobile viewport

- Phones (320–599px) are the primary design. From 600px the app fills the viewport, and content keeps a readable column on the DS grid (margins 16/36/64). Choose each screen's column with `ScreenLayout width="form" | "reading" | "wide"` (480/800/1008), and use `card` for single-question screens. Never reintroduce a phone-width frame.
- Wider screens get **no new features**: the same hierarchy, at most two columns, the roster always a row list (never a table), primary actions 280px and centred.
- **One header:** `AppHeader` (`src/features/shell`) on every signed-in screen: brand left, avatar top right (always the right-most control). Primary navigation is `journey.navTabs`: **Home · Reports** for instructors (Home owns today's classes) and **Home · Attendance · Reports** for the principal. It is the bottom nav on phones and a header row from 600px, never a sidebar. Class-marking task screens take their `area`/back target from `useAttendanceRoot()`. **Profile is not a destination:** the avatar opens `ProfileMenu`, the only profile entry point. Offline data lives under Reports (`/reports/offline`). See `docs/DESIGN_SYSTEM.md` → Responsive behaviour and D-045/D-046/D-052/D-056.

## Mock data and simulation

- `src/data/mock/*` holds deterministic master data (Govt ITI Pune, code **27410**: 5 trades, 17 batches, 417 students; a second institute in Nashik), history generated at read time for past working days (including the ES instructor's sessions), and six announcements. `seeds.ts` builds today's story relative to the current date.
- The mock DB (`src/repositories/mock/database.ts`) lives in localStorage namespace `ksk:v1`. It **reseeds automatically when the calendar day changes** and on schema bumps.
- Location, face-match outcome, camera choice, permissions, network, sync failure and speed come from a `SimulationSource`. Services wait a simulated network time (`simulatedDelay`, scaled by speed, 0 in tests) so loading states are real (D-059).
- **Face (D-048):** three seams.
  - `FaceCaptureService` opens the **real front camera** (getUserMedia). The demo can switch to a simulated one.
  - `LivenessService` is a **prototype movement check** with MediaPipe BlazeFace on the device, falling back to guided countdown captures.
  - `FaceMatchService` is **simulated** (`MockFaceMatchService`): it never compares faces.
  - Photos are in-memory only: never stored, never sent. Never describe any of this as secure biometrics or liveness detection in UI or docs. MediaPipe is pinned to 0.10.35 (1.x phones home, D-049).
- Location results carry `source: 'device' | 'simulated'`.
- `src/repositories/api/*` are typed stubs that throw `NotImplementedError` and document the endpoints each method will call.

## Configuration

`AppConfiguration` (`src/config/types.ts`) is resolved in layers: product defaults → Maharashtra state floor (`src/config/states/maharashtra.ts`) → district/institute layers (only keys the state lists in `overridableKeys`) → demo overrides (persona patch, then demo-panel changes; demo builds only). `validate.ts` rejects invalid combinations. Every option and its user-visible effect is described in `docs/CONFIGURATION.md`.

## Demo layer

`src/demo/*` holds the demo state (`ksk-demo:v1`), the demo clock (fixed 10:15 IST by default), the simulation source, personas, 7 presets and the panel. The panel is a collapsed **Demo** trigger portaled into the header's tool slot, immediately left of the avatar on every signed-in screen (`src/components/shell/ToolSlot.tsx`; it floats only on headerless screens and sets `html[data-demo-float]`, D-057, D-066). It opens a bottom sheet on phones and a non-modal drawer on the right from 600px, and never takes layout space. It is ordered Quick presets → Quick login → Advanced (collapsed). **Use demo account** on the login screens (five accounts) arrives only through the `LoginAssistSource` seam (`services.loginAssist`, null in production). Picking an account prepares its preset and fills the field; nothing is filled or submitted without a tap (D-058). The demo layer is loaded only when `NEXT_PUBLIC_DEMO_MODE === 'true'`, through inline env comparisons, so a demo-off build tree-shakes it (verified by `npm run check:demo`). `next.config.ts` defaults the flag to `true` when it is unset, so the deployed (git-built) Vercel site keeps the demo (D-067). Presets can be opened by URL: `/?preset=open|batch|timetable|es|principal|first_time|offline`. `window.__kskDemo` exposes the controller for E2E tests. See `docs/DEMO_GUIDE.md`.

## Voice agent (Voice mode, D-078 to D-133)

An instructor marks a batch by speaking, in English or Marathi, mixed freely with taps. Design: `docs/voice/2026-10-02-voice-mode-design.md`. Code map: `docs/voice/REPO_MAP.md`. Operations: `docs/voice/RUNBOOK.md`. The tap flow keeps working at every moment; voice is optional.

- **UI (D-133).** One floating element, `VoiceFloat`, rendered once by `VoiceProvider` (inside `SessionGate`) on every instructor screen where voice is available: a round mic button at the bottom-right (a "Voice mode" pill from 600px) that grows into the voice card (`VoiceCard`: status as icon + text + colour, caption, Use screen/Resume, Stop voice, Reconnect, push-to-talk) and can be minimized to a round status button while voice keeps running. It sits on the screen's dock anchor (`DockAnchor`, above the footer and bottom nav); `<html data-voice-float>` makes screens reserve a band for the card, so it never covers a row or the Submit button, and scroll room for the button. Start stays synchronous in the click.

- **Model and SDK.** `gemini-3.8-live` through `@google/genai`, pinned to exactly `2.26.0` (never `@google/generative-ai`). In the browser the SDK is only in `src/services/voice/live/gemini.ts`, loaded by `import()` when a live session starts; on the server only `src/server/voice/token.ts` uses it. The client connects with the model the token was minted for (`VOICE_MODEL` in `src/server/voice/token.ts`); its own copy is only a fallback (D-131).
- **Browser-direct (D-078).** The browser connects to Gemini Live with a single-use token from `POST /api/voice/token` (`src/app/api/voice/token/route.ts`, helpers in `src/server/voice`). The server holds `GEMINI_API_KEY` (never a `NEXT_PUBLIC_` name, never committed, never logged). The page never sees the key. `VOICE_DISABLED=1` is the kill switch. There is no relay; a relay and Vertex are a later phase.
- **Config and plan.** `voice.*` configuration (CONFIGURATION.md) → `journey.voice` → `compileFlowPlan(ctx, screenLanguage)` (`src/domain/voice/plan.ts`) once per voice session. Marking by exception needs a Present default: any other default starts a roll call, whatever `voice.markingStyle` says (D-117). The prompt (`prompt.ts`), the tool list (`tools.ts`) and every `[APP]` text are built from the plan. A disabled feature has no tool and no prompt line. Voice is on the instructor Home only (D-087).
- **Tools.** Every declaration sets `behavior: 'BLOCKING'`. A result is sent as `{ id, name, response: { output: result } }`, with the `id` key always present (the SDK throws without it; a call without an id is answered with `id: undefined`). One `sendToolResponse` per `toolCall`, in the model's order. The calls of one message run one at a time in `toolCallOrder` (`mark_remaining` after the per-student marks), and calls from consecutive messages share one per-connection queue (the SDK does not await `onmessage`). A throwing handler answers `INTERNAL` with the "say sorry and repeat your last question" instruction; an unknown name answers `UNKNOWN_TOOL`. Results are `{ ok, instruction, … }` plus the snapshot; model-facing enums are uppercase and mapped at the executor boundary (`parseModelStatus`).
- **Executor (D-079).** `createExecutor` (`src/services/voice/executor.ts`, handlers in `handlers/`) calls only `AttendanceService`, `VerificationService` and `MarkingDraftService`, so every rule that holds for a tap holds for voice. It has no browser globals. Every handler re-reads the draft after each `await`.
- **Text to the model.** The kickoff, `[APP]` events and typed text go through `sendRealtimeInput({ text })`; audio through `sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } })`. Never `media`, never `sendClientContent`. Send `audioStreamEnd` whenever the microphone pauses. Model-facing strings are English; UI strings are `voice.*` keys in `en.ts` with Marathi in `mr.ts`.
- **Live config.** Audio replies only, input and output transcription on, `contextWindowCompression` 25 000 / 8 000, `sessionResumption: {}` or `{ handle }` (never `transparent`), VAD start LOW / end HIGH / prefix 100 ms / silence 500 ms. Never set `thinkingConfig`, `proactivity`, `enableAffectiveDialog`, `generationConfig` or `speechConfig.languageCode`, and never put `httpOptions` inside the `LiveConnectConfig` (`liveConfig` in `live/transport.ts` is the one place).
- **Audio.** Input PCM16 mono 16 kHz in 640-sample (40 ms) chunks from the same-origin worklet `/voice/mic-worklet.js`. Output PCM16 mono 24 kHz, played gapless. Process every part of every server message. On `interrupted`, flush playback first and play nothing from that message. Both AudioContexts are created and `resume()`d synchronously in the click handler, before any `await` (`VoiceService.start` is synchronous for that reason). The SDK's `ai.live.connect()` never rejects when setup fails, so `gemini.ts` races it against the first close and a 10 s timer; `LiveTransport.connect()` rejects in both cases.
- **goAway (`session-swap.ts`).** At the first quiet moment (nothing playing, no trainer utterance unanswered, no tool running) or at `timeLeft − 2.5 s`: fetch a fresh token while the old connection still works, close the old one, connect with the resumption handle, send the executor's refresh text (spoken facts, never "stay silent"), then replay the held mic audio (at most 3 s), preceded by the 0.64 s pre-roll only after a quiet-moment swap (D-121). A pause the swap held reaches the new connection as the pause text. Generation numbers drop answers for an old connection. An unexpected close shows **Reconnect** in the dock (new AudioContexts need a tap); it resumes with the handle once, then without it. Three failed connects in a row (across Reconnect taps) stop voice with `failures` (D-114).
- **Confirmation tokens (D-082).** `submit_attendance` and `mark_remaining` need a code the executor issued with its question: bound to the action, arguments, draft revision and connection, valid 2 minutes, accepted only after the model's asking turn ended (`turnComplete` or `interrupted`) and a new trainer turn began after it (`TrainerTurns`, `src/services/voice/trainer-turns.ts`; late transcript fragments never count, D-112), voided by any draft change, a new connection, expiry, or (for the submit code) the flow leaving the review (D-110). Never a boolean the model fills in. The submit question carries its code, so one clear yes submits (D-102). Not configurable. The clock for the TTL is real elapsed time (`performance.now()`), not the demo clock.
- **The live draft (D-084).** One `MarkingDraftService` draft per session key sits behind taps and voice: marks, the source of each trainer mark (`tap` or `voice`, at most 160 characters heard, kept in memory only while `voice.transcriptRetentionDays` is 0: the saved draft has `{ via, at }`, D-113), a revision and change events. While either submit (the screen's or voice's) saves, the draft refuses every mark (`beginSubmit` / `whileSubmitting`); voice answers `SUBMITTING` and issues no code (D-111). Defaults and presets (OJT, carried leave) are not trainer marks. OJT stays locked for voice (D-101). Leaving a batch never drops marks, so there is no "marks will be lost" question (D-083). `AttendanceService.saveDraft` remains for integration tests only.
- **Action Bus (D-085).** The screen changes only from typed, sequenced bus events (`navigate`, `show_trade`, `focus_student`, `verify_retry`, `end_voice`), applied by `useActionBus` and the screens that own the state. Never from model text. A navigation to the URL already shown is skipped. A running session ends itself after its goodbye line: `end_voice` does not `stop()` it.
- **Taps flow back.** A tap on the draft, a tap navigation (`useScreenSync` → `onScreen`), a trade tapped on Home's switcher and verification events (`VerificationService.subscribe`) reach the model as `[APP]` texts. Their texts are dropped (not queued) while the session is paused or not live, but the executor still follows them quietly (no question, no code, no navigation), also while Reconnect shows; the kickoff runs on the tool queue after them and reads the moved flow (D-122).
- **Verification (D-086).** The existing full-screen gateway stays. Student fields are returned only after the pass; `openRoster` and `submit` enforce INV-16. The microphone pauses while the face camera is on. Location has no override. Distances in `[APP]` texts are formatted by the app, not the model.
- **Caps (D-089).** Client-enforced: minutes per session (across reconnects), daily minutes per trainer (`VoiceUsageRepository`), idle timeout, 40 tool calls a minute, 5 failures in a row, 3 failed connects in a row. Trainer speech, taps, screen and verification signals, tool calls and the page becoming visible again are activity; only Use screen on a visible page holds the idle clock. A hidden WebView stops the microphone and pauses after 20 s, and that pause keeps the idle clock running (D-119, D-120). The server enforces token expiry, a per-IP limit (D-107), the Origin check and the kill switch.
- **Privacy and logs.** No audio is stored. Captions and the heard text stay in memory (`voice.transcriptRetentionDays` 0, D-113). Never log audio, tokens, the API key, the WebSocket URL, student names or the `heard` text. Debug lines are `console.info('[voice] …')` behind `?voiceDebug=1` through `voiceDebug()` (`src/services/voice/debug.ts`), ids and codes only; once seen, the flag holds for the rest of the page load, across the app's own navigation (D-130). Never `console.error` for an expected condition: E2E fails on any console error. Say in the UI that voice is processed by Google; do not call it secure biometrics.
- **Scripted transport for tests and demos.** `ScriptedLiveTransport` and `SilentAudio` (`src/services/simulated/voice.ts`) stand in for Gemini and the microphone when `simulation.voice === 'scripted'`. `window.__kskDemo.voice` plays the model (`toolCall`, `speak`, `emit`, `texts`, `responses`, `drop`, `goAway`, `denyMic`); a scripted confirmation needs `emit({ turnComplete: true })` before the trainer's `speak(…)` (D-112). CI and `npm run e2e` need no key, no network and no microphone. Model-facing wording (prompt, instructions, `[APP]` texts) is tuned against the live model: change it only with a `npm run test:voice-live` rehearsal.
- **Demo.** Every preset turns voice on; presets keep the presenter's voice model; `PRESETS_VERSION` re-applies a stored preset once (D-106, D-108). Voice demo code stays in `src/demo`, and `npm run check:demo` asserts it does not ship.

## Testing expectations

- Put domain rules and config resolution under unit tests (`tests/unit`). Put service flows, including lock, offline sync, correction and staff rules, under integration tests against the mock container (`tests/integration`, including `voice-executor.test.ts` and `voice-service.test.ts`). Voice wording and flow changes also get one `npm run test:voice-live` run.
- E2E (`tests/e2e`) covers the 10 key flows, plus Home (`home.spec.ts`), Reports and Offline data (`reports.spec.ts`), wide-screen layout (`desktop.spec.ts`), the status select and OJT lock (`status-select.spec.ts`), "Use demo account" (`login-assist.spec.ts`), the real camera on Chromium's fake device (`camera.spec.ts`), regressions found in review (`regressions.spec.ts`), and Voice mode on the scripted model (`voice.spec.ts`, `voice-diagnostics.spec.ts`). The shared fixture fails a test on **any console error or React warning**, and runs on the demo's simulated camera.
- Before finishing a change, run `npm run check`. If the UI changed, also run `npm run e2e` and look at the screen at 320px, 360px and one desktop width (1280px).

## Deployment

The app is Vercel-ready and **prepare-only: do not deploy unless the user asks**. `npm run build` prerenders every page as static and needs no secrets at build time. The one route handler, `POST /api/voice/token` (nodejs runtime), reads the server variables `GEMINI_API_KEY`, `VOICE_DISABLED` and `VOICE_ALLOWED_ORIGINS` at request time: set them in the Vercel project, never with a `NEXT_PUBLIC_` name. Without a key the route answers 503 and only Voice mode is unavailable; see `docs/voice/RUNBOOK.md` (including what to set up before a key goes on a public deployment). The build is the stakeholder demo unless `NEXT_PUBLIC_DEMO_MODE=false` is set: `next.config.ts` defaults it to `true`, because `.gitignore` keeps `.env.production` out of git and Vercel builds from git (D-067). Set it to `false` in the Vercel project for a real rollout once the API repositories exist. `.env.example` documents the flag.

## Working agreements for this folder

- **Git is the owner's.** Do not commit or push unless asked.
- Do not deploy. Do not add secrets or credentials to client code.
- For small, reversible ambiguities, choose the safest option and record it in `docs/DECISIONS.md`. Ask before any change that would materially alter product behaviour.

## Skills and tools used to build this

- **Skills** (installed globally, not reinstalled): `workflow-authoring` for orchestrating reviews; the `impeccable`, `design-taste-frontend`, `huashu-design` and `web-design-guidelines` critique lenses (the prototype and DS stayed authoritative over them); `nextjs-best-practices` and `vercel-react-best-practices` as references.
- **Browser checks:** Playwright scripts (headless Chromium, Pixel 5 profile) for screenshots at every QA size (320×568 to 1920×1080), prototype-vs-app comparison sheets, axe-core accessibility scans, overflow probes, and Chromium's fake camera for the face flows. No browser MCP was needed.
- **Research and review workflows** (multi-agent): the DS grid and navigation specs, MediaPipe evaluation (size, API, telemetry, delegates, thresholds), the E2E dependency map, Next 16 headers and WebView camera/geolocation requirements; then a five-lens review (acceptance, phone visuals, wide visuals, code, camera honesty), each lens adversarially verified.
- **MCP:** a Vercel MCP connector was available but was **not used** (prepare-only). No other MCPs were used.
