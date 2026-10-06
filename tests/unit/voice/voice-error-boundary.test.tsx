// @vitest-environment jsdom
/**
 * D-158: the floating voice UI sits behind its own error boundary. A crash in it stops voice (best effort), logs a
 * debug line with the error's name only, and renders nothing, so the screen and the tap flow keep working.
 * React's own error report stays (the E2E fixture still fails on a crash).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceErrorBoundary } from '@/features/voice/VoiceErrorBoundary';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function Boom(): never {
  throw new TypeError('voiceService.canWarm is not a function');
}

describe('VoiceErrorBoundary', () => {
  it('renders nothing for a throwing child, keeps its siblings, stops voice and logs the error name', () => {
    window.history.replaceState(null, '', '/home?voiceDebug=1');
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const stop = vi.fn();
    render(
      <main>
        <button type="button">Submit attendance</button>
        <VoiceErrorBoundary onError={stop}>
          <Boom />
        </VoiceErrorBoundary>
      </main>,
    );
    expect(screen.getByRole('button', { name: 'Submit attendance' })).toBeInTheDocument();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(info.mock.calls).toContainEqual(['[voice] float crashed: TypeError']);
    expect(JSON.stringify(info.mock.calls)).not.toContain('canWarm');
    expect(reported).toHaveBeenCalled(); // React's own report is not swallowed
  });

  it('still renders nothing when stopping voice throws too', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <VoiceErrorBoundary
        onError={() => {
          throw new Error('no session');
        }}
      >
        <Boom />
      </VoiceErrorBoundary>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders its children when nothing throws', () => {
    render(
      <VoiceErrorBoundary onError={vi.fn()}>
        <p>voice card</p>
      </VoiceErrorBoundary>,
    );
    expect(screen.getByText('voice card')).toBeInTheDocument();
  });
});
