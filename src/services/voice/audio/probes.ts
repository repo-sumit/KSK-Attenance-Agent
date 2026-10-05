/**
 * Browser probes for the voice diagnostics screen (Task 20). Each returns DiagnosticRows (./diagnostics): nothing is
 * recorded, stored or sent, and the microphone stream is stopped before a probe returns. The two tap probes create
 * their AudioContexts synchronously, so call them straight from the click handler (autoplay rule).
 */
import { cameraErrorFrom } from '../../camera/device-camera';
import type { DiagnosticRow, DiagnosticStatus } from '../diagnostics';
import { createBrowserAudio } from './browser-audio';
import { startMic } from './recorder';

const row = (id: DiagnosticRow['id'], status: DiagnosticStatus, detail?: string): DiagnosticRow => (detail ? { id, status, detail } : { id, status });
const errorName = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' && error.name ? error.name : 'Error';

/** The microphone test stopped on something none of its steps expected (C13): one failed row with the error's name. */
export const micTestFailed = (error: unknown): DiagnosticRow => row('micTest', 'fail', errorName(error));

const MIC_TEST_MS = 2000;
const LEVEL_EVERY_MS = 100;
const TONE_HZ = 440;
const TONE_SECONDS = 0.5;
const OUT_RATE = 24000;
const CLOSE_AFTER_MS = 900;

/** The checks that need no tap: secure context, getUserMedia, AudioWorklet, and which sample rates a context really gets. */
export function probeEnvironment(): DiagnosticRow[] {
  const secure = typeof window !== 'undefined' && window.isSecureContext === true;
  const media = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
  const hasContext = typeof AudioContext !== 'undefined';
  const worklet = hasContext && 'audioWorklet' in AudioContext.prototype;
  return [
    row('secureContext', secure ? 'pass' : 'fail', secure ? undefined : 'The page is not served over https'),
    row('getUserMedia', media ? 'pass' : 'fail', media ? undefined : 'navigator.mediaDevices.getUserMedia is missing'),
    row('audioWorklet', worklet ? 'pass' : 'fail', worklet ? undefined : hasContext ? 'AudioContext has no audioWorklet' : 'AudioContext is missing'),
    contextRate('rate16', 16000),
    contextRate('rate24', 24000),
  ];
}

function contextRate(id: 'rate16' | 'rate24', sampleRate: number): DiagnosticRow {
  if (typeof AudioContext === 'undefined') return row(id, 'fail', 'AudioContext is missing');
  try {
    const ctx = new AudioContext({ sampleRate });
    const actual = ctx.sampleRate;
    void ctx.close().catch(() => undefined);
    return actual === sampleRate ? row(id, 'pass', `${actual} Hz`) : row(id, 'fail', `asked for ${sampleRate} Hz, got ${actual} Hz`);
  } catch (error) {
    return row(id, 'fail', errorName(error));
  }
}

function settingsText(track: MediaStreamTrack | undefined): string {
  const s = track?.getSettings();
  if (!s) return 'no audio track';
  const show = (value: unknown) => (value === undefined ? 'n/a' : String(value));
  return [
    `echoCancellation=${show(s.echoCancellation)}`,
    `noiseSuppression=${show(s.noiseSuppression)}`,
    `autoGainControl=${show(s.autoGainControl)}`,
    `sampleRate=${show(s.sampleRate)}`,
    `channelCount=${show(s.channelCount)}`,
  ].join(', ');
}

/**
 * Test microphone: the permission, the track's settings, the worklet load, then two seconds of level readings from
 * the same recorder Voice Agent uses. Stops at the first step that fails. Call synchronously from the click handler.
 */
export async function testMicrophone(): Promise<DiagnosticRow[]> {
  // Synchronous part: the 16 kHz context is made and resumed inside the click, before any await.
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
    void ctx.resume().catch(() => undefined);
  } catch (error) {
    // No audio context: the permission was never asked, so this is its own row, not micPermission (C14).
    return [row('micContext', 'fail', errorName(error))];
  }
  const rows: DiagnosticRow[] = [];
  try {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
      return [row('micPermission', 'fail', `${errorName(error)} (${cameraErrorFrom(error)})`)];
    }
    rows.push(row('micPermission', 'pass'));
    rows.push(row('micSettings', 'info', settingsText(stream.getAudioTracks()[0])));
    stream.getTracks().forEach((track) => track.stop());

    let chunks = 0;
    const started = await startMic(ctx, () => void (chunks += 1), () => undefined);
    if (!started.ok) return [...rows, row('workletLoad', 'fail', started.error)];
    rows.push(row('workletLoad', 'pass'));

    let peak = 0;
    let readings = 0;
    const timer = setInterval(() => {
      readings += 1;
      peak = Math.max(peak, started.mic.level());
    }, LEVEL_EVERY_MS);
    await new Promise<void>((resolve) => setTimeout(resolve, MIC_TEST_MS));
    clearInterval(timer);
    started.mic.stop();

    const detail = `${readings} readings, ${chunks} chunks, peak ${Math.round(peak * 100)}%`;
    if (chunks === 0) rows.push(row('micLevel', 'fail', `no audio chunks in ${MIC_TEST_MS / 1000} s`));
    else if (peak === 0) rows.push(row('micLevel', 'info', `${detail} (silent: speak while the test runs)`));
    else rows.push(row('micLevel', 'pass', detail));
    return rows;
  } catch (error) {
    return [...rows, micTestFailed(error)]; // the steps that passed stay; the screen never waits on a rejected test
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/**
 * Test speaker: a 440 Hz, 0.5 s tone through the 24 kHz output path Voice Agent plays the model on. Call synchronously
 * from the click handler. Playing is not hearing: the app cannot tell whether the tone was audible (volume, a muted
 * phone, a Bluetooth route), so a played tone is a note for the person to judge, never a pass (C12).
 */
export function testSpeaker(): DiagnosticRow {
  try {
    const audio = createBrowserAudio(); // creates and resumes both contexts synchronously
    const tone = new Int16Array(Math.round(OUT_RATE * TONE_SECONDS));
    for (let i = 0; i < tone.length; i++) tone[i] = Math.round(Math.sin((2 * Math.PI * TONE_HZ * i) / OUT_RATE) * 0.3 * 32767);
    audio.play(tone);
    setTimeout(() => audio.close(), CLOSE_AFTER_MS);
    return row('speaker', 'info', `${TONE_HZ} Hz tone played at ${OUT_RATE} Hz; not checked whether it was heard (listen for a short beep)`);
  } catch (error) {
    return row('speaker', 'fail', errorName(error));
  }
}
