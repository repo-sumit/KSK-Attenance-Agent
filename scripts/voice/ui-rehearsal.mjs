// Spoken Voice Agent rehearsal (D-158): the real app, the real Gemini model, and the trainer's lines spoken by macOS
// `say` into Chromium's fake microphone. It records the card's states and captions, URL changes, the token status,
// the `[voice]` debug lines and screenshots, so a voice change can be heard end to end in `next dev` or `next start`.
//
//   npm run voice:ui-rehearsal -- <scenario.json> [--base http://localhost:3311] [--captions]
//
// The server it drives needs GEMINI_API_KEY (each run spends Gemini usage, and the persona's daily voice minutes on
// the Supabase source). Scenario (JSON):
//   { "preset": "open", "lang": "en" | "mr", "viewport": [1280, 800], "voice": "Rishi", "lead": 9,
//     "steps": [{ "say": "Electrician", "gap": 9, "voice": "Rishi" }], "tail": 10, "shotEvery": 3, "out": "<dir>",
//     "base": "http://localhost:3000", "simulation": { "camera": "simulated" } }
// `simulation` (optional) is applied through the demo controller once the preset has landed (for example the demo's
// simulated camera, so a face check passes without a real face in front of Chromium's fake camera).
// Timing: the microphone file starts when voice starts. `lead` seconds of silence come first (the greeting), then each
// line followed by its `gap` of silence, then `tail`. The default `out` is <os tmpdir>/ksk-voice-rehearsal/<name>.
// Never logs a token, the API key or the Live WebSocket URL: every logged text goes through redact().
// By default the card is logged as its status and the caption's length and a short hash (a change is still visible),
// and an open dialog only as "dialog open": no student names and no heard text reach the console or log.txt.
// `--captions` logs the card's and the dialog's full text instead: that writes names and what was heard to disk.
// The preset must start on Home (not first_time, which starts at the login screen).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const RATE = 16000;
const DEFAULT_BASE = 'http://localhost:3000';
const DEFAULT_VOICE = 'Rishi'; // en_IN

function fail(message) {
  console.error(`voice:ui-rehearsal: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let file;
  let base;
  let captions = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--captions') captions = true;
    else if (argv[i] === '--base') base = argv[++i];
    else if (argv[i].startsWith('--base=')) base = argv[i].slice('--base='.length);
    else if (!file) file = argv[i];
    else fail(`unexpected argument: ${argv[i]}`);
  }
  if (!file) fail('usage: npm run voice:ui-rehearsal -- <scenario.json> [--base <url>] [--captions]');
  if (base === undefined && argv.includes('--base')) fail('--base needs a URL');
  return { file, base, captions };
}

function loadScenario(file, baseArg) {
  let sc;
  try {
    sc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`cannot read ${file}: ${e.message}`);
  }
  if (!Array.isArray(sc.steps) || !sc.steps.every((s) => typeof s?.say === 'string' && s.say.trim())) fail('"steps" must be a list of { "say": "<text>" }');
  if (sc.lang !== undefined && sc.lang !== 'en' && sc.lang !== 'mr') fail('"lang" is "en" or "mr"');
  const name = path.basename(file).replace(/\.json$/i, '');
  return {
    name,
    base: (baseArg ?? sc.base ?? DEFAULT_BASE).replace(/\/+$/, ''),
    preset: sc.preset ?? 'open',
    lang: sc.lang ?? 'en',
    viewport: sc.viewport ?? [1280, 800],
    voice: sc.voice ?? DEFAULT_VOICE,
    lead: sc.lead ?? 9,
    steps: sc.steps,
    tail: sc.tail ?? 10,
    shotEvery: sc.shotEvery ?? 0,
    out: sc.out ?? path.join(os.tmpdir(), 'ksk-voice-rehearsal', name),
    simulation: sc.simulation ?? null,
  };
}

/** Tokens, keys and the Live URL never reach the log, even inside an SDK or browser message. */
function redact(text) {
  return String(text)
    .replace(/wss?:\/\/\S+/gi, '[ws-url]')
    .replace(/auth_tokens\/[\w.-]+/gi, '[token]')
    .replace(/([?&](?:access_token|key|token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/AIza[\w-]{20,}/g, '[key]');
}

/** The PCM samples of a WAV file `say` wrote. */
function pcmOf(wavPath) {
  const b = readFileSync(wavPath);
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'data') return b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${wavPath}`);
}

const silence = (seconds) => Buffer.alloc(Math.round(seconds * RATE) * 2);

function wavFile(data) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** One 16 kHz mono WAV: lead silence, each spoken line and its gap, then the tail. Returns its path, length and plan. */
function buildMicFile(sc) {
  const parts = [silence(sc.lead)];
  const plan = [];
  let at = sc.lead;
  sc.steps.forEach((step, i) => {
    const file = path.join(sc.out, `line-${i}.wav`);
    try {
      execFileSync('say', ['-v', step.voice ?? sc.voice, '--file-format=WAVE', `--data-format=LEI16@${RATE}`, '-o', file, step.say]);
    } catch (e) {
      fail(`say could not speak line ${i + 1} with voice ${step.voice ?? sc.voice} (list voices: say -v '?'): ${e.message}`);
    }
    const pcm = pcmOf(file);
    const gap = step.gap ?? 9;
    parts.push(pcm, silence(gap));
    plan.push(`${at.toFixed(1)}s trainer says: ${step.say}`);
    at += pcm.length / 2 / RATE + gap;
  });
  parts.push(silence(sc.tail));
  const data = Buffer.concat(parts);
  const wav = path.join(sc.out, 'mic.wav');
  writeFileSync(wav, wavFile(data));
  return { wav, seconds: data.length / 2 / RATE, plan };
}

