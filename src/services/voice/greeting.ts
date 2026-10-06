/**
 * The app-filled greeting (D-151, D-155): the exact first line the agent says, built from the real time of day
 * (`dayPart` of `ctx.wallClock`, never the demo clock) and the trainer's first name, or the salutation for the
 * principal. The model says it word for word, so it never varies and never has to recall the name. The Marathi lines
 * (the greeting, the help question, the own-attendance ask) are the recorded exception to "model-facing text is
 * English": a fixed line sounds the same in every session (native review, D-027).
 * Pure TypeScript: no I/O, no framework; the clock is read only by `sessionOpening`, from the injected context.
 */
import type { Language } from '@/config/types';
import type { VoicePlan } from '@/domain/voice/plan';
import { dayPart, type DayPart } from '@/lib/time';
import type { SessionContext } from '../context';
import { nameText } from './labels';
import { firstName } from './prompt';

/** Who is greeted: an instructor by first name, the principal by the salutation (as Home greets them). */
export type Greeted = { readonly kind: 'instructor'; readonly firstName: string } | { readonly kind: 'principal' };

const EN_PART: Readonly<Record<DayPart, string>> = { morning: 'good morning', afternoon: 'good afternoon', evening: 'good evening', night: 'good night' };
/** The words Home uses (greeting.* in mr.ts). */
const MR_PART: Readonly<Record<DayPart, string>> = { morning: 'सुप्रभात', afternoon: 'शुभ दुपार', evening: 'शुभ संध्याकाळ', night: 'शुभ रात्री' };

/** "Hi Rajesh, good morning." / "Good morning, Principal." / "नमस्कार Rajesh, सुप्रभात." / "नमस्कार प्राचार्य, सुप्रभात." */
export function greetingLine(language: Language, part: DayPart, who: Greeted): string {
  const name = who.kind === 'instructor' ? nameText(who.firstName) : '';
  if (language === 'mr') return who.kind === 'principal' ? `नमस्कार प्राचार्य, ${MR_PART[part]}.` : `नमस्कार${name ? ` ${name}` : ''}, ${MR_PART[part]}.`;
  const words = EN_PART[part];
  if (who.kind === 'principal') return `${words[0].toUpperCase()}${words.slice(1)}, Principal.`;
  return `Hi${name ? ` ${name}` : ''}, ${words}.`;
}

/** The open question when nothing is pending (D-142, reworded). */
export const helpQuestion = (language: Language): string => (language === 'mr' ? 'मी काय मदत करू?' : 'How can I help?');

/** Own attendance first (D-152): the ask after the greeting. */
export const selfFirstAsk = (language: Language): string =>
  language === 'mr' ? 'कृपया आधी तुमची हजेरी नोंदवा. सुरू करू का?' : 'Please mark your attendance first. Shall I start?';

/** The fixed lines of a session's first turn, in its opening language, and that language's name for the model. */
export interface Opening {
  readonly greeting: string;
  readonly help: string;
  readonly selfAsk: string;
  readonly languageName: string;
}

export function openingFor(language: Language, part: DayPart, who: Greeted, languageName: string): Opening {
  return { greeting: greetingLine(language, part, who), help: helpQuestion(language), selfAsk: selfFirstAsk(language), languageName };
}

/** The opening of this voice session: the opening language, the real time of day, and who is speaking. */
export function sessionOpening(ctx: SessionContext, voice: VoicePlan, languageName: string): Opening {
  const who: Greeted = voice.scope === 'institute' ? { kind: 'principal' } : { kind: 'instructor', firstName: firstName(ctx.user.name) };
  return openingFor(voice.openingLanguage, dayPart(ctx.wallClock.now()), who, languageName);
}
