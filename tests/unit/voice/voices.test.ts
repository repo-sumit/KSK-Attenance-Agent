import { describe, expect, it } from 'vitest';
import { isPrebuiltVoice, PREBUILT_VOICES, voiceFor } from '@/domain/voice/voices';

describe('prebuilt voices (D-155)', () => {
  it('the 30 prebuilt Gemini voices, each once', () => {
    expect(PREBUILT_VOICES).toHaveLength(30);
    expect(new Set(PREBUILT_VOICES).size).toBe(PREBUILT_VOICES.length);
    expect(isPrebuiltVoice('Achernar')).toBe(true);
    expect(isPrebuiltVoice('achernar')).toBe(false);
    expect(isPrebuiltVoice('')).toBe(false);
  });
  it('the session voice: the opening language\'s voice, else the fallback', () => {
    expect(voiceFor({ voiceName: 'Kore', voiceNames: { en: 'Achernar', mr: 'Sulafat' } }, 'mr')).toBe('Sulafat');
    expect(voiceFor({ voiceName: 'Kore', voiceNames: { en: 'Achernar' } }, 'mr')).toBe('Kore');
  });
});
