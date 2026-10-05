// Spike (Voice Agent, Task 20, Step 2): which prebuilt voice sounds right for Maharashtra?
//
// For each candidate voice it opens a Gemini Live session (Node, server to server, with the API key), has the model
// speak six fixed lines (a Marathi greeting and roll call, an Indian English greeting and a counts sentence, two
// student names) and writes each as <voice>-<n>.wav (mono, 16-bit, 24 000 Hz) for listening. It prints a summary.
//
//   npm run voice:spike-voices [outputDir]     (loads GEMINI_API_KEY from .env.development)
//
// The default output directory is outside the repository: <os tmpdir>/ksk-voice-spike. The key is a secret and is
// never printed: everything that comes back from the SDK or from Google goes through redact() first.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.8-live';
const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr'];
const LINES = [
  { label: 'Marathi greeting', text: 'नमस्कार, मी सहायक आहे. आज कोणत्या बॅचची हजेरी घ्यायची आहे?' },
  { label: 'Marathi roll call', text: 'आरव पवार, हजर आहे का?' },
  { label: 'English greeting', text: 'Good morning, I am Sahayak. Which batch would you like to mark today?' },
  { label: 'English counts', text: 'Thirty students present, one absent. Shall I submit?' },
  { label: 'Name: Aditi Joshi', text: 'Aditi Joshi.' },
  { label: 'Name: Rahul Kumar', text: 'Rahul Kumar.' },
];
const INSTRUCTION =
  'You are a voice reader for a listening test. Each message is one line. Speak exactly that line, in the language it is written in, at a natural pace, and add nothing before or after it.';
const RATE = 24000;
const CONNECT_TIMEOUT_MS = 15_000;
const LINE_TIMEOUT_MS = 30_000;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set. Put it in .env.development (server only, never a NEXT_PUBLIC_ name).');
  process.exit(2);
}
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'ksk-voice-spike'));
mkdirSync(outDir, { recursive: true });

function redact(value) {
  return String(value ?? '')
    .split(apiKey)
    .join('[redacted]')
    .replace(/(access_token|key)=[^&\s"']+/gi, '$1=[redacted]');
}
const message = (error) => redact(error instanceof Error ? error.message : error).slice(0, 300);

/** 44-byte RIFF header + PCM16 mono data. */
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** A timer that can be cancelled, so a finished race leaves nothing pending. */
function timer(delayMs) {
  let handle;
  const promise = new Promise((resolve) => {
    handle = setTimeout(() => resolve('timeout'), delayMs);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

async function runVoice(voiceName) {
  const result = { voice: voiceName, lines: [], note: '' };
  const ai = new GoogleGenAI({ apiKey });
  let chunks = [];
  let firstAudioAt = null;
  let resolveTurn = () => {};
  let resolveClosed = () => {};
  const closed = new Promise((resolve) => (resolveClosed = resolve));
  const callbacks = {
    onopen: () => {},
    onmessage: (msg) => {
      const content = msg.serverContent;
      if (!content) return;
      for (const part of content.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (!data) continue;
        if (firstAudioAt === null) firstAudioAt = performance.now();
        chunks.push(Buffer.from(data, 'base64'));
      }
      if (content.turnComplete) resolveTurn('turnComplete');
    },
    onerror: (event) => {
      result.note ||= `socket error: ${redact(event?.message ?? 'unknown').slice(0, 200)}`;
    },
    onclose: (event) => {
      result.note ||= event?.code && event.code !== 1000 ? `closed (${event.code}) ${redact(event.reason).slice(0, 200)}` : '';
      resolveClosed('closed');
    },
  };

  const connecting = ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: { parts: [{ text: INSTRUCTION }] },
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
    callbacks,
  });
  const connectTimer = timer(CONNECT_TIMEOUT_MS);
  const outcome = await Promise.race([connecting.then((session) => ({ session }), (error) => ({ error })), closed, connectTimer.promise]);
  connectTimer.cancel();
  if (typeof outcome === 'string') {
    result.note ||= outcome === 'closed' ? 'closed during setup' : `connect timed out after ${CONNECT_TIMEOUT_MS / 1000} s`;
    // A session that resolves after the race was lost is closed when it arrives: no socket is left open.
    connecting.then(
      (late) => {
        try {
          late.close();
        } catch {
          // already closed
        }
      },
      () => undefined,
    );
    return result;
  }
  if ('error' in outcome) {
    result.note ||= `connect failed: ${message(outcome.error)}`;
    return result;
  }
  const { session } = outcome;

  for (const [index, line] of LINES.entries()) {
    chunks = [];
    firstAudioAt = null;
    const turn = new Promise((resolve) => (resolveTurn = resolve));
    const sentAt = performance.now();
    try {
      session.sendRealtimeInput({ text: line.text });
    } catch (error) {
      result.note ||= `send failed: ${message(error)}`;
      break;
    }
    const wait = timer(LINE_TIMEOUT_MS);
    const ended = await Promise.race([turn, closed, wait.promise]);
    wait.cancel();
    const pcm = Buffer.concat(chunks);
    const entry = { n: index + 1, label: line.label, seconds: pcm.length / 2 / RATE, firstAudioMs: firstAudioAt === null ? null : Math.round(firstAudioAt - sentAt), file: null };
    if (pcm.length) {
      entry.file = path.join(outDir, `${voiceName}-${index + 1}.wav`);
      writeFileSync(entry.file, wav(pcm));
    } else {
      result.note ||= `line ${index + 1}: no audio (${ended})`;
    }
    result.lines.push(entry);
    if (ended === 'closed') break;
  }
  try {
    session.close();
  } catch {
    // already closed
  }
  return result;
}

console.log(`Model ${MODEL}, ${VOICES.length} voices x ${LINES.length} lines. Output: ${outDir}\n`);
const results = [];
for (const voice of VOICES) {
  let result;
  try {
    result = await runVoice(voice);
  } catch (error) {
    result = { voice, lines: [], note: `unexpected: ${message(error)}` };
  }
  results.push(result);
  const got = result.lines.filter((l) => l.file).length;
  console.log(`${voice.padEnd(8)} ${got}/${LINES.length} lines${result.note ? `  (${result.note})` : ''}`);
}

console.log('\nvoice     lines  audio s  first audio ms (median)  files');
for (const r of results) {
  const done = r.lines.filter((l) => l.file);
  const total = done.reduce((sum, l) => sum + l.seconds, 0);
  const firsts = done.map((l) => l.firstAudioMs).filter((v) => v !== null).sort((a, b) => a - b);
  const median = firsts.length ? firsts[Math.floor(firsts.length / 2)] : '-';
  console.log(`${r.voice.padEnd(9)} ${String(`${done.length}/${LINES.length}`).padEnd(6)} ${total.toFixed(1).padStart(7)}  ${String(median).padStart(23)}  ${r.voice}-1..${LINES.length}.wav`);
}
console.log(`\nWAV files: ${outDir}`);
process.exit(results.some((r) => r.lines.some((l) => l.file)) ? 0 : 1);
