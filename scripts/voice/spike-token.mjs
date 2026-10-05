// Spike (Voice Agent, Task 2, Step 1): which Gemini API version carries the whole ephemeral-token path?
//
// For each version it mints a single-use token with the MVP settings (the same call src/server/voice/token.ts
// makes), connects to Gemini Live with that token, sends one text turn and prints the version, how long the
// mint, the connect and the first audio part took, and the spoken reply as a transcript.
//
//   npm run voice:spike-token        (loads GEMINI_API_KEY from .env.development)
//
// The key and the token are secrets: neither is ever printed. Everything that comes back from the SDK or from
// Google (error texts, close reasons) goes through redact() first, and the WebSocket URL (it holds the token) is
// never printed.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.8-live';
const VERSIONS = ['v1alpha', 'v1beta'];
const MINT_TIMEOUT_MS = 8_000;
const CONNECT_TIMEOUT_MS = 10_000;
const TURN_TIMEOUT_MS = 20_000;
const PROMPT = 'Say: namaste, the voice spike works.';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set. Put it in .env.development (server only, never a NEXT_PUBLIC_ name).');
  process.exit(2);
}

/** Every secret seen so far (the key, then each token); replaced in anything we print. */
const secrets = [apiKey];
function redact(value) {
  let text = String(value ?? '');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text
    .replace(/(access_token|key)=[^&\s"']+/gi, '$1=[redacted]')
    .replace(/auth_tokens\/[\w.=-]+/g, 'auth_tokens/[redacted]');
}

const ms = (from, to) => Math.round(to - from);

/** A timer that can be cancelled, so a finished race leaves nothing pending. */
function timer(delayMs) {
  let handle;
  const promise = new Promise((resolve) => {
    handle = setTimeout(() => resolve('timeout'), delayMs);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

async function trySession(apiVersion) {
  const result = { apiVersion, ok: false, mintMs: null, connectMs: null, firstAudioMs: null, transcript: '', closes: [], note: '' };

  // 1. Mint: the MVP call (MVP-02 §4), with this version on the client and in the request.
  let token;
  const mintStart = performance.now();
  try {
    const now = Date.now();
    const minter = new GoogleGenAI({ apiKey, httpOptions: { apiVersion } });
    token = await minter.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
        liveConnectConstraints: { model: MODEL, config: { responseModalities: [Modality.AUDIO] } },
        lockAdditionalFields: [], // lock only what the constraints set (model, AUDIO); the browser sends the rest
        httpOptions: { apiVersion, timeout: MINT_TIMEOUT_MS },
      },
    });
  } catch (error) {
    result.note = `mint failed: ${redact(error instanceof Error ? error.message : error).slice(0, 300)}`;
    return result;
  }
  result.mintMs = ms(mintStart, performance.now());
  if (typeof token?.name !== 'string' || !token.name.startsWith('auth_tokens/')) {
    result.note = 'mint answered without an auth_tokens/ name';
    return result;
  }
  secrets.push(token.name);

  // 2. Connect with the token as the "API key", on the same version. connect() neither resolves nor rejects when
  //    the socket closes during setup (MVP-02 §3), so race it against onclose and a timer.
  const ai = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion } });
  let firstAudioAt = null;
  let resolveTurn;
  const turn = new Promise((resolve) => (resolveTurn = resolve));
  let resolveClosed;
  const closed = new Promise((resolve) => (resolveClosed = resolve));
  const callbacks = {
    onopen: () => {},
    onmessage: (message) => {
      const content = message.serverContent;
      if (!content) return;
      if (firstAudioAt === null && content.modelTurn?.parts?.some((part) => part.inlineData?.data)) firstAudioAt = performance.now();
      if (content.outputTranscription?.text) result.transcript += content.outputTranscription.text;
      if (content.turnComplete) resolveTurn('turnComplete');
    },
    onerror: (event) => {
      result.note ||= `socket error: ${redact(event?.message ?? event?.error?.message ?? 'unknown').slice(0, 200)}`;
    },
    onclose: (event) => {
      result.closes.push({ code: event?.code, reason: redact(event?.reason).slice(0, 200), clean: event?.wasClean });
      resolveClosed('closed');
    },
  };

  const connectStart = performance.now();
  const connecting = ai.live.connect({ model: MODEL, config: { responseModalities: [Modality.AUDIO], outputAudioTranscription: {} }, callbacks });
  const connectTimer = timer(CONNECT_TIMEOUT_MS);
  // A rejection becomes an outcome too, so it can never surface as an unhandled rejection with a raw stack.
  const outcome = await Promise.race([connecting.then((session) => ({ session }), (error) => ({ error })), closed, connectTimer.promise]);
  connectTimer.cancel();
  if (typeof outcome === 'string') {
    result.note ||= outcome === 'closed' ? 'closed during setup' : `connect timed out after ${CONNECT_TIMEOUT_MS / 1000} s`;
    return result;
  }
  if ('error' in outcome) {
    result.note ||= `connect failed: ${redact(outcome.error instanceof Error ? outcome.error.message : outcome.error).slice(0, 300)}`;
    return result;
  }
  const { session } = outcome;
  result.connectMs = ms(connectStart, performance.now());

  // 3. One text turn; wait for the reply to finish.
  const sentAt = performance.now();
  try {
    session.sendRealtimeInput({ text: PROMPT });
  } catch (error) {
    result.note ||= `send failed: ${redact(error instanceof Error ? error.message : error).slice(0, 300)}`;
    return result;
  }
  const turnTimer = timer(TURN_TIMEOUT_MS);
  const ended = await Promise.race([turn, closed, turnTimer.promise]);
  turnTimer.cancel();
  if (firstAudioAt !== null) result.firstAudioMs = ms(sentAt, firstAudioAt);
  result.ok = firstAudioAt !== null;
  if (!result.ok) result.note ||= ended === 'timeout' ? `no audio within ${TURN_TIMEOUT_MS / 1000} s` : `turn ended (${ended}) without audio`;
  try {
    session.close();
  } catch {
    // already closed
  }
  return result;
}

