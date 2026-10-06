'use client';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSessionState } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { cx } from '@/lib/cx';
import type { DemoAdapters } from '../adapters';
import type { DemoController } from '../controller';
import { PERSONAS, type DemoPersona } from '../personas';
import { PRESETS } from '../presets';
import { DemoData } from './DemoData';
import { DemoQuick } from './DemoQuick';
import { DemoSettings } from './DemoSettings';
import { useDemoState } from './useDemoState';
import styles from './DemoPanel.module.css';

/** DEMO ONLY. The demo persona signed in now (by the session's staff id), if any. */
export function useSignedInPersona(): DemoPersona | undefined {
  const { state: session } = useSessionState();
  return session.status === 'ready' ? PERSONAS.find((p) => p.staffId === session.ctx.user.id) : undefined;
}

/**
 * DEMO ONLY. The title bar's subtitle: the visible "not part of the product"
 * cue (D-047: visibly temporary tooling) and who is signed in, network, language.
 */
export function DemoStatus({ demo }: { readonly demo: DemoAdapters }) {
  const state = useDemoState(demo);
  const signedIn = useSignedInPersona();
  const { language } = useI18n();
  return (
    <>
      <Badge tone="warning" className={styles.cue}>
        DEMO — not part of the product
      </Badge>
      <span>
        {signedIn ? `${signedIn.title} · ` : 'Signed out · '}
        {state.simulation.online ? 'Online' : 'Offline'} · {language === 'mr' ? <span lang="mr">मराठी</span> : 'English'}
      </span>
    </>
  );
}

/** Each person's everyday story (the preset with the persona's id) and the stories that are not one person's day. */
const PEOPLE = PERSONAS.map((persona) => ({ persona, story: PRESETS.find((p) => p.id === persona.id)! }));
const STORIES = PRESETS.filter((p) => !PERSONAS.some((persona) => persona.id === p.id));

/**
 * DEMO ONLY — presenter controls. Never part of the instructor product (English only on purpose).
 * Ordered by what a presenter does (D-157): pick who to show (Sign in as signs straight in), or a story that is not one
 * person's day; then the few settings changed during a demo (Quick settings, always open); everything else waits
 * under Advanced; then where the data lives and Reset.
 */
export function DemoPanel({ demo, controller, onDone }: { readonly demo: DemoAdapters; readonly controller: DemoController; readonly onDone?: () => void }) {
  const state = useDemoState(demo);
  const { state: session } = useSessionState();
  const signedIn = useSignedInPersona();
  const { configuration, faceMatch } = useServices();
  const { language } = useI18n();
  const ctx = session.status === 'ready' ? session.ctx : null;
  const config = ctx?.config ?? configuration.base();
  const [confirmReset, setConfirmReset] = useState(false);
  const { data: enrolled } = useQuery(`demo-face:${ctx?.user.id}`, () => (ctx ? faceMatch.isEnrolled(ctx.user.id) : Promise.resolve(true)), ['face']);
  const run = (p: Promise<void> | void) => {
    void Promise.resolve(p).then(() => onDone?.());
  };

  return (
    <div className={styles.panel} lang="en">
      <section className={styles.section}>
        <h3 id="demo-sign-in" className={styles.sectionTitle}>
          Sign in as
        </h3>
        {/* One divided list; the person signed in is marked (check, brand tint, aria-current). Only the list is named. */}
        <ul className={styles.personas} aria-labelledby="demo-sign-in">
          {PEOPLE.map(({ persona, story }) => {
            const current = signedIn?.id === persona.id;
            return (
              <li key={persona.id} className={styles.personaItem}>
                <button type="button" className={cx(styles.persona, current && styles.current)} aria-current={current ? 'true' : undefined} onClick={() => run(controller.applyPreset(story.id))}>
                  <span className={styles.personaText}>
                    {/* The person's own title, as the login screen's Demo accounts name them (U18); stories keep theirs. */}
                    <span className={styles.presetTitle}>{persona.title}</span>
                    <span className={styles.presetLine}>
                      {persona.name} · {story.line}
                    </span>
                  </span>
                  <Icon name={current ? 'check' : 'log-in'} size={20} className={styles.personaIcon} />
                </button>
              </li>
            );
          })}
        </ul>
        <Button variant="secondary" size="md" fullWidth leadingIcon="log-in" onClick={() => run(controller.showLogin())}>
          Show the login screens
        </Button>
      </section>

      <section className={styles.section} aria-labelledby="demo-stories">
        <h3 id="demo-stories" className={styles.sectionTitle}>
          Stories
        </h3>
        <div className={styles.presets}>
          {STORIES.map((p) => (
            <button key={p.id} type="button" className={cx(styles.preset, state.presetId === p.id && styles.active)} aria-pressed={state.presetId === p.id} onClick={() => run(controller.applyPreset(p.id))}>
              <span className={styles.presetTitle}>{p.title}</span>
              <span className={styles.presetLine}>{p.line}</span>
            </button>
          ))}
        </div>
      </section>

      <DemoQuick config={config} state={state} controller={controller} language={language} />

      <details className={styles.advanced}>
        <summary className={styles.summary}>
          <span>Advanced</span>
          <Icon name="chevron-down" size={20} className={styles.summaryIcon} />
        </summary>
        <div className={styles.advancedBody}>
          <DemoSettings config={config} state={state} controller={controller} faceEnrolled={enrolled ?? true} />
        </div>
      </details>

      <DemoData controller={controller} />

      <section className={styles.section}>
        {confirmReset ? (
          <div className={styles.confirm}>
            <p className={styles.hint}>Restore all demo data on this device: records, corrections, face enrolment, queue and settings?</p>
            <Button variant="destructive" size="md" fullWidth leadingIcon="rotate-ccw" onClick={() => controller.reset()}>
              Reset everything
            </Button>
            <Button variant="secondary" size="md" fullWidth onClick={() => setConfirmReset(false)}>
              Keep demo
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="md" fullWidth leadingIcon="rotate-ccw" onClick={() => setConfirmReset(true)}>
            Reset demo
          </Button>
        )}
        <p className={styles.hint}>Configuration changes start a new session: verification runs again.</p>
      </section>
    </div>
  );
}
