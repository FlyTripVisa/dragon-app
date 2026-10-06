/**
 * ============================================================
 * FLYTRIPVISA
 * Fly 🐉 AI Assistant
 *
 * Cloudflare Workers
 * Workers AI
 * AI Gateway
 * SSE Streaming
 * ============================================================
 */

import type {
  AiTextGenerationInput,
} from "@cloudflare/workers-types";

/**
 * ============================================================
 * ENVIRONMENT
 * ============================================================
 */

interface Env {
  AI: Ai;
  ASSETS: Fetcher;
}

/**
 * ============================================================
 * CHAT TYPES
 * ============================================================
 */

type ChatRole =
  | "system"
  | "user"
  | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ChatRequestBody {
  messages?: ChatMessage[];
}

/**
 * ============================================================
 * AI CONFIGURATION
 * ============================================================
 */

/**
 * Workers AI model.
 *
 * Keep the provider/model name here.
 * AI Gateway is attached through env.AI.run().
 */
const MODEL_ID =
  "@cf/meta/llama-3.1-8b-instruct-fp8";

/**
 * Your Cloudflare AI Gateway ID.
 */
const AI_GATEWAY_ID =
  "ai_dragon";

/**
 * Maximum number of messages accepted
 * from the browser.
 *
 * Prevents accidental huge requests.
 */
const MAX_MESSAGES = 50;

/**
 * Maximum characters per message.
 */
const MAX_MESSAGE_LENGTH = 12000;

/**
 * Maximum total conversation characters.
 */
const MAX_TOTAL_CHARS = 60000;

/**
 * ============================================================
 * SYSTEM PROMPT
 * ============================================================
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
- When requirements can change, advise the user to verify them with the relevant official embassy, consulate, immigration authority, airline, hotel, or government website.

When the user provides incomplete information, ask for the missing information.

For travel questions, provide practical and easy-to-understand guidance.

For visa questions, clearly distinguish general guidance from official immigration requirements.

When the user asks about FLYTRIPVISA services, explain them clearly without making promises that cannot be verified.

Keep responses concise enough for a mobile chat interface.
`;

/**
 * ============================================================
 * CORS
 * ============================================================
 */

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",

    "access-control-allow-methods":
      "GET, POST, OPTIONS",

    "access-control-allow-headers":
      "Content-Type, Accept",

    "access-control-max-age":
      "86400",
  };
}

/**
 * ============================================================
 * JSON RESPONSE
 * ============================================================
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

        ...corsHeaders(),
      },
    },
  );
}

/**
 * ============================================================
 * ERROR RESPONSE
 * ============================================================
 */

function errorResponse(
  message: string,
  status = 500,
): Response {

  return jsonResponse(
    {
      ok: false,
      error: message,
    },
    status,
  );
}

/**
 * ============================================================
 * REQUEST VALIDATION
 * ============================================================
 */

function isValidRole(
  role: unknown,
): role is ChatRole {

  return (
    role === "user" ||
    role === "assistant" ||
    role === "system"
  );
}

/**
 * ============================================================
 * SANITIZE CHAT
 * ============================================================
 *
 * Important:
 *
 * We do NOT trust a browser supplied system prompt.
 *
 * Any "system" messages sent by the frontend
 * are removed.
 *
 * Our server-side SYSTEM_PROMPT is authoritative.
 * ============================================================
 */

function sanitizeMessages(
  input: unknown,
): ChatMessage[] {

  if (!Array.isArray(input)) {
    return [];
  }

  const result: ChatMessage[] = [];

  let totalCharacters = 0;

  for (
    const item of input
  ) {

    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const message =
      item as Partial<ChatMessage>;

    /**
     * Never accept browser-controlled
     * system messages.
     */
    if (
      message.role === "system"
    ) {
      continue;
    }

    if (
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      continue;
    }

    if (
      typeof message.content !==
      "string"
    ) {
      continue;
    }

    const content =
      message.content.trim();

    if (!content) {
      continue;
    }

    if (
      content.length >
      MAX_MESSAGE_LENGTH
    ) {
      continue;
    }

    if (
      totalCharacters +
        content.length >
      MAX_TOTAL_CHARS
    ) {
      break;
    }

    result.push({
      role: message.role,
      content,
    });

    totalCharacters +=
      content.length;

    if (
      result.length >=
      MAX_MESSAGES
    ) {
      break;
    }
  }

  return result;
}

/**
 * ============================================================
 * CREATE AI INPUT
 * ============================================================
 */

function createAIInput(
  messages: ChatMessage[],
): AiTextGenerationInput & {
  stream: true;
} {

  return {
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },

      ...messages,
    ],

    /**
     * Maximum generated tokens.
     */
    max_tokens: 1024,

    /**
     * IMPORTANT:
     *
     * This enables real-time streaming.
     */
    stream: true,
  };
}

/**
 * ============================================================
 * SSE HEADERS
 * ============================================================
 */

function sseHeaders(): Headers {

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
    "x-accel-buffering",
    "no",
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

  return headers;
}

