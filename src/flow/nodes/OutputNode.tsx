import { NodeShell } from './_base';
import { useGraph, type OutputData, type SceneData } from '../../store';

// Compact leaf showing the rendered video for one scene. The actual video
// data lives on the upstream SceneData (single source of truth) — this
// node only carries a back-reference. Re-rendering the scene therefore
// updates the output in place without any extra wiring.
function beatNumber(beatId: string | undefined): number | undefined {
  if (!beatId) return undefined;
  const m = beatId.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) + 1 : undefined;
}

export function OutputNode({ id, data }: { id: string; data: OutputData }) {
  const scene = useGraph((s) => s.nodes.find((n) => n.id === data.sceneId));
  const pruneNode = useGraph((s) => s.pruneNode);
  const sd = (scene?.data ?? null) as SceneData | null;

  if (!sd || !sd.videoUrl) {
    return (
      <NodeShell title="Output" subtitle="awaiting render" status="idle" width={240} onDelete={() => pruneNode(id)}>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>No video yet</div>
      </NodeShell>
    );
  }

  return (
    <NodeShell
      title={sd.title || 'Output'}
      subtitle="Rendered scene"
      status="done"
      width={260}
      index={beatNumber(sd.beatId)}
      onDelete={() => pruneNode(id)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <video
          src={sd.videoUrl}
          poster={sd.thumbnailUrl}
          controls
          preload="metadata"
          style={{
            width: '100%',
            borderRadius: 'var(--r-md)',
            background: '#000',
            maxHeight: 320,
            display: 'block',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-2)',
            letterSpacing: 0.2,
          }}
        >
          {sd.durationMs != null && <span>{(sd.durationMs / 1000).toFixed(2)}s</span>}
          {sd.cached && (
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
          <a
            href={sd.videoUrl}
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
    </NodeShell>
  );
}
