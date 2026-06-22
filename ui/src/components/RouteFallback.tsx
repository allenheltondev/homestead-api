import type { ReactElement } from 'react';

// In-page spinner shown while a lazily-loaded route chunk resolves. Uses the
// same spinner treatment as LoadingScreen but sized for the content area
// rather than the full-screen startup splash.
export default function RouteFallback(): ReactElement {
  return (
    <div role="status" aria-label="Loading" className="flex justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-border border-t-primary-600 animate-spin" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
