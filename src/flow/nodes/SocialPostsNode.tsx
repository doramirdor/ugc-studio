import { useState } from 'react';
import { motion } from 'framer-motion';
import { Btn, FieldLabel, Input, NodeShell } from './_base';
import {
  useGraph,
  type SocialPlatform,
  type SocialPost,
  type SocialPostsData,
} from '../../store';
import { apiGeneratePosts, apiRefinePost } from '../../api/client';

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  linkedin: 'LinkedIn',
  twitter: 'Twitter / X',
  facebook: 'Facebook',
};
const PLATFORM_ACCENT: Record<SocialPlatform, string> = {
  linkedin: '#0A66C2',
  twitter: '#1D9BF0',
  facebook: '#1877F2',
};
const PLATFORM_MAX_CHARS: Record<SocialPlatform, number> = {
  linkedin: 1300,
  twitter: 280,
  facebook: 500,
};
const ALL_PLATFORMS: SocialPlatform[] = ['linkedin', 'twitter', 'facebook'];

export function SocialPostsNode({ id, data }: { id: string; data: SocialPostsData }) {
  const { patchNode, pruneNode } = useGraph();
  const [extraInstructions, setExtraInstructions] = useState(data.extraInstructions || '');

  const togglePlatform = (p: SocialPlatform) => {
    const next = data.platforms.includes(p)
      ? data.platforms.filter((x) => x !== p)
      : [...data.platforms, p];
    if (next.length === 0) return; // need at least one
    patchNode(id, { platforms: next });
  };

  const generate = async () => {
    if (data.platforms.length === 0) {
      patchNode(id, { error: 'pick at least one platform' });
      return;
    }
    patchNode(id, { status: 'running', error: undefined, extraInstructions });
    try {
      const r = await apiGeneratePosts({
        url: data.url,
        analysis: data.analysis,
        platforms: data.platforms,
        extraInstructions: extraInstructions || undefined,
      });
      patchNode(id, {
        status: 'done',
        posts: r.posts.map((p) => ({ ...p, publish: true })),
        mode: r.mode,
      });
    } catch (e) {
      patchNode(id, { status: 'error', error: (e as Error).message });
    }
  };

  const updatePost = (postId: string, patch: Partial<SocialPost>) => {
    patchNode(id, {
      posts: data.posts.map((p) => (p.id === postId ? { ...p, ...patch } : p)),
    });
  };

  const refinePost = async (post: SocialPost, instructions: string) => {
    if (!instructions.trim()) return;
    updatePost(post.id, { refining: true, refineError: undefined });
    try {
      const r = await apiRefinePost({
        analysis: data.analysis,
        post,
        instructions,
      });
      // Server returns a fresh post id; carry the user's publish toggle forward.
      updatePost(post.id, {
        ...r.post,
        id: post.id, // keep stable id for the UI
        publish: post.publish,
        refining: false,
        refineError: undefined,
      });
    } catch (e) {
      updatePost(post.id, { refining: false, refineError: (e as Error).message });
    }
  };

  const publishCount = data.posts.filter((p) => p.publish).length;

  return (
    <NodeShell
      title="Social Posts"
      subtitle={
        data.posts.length > 0
          ? `${publishCount} of ${data.posts.length} marked to publish`
          : `for ${data.analysis.brand}`
      }
      status={data.status}
      width={520}
      emoji="📣"
      onDelete={() => pruneNode(id)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <FieldLabel>Platforms</FieldLabel>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ALL_PLATFORMS.map((p) => {
              const active = data.platforms.includes(p);
              return (
                <button
                  key={p}
                  className="nodrag"
                  onClick={() => togglePlatform(p)}
                  style={{
                    background: active ? PLATFORM_ACCENT[p] : 'var(--surface)',
                    color: active ? 'white' : 'var(--text-2)',
                    border: `1px solid ${active ? PLATFORM_ACCENT[p] : 'var(--border)'}`,
                    borderRadius: 'var(--r-sm)',
                    padding: '5px 10px',
                    fontSize: 'var(--fs-xs)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    letterSpacing: 0.1,
                  }}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel>Tone / extra instructions (optional)</FieldLabel>
          <Input
            value={extraInstructions}
            onChange={setExtraInstructions}
            placeholder="e.g. emphasize the savings calculator, friendly but data-driven"
            multiline
            rows={2}
          />
        </div>

        <Btn primary onClick={generate} disabled={data.status === 'running'}>
          {data.status === 'running'
            ? 'Generating…'
            : data.posts.length > 0
              ? 'Regenerate posts'
              : 'Generate posts'}
        </Btn>

        {data.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)', lineHeight: 1.4 }}>
            {data.error}
          </div>
        )}

        {data.posts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onPatch={(patch) => updatePost(post.id, patch)}
                onRefine={(instructions) => refinePost(post, instructions)}
              />
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  );
}

function PostCard({
  post,
  onPatch,
  onRefine,
}: {
  post: SocialPost;
  onPatch: (patch: Partial<SocialPost>) => void;
  onRefine: (instructions: string) => void;
}) {
  const [refineText, setRefineText] = useState('');
  const accent = PLATFORM_ACCENT[post.platform];
  const maxChars = PLATFORM_MAX_CHARS[post.platform];
  const charCount = post.text.length;
  const over = charCount > maxChars;

  const copyText = () => {
    const composed = post.hashtags?.length
      ? `${post.text}\n\n${post.hashtags.map((h) => '#' + h).join(' ')}`
      : post.text;
    navigator.clipboard?.writeText(composed).catch(() => {
      // Silent failure is fine — clipboard rights aren't always granted in
      // iframe contexts. The textarea is still selectable manually.
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        border: `1px solid ${post.publish ? 'var(--border-strong)' : 'var(--border)'}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--r-md)',
        background: post.publish ? 'var(--surface)' : 'var(--surface-2)',
        opacity: post.publish ? 1 : 0.78,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 'var(--fs-sm)',
              fontWeight: 700,
              color: 'var(--text)',
              letterSpacing: -0.1,
            }}
          >
            {PLATFORM_LABEL[post.platform]}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: over ? 'var(--status-error)' : 'var(--text-3)',
            }}
          >
            {charCount}/{maxChars}
          </span>
        </div>
        <label
          className="nodrag"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            fontSize: 'var(--fs-xs)',
            fontFamily: 'var(--font-mono)',
            color: post.publish ? 'var(--status-done)' : 'var(--text-3)',
            letterSpacing: 0.3,
            textTransform: 'uppercase',
          }}
        >
          <input
            type="checkbox"
            className="nodrag"
            checked={!!post.publish}
            onChange={(e) => onPatch({ publish: e.target.checked })}
            style={{ accentColor: accent, cursor: 'pointer' }}
          />
          {post.publish ? 'Publish' : 'Skip'}
        </label>
      </div>

      {post.imageUrl && (
        <div
          style={{
            background: '#0b0d10',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxHeight: 200,
            overflow: 'hidden',
          }}
        >
          <img
            src={post.imageUrl}
            alt={post.headline}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </div>
      )}

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <FieldLabel>Headline (image card)</FieldLabel>
          <Input
            value={post.headline}
            onChange={(v) => onPatch({ headline: v })}
            placeholder="Headline shown on the image card"
          />
        </div>
        <div>
          <FieldLabel>Post body</FieldLabel>
          <Input
            value={post.text}
            onChange={(v) => onPatch({ text: v })}
            placeholder="What gets pasted into the platform composer"
            multiline
            rows={post.platform === 'twitter' ? 3 : 5}
          />
        </div>
        {post.hashtags?.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-3)',
            }}
          >
            {post.hashtags.map((h) => (
              <span
                key={h}
                style={{
                  padding: '2px 6px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-xs)',
                }}
              >
                #{h}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className="nodrag"
            onClick={copyText}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-sm)',
              padding: '5px 10px',
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Copy text
          </button>
          {post.imageUrl && (
            <a
              href={post.imageUrl}
              download={`${post.platform}-${post.id}.svg`}
              className="nodrag"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--r-sm)',
                padding: '5px 10px',
                fontSize: 'var(--fs-xs)',
                fontWeight: 600,
                color: 'var(--text-2)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textDecoration: 'none',
              }}
            >
              Download card
            </a>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FieldLabel>Ask Claude to refine</FieldLabel>
          <textarea
            className="nodrag"
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder="e.g. make it more punchy, drop the hashtag, add a question hook"
            rows={2}
            style={{
              width: '100%',
              padding: '8px 11px',
              fontSize: 'var(--fs-sm)',
              fontFamily: 'inherit',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--surface)',
              boxSizing: 'border-box',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            {post.refineError ? (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)' }}>
                {post.refineError}
              </span>
            ) : (
              <span />
            )}
            <button
              className="nodrag"
              disabled={post.refining || !refineText.trim()}
              onClick={() => {
                onRefine(refineText);
                setRefineText('');
              }}
              style={{
                background: accent,
                color: 'white',
                border: `1px solid ${accent}`,
                borderRadius: 'var(--r-sm)',
                padding: '6px 12px',
                fontSize: 'var(--fs-xs)',
                fontWeight: 600,
                cursor: post.refining || !refineText.trim() ? 'not-allowed' : 'pointer',
                opacity: post.refining || !refineText.trim() ? 0.5 : 1,
                fontFamily: 'inherit',
                letterSpacing: 0.1,
              }}
            >
              {post.refining ? 'Refining…' : 'Refine'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
