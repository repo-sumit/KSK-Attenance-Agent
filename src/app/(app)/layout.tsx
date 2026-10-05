import type { ReactNode } from 'react';
import { SessionGate } from '@/components/shell/SessionGate';
import { VoiceProvider } from '@/features/voice/VoiceProvider';

export default function AppLayout({ children }: { readonly children: ReactNode }) {
  // Voice Agent lives inside the gate: it exists only with a ready session and persists across navigation.
  return (
    <SessionGate>
      <VoiceProvider>{children}</VoiceProvider>
    </SessionGate>
  );
}
