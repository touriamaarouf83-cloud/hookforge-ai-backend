
const TIMEOUTS = {
  siliconflow: 8000,
  groq: 15000,
  openrouter: 15000
};

const MAX_PROMPT_LENGTH = 20000;

const DEFAULT_MODELS = {
  hooks: "Qwen/Qwen3-8B",
  reasoning: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
  general: "THUDM/GLM-4-9B-0414",
  groq: "openai/gpt-oss-20b",
  openrouter: "openrouter/free"
};

const TOOL_CONFIG = {
  hooks: {
    model: DEFAULT_MODELS.hooks,
    temperature: 0.75,
    max_tokens: 800
  },
  titles: {
    model: DEFAULT_MODELS.hooks,
    temperature: 0.75,
    max_tokens: 800
  },
  agent: {
    model: DEFAULT_MODELS.hooks,
    temperature: 0.75,
    max_tokens: 800
  },
  studio: {
    model: DEFAULT_MODELS.hooks,
    temperature: 0.75,
    max_tokens: 800
  },

  scripts: {
    model: DEFAULT_MODELS.reasoning,
    temperature: 0.7,
    max_tokens: 2500
  },
  outline: {
    model: DEFAULT_MODELS.reasoning,
    temperature: 0.7,
    max_tokens: 2500
  },
  ideas: {
    model: DEFAULT_MODELS.reasoning,
    temperature: 0.7,
    max_tokens: 2500
  },
  score: {
    model: DEFAULT_MODELS.reasoning,
    temperature: 0.7,
    max_tokens: 2500
  },

  description: {
    model: DEFAULT_MODELS.general,
    temperature: 0.4,
    max_tokens: 1000
  },
  tags: {
    model: DEFAULT_MODELS.general,
    temperature: 0.4,
    max_tokens: 1000
  },
  hashtags: {
    model: DEFAULT_MODELS.general,
    temperature: 0.4,
    max_tokens: 1000
  },
  notes: {
    model: DEFAULT_MODELS.general,
    temperature: 0.4,
    max_tokens: 1000
  }
};

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

function normalizeTool(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function resolveToolConfig(body) {
  const tool = normalizeTool(body.taskType || body.tool);

  // Exact match first.
  if (TOOL_CONFIG[tool]) {
    return {
      tool,
      ...TOOL_CONFIG[tool]
    };
  }

  // Handle common frontend naming variations.
  if (/hook/.test(tool)) {
    return { tool, ...TOOL_CONFIG.hooks };
  }

  if (/title/.test(tool)) {
    return { tool, ...TOOL_CONFIG.titles };
  }

  if (/script/.test(tool)) {
    return { tool, ...TOOL_CONFIG.scripts };
  }

  if (/outline/.test(tool)) {
    return { tool, ...TOOL_CONFIG.outline };
  }

  if (/idea/.test(tool)) {
    return { tool, ...TOOL_CONFIG.ideas };
  }

  if (/score|analyz/.test(tool)) {
    return { tool, ...TOOL_CONFIG.score };
  }

  if (/description/.test(tool)) {
    return { tool, ...TOOL_CONFIG.description };
  }

  if (/tag/.test(tool)) {
    return { tool, ...TOOL_CONFIG.tags };
  }

  if (/hashtag/.test(tool)) {
    return { tool, ...TOOL_CONFIG.hashtags };
  }

  if (/note/.test(tool)) {
    return { tool, ...TOOL_CONFIG.notes };
  }

  if (/agent|assistant|chat/.test(tool)) {
    return { tool, ...TOOL_CONFIG.agent };
  }

  if (/studio/.test(tool)) {
    return { tool, ...TOOL_CONFIG.studio };
  }

  // Safe default for unrecognized tools.
  return {
    tool: tool || "unknown",
    ...TOOL_CONFIG.hooks
  };
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map(item =>
        typeof item?.text === "string" ? item.text : ""
      )
      .join("")
      .trim();
  }

  return "";
}

function getProviderKeys(provider) {
  if (provider === "siliconflow") {
    return [
      process.env.SILICONFLOW_API_KEY
    ].filter(key => typeof key === "string" && key.trim());
  }

  if (provider === "groq") {
    return Array.from(
      { length: 6 },
      (_, index) => process.env[`GROQ_API_KEY_${index + 1}`]
    ).filter(key => typeof key === "string" && key.trim());
  }

  if (provider === "openrouter") {
    return [
      process.env.OPENROUTER_API_KEY,
      process.env.OPENROUTER_API_KEY_2,
      process.env.OPENROUTER_API_KEY_3,
      process.env.OPENROUTER_API_KEY_4
    ].filter(key => typeof key === "string" && key.trim());
  }

  return [];
}

