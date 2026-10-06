'use client';
import { useRouter } from 'next/navigation';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { BottomSheet, SheetGrabber, sheetSurface } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { Latin } from '@/components/ui/Latin';
import { List, ListRow } from '@/components/ui/ListRow';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/Toast';
import { StatusLine } from '@/components/ui/StatusLine';
import { NavigationGuardContext } from '@/components/shell/AppNav';
import type { Language } from '@/config/types';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { routes } from '@/lib/routes';
import { LatinText } from '../common/LatinText';
import { RoleLine } from '../common/RoleLine';
import { userRole } from '../home/roleLine';
import styles from './ProfileMenu.module.css';

const LANGUAGE_NAMES: Readonly<Record<Language, { label: string; lang: string }>> = {
  en: { label: 'English', lang: 'en' },
  mr: { label: 'मराठी', lang: 'mr' },
};

/**
 * The single profile entry point (D-046): the avatar at the top right of every
 * signed-in screen. Phones: a bottom sheet. Tablets and desktops: a menu
 * anchored under the avatar. Native <dialog>: focus stays inside, Esc closes,
 * focus returns to the avatar.
 */
export function ProfileMenu() {
  const { t } = useI18n();
  const ctx = useSession();
  const { auth } = useServices();
  const router = useRouter();
  // Unsaved work on the screen (the principal's staff marks) is asked about before leaving from here too.
  const guard = useContext(NavigationGuardContext);
  const guarded = (go: () => void) => (guard ? guard(go) : go());
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [logout, setLogout] = useState(false);

  const show = () => {
    const d = dialog.current;
    const r = trigger.current?.getBoundingClientRect();
    if (!d || !r) return;
    // Anchor for the tablet/desktop menu (the phone sheet ignores it): below the whole header, so it
    // never covers the header's bottom edge, with its right edge on the avatar's.
    const header = trigger.current?.closest('header')?.getBoundingClientRect();
    d.style.setProperty('--overlay-top', `${Math.round(header?.bottom ?? r.bottom)}px`);
    d.style.setProperty('--overlay-right', `${Math.round(window.innerWidth - r.right)}px`);
    setOpen(true);
    d.showModal();
  };
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={t('a11y.profile')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
      >
        <Avatar name={ctx.user.name} size={44} />
      </button>
      <dialog
        ref={dialog}
        className={sheetSurface('anchored')}
        aria-label={t('a11y.profile')}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && close()}
      >
        {open && <MenuContent onClose={close} guarded={guarded} onLogout={() => { close(); guarded(() => setLogout(true)); }} />}
      </dialog>
      <BottomSheet
        open={logout}
        onClose={() => setLogout(false)}
        title={t('profile.logoutTitle')}
        description={t('profile.logoutBody')}
        actions={
          <>
            <Button variant="destructive" fullWidth onClick={async () => { await auth.signOut(); router.replace(routes.login); }}>
              {t('profile.logout')}
            </Button>
            <Button variant="secondary" fullWidth onClick={() => setLogout(false)}>
              {t('common.cancel')}
            </Button>
          </>
        }
      />
    </>
  );
}

interface MenuContentProps {
  readonly onClose: () => void;
  readonly onLogout: () => void;
  /** Runs a navigation through the screen's unsaved-work guard, if it has one. */
  readonly guarded: (go: () => void) => void;
}

/** Mounted only while the menu is open, so its queries don't run on every screen. */
function MenuContent({ onClose, onLogout, guarded }: MenuContentProps) {
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const ctx = useSession();
  const { faceMatch } = useServices();
  const j = ctx.journey;
  const nameId = useId();
  const nameRef = useRef<HTMLHeadingElement>(null);
  // Start on the person's name (showModal() ran before this content existed, so focus it here).
  useEffect(() => nameRef.current?.focus(), []);
  const { data: enrolled } = useQuery(`face:${ctx.user.id}`, () => faceMatch.isEnrolled(ctx.user.id), ['face']);
  const after = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div className={styles.panel}>
      <SheetGrabber />
      <div className={styles.identity}>
        <Avatar name={ctx.user.name} size={48} />
        <div className={styles.who}>
          <h2 id={nameId} ref={nameRef} className={styles.name} tabIndex={-1}>
            <Latin>{ctx.user.name}</Latin>
          </h2>
          <p className={styles.role}>
            <RoleLine {...userRole(t, ctx)} />
          </p>
          <p className={styles.meta}>
            <Latin>{ctx.institute.shortName}</Latin> · <span className={styles.nowrap}>
              <LatinText k="profile.trainerIdValue" params={{ id: ctx.user.trainerId }} latin={['id']} />
            </span>
          </p>
        </div>
      </div>
      <List className={styles.list} label={t('profile.settings')}>
        {j.language.canSwitch && (
          <ListRow
            leading={<Icon name="languages" size={20} className={styles.icon} />}
            titleStyle="label"
            title={t('profile.language')}
            trailing={
              <Segmented
                label={t('profile.language')}
                size="sm"
                value={language}
                onChange={setLanguage}
                options={j.language.available.map((l) => ({ value: l, label: LANGUAGE_NAMES[l].label, lang: LANGUAGE_NAMES[l].lang }))}
              />
            }
            minHeight={56}
          />
        )}
        {j.verification.face && (
          <ListRow
            leading={<Icon name="scan-face" size={20} className={styles.icon} />}
            titleStyle="label"
            title={t('profile.face')}
            onClick={after(() => (enrolled ? toast.show(t('profile.faceRegisteredToast')) : guarded(() => router.push(routes.face(window.location.pathname + window.location.search)))))}
            trailing={
              enrolled === undefined ? null : (
                <StatusLine tone={enrolled ? 'success' : 'warning'} icon={enrolled ? 'circle-check' : 'alert'} nowrap>
                  {enrolled ? t('profile.registered') : t('profile.notSetUp')}
                </StatusLine>
              )
            }
            minHeight={56}
          />
        )}
        <ListRow
          leading={<Icon name="help" size={20} className={styles.icon} />}
          titleStyle="label"
          title={t('profile.help')}
          onClick={after(() => toast.show(t(j.homeVariant === 'institute' ? 'common.helpToastPrincipal' : 'common.helpToast')))}
          minHeight={56}
        />
        <ListRow leading={<Icon name="logout" size={20} />} tone="danger" title={t('profile.logout')} onClick={onLogout} minHeight={56} />
      </List>
    </div>
  );
}
