import { useMemo, useRef } from 'react';
import { ConcatSpawner } from './flow/ConcatSpawner';
import { GraphCanvas } from './flow/GraphCanvas';
import { HealthBanner } from './HealthBanner';
import { useGraph, type SceneData } from './store';

const PROJECT_FORMAT_VERSION = 1;

export default function App() {
  const { nodes, edges, setNodes, setEdges, resetGraph } = useGraph();
  const importInput = useRef<HTMLInputElement>(null);

  // Save: snapshot {nodes, edges} into a JSON download. Asset URLs point
  // at /videos/<file>, so loading on a different server only round-trips
  // the *structure* — uploaded media stays with whichever box rendered it.
  const save = () => {
    const payload = {
      version: PROJECT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      nodes,
      edges,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ugc-studio-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Load: parse JSON, do a minimal shape check, replace state. We
  // deliberately don't validate node `data` shapes — any field
  // mismatches surface visually rather than silently dropping content.
  const load = async (file: File) => {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      alert(`Not valid JSON: ${(e as Error).message}`);
      return;
    }
    const p = parsed as { version?: number; nodes?: unknown[]; edges?: unknown[] };
    if (!Array.isArray(p?.nodes) || !Array.isArray(p?.edges)) {
      alert('Invalid project file — missing nodes[] or edges[]');
      return;
    }
    if (p.version != null && p.version > PROJECT_FORMAT_VERSION) {
      if (!window.confirm(`This file is from a newer Studio version (v${p.version} vs v${PROJECT_FORMAT_VERSION}). Try to load anyway?`)) {
        return;
      }
    }
    setNodes(p.nodes as never);
    setEdges(p.edges as never);
  };

  // Reset is destructive — confirm first. Skip the prompt for an empty
  // graph (just the seed Source node) since there's nothing to lose.
  const confirmReset = () => {
    const meaningfulNodes = nodes.length > 1;
    if (meaningfulNodes && !window.confirm(`Reset will discard ${nodes.length} node${nodes.length === 1 ? '' : 's'} and ${edges.length} edge${edges.length === 1 ? '' : 's'}. Continue?`)) {
      return;
    }
    resetGraph();
  };

  // Collapse state for scene nodes. The toggle flips every scene's
  // `collapsed` flag; we choose the next direction based on whether
  // anything is currently expanded (so partial-expanded states snap
  // closed first, then a second click opens everything).
  const sceneNodes = useMemo(() => nodes.filter((n) => n.id.startsWith('scene-')), [nodes]);
  const anyExpanded = sceneNodes.some((n) => !(n.data as unknown as SceneData).collapsed);
  const toggleAllScenes = () => {
    const nextCollapsed = anyExpanded; // expanded → collapse; all-collapsed → expand
    setNodes((prev) =>
      prev.map((n) =>
        n.id.startsWith('scene-')
          ? { ...n, data: { ...n.data, collapsed: nextCollapsed } }
          : n,
      ),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 28px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <div
            style={{
              fontSize: 'var(--fs-xl)',
              fontWeight: 700,
              color: 'var(--text)',
              letterSpacing: -0.6,
              fontFamily: 'var(--font-display)',
              lineHeight: 1,
            }}
          >
            UGC<span style={{ color: 'var(--text-3)', fontWeight: 500, marginLeft: 6 }}>Studio</span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-3)',
              letterSpacing: 0.2,
            }}
          >
            posthog · script · scenes · merge
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {sceneNodes.length > 0 && (
            <HeaderBtn onClick={toggleAllScenes}>
              {anyExpanded ? 'Collapse scenes' : 'Expand scenes'}
            </HeaderBtn>
          )}
          <HeaderBtn onClick={save}>Save</HeaderBtn>
          <HeaderBtn onClick={() => importInput.current?.click()}>Load</HeaderBtn>
          <HeaderBtn onClick={confirmReset} variant="quiet">Reset</HeaderBtn>
          <input
            ref={importInput}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>
      <HealthBanner />
      <ConcatSpawner />
      <div style={{ flex: 1, background: 'var(--bg)' }}>
        <GraphCanvas />
      </div>
    </div>
  );
}

function HeaderBtn({
  onClick,
  children,
  variant = 'default',
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'quiet';
}) {
  const quiet = variant === 'quiet';
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 'var(--r-md)',
        padding: '7px 12px',
        fontSize: 'var(--fs-sm)',
        fontWeight: 500,
        cursor: 'pointer',
        color: quiet ? 'var(--text-3)' : 'var(--text-2)',
        transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.color = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.color = quiet ? 'var(--text-3)' : 'var(--text-2)';
      }}
    >
      {children}
    </button>
  );
}
