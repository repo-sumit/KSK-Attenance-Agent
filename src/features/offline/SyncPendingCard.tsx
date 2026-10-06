'use client';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useJourney } from '@/hooks/session';
import { useSyncStatus } from '@/hooks/useSync';
import { cx } from '@/lib/cx';
import { routes } from '@/lib/routes';
import styles from './SyncPending.module.css';

export interface SyncPendingItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly when: string;
}

interface SyncPendingCardProps {
  /**
   * The records waiting to sync (Offline data only): what each is and when it was locked. Without it (Home) the card
   * links to that list instead, while offline is on ("See what's waiting", D-153).
   */
  readonly items?: readonly SyncPendingItem[];
  /** A line under the list (the end-of-day rule). */
  readonly note?: string;
}

/**
 * "Sync pending" (D-064): attendance locked on this phone that the server does
 * not have yet, with one obvious action, Sync now. Only there while something
 * is waiting (and for the moment after it syncs, to say so); never on a phone
 * that is all synced. States: waiting (why: offline, or auto-sync failed at a
 * time) · syncing · couldn't sync (after a Sync now) · all synced.
 * Home and Offline data show it; the connectivity bar leaves sync to it there.
 * Offline data also lists the waiting records inside it, with the end-of-day
 * rule they are measured against (RPT-4); Home keeps the compact card, with a
 * link to that list while offline is on (D-153).
 */
export function SyncPendingCard({ items, note }: SyncPendingCardProps) {
  const { t, format } = useI18n();
  const toast = useToast();
  const { sync } = useServices();
  const status = useSyncStatus();
  const offline = useJourney().offline.enabled;
  const titleId = useId();
  const busy = status.phase === 'syncing';
  const waiting = status.pending > 0 || busy;
  // "All attendance synced" only follows a sync this card was showing, never a phone that had nothing waiting.
  const [seen, setSeen] = useState(waiting);
  if (waiting && !seen) setSeen(true);
  const done = !waiting && status.phase === 'synced' && seen;
  if (!waiting && !done) return null;

  const failure = status.lastFailure;
  const tapFailed = status.phase === 'failed' && failure?.trigger === 'manual';
  const time = failure ? format.time(failure.at) : '';
  const view = done
    ? { tone: styles.success, icon: <Icon name="circle-check" size={20} />, title: t('sync.synced'), body: null, meta: null }
    : busy
      ? { tone: styles.warning, icon: <Icon name="cloud-upload" size={20} />, title: t('syncCard.syncingTitle'), body: t('syncCard.sending', { count: status.pending }), meta: null }
      : tapFailed
        ? { tone: styles.warning, icon: <Icon name="alert" size={20} />, title: t('syncCard.failedTitle'), body: t('syncCard.savedCount', { count: status.pending }), meta: t('syncCard.triedAt', { time }) }
        : {
            tone: styles.warning,
            icon: <Icon name="cloud-upload" size={20} />,
            title: t('syncCard.title'),
            body: t('syncCard.waiting', { count: status.pending }),
            meta: !status.online ? t('syncCard.offlineMeta') : failure ? t(failure.trigger === 'auto' ? 'syncCard.autoFailed' : 'syncCard.triedAt', { time }) : t('syncCard.savedHere'),
          };

  const details = !done && !!items?.length;
  const seeWaiting = !items && offline;
  return (
    <section className={cx(styles.card, view.tone)} aria-labelledby={titleId}>
      <div className={cx(styles.inner, details && styles.hasDetails)}>
        <span className={styles.lead} aria-hidden="true">
          {view.icon}
        </span>
        {/* Spoken when it changes (syncing, couldn't sync, synced). */}
        <div className={styles.text} role="status">
          <h2 id={titleId} className={styles.title}>
            {view.title}
          </h2>
          {view.body && <p className={styles.body}>{view.body}</p>}
          {view.meta && <p className={styles.meta}>{view.meta}</p>}
        </div>
        {details && (
          <div className={styles.details}>
            <ul className={styles.items}>
              {items.map((item) => (
                <li key={item.id} className={styles.item}>
                  <span className={styles.itemLabel}>{item.label}</span>
                  <span className={styles.itemWhen}>{item.when}</span>
                </li>
              ))}
            </ul>
            {note && <p className={styles.note}>{note}</p>}
          </div>
        )}
        {!done && (
          <div className={styles.action}>
            <Button
              size="md"
              fullWidth
              leadingIcon="refresh"
              loading={busy}
              inactive={!status.online}
              onInactivePress={() => toast.show(t('syncCard.connectFirst'))}
              onClick={() => void sync.syncNow('manual')}
            >
              {busy ? t('syncCard.syncing') : tapFailed ? t('common.tryAgain') : t('common.syncNow')}
            </Button>
            {seeWaiting && (
              <Button variant="ghost" size="md" fullWidth href={routes.offline}>
                {t('offline.seeWaiting')}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
