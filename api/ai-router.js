
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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

function getGroqKeys() {
  return Array.from({ length: 6 }, (_, i) =>
    process.env[`GROQ_API_KEY_${i + 1}`]
  ).filter(key => typeof key === "string" && key.trim());
}

function getOpenRouterKeys() {
  return [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3
  ].filter(key => typeof key === "string" && key.trim());
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map(part => typeof part?.text === "string" ? part.text : "")
      .join("");
  }

  return "";
}

async function callProvider(provider, prompt) {
  const keys = provider.keys();

  if (!keys.length) {
    return {
      success: false,
      status: 503,
      error: "Provider has no configured keys."
    };
  }

  const model = provider.model();

  for (let i = 0; i < keys.length; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

    try {
      const payload = provider.name === "groq"
        ? {
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.6,
            max_completion_tokens: 1200,
            reasoning_effort: "low",
            include_reasoning: false
          }
        : {
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 1200
          };

      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keys[i]}`
      };

      if (provider.name === "openrouter") {
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

      if (response.ok) {
        const text = extractText(data).trim();

        if (!text) {
          return {
            success: false,
            status: 502,
            error: "Provider returned an empty response."
          };
        }

        return {
          success: true,
          text,
          provider: provider.name,
          model: data?.model || model
        };
      }

      // Authentication errors can belong to an individual key.
      // Try the next configured key only for these errors.
      if (response.status === 401 || response.status === 403) {
        continue;
      }

      // Rate limits, billing errors and server errors:
      // leave this provider and try the other provider.
      return {
        success: false,
        status: response.status,
        error: data?.error?.message || "Provider request failed."
      };

    } catch (error) {
      return {
        success: false,
        status: error?.name === "AbortError" ? 504 : 502,
        error: error?.name === "AbortError"
          ? "Provider timed out."
          : "Provider network error."
      };

    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    success: false,
    status: 503,
    error: "All keys for this provider rejected authentication."
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
  const tool = body.tool || null;

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

  const providers = [
    {
      name: "groq",
      url: GROQ_URL,
      keys: getGroqKeys,
      model: () =>
        process.env.GROQ_MODEL || "openai/gpt-oss-20b"
    },
    {
      name: "openrouter",
      url: OPENROUTER_URL,
      keys: getOpenRouterKeys,
      model: () =>
        process.env.OPENROUTER_MODEL || "openrouter/free"
    }
  ];

  const failures = [];

  for (const provider of providers) {
    const result = await callProvider(provider, prompt);

    if (result.success) {
      return res.status(200).json({
        success: true,
        text: result.text,
        tool,
        provider: result.provider,
        model: result.model
      });
    }

    failures.push({
      provider: provider.name,
      status: result.status
    });

    console.error("[AI Router] Provider failed:", {
      provider: provider.name,
      status: result.status
    });
  }

  return res.status(503).json({
    success: false,
    error: "All AI providers are currently unavailable. Please retry.",
    providers: failures
  });
}
