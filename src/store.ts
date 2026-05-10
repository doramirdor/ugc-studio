import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Edge, Node } from '@xyflow/react';

export type SceneKind = 'avatar' | 'page';
export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

export interface SourceData {
  status: NodeStatus;
  since: string;
  sessionsCount?: number;
  journeys?: Array<{ slug: string; sessions: number; medianDurationSec: number }>;
  selectedJourney?: string;
  error?: string;
}

export interface ScriptData {
  status: NodeStatus;
  beats: Array<{
    id: string;
    kind: SceneKind;
    title: string;
    narration: string;
    caption?: string;
    page?: string;
    avatarId?: string;
  }>;
  mode?: 'llm-api' | 'llm-cli' | 'template';
  model?: string;
  error?: string;
}

export interface SceneData {
  status: NodeStatus;
  beatId: string;
  kind: SceneKind;
  title: string;
  narration: string;
  caption?: string;
  page?: string;
  avatarId?: string;
  voiceId?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  durationMs?: number;
  cached?: boolean;
  // UI-only: collapsed scenes show just the header + status. Scenes
  // spawn collapsed so 6 of them don't blast a 3000px column onto the
  // canvas the moment the script generates.
  collapsed?: boolean;
  error?: string;
}

// User-supplied media added to the canvas via the palette. Single node
// type drives image/audio/video — kind narrows the upload constraints
// and the preview UI. `url` populates after a successful upload; before
// that the node is in 'idle' state with just a file picker.
export interface AssetData {
  status: NodeStatus;
  kind: 'image' | 'audio' | 'video';
  url?: string;
  name?: string;
  sizeBytes?: number;
  error?: string;
}

// Position presets for the image overlay. Internal codes; the backend
// expands these into concrete x/y formulas for ffmpeg's overlay filter.
export type OverlayPosition = 'tl' | 'tr' | 'bl' | 'br' | 'center';

// Manually-added node that combines wired inputs (scene outputs + video
// assets + image overlays + audio overlays) into one mp4. The MergeNode
// itself is the leaf — videoUrl is set on render success.
//
// audioMode: replace = swap the video's audio for the asset; mix = blend
//            the two via amix. Defaults to 'replace' since most use
//            cases want a fresh narration on top of muted screen capture.
//
// imagePosition / imageScale: where to put the overlay and how wide it
// is relative to the video frame (0.10 = 10% width). Bottom-right at
// 22% is the v1 default — readable logo placement on 9:16.
//
// inputOrder: list of source-node ids in user-chosen apply order. New
// edges append; reorder via drag in the merge node UI. Reconciled
// against the live incoming-edge set on every render.
export interface MergeData {
  status: NodeStatus;
  mode: 'concat';
  audioMode?: 'replace' | 'mix';
  imagePosition?: OverlayPosition;
  imageScale?: number;
  inputOrder?: string[];
  videoUrl?: string;
  durationMs?: number;
  sizeBytes?: number;
  error?: string;
}

// Output node is a thin "leaf" that renders the result of a Scene render.
// Its only own data is a back-reference to the scene that produced it; the
// videoUrl/thumbnailUrl/durationMs/cached fields stay on SceneData (single
// source of truth). The output node spawns automatically when the scene
// reaches status='done' (see OutputSpawner) and updates in place on
// re-render.
export interface OutputData {
  sceneId: string;
}

export interface ConcatData {
  status: NodeStatus;
  videoUrl?: string;
  durationMs?: number;
  sizeBytes?: number;
  error?: string;
}

export type AppNodeData = SourceData | ScriptData | SceneData | OutputData | ConcatData | AssetData | MergeData;

type NodesUpdater = Node[] | ((prev: Node[]) => Node[]);
type EdgesUpdater = Edge[] | ((prev: Edge[]) => Edge[]);

interface State {
  nodes: Node[];
  edges: Edge[];
  // Ids of nodes the user has explicitly deleted. The auto-spawners
  // (ConcatSpawner) skip ids in this set so a deleted Output/Concat
  // doesn't immediately come back. Cleared by resetGraph + by re-running
  // Script.generate (handled in ScriptNode's spawnSceneNodes).
  tombstones: string[];
  setNodes: (nodes: NodesUpdater) => void;
  setEdges: (edges: EdgesUpdater) => void;
  patchNode: (id: string, data: Partial<AppNodeData>) => void;
  /** Cascade-delete a node and any descendant whose only parent path was
      through it. Adds every removed id to tombstones. Source is sacred. */
  pruneNode: (id: string) => void;
  /** Just track ids as tombstoned (used by xyflow's onNodesDelete after
      a Backspace deletion has already happened). */
  markTombstones: (ids: string[]) => void;
  /** Functional updater. Used by ScriptNode.spawnSceneNodes to clear
      pipeline tombstones (scene-*, output-*, concat) so a re-generated
      script can resurrect them, while leaving user-managed asset/merge
      tombstones alone. */
  setTombstones: (updater: (prev: string[]) => string[]) => void;
  resetGraph: () => void;
}

