import { useRef } from 'react';
import { NodeShell } from './_base';
import { useGraph, type AssetData } from '../../store';

const KIND_ACCEPT: Record<AssetData['kind'], string> = {
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
};
const KIND_HINT: Record<AssetData['kind'], string> = {
  image: 'PNG · JPG · WEBP',
  audio: 'MP3 · M4A · WAV',
  video: 'MP4 · MOV · WEBM',
};

export function AssetNode({ id, data }: { id: string; data: AssetData }) {
  const { patchNode, pruneNode } = useGraph();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    patchNode(id, { status: 'running', error: undefined });
    try {
      const buf = await file.arrayBuffer();
      const r = await fetch(
        `/api/upload-asset?kind=${data.kind}&name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: buf,
        },
      );
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      patchNode(id, {
        status: 'done',
        url: j.url,
        name: j.name,
        sizeBytes: j.sizeBytes,
      });
    } catch (e) {
      patchNode(id, { status: 'error', error: (e as Error).message });
    }
  };

  return (
    <NodeShell
      title={data.name ?? `${data.kind[0].toUpperCase()}${data.kind.slice(1)} asset`}
      subtitle={data.url ? data.kind : 'No file yet'}
      status={data.status}
      width={260}
      onDelete={() => pruneNode(id)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!data.url && (
          <button
            className="nodrag"
            onClick={() => inputRef.current?.click()}
            style={{
              padding: '20px 14px',
              border: '1px dashed var(--border-strong)',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'inherit',
              transition: 'background 0.12s ease, border-color 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-3)';
              e.currentTarget.style.borderColor = 'var(--text-3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--surface-2)';
              e.currentTarget.style.borderColor = 'var(--border-strong)';
            }}
          >
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>Choose file</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-3)',
                letterSpacing: 0.2,
                textTransform: 'uppercase',
              }}
            >
              {KIND_HINT[data.kind]}
            </span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={KIND_ACCEPT[data.kind]}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        {data.error && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-error)', lineHeight: 1.4 }}>{data.error}</div>
        )}
        {data.url && data.kind === 'image' && (
          <img
            src={data.url}
            alt={data.name}
            style={{ width: '100%', borderRadius: 'var(--r-md)', maxHeight: 240, objectFit: 'contain', background: '#000' }}
          />
        )}
        {data.url && data.kind === 'audio' && (
          <audio src={data.url} controls style={{ width: '100%' }} />
        )}
        {data.url && data.kind === 'video' && (
          <video
            src={data.url}
            controls
            preload="metadata"
            style={{ width: '100%', borderRadius: 'var(--r-md)', background: '#000', maxHeight: 240 }}
          />
        )}
        {data.url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="nodrag"
              onClick={() => inputRef.current?.click()}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                padding: '5px 10px',
                fontSize: 10,
                color: 'var(--text-2)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Replace
            </button>
            {data.sizeBytes != null && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-3)',
                  letterSpacing: 0.2,
                  marginLeft: 'auto',
                }}
              >
                {(data.sizeBytes / 1024 / 1024).toFixed(2)} MB
              </span>
            )}
          </div>
        )}
      </div>
    </NodeShell>
  );
}
