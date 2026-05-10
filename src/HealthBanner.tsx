import { useEffect, useState } from 'react';
import { apiHealth, type Health } from './api/client';

// Polls /api/health on mount. If any required check is failing, render a
// dismissible banner above the canvas with the specific install/setup hint.
// Hidden when everything is green so it doesn't clutter the demo path.
export function HealthBanner() {
  const [h, setH] = useState<Health | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    apiHealth().then(setH).catch(() => setH(null));
  }, []);

  if (!h || dismissed) return null;

  const failing = h.checks.filter((c) => c.required && !c.ok);
  const advisories = h.checks.filter((c) => !c.required && !c.ok);

  if (failing.length === 0 && advisories.length === 0) return null;

  const hardFail = failing.length > 0;
  const accent = hardFail ? 'var(--status-error)' : '#92400e';

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 28px',
        fontSize: 'var(--fs-sm)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
      }}
    >
      <div style={{ width: 3, alignSelf: 'stretch', background: accent, borderRadius: 2, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 600,
            color: accent,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          {hardFail ? 'Setup incomplete' : 'Reduced features'}
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', marginBottom: failing.length + advisories.length ? 6 : 0 }}>
          {hardFail ? 'Renders will fail until the items below are fixed.' : 'Some optional integrations are not configured.'}
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {failing.map((c) => (
            <li key={c.name} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
              <code style={{ color: 'var(--text)' }}>{c.name}</code>
              <span style={{ color: 'var(--text-3)', margin: '0 6px' }}>—</span>
              {c.error || 'missing'}
              {c.path && <span style={{ color: 'var(--text-3)' }}> ({c.path})</span>}
            </li>
          ))}
          {advisories.map((c) => (
            <li key={c.name} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
              <code style={{ color: 'var(--text)' }}>{c.name}</code>
              <span style={{ color: 'var(--text-3)', margin: '0 6px' }}>not set —</span>
              {c.hint}
            </li>
          ))}
        </ul>
      </div>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: 'transparent',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-2)',
          borderRadius: 'var(--r-md)',
          padding: '5px 11px',
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
