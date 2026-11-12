
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const TIMEOUT_MS = 30000;
const MAX_KEYS = 6;

let cursor = 0;

function getKeys() {
  return Array.from({ length: MAX_KEYS }, (_, i) =>
    process.env[`GROQ_API_KEY_${i + 1}`]
  ).filter(key => typeof key === "string" && key.trim());
}

function getErrorMessage(data, fallback) {
  return data?.error?.message || fallback;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};
    const prompt = body.prompt;

    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: "A valid prompt is required."
      });
    }

    if (prompt.length > 20000) {
      return res.status(400).json({
        success: false,
        error: "Prompt too long."
      });
    }

    const keys = getKeys();

    if (!keys.length) {
      return res.status(503).json({
        success: false,
        error: "No Groq API keys are configured."
      });
    }

    const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

    // Start from the next key for each request handled by this instance.
    const startIndex = cursor % keys.length;
    cursor = (startIndex + 1) % keys.length;

    let lastStatus = 503;
    let lastError = "All configured Groq keys failed.";

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const keyIndex = (startIndex + attempt) % keys.length;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        TIMEOUT_MS
      );

      try {
        const response = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keys[keyIndex]}`
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.8,
            max_tokens: 1000
          }),
          signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          const text = data?.choices?.[0]?.message?.content || "";

          if (!text.trim()) {
            lastStatus = 502;
            lastError = "Groq returned an empty response.";
            continue;
          }

          return res.status(200).json({
            success: true,
            text,
            tool: body.tool || null,
            model: data.model || model,
            provider: "groq",
            keySlot: keyIndex + 1
          });
        }

        lastStatus = response.status;
        lastError = getErrorMessage(data, "Groq request failed.");

        // These errors may be specific to one key.
        // Try another configured key.
        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          continue;
        }

        // Other 4xx errors are usually request/configuration errors.
        break;

      } catch (error) {
        lastStatus = error.name === "AbortError" ? 504 : 502;
        lastError = error.name === "AbortError"
          ? "Groq request timed out."
          : "Temporary network error.";
      } finally {
        clearTimeout(timeout);
      }
    }

    return res.status(lastStatus).json({
      success: false,
      error: lastError,
      provider: "groq",
      keysTried: keys.length
    });

  } catch (error) {
    console.error("Groq backend error:", error.name);

    return res.status(500).json({
      success: false,
      error: "Internal server error."
    });
  }
}
