import { useEffect, useState } from 'react';
import { fetchAvatars, fetchVoices, type HeyGenAvatar, type HeyGenVoice } from '../api/client';

type Item = { id: string; label: string; sublabel?: string };

interface Props {
  kind: 'avatar' | 'voice';
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 11px',
  fontSize: 'var(--fs-sm)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

// Single picker component for both avatars and voices since the shape is
// identical: fetch list once (deduped at the api/client level), render a
// native select grouped/sorted by name, fall back to a free-text input
// if HEYGEN_API_KEY is missing on the server (503).
export function HeyGenPicker({ kind, value, onChange }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const promise = kind === 'avatar' ? fetchAvatars() : fetchVoices();
    promise
      .then((list) => {
        if (kind === 'avatar') {
          setItems(
            (list as HeyGenAvatar[]).map((a) => ({
              id: a.id,
              label: a.name,
              sublabel: a.gender || undefined,
            })),
          );
        } else {
          setItems(
            (list as HeyGenVoice[]).map((v) => ({
              id: v.id,
              label: v.name,
              sublabel: [v.language, v.gender].filter(Boolean).join(' · ') || undefined,
            })),
          );
        }
      })
      .catch((e) => {
        setError(String(e?.message || e));
      });
  }, [kind]);

  // Hard fallback: HeyGen library not reachable (no API key, network).
  // Free-text input keeps the workflow unblocked.
  if (error) {
    return (
      <div>
        <input
          className="nodrag"
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={kind === 'avatar' ? 'avatar id (hex)' : 'voice id (hex)'}
          style={FIELD_STYLE}
        />
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-3)',
            marginTop: 4,
            letterSpacing: 0.2,
          }}
          title={error}
        >
          Library unavailable — paste id directly
        </div>
      </div>
    );
  }

  if (!items) {
    return (
      <div style={{ ...FIELD_STYLE, color: 'var(--text-3)' }}>
        Loading {kind}s…
      </div>
    );
  }

  // If the current value isn't in the library (e.g. an LLM-suggested id
  // the user no longer has access to), surface it as an option labelled
  // "(unknown)" so it round-trips and the user knows it's odd.
  const allItems: Item[] = value && !items.some((i) => i.id === value)
    ? [{ id: value, label: `${value.slice(0, 8)}… (unknown)` }, ...items]
    : items;

  return (
    <select
      className="nodrag"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={FIELD_STYLE}
    >
      <option value="">— use server default —</option>
      {allItems.map((it) => (
        <option key={it.id} value={it.id}>
          {it.label}
          {it.sublabel ? ` · ${it.sublabel}` : ''}
        </option>
      ))}
    </select>
  );
}
