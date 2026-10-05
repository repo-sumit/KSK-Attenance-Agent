/**
 * Voice diagnostics (Task 20): what the device can do for Voice Agent, as rows a screen can show and a plain-text
 * report a trainer can copy to support. Pure TypeScript: the probes that touch the browser are in
 * ./audio/probes.ts. A report holds no audio, no device names and no student data.
 */

export type DiagnosticId =
  | 'secureContext' | 'getUserMedia' | 'audioWorklet' | 'rate16' | 'rate24'
  | 'micContext' | 'micPermission' | 'micSettings' | 'workletLoad' | 'micLevel' | 'micTest' | 'speaker';

/** pass / fail are checks; info is a reading that is neither (the track settings, a quiet room). */
export type DiagnosticStatus = 'pass' | 'fail' | 'info';

export interface DiagnosticRow {
  readonly id: DiagnosticId;
  readonly status: DiagnosticStatus;
  /** A technical reading or an error name, English, never translated (it is for support). */
  readonly detail?: string;
}

export interface DiagnosticsResults {
  readonly userAgent: string;
  /** Only the checks that have run, in the order they ran. */
  readonly rows: readonly DiagnosticRow[];
}

/** The report's name for each check: English and stable, whatever language the screen is in. */
export const REPORT_NAMES: Readonly<Record<DiagnosticId, string>> = {
  secureContext: 'Secure context',
  getUserMedia: 'Microphone API (getUserMedia)',
  audioWorklet: 'AudioWorklet',
  rate16: '16 kHz audio context',
  rate24: '24 kHz audio context',
  micContext: 'Microphone test audio context',
  micPermission: 'Microphone permission',
  micSettings: 'Microphone settings',
  workletLoad: 'Microphone worklet',
  micLevel: 'Microphone level',
  micTest: 'Microphone test',
  speaker: 'Speaker tone',
};

/** An Android WebView announces itself with "; wv)" in the user agent. */
export function isAndroidWebView(userAgent: string): boolean {
  return userAgent.includes('; wv)');
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function formatDiagnostics(results: DiagnosticsResults): string {
  const lines = [
    'KSK voice diagnostics',
    `User agent: ${oneLine(results.userAgent)}`,
    `Android WebView: ${isAndroidWebView(results.userAgent) ? 'yes' : 'no'}`,
  ];
  if (results.rows.length) lines.push('');
  for (const row of results.rows) {
    const detail = row.detail ? oneLine(row.detail) : '';
    lines.push(`[${row.status.toUpperCase()}] ${REPORT_NAMES[row.id]}${detail ? `: ${detail}` : ''}`);
  }
  return lines.join('\n');
}
