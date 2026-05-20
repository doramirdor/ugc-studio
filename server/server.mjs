// Tiny Express server that wraps the posthog-demo-recorder.
// Paths assume the recorder lives at ~/Documents/code/Nadir/getnadir.dev/marketing/demo-recorder
// (override with RECORDER_DIR env var).
//
// Endpoints:
//   POST /api/posthog       { since } -> { sessions, journeys[] }
//   POST /api/script        { journey } -> { beats[] }
//   POST /api/render-scene  beat -> { videoUrl, thumbnailUrl, durationMs, cached? }
//   POST /api/concat        { scenes: string[] } -> { videoUrl, durationMs, sizeBytes }
//   GET  /api/health        deep preflight of binaries, dirs, env
//   GET  /videos/<file>     static file from RECORDER_DIR/videos/
//
// Optional env:
//   ANTHROPIC_API_KEY   - enables direct-API LLM script generation
//   ANTHROPIC_MODEL     - default 'claude-sonnet-4-6' (used by the API path)
//   UGC_USE_CLAUDE_CLI  - set to 'false' to disable the `claude` CLI fallback;
//                          default behavior: if the `claude` binary is on PATH,
//                          script generation runs through it (subscription auth)
//   PRODUCT_PACK_PATH   - path to a markdown product knowledge pack for script grounding
//   UGC_AUTH_TOKEN      - if set, /api/* and /videos/* require Authorization: Bearer <token>
//
// Script generation preference order:
//   1. ANTHROPIC_API_KEY  (direct API, fastest)
//   2. `claude` CLI       (uses Claude Code subscription, no key needed)
//   3. hardcoded template (always works, generic copy)

import express from 'express';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const RECORDER_DIR = process.env.RECORDER_DIR || path.join(
  os.homedir(),
  'Documents/code/Nadir/getnadir.dev/marketing/demo-recorder',
);
const PORT = parseInt(process.env.PORT || '8787', 10);
const VIDEO_DIR = path.join(RECORDER_DIR, 'videos');
const CACHE_FILE = path.join(VIDEO_DIR, '.scene-cache.json');
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const AUTH_TOKEN = process.env.UGC_AUTH_TOKEN;
const USE_CLAUDE_CLI = process.env.UGC_USE_CLAUDE_CLI !== 'false';
let claudeCliAvailable = false; // probed at boot, see loadCache/boot section
// Whether this ffmpeg build has the `drawtext` filter (requires
// libfreetype). Homebrew's default `ffmpeg` formula ships *without* it.
// If false, captions are silently skipped and the UI surfaces a fix.
let hasDrawtext = false;

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// =========================================================================
// Auth (opt-in via UGC_AUTH_TOKEN). Health is always public so deploys
// can probe liveness without a secret.
// =========================================================================
function requireAuth(req, res, next) {
  if (!AUTH_TOKEN) return next();
  if (req.path === '/api/health') return next();
  const hdr = req.get('authorization') || '';
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== AUTH_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}
app.use(requireAuth);

// Static video serving (UI loads videos via /videos/<filename>)
app.use('/videos', express.static(VIDEO_DIR));

// =========================================================================
// Input sanitization helpers - every value that flows into spawn argv,
// fetch URL, or filesystem path comes through here.
// =========================================================================
const SLUG_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const SINCE_RE = /^\d{1,4}[smhdw]$/;
const URL_PATH_RE = /^\/[A-Za-z0-9_\-./]{0,256}$/;
const HEX_RE = /^[a-fA-F0-9]{1,64}$/;

// Platforms supported by /api/generate-posts. Each entry pins the card
// aspect ratio (so the SVG generator and the UI agree) plus the platform
// constraints we surface in the Claude prompt.
const SOCIAL_PLATFORMS = {
  linkedin: {
    label: 'LinkedIn',
    width: 1200, height: 627,
    maxChars: 1300, // platform max is 3000, but engagement-optimal is short
    voice: 'professional, numerate, slightly skeptical of hype — no exclamation marks, no emoji spam',
    hashtagsHint: 'optional, max 3 hashtags',
    palette: { bg1: '#0A66C2', bg2: '#003E8A', text: '#FFFFFF', accent: '#70B5F9' },
  },
  twitter: {
    label: 'Twitter / X',
    width: 1200, height: 675,
    maxChars: 280,
    voice: 'punchy, opinionated, hook-first; one idea per post',
    hashtagsHint: 'avoid hashtags unless they add reach (max 2)',
    palette: { bg1: '#000000', bg2: '#15202B', text: '#FFFFFF', accent: '#1D9BF0' },
  },
  facebook: {
    label: 'Facebook',
    width: 1200, height: 630,
    maxChars: 500,
    voice: 'conversational, friendly, no jargon; explain in plain words',
    hashtagsHint: 'avoid hashtags — they read as ads on Facebook',
    palette: { bg1: '#1877F2', bg2: '#0B5FCC', text: '#FFFFFF', accent: '#FFFFFF' },
  },
};

function sanitizePostUrl(raw) {
  if (typeof raw !== 'string') throw new Error('url required');
  const trimmed = raw.trim();
  if (trimmed.length > 2048) throw new Error('url too long (max 2048)');
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error('url must be a valid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('url must be http or https');
  }
  // Block private network ranges & loopback so URL fetches can't be used
  // as an SSRF probe into the host's intranet.
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') {
    throw new Error('url host blocked');
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    throw new Error('url host blocked (private network)');
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('url host blocked (private network)');
  }
  return u.toString();
}

function sanitizePlatforms(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('platforms[] required');
  }
  if (raw.length > 8) throw new Error('too many platforms');
  const out = [];
  for (const p of raw) {
    if (typeof p !== 'string' || !SOCIAL_PLATFORMS[p]) {
      throw new Error(`unknown platform: ${p}`);
    }
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

function sanitizeBeat(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('beat required');
  const id = String(raw.id ?? '');
  if (!SLUG_RE.test(id)) throw new Error('invalid beat.id (slug only, max 32)');
  const kind = raw.kind === 'avatar' ? 'avatar' : raw.kind === 'page' ? 'page' : null;
  if (!kind) throw new Error('beat.kind must be avatar or page');
  const narration = typeof raw.narration === 'string' ? raw.narration.slice(0, 1500).trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.slice(0, 120).trim() : '';
  const caption = typeof raw.caption === 'string' ? raw.caption.slice(0, 200).trim() : '';
  let page = typeof raw.page === 'string' ? raw.page.trim() : '';
  if (page && !URL_PATH_RE.test(page)) throw new Error('beat.page must be a relative path like /pricing');
  if (page.includes('..')) throw new Error('beat.page must not contain ..');
  const avatarId = raw.avatarId != null ? String(raw.avatarId) : undefined;
  if (avatarId && !HEX_RE.test(avatarId)) throw new Error('beat.avatarId must be hex');
  const voiceId = raw.voiceId != null ? String(raw.voiceId) : undefined;
  if (voiceId && !HEX_RE.test(voiceId)) throw new Error('beat.voiceId must be hex');
  return { id, kind, narration, title, caption, page, avatarId, voiceId };
}

function sanitizeSince(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '7d';
  if (!SINCE_RE.test(v)) throw new Error('since must look like 7d / 24h / 90m');
  return v;
}

function sanitizeJourney(raw) {
  if (typeof raw !== 'string' || !raw) throw new Error('journey required');
  if (raw.length > 80) throw new Error('journey too long');
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) throw new Error('journey must be slug');
  return raw;
}

