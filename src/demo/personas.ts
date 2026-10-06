/**
 * DEMO ONLY. Demo personas: which staff record plays which part, and the
 * mapping configuration that part implies. In a real state instance every user
 * shares the state's mapping model; the demo lets one institute show all of
 * them by attaching a small config patch to each persona's staff id.
 */
import type { ConfigLayer } from '@/config/types';

export type PersonaId = 'open' | 'trade' | 'batch' | 'timetable' | 'es' | 'group' | 'principal';
export type DemoRole = 'instructor' | 'group_instructor' | 'principal';

export interface DemoPersona {
  readonly id: PersonaId;
  readonly staffId: string;
  /** Login credentials from the mock master data (institute 27410, Govt ITI Pune): looked up by "Demo accounts" on a tap. */
  readonly instituteCode: string;
  readonly trainerId: string;
  readonly name: string;
  readonly role: DemoRole;
  readonly title: string;
  readonly line: string;
  readonly config: ConfigLayer;
}

export const PERSONAS: readonly DemoPersona[] = [
  { id: 'open', staffId: 'st-rajesh', instituteCode: '27410', trainerId: 'TR-10432', name: 'Rajesh Patil', role: 'instructor', title: 'Open instructor', line: 'Rajesh Patil · any trade, any batch', config: { mapping: { model: 'open' } } },
  { id: 'trade', staffId: 'st-sanjay', instituteCode: '27410', trainerId: 'TR-10455', name: 'Sanjay More', role: 'instructor', title: 'Trade-mapped instructor', line: 'Sanjay More · Fitter + Welder', config: { mapping: { model: 'trade', multiTrade: 'named' } } },
  { id: 'batch', staffId: 'st-sunita', instituteCode: '27410', trainerId: 'TR-10518', name: 'Sunita Jadhav', role: 'instructor', title: 'Batch-mapped instructor', line: 'Sunita Jadhav · 2 assigned batches', config: { mapping: { model: 'batch' } } },
  {
    id: 'timetable',
    staffId: 'st-vikas',
    instituteCode: '27410',
    trainerId: 'TR-10377',
    name: 'Vikas Shinde',
    role: 'instructor',
    title: 'Timetable instructor',
    line: 'Vikas Shinde · period-wise, time fenced',
    config: { mapping: { model: 'timetable' }, marking: { frequency: 'period' }, time: { fencing: true } },
  },
  { id: 'es', staffId: 'st-meera', instituteCode: '27410', trainerId: 'TR-11024', name: 'Meera Kulkarni', role: 'instructor', title: 'Employability Skills instructor', line: 'Meera Kulkarni · 5 batches in 4 trades', config: { mapping: { model: 'batch' } } },
  { id: 'group', staffId: 'st-yogesh', instituteCode: '27410', trainerId: 'TR-10390', name: 'Yogesh Dalvi', role: 'group_instructor', title: 'Group instructor', line: 'Yogesh Dalvi · 2 classes + Electrician overview', config: { mapping: { model: 'batch' } } },
  { id: 'principal', staffId: 'st-anil', instituteCode: '27410', trainerId: 'PR-2741', name: 'Dr. Anil Deshmukh', role: 'principal', title: 'Principal', line: 'Dr. Anil Deshmukh · whole institute', config: {} },
];

/** The first name the Demo trigger shows from 600px ("Demo · Sunita"); a title such as "Dr." is skipped. */
export const firstName = (persona: DemoPersona) => persona.name.replace(/^Dr\.\s+/, '').split(' ')[0];

export const personaById = (id: PersonaId) => PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
export const personaForStaff = (staffId?: string) => PERSONAS.find((p) => p.staffId === staffId);