function createLog() {
  const lines = [];
  const t0 = Date.now();
  let micT0 = null;
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s` + (micT0 ? ` (mic ${((Date.now() - micT0) / 1000).toFixed(1)}s)` : '');
  return {
    lines,
    micStarted: () => (micT0 = Date.now()),
    raw: (text) => lines.push(text),
    log: (text) => {
      const line = `${stamp()} ${redact(text)}`;
      lines.push(line);
      console.log(line);
    },
  };
}

/** The card's status and text, and an open dialog's text (the verification gateway, a sheet). Runs in the page. */
function readCard() {
  const sec = document.querySelector('section[data-voice-status]');
  const dlg = document.querySelector('[role="dialog"]');
  const flat = (el, n) => (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, n);
  return { status: sec ? sec.getAttribute('data-voice-status') : null, card: sec ? flat(sec, 260) : '', dialog: dlg ? flat(dlg, 120) : null };
}

/** What is logged of the card: its full text only with --captions (names, heard text); otherwise its length and hash. */
function describeCard(state, captions) {
  if (!state.status) return state.dialog === null ? 'no card' : `no card || ${captions ? `dialog: ${state.dialog}` : 'dialog open'}`;
  const hash = createHash('sha256').update(state.card).digest('hex').slice(0, 8);
  const card = captions ? `${state.status} | ${state.card}` : `${state.status} | ${state.card.length} chars #${hash}`;
  if (state.dialog === null) return card;
  return `${card} || ${captions ? `dialog: ${state.dialog}` : 'dialog open'}`;
}

async function rehearse(sc, mic, out, captions) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${mic.wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const [width, height] = sc.viewport;
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', permissions: ['microphone', 'camera', 'geolocation'] });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' || text.includes('[voice]')) out.log(`console.${m.type()}: ${text.slice(0, 300)}`);
    });
    page.on('pageerror', (e) => out.log(`pageerror: ${e.name}: ${e.message.slice(0, 300)}`));
    page.on('response', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/voice')) out.log(`token ${r.status()}`); // the status only, never the body
    });
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) out.log(`url ${new URL(f.url()).pathname}`);
    });

    await page.goto(`${sc.base}/?preset=${encodeURIComponent(sc.preset)}&voiceDebug=1`, { timeout: 120_000 });
    await page.waitForURL(/\/(home|login)/, { timeout: 120_000 });
    if (new URL(page.url()).pathname.startsWith('/login')) throw new Error(`preset "${sc.preset}" starts at the login screen; use a preset that starts on Home`);
    if (sc.simulation) {
      await page.waitForFunction(() => '__kskDemo' in window, null, { timeout: 60_000 });
      await page.evaluate((patch) => window.__kskDemo.setSimulation(patch), sc.simulation);
    }
    if (sc.lang === 'mr') {
      await page.locator('header').getByRole('button', { name: 'Profile', exact: true }).click();
      await page.getByRole('dialog', { name: 'Profile' }).getByRole('radio', { name: 'मराठी' }).click();
      await page.keyboard.press('Escape');
    }
    const button = page.getByRole('button', { name: /Voice Agent|व्हॉइस एजंट/ }).first();
    await button.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1200);
    await button.click();
    out.micStarted();
    out.log('voice started (the microphone file begins now)');

    let last = '';
    let shot = 0;
    const every = sc.shotEvery * 1000;
    let nextShot = every ? Date.now() + every : Infinity;
    const end = Date.now() + (mic.seconds + 4) * 1000;
    while (Date.now() < end) {
      await page.waitForTimeout(400);
      const state = await page.evaluate(readCard).then((s) => describeCard(s, captions), (e) => `read failed: ${e.message.slice(0, 80)}`);
      if (state !== last) {
        out.log(`card ${state}`);
        last = state;
      }
      if (Date.now() >= nextShot) {
        await page.screenshot({ path: path.join(sc.out, `shot-${String(++shot).padStart(2, '0')}.png`) });
        nextShot += every;
      }
    }
    await page.screenshot({ path: path.join(sc.out, 'final.png') });
  } finally {
    await browser.close();
  }
}

if (process.platform !== 'darwin') fail('this tool speaks the trainer\'s lines with macOS `say`; run it on a Mac');
const args = parseArgs(process.argv.slice(2));
const sc = loadScenario(args.file, args.base);
mkdirSync(sc.out, { recursive: true });
const mic = buildMicFile(sc);
const out = createLog();
out.raw(`scenario: ${sc.name} · preset ${sc.preset} · ${sc.lang} · ${sc.viewport.join('×')} · ${sc.base}`);
mic.plan.forEach((line) => out.raw(`plan: ${line}`));
try {
  await rehearse(sc, mic, out, args.captions);
} catch (e) {
  out.log(`rehearsal failed: ${e.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(sc.out, 'log.txt'), out.lines.join('\n') + '\n');
  console.log(`log and screenshots: ${sc.out}`);
}
