'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { voiceDebug } from '@/services/voice/debug';

interface Props {
  /** Stops voice (best effort): the floating controls are gone, so nothing could stop it any more. */
  readonly onError: () => void;
  readonly children: ReactNode;
}

/**
 * Keeps a crash in the floating voice UI to itself (D-158): voice stops, one debug line names the error (its name
 * only, never its message), and nothing renders in its place, so the screen and the tap flow keep working. React's
 * own error report is left alone, so the E2E fixture still fails on a crash.
 */
export class VoiceErrorBoundary extends Component<Props, { readonly crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { readonly crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    try {
      this.props.onError();
    } catch {
      /* nothing left to stop */
    }
    voiceDebug(`float crashed: ${error instanceof Error ? error.name : 'unknown'}`);
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}
