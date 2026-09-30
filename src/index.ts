/**
 * FLYTRIPVISA
 * Fly 🐉 AI Assistant
 *
 * Cloudflare Workers
 * Workers AI
 * AI Gateway
 * SSE Streaming
 */

import type {
  AiTextGenerationInput,
} from "@cloudflare/workers-types";

interface Env {
  AI: Ai;
  ASSETS: Fetcher;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * ==========================================
 * AI CONFIGURATION
 * ==========================================
 */

const MODEL_ID =
  "@cf/meta/llama-3.1-8b-instruct-fp8";

const AI_GATEWAY_ID =
  "ai_dragon";

/**
 * ==========================================
 * SYSTEM PROMPT
 * ==========================================
 */

const SYSTEM_PROMPT = `
You are Fly 🐉 AI Assistant, the official AI travel and visa assistant for FLYTRIPVISA.

Company:
FLYTRIPVISA

Website:
https://flytripvisa.site/

Your main responsibilities:

1. Visa assistance
2. Travel planning
3. Flight information
4. Hotel information
5. Visa application guidance
6. Supporting document guidance
7. International travel assistance

You can communicate in:

- English
- Bengali
- Chinese
- Arabic
- Vietnamese

Always respond in the language used by the user when practical.

Be:

- Professional
- Friendly
- Clear
- Concise
- Helpful
- Mobile-friendly

Important rules:

- Never guarantee visa approval.
- Never claim to be an embassy, immigration officer, lawyer, airline, or government authority.
- Never invent visa requirements.
- Never invent visa fees.
- Never invent processing times.
- Never fabricate government policies.
- When requirements can change, advise the user to verify them with the relevant official embassy, consulate, immigration authority, or government website.

When the user provides incomplete information, ask for the missing information.

For travel questions, provide practical and easy-to-understand guidance.

For visa questions, clearly distinguish general guidance from official immigration requirements.
`;

/**
 * ==========================================
 * JSON RESPONSE
 * ==========================================
 */

function jsonResponse(
  data: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store",

        "x-content-type-options":
          "nosniff",
      },
    },
  );
}

/**
 * ==========================================
 * CORS
 * ==========================================
 */

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",

    "access-control-allow-methods":
      "GET,POST,OPTIONS",

    "access-control-allow-headers":
      "Content-Type, Accept",
  };
}

/**
 * ==========================================
 * /api/chat
 * ==========================================
 */

async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {

  try {

    /**
     * Parse request body
     */

    const body =
      await request.json() as {
        messages?: ChatMessage[];
      };

    /**
     * Validate messages
     */

    if (
      !Array.isArray(
        body.messages,
      )
    ) {
      return jsonResponse(
        {
          error:
            "messages array is required",
        },
        400,
      );
    }

    /**
     * Sanitize messages
     */

    const userMessages =
      body.messages.filter(
        (message) =>
          message &&
          typeof message.content ===
            "string" &&
          (
            message.role === "user" ||
            message.role === "assistant" ||
            message.role === "system"
          ),
      );

    /**
     * Prevent empty requests
     */

    if (
      userMessages.length === 0
    ) {
      return jsonResponse(
        {
          error:
            "At least one message is required",
        },
        400,
      );
    }

    /**
     * Build AI messages
     */

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          SYSTEM_PROMPT,
      },
      ...userMessages,
    ];

    /**
     * Workers AI input
     */

    const inputs = {
      messages,

      max_tokens: 1024,

      stream: true,
    } satisfies
      AiTextGenerationInput & {
        stream: true;
      };

    console.log(
      `[Fly AI] model=${MODEL_ID} gateway=${AI_GATEWAY_ID}`,
    );

    /**
     * ======================================
     * WORKERS AI + AI GATEWAY
     * ======================================
     */

    const stream =
      await env.AI.run<typeof MODEL_ID>(
        MODEL_ID,
        inputs,
        {
          gateway: {
            id:
              AI_GATEWAY_ID,

            /*
             * Real-time chat:
             * bypass Gateway cache.
             */
            skipCache: true,
          },
        },
      );

    /**
     * Return SSE stream
     */

    const headers =
      new Headers();

    headers.set(
      "content-type",
      "text/event-stream; charset=utf-8",
    );

    headers.set(
      "cache-control",
      "no-cache, no-transform",
    );

    headers.set(
      "connection",
      "keep-alive",
    );

    headers.set(
      "x-content-type-options",
      "nosniff",
    );

    const cors =
      corsHeaders();

    for (
      const [key, value]
      of Object.entries(cors)
    ) {
      headers.set(
        key,
        value,
      );
    }

    return new Response(
      stream as ReadableStream,
      {
        status: 200,
        headers,
      },
    );

  } catch (error) {

    console.error(
      "[Fly AI] /api/chat error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown error";

    return new Response(
      JSON.stringify({
        error:
          "Failed to process AI request",

        message,
      }),
      {
        status: 500,

        headers: {
          "content-type":
            "application/json; charset=utf-8",

          "cache-control":
            "no-store",

          ...corsHeaders(),
        },
      },
    );
  }
}

/**
 * ==========================================
 * API HEALTH
 * ==========================================
 */

function handleHealth(): Response {

  return jsonResponse(
    {
      ok: true,

      service:
        "Fly 🐉 AI Assistant",

      gateway:
        AI_GATEWAY_ID,

      model:
        MODEL_ID,

      endpoint:
        "/api/chat",

      timestamp:
        new Date().toISOString(),
    },
    200,
  );
}

/**
 * ==========================================
 * MAIN WORKER
 * ==========================================
 */

export default {

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {

    const url =
      new URL(request.url);

    /**
     * OPTIONS
     */

    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,

          headers:
            corsHeaders(),
        },
      );
    }

    /**
     * POST /api/chat
     */

    if (
      url.pathname ===
        "/api/chat" &&
      request.method ===
        "POST"
    ) {
      return handleChatRequest(
        request,
        env,
      );
    }

    /**
     * GET /api/chat
     *
     * Useful for testing.
     */

    if (
      url.pathname ===
        "/api/chat" &&
      request.method ===
        "GET"
    ) {
      return jsonResponse(
        {
          ok: true,

          endpoint:
            "/api/chat",

          method:
            "POST",

          gateway:
            AI_GATEWAY_ID,

          model:
            MODEL_ID,
        },
      );
    }

    /**
     * GET /api/health
     */

    if (
      url.pathname ===
        "/api/health" &&
      request.method ===
        "GET"
    ) {
      return handleHealth();
    }

    /**
     * Everything else:
     * serve frontend.
     */

    return env.ASSETS.fetch(
      request,
    );
  },
};