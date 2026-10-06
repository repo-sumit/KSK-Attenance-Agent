'use client';
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { InlineNote } from '@/components/ui/InlineNote';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { cx } from '@/lib/cx';
import { saveTextFile } from '@/lib/download';
import { isEmbeddedWebView } from '@/lib/platform';
import { startOfMonth, toLocalDate, type LocalDate } from '@/lib/time';
import { brandLogo } from './brandLogo';
import { registerDocument, registerFileName, type RegisterDocumentOptions } from './registerDocument';
import { staffRegisterDocument, staffRegisterFileName } from './staffRegisterDocument';
import styles from './RegisterDownloadSheet.module.css';

/** One batch, a trade's batches, or every staff member of the institute (the staff register, D-154). */
export type RegisterScope = RegisterDocumentOptions['scope'] | { readonly kind: 'staff' };

/** What a register is downloaded for: one batch, a trade's batches in the list it was opened from, or the staff. */
export interface RegisterTarget {
  /** Empty for the staff register. */
  readonly batchIds: readonly string[];
  /** The sheet's subtitle: "Electrician · Shift 1 · Unit 2", the trade's name, or "All staff · {institute}". */
  readonly subject: string;
  readonly scope: RegisterScope;
}

interface RegisterDownloadButtonProps {
  readonly target: RegisterTarget;
  /** 'icon': a 44px brand icon button on a batch row, named "Download register for {subject}" (also its tooltip). */
  readonly appearance?: 'button' | 'icon';
  readonly className?: string;
}

/**
 * The entry point (D-137): "Download register" in an expanded batch (secondary), "Trade register" on a trade's
 * label line (ghost), an icon button on each batch row, and "Staff register" on the Staff attendance section's title
 * line (ghost, D-154). Callers show it only when journey.reports.pdfDownload.
 * Focus returns here when the sheet closes.
 */
export function RegisterDownloadButton({ target, appearance = 'button', className }: RegisterDownloadButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const restore = useRef(false);
  useEffect(() => {
    // After the dialog has left the page: the button is no longer inert, so it can take focus back.
    if (open || !restore.current) return;
    restore.current = false;
    opener.current?.focus({ preventScroll: true });
  }, [open]);
  const trade = target.scope.kind === 'trade' ? target.scope.tradeName : null;
  const staff = target.scope.kind === 'staff';
  const show = (event: MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget;
    setOpen(true);
  };
  const name = t('reports.register.downloadFor', { name: target.subject });
  return (
    <>
      {appearance === 'icon' ? (
        <button type="button" className={cx(styles.icon, className)} aria-label={name} title={name} onClick={show}>
          <Icon name="download" size={24} />
        </button>
      ) : (
        <Button
          variant={trade || staff ? 'ghost' : 'secondary'}
          size="md"
          leadingIcon="download"
          className={cx(styles.entry, className)}
          aria-label={trade ? t('reports.register.tradeButtonName', { trade }) : undefined}
          onClick={show}
        >
          {t(trade ? 'reports.register.tradeButton' : staff ? 'reports.register.staffButton' : 'reports.register.batchButton')}
        </Button>
      )}
      {open && (
        <RegisterDownloadSheet
          target={target}
          onClose={() => {
            restore.current = true;
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** The register sheet on screen, if any: one at a time, so a newer one (voice's request over a tapped one) closes it. */
let shown: { readonly close: () => void } | null = null;

interface RegisterDownloadSheetProps {
  readonly target: RegisterTarget;
  readonly onClose: () => void;
  /** The month chosen first (voice's request, D-140); this month when absent or not offered. */
  readonly initialMonth?: LocalDate;
}

/**
 * Month choice and the download itself; mounted only while open, so each opening starts on this month (or the month
 * voice chose). One sheet at a time: a newer one closes the one before it. The download always needs the trainer's
 * own tap on Download.
 */
export function RegisterDownloadSheet({ target, onClose, initialMonth }: RegisterDownloadSheetProps) {
  const { t, format, language } = useI18n();
  const ctx = useSession();
  const { reports } = useServices();
  const toast = useToast();
  const name = useId();
  const months = reports.registerMonths(ctx);
  const [month, setMonth] = useState<LocalDate>(initialMonth && months.includes(initialMonth) ? initialMonth : months[0]);
  const [busy, setBusy] = useState(false);
  const today = toLocalDate(ctx.clock.now());
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    // The latest request wins: a sheet already open (for example one the trainer tapped) gives way to this one.
    const me = { close: () => closeRef.current() };
    shown?.close();
    shown = me;
    return () => {
      if (shown === me) shown = null;
    };
  }, []);

  const label = (first: LocalDate) => {
    if (first !== startOfMonth(today)) return format.monthYear(first);
    const range = today === first ? format.dayMonth(today) : `${format.number(1)}–${format.dayMonth(today)}`;
    return t('reports.register.soFar', { month: format.monthYear(first), range });
  };

  const finish = (message: Parameters<typeof t>[0]) => {
    onClose();
    toast.show(t(message));
  };

  /** The file for the chosen month, or null when the service refuses it (out of scope, a month not offered). */
  const prepare = async (): Promise<{ readonly name: string; readonly html: string } | null> => {
    const { scope } = target;
    // The only demo check: an inline comparison, so a demo-off build carries no demo code.
    const doc = { t, format, lang: language, sampleData: process.env.NEXT_PUBLIC_DEMO_MODE === 'true' };
    if (scope.kind === 'staff') {
      const register = await reports.staffRegister(ctx, month);
      return register && { name: staffRegisterFileName(register), html: staffRegisterDocument(register, { ...doc, logo: await brandLogo() }) };
    }
    const register = await reports.register(ctx, { batchIds: target.batchIds, month });
    return register && { name: registerFileName(register, scope), html: registerDocument(register, { ...doc, logo: await brandLogo(), scope }) };
  };

  const download = async () => {
    // Android WebViews ignore <a download> unless the host app handles it: say so rather than fail silently.
    if (isEmbeddedWebView()) return finish('reports.register.unavailable');
    setBusy(true);
    try {
      const file = await prepare();
      if (!file) return finish('reports.register.problem');
      // Not saved: "inside this app" only in an embedded WebView; any other browser that cannot save gets the problem.
      const saved = saveTextFile(file.name, file.html);
      finish(saved ? 'reports.register.done' : isEmbeddedWebView() ? 'reports.register.unavailable' : 'reports.register.problem');
    } catch {
      finish('reports.register.problem');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('reports.register.title')}
      description={target.subject}
      actions={
        <>
          <Button fullWidth leadingIcon="download" loading={busy} onClick={() => void download()}>
            {busy ? t('reports.register.preparing') : t('reports.register.download')}
          </Button>
          <Button variant="secondary" fullWidth onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </>
      }
    >
      <fieldset className={styles.months}>
        <legend className={styles.legend}>{t('reports.register.month')}</legend>
        {months.map((first) => (
          <label key={first} className={cx(styles.option, first === month && styles.selected)}>
            <input type="radio" name={name} value={first} checked={first === month} onChange={() => setMonth(first)} disabled={busy} className={styles.radio} />
            <span className={styles.optionLabel}>{label(first)}</span>
          </label>
        ))}
      </fieldset>
      <InlineNote>{t('reports.register.note')}</InlineNote>
    </BottomSheet>
  );
}
