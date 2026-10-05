'use client';
import { useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useContainer } from '@/hooks/services';
import type { DemoController } from '../controller';
import type { DataChoice } from '../state';
import type { ResetOutcome } from '../supabase-seeder';
import { Choice, Row } from './DemoSettings';
import styles from './DemoPanel.module.css';

const LABEL: Record<DataChoice, string> = { shared: 'Shared (Supabase)', device: 'This device' };

/** Why a shared reset did not happen; nothing was changed on this device. */
const NOT_RESET: Partial<Record<ResetOutcome, string>> = {
  missing: 'Reset isn’t set up on the server yet',
  offline: 'Couldn’t reach the shared data. Check the connection and try again.',
  failed: 'The shared reset didn’t finish. Try again.',
};

/** Why the Data switch did not happen: records on this device would never reach the other source (Task 17). */
export const waitingToSwitch = (count: number) =>
  count === 1
    ? '1 record on this device is waiting to sync. Sync it or reset the demo before switching data.'
    : `${count} records on this device are waiting to sync. Sync them or reset the demo before switching data.`;

/**
 * DEMO ONLY. Where the demo's records live (D-143): the shared Supabase project, so a phone and a laptop see the same
 * live data, or this device only. The switch is offered only when the build has a project to share; it applies after
 * the reload it does, and is refused while records wait to sync here. "Reset shared demo data" clears the server for every device (after a confirmation here), then
 * seeds today's story again and starts this device afresh.
 */
export function DemoData({ controller }: { readonly controller: DemoController }) {
  const { dataSource } = useContainer();
  const current: DataChoice = dataSource === 'supabase' ? 'shared' : 'device';
  const [step, setStep] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [outcome, setOutcome] = useState<ResetOutcome | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const switchTo = async (choice: DataChoice) => {
    const result = await controller.setDataSource(choice);
    setWaiting(result.kind === 'waiting' ? result.count : null);
  };

  const reset = async () => {
    setStep('running');
    const result = await controller.resetShared();
    // `done` reloads the page; anything else stays here with its reason.
    setOutcome(result);
    setStep('idle');
  };
  const message = outcome ? NOT_RESET[outcome] : undefined;

  return (
    <section className={styles.section} aria-label="Data">
      {controller.sharedAvailable ? (
        <Choice label="Data" value={current} options={[['shared', LABEL.shared], ['device', LABEL.device]]} onChange={(v) => void switchTo(v)} />
      ) : (
        <Row label="Data">
          <span className={styles.value}>{LABEL.device}</span>
        </Row>
      )}
      <p className={styles.hint}>{current === 'shared' ? 'Every device sees the same records live. A switch reloads the app.' : 'Records stay on this device only.'}</p>
      {waiting !== null && (
        <Banner tone="warning" icon="alert" live>
          {waitingToSwitch(waiting)}
        </Banner>
      )}
      {current === 'shared' &&
        (step === 'confirm' ? (
          <div className={styles.confirm}>
            <p className={styles.hint}>Delete the demo’s attendance, corrections, staff marks and face registrations on the server for every device, then set up today’s story again?</p>
            <Button variant="destructive" size="md" fullWidth leadingIcon="rotate-ccw" onClick={() => void reset()}>
              Reset shared data
            </Button>
            <Button variant="secondary" size="md" fullWidth onClick={() => setStep('idle')}>
              Keep shared data
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="md"
            fullWidth
            leadingIcon="rotate-ccw"
            disabled={step === 'running'}
            onClick={() => {
              setOutcome(null);
              setStep('confirm');
            }}
          >
            {step === 'running' ? 'Resetting shared data…' : 'Reset shared demo data'}
          </Button>
        ))}
      {message && (
        <Banner tone="warning" icon="alert" live>
          {message}
        </Banner>
      )}
    </section>
  );
}
