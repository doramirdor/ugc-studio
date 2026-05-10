import { Handle, Position } from '@xyflow/react';
import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import type { NodeStatus } from '../../store';

// All UI atoms here read from the CSS-variable token layer in
// styles.css. Status uses a small dot + label instead of a heavy pill
// so the node card itself stays the dominant visual element.

const STATUS_TOKEN: Record<NodeStatus, { color: string; soft: string }> = {
  idle: { color: 'var(--status-idle)', soft: 'transparent' },
  running: { color: 'var(--status-running)', soft: 'var(--status-running-soft)' },
  done: { color: 'var(--status-done)', soft: 'var(--status-done-soft)' },
  error: { color: 'var(--status-error)', soft: 'var(--status-error-soft)' },
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  done: 'Done',
  error: 'Error',
};

export function NodeShell({
  title,
  subtitle,
  status,
  width = 280,
  children,
  showSourceHandle = true,
  showTargetHandle = true,
  emoji,
  index,
  collapsed,
  onToggleCollapse,
  onDelete,
}: {
  title: string;
  subtitle?: string;
  status: NodeStatus;
  width?: number;
  children: ReactNode;
  showSourceHandle?: boolean;
  showTargetHandle?: boolean;
  emoji?: string;
  /** Optional 1-based index, rendered as a monospace label like "01 ·". */
  index?: number;
  /** When defined, renders a chevron toggle in the header. Undefined =
      no chevron, no collapse behaviour (legacy nodes). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** When defined, renders an × button that prunes this node and any
      descendants that lose all parents as a result. Source omits this. */
  onDelete?: () => void;
}) {
  const tokens = STATUS_TOKEN[status];
  const isRunning = status === 'running';
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{
        width,
        background: 'var(--surface)',
        borderRadius: 'var(--r-lg)',
        // Single-weight border in the resting state — the status colour
        // shows up as a subtle inset accent on the left rail instead of
        // wrapping the whole card.
        border: '1px solid var(--border)',
        boxShadow: isRunning
          ? `0 0 0 4px ${tokens.soft}, var(--shadow-md)`
          : 'var(--shadow-md)',
        overflow: 'hidden',
      }}
    >
      {showTargetHandle && <Handle type="target" position={Position.Left} />}

      {/* Status rail — 3px coloured stripe at the top. Only visible when
          running/done/error so idle nodes read as fully neutral. */}
      {status !== 'idle' && (
        <div
          style={{
            height: 3,
            background: tokens.color,
            opacity: isRunning ? 1 : 0.85,
          }}
        />
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '14px 16px 12px',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          {index != null && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-xs)',
                fontWeight: 500,
                color: 'var(--text-3)',
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
              }}
            >
              {String(index).padStart(2, '0')}
            </span>
          )}
          {emoji && index == null && <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 'var(--fs-base)',
                fontWeight: 600,
                color: 'var(--text)',
                letterSpacing: -0.2,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </div>
            {subtitle && (
              <div
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-2)',
                  marginTop: 2,
                  lineHeight: 1.3,
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StatusIndicator status={status} />
          {onDelete && (
            <button
              className="nodrag"
              onClick={onDelete}
              aria-label="Delete node"
              title="Prune (cascade-deletes orphan descendants)"
              style={{
                background: 'transparent',
                border: 'none',
                padding: 2,
                cursor: 'pointer',
                color: 'var(--text-3)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: 'var(--r-xs)',
                transition: 'background 0.12s ease, color 0.12s ease',
                fontFamily: 'inherit',
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--status-error-soft)';
                e.currentTarget.style.color = 'var(--status-error)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-3)';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {onToggleCollapse && (
            <button
              className="nodrag"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand' : 'Collapse'}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 2,
                cursor: 'pointer',
                color: 'var(--text-3)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: 'var(--r-xs)',
                transition: 'background 0.12s ease, color 0.12s ease',
                fontFamily: 'inherit',
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--surface-2)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-3)';
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                style={{
                  transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.18s ease',
                }}
              >
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {!collapsed && <div style={{ padding: '4px 16px 16px' }}>{children}</div>}

      {showSourceHandle && <Handle type="source" position={Position.Right} />}
    </motion.div>
  );
}

function StatusIndicator({ status }: { status: NodeStatus }) {
  const tokens = STATUS_TOKEN[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <motion.span
        animate={status === 'running' ? { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] } : { scale: 1, opacity: 1 }}
        transition={status === 'running' ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : {}}
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: tokens.color,
          display: 'inline-block',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 500,
          color: 'var(--text-2)',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}
      >
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}

export function Btn({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      // `nodrag` tells xyflow not to treat mousedown on this element as
      // the start of a node drag. Without it, the first click on a fresh
      // node sometimes lands on xyflow's selection handler instead of the
      // button, so users have to click twice.
      className="nodrag"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: primary ? 'var(--accent)' : 'var(--surface)',
        color: primary ? 'var(--surface)' : 'var(--text)',
        border: `1px solid ${primary ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--r-md)',
        padding: '8px 14px',
        fontSize: 'var(--fs-sm)',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'inherit',
        letterSpacing: -0.1,
        transition: 'background 0.12s ease, border-color 0.12s ease, transform 0.06s ease',
      }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = 'translateY(0.5px)')}
      onMouseUp={(e) => (e.currentTarget.style.transform = '')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
    >
      {children}
    </button>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  multiline,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const style: CSSProperties = {
    width: '100%',
    padding: '8px 11px',
    fontSize: 'var(--fs-sm)',
    fontFamily: 'inherit',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)',
    background: 'var(--surface)',
    boxSizing: 'border-box',
    resize: multiline ? 'vertical' : 'none',
    transition: 'border-color 0.12s ease',
  };
  return multiline ? (
    <textarea
      className="nodrag"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={style}
    />
  ) : (
    <input
      className="nodrag"
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={style}
    />
  );
}

/** Section label inside a node body — small, uppercase, monospace. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 500,
        color: 'var(--text-3)',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
