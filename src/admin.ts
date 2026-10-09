/**

* FlyTripVisa Dragon App — Admin API
* File: src/admin.ts
* 
* Routes:
* POST /api/admin/login
* POST /api/admin/logout
* GET  /api/admin/me
* GET  /api/admin/overview
* GET  /api/admin/telegram/webhook-info
* 
* Required Worker secrets:
* ADMIN_PASSWORD
* ADMIN_SESSION_SECRET
* TELEGRAM_BOT_TOKEN (optional; only needed for Telegram status)
  */

interface AdminEnv {
ADMIN_PASSWORD?: string;
ADMIN_SESSION_SECRET?: string;
TELEGRAM_BOT_TOKEN?: string;
MODEL_ID?: string;

DB?: unknown;
DB2?: unknown;
AI?: unknown;
AI_SEARCH?: unknown;
KV_BINDING?: unknown;
BUCKET?: unknown;
AI_CHAT_BUCKET?: unknown;
BROWSER?: unknown;
ASSETS?: unknown;
}

const COOKIE_NAME = "flydragon_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

const JSON_HEADERS = {
"Content-Type": "application/json; charset=utf-8",
"Cache-Control": "no-store",
"X-Content-Type-Options": "nosniff",
};

function json(
data: unknown,
status = 200,
extraHeaders?: Record<string, string>,
): Response {
const headers = new Headers(JSON_HEADERS);

if (extraHeaders) {
for (const [key, value] of Object.entries(extraHeaders)) {
headers.set(key, value);
}
}

return new Response(JSON.stringify(data), {
status,
headers,
});
}

function getCookie(request: Request, name: string): string | null {
const cookieHeader = request.headers.get("Cookie");

if (!cookieHeader) return null;

for (const part of cookieHeader.split(";")) {
const separator = part.indexOf("=");

if (separator < 0) continue;

const key = part.slice(0, separator).trim();
const value = part.slice(separator + 1).trim();

if (key === name) return value;

}

return null;
}

function base64UrlEncode(bytes: Uint8Array): string {
let binary = "";

for (const byte of bytes) {
binary += String.fromCharCode(byte);
}

return btoa(binary)
.replace(/+/g, "-")
.replace(///g, "_")
.replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
const base64 = value
.replace(/-/g, "+")
.replace(/_/g, "/");

const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
const binary = atob(padded);
const bytes = new Uint8Array(binary.length);

for (let i = 0; i < binary.length; i++) {
bytes[i] = binary.charCodeAt(i);
}

return bytes;
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
return crypto.subtle.importKey(
"raw",
new TextEncoder().encode(secret),
{ name: "HMAC", hash: "SHA-256" },
false,
["sign", "verify"],
);
}

async function createSession(
secret: string,
): Promise<string> {
const payload = base64UrlEncode(
new TextEncoder().encode(
JSON.stringify({
role: "admin",
exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
}),
),
);

const key = await getSigningKey(secret);
const signature = await crypto.subtle.sign(
"HMAC",
key,
new TextEncoder().encode(payload),
);

return "${payload}.${base64UrlEncode(new Uint8Array(signature))}";
}

async function verifySession(
token: string,
secret: string,
): Promise<boolean> {
try {
const parts = token.split(".");

if (parts.length !== 2) return false;

const [payload, signature] = parts;

if (!payload || !signature) return false;

const key = await getSigningKey(secret);

const valid = await crypto.subtle.verify(
  "HMAC",
  key,
  base64UrlDecode(signature),
  new TextEncoder().encode(payload),
);

if (!valid) return false;

const decoded = new TextDecoder().decode(
  base64UrlDecode(payload),
);

const session = JSON.parse(decoded) as {
  role?: string;
  exp?: number;
};

return (
  session.role === "admin" &&
  typeof session.exp === "number" &&
  session.exp > Math.floor(Date.now() / 1000)
);

} catch {
return false;
}
}

function cookieHeader(
value: string,
maxAge: number,
): string {
return [
"${COOKIE_NAME}=${value}",
"Path=/",
"HttpOnly",
"Secure",
"SameSite=Strict",
"Max-Age=${maxAge}",
].join("; ");
}

async function isAuthenticated(
request: Request,
env: AdminEnv,
): Promise<boolean> {
const secret = env.ADMIN_SESSION_SECRET;

if (!secret || secret.length < 32) return false;

const token = getCookie(request, COOKIE_NAME);

if (!token) return false;

return verifySession(token, secret);
}

async function readJson(
request: Request,
): Promise<Record<string, unknown> | null> {
try {
const value: unknown = await request.json();

if (
  typeof value !== "object" ||
  value === null ||
  Array.isArray(value)
) {
  return null;
}

return value as Record<string, unknown>;

} catch {
return null;
}
}

function constantTimeEqual(
left: string,
right: string,
): boolean {
const a = new TextEncoder().encode(left);
const b = new TextEncoder().encode(right);

let difference = a.length ^ b.length;
const length = Math.max(a.length, b.length);

for (let i = 0; i < length; i++) {
difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
}

return difference === 0;
}

async function databaseStatus(
binding: unknown,
): Promise<{
connected: boolean;
tables: string[];
error?: string;
}> {
if (!binding || typeof binding !== "object") {
return {
connected: false,
tables: [],
error: "Binding not configured",
};
}

try {
const db = binding as {
prepare: (query: string) => {
first: () => Promise<unknown>;
all: () => Promise<{
results?: Array<{ name?: string }>;
}>;
};
};

await db.prepare("SELECT 1 AS ok").first();

let tables: string[] = [];

try {
  const result = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name LIMIT 50",
    )
    .all();

  tables = (result.results ?? [])
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string");
} catch {
  // The database is reachable even if table discovery fails.
}

return {
  connected: true,
  tables,
};

} catch {
return {
connected: false,
tables: [],
error: "Database query failed",
};
}
}