// Hash for content-addressed scene caching. Only fields that affect the
// rendered output are part of the key — UI-only fields (title) are not.
function hashBeat(beat) {
  const canon = {
    kind: beat.kind,
    narration: beat.narration,
    caption: beat.caption,
    page: beat.page || null,
    avatarId: beat.avatarId || null,
    voiceId: beat.voiceId || null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex').slice(0, 16);
}

// =========================================================================
// Idempotency cache: { [beatHash]: { videoUrl, thumbnailUrl, durationMs } }
// Persisted to disk so HeyGen credits aren't burned on retry.
// =========================================================================
let sceneCache = {};
async function loadCache() {
  try {
    sceneCache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    sceneCache = {};
  }
}
async function saveCache() {
  try {
    await mkdir(VIDEO_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(sceneCache, null, 2));
  } catch (e) {
    console.warn('[cache] save failed:', e.message);
  }
}
async function cacheLookup(hash) {
  const hit = sceneCache[hash];
  if (!hit) return null;
  const file = path.join(VIDEO_DIR, path.basename(hit.videoUrl));
  // Stale: file deleted out from under us.
  if (!existsSync(file)) {
    delete sceneCache[hash];
    return null;
  }
  // Self-heal: cached scenes from before the audio-padding fix lack an
  // audio stream, which breaks /api/concat and /api/merge downstream.
  // Evict so the next render produces a fixed file.
  if (!(await probeHasAudio(file))) {
    console.warn('[cache] evicting silent scene', path.basename(file));
    delete sceneCache[hash];
    return null;
  }
  return hit;
}

// Helper: spawn, capture stdout. opts.tee=true also pipes stdout/stderr
// to the parent process so long-running subprocesses (record.mjs takes
// ~30s) show progress in the dev server terminal — and so failures
// like the one in this conversation leave a full stderr tail in logs.
function run(cmd, args, opts = {}) {
  const { tee, ...spawnOpts } = opts;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: RECORDER_DIR, ...spawnOpts });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (d) => {
      stdout += d;
      if (tee) process.stdout.write(d);
    });
    p.stderr?.on('data', (d) => {
      stderr += d;
      if (tee) process.stderr.write(d);
    });
    p.on('exit', (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} ${args.join(' ')}: ${stderr || stdout}`)),
    );
    p.on('error', reject);
  });
}

// Helper: probe video duration in ms
async function probeMs(filePath) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    filePath,
  ]);
  return Math.round(parseFloat(stdout.trim()) * 1000);
}

// Whether the file has at least one audio stream. Used to detect mp4s
// produced with no narration mux (page beats run without HEYGEN_API_KEY)
// before they reach a concat filter that asks for `:a` streams.
async function probeHasAudio(filePath) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      filePath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// If `inputPath` lacks an audio stream, write a sibling file with silent
// AAC audio added (via lavfi `anullsrc`) and return that path. Otherwise
// returns the original path unchanged. Used by render-scene's page
// branch and by /api/merge + /api/concat so downstream filters that
// require `:a` streams (concat=v=1:a=1) don't fail with "matches no
// streams". Result is content-named so repeated calls are cheap.
async function ensureAudio(inputPath) {
  if (await probeHasAudio(inputPath)) return inputPath;
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const out = path.join(path.dirname(inputPath), `_audio-${base}${ext}`);
  if (existsSync(out) && (await probeHasAudio(out))) return out;
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', inputPath,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-shortest',
    '-movflags', '+faststart',
    out,
  ]);
  return out;
}

// Caption escape for ffmpeg drawtext (single quotes + colons + backslashes
// are the special chars that break the filtergraph).
function escapeDrawtext(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ');
}

// Build a drawtext filter that burns caption text into the bottom third
// of a 1080x1920 vertical frame. Wraps long captions across two lines.
// Returns null if there's no caption OR if the running ffmpeg lacks
// drawtext (Homebrew default builds). Callers MUST handle null and skip
// the -vf step rather than passing an empty filter.
function captionFilter(captionText) {
  if (!captionText) return null;
  if (!hasDrawtext) return null;
  const lines = wrapCaption(captionText, 22).slice(0, 2);
  return lines
    .map((line, i) =>
      `drawtext=text='${escapeDrawtext(line)}'` +
      `:fontcolor=white` +
      `:fontsize=56` +
      `:box=1:boxcolor=black@0.55:boxborderw=18` +
      `:x=(w-text_w)/2` +
      `:y=h-360+${i * 80}`,
    )
    .join(',');
}

function wrapCaption(s, maxChars) {
  const words = s.split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) out.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

// =========================================================================
// /api/upload-asset - accept binary upload, save to VIDEO_DIR
//
// Used by AssetNode to ingest user-supplied images, audio, and video
// clips that get wired into Merge nodes. We deliberately use raw binary
// (with kind+name in query) instead of multipart so we don't need a new
// dependency. Files are stored under VIDEO_DIR with hash-based names so
// they're served by the existing /videos/ static handler. Size capped
// at 100MB; extension validated against kind.
// =========================================================================
const ASSET_MAX_BYTES = 100 * 1024 * 1024;
const ASSET_KINDS = {
  image: { exts: ['png', 'jpg', 'jpeg', 'webp', 'gif'], mime: /^image\// },
  audio: { exts: ['mp3', 'm4a', 'wav', 'aac', 'ogg'], mime: /^audio\// },
  video: { exts: ['mp4', 'mov', 'webm'], mime: /^video\// },
};

app.post('/api/upload-asset', express.raw({ type: '*/*', limit: ASSET_MAX_BYTES }), async (req, res) => {
  try {
    const kind = String(req.query.kind || '');
    const rawName = String(req.query.name || 'upload');
    if (!ASSET_KINDS[kind]) return res.status(400).json({ error: `kind must be image|audio|video, got '${kind}'` });

    // Sanitize the original name down to a slug. We don't actually use
    // it for the filename (hash-based), but we surface it in the response
    // so the UI can label the node, and we use its extension.
    const cleanName = rawName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    const ext = (cleanName.match(/\.([a-zA-Z0-9]+)$/)?.[1] || '').toLowerCase();
    if (!ASSET_KINDS[kind].exts.includes(ext)) {
      return res.status(400).json({ error: `${kind} extension must be one of ${ASSET_KINDS[kind].exts.join('/')}, got '${ext}'` });
    }
    if (req.headers['content-type'] && !ASSET_KINDS[kind].mime.test(req.headers['content-type'])) {
      // Soft check — some clients don't send a precise MIME. Don't reject.
      console.warn(`[upload-asset] mime '${req.headers['content-type']}' doesn't match kind=${kind}`);
    }

    const body = req.body;
    if (!body || !body.length) return res.status(400).json({ error: 'empty body' });

    const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
    const filename = `_asset-${kind}-${hash}.${ext}`;
    const outPath = path.join(VIDEO_DIR, filename);
    await mkdir(VIDEO_DIR, { recursive: true });
    if (!existsSync(outPath)) await writeFile(outPath, body);

    res.json({
      url: `/videos/${filename}`,
      kind,
      name: cleanName,
      sizeBytes: body.length,
      hash,
    });
  } catch (e) {
    console.error('[upload-asset] error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// =========================================================================
// HeyGen library proxy: /api/heygen/avatars and /api/heygen/voices
//
// Why proxy instead of letting the UI hit HeyGen directly:
//   - HEYGEN_API_KEY stays on the server (never reaches the browser)
//   - We can cache the (rarely-changing) library lists across UI mounts
//
// Cache: in-memory with 1h TTL. The lists rarely change within a session.
// If HEYGEN_API_KEY is missing, return 503 with a clear message; the UI
// falls back to a free-text input.
// =========================================================================
const HEYGEN_LIB_TTL_MS = 60 * 60 * 1000; // 1h
const heygenLibCache = {
  avatars: { data: null, expiresAt: 0, inflight: null },
  voices: { data: null, expiresAt: 0, inflight: null },
};

async function fetchHeygenLibrary(kind) {
  const now = Date.now();
  const slot = heygenLibCache[kind];
  if (slot.data && slot.expiresAt > now) return slot.data;
  // Coalesce concurrent fetches across requests.
  if (slot.inflight) return slot.inflight;
  if (!process.env.HEYGEN_API_KEY) throw new Error('HEYGEN_API_KEY not set');

  slot.inflight = (async () => {
    const url = kind === 'avatars'
      ? 'https://api.heygen.com/v2/avatars'
      : 'https://api.heygen.com/v2/voices';
    const r = await fetch(url, {
      headers: { 'x-api-key': process.env.HEYGEN_API_KEY, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`heygen ${kind} ${r.status}: ${text.slice(0, 300)}`);
    }
    const json = await r.json();
    // HeyGen v2 envelope is { data: { avatars: [...] } } or { data: { voices: [...] } }.
    const list = json?.data?.[kind] || json?.data || [];
    // Normalize to a slim shape the UI can render directly.
    const normalized = kind === 'avatars'
      ? list.map((a) => ({
          id: a.avatar_id || a.id,
          name: a.avatar_name || a.name || a.avatar_id,
          previewImage: a.preview_image_url || a.preview_image || null,
          gender: a.gender || null,
        })).filter((a) => a.id)
      : list.map((v) => ({
          id: v.voice_id || v.id,
          name: v.name || v.voice_id,
          language: v.language || v.locale || null,
          gender: v.gender || null,
          previewAudio: v.preview_audio || null,
        })).filter((v) => v.id);
    normalized.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    slot.data = normalized;
    slot.expiresAt = now + HEYGEN_LIB_TTL_MS;
    return normalized;
  })().finally(() => {
    slot.inflight = null;
  });
  return slot.inflight;
}

app.get('/api/heygen/avatars', async (_req, res) => {
  try {
    const data = await fetchHeygenLibrary('avatars');
    res.json({ items: data, cached: heygenLibCache.avatars.expiresAt - Date.now() < HEYGEN_LIB_TTL_MS - 5_000 });
  } catch (e) {
    const status = /HEYGEN_API_KEY/.test(e.message) ? 503 : 502;
    res.status(status).json({ error: String(e.message || e), items: [] });
  }
});
app.get('/api/heygen/voices', async (_req, res) => {
  try {
    const data = await fetchHeygenLibrary('voices');
    res.json({ items: data, cached: heygenLibCache.voices.expiresAt - Date.now() < HEYGEN_LIB_TTL_MS - 5_000 });
  } catch (e) {
    const status = /HEYGEN_API_KEY/.test(e.message) ? 503 : 502;
    res.status(status).json({ error: String(e.message || e), items: [] });
  }
});

// =========================================================================
// /api/posthog - pull sessions and cluster into journeys
// =========================================================================
app.post('/api/posthog', async (req, res) => {
  let since;
  try {
    since = sanitizeSince(req.body?.since);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    if (process.env.POSTHOG_PROJECT_API_KEY) {
      const out = path.join(VIDEO_DIR, 'sessions.json');
      await mkdir(VIDEO_DIR, { recursive: true });
      await run('python3', [
        'scripts/posthog_query.py',
        '--since', since,
        '--min-events', '8',
        '--max-sessions', '50',
        '--out', out,
      ]);
      const data = JSON.parse(await readFile(out, 'utf8'));
      const sessions = data.sessions || [];
      const journeys = clusterSessions(sessions);
      res.json({ sessions: sessions.length, journeys, mode: 'live' });
    } else {
      res.json({
        sessions: 42,
        mode: 'stub',
        journeys: [
          { slug: 'first-time-signup', sessions: 14, medianDurationSec: 168 },
          { slug: 'first-chat-completion', sessions: 9, medianDurationSec: 72 },
          { slug: 'savings-discovered', sessions: 5, medianDurationSec: 184 },
          { slug: 'wasted-llm-spend', sessions: 12, medianDurationSec: 95 },
        ],
      });
    }
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

function clusterSessions(sessions) {
  const buckets = new Map();
  for (const s of sessions) {
    const key = (s.path_sequence || []).map((p) => p.pathname || p.event).slice(0, 8).join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  const out = [];
  for (const [key, group] of buckets) {
    if (group.length < 2) continue;
    const median = group.map((s) => {
      const start = new Date(s.started_at).getTime();
      const end = new Date(s.ended_at).getTime();
      return (end - start) / 1000;
    }).sort((a, b) => a - b)[Math.floor(group.length / 2)];
    out.push({
      slug: key.replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '') || `journey-${out.length}`,
      sessions: group.length,
      medianDurationSec: Math.round(median),
    });
  }
  return out.sort((a, b) => b.sessions - a.sessions).slice(0, 8);
}

// =========================================================================
// /api/script - generate ad script for a journey
//
// If ANTHROPIC_API_KEY is set, we ask Claude (Sonnet 4.6 by default) to
// write a 6-beat ad grounded in the product knowledge pack. Otherwise we
// fall back to the hardcoded template so the demo still works offline.
// =========================================================================
app.post('/api/script', async (req, res) => {
  let journey;
  try {
    journey = sanitizeJourney(req.body?.journey);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const beats = await generateScriptWithClaudeAPI(journey);
      return res.json({ beats, mode: 'llm-api', model: ANTHROPIC_MODEL });
    }
    if (USE_CLAUDE_CLI && claudeCliAvailable) {
      const beats = await generateScriptWithClaudeCLI(journey);
      return res.json({ beats, mode: 'llm-cli', model: 'claude-code-subscription' });
    }
    res.json({ beats: templateBeats(journey), mode: 'template' });
  } catch (e) {
    console.error('[script] error:', e);
    // Hard-fail surfaces the LLM error to the UI so the user knows why
    // the beats look generic; fallback is template if fall-back-on-error
    // ever feels right.
    res.status(500).json({ error: String(e.message || e) });
  }
});

const DEFAULT_PRODUCT_PACK = `
PRODUCT: Nadir — an LLM router that automatically sends easy prompts to cheaper
models and hard prompts to premium models, cutting AI bills ~40-50% without
changing the user's app code.
AUDIENCE: engineering and platform leads at companies spending >$10k/mo on LLM APIs.
TONE: blunt, numerate, slightly skeptical of hype. No exclamation marks. No "imagine".
ALLOWED CLAIMS: routes prompts automatically; same workflow; cuts bill ~50% on average;
free for the first month with code FIRST1; works with OpenAI, Anthropic, Gemini.
BANNED PHRASES: "revolutionize", "game-changer", "unlock", "supercharge", "imagine".
CTA: "Try Nadir free for one month" / "getnadir.com" / "code FIRST1".
DEFAULT AVATARS:
  - hook: b03204c8090e4ea392e328eaa05fd97c
  - explainer: 7cda1b95d8174773ba1811931caba947
  - cta: 0aca2839fb7949629b629fa22a3d9361
DEFAULT PAGES: '/' (homepage), '/calculator' (savings calculator).
`.trim();

async function loadProductPack() {
  if (process.env.PRODUCT_PACK_PATH) {
    try {
      return await readFile(process.env.PRODUCT_PACK_PATH, 'utf8');
    } catch (e) {
      console.warn('[script] PRODUCT_PACK_PATH unreadable, using default:', e.message);
    }
  }
  return DEFAULT_PRODUCT_PACK;
}

// Builds the user prompt shared by both the API path and the CLI path.
// Both paths converge on the same JSON shape, validated through sanitizeBeat.
async function buildScriptPrompt(journey) {
  const productPack = await loadProductPack();
  const guidelines = [
    'You write short, vertical-video ad scripts for B2B SaaS.',
    'Output is 6 beats: 3 avatar talking-head beats interleaved with 3 page-recording beats.',
    'Order: avatar (hook) -> page (pain proof) -> avatar (how it works) -> page (proof point) -> avatar (CTA) -> page (closer).',
    'Each narration is one or two short sentences, max 25 words, spoken naturally.',
    'Each caption is max 6 words.',
    'Use ONLY claims allowed by the product pack. Reject any banned phrase.',
    'Pick avatar_id from the product pack. Pick page from the product pack default pages.',
  ].join('\n');
  return { productPack, guidelines };
}

// CLI path: runs through the user's Claude Code subscription via `claude -p`.
// Tools are disabled and turns are capped to 1 so it behaves as a pure
// "given prompt -> get text" call. We run in os.tmpdir() so it doesn't pick
// up local CLAUDE.md / hooks / MCP servers from this repo.
async function generateScriptWithClaudeCLI(journey) {
  const { productPack, guidelines } = await buildScriptPrompt(journey);
  const prompt = [
    guidelines,
    '',
    'PRODUCT PACK:',
    productPack,
    '',
    `Journey slug: ${journey}`,
    '',
    'Output ONLY a single JSON object, no prose, no markdown fences. Exact shape:',
    '{"beats":[',
    '  {"id":"b0","kind":"avatar","title":"...","narration":"...","caption":"...","avatarId":"<hex>"},',
    '  {"id":"b1","kind":"page","title":"...","narration":"...","caption":"...","page":"/..."},',
    '  ... 6 total, alternating avatar/page in the order above',
    ']}',
  ].join('\n');

  const { stdout } = await runWithStdin(
    'claude',
    ['-p', '--output-format', 'text', '--max-turns', '1', '--disallowedTools', '*'],
    prompt,
    { cwd: os.tmpdir() },
  );

  // Be liberal in what we accept — strip code fences if Claude added any,
  // then pull out the first {...} that contains a "beats" key.
  const cleaned = stdout
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*"beats"[\s\S]*\}\s*$/m) || cleaned.match(/\{[\s\S]*"beats"[\s\S]*\}/);
  if (!match) throw new Error(`claude CLI returned no JSON: ${stdout.slice(0, 400)}`);
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`claude CLI returned invalid JSON: ${e.message}\n${match[0].slice(0, 400)}`);
  }
  if (!Array.isArray(parsed?.beats)) throw new Error('claude CLI: missing beats[]');
  return parsed.beats.map((b) =>
    sanitizeBeat({ ...b, page: b.page || undefined, avatarId: b.avatarId || undefined }),
  );
}

async function generateScriptWithClaudeAPI(journey) {
  const { productPack, guidelines } = await buildScriptPrompt(journey);
  const system = [
    guidelines,
    'Output via the submit_script tool. No prose.',
    '',
    'PRODUCT PACK:',
    productPack,
  ].join('\n');

  const tools = [
    {
      name: 'submit_script',
      description: 'Submit the 6-beat ad script.',
      input_schema: {
        type: 'object',
        required: ['beats'],
        properties: {
          beats: {
            type: 'array',
            minItems: 6,
            maxItems: 6,
            items: {
              type: 'object',
              required: ['id', 'kind', 'title', 'narration', 'caption'],
              properties: {
                id: { type: 'string', pattern: '^b[0-5]$' },
                kind: { type: 'string', enum: ['avatar', 'page'] },
                title: { type: 'string', maxLength: 60 },
                narration: { type: 'string', maxLength: 220 },
                caption: { type: 'string', maxLength: 60 },
                page: { type: 'string' },
                avatarId: { type: 'string' },
              },
            },
          },
        },
      },
    },
  ];

  const userMsg = [
    `Journey slug: ${journey}`,
    'Write a 6-beat ad targeting users on this journey. Keep it specific to the slug name where possible.',
  ].join('\n');

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system,
    tools,
    tool_choice: { type: 'tool', name: 'submit_script' },
    messages: [{ role: 'user', content: userMsg }],
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`anthropic ${r.status}: ${text}`);
  }
  const json = await r.json();
  const toolUse = (json.content || []).find((b) => b.type === 'tool_use');
  if (!toolUse?.input?.beats) throw new Error('claude returned no submit_script tool call');
  // Validate every beat through sanitizeBeat to enforce the same rules
  // as a hand-edited beat would face.
  return toolUse.input.beats.map((b) => sanitizeBeat({ ...b, page: b.page || undefined, avatarId: b.avatarId || undefined }));
}

