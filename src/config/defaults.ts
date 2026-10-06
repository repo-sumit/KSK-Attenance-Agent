/**
 * Product defaults = the PRD registry's recommended starting positions
 * (PRD §14, §18.6, §19.5, §20.8, §21.5). A state instance starts here and
 * changes only what its configuration sheet says.
 */
import type { AppConfiguration } from './types';

export const PRODUCT_DEFAULTS: AppConfiguration = {
  identity: { instituteConfirmStep: true, instructorConfirmStep: true, secondFactor: 'none', principalCanCorrect: true, principalCanMarkStudents: true },
  mapping: { model: 'trade', tradeAutoselect: true, multiTrade: 'named', allBatchInstructors: false },
  verification: { geoMode: 'tagging', fenceRadiusM: 500, fencePassPrompt: 'silent', face: false, faceRetryLimit: null, selfPassReuseMinutes: 0 },
  marking: {
    frequency: 'once',
    twiceShape: 'halves',
    defaultStatus: 'present',
    statusSet: ['present', 'absent'],
    halfDayHalves: false,
    leaveDateRange: true,
  },
  time: {
    fencing: false,
    shiftWindows: { 1: { start: '07:00', end: '14:00' }, 2: { start: '14:00', end: '20:00' } },
    twiceSplit: { 1: '11:00', 2: '17:00' },
    instituteOverride: false,
  },
  staff: { enabled: false, selfMarking: true, captureTrigger: 'explicit_tap', principalMarking: true, statusSet: ['present', 'absent'], selfBeforeStudents: false },
  reports: {
    enabled: true,
    instructorScope: 'both',
    blocks: ['my_batches', 'student_percentage'],
    dateRanges: ['day', 'month', 'custom'],
    pdfDownload: true,
    eligibilityThresholdPct: 75,
    staffThresholdPct: 90,
    leaderboardSort: 'high_first',
    trendMonths: 3,
    windowDays: 30,
    atRiskMinDays: 5,
  },
  offline: {
    enabled: false,
    refreshDays: 7,
    manualRefresh: true,
    multiSelect: true,
    maxBatches: null,
    autoSync: true,
    syncOnOpen: true,
    eodTriggerTime: '21:00',
  },
  announcements: { enabled: false },
  i18n: { languages: ['en'], defaultLanguage: 'en', userSwitch: true, fallback: 'en', numerals: 'locale' },
  voice: {
    enabled: false,
    languages: ['en'],
    defaultLanguage: 'en',
    markingStyle: 'auto',
    voiceName: 'Achernar',
    voiceNames: { en: 'Achernar' },
    maxMinutesPerSession: 20,
    idleTimeoutSeconds: 120,
    dailyMinutesPerTrainer: 60,
    transcriptRetentionDays: 0,
  },
};
