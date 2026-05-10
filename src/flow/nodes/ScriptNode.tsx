import { useEffect, useState } from 'react';
import { Btn, FieldLabel, NodeShell } from './_base';
import { useGraph, type ScriptData, type SourceData, type SceneData } from '../../store';
import { apiGenerateScript } from '../../api/client';

export function ScriptNode({ id, data }: { id: string; data: ScriptData }) {
  const { nodes, setNodes, setEdges, patchNode, pruneNode, setTombstones } = useGraph();
  const source = nodes.find((n) => n.id === 'source')?.data as SourceData | undefined;

  const journeys = source?.journeys ?? [];
  const [picked, setPicked] = useState<string | undefined>(source?.selectedJourney ?? journeys[0]?.slug);

  // Sync `picked` whenever the journey list loads/changes. Without this,
  // the initial useState captures a stale (often undefined) value if the
  // ScriptNode mounts before SourceNode finishes populating journeys —
  // which is exactly when the first click would silently no-op because
  // the button is gated on `!picked`. Hence the "double click" report.
  useEffect(() => {
    if (journeys.length === 0) return;
    if (!picked || !journeys.some((j) => j.slug === picked)) {
      setPicked(journeys[0].slug);
    }
  }, [journeys, picked]);

  const generate = async () => {
    // Fall back to the first journey in case state is genuinely undefined
    // (component just mounted, useEffect hasn't run yet). Belt-and-suspenders
    // with the useEffect above.
    const slug = picked || journeys[0]?.slug;
    if (!slug) return;
    patchNode(id, { status: 'running', error: undefined });
    try {
      const r = await apiGenerateScript(slug);
      patchNode(id, { status: 'done', beats: r.beats, mode: r.mode, model: r.model });
      spawnSceneNodes(r.beats, id);
    } catch (e) {
      patchNode(id, { status: 'error', error: (e as Error).message });
    }
  };

  const spawnSceneNodes = (beats: ScriptData['beats'], scriptNodeId: string) => {
    const SCENE_X = 820;
    // Spawn collapsed → use tight spacing. Each collapsed card is ~80px
    // tall; 130px gives a comfortable gap and fits 6+ scenes in one
    // viewport without scrolling. When the user expands a scene they
    // can drag it or rely on xyflow letting the card overflow downward
    // until they re-collapse.
    const SCENE_SPACING_Y = 130;
    setNodes((prev) => {
      const SCRIPT_Y = prev.find((n) => n.id === scriptNodeId)?.position?.y ?? 200;
      const totalH = (beats.length - 1) * SCENE_SPACING_Y;
      const startY = SCRIPT_Y - totalH / 2;
      const newSceneNodes = beats.map((b, i) => ({
        id: `scene-${b.id}`,
        type: 'sceneNode',
        position: { x: SCENE_X, y: startY + i * SCENE_SPACING_Y },
        data: {
          status: 'idle' as const,
          beatId: b.id,
          kind: b.kind,
          title: b.title,
          narration: b.narration,
          caption: b.caption,
          page: b.page,
          avatarId: b.avatarId,
          collapsed: true, // start compact; user expands to edit
        } satisfies SceneData,
      }));
      return [
        ...prev.filter((n) => !n.id.startsWith('scene-') && n.id !== 'concat'),
        ...newSceneNodes,
      ];
    });
    setEdges((prev) => {
      const newEdges = beats.map((b) => ({
        id: `e-script-scene-${b.id}`,
        source: scriptNodeId,
        target: `scene-${b.id}`,
        animated: true,
      }));
      return [
        ...prev.filter((e) => !e.id.startsWith('e-script-scene-') && !e.id.startsWith('e-scene-concat-')),
        ...newEdges,
      ];
    });
    // Clear pipeline tombstones so a re-generated script can resurrect
    // any scenes/outputs/concat the user deleted in the previous round.
    // User-managed asset-/merge- tombstones stay — those have no spawner
    // anyway and the user's prior delete intent should hold.
    setTombstones((prev) =>
      prev.filter(
        (id) => !(id.startsWith('scene-') || id.startsWith('output-') || id === 'concat'),
      ),
    );
  };

  const modeBadge = data.mode && (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        background: data.mode === 'template' ? 'var(--surface-3)' : 'var(--accent-soft)',
        color: data.mode === 'template' ? 'var(--text-2)' : 'var(--text)',
        padding: '2px 6px',
        borderRadius: 'var(--r-xs)',
        letterSpacing: 0.2,
        textTransform: 'uppercase',
      }}
    >
      {data.mode === 'llm-api' ? `LLM · ${data.model}` : data.mode === 'llm-cli' ? 'LLM · subscription' : 'Template'}
    </span>
  );

  return (
    <NodeShell title="Script" subtitle="Generate ad copy from a journey" status={data.status} onDelete={() => pruneNode(id)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <FieldLabel>Journey</FieldLabel>
          <select
            className="nodrag"
            value={picked ?? ''}
            onChange={(e) => setPicked(e.target.value)}
            disabled={journeys.length === 0}
            style={{
              width: '100%',
              padding: '8px 11px',
              fontSize: 'var(--fs-sm)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          >
            {journeys.length === 0 ? (
              <option>Pull sessions first</option>
            ) : (
              journeys.map((j) => (
                <option key={j.slug} value={j.slug}>
                  {j.slug} ({j.sessions} sessions)
                </option>
              ))
            )}
          </select>
        </div>
        <Btn primary onClick={generate} disabled={!picked || data.status === 'running'}>
          {data.status === 'running' ? 'Generating…' : 'Generate script & split scenes'}
        </Btn>
        {data.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)', lineHeight: 1.4 }}>{data.error}</div>
        )}
        {modeBadge && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
            {modeBadge}
            {data.mode === 'template' && (
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                Install <code>claude</code> CLI or set <code>ANTHROPIC_API_KEY</code>
              </span>
            )}
          </div>
        )}
        {data.beats.length > 0 && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-2)',
              letterSpacing: 0.2,
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span style={{ color: 'var(--text-3)' }}>{data.beats.length} scenes</span>
            {data.beats.map((b, i) => (
              <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: 'var(--text-3)' }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ color: 'var(--text)' }}>{b.kind}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  );
}
