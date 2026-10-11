// ─────────────────────────────────────────────────────────────────────────────
// HookForge AI — Vercel image endpoint (REFERENCE COPY — deploy this yourself)
//
// This file is NOT part of the Base44 app bundle. It lives outside `src/` and is
// never imported by the app. Copy it into your Vercel project at:
//
//     hookforge-ai-backend-x4ea  →  api/generate-image.js
//
// and redeploy. Your existing `api/generate` (OpenRouter text) is NOT touched.
//
// Required Vercel environment variable
// (Project → Settings → Environment Variables → Production/Preview/Development):
//
//     POLLINATIONS_API_KEY = sk_…   ← secret key from https://enter.pollinations.ai/keys
//
// Keep it separate from OPENROUTER_API_KEY. Never put either key in Base44,
// the frontend, or GitHub.
//
// Provider API verified against the current Pollinations docs
// (https://gen.pollinations.ai/docs):
//   Base URL ........ https://gen.pollinations.ai
//   Image endpoint .. GET /image/{prompt}?model=…
//   Auth ............ Authorization: Bearer <POLLINATIONS_API_KEY>
//
// Contract expected by the Base44 `generateImage` function:
//   success → { success: true, image_base64, content_type, width, height, model }
//   failure → { success: false, code, error }   (non-2xx)
//
// NOTE ON SIGNATURE: this uses the classic Vercel Node handler `(req, res)`.
// If your project already uses the Web `Request`/`Response` signature, adapt
// the top and bottom of this file accordingly — the provider call is identical.
// ─────────────────────────────────────────────────────────────────────────────

const POLLINATIONS_IMAGE_HOST = 'https://gen.pollinations.ai/image';
const PROVIDER_TIMEOUT_MS = 60000;
const MAX_PROMPT_LENGTH = 1200;

// Only models verified as available on the current catalog.
const ALLOWED_MODELS = ['flux'];

// Server-enforced output sizes (never trust dimensions from the client).
const ALLOWED_DIMENSIONS = {
  '16:9': { width: 1280, height: 720 },
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 720, height: 1280 },
};

function parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, code: 'bad_request', error: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    // Do NOT reveal whether the key exists — just report the service is down.
    res.status(503).json({ success: false, code: 'not_configured', error: 'Image service is not configured.' });
    return;
  }

  const body = parseBody(req.body);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const model = ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0];
  const aspectRatio = ALLOWED_DIMENSIONS[body.aspectRatio] ? body.aspectRatio : '16:9';
  const { width, height } = ALLOWED_DIMENSIONS[aspectRatio];

  if (!prompt) {
    res.status(400).json({ success: false, code: 'bad_request', error: 'A prompt is required.' });
    return;
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    res.status(400).json({ success: false, code: 'bad_request', error: 'Prompt is too long.' });
    return;
  }

  const params = new URLSearchParams({
    model,
    width: String(width),
    height: String(height),
  });
  const imageUrl = `${POLLINATIONS_IMAGE_HOST}/${encodeURIComponent(prompt)}?${params.toString()}`;

  try {
    const upstream = await fetch(imageUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      // Log the status only — never the key or the full upstream body.
      console.error('[generate-image] Pollinations error', upstream.status);
      let code = 'upstream';
      if (upstream.status === 429) code = 'rate_limited';
      else if (upstream.status === 401 || upstream.status === 403) code = 'auth';
      const error = code === 'rate_limited'
        ? 'The image service is rate-limited. Please try again shortly.'
        : code === 'auth'
          ? 'The image service rejected the credentials.'
          : 'The image service is unavailable right now.';
      res.status(502).json({ success: false, code, error });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length) {
      res.status(502).json({ success: false, code: 'upstream', error: 'The provider returned an empty image.' });
      return;
    }

    res.status(200).json({
      success: true,
      image_base64: buffer.toString('base64'),
      content_type: contentType,
      width,
      height,
      model,
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.error('[generate-image] fetch failed', timedOut ? 'timeout' : (err && err.name));
    res.status(timedOut ? 504 : 502).json({
      success: false,
      code: timedOut ? 'timeout' : 'upstream',
      error: timedOut
        ? 'The image service timed out. Please try again.'
        : 'The image service is unavailable right now.',
    });
  }
}
