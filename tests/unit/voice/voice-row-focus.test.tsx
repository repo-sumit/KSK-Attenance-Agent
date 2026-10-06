// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Student } from '@/domain/entities';
import { StudentRow, type RowLabels } from '@/features/attendance/mark/StudentRow';

afterEach(cleanup);

const scroll = vi.fn();
beforeEach(() => {
  scroll.mockReset();
  Element.prototype.scrollIntoView = scroll;
});

const STUDENT: Student = { id: 'S2', batchId: 'ele-s1u2', rollNo: 2, name: 'Aditi Joshi', fatherName: 'Ramesh Joshi' };
const LABELS: RowLabels = {
  status: { present: 'Present', absent: 'Absent', leave: 'Leave', half_day: 'Half day', ojt: 'OJT' },
  father: (name) => `Father: ${name}`,
  presentFor: 'Present for', firstHalf: 'First half', secondHalf: 'Second half', leaveType: 'Leave type',
  leaveTypes: { sick: 'Sick', casual: 'Casual', medical: 'Medical' },
  leaveUntil: 'Until', ojtNote: 'On OJT', notMarked: 'Not marked', needsHalf: 'Choose a half', needsLeaveType: 'Choose a type',
  statusFor: (name) => `Attendance for ${name}`, choose: 'Choose', lockedReason: 'From the ERP',
};

const row = (current: boolean, focusSeq?: number) => (
  <ul>
    <StudentRow
      student={STUDENT}
      mark={{ status: null }}
      selectable={['present', 'absent']}
      defaultStatus={null}
      halfDayHalves={false}
      leaveTypes={[]}
      leaveRange={null}
      attention={false}
      current={current}
      focusSeq={focusSeq}
      labels={LABELS}
      onStatus={() => undefined}
      onDetail={() => undefined}
    />
  </ul>
);

describe('StudentRow: the row voice is on brings itself into view (m13)', () => {
  it('a row that renders already current (the roster loaded after the agent moved on) scrolls into view', () => {
    const { container } = render(row(true));
    expect(container.querySelector('[data-current]')).not.toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('a row scrolls when it becomes current, once, and not when it stops being current', () => {
    const view = render(row(false));
    expect(scroll).not.toHaveBeenCalled();
    view.rerender(row(true));
    expect(scroll).toHaveBeenCalledTimes(1);
    view.rerender(row(true));
    view.rerender(row(false));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('jumps without animation when the trainer asks for reduced motion', () => {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    try {
      render(row(true));
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
    } finally {
      window.matchMedia = before;
    }
  });

  it('scrolls again when the agent asks for the student who is already current (a new focus seq, U2)', () => {
    const view = render(row(true, 1));
    expect(scroll).toHaveBeenCalledTimes(1);
    view.rerender(row(true, 1)); // a re-render of the same focus: no scroll
    expect(scroll).toHaveBeenCalledTimes(1);
    view.rerender(row(true, 2)); // focus_student again for this student (the trainer scrolled away)
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('a repeated focus still honours reduced motion', () => {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    try {
      const view = render(row(true, 1));
      view.rerender(row(true, 2));
      expect(scroll).toHaveBeenCalledTimes(2);
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' });
    } finally {
      window.matchMedia = before;
    }
  });
});
