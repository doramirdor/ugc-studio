import { useState } from 'react';
import { motion } from 'framer-motion';
import { Btn, FieldLabel, Input, NodeShell } from './_base';
import { useGraph, type SourceData, type ScriptData } from '../../store';
import { apiPullSessions } from '../../api/client';

export function SourceNode({ id, data }: { id: string; data: SourceData }) {
  const { setNodes, setEdges, patchNode } = useGraph();
  const [since, setSince] = useState(data.since);

  const pull = async () => {
    patchNode(id, { status: 'running', error: undefined });
    try {
      const r = await apiPullSessions(since);
      patchNode(id, {
        status: 'done',
        sessionsCount: r.sessions,
        journeys: r.journeys,
        since,
      });
      // Spawn the Script node as a leaf of the source, only on success.
      // Functional updaters so we read fresh state.
      setNodes((prev) => {
        if (prev.some((n) => n.id === 'script')) return prev;
        const sourceY = prev.find((n) => n.id === 'source')?.position?.y ?? 200;
        return [
          ...prev,
          {
            id: 'script',
            type: 'scriptNode',
            position: { x: 420, y: sourceY },
            data: { status: 'idle' as const, beats: [] } satisfies ScriptData,
          },
        ];
      });
      setEdges((prev) => {
        if (prev.some((e) => e.id === 'e-source-script')) return prev;
        return [
          ...prev,
          { id: 'e-source-script', source: 'source', target: 'script', animated: true },
        ];
      });
    } catch (e) {
      patchNode(id, { status: 'error', error: (e as Error).message });
    }
  };

  return (
    <NodeShell title="PostHog" subtitle="Pull recent sessions" status={data.status} showTargetHandle={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <FieldLabel>Time window</FieldLabel>
          <Input value={since} onChange={setSince} placeholder="7d / 24h / 90m" />
        </div>
        <Btn primary onClick={pull} disabled={data.status === 'running'}>
          {data.status === 'running' ? 'Pulling…' : 'Pull sessions'}
        </Btn>
        {data.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)', lineHeight: 1.4 }}>{data.error}</div>
        )}
        {data.sessionsCount != null && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              padding: 12,
              background: 'var(--surface-2)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--text)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              Last {data.since}
            </div>
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: -0.4, lineHeight: 1.1, marginTop: 4 }}>
              {data.sessionsCount}
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', fontWeight: 500, marginLeft: 6 }}>sessions</span>
            </div>
            {data.journeys && data.journeys.length > 0 && (
              <ul style={{ margin: '10px 0 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.journeys.slice(0, 4).map((j, i) => (
                  <li
                    key={j.slug}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      alignItems: 'baseline',
                      gap: 8,
                      fontSize: 'var(--fs-xs)',
                      color: 'var(--text-2)',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <code style={{ color: 'var(--text)', fontWeight: 500 }}>{j.slug}</code>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
                      {j.sessions} · {Math.round(j.medianDurationSec)}s
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </div>
    </NodeShell>
  );
}
