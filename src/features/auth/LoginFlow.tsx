'use client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { InstituteMatch, InstructorMatch } from '@/services/auth';

interface LoginFlow {
  readonly institute: InstituteMatch | null;
  readonly instructor: InstructorMatch | null;
  /** The account picked from the login assist in this attempt (demo builds), so later steps look up its Trainer ID. */
  readonly assistAccount: string | null;
  setInstitute(match: InstituteMatch | null): void;
  setInstructor(match: InstructorMatch | null): void;
  setAssistAccount(id: string | null): void;
  /** Deny at a confirmation: nothing from the attempt is remembered (PRD §6.1). */
  reset(): void;
}

const Ctx = createContext<LoginFlow | null>(null);

/** Lookup results (and a picked assist account) live only in memory for the duration of the login steps. */
export function LoginFlowProvider({ children }: { readonly children: ReactNode }) {
  const [institute, setInstitute] = useState<InstituteMatch | null>(null);
  const [instructor, setInstructor] = useState<InstructorMatch | null>(null);
  const [assistAccount, setAssistAccount] = useState<string | null>(null);
  const value = useMemo<LoginFlow>(
    () => ({
      institute,
      instructor,
      assistAccount,
      setInstitute,
      setInstructor,
      setAssistAccount,
      reset: () => {
        setInstitute(null);
        setInstructor(null);
        setAssistAccount(null);
      },
    }),
    [institute, instructor, assistAccount],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLoginFlow(): LoginFlow {
  const flow = useContext(Ctx);
  if (!flow) throw new Error('useLoginFlow outside LoginFlowProvider');
  return flow;
}