function templateBeats(_journey) {
  return [
    { id: 'b0', kind: 'avatar', title: 'Hook', narration: 'Your AI bill is out of control. Most teams burn forty to fifty percent of their budget on prompts that should never hit the most expensive model.', caption: 'Stop overpaying for simple prompts', avatarId: 'b03204c8090e4ea392e328eaa05fd97c' },
    { id: 'b1', kind: 'page', title: 'Pain proof', narration: 'Every prompt hits the same expensive model. Every single time.', caption: 'Every prompt hits the same expensive model', page: '/' },
    { id: 'b2', kind: 'avatar', title: 'How it works', narration: 'Nadir routes prompts automatically. Easy ones go cheaper. Hard ones stay premium. Same workflow.', caption: 'Cheap for easy, premium for hard', avatarId: '7cda1b95d8174773ba1811931caba947' },
    { id: 'b3', kind: 'page', title: 'Proof point', narration: 'The calculator shows your savings. Most cut their bill in half.', caption: 'Most customers cut their bill in half', page: '/calculator' },
    { id: 'b4', kind: 'avatar', title: 'CTA', narration: 'And right now you can try Nadir free for one whole month. Go to getnadir.com.', caption: 'Try Nadir free for one month', avatarId: '0aca2839fb7949629b629fa22a3d9361' },
    { id: 'b5', kind: 'page', title: 'Closer', narration: 'One month free with code FIRST 1.', caption: 'getnadir.com', page: '/' },
  ];
}

