import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { latinText, slotted } from '@/features/common/LatinText';
import { createI18n } from '@/i18n';

const en = createI18n('en', 'en-IN');
const mr = createI18n('mr', 'mr-IN');
const html = (nodes: ReactNode) => renderToStaticMarkup(<>{nodes}</>);

/** One helper for a translated sentence with master data in it (U14): only the master data is set as Latin. */
describe('latinText', () => {
  it('sets only the named params as Latin, the translated words around them stay as they are', () => {
    expect(html(latinText(en.t, 'roster.father', { name: 'Suresh Kumar' }, ['name']))).toBe('Father: <span lang="en" dir="ltr">Suresh Kumar</span>');
    expect(html(latinText(mr.t, 'roster.father', { name: 'Suresh Kumar' }, ['name']))).toBe('वडील: <span lang="en" dir="ltr">Suresh Kumar</span>');
  });

  it('keeps the translation\'s own order with several slots, and fills plain params as text', () => {
    const out = html(latinText(en.t, 'record.submittedOn', { date: '24 Sep', time: '9:48 AM', name: 'Kalpana Borse' }, ['name']));
    expect(out).toContain('<span lang="en" dir="ltr">Kalpana Borse</span>');
    expect(out).toContain('24 Sep');
    expect(out).not.toContain('\u0000');
    const two = html(latinText(en.t, 'reports.correctionRow', { student: 'Rahul Kumar', from: 'Absent', to: 'Present' }, ['student']));
    expect(two).toBe('<span lang="en" dir="ltr">Rahul Kumar</span> · Absent → Present');
  });

  it('a Latin param the message does not use is ignored; a missing param leaves its placeholder (as t does)', () => {
    expect(html(latinText(en.t, 'roster.father', { name: 'Ravi', other: 'Unused' }, ['name', 'other']))).toBe('Father: <span lang="en" dir="ltr">Ravi</span>');
    expect(html(latinText(en.t, 'roster.father', {}, ['name']))).toBe('Father: {name}');
  });
});

describe('slotted', () => {
  it('puts elements back where the translation placed them, and still picks the plural from count', () => {
    const list = <b>Asha, Ravi</b>;
    expect(html(slotted(en.t, 'principal.andMore', { list, count: 3 }))).toBe(html(<>{en.t('principal.andMore', { list: '\u0001', count: 3 }).split('\u0001')[0]}<b>Asha, Ravi</b>{en.t('principal.andMore', { list: '\u0001', count: 3 }).split('\u0001')[1]}</>));
    expect(html(slotted(en.t, 'common.dateRole', { date: 'Friday, 25 September', role: <i>Principal</i> }))).toBe('Friday, 25 September · <i>Principal</i>');
  });
});
