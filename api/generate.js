export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const { prompt, tool } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        error: "A valid prompt is required."
      });
    }

    if (prompt.length > 20000) {
      return res.status(400).json({
        error: "Prompt is too long."
      });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      console.error("OPENROUTER_API_KEY is missing.");

      return res.status(500).json({
        error: "Server configuration error."
      });
    }

    // Centralized model configuration.
    // Change it from Vercel Environment Variables without touching code.
    const model =
      process.env.OPENROUTER_MODEL || "openrouter/free";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response;

    try {
      response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer":
              process.env.OPENROUTER_SITE_URL ||
              "https://hook-forge-prime.base44.app",
            "X-Title": "HookForge AI"
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.8
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter API error:", {
        status: response.status,
        data
      });

      return res.status(response.status).json({
        success: false,
        error:
          data?.error?.message ||
          "AI generation failed."
      });
    }

    const text =
      data?.choices?.[0]?.message?.content || "";

    if (!text) {
      console.error("OpenRouter returned an empty response:", data);

      return res.status(502).json({
        success: false,
        error: "AI returned an empty response."
      });
    }

    return res.status(200).json({
      success: true,
      text,
      tool: tool || null,
      model
    });

  } catch (error) {
    console.error("Server error:", error);

    if (error?.name === "AbortError") {
      return res.status(504).json({
        success: false,
        error: "AI request timed out."
      });
    }

    return res.status(500).json({
      success: false,
      error: "Internal server error."
    });
  }
}