async function getTelegramStatus(
env: AdminEnv,
): Promise<Record<string, unknown>> {
const token = env.TELEGRAM_BOT_TOKEN;

if (!token) {
return {
configured: false,
connected: false,
message: "Telegram bot token is not configured",
};
}

try {
const response = await fetch(
"https://api.telegram.org/bot${token}/getWebhookInfo",
);

if (!response.ok) {
  return {
    configured: true,
    connected: false,
    message: `Telegram API returned HTTP ${response.status}`,
  };
}

const result = (await response.json()) as {
  ok?: boolean;
  result?: {
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
    last_error_date?: number;
  };
};

if (!result.ok || !result.result) {
  return {
    configured: true,
    connected: false,
    message: "Telegram API did not return webhook information",
  };
}

return {
  configured: true,
  connected: true,
  webhookConfigured: Boolean(result.result.url),
  webhookUrl: result.result.url ?? "",
  pendingUpdates: result.result.pending_update_count ?? 0,
  lastError: result.result.last_error_message ?? null,
  lastErrorDate: result.result.last_error_date ?? null,
};

} catch {
return {
configured: true,
connected: false,
message: "Unable to contact Telegram API",
};
}
}

async function handleLogin(
request: Request,
env: AdminEnv,
): Promise<Response> {
if (request.method !== "POST") {
return json({ error: "Method not allowed" }, 405, {
Allow: "POST",
});
}

const passwordConfigured = env.ADMIN_PASSWORD;
const sessionSecret = env.ADMIN_SESSION_SECRET;

if (!passwordConfigured || !sessionSecret || sessionSecret.length < 32) {
return json(
{
error: "Admin authentication is not configured correctly",
},
503,
);
}

const body = await readJson(request);
const password = body?.password;

if (typeof password !== "string" || password.length > 1024) {
return json({ error: "Invalid credentials" }, 401);
}

if (!constantTimeEqual(password, passwordConfigured)) {
return json({ error: "Invalid credentials" }, 401);
}

const token = await createSession(sessionSecret);

return json(
{ ok: true },
200,
{
"Set-Cookie": cookieHeader(token, SESSION_SECONDS),
},
);
}

function handleLogout(request: Request): Response {
if (request.method !== "POST") {
return json({ error: "Method not allowed" }, 405, {
Allow: "POST",
});
}

return json(
{ ok: true },
200,
{
"Set-Cookie": cookieHeader("", 0),
},
);
}

async function handleOverview(
env: AdminEnv,
): Promise<Response> {
const [db, db2, telegram] = await Promise.all([
databaseStatus(env.DB),
databaseStatus(env.DB2),
getTelegramStatus(env),
]);

return json({
ok: true,
app: "FlyTripVisa Dragon App",
timestamp: new Date().toISOString(),
model: env.MODEL_ID ?? "@cf/meta/llama-3.1-8b-instruct-fp8",
bindings: {
ai: Boolean(env.AI),
aiSearch: Boolean(env.AI_SEARCH),
kv: Boolean(env.KV_BINDING),
bucket: Boolean(env.BUCKET),
aiChatBucket: Boolean(env.AI_CHAT_BUCKET),
browser: Boolean(env.BROWSER),
},
databases: {
DB: db,
DB2: db2,
},
telegram,
note: "Binding presence is checked at runtime. Database status is tested with SELECT 1.",
});
}

/**

* Returns null for routes that do not belong to the Admin API.
* This allows the main Worker to continue handling chat and assets.
  */
  export async function handleAdminRequest(
  request: Request,
  envInput: unknown,
  ): Promise<Response | null> {
  const env = envInput as AdminEnv;
  const url = new URL(request.url);
  const path = url.pathname;

if (!path.startsWith("/api/admin/")) {
return null;
}

// Prevent browser pages on another origin from using these endpoints.
const origin = request.headers.get("Origin");

if (origin && origin !== url.origin) {
return json({ error: "Forbidden origin" }, 403);
}

if (path === "/api/admin/login") {
return handleLogin(request, env);
}

if (path === "/api/admin/logout") {
return handleLogout(request);
}

if (path === "/api/admin/me") {
if (request.method !== "GET") {
return json({ error: "Method not allowed" }, 405, {
Allow: "GET",
});
}

const authenticated = await isAuthenticated(request, env);

return json({
  authenticated,
  user: authenticated ? { role: "admin" } : null,
});

}

// All remaining Admin API routes require a valid signed session.
if (!(await isAuthenticated(request, env))) {
return json({ error: "Unauthorized" }, 401);
}

if (path === "/api/admin/overview") {
if (request.method !== "GET") {
return json({ error: "Method not allowed" }, 405, {
Allow: "GET",
});
}

return handleOverview(env);

}

if (path === "/api/admin/telegram/webhook-info") {
if (request.method !== "GET") {
return json({ error: "Method not allowed" }, 405, {
Allow: "GET",
});
}

return json(await getTelegramStatus(env));

}

return json({ error: "Admin endpoint not found" }, 404);
}