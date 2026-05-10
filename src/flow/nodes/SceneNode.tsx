import { Btn, FieldLabel, Input, NodeShell } from './_base';
import { HeyGenPicker } from '../HeyGenPicker';
import { useGraph, type SceneData } from '../../store';
import { apiRenderScene } from '../../api/client';

// Beat ids look like "b0", "b1" — pull the trailing number, 1-index it
// for the numbered NodeShell badge ("01", "02"…). If the id doesn't
// match the pattern we just don't number the scene.
function beatNumber(beatId: string): number | undefined {
  const m = beatId.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) + 1 : undefined;
}

export function SceneNode({ id, data }: { id: string; data: SceneData }) {
  const { patchNode, pruneNode } = useGraph();

  const update = (patch: Partial<SceneData>) => patchNode(id, patch);

  const render = async () => {
    update({ status: 'running', error: undefined });
    try {
      const r = await apiRenderScene({
        id: data.beatId,
        kind: data.kind,
        title: data.title,
        narration: data.narration,
        caption: data.caption,
        page: data.page,
        avatarId: data.avatarId,
        voiceId: data.voiceId,
      });
      update({
        status: 'done',
        videoUrl: r.videoUrl,
        thumbnailUrl: r.thumbnailUrl,
        durationMs: r.durationMs,
        cached: r.cached,
      });
    } catch (e) {
      update({ status: 'error', error: (e as Error).message });
    }
  };

  return (
    <NodeShell
      title={data.title || (data.kind === 'avatar' ? 'Avatar scene' : 'Page scene')}
      subtitle={data.kind === 'avatar' ? 'Talking head' : data.page || '/'}
      status={data.status}
      index={beatNumber(data.beatId)}
      collapsed={data.collapsed ?? false}
      onToggleCollapse={() => update({ collapsed: !data.collapsed })}
      onDelete={() => pruneNode(id)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.kind === 'page' && (
          <div>
            <FieldLabel>Page</FieldLabel>
            <Input value={data.page ?? '/'} onChange={(v) => update({ page: v })} placeholder="/calculator" />
          </div>
        )}
        {data.kind === 'avatar' && (
          <div>
            <FieldLabel>Avatar</FieldLabel>
            <HeyGenPicker kind="avatar" value={data.avatarId} onChange={(v) => update({ avatarId: v })} />
          </div>
        )}
        <div>
          <FieldLabel>Voice</FieldLabel>
          <HeyGenPicker kind="voice" value={data.voiceId} onChange={(v) => update({ voiceId: v })} />
        </div>
        <div>
          <FieldLabel>Narration</FieldLabel>
          <Input value={data.narration} onChange={(v) => update({ narration: v })} multiline rows={3} />
        </div>
        <div>
          <FieldLabel>Caption</FieldLabel>
          <Input value={data.caption ?? ''} onChange={(v) => update({ caption: v })} placeholder="Short caption…" />
        </div>
        <Btn primary onClick={render} disabled={data.status === 'running'}>
          {data.status === 'running' ? 'Rendering…' : data.videoUrl ? 'Re-render' : 'Render scene'}
        </Btn>
        {data.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)', lineHeight: 1.4 }}>{data.error}</div>
        )}
        {data.status === 'done' && data.durationMs != null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-2)',
              letterSpacing: 0.2,
              paddingTop: 4,
              borderTop: '1px solid var(--border)',
            }}
          >
            <span>{(data.durationMs / 1000).toFixed(2)}s</span>
            {data.cached && (
              <span
                style={{
                  background: 'var(--status-done-soft)',
                  color: 'var(--status-done)',
                  padding: '2px 6px',
                  borderRadius: 'var(--r-xs)',
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}
                title="Reused from cache — no HeyGen credit burned"
              >
                Cached
              </span>
            )}
          </div>
        )}
      </div>
    </NodeShell>
  );
}
