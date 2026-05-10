import { useState } from 'react';
import { Btn, NodeShell } from './_base';
import {
  useGraph,
  type AssetData,
  type MergeData,
  type OverlayPosition,
  type SceneData,
} from '../../store';
import { apiMerge } from '../../api/client';

// Pull a video URL out of any node type that produces video. Returns
// null for non-video nodes so they can be filtered rather than failing
// the merge.
function getVideoUrl(node: { id: string; data: unknown } | undefined): string | null {
  if (!node) return null;
  const d = node.data as Record<string, unknown>;
  if (node.id.startsWith('scene-')) return (d as unknown as SceneData).videoUrl ?? null;
  if (node.id.startsWith('output-')) return null; // resolved via classify() back-ref
  if (node.id.startsWith('asset-')) {
    const ad = d as unknown as AssetData;
    return ad.kind === 'video' ? ad.url ?? null : null;
  }
  if (node.id.startsWith('merge-')) return (d as unknown as MergeData).videoUrl ?? null;
  if (node.id.startsWith('concat')) return ((d as { videoUrl?: string }).videoUrl) ?? null;
  return null;
}

const POSITION_LABEL: Record<OverlayPosition, string> = {
  tl: 'Top-left',
  tr: 'Top-right',
  bl: 'Bottom-left',
  br: 'Bottom-right',
  center: 'Center',
};

