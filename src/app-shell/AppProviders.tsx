// @refresh reset
'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { SessionProvider } from '@/hooks/session';
import { ToastProvider } from '@/components/ui/Toast';
import { BootSplash } from './BootSplash';
import { bootApp, type AppRuntime } from './boot';

// The env comparison must stay inline so the bundler constant-folds it: with the demo
// off this is null and the demo UI chunk is never emitted (scripts/check-demo-stripped.mjs).
const DemoRoot =
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ? dynamic(() => import('@/demo/ui/DemoRoot').then((m) => m.DemoRoot), { ssr: false }) : null;

/**
 * Client composition root: boots the container once, then mounts the providers. The effect's cleanup disposes the
 * container it booted, also one that resolves after the cleanup (D-158): Strict Mode boots twice in dev, and
 * `@refresh reset` (first line) remounts this component when Fast Refresh re-runs this module, which happens on any
 * edit in services, repositories, config or domain, so a services edit rebuilds the container instead of keeping
 * the old instances. Component-only edits keep normal Fast Refresh.
 */
export function AppProviders({ children }: { readonly children: ReactNode }) {
  const [runtime, setRuntime] = useState<AppRuntime | null>(null);
  useEffect(() => {
    let alive = true;
    let booted: AppRuntime | null = null;
    void bootApp().then((r) => {
      if (!alive) return r.container.dispose();
      booted = r;
      setRuntime(r);
    });
    return () => {
      alive = false;
      booted?.container.dispose();
    };
  }, []);

  if (!runtime) return <BootSplash />;
  return (
    <ServicesProvider container={runtime.container}>
      <I18nProvider>
        <SessionProvider>
          <ToastProvider>
            {DemoRoot && runtime.demo ? <DemoRoot demo={runtime.demo}>{children}</DemoRoot> : children}
          </ToastProvider>
        </SessionProvider>
      </I18nProvider>
    </ServicesProvider>
  );
}
