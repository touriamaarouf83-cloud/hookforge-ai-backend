
const PROVIDERS = [
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    getKeys: () =>
      Array.from({ length: 6 }, (_, i) =>
        process.env[`GROQ_API_KEY_${i + 1}`]
      ).filter(k => typeof k === "string" && k.trim()),
    getModel: () =>
      process.env.GROQ_MODEL || "openai/gpt-oss-20b"
  },
  {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    getKeys: () => [
      process.env.OPENROUTER_API_KEY,
      process.env.OPENROUTER_API_KEY_2,
      process.env.OPENROUTER_API_KEY_3,
      process.env.OPENROUTER_API_KEY_4
    ].filter(k => typeof k === "string" && k.trim()),
    getModel: () =>
      process.env.OPENROUTER_MODEL || "openrouter/free"
  }
];

const TIMEOUT_MS = 25000;
const MAX_PROMPT_LENGTH = 20000;

function parseBody(req) {
  if (!req.body) return {};

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return content
      .map(item => typeof item?.text === "string" ? item.text : "")
      .join("")
      .trim();
  }

  return "";
}

async function callProvider(provider, prompt) {
  const keys = provider.getKeys();

  if (!keys.length) {
    return { success: false, reason: "no_keys" };
  }

  const model = provider.getModel();

  for (let i = 0; i < keys.length; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

    try {
      const isGroq = provider.name === "groq";

      const payload = {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: isGroq ? 0.6 : 0.7,
        ...(isGroq
          ? {
              max_completion_tokens: 1200,
              reasoning_effort: "low",
              include_reasoning: false
            }
          : {
              max_tokens: 1200
            })
      };

      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keys[i]}`
      };

      if (!isGroq) {
        headers["HTTP-Referer"] =
          process.env.OPENROUTER_SITE_URL ||
          "https://hook-forge-prime.base44.app";

        headers["X-Title"] = "HookForge AI";
      }

      const response = await fetch(provider.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        // Authentication failure: try another configured key.
        continue;
      }

      if (!response.ok) {
        console.error("[AI Router] Provider response:", {
          provider: provider.name,
          status: response.status
        });

        // Do not rotate keys for shared rate limits,
        // billing problems, model errors or server failures.
        return {
          success: false,
          reason: "provider_error",
          status: response.status
        };
      }

      const text = extractText(data);

      if (!text) {
        console.error("[AI Router] Empty response:", {
          provider: provider.name,
          model
        });

        return {
          success: false,
          reason: "empty_response",
          status: 502
        };
      }

      return {
        success: true,
        text,
        provider: provider.name,
        model: data?.model || model
      };

    } catch (error) {
      console.error("[AI Router] Request failed:", {
        provider: provider.name,
        type: error?.name || "unknown"
      });

      return {
        success: false,
        reason: error?.name === "AbortError"
          ? "timeout"
          : "network_error",
        status: error?.name === "AbortError" ? 504 : 502
      };

    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    success: false,
    reason: "all_keys_rejected",
    status: 503
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const body = parseBody(req);
  const prompt = body.prompt;

  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({
      success: false,
      error: "A valid prompt is required."
    });
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      success: false,
      error: "Prompt is too long."
    });
  }

  for (const provider of PROVIDERS) {
    const result = await callProvider(provider, prompt);

    if (result.success) {
      return res.status(200).json({
        success: true,
        text: result.text,
        tool: body.tool || null,
        provider: result.provider,
        model: result.model
      });
    }

    console.error("[AI Router] Fallback:", {
      failedProvider: provider.name,
      reason: result.reason,
      status: result.status
    });
  }

  return res.status(503).json({
    success: false,
    error: "AI services are temporarily unavailable. Please retry."
  });
}