export function MergeNode({ id, data }: { id: string; data: MergeData }) {
  const { nodes, edges, patchNode, pruneNode } = useGraph();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Walk the incoming edges → source nodes.
  const incomingSources = edges
    .filter((e) => e.target === id)
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is NonNullable<typeof n> => !!n);

  type InputClass = 'video' | 'image' | 'audio' | 'unknown';
  const classify = (n: { id: string; data: unknown }): { url: string | null; cls: InputClass; label: string } => {
    if (n.id.startsWith('output-')) {
      const od = n.data as { sceneId?: string };
      const scene = od.sceneId ? nodes.find((m) => m.id === od.sceneId) : undefined;
      const sd = scene?.data as unknown as SceneData | undefined;
      return { url: sd?.videoUrl ?? null, cls: 'video', label: sd?.title ?? n.id };
    }
    if (n.id.startsWith('asset-')) {
      const ad = n.data as unknown as AssetData;
      const cls: InputClass = ad.kind === 'video' ? 'video' : ad.kind === 'image' ? 'image' : 'audio';
      return { url: ad.url ?? null, cls, label: ad.name ?? `${ad.kind} asset` };
    }
    return {
      url: getVideoUrl(n),
      cls: 'video',
      label:
        (n.data as { name?: string; title?: string }).title
        ?? (n.data as { name?: string }).name
        ?? n.id,
    };
  };

  const rawInputs = incomingSources.map((n) => ({ id: n.id, ...classify(n) }));

  // Reconcile saved inputOrder against the live edge set: keep the saved
  // order for ids that still exist, then append any new ids in their
  // natural (edge-insertion) order. This survives edge add/remove without
  // losing the user's manual ordering.
  const currentIds = rawInputs.map((i) => i.id);
  const savedOrder = (data.inputOrder ?? []).filter((idd) => currentIds.includes(idd));
  const newIds = currentIds.filter((idd) => !savedOrder.includes(idd));
  const effectiveOrder = [...savedOrder, ...newIds];
  const inputs = effectiveOrder
    .map((idd) => rawInputs.find((i) => i.id === idd))
    .filter((i): i is NonNullable<typeof i> => !!i);

  const videos = inputs.filter((i) => i.cls === 'video' && i.url);
  const images = inputs.filter((i) => i.cls === 'image' && i.url);
  const audios = inputs.filter((i) => i.cls === 'audio' && i.url);

  const audioMode = data.audioMode ?? 'replace';
  const imagePosition: OverlayPosition = data.imagePosition ?? 'br';
  const imageScale = data.imageScale ?? 0.22;

  const canRender =
    videos.length >= 1 &&
    (videos.length >= 2 || images.length > 0 || audios.length > 0) &&
    data.status !== 'running';

  const modeLabel = [
    videos.length > 1 ? 'concat' : videos.length === 1 ? 'single' : null,
    images.length > 0 ? `image@${imagePosition}/${(imageScale * 100).toFixed(0)}%` : null,
    audios.length > 0 ? `audio ${audioMode}` : null,
  ]
    .filter(Boolean)
    .join(' + ') || 'no inputs yet';

  const warnings: string[] = [];
  if (images.length > 1) warnings.push(`${images.length} images wired — only the first will overlay`);
  if (audios.length > 1) warnings.push(`${audios.length} audios wired — only the first will be applied`);

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const next = [...effectiveOrder];
    const fromIdx = next.indexOf(fromId);
    const toIdx = next.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    patchNode(id, { inputOrder: next });
  };

  const render = async () => {
    if (!canRender) return;
    patchNode(id, { status: 'running', error: undefined });
    try {
      const r = await apiMerge({
        videos: videos.map((i) => i.url as string),
        image: images[0]?.url ?? undefined,
        audio: audios[0]?.url ?? undefined,
        audioMode,
        imagePosition,
        imageScale,
      });
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
    <NodeShell title="Merge" subtitle="Stitch wired inputs" status={data.status} width={320} onDelete={() => pruneNode(id)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
          {inputs.length === 0 ? (
            <em style={{ color: 'var(--text-3)' }}>Wire inputs into the left handle</em>
          ) : (
            <>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 6 }}>Mode</span>
              <code style={{ background: 'var(--surface-3)', color: 'var(--text)', padding: '2px 6px', borderRadius: 'var(--r-xs)' }}>{modeLabel}</code>
            </>
          )}
        </div>

        {inputs.length > 0 && (
          // `nodrag` on the list keeps xyflow from dragging the whole node
          // when the user is actually trying to reorder a list item.
          <ul className="nodrag" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {inputs.map((i, idx) => {
              const dimmed = !i.url;
              const isDragging = dragId === i.id;
              const isHovering = dragOverId === i.id && dragId && dragId !== i.id;
              return (
                <li
                  key={i.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(i.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', i.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverId !== i.id) setDragOverId(i.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverId === i.id) setDragOverId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId) reorder(dragId, i.id);
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 9px',
                    border: `1px solid ${isHovering ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--r-sm)',
                    background: isDragging ? 'var(--surface-2)' : 'var(--surface)',
                    fontSize: 'var(--fs-xs)',
                    color: dimmed ? 'var(--text-3)' : 'var(--text)',
                    cursor: 'grab',
                    opacity: isDragging ? 0.5 : 1,
                    transition: 'border-color 0.12s ease, background 0.12s ease',
                  }}
                  title="Drag to reorder"
                >
                  <span style={{ color: 'var(--text-3)', fontSize: 12, lineHeight: 1, userSelect: 'none' }}>⋮⋮</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-3)',
                      minWidth: 18,
                      letterSpacing: 0.2,
                    }}
                  >
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {i.label}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-3)',
                      letterSpacing: 0.2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {i.cls}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* Audio mode toggle — only meaningful when an audio asset is wired. */}
        {audios.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-3)',
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                minWidth: 50,
              }}
            >
              Audio
            </span>
            <div
              className="nodrag"
              style={{ display: 'flex', gap: 0, border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}
            >
              {(['replace', 'mix'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => patchNode(id, { audioMode: m })}
                  style={{
                    background: audioMode === m ? 'var(--accent)' : 'var(--surface)',
                    color: audioMode === m ? 'var(--surface)' : 'var(--text-2)',
                    border: 'none',
                    padding: '5px 11px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 0.12s ease',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Image overlay placement + scale — only when an image is wired. */}
        {images.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-3)',
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  minWidth: 50,
                }}
              >
                Position
              </span>
              <select
                className="nodrag"
                value={imagePosition}
                onChange={(e) => patchNode(id, { imagePosition: e.target.value as OverlayPosition })}
                style={{
                  flex: 1,
                  padding: '5px 9px',
                  fontSize: 11,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontFamily: 'inherit',
                }}
              >
                {(['tl', 'tr', 'bl', 'br', 'center'] as const).map((p) => (
                  <option key={p} value={p}>{POSITION_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-3)',
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  minWidth: 50,
                }}
              >
                Size
              </span>
              <input
                className="nodrag"
                type="range"
                min={10}
                max={60}
                value={Math.round(imageScale * 100)}
                onChange={(e) => patchNode(id, { imageScale: Number(e.target.value) / 100 })}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-2)',
                  minWidth: 36,
                  textAlign: 'right',
                }}
              >
                {Math.round(imageScale * 100)}%
              </span>
            </div>
          </>
        )}

        {warnings.map((w, i) => (
          <div key={i} style={{ fontSize: 10, color: 'var(--status-error)' }}>⚠ {w}</div>
        ))}
        <Btn primary onClick={render} disabled={!canRender}>
          {data.status === 'running' ? 'Merging…' : 'Render merge'}
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
              style={{ width: '100%', borderRadius: 'var(--r-md)', background: '#000', maxHeight: 320, display: 'block' }}
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
