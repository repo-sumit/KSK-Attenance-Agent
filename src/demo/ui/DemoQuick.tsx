'use client';
import { useId } from 'react';
import type { AppConfiguration } from '@/config/types';
import type { DemoController, NetworkMode } from '../controller';
import type { DemoState } from '../state';
import { Choice, ON_OFF, onOff } from './DemoSettings';
import styles from './DemoPanel.module.css';

interface QuickProps {
  readonly config: AppConfiguration;
  readonly state: DemoState;
  readonly controller: DemoController;
  readonly language: 'en' | 'mr';
}

/**
 * DEMO ONLY. Quick settings, always open: the few controls a presenter changes during a demo (Voice Agent and its
 * model, the time of day, the network, the language). Only `voice.enabled` and the voice model: never voice limits or
 * marking styles, which have their own validation rules.
 */
export function DemoQuick({ config, state, controller: c, language }: QuickProps) {
  const titleId = useId();
  const sim = state.simulation;
  const network: NetworkMode = !sim.online ? 'offline' : config.offline.autoSync ? 'online' : 'pending';
  const clock = state.clock.mode === 'real' ? 'real' : state.clock.time;

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.sectionTitle}>
        Quick settings
      </h3>
      <Choice label="Voice Agent" value={onOff(config.voice.enabled)} options={ON_OFF} onChange={(v) => c.setConfig({ voice: { enabled: v === 'on' } })} />
      {config.voice.enabled && (
        <>
          {/* The presenting machine's choice (presets keep it): used from the next Voice Agent start. */}
          <Choice label="Voice model" value={sim.voice} options={[['live', 'Live'], ['scripted', 'Scripted']]} onChange={(v) => c.setSimulation({ voice: v })} />
          {sim.voice === 'scripted' && <p className={styles.hint}>Scripted (no mic, no network)</p>}
        </>
      )}
      <Choice
        label="Time of day"
        value={clock}
        options={[['07:30', '7:30'], ['10:15', '10:15'], ['11:30', '11:30'], ['14:30', '2:30 PM'], ['real', 'Real']]}
        onChange={(v) => c.setClock(v)}
      />
      <Choice label="Network" value={network} options={[['online', 'Online'], ['offline', 'Offline'], ['pending', 'Pending sync']]} onChange={(v) => void c.setNetwork(v)} />
      <Choice label="Language" value={language} options={[['en', 'English'], ['mr', 'मराठी']]} onChange={(v) => void c.setLanguage(v)} />
    </section>
  );
}
