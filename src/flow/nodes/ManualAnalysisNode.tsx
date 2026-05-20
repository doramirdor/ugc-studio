import { useState } from 'react';
import { Btn, FieldLabel, Input, NodeShell } from './_base';
import {
  useGraph,
  type ManualAnalysisData,
  type SocialPlatform,
  type SocialPostsData,
  type UrlAnalysis,
} from '../../store';

const DEFAULT_PLATFORMS: SocialPlatform[] = ['linkedin', 'twitter', 'facebook'];

// "Post" path entry node. The user fills in a structured brand brief
// (brand / audience / tone / value props / CTA) and on submit we spawn a
// SocialPostsNode pre-seeded with that brief — exactly mirroring how
// UrlSourceNode hands off after a successful URL analysis. Idempotent
// via the derived `posts-<idSuffix>` child id, so re-submitting refreshes
// the existing posts node rather than stacking new ones.
export function ManualAnalysisNode({ id, data }: { id: string; data: ManualAnalysisData }) {
  const { setNodes, setEdges, patchNode, pruneNode } = useGraph();
  const [brand, setBrand] = useState(data.brand);
  const [audience, setAudience] = useState(data.audience);
  const [tone, setTone] = useState(data.tone);
  const [valueProps, setValueProps] = useState(data.valueProps);
  const [callToAction, setCallToAction] = useState(data.callToAction);

  const submit = () => {
    const trimmedBrand = brand.trim();
    if (!trimmedBrand) {
      patchNode(id, { error: 'enter a brand name first' });
      return;
    }
    const vpList = valueProps
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (vpList.length === 0) {
      patchNode(id, { error: 'enter at least one value proposition' });
      return;
    }
    const analysis: UrlAnalysis = {
      brand: trimmedBrand,
      audience: audience.trim(),
      tone: tone.trim(),
      summary: vpList[0] || '',
      valueProps: vpList,
      callToAction: callToAction.trim() || undefined,
    };
    patchNode(id, {
      status: 'done',
      brand: trimmedBrand,
      audience: audience.trim(),
      tone: tone.trim(),
      valueProps: vpList.join('\n'),
      callToAction: callToAction.trim(),
      error: undefined,
    });
    const postsId = id.replace(/^manual-/, 'posts-');
    setNodes((prev) => {
      const parent = prev.find((n) => n.id === id);
      const parentX = parent?.position?.x ?? 60;
      const parentY = parent?.position?.y ?? 200;
      const existing = prev.find((n) => n.id === postsId);
      if (existing) {
        return prev.map((n) =>
          n.id === postsId
            ? {
                ...n,
                data: {
                  ...(n.data as unknown as SocialPostsData),
                  status: 'idle' as const,
                  url: '',
                  analysis,
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
          position: { x: parentX + 420, y: parentY },
          data: {
            status: 'idle' as const,
            url: '',
            analysis,
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
  };

  return (
    <NodeShell
      title="Brand brief"
      subtitle="Skip URL analysis — describe the brand directly"
      status={data.status}
      emoji="📝"
      showTargetHandle={false}
      onDelete={() => pruneNode(id)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <FieldLabel>Brand / product name</FieldLabel>
          <Input value={brand} onChange={setBrand} placeholder="Nadir" />
        </div>
        <div>
          <FieldLabel>Audience</FieldLabel>
          <Input
            value={audience}
            onChange={setAudience}
            placeholder="engineering leads at AI-native startups"
          />
        </div>
        <div>
          <FieldLabel>Tone</FieldLabel>
          <Input
            value={tone}
            onChange={setTone}
            placeholder="blunt, numerate, no hype"
          />
        </div>
        <div>
          <FieldLabel>Value propositions (one per line)</FieldLabel>
          <Input
            value={valueProps}
            onChange={setValueProps}
            placeholder={'Cuts LLM bill ~40%\nNo code changes\nWorks with OpenAI, Anthropic, Gemini'}
            multiline
            rows={4}
          />
        </div>
        <div>
          <FieldLabel>Call to action (optional)</FieldLabel>
          <Input
            value={callToAction}
            onChange={setCallToAction}
            placeholder="Try Nadir free for one month"
          />
        </div>
        <Btn primary onClick={submit}>
          {data.status === 'done' ? 'Update brief' : 'Continue to posts'}
        </Btn>
        {data.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)', lineHeight: 1.4 }}>
            {data.error}
          </div>
        )}
      </div>
    </NodeShell>
  );
}
