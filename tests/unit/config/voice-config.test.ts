import { describe, expect, it } from 'vitest';
import { deriveJourney } from '@/config/journey';
import { PRODUCT_DEFAULTS } from '@/config/defaults';
import { resolveConfiguration } from '@/config/resolve';
import { MAHARASHTRA } from '@/config/states/maharashtra';
import { validateConfiguration } from '@/config/validate';
import { PREBUILT_VOICES } from '@/domain/voice/voices';
import { resolveAccess } from '@/domain/access';
import { configWith, data, staff, TODAY } from '../../helpers/fixtures';

const ctx = { data, enrolledFaceCount: 1 };
const codes = (layer: Parameters<typeof configWith>[0]) => validateConfiguration(configWith(layer), ctx).map((i) => i.code);
const journeyFor = (staffId: string, layer: Parameters<typeof configWith>[0] = {}) => {
  const config = configWith(layer);
  const user = staff(staffId);
  return deriveJourney(config, user, resolveAccess(user, config, data, TODAY), true);
};

describe('voice configuration', () => {
  it('Maharashtra ships voice off, English and Marathi, auto style, one soft voice for both languages (D-155)', () => {
    const v = resolveConfiguration({ state: MAHARASHTRA }).voice;
    expect(v).toMatchObject({ enabled: false, languages: ['en', 'mr'], defaultLanguage: 'en', markingStyle: 'auto', voiceName: 'Achernar', transcriptRetentionDays: 0 });
    expect(v.voiceNames).toEqual({ en: 'Achernar', mr: 'Achernar' });
  });

  it('accepts only the 30 prebuilt Gemini voice names, for the fallback and for each language', () => {
    expect(PREBUILT_VOICES).toHaveLength(30);
    expect(PREBUILT_VOICES).toEqual(expect.arrayContaining(['Achernar', 'Vindemiatrix', 'Sulafat', 'Gacrux', 'Despina', 'Schedar', 'Algieba', 'Charon', 'Kore']));
    expect(codes({})).not.toContain('voice_name');
    expect(codes({ voice: { voiceNames: { mr: 'Sulafat' } } })).not.toContain('voice_name');
    expect(codes({ voice: { voiceName: 'Robot' } })).toContain('voice_name');
    expect(codes({ voice: { voiceNames: { mr: 'hi_IN-indic-low' } } })).toContain('voice_name');
    expect(codes({ voice: { voiceNames: { en: '' } } })).toContain('voice_name');
  });

  it('rejects a voice for a language voice does not speak (Task 9 review M8); the product defaults and Maharashtra are valid', () => {
    expect(codes({})).not.toContain('voice_names_language');
    // English only, while Maharashtra's Marathi voice stays named: rejected
    expect(codes({ voice: { languages: ['en'] } })).toContain('voice_names_language');
    expect(codes({ voice: { languages: ['mr'], defaultLanguage: 'mr', voiceNames: { mr: 'Sulafat' } } })).toContain('voice_names_language');
    // the product defaults speak English only, with an English voice; Maharashtra adds Marathi and its voice
    expect(PRODUCT_DEFAULTS.voice.languages).toEqual(['en']);
    expect(PRODUCT_DEFAULTS.voice.voiceNames).toEqual({ en: 'Achernar' });
    expect(validateConfiguration(PRODUCT_DEFAULTS, ctx).map((i) => i.code)).not.toContain('voice_names_language');
    expect(resolveConfiguration({ state: MAHARASHTRA }).voice.voiceNames).toEqual({ en: 'Achernar', mr: 'Achernar' });
  });

  it('journey carries the voice per language beside the fallback', () => {
    expect(journeyFor('st-rajesh', { voice: { enabled: true, voiceNames: { mr: 'Sulafat' } } }).voice).toMatchObject({ voiceName: 'Achernar', voiceNames: { en: 'Achernar', mr: 'Sulafat' } });
  });

  it('lets an institute layer switch voice on (voice.enabled is overridable)', () => {
    const state = { ...MAHARASHTRA, instituteLayers: { 'inst-27410': { voice: { enabled: true, languages: ['en'] as const } } } };
    const v = resolveConfiguration({ state, instituteId: 'inst-27410' }).voice;
    expect(v.enabled).toBe(true);
    expect(v.languages).toEqual(['en', 'mr']); // languages are not overridable: the state floor stays
  });

  it('rejects voice languages outside the screen languages', () => {
    expect(codes({ voice: { languages: [] } })).toContain('voice_languages');
    expect(codes({ i18n: { languages: ['en'], defaultLanguage: 'en' }, voice: { languages: ['en', 'mr'] } })).toContain('voice_languages');
  });

  it('rejects a default language that is not a voice language', () => {
    expect(codes({ voice: { languages: ['mr'], defaultLanguage: 'en' } })).toContain('voice_default_language');
  });

  it('rejects exceptions style without a Present default', () => {
    expect(codes({ marking: { defaultStatus: 'blank' }, voice: { markingStyle: 'exceptions' } })).toContain('voice_marking_style');
    expect(codes({ marking: { defaultStatus: 'present' }, voice: { markingStyle: 'exceptions' } })).not.toContain('voice_marking_style');
  });

  it('rejects non-positive or fractional limits and an idle timeout under 30 s', () => {
    expect(codes({ voice: { maxMinutesPerSession: 0 } })).toContain('voice_limits');
    expect(codes({ voice: { dailyMinutesPerTrainer: 1.5 } })).toContain('voice_limits');
    expect(codes({ voice: { idleTimeoutSeconds: 20 } })).toContain('voice_limits');
    expect(codes({})).not.toContain('voice_limits');
  });

  it('rejects a negative or fractional transcript retention, and accepts 0 and whole days', () => {
    expect(codes({ voice: { transcriptRetentionDays: -1 } })).toContain('voice_limits');
    expect(codes({ voice: { transcriptRetentionDays: 0.5 } })).toContain('voice_limits');
    expect(codes({ voice: { transcriptRetentionDays: Number.NaN } })).toContain('voice_limits');
    expect(codes({ voice: { transcriptRetentionDays: 0 } })).not.toContain('voice_limits');
    expect(codes({ voice: { transcriptRetentionDays: 30 } })).not.toContain('voice_limits');
  });

  it('the voice_limits message names every limit it checks, retention included', () => {
    const issue = validateConfiguration(configWith({ voice: { transcriptRetentionDays: -1 } }), ctx).find((i) => i.code === 'voice_limits');
    expect(issue?.message).toMatch(/session/i);
    expect(issue?.message).toMatch(/daily/i);
    expect(issue?.message).toMatch(/idle/i);
    expect(issue?.message).toMatch(/retention/i);
  });

  it('journey: voice exists wherever it is enabled, for instructors and the institute home alike (D-139)', () => {
    expect(journeyFor('st-rajesh').voice.enabled).toBe(false);
    expect(journeyFor('st-rajesh', { voice: { enabled: true } }).voice).toMatchObject({ enabled: true, languages: ['en', 'mr'], limits: { sessionMinutes: 20, idleSeconds: 120, dailyMinutes: 60 } });
    expect(journeyFor('st-anil').voice.enabled).toBe(false);
    expect(journeyFor('st-anil', { voice: { enabled: true } }).voice.enabled).toBe(true); // the principal too (D-139 supersedes D-087)
  });

  it('journey fails closed when the default language is not a voice language', () => {
    expect(journeyFor('st-rajesh', { voice: { enabled: true, languages: ['mr'], defaultLanguage: 'en' } }).voice.enabled).toBe(false);
    expect(journeyFor('st-rajesh', { voice: { enabled: true, languages: ['mr'], defaultLanguage: 'mr' } }).voice.enabled).toBe(true);
  });

  it('journey fails closed on an invalid voice language set (validation does not run at runtime)', () => {
    expect(journeyFor('st-rajesh', { i18n: { languages: ['en'], defaultLanguage: 'en' }, voice: { enabled: true, languages: ['mr'], defaultLanguage: 'mr' } }).voice.enabled).toBe(false);
  });
});