// =========================================================================
// Social post generator
//
// Flow:
//   /api/analyze-url     -> fetch URL, ask Claude to extract brand/audience/value-props
//   /api/generate-posts  -> turn that analysis into one post per platform (text + SVG card)
//   /api/refine-post     -> rewrite a single post given user edit instructions
//
// All three Claude calls reuse the same path-detection ladder as
// /api/script: ANTHROPIC_API_KEY → claude CLI → static template fallback.
// =========================================================================
const URL_FETCH_TIMEOUT_MS = 20_000;
const URL_FETCH_MAX_BYTES = 2 * 1024 * 1024; // 2MB of HTML is plenty
const POST_TEXT_MAX = 2000;
const POST_HEADLINE_MAX = 120;
const POST_INSTRUCTION_MAX = 600;

async function fetchUrlAsText(url) {
  const ctrl = AbortSignal.timeout(URL_FETCH_TIMEOUT_MS);
  const r = await fetch(url, {
    signal: ctrl,
    redirect: 'follow',
    headers: {
      'user-agent': 'UGC-Studio/1.0 (+social post generator)',
      'accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (!/(text\/html|application\/xhtml|text\/plain)/i.test(ct)) {
    throw new Error(`unexpected content-type: ${ct || 'unknown'}`);
  }
  const ab = await r.arrayBuffer();
  if (ab.byteLength > URL_FETCH_MAX_BYTES) {
    throw new Error(`page too large (${ab.byteLength} bytes, max ${URL_FETCH_MAX_BYTES})`);
  }
  const html = Buffer.from(ab).toString('utf8');
  return { html, finalUrl: r.url || url };
}

// Strip scripts/styles/HTML to a plain-text representation suitable for
// Claude. We also pull out the <title> and <meta name="description">
// separately because they're high-signal even when the body text is
// rendered client-side (SPA shells).
function extractTextFromHtml(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const siteNameMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16_000); // cap roughly at 16k chars before sending to Claude
  return {
    title: (ogTitleMatch?.[1] || titleMatch?.[1] || '').trim().slice(0, 200),
    description: (descMatch?.[1] || '').trim().slice(0, 400),
    siteName: (siteNameMatch?.[1] || '').trim().slice(0, 80),
    body: stripped,
  };
}

const ANALYZE_SYSTEM = [
  'You are a senior content strategist analyzing a website to brief a social-post writer.',
  'Read the page, then output a tight JSON analysis covering brand, audience, voice, and the top value props.',
  'Be specific and quote concrete details from the page when relevant.',
  'No marketing fluff, no "imagine", no "revolutionary". Plain factual claims.',
].join('\n');

function buildAnalyzePrompt({ url, title, description, siteName, body }) {
  return [
    `URL: ${url}`,
    siteName && `SITE: ${siteName}`,
    title && `TITLE: ${title}`,
    description && `META DESCRIPTION: ${description}`,
    '',
    'PAGE CONTENT (HTML stripped):',
    body || '(no body text extracted)',
  ].filter(Boolean).join('\n');
}

const ANALYZE_TOOL = {
  name: 'submit_analysis',
  description: 'Submit a structured analysis of the website.',
  input_schema: {
    type: 'object',
    required: ['brand', 'audience', 'tone', 'summary', 'valueProps'],
    properties: {
      brand: { type: 'string', maxLength: 120, description: 'Brand or product name as it appears on the page.' },
      audience: { type: 'string', maxLength: 240, description: 'Who this is for, one sentence.' },
      tone: { type: 'string', maxLength: 200, description: 'Voice + register cues (formal, technical, playful, etc.).' },
      summary: { type: 'string', maxLength: 480, description: 'One-paragraph summary of what the product does.' },
      valueProps: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: { type: 'string', maxLength: 200 },
        description: 'The strongest claims / value props, ordered most-to-least impactful.',
      },
      callToAction: { type: 'string', maxLength: 120 },
    },
  },
};