// Layout: nodes flow LEFT to RIGHT, growing as a tree. The graph starts with
// only the root (PostHog Source). Each stage spawns the next node when its
// own action completes. Camera auto-fits as the tree grows so the new leaf
// is always visible.
const initialNodes: Node[] = [
  {
    id: 'source',
    type: 'sourceNode',
    position: { x: 60, y: 200 },
    data: {
      status: 'idle',
      since: '7d',
      sessionsCount: undefined,
      journeys: undefined,
    } satisfies SourceData,
  },
];

const initialEdges: Edge[] = [];

// Walk descendants from `roots` and include any node whose ALL incoming
// edges originate inside the deletion set. A descendant with another
// independent parent (e.g. Concat fed by 5 sibling Outputs when only 1
// is being pruned) is preserved. Iterates to a fixpoint so chains of
// orphans (Scene → Output → Concat) collapse together when the upstream
// is gone.
function computeCascade(
  rootIds: string[],
  nodes: Node[],
  edges: Edge[],
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (nodeIds.has(n.id)) continue;
      const incoming = edges.filter((e) => e.target === n.id);
      if (incoming.length === 0) continue; // independent root, leave alone
      if (incoming.every((e) => nodeIds.has(e.source))) {
        nodeIds.add(n.id);
        changed = true;
      }
    }
  }
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (nodeIds.has(e.source) || nodeIds.has(e.target)) edgeIds.add(e.id);
  }
  return { nodeIds, edgeIds };
}

export const useGraph = create<State>()(
  persist(
    (set) => ({
      nodes: initialNodes,
      edges: initialEdges,
      tombstones: [],
      setNodes: (updater) =>
        set((state) => ({
          nodes: typeof updater === 'function' ? updater(state.nodes) : updater,
        })),
      setEdges: (updater) =>
        set((state) => ({
          edges: typeof updater === 'function' ? updater(state.edges) : updater,
        })),
      patchNode: (id, data) =>
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
          ),
        })),
      pruneNode: (id) =>
        set((state) => {
          if (id === 'source') return state; // source is the seed; never auto-removable
          const { nodeIds, edgeIds } = computeCascade([id], state.nodes, state.edges);
          if (nodeIds.size === 0) return state;
          return {
            nodes: state.nodes.filter((n) => !nodeIds.has(n.id)),
            edges: state.edges.filter((e) => !edgeIds.has(e.id)),
            tombstones: Array.from(new Set([...state.tombstones, ...nodeIds])),
          };
        }),
      markTombstones: (ids) =>
        set((state) => ({
          tombstones: Array.from(new Set([...state.tombstones, ...ids.filter((i) => i !== 'source')])),
        })),
      setTombstones: (updater) =>
        set((state) => ({ tombstones: updater(state.tombstones) })),
      resetGraph: () => set({ nodes: initialNodes, edges: initialEdges, tombstones: [] }),
    }),
    {
      name: 'ugc-graph',
      // Persist the graph itself, but flush any in-flight 'running' statuses
      // back to 'idle' on load so a reload during a render doesn't leave the
      // node stuck spinning.
      partialize: (state) => ({ nodes: state.nodes, edges: state.edges, tombstones: state.tombstones }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.nodes = state.nodes.map((n) => {
          const data = n.data as { status?: string };
          if (data?.status === 'running') {
            return { ...n, data: { ...n.data, status: 'idle' } };
          }
          return n;
        });
      },
      version: 5,
      // v1 -> v2: added optional fields on ScriptData and SceneData (no-op).
      // v2 -> v3: render output split into its own leaf node; legacy
      //   scene→concat edges stripped to avoid cross-wiring with the
      //   new output→concat edges added by the spawner effect.
      // v3 -> v4: MergeData gained audioMode/imagePosition/imageScale/
      //   inputOrder fields. All optional with backend defaults, so
      //   the migration is a pure no-op for existing merge nodes.
      // v4 -> v5: added tombstones[] for cascade-delete bookkeeping.
      //   Default to empty array on existing graphs.
      migrate: (state, version) => {
        const s = state as State;
        if (!s) return s;
        if (version < 3) {
          s.edges = (s.edges || []).filter(
            (e) => !(e.id?.startsWith?.('e-scene-') && e.id?.includes?.('-concat')),
          );
        }
        if (version < 5) {
          s.tombstones = s.tombstones || [];
        }
        return s;
      },
    },
  ),
);
