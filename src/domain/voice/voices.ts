/**
 * The 30 prebuilt Gemini voices (the speech-generation guide's table), the only names `voice.voiceName` and
 * `voice.voiceNames` accept (D-155). Live native-audio models take any of them; the Extended Voice Library is TTS-only.
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import type { Language } from '@/config/types';

export const PREBUILT_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;

export type PrebuiltVoice = (typeof PREBUILT_VOICES)[number];

export const isPrebuiltVoice = (name: string): name is PrebuiltVoice => (PREBUILT_VOICES as readonly string[]).includes(name);

/**
 * The voice of a session: the opening language's voice, else the fallback. A Live connection cannot change its voice,
 * so it stays for the whole session (reconnects and goAway swaps reuse it), whatever language the trainer switches to.
 */
export function voiceFor(voice: { readonly voiceName: string; readonly voiceNames: Readonly<Partial<Record<Language, string>>> }, language: Language): string {
  return voice.voiceNames[language] ?? voice.voiceName;
}