/**
 * ============================================================
 * SSE FALLBACK STREAM
 * ============================================================
 *
 * If something fails after the response has started,
 * send an SSE error event instead of corrupting the stream.
 * ============================================================
 */

function createSSEErrorStream(
  message: string,
): ReadableStream {

  const encoder =
    new TextEncoder();

  return new ReadableStream({
    start(controller) {

      controller.enqueue(
        encoder.encode(
          `event: error\n` +
          `data: ${JSON.stringify({
            error: message,
          })}\n\n`,
        ),
      );

      controller.enqueue(
        encoder.encode(
          "data: [DONE]\n\n",
        ),
      );

      controller.close();
    },
  });
}

/**
 * ============================================================
 * POST /api/chat
 * ============================================================
 */

async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {

  /**
   * ----------------------------------------------------------
   * Parse JSON
   * ----------------------------------------------------------
   */

  let body: ChatRequestBody;

  try {

    body =
      await request.json() as
        ChatRequestBody;

  } catch {

    return errorResponse(
      "Invalid JSON request body.",
      400,
    );
  }

  /**
   * ----------------------------------------------------------
   * Validate messages
   * ----------------------------------------------------------
   */

  if (
    !Array.isArray(
      body.messages,
    )
  ) {

    return errorResponse(
      "messages array is required.",
      400,
    );
  }

  /**
   * ----------------------------------------------------------
   * Sanitize
   * ----------------------------------------------------------
   */

  const messages =
    sanitizeMessages(
      body.messages,
    );

  if (
    messages.length === 0
  ) {

    return errorResponse(
      "At least one valid user or assistant message is required.",
      400,
    );
  }

  /**
   * ----------------------------------------------------------
   * AI input
   * ----------------------------------------------------------
   */

  const inputs =
    createAIInput(
      messages,
    );

  /**
   * ----------------------------------------------------------
   * Logging
   * ----------------------------------------------------------
   */

  console.log(
    JSON.stringify({
      service:
        "Fly 🐉 AI Assistant",

      model:
        MODEL_ID,

      gateway:
        AI_GATEWAY_ID,

      messages:
        messages.length,

      streaming:
        true,

      timestamp:
        new Date().toISOString(),
    }),
  );

  /**
   * ----------------------------------------------------------
   * Workers AI + AI Gateway
   * ----------------------------------------------------------
   *
   * This is the important part.
   *
   * The request is executed through your
   * AI Gateway "ai_dragon".
   * ----------------------------------------------------------
   */

  try {

    const stream =
      await env.AI.run<
        typeof MODEL_ID
      >(
        MODEL_ID,
        inputs,
        {
          gateway: {
            id:
              AI_GATEWAY_ID,

            /**
             * Do not serve cached responses
             * for live chat.
             */
            skipCache: true,
          },
        },
      );

    /**
     * --------------------------------------------------------
     * Return streaming response
     * --------------------------------------------------------
     */

    return new Response(
      stream as ReadableStream,
      {
        status: 200,

        headers:
          sseHeaders(),
      },
    );

  } catch (error) {

    console.error(
      "[Fly AI] Workers AI / Gateway error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown AI error";

    return jsonResponse(
      {
        ok: false,

        error:
          "AI request failed.",

        message,

        model:
          MODEL_ID,

        gateway:
          AI_GATEWAY_ID,
      },
      502,
    );
  }
}

/**
 * ============================================================
 * HEALTH
 * ============================================================
 */

function handleHealth(): Response {

  return jsonResponse({
    ok: true,

    service:
      "Fly 🐉 AI Assistant",

    provider:
      "Cloudflare Workers AI",

    gateway:
      AI_GATEWAY_ID,

    model:
      MODEL_ID,

    streaming:
      true,

    endpoints: {
      chat:
        "POST /api/chat",

      health:
        "GET /api/health",
    },

    timestamp:
      new Date().toISOString(),
  });
}

/**
 * ============================================================
 * CHAT INFO
 * ============================================================
 */

function handleChatInfo(): Response {

  return jsonResponse({
    ok: true,

    service:
      "Fly 🐉 AI Assistant",

    endpoint:
      "/api/chat",

    method:
      "POST",

    contentType:
      "application/json",

    streaming:
      true,

    protocol:
      "Server-Sent Events",

    gateway:
      AI_GATEWAY_ID,

    model:
      MODEL_ID,

    example: {
      messages: [
        {
          role: "user",
          content:
            "I want to apply for a Japan visa.",
        },
      ],
    },
  });
}

/**
 * ============================================================
 * MAIN WORKER
 * ============================================================
 */

export default {

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {

    const url =
      new URL(
        request.url,
      );

    /**
     * --------------------------------------------------------
     * CORS PREFLIGHT
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * POST /api/chat
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * GET /api/chat
     * --------------------------------------------------------
     */

    if (
      url.pathname ===
        "/api/chat" &&
      request.method ===
        "GET"
    ) {

      return handleChatInfo();
    }

    /**
     * --------------------------------------------------------
     * GET /api/health
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * Frontend
     * --------------------------------------------------------
     */

    return env.ASSETS.fetch(
      request,
    );
  },
};