async function callClaudeJson({ system, userMsg, tool, toolName, cliFallback }) {
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: toolName },
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${await r.text()}`);
    const json = await r.json();
    const toolUse = (json.content || []).find((b) => b.type === 'tool_use');
    if (!toolUse?.input) throw new Error('claude returned no tool call');
    return { result: toolUse.input, mode: 'llm-api', model: ANTHROPIC_MODEL };
  }
  if (USE_CLAUDE_CLI && claudeCliAvailable) {
    const prompt = cliFallback(userMsg);
    const { stdout } = await runWithStdin(
      'claude',
      ['-p', '--output-format', 'text', '--max-turns', '1', '--disallowedTools', '*'],
      prompt,
      { cwd: os.tmpdir() },
    );
    const cleaned = stdout.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}\s*$/m) || cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`claude CLI returned no JSON: ${stdout.slice(0, 400)}`);
    return { result: JSON.parse(match[0]), mode: 'llm-cli', model: 'claude-code-subscription' };
  }
  throw new Error('no LLM configured: set ANTHROPIC_API_KEY or install the claude CLI');
}

app.post('/api/analyze-url', async (req, res) => {
  let url;
  try {
    url = sanitizePostUrl(req.body?.url);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    const { html, finalUrl } = await fetchUrlAsText(url);
    const extracted = extractTextFromHtml(html);
    if (!process.env.ANTHROPIC_API_KEY && !(USE_CLAUDE_CLI && claudeCliAvailable)) {
      // Template fallback: synthesize a minimal analysis from the meta
      // tags we already extracted so the rest of the pipeline keeps working.
      return res.json({
        url: finalUrl,
        analysis: {
          brand: extracted.siteName || extracted.title.split(/[—\-|·]/)[0].trim() || 'Brand',
          audience: 'general audience',
          tone: 'neutral, informative',
          summary: extracted.description || extracted.title || 'No description available.',
          valueProps: extracted.description ? [extracted.description] : [extracted.title || 'Visit the site to learn more.'],
          callToAction: 'Learn more',
        },
        mode: 'template',
      });
    }
    const { result, mode, model } = await callClaudeJson({
      system: ANALYZE_SYSTEM,
      userMsg: buildAnalyzePrompt({ url: finalUrl, ...extracted }),
      tool: ANALYZE_TOOL,
      toolName: 'submit_analysis',
      cliFallback: (msg) => [
        ANALYZE_SYSTEM,
        '',
        msg,
        '',
        'Output ONLY a single JSON object, no prose, no markdown fences. Exact shape:',
        '{"brand":"...","audience":"...","tone":"...","summary":"...","valueProps":["...","..."],"callToAction":"..."}',
      ].join('\n'),
    });
    res.json({ url: finalUrl, analysis: result, mode, model });
  } catch (e) {
    console.error('[analyze-url] error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// SVG card generator. We keep it pure-JS (no dependency on rsvg/canvas)
// because SVG renders directly in the browser and downloads fine as .svg.
// Files are content-addressed by sha256(headline + brand + platform) so
// re-renders dedupe.
function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Wrap headline text into <=N lines of <=cols chars without breaking
// words mid-letter. Returns at most maxLines lines; the last is suffixed
// with an ellipsis if there's overflow.
function wrapHeadline(text, cols, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= cols) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (words.length && lines.length === maxLines) {
    // Mark visual overflow.
    const last = lines[lines.length - 1];
    if (last.length > cols - 1) {
      lines[lines.length - 1] = last.slice(0, cols - 1).trimEnd() + '…';
    } else {
      lines[lines.length - 1] = last + '…';
    }
  }
  return lines;
}

function renderPostCardSvg({ platform, headline, brand, valueProp }) {
  const spec = SOCIAL_PLATFORMS[platform];
  if (!spec) throw new Error(`unknown platform: ${platform}`);
  const { width, height, palette } = spec;

  // Headline sizing tuned per platform aspect / card area. We pick the
  // tightest reasonable column width that still keeps the text readable
  // at the card's native size.
  const isSquareish = Math.abs(width / height - 1) < 0.1;
  const cols = isSquareish ? 16 : 18;
  const maxLines = 4;
  const headLines = wrapHeadline(headline || '', cols, maxLines);
  const fontSize = headLines.length >= 4 ? 64 : headLines.length === 3 ? 76 : headLines.length === 2 ? 92 : 108;
  const lineHeight = fontSize * 1.12;
  const blockHeight = headLines.length * lineHeight;
  const headlineStartY = (height - blockHeight) / 2 + fontSize * 0.85;

  const brandLabel = (brand || '').slice(0, 40);
  const valuePropLabel = (valueProp || '').slice(0, 70);

  const tspans = headLines
    .map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(headline || '')}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bg1}"/>
      <stop offset="100%" stop-color="${palette.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="80" y="${height - 132}" width="60" height="4" fill="${palette.accent}" opacity="0.95"/>
  <text x="80" y="116" font-family="-apple-system, system-ui, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif" font-size="24" font-weight="600" letter-spacing="2" fill="${palette.text}" opacity="0.78">${escapeXml(spec.label.toUpperCase())}</text>
  <text font-family="-apple-system, system-ui, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="${palette.text}" letter-spacing="-1.5" y="${headlineStartY}">${tspans}</text>
  <text x="80" y="${height - 80}" font-family="-apple-system, system-ui, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="${palette.text}" opacity="0.95">${escapeXml(brandLabel)}</text>
  <text x="80" y="${height - 48}" font-family="-apple-system, system-ui, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif" font-size="20" font-weight="400" fill="${palette.text}" opacity="0.70">${escapeXml(valuePropLabel)}</text>
</svg>
`;
}

async function writePostCardSvg({ platform, headline, brand, valueProp }) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ platform, headline, brand, valueProp }))
    .digest('hex')
    .slice(0, 16);
  const filename = `_post-${platform}-${hash}.svg`;
  const out = path.join(VIDEO_DIR, filename);
  await mkdir(VIDEO_DIR, { recursive: true });
  if (!existsSync(out)) {
    await writeFile(out, renderPostCardSvg({ platform, headline, brand, valueProp }), 'utf8');
  }
  return `/videos/${filename}`;
}

const POSTS_TOOL = {
  name: 'submit_posts',
  description: 'Submit the per-platform social posts.',
  input_schema: {
    type: 'object',
    required: ['posts'],
    properties: {
      posts: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          required: ['platform', 'text', 'headline'],
          properties: {
            platform: { type: 'string', enum: Object.keys(SOCIAL_PLATFORMS) },
            text: { type: 'string', maxLength: 1500, description: 'The post body that gets pasted into the platform composer.' },
            headline: { type: 'string', maxLength: 120, description: 'Short headline used on the image card. 2-8 words.' },
            hashtags: {
              type: 'array',
              maxItems: 5,
              items: { type: 'string', maxLength: 40 },
            },
          },
        },
      },
    },
  },
};

const POSTS_SYSTEM = [
  'You are a senior social-media writer. Given a brand analysis, draft ONE post per requested platform.',
  'Each post must respect that platform\'s character limit, voice, and hashtag norm.',
  'Make every post stand on its own — no "as we said above", no cross-post references.',
  'Lead with a concrete hook. No filler. No "imagine", no "revolutionary", no "supercharge", no clickbait.',
  'The headline field is what appears on the image card (2-8 words). It should be a punchy version of the post idea, not a copy of the body.',
  'Output via the submit_posts tool only.',
].join('\n');

function buildPostsPrompt({ analysis, platforms, url, extraInstructions }) {
  const constraints = platforms.map((p) => {
    const s = SOCIAL_PLATFORMS[p];
    return [
      `${s.label} (platform key: "${p}")`,
      `  - max ${s.maxChars} characters in body`,
      `  - voice: ${s.voice}`,
      `  - hashtags: ${s.hashtagsHint}`,
    ].join('\n');
  }).join('\n');

  return [
    `Source URL: ${url}`,
    '',
    'BRAND ANALYSIS:',
    JSON.stringify(analysis, null, 2),
    '',
    'PLATFORMS + CONSTRAINTS:',
    constraints,
    '',
    extraInstructions ? `Additional user instructions: ${extraInstructions}` : '',
    '',
    'Draft one post per platform in the order listed above.',
  ].filter(Boolean).join('\n');
}

function sanitizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('analysis required');
  const clean = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const brand = clean(raw.brand, 120);
  if (!brand) throw new Error('analysis.brand required');
  return {
    brand,
    audience: clean(raw.audience, 240),
    tone: clean(raw.tone, 200),
    summary: clean(raw.summary, 480),
    valueProps: Array.isArray(raw.valueProps)
      ? raw.valueProps.filter((v) => typeof v === 'string').slice(0, 8).map((v) => v.slice(0, 200))
      : [],
    callToAction: clean(raw.callToAction, 120),
  };
}

