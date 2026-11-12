
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const TIMEOUT = 30000;
const MAX_ATTEMPTS = 3;

let cursor = 0;

function getKeys() {
  return Array.from({ length: 5 }, (_, i) =>
    process.env[`GROQ_API_KEY_${i + 1}`]
  ).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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
        error: "Groq is not configured."
      });
    }

    const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
    const start = cursor % keys.length;
    let lastError = "Groq unavailable";
    let lastStatus = 502;

    for (
      let attempt = 0;
      attempt < Math.min(keys.length, MAX_ATTEMPTS);
      attempt++
    ) {
      const index = (start + attempt) % keys.length;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        TIMEOUT
      );

      try {
        const response = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keys[index]}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "user", content: prompt }
            ],
            temperature: 0.8
          }),
          signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          const text =
            data?.choices?.[0]?.message?.content || "";

          if (!text) {
            return res.status(502).json({
              success: false,
              error: "Empty AI response."
            });
          }

          cursor = (index + 1) % keys.length;

          return res.status(200).json({
            success: true,
            text,
            tool: body.tool || null,
            model: data.model || model,
            provider: "groq"
          });
        }

        lastStatus = response.status;
        lastError = data?.error?.message || "Groq request failed";

        // Do not retry invalid credentials or bad requests.
        if (
          response.status === 400 ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404
        ) {
          break;
        }

        // Retry only rate limits and temporary server errors.
        if (response.status !== 429 && response.status < 500) {
          break;
        }

      } catch (error) {
        lastStatus = error.name === "AbortError" ? 504 : 502;
        lastError = "Temporary network or timeout error.";
      } finally {
        clearTimeout(timeout);
      }
    }

    return res.status(lastStatus).json({
      success: false,
      error: lastStatus === 429
        ? "Groq rate limit reached."
        : lastStatus >= 500
          ? "Groq temporarily unavailable."
          : lastError
    });

  } catch (error) {
    console.error("Groq backend error:", error.name);

    return res.status(500).json({
      success: false,
      error: "Internal server error."
    });
  }
}
