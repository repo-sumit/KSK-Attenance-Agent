'use client';
import { useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Icon } from '@/components/ui/icons/Icon';
import { useI18n } from '@/hooks/i18n';
import { useJourney } from '@/hooks/session';
import { useVoiceBusEvent } from '@/hooks/useVoiceBus';
import { AnnouncementItem, CategoryBadge, useAnnouncementText } from './AnnouncementItem';
import { useAnnouncements } from './useAnnouncements';
import styles from './Announcements.module.css';

/**
 * The compact notice strip near the top of Home (brief §3): only the most
 * important notice, and "N more announcements". One tap opens the full list
 * in a sheet; nothing takes more room than this one card. Voice opens the same sheet (`show_announcements`, D-139),
 * also when Home mounts after the request (the navigation to Home comes first; a later navigation makes it stale).
 */
export function AnnouncementBanner() {
  const { t } = useI18n();
  const j = useJourney();
  const { data } = useAnnouncements();
  const text = useAnnouncementText();
  const [open, setOpen] = useState(false);
  useVoiceBusEvent('show_announcements', () => setOpen(true), { replayMissed: true, replayBound: (e) => e.type === 'navigate' });
  if (!j.announcements.enabled || !data?.length) return null;
  const [top, ...rest] = data;
  const dates = text.dates(top);

  return (
    <section aria-label={t('announce.title')}>
      <button type="button" className={styles.banner} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className={styles.bannerText}>
          <span className={styles.bannerTop}>
            <CategoryBadge announcement={top} />
            {dates && <span className={styles.bannerDate}>{dates}</span>}
          </span>
          <span className={styles.bannerTitle}>{text.title(top)}</span>
          <span className={styles.bannerMore}>{rest.length ? t('announce.more', { count: rest.length }) : t('announce.seeAll')}</span>
        </span>
        <Icon name="chevron-right" size={20} className={styles.chevron} />
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('announce.title')}
        closeLabel={t('announce.close')}
      >
        <ul className={styles.list}>
          {data.map((a) => (
            <AnnouncementItem key={a.id} announcement={a} />
          ))}
        </ul>
      </BottomSheet>
    </section>
  );
}
