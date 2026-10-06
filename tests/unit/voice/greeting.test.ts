// tests/unit/voice/greeting.test.ts
import { describe, expect, it } from 'vitest';
import type { DayPart } from '@/lib/time';
import { greetingLine, helpQuestion, openingFor, selfFirstAsk } from '@/services/voice/greeting';

const PARTS: readonly DayPart[] = ['morning', 'afternoon', 'evening', 'night'];

describe('the app-filled greeting (D-151, D-155)', () => {
  it('English: the instructor by first name, the principal by the salutation, for every day part', () => {
    const en = PARTS.map((p) => greetingLine('en', p, { kind: 'instructor', firstName: 'Rajesh' }));
    expect(en).toEqual(['Hi Rajesh, good morning.', 'Hi Rajesh, good afternoon.', 'Hi Rajesh, good evening.', 'Hi Rajesh, good night.']);
    const principal = PARTS.map((p) => greetingLine('en', p, { kind: 'principal' }));
    expect(principal).toEqual(['Good morning, Principal.', 'Good afternoon, Principal.', 'Good evening, Principal.', 'Good night, Principal.']);
  });

  it('Marathi: the same words Home uses, for every day part', () => {
    const mr = PARTS.map((p) => greetingLine('mr', p, { kind: 'instructor', firstName: 'Rajesh' }));
    expect(mr).toEqual(['नमस्कार Rajesh, सुप्रभात.', 'नमस्कार Rajesh, शुभ दुपार.', 'नमस्कार Rajesh, शुभ संध्याकाळ.', 'नमस्कार Rajesh, शुभ रात्री.']);
    const principal = PARTS.map((p) => greetingLine('mr', p, { kind: 'principal' }));
    expect(principal).toEqual(['नमस्कार प्राचार्य, सुप्रभात.', 'नमस्कार प्राचार्य, शुभ दुपार.', 'नमस्कार प्राचार्य, शुभ संध्याकाळ.', 'नमस्कार प्राचार्य, शुभ रात्री.']);
  });

  it('a name is data: quotes and control characters never reach the model text', () => {
    expect(greetingLine('en', 'morning', { kind: 'instructor', firstName: 'Ra"jesh\n' })).toBe('Hi Rajesh, good morning.');
    expect(greetingLine('en', 'morning', { kind: 'instructor', firstName: '' })).toBe('Hi, good morning.');
  });

  it('the help question and the own-attendance ask follow the language', () => {
    expect(helpQuestion('en')).toBe('How can I help?');
    expect(helpQuestion('mr')).toBe('मी काय मदत करू?');
    expect(selfFirstAsk('en')).toBe('Please mark your attendance first. Shall I start?');
    expect(selfFirstAsk('mr')).toBe('कृपया आधी तुमची हजेरी नोंदवा. सुरू करू का?');
  });

  it('openingFor puts the session\'s opening language together', () => {
    expect(openingFor('mr', 'afternoon', { kind: 'instructor', firstName: 'Sunita' }, 'Marathi')).toEqual({
      greeting: 'नमस्कार Sunita, शुभ दुपार.', help: 'मी काय मदत करू?', selfAsk: 'कृपया आधी तुमची हजेरी नोंदवा. सुरू करू का?', languageName: 'Marathi',
    });
  });
});
