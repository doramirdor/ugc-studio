import { useEffect } from 'react';
import { useGraph, type SceneData } from '../store';

// Two-stage spawner:
//   1. For every scene in status='done' that doesn't yet have an output
//      leaf, spawn `output-<sceneId>` and the scene→output edge.
//   2. Once every scene has its output leaf, spawn the Concat node and
//      output→concat edges (one per scene).
//
// Both stages are idempotent — they bail out cleanly if their target
// already exists. This handles three flows:
//   - Fresh render: each successful render flips a scene to 'done', the
//     effect spawns its output leaf, and the last completion also spawns
//     concat.
//   - Re-render: scene briefly returns to 'running'; the output stays
//     in place (it reads from SceneData by reference, so videoUrl
//     updates automatically).
//   - Rehydrate from localStorage: a graph reloaded with done scenes
//     and no outputs gets its outputs created on mount.
//
// Layout (X positions):
//   Source 60 → Script 420 → Scene 820 → Output 1240 → Concat 1660
export function ConcatSpawner() {
  const { nodes, setNodes, setEdges, tombstones } = useGraph();
  const tombstoneSet = new Set(tombstones);

  // ---- stage 1: outputs ----
  useEffect(() => {
    const sceneNodes = nodes.filter((n) => n.id.startsWith('scene-'));
    if (sceneNodes.length === 0) return;
    const OUTPUT_X = 1240;

    // Find scenes that are done but lack their output leaf. Skip any
    // output id the user has explicitly deleted — that's the whole point
    // of tombstones.
    const missing = sceneNodes.filter((n) => {
      const sd = n.data as unknown as SceneData;
      if (sd.status !== 'done') return false;
      const outputId = `output-${n.id.replace(/^scene-/, '')}`;
      if (tombstoneSet.has(outputId)) return false;
      return !nodes.some((m) => m.id === outputId);
    });
    if (missing.length === 0) return;

    setNodes((prev) => {
      const additions = missing.map((sn) => ({
        id: `output-${sn.id.replace(/^scene-/, '')}`,
        type: 'outputNode',
        position: { x: OUTPUT_X, y: sn.position?.y ?? 0 },
        data: { sceneId: sn.id },
      }));
      // Idempotent guard for parallel triggers.
      const existingIds = new Set(prev.map((n) => n.id));
      const filtered = additions.filter((n) => !existingIds.has(n.id));
      if (filtered.length === 0) return prev;
      return [...prev, ...filtered];
    });
    setEdges((prev) => {
      const existing = new Set(prev.map((e) => e.id));
      const additions = missing
        .map((sn) => ({
          id: `e-${sn.id}-output`,
          source: sn.id,
          target: `output-${sn.id.replace(/^scene-/, '')}`,
          animated: true,
        }))
        .filter((e) => !existing.has(e.id));
      if (additions.length === 0) return prev;
      return [...prev, ...additions];
    });
  }, [nodes, setNodes, setEdges, tombstones]);

  // ---- stage 2: concat ----
  useEffect(() => {
    const sceneNodes = nodes.filter((n) => n.id.startsWith('scene-'));
    if (sceneNodes.length === 0) return;

    // Concat appears once every scene has its output leaf — proxy for
    // "every scene rendered successfully".
    const everySceneHasOutput = sceneNodes.every((sn) =>
      nodes.some((m) => m.id === `output-${sn.id.replace(/^scene-/, '')}`),
    );
    if (!everySceneHasOutput) return;
    if (nodes.some((n) => n.id === 'concat')) return;
    if (tombstoneSet.has('concat')) return; // user pruned it; respect that

    const CONCAT_X = 1660;
    const scriptY = nodes.find((n) => n.id === 'script')?.position?.y ?? 200;

    setNodes((prev) => {
      if (prev.some((n) => n.id === 'concat')) return prev;
      return [
        ...prev,
        {
          id: 'concat',
          type: 'concatNode',
          position: { x: CONCAT_X, y: scriptY },
          data: { status: 'idle' as const },
        },
      ];
    });
    setEdges((prev) => {
      const existing = new Set(prev.map((e) => e.id));
      const outputs = nodes.filter((n) => n.id.startsWith('output-'));
      const additions = outputs
        .map((on) => ({
          id: `e-${on.id}-concat`,
          source: on.id,
          target: 'concat',
          animated: true,
        }))
        .filter((e) => !existing.has(e.id));
      if (additions.length === 0) return prev;
      return [...prev, ...additions];
    });
  }, [nodes, setNodes, setEdges, tombstones]);

  return null;
}
