import { Btn, NodeShell } from './_base';
import { useGraph, type ConcatData, type SceneData } from '../../store';
import { apiConcat } from '../../api/client';

export function ConcatNode({ id, data }: { id: string; data: ConcatData }) {
  const { nodes, patchNode, pruneNode } = useGraph();

  const sceneNodes = nodes
    .filter((n) => n.id.startsWith('scene-'))
    .map((n) => n.data as unknown as SceneData);
  const ready = sceneNodes.filter((s) => s.status === 'done' && s.videoUrl).length;
  const total = sceneNodes.length;
  const allRendered = total > 0 && ready === total;

  const concat = async () => {
    if (!allRendered) return;
    patchNode(id, { status: 'running', error: undefined });
    try {
      const urls = sceneNodes.map((s) => s.videoUrl!);
      const r = await apiConcat(urls);
      patchNode(id, {
        status: 'done',
        videoUrl: r.videoUrl,
        durationMs: r.durationMs,
        sizeBytes: r.sizeBytes,
      });
    } catch (e) {
      patchNode(id, { status: 'error', error: (e as Error).message });
    }
  };

  return (
    <NodeShell title="Final cut" subtitle="Stitch all scenes" status={data.status} showSourceHandle={false} onDelete={() => pruneNode(id)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-2)',
            letterSpacing: 0.2,
          }}
        >
          {total === 0 ? 'Waiting on scenes' : `${ready} / ${total} scenes ready`}
        </div>
        <Btn primary onClick={concat} disabled={!allRendered || data.status === 'running'}>
          {data.status === 'running' ? 'Stitching…' : 'Concat & deliver'}
        </Btn>
        {data.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)', lineHeight: 1.4 }}>{data.error}</div>
        )}
        {data.videoUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <video
              src={data.videoUrl}
              controls
              preload="metadata"
              style={{ width: '100%', borderRadius: 'var(--r-md)', background: '#000', display: 'block' }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-2)',
              }}
            >
              <span>{data.durationMs ? (data.durationMs / 1000).toFixed(2) : '?'}s</span>
              <span style={{ color: 'var(--text-3)' }}>·</span>
              <span>{data.sizeBytes ? (data.sizeBytes / 1024 / 1024).toFixed(1) : '?'} MB</span>
              <a
                href={data.videoUrl}
                download
                style={{
                  marginLeft: 'auto',
                  color: 'var(--text)',
                  fontWeight: 600,
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--border-strong)',
                  paddingBottom: 1,
                }}
              >
                ↓ MP4
              </a>
            </div>
          </div>
        )}
      </div>
    </NodeShell>
  );
}
