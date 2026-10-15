/**
 * ============================================================
 * FLYTRIPVISA
 * Fly 🐉 AI Assistant
 *
 * Cloudflare Workers
 * Workers AI
 * AI Gateway
 * SSE Streaming
 * Admin Dashboard API
 * ============================================================
 */

import type { AiTextGenerationInput } from "@cloudflare/workers-types";
import { handleAdminRequest } from "./admin";

/**
 * ENVIRONMENT
 */
interface Env {
  AI: Ai;
  ASSETS: Fetcher;
}

/**
 * PAGE ROUTES
/*
/**
const PAGE_ROUTES: Record<string, string> = {
  "/": "/index.html",
  "/ai": "/ai.html",
  "/about": "/about.html",
  "/apply": "/apply.html",
  "/login": "/login/index.html",
  "/signup": "/signup/index.html",
  "/privacy": "/privacy.html",
  "/refund": "/refund.html",
};

/**
 * MOBILE ROUTES
 * Used on m.flytripvisa.site
 */
const MOBILE_PAGE_ROUTES: Record<string, string> = {
  "/": "/mobile/index.html",
  "/ai": "/mobile/ai.html",
};

/**
 * CHAT TYPES
 */
type ChatRole = "system" | "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ChatRequestBody {
  messages?: ChatMessage[];
}

/**
 * AI CONFIGURATION
 */
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";
const AI_GATEWAY_ID = "ai_dragon";

const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_TOTAL_CHARS = 60000;

/**
 * SYSTEM PROMPT
 */
const SYSTEM_PROMPT = `
You are Fly 🐉 AI Assistant, the official AI travel and visa
assistant for FLYTRIPVISA.

Company:
FLYTRIPVISA - AI POWERED MINIAPP

Official website:
https://flytripvisa.site/

Your responsibilities:
1. Visa assistance
2. Travel planning
3. Flight information
4. Hotel information
5. Visa application guidance
6. Supporting document guidance
7. International travel assistance

Languages:
- English (default)
- Bengali
- Chinese
- Arabic
- Vietnamese

Respond in the user's language whenever practical.

Communication style:
- Professional
- Friendly
- Clear
- Concise
- Helpful
- Mobile-friendly

Important rules:
- Never guarantee visa approval.
- Never claim a 99.5% visa approval rate unless reliable,
  current evidence verifies that statistic.
- Explain that visa decisions are made by the relevant authorities.
- Never claim to be an embassy, immigration officer, lawyer,
  airline, hotel, or government authority.
- Never invent visa requirements, fees, processing times,
  partnerships, or government policies.
- Recommend official sources when requirements may change.
- Ask for missing information when necessary.
- Distinguish general guidance from official requirements.

FLYTRIPVISA SERVICES:
Explain the company's services using verified information
from https://flytripvisa.site/ and its official mini-app,
where available.

The company may serve customers in Asia, the GCC, China,
Vietnam, and Malaysia. Do not claim specific service coverage,
partnerships, or guarantees unless verified.

Never promise an outcome that cannot be confirmed.
Keep responses concise for mobile chat.
`;

/**
 * CORS
 */
function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Accept",
    "access-control-max-age": "86400",
  };
}

/**
 * JSON RESPONSE
 */
function jsonResponse(
  data: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...corsHeaders(),
    },
  });
}

/**
 * ERROR RESPONSE
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
 * SANITIZE CHAT MESSAGES
 */
function sanitizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const result: ChatMessage[] = [];
  let totalCharacters = 0;

  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const message = item as Partial<ChatMessage>;

    // Never accept a client-supplied system prompt.
    if (
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      continue;
    }

    if (typeof message.content !== "string") {
      continue;
    }

    const content = message.content.trim();

    if (!content || content.length > MAX_MESSAGE_LENGTH) {
      continue;
    }

    if (totalCharacters + content.length > MAX_TOTAL_CHARS) {
      break;
    }

    result.push({
      role: message.role,
      content,
    });

    totalCharacters += content.length;

    if (result.length >= MAX_MESSAGES) {
      break;
    }
  }

  return result;
}

/**
 * CREATE AI INPUT
 */
function createAIInput(
  messages: ChatMessage[],
): AiTextGenerationInput & { stream: true } {
  return {
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...messages,
    ],
    max_tokens: 1024,
    stream: true,
  };
}

