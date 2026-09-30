/**
 * FlyTripVisa — Fly 🐉 AI Assistant
 *
 * Cloudflare Workers
 * Workers AI + AI Gateway + SSE Streaming
 */

import type {
  AiTextGenerationInput,
  AiTextGenerationOutput,
} from "@cloudflare/workers-types";

interface Env {
  AI: Ai;
  ASSETS: Fetcher;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

const AI_GATEWAY_ID = "ai_dragon";

const SYSTEM_PROMPT = `
You are Fly 🐉 AI Assistant, the official AI travel and visa assistant for FLYTRIPVISA.

Your responsibilities:
- Help users understand visa requirements and application processes.
- Help with international travel planning.
- Explain flight and hotel booking options.
- Help users prepare visa application information and supporting documents.
- Provide clear, practical and accurate travel information.
- Ask for missing information when necessary.
- Never claim that a visa is guaranteed.
- Never invent embassy rules, visa fees, processing times, or immigration requirements.
- Clearly distinguish general guidance from official immigration requirements.
- When requirements may change, advise the user to verify them with the relevant embassy, consulate, immigration authority, or official government website.

Company:
FLYTRIPVISA
Website: https://flytripvisa.site/

Languages:
English, Chinese, Bengali, Arabic, Vietnamese.

Communication style:
- Professional
- Friendly
- Concise
- Helpful
- Mobile-friendly
- Use the user's language when possible.

You are an AI assistant, not an immigration officer, lawyer, embassy, airline, or government authority.
`;

function jsonResponse(
  data: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse(
        {
          error: "Method Not Allowed",
        },
        405,
      );
    }

    const body = (await request.json()) as {
      messages?: ChatMessage[];
    };

    const messages = Array.isArray(body.messages)
      ? body.messages
      : [];

    if (messages.length === 0) {
      return jsonResponse(
        {
          error: "No messages provided",
        },
        400,
      );
    }

    const normalizedMessages: ChatMessage[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...messages.filter(
        (message) =>
          message &&
          typeof message.content === "string" &&
          ["user", "assistant", "system"].includes(
            message.role,
          ),
      ),
    ];

    const inputs = {
      messages: normalizedMessages,
      max_tokens: 1024,
      stream: true,
    } satisfies AiTextGenerationInput & {
      stream: true;
    };

    console.log(
      `[Fly AI] Model: ${MODEL_ID} | Gateway: ${AI_GATEWAY_ID}`,
    );

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

    return new Response(
      stream as ReadableStream,
      {
        status: 200,
        headers: {
          "content-type":
            "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    console.error(
      "[Fly AI] Chat error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown error";

    return jsonResponse(
      {
        error: "Failed to process AI request",
        message,
      },
      500,
    );
  }
}

async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  // AI Chat API
  if (
    url.pathname === "/api/chat" &&
    request.method === "POST"
  ) {
    return handleChatRequest(request, env);
  }

  // Simple API health check
  if (
    url.pathname === "/api/health" &&
    request.method === "GET"
  ) {
    return jsonResponse({
      ok: true,
      service: "Fly 🐉 AI Assistant",
      gateway: AI_GATEWAY_ID,
      model: MODEL_ID,
      timestamp: new Date().toISOString(),
    });
  }

  // Serve frontend assets
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return handleRequest(request, env);
  },
};