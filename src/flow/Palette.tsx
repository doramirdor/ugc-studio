import { useState } from 'react';
import { Panel } from '@xyflow/react';

// Drag-and-drop palette. Each item sets a `application/x-ugc-node` mime
// in the dataTransfer; GraphCanvas's onDrop reads it back to spawn the
// right node type at the cursor position.
export type PaletteKind = 'asset-image' | 'asset-audio' | 'asset-video' | 'merge';

const ITEMS: Array<{ kind: PaletteKind; label: string; hint: string }> = [
  { kind: 'asset-image', label: 'Image', hint: 'png · jpg · webp' },
  { kind: 'asset-audio', label: 'Audio', hint: 'mp3 · m4a · wav' },
  { kind: 'asset-video', label: 'Video', hint: 'mp4 · mov · webm' },
  { kind: 'merge', label: 'Merge', hint: 'stitch wired inputs' },
];

export function Palette() {
  return (
    <Panel position="top-right">
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 8,
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          width: 180,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-3)',
            padding: '6px 8px 4px',
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          Add to canvas
        </div>
        {ITEMS.map((it, i) => (
          <PaletteItem key={it.kind} item={it} number={i + 1} />
        ))}
      </div>
    </Panel>
  );
}

function PaletteItem({
  item,
  number,
}: {
  item: { kind: PaletteKind; label: string; hint: string };
  number: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-ugc-node', item.kind);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        alignItems: 'baseline',
        gap: 10,
        padding: '7px 10px',
        border: `1px solid ${hover ? 'var(--border-strong)' : 'transparent'}`,
        borderRadius: 'var(--r-sm)',
        background: hover ? 'var(--surface-2)' : 'transparent',
        cursor: 'grab',
        userSelect: 'none',
        transition: 'background 0.12s ease, border-color 0.12s ease',
      }}
      title={`Drag onto canvas — ${item.hint}`}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: 0.2,
        }}
      >
        {String(number).padStart(2, '0')}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--fs-sm)',
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: -0.1,
            lineHeight: 1.2,
          }}
        >
          {item.label}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-3)',
            letterSpacing: 0.2,
            marginTop: 1,
          }}
        >
          {item.hint}
        </div>
      </div>
    </div>
  );
}