function getProviderConfig(provider, toolConfig) {
  if (provider === "siliconflow") {
    return {
      name: "siliconflow",
      url:
        (process.env.SILICONFLOW_BASE_URL ||
          "https://api.siliconflow.com/v1")
          .replace(/\/+$/, "") + "/chat/completions",
      model: toolConfig.model,
      temperature: toolConfig.temperature,
      max_tokens: toolConfig.max_tokens,
      timeout: TIMEOUTS.siliconflow
    };
  }

  if (provider === "groq") {
    return {
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL || DEFAULT_MODELS.groq,
      temperature: 0.7,
      max_tokens: toolConfig.max_tokens,
      timeout: TIMEOUTS.groq
    };
  }

  return {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODELS.openrouter,
    temperature: 0.7,
    max_tokens: toolConfig.max_tokens,
    timeout: TIMEOUTS.openrouter
  };
}

function buildMessages(body, prompt) {
  const messages = [];

  const systemPrompt =
    typeof body.systemPrompt === "string"
      ? body.systemPrompt
      : typeof body.system_prompt === "string"
        ? body.system_prompt
        : "";

  if (systemPrompt.trim()) {
    messages.push({
      role: "system",
      content: systemPrompt
    });
  }

  messages.push({
    role: "user",
    content: prompt
  });

  return messages;
}

async function callProvider(provider, body, prompt, toolConfig) {
  const keys = getProviderKeys(provider);

  if (!keys.length) {
    return {
      success: false,
      reason: "no_keys",
      status: 503
    };
  }

  const config = getProviderConfig(provider, toolConfig);

  for (let index = 0; index < keys.length; index++) {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      config.timeout
    );

    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keys[index]}`
      };

      if (provider === "openrouter") {
        headers["HTTP-Referer"] =
          process.env.OPENROUTER_SITE_URL ||
          "https://hook-forge-prime.base44.app";

        headers["X-Title"] = "HookForge AI";
      }

      const payload = {
        model: config.model,
        messages: buildMessages(body, prompt),
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        stream: false
      };

      const response = await fetch(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error("[AI Router] Provider error:", {
          provider,
          status: response.status,
          model: config.model
        });

        // Try another key only for authentication errors.
        if (
          (response.status === 401 || response.status === 403) &&
          index < keys.length - 1
        ) {
          continue;
        }

        return {
          success: false,
          reason: "provider_error",
          status: response.status
        };
      }

      const text = extractText(data);

      if (!text) {
        console.error("[AI Router] Empty model response:", {
          provider,
          model: config.model
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
        provider,
        model: data?.model || config.model,
        usage: data?.usage || null
      };

    } catch (error) {
      const timedOut =
        error?.name === "AbortError" ||
        error?.name === "TimeoutError";

      console.error("[AI Router] Provider request failed:", {
        provider,
        type: timedOut ? "timeout" : "network_error"
      });

      return {
        success: false,
        reason: timedOut ? "timeout" : "network_error",
        status: timedOut ? 504 : 502
      };

    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    success: false,
    reason: "authentication_failed",
    status: 503
  };
}

export default async function handler(req, res) {
  // CORS compatibility with the existing Base44 frontend.
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

  const toolConfig = resolveToolConfig(body);

  // Provider priority: SiliconFlow -> Groq -> OpenRouter.
  const providerOrder = [
    "siliconflow",
    "groq",
    "openrouter"
  ];

  for (const provider of providerOrder) {
    const result = await callProvider(
      provider,
      body,
      prompt,
      toolConfig
    );

    if (result.success) {
      console.log("[AI Router] Generation successful:", {
        provider: result.provider,
        model: result.model,
        tool: toolConfig.tool
      });

      return res.status(200).json({
        success: true,
        text: result.text,
        tool: body.tool || body.taskType || null,
        provider: result.provider,
        model: result.model,
        usage: result.usage
      });
    }

    console.error("[AI Router] Moving to next provider:", {
      failedProvider: provider,
      reason: result.reason,
      status: result.status
    });
  }

  return res.status(503).json({
    success: false,
    error: "All AI providers are temporarily unavailable. Please try again."
  });
}