function sanitizePost(raw, fallbackPlatform) {
  if (!raw || typeof raw !== 'object') throw new Error('post required');
  const platform = SOCIAL_PLATFORMS[raw.platform] ? raw.platform : (fallbackPlatform || null);
  if (!platform) throw new Error('post.platform invalid');
  const text = typeof raw.text === 'string' ? raw.text.slice(0, POST_TEXT_MAX) : '';
  const headline = typeof raw.headline === 'string' ? raw.headline.slice(0, POST_HEADLINE_MAX) : '';
  const hashtags = Array.isArray(raw.hashtags)
    ? raw.hashtags
        .filter((h) => typeof h === 'string')
        .slice(0, 5)
        .map((h) => h.replace(/^#?/, '').slice(0, 40))
        .filter(Boolean)
    : [];
  return { platform, text, headline, hashtags };
}

app.post('/api/generate-posts', async (req, res) => {
  let url;
  let analysis;
  let platforms;
  let extraInstructions = '';
  try {
    url = sanitizePostUrl(req.body?.url);
    analysis = sanitizeAnalysis(req.body?.analysis);
    platforms = sanitizePlatforms(req.body?.platforms);
    if (req.body?.extraInstructions) {
      extraInstructions = String(req.body.extraInstructions).slice(0, POST_INSTRUCTION_MAX);
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    let drafts;
    let mode = 'template';
    let model;
    if (process.env.ANTHROPIC_API_KEY || (USE_CLAUDE_CLI && claudeCliAvailable)) {
      const out = await callClaudeJson({
        system: POSTS_SYSTEM,
        userMsg: buildPostsPrompt({ analysis, platforms, url, extraInstructions }),
        tool: POSTS_TOOL,
        toolName: 'submit_posts',
        cliFallback: (msg) => [
          POSTS_SYSTEM,
          '',
          msg,
          '',
          'Output ONLY one JSON object, no prose, no markdown. Shape:',
          '{"posts":[{"platform":"linkedin|twitter|facebook","text":"...","headline":"...","hashtags":["..."]}]}',
        ].join('\n'),
      });
      drafts = Array.isArray(out.result?.posts) ? out.result.posts : [];
      mode = out.mode;
      model = out.model;
    } else {
      drafts = platforms.map((p) => templatePost(p, analysis));
    }

    // Make sure we have one post per requested platform; pad with template
    // fallbacks if Claude skipped any (cheap insurance).
    const byPlatform = new Map();
    for (const d of drafts) {
      const s = sanitizePost(d);
      if (platforms.includes(s.platform) && !byPlatform.has(s.platform)) {
        byPlatform.set(s.platform, s);
      }
    }
    for (const p of platforms) {
      if (!byPlatform.has(p)) byPlatform.set(p, sanitizePost(templatePost(p, analysis), p));
    }

    const posts = [];
    const valueProp = analysis.valueProps?.[0] || analysis.summary || '';
    let idx = 0;
    for (const p of platforms) {
      const draft = byPlatform.get(p);
      const imageUrl = await writePostCardSvg({
        platform: p,
        headline: draft.headline || draft.text.split(/[.\n]/)[0].slice(0, 60),
        brand: analysis.brand,
        valueProp,
      });
      posts.push({
        id: `${p}-${Date.now().toString(36)}-${idx++}`,
        platform: p,
        text: draft.text,
        headline: draft.headline,
        hashtags: draft.hashtags,
        imageUrl,
      });
    }
    res.json({ posts, mode, model, analysis });
  } catch (e) {
    console.error('[generate-posts] error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

function templatePost(platform, analysis) {
  const headline = (analysis.valueProps?.[0] || analysis.summary || analysis.brand || '').split(/[.\n]/)[0].trim().slice(0, 80) || analysis.brand;
  const cta = analysis.callToAction || 'Learn more';
  const longBody = [
    analysis.valueProps?.[0] || analysis.summary,
    analysis.valueProps?.[1] && `— ${analysis.valueProps[1]}`,
    `${cta}.`,
  ].filter(Boolean).join('\n\n');
  if (platform === 'twitter') {
    return {
      platform,
      headline,
      text: `${headline}.\n\n${analysis.valueProps?.[0] || ''}\n\n${cta}.`.slice(0, 270),
      hashtags: [],
    };
  }
  if (platform === 'facebook') {
    return { platform, headline, text: longBody.slice(0, 480), hashtags: [] };
  }
  return { platform, headline, text: longBody.slice(0, 1200), hashtags: [] };
}

app.post('/api/refine-post', async (req, res) => {
  let analysis;
  let post;
  let instructions;
  try {
    analysis = sanitizeAnalysis(req.body?.analysis);
    post = sanitizePost(req.body?.post);
    instructions = typeof req.body?.instructions === 'string'
      ? req.body.instructions.slice(0, POST_INSTRUCTION_MAX).trim()
      : '';
    if (!instructions) throw new Error('instructions required');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const spec = SOCIAL_PLATFORMS[post.platform];
    const userMsg = [
      'Rewrite the post below following the user instructions, keeping the same platform constraints.',
      '',
      `Platform: ${spec.label} (max ${spec.maxChars} chars; voice: ${spec.voice})`,
      '',
      'CURRENT POST:',
      JSON.stringify({ text: post.text, headline: post.headline, hashtags: post.hashtags }, null, 2),
      '',
      'BRAND ANALYSIS:',
      JSON.stringify(analysis, null, 2),
      '',
      `USER INSTRUCTIONS: ${instructions}`,
    ].join('\n');

    let updated;
    let mode = 'template';
    let model;
    if (process.env.ANTHROPIC_API_KEY || (USE_CLAUDE_CLI && claudeCliAvailable)) {
      const out = await callClaudeJson({
        system: POSTS_SYSTEM,
        userMsg,
        tool: POSTS_TOOL,
        toolName: 'submit_posts',
        cliFallback: (msg) => [
          POSTS_SYSTEM,
          '',
          msg,
          '',
          'Output ONLY one JSON object, shape: {"posts":[{"platform":"...","text":"...","headline":"...","hashtags":["..."]}]}',
        ].join('\n'),
      });
      const drafts = Array.isArray(out.result?.posts) ? out.result.posts : [];
      updated = sanitizePost(drafts[0] || {}, post.platform);
      mode = out.mode;
      model = out.model;
    } else {
      // No LLM: at least echo the instructions as appended copy so the
      // user sees something change.
      updated = {
        platform: post.platform,
        text: `${post.text}\n\n(note: ${instructions.slice(0, 200)})`.slice(0, POST_TEXT_MAX),
        headline: post.headline,
        hashtags: post.hashtags,
      };
    }

    const valueProp = analysis.valueProps?.[0] || analysis.summary || '';
    const imageUrl = await writePostCardSvg({
      platform: updated.platform,
      headline: updated.headline || updated.text.split(/[.\n]/)[0].slice(0, 60),
      brand: analysis.brand,
      valueProp,
    });

    res.json({
      post: { ...updated, id: post.id || `${updated.platform}-${Date.now().toString(36)}`, imageUrl },
      mode,
      model,
    });
  } catch (e) {
    console.error('[refine-post] error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// =========================================================================
// /api/render-scene - render a single scene
// Now: input-sanitized, content-addressed (idempotent), captioned.
// =========================================================================
app.post('/api/render-scene', async (req, res) => {
  let beat;
  try {
    beat = sanitizeBeat(req.body);
    if (!beat.narration) throw new Error('beat.narration required');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const beatHash = hashBeat(beat);
  const slug = `ugc-${beat.id}-${beatHash}`;
  const sceneOut = path.join(VIDEO_DIR, `scenes-${slug}.mp4`);
  await mkdir(VIDEO_DIR, { recursive: true });

  // Cache hit -> instant return, no HeyGen credit burned.
  const cached = await cacheLookup(beatHash);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    let result;
    if (beat.kind === 'avatar') {
      result = await renderAvatarBeat(beat, slug, sceneOut);
    } else {
      result = await renderPageBeat(beat, slug, sceneOut);
    }
    sceneCache[beatHash] = result;
    saveCache();
    res.json({ ...result, cached: false });
  } catch (e) {
    console.error('[render-scene] error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

async function renderAvatarBeat(beat, slug, sceneOut) {
  const reqBody = {
    type: 'avatar',
    avatar_id: beat.avatarId || process.env.HEYGEN_AVATAR_ID,
    script: beat.narration,
    voice_id: beat.voiceId || process.env.HEYGEN_VOICE_ID || '154e13cce06c4452ba3b9865dcdf1434',
    aspect_ratio: '9:16',
  };
  const { stdout } = await runWithStdin(
    'heygen',
    ['video', 'create', '-d', '-', '--wait'],
    JSON.stringify(reqBody),
  );
  const result = JSON.parse(stdout);
  const videoUrl = result?.data?.video_url;
  if (!videoUrl) throw new Error(`heygen returned no video_url: ${stdout}`);
  const r = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(sceneOut, buf);

  // Crop landscape avatar to vertical full-bleed AND burn captions in
  // the same ffmpeg pass.
  const cropped = path.join(VIDEO_DIR, `scenes-${slug}-1080x1920.mp4`);
  const captionVf = captionFilter(beat.caption);
  const vf = [
    'scale=1080:1920:force_original_aspect_ratio=increase',
    'crop=1080:1920',
    'setsar=1',
    captionVf,
  ].filter(Boolean).join(',');
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', sceneOut,
    '-vf', vf,
    '-r', '30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart',
    cropped,
  ]);
  await thumb(cropped, sceneOut.replace('.mp4', '.jpg'));
  const dur = await probeMs(cropped);
  return {
    videoUrl: `/videos/${path.basename(cropped)}`,
    thumbnailUrl: `/videos/${path.basename(sceneOut).replace('.mp4', '.jpg')}`,
    durationMs: dur,
  };
}

async function renderPageBeat(beat, slug, sceneOut) {
  const scriptPath = path.join(VIDEO_DIR, `_${slug}.script.json`);
  await writeFile(scriptPath, JSON.stringify({
    slug,
    title: beat.title,
    viewport: { width: 1080, height: 1920 },
    auth: 'anonymous',
    beats: [{
      kind: 'page',
      page: beat.page || '/',
      caption: beat.caption,
      tailMs: 4000,
      actions: [
        { kind: 'wait', selector: 'body', timeoutMs: 15000 },
        { kind: 'cursorMove', x: 540, y: 400, durationMs: 800 },
        { kind: 'scroll', direction: 'down', pixels: 500, durationMs: 1500 },
      ],
    }],
  }, null, 2));
  // Recorder has a known race between Playwright's webm flush and the
  // internal ffmpegTrim that occasionally picks a partial webm and fails
  // mid-encode. Retry once on failure — the fix is upstream in record.mjs
  // (sort webmFiles by mtime, wait for size-stable webm) but a single
  // retry recovers nearly all transient failures in practice.
  await runRecorderWithRetry(scriptPath);
  const recorded = path.join(VIDEO_DIR, `${slug}.mp4`);

  // Mux Brianna voice via heygen voice speech create (optional).
  let baseVideo = recorded;
  if (beat.narration && process.env.HEYGEN_API_KEY) {
    try {
      const wav = path.join(VIDEO_DIR, `_${slug}.wav`);
      const { stdout } = await run('heygen', [
        'voice', 'speech', 'create',
        '--text', beat.narration,
        '--voice-id', beat.voiceId || process.env.HEYGEN_VOICE_ID || '154e13cce06c4452ba3b9865dcdf1434',
      ]);
      const url = JSON.parse(stdout)?.data?.audio_url;
      if (url) {
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        await writeFile(wav, Buffer.from(await r.arrayBuffer()));
        const muxed = path.join(VIDEO_DIR, `_voiced-${slug}.mp4`);
        const videoDur = await probeMs(recorded);
        await run('ffmpeg', [
          '-y', '-loglevel', 'error',
          '-i', recorded,
          '-i', wav,
          '-filter_complex', `[1:a]apad=whole_dur=${videoDur / 1000}[a]`,
          '-map', '0:v', '-map', '[a]',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
          '-movflags', '+faststart',
          muxed,
        ]);
        baseVideo = muxed;
      }
    } catch (audioErr) {
      console.warn('[page beat] audio mux failed, using silent video:', audioErr.message);
    }
  }

  // If narration mux was skipped (no HEYGEN_API_KEY, mux failed, or no
  // narration on this beat), baseVideo lacks an audio stream. The
  // caption-burn pass below would inherit that, producing a video-only
  // mp4 — and downstream concat filters that ask for `:a` streams would
  // then fail with "matches no streams". Pre-pad with silent audio so
  // every page-beat scene matches the avatar branch's invariant: 1 video
  // stream + 1 audio stream.
  const baseWithAudio = await ensureAudio(baseVideo);

  // Burn captions in a final pass so both branches converge on the same
  // (1080x1920, 30fps, captioned, AAC audio) shape that /api/concat and
  // /api/merge expect.
  const captionVf = captionFilter(beat.caption);
  const captioned = sceneOut;
  const filterArgs = captionVf ? ['-vf', captionVf] : [];
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', baseWithAudio,
    ...filterArgs,
    '-r', '30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart',
    captioned,
  ]);
  await thumb(captioned, captioned.replace('.mp4', '.jpg'));
  const dur = await probeMs(captioned);
  return {
    videoUrl: `/videos/${path.basename(captioned)}`,
    thumbnailUrl: `/videos/${path.basename(captioned).replace('.mp4', '.jpg')}`,
    durationMs: dur,
  };
}

async function runRecorderWithRetry(scriptPath) {
  const args = ['--env-file=.env', 'scripts/record.mjs', '--script', scriptPath, '--no-narrate'];
  try {
    await run('node', args, { tee: true });
  } catch (e) {
    const msg = String(e?.message || e);
    // Only retry on patterns that historically self-heal: ffmpeg trim
    // mid-encode failure (Playwright webm not flushed) and "no webm"
    // races. Real auth/network errors should fail fast.
    const transient = /ffmpeg trim|no webm produced/i.test(msg);
    if (!transient) throw e;
    console.warn('[render-scene] recorder failed transiently, retrying once:', msg.slice(0, 200));
    await new Promise((r) => setTimeout(r, 1500));
    await run('node', args, { tee: true });
  }
}

function runWithStdin(cmd, args, stdin, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: RECORDER_DIR, ...opts });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (d) => (stdout += d));
    p.stderr?.on('data', (d) => (stderr += d));
    p.on('exit', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exit ${code}: ${stderr}`))));
    p.on('error', reject);
    if (stdin != null) {
      p.stdin.write(stdin);
      p.stdin.end();
    }
  });
}

async function thumb(videoPath, jpgPath) {
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', '0.8',
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '4',
    jpgPath,
  ]);
}

// =========================================================================
// /api/concat - assemble scenes into final ad
// =========================================================================
app.post('/api/concat', async (req, res) => {
  const { scenes } = req.body || {};
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: 'scenes required' });
  }
  if (scenes.length > 32) return res.status(400).json({ error: 'too many scenes' });

  try {
    // Resolve URLs back to absolute paths (URLs look like /videos/foo.mp4).
    // Reject anything not produced by us — basename + must exist in VIDEO_DIR.
    const inputs = scenes.map((u) => {
      if (typeof u !== 'string') throw new Error('scene must be string');
      const file = u.startsWith('/videos/') ? u.slice('/videos/'.length) : path.basename(u);
      if (file.includes('/') || file.includes('..')) throw new Error(`invalid scene path: ${u}`);
      const abs = path.join(VIDEO_DIR, file);
      if (path.dirname(abs) !== VIDEO_DIR) throw new Error(`scene escapes video dir: ${u}`);
      return abs;
    });
    for (const f of inputs) {
      if (!existsSync(f)) throw new Error(`scene file missing: ${path.basename(f)}`);
    }
    // Normalize every input so they all carry an audio stream. The
    // concat filter below asks for `[i:v][i:a]` from each input; one
    // silent input crashes the whole pipeline. ensureAudio is a no-op
    // when audio is already present, so this is cheap on the happy path.
    const normalizedInputs = await Promise.all(inputs.map((p) => ensureAudio(p)));

    const outName = `final-${Date.now()}.mp4`;
    const outPath = path.join(VIDEO_DIR, outName);
    const args = ['-y', '-loglevel', 'error'];
    for (const f of normalizedInputs) args.push('-i', f);
    const filter =
      normalizedInputs.map((_, i) => `[${i}:v][${i}:a]`).join('') +
      `concat=n=${normalizedInputs.length}:v=1:a=1[v][a]`;
    args.push(
      '-filter_complex', filter,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
      '-movflags', '+faststart',
      outPath,
    );
    await run('ffmpeg', args);

    const dur = await probeMs(outPath);
    const st = await stat(outPath);
    res.json({
      videoUrl: `/videos/${outName}`,
      durationMs: dur,
      sizeBytes: st.size,
    });
  } catch (e) {
    console.error('[concat] error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// =========================================================================
// /api/merge - multi-modal stitching: concat videos, then optionally
// overlay an image, then optionally replace the audio track.
//
// Accepts:
//   videos: string[]   /videos/* URLs (1+); if >1 they're concat'd first
//   image?: string     /videos/* URL of an image asset; overlaid bottom-right
//   audio?: string     /videos/* URL of an audio asset; replaces video audio,
//                      padded with silence and truncated to video length
//
// All paths are sandboxed under VIDEO_DIR via dirname assertion. The
// pipeline runs as a sequence of three ffmpeg passes (concat / overlay /
// audio) — chosen for clarity and intermediate-file inspection over a
// single mega-filtergraph. Intermediates are cleaned up on success.
// =========================================================================
function resolveInVideoDir(u, label) {
  if (typeof u !== 'string') throw new Error(`${label} must be string`);
  const file = u.startsWith('/videos/') ? u.slice('/videos/'.length) : path.basename(u);
  if (file.includes('/') || file.includes('..')) throw new Error(`invalid ${label} path: ${u}`);
  const abs = path.join(VIDEO_DIR, file);
  if (path.dirname(abs) !== VIDEO_DIR) throw new Error(`${label} escapes video dir: ${u}`);
  if (!existsSync(abs)) throw new Error(`${label} missing: ${path.basename(abs)}`);
  return abs;
}

// Maps OverlayPosition codes to ffmpeg overlay filter coordinates.
// The overlay scales to imageScale * video_width (W) before placement,
// so x/y use the overlay's actual dimensions (w/h) referenced via overlay.
const OVERLAY_POSITION = {
  tl: 'x=32:y=32',
  tr: 'x=W-w-32:y=32',
  bl: 'x=32:y=H-h-32',
  br: 'x=W-w-32:y=H-h-32',
  center: 'x=(W-w)/2:y=(H-h)/2',
};

app.post('/api/merge', async (req, res) => {
  const {
    videos,
    image,
    audio,
    audioMode = 'replace',
    imagePosition = 'br',
    imageScale = 0.22,
  } = req.body || {};
  if (!Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'videos[] required (1+)' });
  }
  if (videos.length > 32) return res.status(400).json({ error: 'too many videos (max 32)' });
  if (audioMode !== 'replace' && audioMode !== 'mix') {
    return res.status(400).json({ error: `audioMode must be replace|mix, got '${audioMode}'` });
  }
  if (!OVERLAY_POSITION[imagePosition]) {
    return res.status(400).json({ error: `imagePosition must be tl|tr|bl|br|center, got '${imagePosition}'` });
  }
  const scale = Math.max(0.05, Math.min(1, Number(imageScale) || 0.22));

  const intermediates = [];
  try {
    const rawVideoPaths = videos.map((v) => resolveInVideoDir(v, 'video'));
    // Normalize each input so it carries an audio stream. Without this,
    // a user-uploaded silent mp4 (or a page-beat scene rendered before
    // the audio-padding fix landed) crashes the concat filter with
    // "Stream specifier ':a' matches no streams". ensureAudio is a
    // no-op when audio is already present.
    const videoPaths = await Promise.all(rawVideoPaths.map((p) => ensureAudio(p)));
    const imagePath = image ? resolveInVideoDir(image, 'image') : null;
    const audioPath = audio ? resolveInVideoDir(audio, 'audio') : null;

    const outName = `merge-${Date.now()}.mp4`;
    const outPath = path.join(VIDEO_DIR, outName);

    // Pass 1: concat (or pass-through for a single video)
    let staged;
    if (videoPaths.length === 1) {
      staged = videoPaths[0];
    } else {
      staged = path.join(VIDEO_DIR, `_merge-staged-${Date.now()}.mp4`);
      intermediates.push(staged);
      const args = ['-y', '-loglevel', 'error'];
      for (const f of videoPaths) args.push('-i', f);
      const filter =
        videoPaths.map((_, i) => `[${i}:v][${i}:a]`).join('') +
        `concat=n=${videoPaths.length}:v=1:a=1[v][a]`;
      args.push(
        '-filter_complex', filter,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
        '-movflags', '+faststart',
        staged,
      );
      await run('ffmpeg', args);
    }

    // Pass 2: image overlay at configured position + scale.
    // Overlay width = scale * video_width (W); height kept by aspect (-1).
    let withOverlay = staged;
    if (imagePath) {
      withOverlay = path.join(VIDEO_DIR, `_merge-overlay-${Date.now()}.mp4`);
      intermediates.push(withOverlay);
      const scaleExpr = `scale=iw*${scale}:-1`; // applied to the image stream [1:v]
      // Note: ffmpeg's overlay filter understands main_w/W and main_h/H
      // for the base video, w/h for the overlaid image — so the position
      // formula works directly without knowing the runtime dimensions.
      await run('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', staged,
        '-i', imagePath,
        '-filter_complex',
        `[1:v]${scaleExpr}[ov];[0:v][ov]overlay=${OVERLAY_POSITION[imagePosition]}[v]`,
        '-map', '[v]', '-map', '0:a?',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        withOverlay,
      ]);
    }

    // Pass 3: audio. `replace` swaps the asset over the original (default
    // since a fresh narration over silent screen capture is the common
    // case). `mix` blends both with amix and truncates to longest, so a
    // shorter background bed loops out via dropout transition.
    if (audioPath) {
      const filter = audioMode === 'mix'
        ? '[1:a]aresample=48000[a1];[0:a][a1]amix=inputs=2:duration=longest:dropout_transition=0[aout]'
        : '[1:a]aresample=48000,apad[aout]';
      const args = [
        '-y', '-loglevel', 'error',
        '-i', withOverlay,
        '-i', audioPath,
        '-filter_complex', filter,
        '-map', '0:v', '-map', '[aout]',
      ];
      // -shortest is right for replace (truncate audio padding), but for
      // mix we want the natural duration so it isn't cut early.
      if (audioMode === 'replace') args.push('-shortest');
      args.push(
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
        '-movflags', '+faststart',
        outPath,
      );
      await run('ffmpeg', args);
    } else if (withOverlay !== staged) {
      // Image overlay produced our final output already.
      await rm(outPath, { force: true });
      // Move overlay file into final name (single rename — keeps disk usage flat).
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', withOverlay, '-c', 'copy', '-movflags', '+faststart', outPath]);
    } else {
      // Concat-only path: copy staged → final.
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', staged, '-c', 'copy', '-movflags', '+faststart', outPath]);
    }

    // Cleanup intermediates (but never the original inputs).
    for (const f of intermediates) await rm(f, { force: true });

    const dur = await probeMs(outPath);
    const st = await stat(outPath);
    res.json({
      videoUrl: `/videos/${outName}`,
      durationMs: dur,
      sizeBytes: st.size,
      mode: [
        videoPaths.length > 1 ? 'concat' : 'single',
        imagePath && `image-overlay@${imagePosition}/${(scale * 100).toFixed(0)}%`,
        audioPath && `audio-${audioMode}`,
      ]
        .filter(Boolean)
        .join('+'),
    });
  } catch (e) {
    console.error('[merge] error:', e);
    // Best-effort cleanup of intermediates on failure too.
    for (const f of intermediates) await rm(f, { force: true }).catch(() => {});
    res.status(500).json({ error: String(e.message || e) });
  }
});

// =========================================================================
// /api/health - real preflight. Probes each external dependency the
// pipeline relies on and returns a per-check status the UI can render.
// =========================================================================
app.get('/api/health', async (_req, res) => {
  const checks = await Promise.all([
    probeBinary('ffmpeg', ['-version']),
    probeBinary('ffprobe', ['-version']),
    probeBinary('python3', ['--version']),
    probeBinary('heygen', ['--version']),
    probeBinary('claude', ['--version'], { required: false, hint: 'enables LLM script gen via your Claude Code subscription' }),
    probeFfmpegFilter('drawtext', 'captions burned into video — fix: brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype'),
    probeRecorderDir(),
    probeEnv('HEYGEN_API_KEY', { required: false, hint: 'avatar renders need this' }),
    probeEnv('POSTHOG_PROJECT_API_KEY', { required: false, hint: 'unset = stub mode' }),
    probeEnv('ANTHROPIC_API_KEY', { required: false, hint: 'unset is fine if claude CLI is installed' }),
  ]);
  // Recompute claudeCliAvailable from the live probe so the UI badge reflects
  // current state even if the CLI was installed after server boot.
  const claudeCheck = checks.find((c) => c.name === 'claude');
  claudeCliAvailable = !!claudeCheck?.ok;
  const scriptMode = process.env.ANTHROPIC_API_KEY
    ? 'llm-api'
    : (USE_CLAUDE_CLI && claudeCliAvailable)
      ? 'llm-cli'
      : 'template';
  const ok = checks.every((c) => c.ok || !c.required);
  res.json({
    ok,
    recorderDir: RECORDER_DIR,
    videoDir: VIDEO_DIR,
    model: ANTHROPIC_MODEL,
    authEnabled: !!AUTH_TOKEN,
    scriptMode,
    checks,
  });
});

// Probe whether a specific ffmpeg filter is available in the running build.
// Used for `drawtext` because Homebrew's default formula omits libfreetype
// and we want to surface a clear fix rather than fail mid-render.
async function probeFfmpegFilter(filterName, hint) {
  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-filters'], { cwd: os.tmpdir() });
    const ok = new RegExp(`\\b${filterName}\\b`).test(stdout);
    if (filterName === 'drawtext') hasDrawtext = ok;
    return {
      name: `ffmpeg:${filterName}`,
      kind: 'feature',
      ok,
      required: false,
      hint,
      error: ok ? undefined : `${filterName} filter not in this ffmpeg build`,
    };
  } catch (e) {
    return { name: `ffmpeg:${filterName}`, kind: 'feature', ok: false, required: false, hint, error: e.message };
  }
}

async function probeBinary(name, args, opts = {}) {
  const { required = true, hint } = opts;
  try {
    await run(name, args, { cwd: os.tmpdir() });
    return { name, kind: 'binary', ok: true, required, hint };
  } catch (e) {
    return { name, kind: 'binary', ok: false, required, hint, error: 'not found on PATH' };
  }
}
async function probeRecorderDir() {
  const recordScript = path.join(RECORDER_DIR, 'scripts', 'record.mjs');
  const ok = existsSync(recordScript);
  return {
    name: 'RECORDER_DIR',
    kind: 'path',
    ok,
    required: true,
    path: RECORDER_DIR,
    error: ok ? undefined : `scripts/record.mjs not found at ${recordScript}`,
  };
}
function probeEnv(name, { required, hint }) {
  const present = !!process.env[name];
  return { name, kind: 'env', ok: present, required, hint };
}

// =========================================================================
// Boot
// =========================================================================
await loadCache();
// Probe `claude` once at boot so /api/script doesn't pay the discovery cost
// on first request. /api/health re-probes live so the badge stays honest.
if (USE_CLAUDE_CLI) {
  try {
    await run('claude', ['--version'], { cwd: os.tmpdir() });
    claudeCliAvailable = true;
  } catch {
    claudeCliAvailable = false;
  }
}
try {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-filters'], { cwd: os.tmpdir() });
  hasDrawtext = /\bdrawtext\b/.test(stdout);
} catch {
  hasDrawtext = false;
}
app.listen(PORT, () => {
  const scriptMode = process.env.ANTHROPIC_API_KEY
    ? `LLM via API key (${ANTHROPIC_MODEL})`
    : (USE_CLAUDE_CLI && claudeCliAvailable)
      ? 'LLM via `claude` CLI (subscription auth)'
      : 'template fallback (set ANTHROPIC_API_KEY or install `claude` CLI)';
  console.log(`UGC server: http://localhost:${PORT}`);
  console.log(`  recorder dir: ${RECORDER_DIR}`);
  console.log(`  videos dir:   ${VIDEO_DIR}`);
  console.log(`  auth:         ${AUTH_TOKEN ? 'bearer token required' : 'open (no UGC_AUTH_TOKEN)'}`);
  console.log(`  script mode:  ${scriptMode}`);
  console.log(`  captions:     ${hasDrawtext ? 'enabled (ffmpeg drawtext OK)' : 'DISABLED — ffmpeg lacks drawtext filter'}`);
  if (!hasDrawtext) {
    console.log('                fix: brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype');
  }
});
