interface TelegramEnv {
  AI: Ai;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

interface TelegramUpdate {
  message?: {
    chat: { id: number; type: string };
    text?: string;
  };
}

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

async function telegramCall(
  token: string,
  method: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }

  return response.json();
}

export async function handleTelegramWebhook(
  request: Request,
  env: TelegramEnv,
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return Response.json({ error: "Bot not configured" }, { status: 503 });
  }

  if (
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
    env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let update: TelegramUpdate;

  try {
    update = await request.json() as TelegramUpdate;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat.id;

  if (!message || !text || !chatId || message.chat.type !== "private") {
    return Response.json({ ok: true });
  }

  try {
    if (text === "/start" || text === "/help") {
      await telegramCall(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text: "🐉 Fly AI Assistant\n\nAsk me about visas, flights, hotels, and travel.",
      });
      return Response.json({ ok: true });
    }

    await telegramCall(env.TELEGRAM_BOT_TOKEN, "sendChatAction", {
      chat_id: chatId,
      action: "typing",
    });

    const result = await env.AI.run<typeof MODEL>(
      MODEL,
      {
        messages: [
          {
            role: "system",
            content:
              "You are Fly AI, the FlyTripVisa travel and visa assistant. " +
              "Answer helpfully and concisely. Never invent visa rules, fees, " +
              "or processing times. Respond in the user's language.",
          },
          { role: "user", content: text.slice(0, 10000) },
        ],
        max_tokens: 700,
      },
    ) as { response?: string };

    const answer = result.response?.trim() ||
      "Sorry, I couldn't generate a reply. Please try again.";

    for (let i = 0; i < answer.length; i += 4000) {
      await telegramCall(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text: answer.slice(i, i + 4000),
      });
    }
  } catch (error) {
    console.error("Telegram bot error:", error);
    // Return success to avoid Telegram repeatedly retrying failed AI requests.
  }

  return Response.json({ ok: true });
}