'use client';
import type { ReactNode } from 'react';
import { Segmented } from '@/components/ui/Segmented';
import type { AppConfiguration } from '@/config/types';
import type { StatusCode } from '@/domain/status';
import type { DemoController } from '../controller';
import type { DemoState } from '../state';
import styles from './DemoPanel.module.css';

export function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      {children}
    </div>
  );
}

export function Choice<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: ReadonlyArray<readonly [V, string]>; onChange: (v: V) => void }) {
  return (
    <Row label={label}>
      <Segmented label={label} size="sm" fullWidth value={value} onChange={onChange} options={options.map(([v, l]) => ({ value: v, label: l, lang: l === 'मराठी' ? 'mr' : undefined }))} />
    </Row>
  );
}

export const onOff = (b: boolean) => (b ? 'on' : 'off');
export const ON_OFF = [['off', 'Off'], ['on', 'On']] as const;

interface SettingsProps {
  readonly config: AppConfiguration;
  readonly state: DemoState;
  readonly controller: DemoController;
  readonly faceEnrolled: boolean;
}

/**
 * DEMO ONLY. The Advanced settings (collapsed in the panel): verification, marking, time fencing, staff attendance and
 * the next sync. Hidden when their parent option is off. The settings presenters change most are Quick settings.
 */
export function DemoSettings({ config, state, controller: c, faceEnrolled }: SettingsProps) {
  const sim = state.simulation;
  const statuses = config.marking.statusSet;
  const toggleStatus = (code: StatusCode, on: boolean) =>
    c.setConfig({ marking: { statusSet: on ? [...new Set([...statuses, code])] : statuses.filter((s) => s !== code) } });

  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Verification</h3>
        <Choice label="Location" value={config.verification.geoMode} options={[['off', 'Off'], ['tagging', 'Geo tagging'], ['fencing', 'Geo fencing']]} onChange={(v) => c.setConfig({ verification: { geoMode: v } })} />
        {config.verification.geoMode !== 'off' && (
          <>
            {/* Real vs simulated first (brief §18); the simulated outcome only matters when simulating. */}
            <Choice
              label="Location source"
              value={sim.location === 'device_gps' ? 'device' : 'simulated'}
              options={[['simulated', 'Simulated'], ['device', 'This device (GPS)']]}
              onChange={(v) => c.setSimulation({ location: v === 'device' ? 'device_gps' : 'inside' })}
            />
            {sim.location !== 'device_gps' && (
              <Choice
                label="Where is the phone?"
                value={sim.location}
                options={[['inside', 'Inside'], ['outside', 'Outside'], ['permission_denied', 'Denied'], ['unavailable', 'No GPS']]}
                onChange={(v) => c.setSimulation({ location: v })}
              />
            )}
          </>
        )}
        <Choice label="Face verification" value={onOff(config.verification.face)} options={ON_OFF} onChange={(v) => c.setConfig({ verification: { face: v === 'on' } })} />
        {config.verification.face && (
          <>
            <Choice label="Face registered" value={faceEnrolled ? 'yes' : 'no'} options={[['yes', 'Yes'], ['no', 'No']]} onChange={(v) => void c.setFaceEnrolled(v === 'yes')} />
            <Choice label="Camera" value={sim.camera} options={[['device', 'This device'], ['simulated', 'Simulated']]} onChange={(v) => c.setSimulation({ camera: v })} />
            {sim.camera === 'device' ? (
              <Choice label="Face detection" value={sim.liveness} options={[['auto', 'On-device'], ['guided', 'Guided only']]} onChange={(v) => c.setSimulation({ liveness: v })} />
            ) : (
              <Choice
                label="Registration"
                value={sim.enrolmentIssue}
                options={[['none', 'Works'], ['poor_light', 'Dark'], ['multiple_faces', '2 faces'], ['save_failed', 'Fails']]}
                onChange={(v) => c.setSimulation({ enrolmentIssue: v })}
              />
            )}
            {/* Matching is simulated whichever camera is used: there is no face recognition in this build. */}
            <Choice label="Face match (simulated)" value={sim.face === 'no_match' ? 'no_match' : 'match'} options={[['match', 'Matches'], ['no_match', 'No match']]} onChange={(v) => c.setSimulation({ face: v })} />
          </>
        )}
        <Choice
          label={sim.camera === 'device' ? 'Location permission (the camera asks for real)' : 'Permissions'}
          value={sim.permissions.location === 'prompt' ? 'ask' : 'granted'}
          options={[['granted', 'Allowed'], ['ask', 'Ask first']]}
          onChange={(v) => c.setSimulation({ permissions: v === 'ask' ? { location: 'prompt', camera: 'prompt' } : { location: 'granted', camera: 'granted' } })}
        />
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Marking</h3>
        <Choice label="Frequency" value={config.marking.frequency} options={[['once', 'Once'], ['twice', 'Twice'], ['period', 'Periods']]} onChange={(v) => c.setConfig({ marking: { frequency: v } })} />
        <Choice label="Default" value={config.marking.defaultStatus} options={[['present', 'Present'], ['absent', 'Absent'], ['blank', 'Blank']]} onChange={(v) => c.setConfig({ marking: { defaultStatus: v } })} />
        <Choice label="Half day" value={onOff(statuses.includes('half_day'))} options={ON_OFF} onChange={(v) => toggleStatus('half_day', v === 'on')} />
        {statuses.includes('half_day') && (
          <Choice label="Ask which half" value={onOff(config.marking.halfDayHalves)} options={ON_OFF} onChange={(v) => c.setConfig({ marking: { halfDayHalves: v === 'on' } })} />
        )}
        <Choice label="Leave" value={onOff(statuses.includes('leave'))} options={ON_OFF} onChange={(v) => toggleStatus('leave', v === 'on')} />
        <Choice label="OJT (from ERP)" value={onOff(statuses.includes('ojt'))} options={ON_OFF} onChange={(v) => toggleStatus('ojt', v === 'on')} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Time</h3>
        <Choice label="Time fencing" value={onOff(config.time.fencing)} options={ON_OFF} onChange={(v) => c.setConfig({ time: { fencing: v === 'on' } })} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Staff attendance</h3>
        <Choice label="Staff attendance" value={onOff(config.staff.enabled)} options={ON_OFF} onChange={(v) => c.setConfig({ staff: { enabled: v === 'on' } })} />
        {config.staff.enabled && (
          <>
            <Choice label="Self attendance" value={onOff(config.staff.selfMarking)} options={ON_OFF} onChange={(v) => c.setConfig({ staff: { selfMarking: v === 'on' } })} />
            <Choice label="Principal marks staff" value={onOff(config.staff.principalMarking)} options={ON_OFF} onChange={(v) => c.setConfig({ staff: { principalMarking: v === 'on' } })} />
          </>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Sync</h3>
        <Choice label="Next sync" value={sim.nextSyncFails ? 'fails' : 'works'} options={[['works', 'Works'], ['fails', 'Fails']]} onChange={(v) => c.setSimulation({ nextSyncFails: v === 'fails' })} />
      </section>
    </>
  );
}
