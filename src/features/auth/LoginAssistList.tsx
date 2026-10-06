'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { List, ListRow } from '@/components/ui/ListRow';
import { Spinner } from '@/components/ui/Spinner';
import { useT } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import type { LoginAssistSource, LoginCredentials } from '@/services/login-assist';
import { assistErrorText, chooseAccount } from './assistSignIn';
import { useLoginFlow } from './LoginFlow';
import styles from './LoginAssist.module.css';

type Field = keyof Pick<LoginCredentials, 'instituteCode' | 'trainerId'>;

const NO_SUBSCRIPTION = () => () => undefined;

function useLoginAssist(source: LoginAssistSource | null) {
  const subscribe = useMemo(() => (source ? (cb: () => void) => source.subscribe(cb) : NO_SUBSCRIPTION), [source]);
  return useSyncExternalStore(subscribe, () => source?.get() ?? null, () => null);
}

/**
 * The account picked from the list earlier in this attempt, for one field: its
 * value (to prefill the field when the user comes back to it) and `edited`,
 * which forgets the pick once the user types something else, so a later step
 * never looks up an account whose value is no longer in the field.
 */
export function useAssistAccountValue(field: Field) {
  const source = useServices().loginAssist;
  const flow = useLoginFlow();
  const value = (flow.assistAccount && source?.credentials(flow.assistAccount)?.[field]) || null;
  return {
    value,
    edited: (next: string) => {
      if (value !== null && next !== value) flow.setAssistAccount(null);
    },
  };
}

interface LoginAssistListProps {
  /** Shows the picked account's institute code in the field while it is looked up. */
  readonly onFill: (instituteCode: string) => void;
  /** A failed lookup: the step's own error text, shown on the field. */
  readonly onError: (message: string) => void;
  /** The typed code is being checked: no tap starts a second lookup. */
  readonly disabled?: boolean;
  /** A picked account is being looked up (the screen holds its own Continue meanwhile). */
  readonly onBusyChange?: (busy: boolean) => void;
}

/**
 * The accounts to sign in with, under the Institute code field. Renders only
 * when the container has a LoginAssistSource (demo builds); all its text comes
 * from that source. One tap looks up the account's institute and goes where a
 * typed code would; every configured confirmation still follows (assistSignIn).
 * Nothing takes focus, so no keyboard opens on a phone.
 */
export function LoginAssistList({ onFill, onError, disabled = false, onBusyChange }: LoginAssistListProps) {
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const assist = useLoginAssist(services.loginAssist);
  const flow = useLoginFlow();
  const [busy, setBusyId] = useState<string | null>(null);
  const setBusy = (id: string | null) => {
    setBusyId(id);
    onBusyChange?.(id !== null);
  };
  if (!services.loginAssist || !assist) return null;

  const choose = async (id: string) => {
    if (busy || disabled) return;
    setBusy(id);
    const code = services.loginAssist?.credentials(id)?.instituteCode;
    if (code) onFill(code);
    const failed = (message: string | null) => {
      setBusy(null);
      // The field now shows this pick's code: an earlier pick in this attempt must not be looked up after it.
      flow.setAssistAccount(null);
      if (message) onError(message);
    };
    // chooseAccount answers every failure itself; this catch is the last guard, so the rows can never stay disabled.
    const step = await chooseAccount(services, flow, id).catch(() => null);
    if (!step) return failed(t('login.lookupFailed'));
    if (!step.ok) return failed(assistErrorText(t, step.error));
    // The row keeps its progress until the next screen replaces this one.
    if (step.signedIn) router.replace(step.route);
    else router.push(step.route);
  };

  return (
    // Only the list carries the name "Demo accounts" (a named section would announce it twice).
    <section className={styles.assist} lang="en" data-login-assist="">
      <div className={styles.head}>
        <h2 className={styles.heading}>
          <Icon name="presentation" size={16} className={styles.icon} />
          {assist.heading}
        </h2>
        <p className={styles.hint}>{assist.hint}</p>
      </div>
      <List label={assist.heading} className={styles.list}>
        {assist.options.map((o) => (
          <ListRow
            key={o.id}
            minHeight={56}
            leading={<Avatar name={o.who} size={40} />}
            // The trailing space keeps the accessible name "Principal Dr. Anil Deshmukh · …" (a flex column renders none).
            title={
              <>
                {o.label}{' '}
              </>
            }
            subtitle={`${o.who} · ${o.line}`}
            // The person picked last is marked as the demo panel marks them (U18): a check as well as the tint.
            trailing={busy === o.id ? <Spinner size={20} /> : o.id === assist.suggested ? <Icon name="check" size={20} className={styles.check} /> : 'chevron'}
            onClick={() => void choose(o.id)}
            busy={busy === o.id}
            disabled={disabled || (busy !== null && busy !== o.id)}
            current={o.id === assist.suggested}
          />
        ))}
      </List>
    </section>
  );
}
