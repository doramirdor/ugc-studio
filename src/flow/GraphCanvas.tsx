import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type EdgeChange,
  type NodeChange,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useGraph,
  type AssetData,
  type MergeData,
  type SceneData,
  type UrlSourceData,
} from '../store';
import { Palette, type PaletteKind } from './Palette';
import { SourceNode } from './nodes/SourceNode';
import { ScriptNode } from './nodes/ScriptNode';
import { SceneNode } from './nodes/SceneNode';
import { OutputNode } from './nodes/OutputNode';
import { ConcatNode } from './nodes/ConcatNode';
import { AssetNode } from './nodes/AssetNode';
import { MergeNode } from './nodes/MergeNode';
import { UrlSourceNode } from './nodes/UrlSourceNode';
import { SocialPostsNode } from './nodes/SocialPostsNode';

const nodeTypes = {
  sourceNode: SourceNode,
  scriptNode: ScriptNode,
  sceneNode: SceneNode,
  outputNode: OutputNode,
  concatNode: ConcatNode,
  assetNode: AssetNode,
  mergeNode: MergeNode,
  urlSourceNode: UrlSourceNode,
  socialPostsNode: SocialPostsNode,
};

function GraphCanvasInner() {
  const { nodes, edges, setNodes, setEdges, markTombstones } = useGraph();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const lastNodeCount = useRef(nodes.length);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Animate camera fit whenever new nodes are added/removed (so the canvas
  // pans + zooms left as the tree grows rightward). maxZoom keeps the camera
  // pulled back even when only a single node exists (otherwise fitView would
  // zoom way in to fill the viewport).
  useEffect(() => {
    if (nodes.length !== lastNodeCount.current) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.32, duration: 700, maxZoom: 0.95 });
      }, 50);
      lastNodeCount.current = nodes.length;
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitView]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(applyNodeChanges(changes, nodes) as Node[]),
    [nodes, setNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges(applyEdgeChanges(changes, edges)),
    [edges, setEdges],
  );

  // Manual edge connections from any source handle to any target handle.
  // We accept connections whose target is a Merge node — that's the only
  // node type that actually consumes manual inputs. Pipeline nodes
  // (Source/Script/Scene/Concat) and back-reference leaves (Output) are
  // populated by their own spawners; user-drawn edges into them have no
  // effect, so we reject them at drag-time via isValidConnection.
  // assetNode is rejected because assets are sources, not sinks.
  const isValidConnection = useCallback<IsValidConnection>(
    (conn) => {
      if (!conn.source || !conn.target) return false;
      if (conn.source === conn.target) return false;
      const target = nodes.find((n) => n.id === conn.target);
      if (!target) return false;
      // Only Merge nodes accept manual connections. Everything else is
      // either auto-managed or a pure source.
      return target.type === 'mergeNode';
    },
    [nodes],
  );

  // Backspace path: when the user selects nodes and presses Delete,
  // xyflow calls onBeforeDelete first. We expand the deletion list with
  // the orphan-cascade so deleting a Scene also takes its Output (and
  // Concat, if that was the last scene). Both seed nodes (PostHog source
  // and URL source) are now deletable — Reset restores them. onNodesDelete
  // marks tombstones so ConcatSpawner doesn't resurrect the deleted leaves.
  const onBeforeDelete = useCallback(
    async ({ nodes: toDelete }: { nodes: Node[]; edges: Edge[] }) => {
      const idsToDelete = new Set(toDelete.map((n) => n.id));
      if (idsToDelete.size === 0) return false;

      // Iteratively orphan-expand using current graph state.
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of nodes) {
          if (idsToDelete.has(n.id)) continue;
          const incoming = edges.filter((e) => e.target === n.id);
          if (incoming.length === 0) continue;
          if (incoming.every((e) => idsToDelete.has(e.source))) {
            idsToDelete.add(n.id);
            changed = true;
          }
        }
      }
      const expandedNodes = nodes.filter((n) => idsToDelete.has(n.id));
      const expandedEdges = edges.filter(
        (e) => idsToDelete.has(e.source) || idsToDelete.has(e.target),
      );
      return { nodes: expandedNodes, edges: expandedEdges };
    },
    [nodes, edges],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => markTombstones(deleted.map((n) => n.id)),
    [markTombstones],
  );

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((prev) =>
        addEdge(
          {
            ...params,
            id: `e-${params.source}-${params.target}`,
            animated: true,
          },
          prev,
        ) as Edge[],
      ),
    [setEdges],
  );

  // Auto-arrange: re-positions the auto-spawned pipeline nodes
  // (Source, Script, Scenes, Outputs, Concat) onto a deterministic grid
  // based on the current scene count and collapsed state, then fits the
  // camera. Leaves asset/merge nodes alone — those were placed by the
  // user and forced repositioning would feel rude. Spacing tightens when
  // every scene is collapsed (130px) and loosens when any are expanded
  // (540px), so the pipeline always fits without overlap or huge gaps.
  const arrange = useCallback(() => {
    setNodes((prev) => {
      const scenes = prev
        .filter((n) => n.id.startsWith('scene-'))
        .sort((a, b) => {
          const an = parseInt(a.id.match(/scene-b(\d+)/)?.[1] ?? '0', 10);
          const bn = parseInt(b.id.match(/scene-b(\d+)/)?.[1] ?? '0', 10);
          return an - bn;
        });

      const SCRIPT_Y = 200;
      const SOURCE_X = 60;
      const SCRIPT_X = 420;
      const SCENE_X = 820;
      const OUTPUT_X = 1240;
      const CONCAT_X = 1660;

      const anyExpanded = scenes.some((n) => !(n.data as unknown as SceneData).collapsed);
      const spacing = anyExpanded ? 540 : 130;
      const totalH = scenes.length > 0 ? (scenes.length - 1) * spacing : 0;
      const startY = SCRIPT_Y - totalH / 2;

      const sceneIndex = new Map(scenes.map((s, i) => [s.id, i]));

      return prev.map((n) => {
        if (n.id === 'source') return { ...n, position: { x: SOURCE_X, y: SCRIPT_Y } };
        if (n.id === 'script') return { ...n, position: { x: SCRIPT_X, y: SCRIPT_Y } };
        if (n.id === 'concat') return { ...n, position: { x: CONCAT_X, y: SCRIPT_Y } };
        const idx = sceneIndex.get(n.id);
        if (idx != null) {
          return { ...n, position: { x: SCENE_X, y: startY + idx * spacing } };
        }
        if (n.id.startsWith('output-')) {
          const sceneId = n.id.replace(/^output-/, 'scene-');
          const matchedIdx = sceneIndex.get(sceneId);
          if (matchedIdx != null) {
            return { ...n, position: { x: OUTPUT_X, y: startY + matchedIdx * spacing } };
          }
        }
        // Asset / Merge / anything else — keep user placement.
        return n;
      });
    });

    // Camera fit after the position update commits. Small timeout so
    // xyflow has measured the new positions before fitting.
    setTimeout(() => {
      fitView({ padding: 0.18, duration: 600, maxZoom: 1 });
    }, 60);
  }, [setNodes, fitView]);

  // Drag-and-drop spawn from the Palette. The palette item sets a
  // `application/x-ugc-node` data on dragstart; we read it here and
  // create the node at the cursor's flow-coordinate position.
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-ugc-node')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const kind = e.dataTransfer.getData('application/x-ugc-node') as PaletteKind | '';
      if (!kind) return;
      e.preventDefault();
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const idSuffix = Math.random().toString(36).slice(2, 8);
      let newNode: Node | null = null;
      if (kind === 'merge') {
        newNode = {
          id: `merge-${idSuffix}`,
          type: 'mergeNode',
          position,
          data: { status: 'idle', mode: 'concat' } satisfies MergeData,
        };
      } else if (kind === 'url-source') {
        newNode = {
          id: `url-${idSuffix}`,
          type: 'urlSourceNode',
          position,
          data: { status: 'idle', url: '' } satisfies UrlSourceData,
        };
      } else if (kind.startsWith('asset-')) {
        const assetKind = kind.slice('asset-'.length) as AssetData['kind'];
        newNode = {
          id: `asset-${assetKind}-${idSuffix}`,
          type: 'assetNode',
          position,
          data: { status: 'idle', kind: assetKind } satisfies AssetData,
        };
      }
      if (newNode) setNodes((prev) => [...prev, newNode!]);
    },
    [screenToFlowPosition, setNodes],
  );

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%' }} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onBeforeDelete={onBeforeDelete}
        onNodesDelete={onNodesDelete}
        isValidConnection={isValidConnection}
        fitView
        fitViewOptions={{ padding: 0.32, maxZoom: 0.95 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          // Edge color also flows through the CSS in styles.css (var(--text-3));
          // we set strokeWidth here because ReactFlow's defaultEdgeOptions.style
          // wins over the stylesheet for that property.
          style: { stroke: 'var(--text-3)', strokeWidth: 1.5 },
        }}
      >
        <Background gap={32} size={1.5} color="#e2e2e8" />
        <Controls position="bottom-left" />
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
        <Palette />
        <Panel position="top-left">
          <ArrangeButton onClick={arrange} />
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function GraphCanvas() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlowProvider>
        <GraphCanvasInner />
      </ReactFlowProvider>
    </div>
  );
}

// Floating "Arrange" button — top-left of the canvas. Tidies the
// pipeline node grid and fits the camera. Visual style matches the
// other floating controls (Palette panel + xyflow Controls + MiniMap)
// so it reads as part of the canvas chrome rather than a header action.
function ArrangeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Arrange pipeline + fit view"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: '8px 12px',
        fontSize: 'var(--fs-sm)',
        fontWeight: 600,
        color: 'var(--text)',
        cursor: 'pointer',
        boxShadow: 'var(--shadow-sm)',
        fontFamily: 'inherit',
        transition: 'background 0.12s ease, border-color 0.12s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.borderColor = 'var(--border-strong)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--surface)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="5" height="5" stroke="currentColor" strokeWidth="1.3" rx="1" />
        <rect x="8" y="1" width="5" height="5" stroke="currentColor" strokeWidth="1.3" rx="1" />
        <rect x="1" y="8" width="5" height="5" stroke="currentColor" strokeWidth="1.3" rx="1" />
        <rect x="8" y="8" width="5" height="5" stroke="currentColor" strokeWidth="1.3" rx="1" />
      </svg>
      Arrange
    </button>
  );
}
