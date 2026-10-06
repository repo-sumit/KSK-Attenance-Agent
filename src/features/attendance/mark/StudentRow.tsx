'use client';
import { memo, useEffect, useRef, type ReactNode } from 'react';
import type { Student } from '@/domain/entities';
import type { LeaveType, Mark, StatusCode } from '@/domain/status';
import { AttendanceStatusSelect, LockedStatus } from '@/components/ui/AttendanceStatusSelect';
import { ChoicePill } from '@/components/ui/ChoicePill';
import { Icon } from '@/components/ui/icons/Icon';
import { Latin } from '@/components/ui/Latin';
import { StatusLine } from '@/components/ui/StatusLine';
import { cx } from '@/lib/cx';
import styles from './StudentRow.module.css';

export interface RowLabels {
  readonly status: Readonly<Record<StatusCode, string>>;
  /** "Father: {name}" with only the name set as Latin master data. */
  readonly father: (name: string) => ReactNode;
  readonly presentFor: string;
  readonly firstHalf: string;
  readonly secondHalf: string;
  readonly leaveType: string;
  readonly leaveTypes: Readonly<Record<LeaveType, string>>;
  readonly leaveUntil: string;
  readonly ojtNote: string;
  readonly notMarked: string;
  readonly needsHalf: string;
  readonly needsLeaveType: string;
  /** The status control's accessible name: "Attendance for {name}". */
  readonly statusFor: (name: string) => string;
  /** Placeholder while a student has no status yet (blank default). */
  readonly choose: string;
  /** Why an OJT row can't be changed (screen readers; the row says it visibly). */
  readonly lockedReason: string;
}

interface StudentRowProps {
  readonly student: Student;
  readonly mark: Mark;
  readonly selectable: readonly StatusCode[];
  readonly defaultStatus: StatusCode | null;
  readonly halfDayHalves: boolean;
  readonly leaveTypes: readonly LeaveType[];
  readonly leaveRange: { readonly min: string; readonly max: string } | null;
  readonly attention: boolean;
  /** Voice Agent is on this student (an outline, never a status tint, D-070). */
  readonly current?: boolean;
  /** Changes on every focus of the current row (the agent asked for this student again): it scrolls into view again. */
  readonly focusSeq?: number;
  readonly labels: RowLabels;
  readonly onStatus: (id: string, status: StatusCode) => void;
  readonly onDetail: (id: string, mark: Mark) => void;
}

/**
 * One student (D-062, D-069): roll number, name with the father's name beneath
 * (PRD §4.3) and one status control on the right, the same compact row whether
 * a state enables two statuses or five. The row stays white whatever the
 * status: the control carries the status colour. Half day and leave ask their
 * detail under the name, inside the same row, and the until date sits beside
 * the leave types whenever there is room. OJT from the ERP is a locked value.
 */
export const StudentRow = memo(function StudentRow(p: StudentRowProps) {
  const { student, mark, labels } = p;
  const locked = mark.status === 'ojt';
  const unmarked = mark.status === null;
  const needs = mark.status === 'half_day' && p.halfDayHalves && !mark.half ? 'half' : mark.status === 'leave' && !mark.leaveType ? 'leave' : null;
  // After Review with a gap, the follow-up itself says what is missing (icon + text + colour), where the choice is made.
  const flagged = p.attention && needs !== null;
  const options = p.selectable.map((status) => ({ status, label: labels.status[status] }));
  // The row voice is on scrolls itself into view when it becomes current, so a row that renders after the agent
  // moved on (a batch just opened, a resumed roll call) is still brought on screen (m13); and again when the agent
  // asks for the same student after the trainer scrolled away (a new focusSeq).
  const ref = useRef<HTMLLIElement>(null);
  const current = p.current ?? false;
  const focusSeq = p.focusSeq;
  useEffect(() => {
    if (!current) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [current, focusSeq]);

  return (
    <li
      ref={ref}
      className={cx(styles.row, p.attention && (unmarked || needs) && styles.attention, p.current && styles.current)}
      data-student={student.id}
      data-incomplete={p.attention || undefined}
      data-current={p.current || undefined}
      aria-current={p.current || undefined}
    >
      <span className={cx(styles.roll, 'tnum')} aria-hidden="true">
        {student.rollNo}
      </span>
      <div className={styles.body}>
        <div className={styles.main}>
          <div className={styles.who}>
            <span className={styles.name}>
              <Latin>{student.name}</Latin>
            </span>
            <span className={styles.father}>
              {labels.father(student.fatherName)}
            </span>
            {p.attention && unmarked && (
              <StatusLine tone="warning" icon="circle">
                {labels.notMarked}
              </StatusLine>
            )}
          </div>
          {locked ? (
            <span className={styles.locked}>
              <LockedStatus status="ojt" label={labels.status.ojt} reason={labels.lockedReason} />
              <span className={styles.lockNote}>{labels.ojtNote}</span>
            </span>
          ) : (
            <span className={styles.status}>
              <AttendanceStatusSelect
                label={labels.statusFor(student.name)}
                options={options}
                value={mark.status}
                placeholder={labels.choose}
                quiet={mark.status !== null && mark.status === p.defaultStatus}
                invalid={p.attention && unmarked}
                onChange={(status) => p.onStatus(student.id, status)}
              />
            </span>
          )}
        </div>
        {mark.status === 'half_day' && p.halfDayHalves && (
          <div className={styles.follow}>
            <div className={cx(styles.field, flagged && styles.flagged)} role="radiogroup" aria-label={labels.presentFor} data-needs={needs === 'half' || undefined} aria-invalid={flagged || undefined}>
              <span className={styles.followLabel}>
                {flagged && <Icon name="alert" size={16} />}
                {flagged ? labels.needsHalf : labels.presentFor}
              </span>
              <span className={styles.choices}>
                <ChoicePill selected={mark.half === 1} onPress={() => p.onDetail(student.id, { status: 'half_day', half: 1 })}>
                  {labels.firstHalf}
                </ChoicePill>
                <ChoicePill selected={mark.half === 2} onPress={() => p.onDetail(student.id, { status: 'half_day', half: 2 })}>
                  {labels.secondHalf}
                </ChoicePill>
              </span>
            </div>
          </div>
        )}
        {mark.status === 'leave' && (
          <div className={styles.follow}>
            {/* The Leave control above names the choice; the label shows only when a type is still missing. */}
            <div className={cx(styles.field, flagged && styles.flagged)} role="radiogroup" aria-label={labels.leaveType} data-needs={needs === 'leave' || undefined} aria-invalid={flagged || undefined}>
              {flagged && (
                <span className={styles.followLabel}>
                  <Icon name="alert" size={16} />
                  {labels.needsLeaveType}
                </span>
              )}
              <span className={styles.choices}>
                {p.leaveTypes.map((type) => (
                  <ChoicePill key={type} selected={mark.leaveType === type} onPress={() => p.onDetail(student.id, { ...mark, status: 'leave', leaveType: type })}>
                    {labels.leaveTypes[type]}
                  </ChoicePill>
                ))}
              </span>
            </div>
            {p.leaveRange && mark.leaveType && (
              <label className={styles.field}>
                <span className={styles.followLabel}>{labels.leaveUntil}</span>
                <input
                  type="date"
                  className={styles.date}
                  min={p.leaveRange.min}
                  max={p.leaveRange.max}
                  value={mark.leaveUntil ?? ''}
                  onChange={(e) => p.onDetail(student.id, { ...mark, leaveUntil: e.target.value || undefined })}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </li>
  );
});