/**
 * SSE HEADERS
 */
function sseHeaders(): Headers {
  const headers = new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });

  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }

  return headers;
}

/**
 * SSE ERROR STREAM
 */
function createSSEErrorStream(
  message: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: error\n` +
          `data: ${JSON.stringify({ error: message })}\n\n`,
        ),
      );

      controller.enqueue(
        encoder.encode("data: [DONE]\n\n"),
      );

      controller.close();
    },
  });
}

/**
 * POST /api/chat
 */
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: ChatRequestBody;

  try {
    body = await request.json() as ChatRequestBody;
  } catch {
    return errorResponse("Invalid JSON request body.", 400);
  }

  if (!Array.isArray(body.messages)) {
    return errorResponse("messages array is required.", 400);
  }

  const messages = sanitizeMessages(body.messages);

  if (messages.length === 0) {
    return errorResponse(
      "At least one valid user or assistant message is required.",
      400,
    );
  }

  const inputs = createAIInput(messages);

  console.log(
    JSON.stringify({
      service: "Fly 🐉 AI Assistant",
      model: MODEL_ID,
      gateway: AI_GATEWAY_ID,
      messages: messages.length,
      streaming: true,
      timestamp: new Date().toISOString(),
    }),
  );

  try {
    const stream = await env.AI.run<typeof MODEL_ID>(
      MODEL_ID,
      inputs,
      {
        gateway: {
          id: AI_GATEWAY_ID,
          skipCache: true,
        },
      },
    );

    return new Response(stream as ReadableStream, {
      status: 200,
      headers: sseHeaders(),
    });
  } catch (error) {
    // Keep detailed errors in server logs, not public responses.
    console.error("[Fly AI] Workers AI / Gateway error:", error);

    return jsonResponse(
      {
        ok: false,
        error: "AI request failed. Please try again later.",
      },
      502,
    );
  }
}

/**
 * GET /api/health
 */
function handleHealth(): Response {
  return jsonResponse({
    ok: true,
    service: "Fly 🐉 AI Assistant",
    provider: "Cloudflare Workers AI",
    gateway: AI_GATEWAY_ID,
    model: MODEL_ID,
    streaming: true,
    endpoints: {
      chat: "POST /api/chat",
      health: "GET /api/health",
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/chat
 */
function handleChatInfo(): Response {
  return jsonResponse({
    ok: true,
    service: "Fly 🐉 AI Assistant",
    endpoint: "/api/chat",
    method: "POST",
    contentType: "application/json",
    streaming: true,
    protocol: "Server-Sent Events",
    gateway: AI_GATEWAY_ID,
    model: MODEL_ID,
    example: {
      messages: [
        {
          role: "user",
          content: "I want to apply for a Japan visa.",
        },
      ],
    },
  });
}

/**
 * MAIN WORKER
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();

    /**
     * CORS PREFLIGHT
     */
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    /**
     * ADMIN API
     */
    const adminResponse = await handleAdminRequest(request, env);

    if (adminResponse) {
      return adminResponse;
    }

    /**
     * POST /api/chat
     */
    if (
      url.pathname === "/api/chat" &&
      request.method === "POST"
    ) {
      return handleChatRequest(request, env);
    }

    /**
     * GET /api/chat
     */
    if (
      url.pathname === "/api/chat" &&
      request.method === "GET"
    ) {
      return handleChatInfo();
    }

    /**
     * GET /api/health
     */
    if (
      url.pathname === "/api/health" &&
      request.method === "GET"
    ) {
      return handleHealth();
    }

    /**
     * FRIENDLY PAGE ROUTING
     */
    if (
      request.method === "GET" ||
      request.method === "HEAD"
    ) {
      const pathname =
        url.pathname.replace(/\/+$/, "") || "/";

      const isMobile =
        hostname === "m.flytripvisa.site";

      const assetPath = isMobile
        ? MOBILE_PAGE_ROUTES[pathname] ??
          PAGE_ROUTES[pathname]
        : PAGE_ROUTES[pathname];

      if (assetPath) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = assetPath;

        return env.ASSETS.fetch(
          new Request(assetUrl, request),
        );
      }
    }

    /**
     * DEFAULT ASSET FALLBACK
     */
    return env.ASSETS.fetch(request);
  },
};