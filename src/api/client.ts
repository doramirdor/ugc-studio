// Tiny client over the local Express server.

export async function api<T = unknown>(path: string, body?: unknown, opts?: { method?: string }): Promise<T> {
  const method = opts?.method ?? (body ? 'POST' : 'GET');
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} /api${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface Journey {
  slug: string;
  sessions: number;
  medianDurationSec: number;
}

export const apiPullSessions = (since: string) =>
  api<{ sessions: number; journeys: Journey[]; mode?: 'live' | 'stub' }>('/posthog', { since });

export interface ScriptBeat {
  id: string;
  kind: 'avatar' | 'page';
  title: string;
  narration: string;
  caption?: string;
  page?: string;
  avatarId?: string;
}

export type ScriptMode = 'llm-api' | 'llm-cli' | 'template';

export const apiGenerateScript = (journey: string) =>
  api<{ beats: ScriptBeat[]; mode?: ScriptMode; model?: string }>('/script', { journey });

export interface SceneRenderResult {
  videoUrl: string;
  thumbnailUrl: string;
  durationMs: number;
  cached?: boolean;
}

export const apiRenderScene = (beat: ScriptBeat & { voiceId?: string }) =>
  api<SceneRenderResult>('/render-scene', beat);

export interface ConcatResult {
  videoUrl: string;
  durationMs: number;
  sizeBytes: number;
}

export const apiConcat = (sceneVideoUrls: string[]) =>
  api<ConcatResult>('/concat', { scenes: sceneVideoUrls });

export interface MergeResult {
  videoUrl: string;
  durationMs: number;
  sizeBytes: number;
  mode: string;
}

export type OverlayPosition = 'tl' | 'tr' | 'bl' | 'br' | 'center';

export const apiMerge = (input: {
  videos: string[];
  image?: string;
  audio?: string;
  audioMode?: 'replace' | 'mix';
  imagePosition?: OverlayPosition;
  imageScale?: number;
}) => api<MergeResult>('/merge', input);

// /api/health returns a per-check breakdown — the UI uses this to nudge the
// user to install missing binaries before they start hitting Render.
export interface HealthCheck {
  name: string;
  kind: 'binary' | 'path' | 'env' | 'feature';
  ok: boolean;
  required: boolean;
  hint?: string;
  error?: string;
  path?: string;
}
export interface Health {
  ok: boolean;
  recorderDir: string;
  videoDir: string;
  model: string;
  authEnabled: boolean;
  scriptMode: ScriptMode;
  checks: HealthCheck[];
}
export const apiHealth = () => api<Health>('/health');

// =========================================================================
// HeyGen library — avatars and voices
//
// Fetched on demand by AvatarPicker / VoicePicker. We share the in-flight
// promise so 6 Scene nodes mounting at once trigger a single network call.
// On 503 (HEYGEN_API_KEY missing), the pickers fall back to free-text input.
// =========================================================================
export interface HeyGenAvatar {
  id: string;
  name: string;
  previewImage: string | null;
  gender: string | null;
}
export interface HeyGenVoice {
  id: string;
  name: string;
  language: string | null;
  gender: string | null;
  previewAudio: string | null;
}

let avatarsPromise: Promise<HeyGenAvatar[]> | null = null;
let voicesPromise: Promise<HeyGenVoice[]> | null = null;

export function fetchAvatars(): Promise<HeyGenAvatar[]> {
  if (!avatarsPromise) {
    avatarsPromise = api<{ items: HeyGenAvatar[] }>('/heygen/avatars')
      .then((r) => r.items)
      .catch((err) => {
        // Reset so a future retry can try again, but propagate error to the caller
        avatarsPromise = null;
        throw err;
      });
  }
  return avatarsPromise;
}
export function fetchVoices(): Promise<HeyGenVoice[]> {
  if (!voicesPromise) {
    voicesPromise = api<{ items: HeyGenVoice[] }>('/heygen/voices')
      .then((r) => r.items)
      .catch((err) => {
        voicesPromise = null;
        throw err;
      });
  }
  return voicesPromise;
}
