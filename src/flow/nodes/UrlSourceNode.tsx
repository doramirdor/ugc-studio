import { useState } from 'react';
import { motion } from 'framer-motion';
import { Btn, FieldLabel, Input, NodeShell } from './_base';
import {
  useGraph,
  type SocialPlatform,
  type SocialPostsData,
  type UrlSourceData,
} from '../../store';
import { apiAnalyzeUrl } from '../../api/client';

const DEFAULT_PLATFORMS: SocialPlatform[] = ['linkedin', 'twitter', 'facebook'];

// Entry node for the social-post flow. The user types a URL, we call
// /api/analyze-url, and on success spawn a SocialPostsNode to the right
// pre-seeded with the analysis. Re-running replaces the descendant posts
// node so a fresh URL doesn't pile drafts on top of old ones.
export function UrlSourceNode({ id, data }: { id: string; data: UrlSourceData }) {
  const { setNodes, setEdges, patchNode, pruneNode } = useGraph();
  const [url, setUrl] = useState(data.url);

  const analyze = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      patchNode(id, { error: 'enter a URL first' });
      return;
    }
    patchNode(id, { status: 'running', error: undefined, url: trimmed });
    try {
      const r = await apiAnalyzeUrl(trimmed);
      patchNode(id, {
        status: 'done',
        url: trimmed,
        finalUrl: r.url,
        analysis: r.analysis,
        mode: r.mode,
      });
      // Spawn a SocialPostsNode to the right of this one. Tombstone-respecting
      // and idempotent: derive id from the URL source id so re-running
      // updates the existing node instead of stacking new ones.
      const postsId = id.replace(/^url-/, 'posts-');
      setNodes((prev) => {
        const parent = prev.find((n) => n.id === id);
        const parentX = parent?.position?.x ?? 60;
        const parentY = parent?.position?.y ?? 200;
        const existing = prev.find((n) => n.id === postsId);
        if (existing) {
          // Refresh analysis on the existing node; clear stale posts so the
          // user knows to re-generate against the new URL.
          return prev.map((n) =>
            n.id === postsId
              ? {
                  ...n,
                  data: {
                    ...(n.data as unknown as SocialPostsData),
                    status: 'idle' as const,
                    url: r.url,
                    analysis: r.analysis,
                    posts: [],
                    error: undefined,
                  } satisfies SocialPostsData,
                }
              : n,
          );
        }
        return [
          ...prev,
          {
            id: postsId,
            type: 'socialPostsNode',
            position: { x: parentX + 400, y: parentY },
            data: {
              status: 'idle' as const,
              url: r.url,
              analysis: r.analysis,
              platforms: DEFAULT_PLATFORMS,
              posts: [],
            } satisfies SocialPostsData,
          },
        ];
      });
      setEdges((prev) => {
        const edgeId = `e-${id}-${postsId}`;
        if (prev.some((e) => e.id === edgeId)) return prev;
        return [...prev, { id: edgeId, source: id, target: postsId, animated: true }];
      });
    } catch (e) {
      patchNode(id, { status: 'error', error: (e as Error).message });
    }
  };

  return (
    <NodeShell
      title="URL Source"
      subtitle="Analyze a website with Claude"
      status={data.status}
      emoji="🔗"
      showTargetHandle={false}
      onDelete={() => pruneNode(id)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <FieldLabel>Website URL</FieldLabel>
          <Input value={url} onChange={setUrl} placeholder="https://yourproduct.com" />
        </div>
        <Btn primary onClick={analyze} disabled={data.status === 'running'}>
          {data.status === 'running' ? 'Analyzing…' : 'Analyze URL'}
        </Btn>
        {data.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)', lineHeight: 1.4 }}>
            {data.error}
          </div>
        )}
        {data.analysis && (
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
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              Analysis · {data.mode || 'llm'}
            </div>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)', letterSpacing: -0.2 }}>
              {data.analysis.brand}
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', lineHeight: 1.45 }}>
              {data.analysis.summary}
            </div>
            {data.analysis.valueProps?.length > 0 && (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 16,
                  listStyle: 'disc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-2)',
                }}
              >
                {data.analysis.valueProps.slice(0, 3).map((vp, i) => (
                  <li key={i} style={{ lineHeight: 1.4 }}>{vp}</li>
                ))}
              </ul>
            )}
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              audience: {data.analysis.audience}
            </div>
          </motion.div>
        )}
      </div>
    </NodeShell>
  );
}