const sdkVersion = JSON.parse(readFileSync(new URL('../../node_modules/@google/genai/package.json', import.meta.url), 'utf8')).version;
console.log(`@google/genai ${sdkVersion}, model ${MODEL}, one text turn per API version (the SDK's own warnings are expected below)\n`);

const results = [];
for (const apiVersion of VERSIONS) {
  let result;
  try {
    result = await trySession(apiVersion);
  } catch (error) {
    // Anything unforeseen is reported as redacted text, never as a raw stack (an error can carry a URL with the token).
    result = { apiVersion, ok: false, mintMs: null, connectMs: null, firstAudioMs: null, transcript: '', closes: [], note: `unexpected: ${redact(error instanceof Error ? error.message : error).slice(0, 300)}` };
  }
  results.push(result);
  const head = `[${result.apiVersion}] ${result.ok ? 'ok' : 'FAILED'}`;
  const timings = [
    result.mintMs === null ? null : `mint ${result.mintMs} ms`,
    result.connectMs === null ? null : `connect ${result.connectMs} ms`,
    result.firstAudioMs === null ? null : `first audio ${result.firstAudioMs} ms`,
  ].filter(Boolean);
  console.log(`${head}  ${timings.join('  ')}`);
  if (result.transcript) console.log(`    transcript: ${JSON.stringify(result.transcript.trim())}`);
  if (result.note) console.log(`    note: ${result.note}`);
  for (const close of result.closes) console.log(`    close: code=${close.code} clean=${close.clean} reason=${JSON.stringify(close.reason)}`);
}

const working = results.filter((r) => r.ok).map((r) => r.apiVersion);
console.log(`\nversions that work: ${working.length ? working.join(', ') : 'none'}`);
if (working.length) console.log(`LIVE_API_VERSION: ${working.includes('v1alpha') ? 'v1alpha (the MVP value, preferred when both work)' : working[0]}`);
process.exit(working.length ? 0 : 1);
