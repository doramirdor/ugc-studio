import { Panel } from '@xyflow/react';

// Shown when the canvas is empty — three picker tiles for the user's
// first node. "Analysis" and "Post" are the two social-flow entry
// points (URL → analyze → posts vs manual brand brief → posts); the
// third tile keeps the PostHog video pipeline a click away.
export type WelcomePick = 'analysis' | 'post' | 'video';

export function WelcomeCard({ onPick }: { onPick: (kind: WelcomePick) => void }) {
  return (
    <Panel position="top-center">
      <div
        style={{
          marginTop: 96,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-md)',
          padding: 28,
          width: 560,
          maxWidth: '90vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-3)',
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Start
          </div>
          <div
            style={{
              fontSize: 'var(--fs-xl)',
              fontWeight: 700,
              letterSpacing: -0.4,
              color: 'var(--text)',
              lineHeight: 1.15,
              fontFamily: 'var(--font-display)',
            }}
          >
            Pick your first node
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 'var(--fs-sm)',
              color: 'var(--text-2)',
              lineHeight: 1.4,
            }}
          >
            Analyze a URL with Claude, or write a brand brief directly. You
            can also start the video pipeline.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Tile
            badge="01"
            title="Analysis"
            subtitle="URL → Claude analyzes → drafts posts per platform"
            accent="var(--accent)"
            onClick={() => onPick('analysis')}
          />
          <Tile
            badge="02"
            title="Post"
            subtitle="Fill in brand fields → drafts posts directly (no URL)"
            accent="#1D9BF0"
            onClick={() => onPick('post')}
          />
        </div>

        <button
          className="nodrag"
          onClick={() => onPick('video')}
          style={{
            background: 'transparent',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--r-md)',
            padding: '10px 14px',
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-2)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: 0.1,
            transition: 'border-color 0.12s ease, color 0.12s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--text-3)';
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-strong)';
            e.currentTarget.style.color = 'var(--text-2)';
          }}
        >
          or start the video pipeline (PostHog sessions → scenes → MP4) →
        </button>
      </div>
    </Panel>
  );
}

function Tile({
  badge,
  title,
  subtitle,
  accent,
  onClick,
}: {
  badge: string;
  title: string;
  subtitle: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      className="nodrag"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--r-md)',
        padding: '14px 16px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.12s ease, border-color 0.12s ease, transform 0.08s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.borderColor = 'var(--border-strong)';
        e.currentTarget.style.borderLeftColor = accent;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--surface)';
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.borderLeftColor = accent;
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: 0.4,
        }}
      >
        {badge}
      </span>
      <span
        style={{
          fontSize: 'var(--fs-base)',
          fontWeight: 700,
          color: 'var(--text)',
          letterSpacing: -0.2,
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-2)',
          lineHeight: 1.4,
        }}
      >
        {subtitle}
      </span>
    </button>
  );
}
