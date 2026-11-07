/* POST/DELETE /api/alerts/subscribe — store or remove this device's push
 * subscription. Only the anonymous push endpoint and its two public keys are
 * kept; no staff identity is attached. */
import { fail, hasCsrf, json, readJson, sameOrigin } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/auth.js";

const KEY_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

function cleanEndpoint(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 600) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch (err) {
    return null;
  }
}

async function deviceCount(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first();
  return row ? Number(row.n) : 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  const body = await readJson(request, 8192);
  if (body.error) return fail(400, body.error);

  const endpoint = cleanEndpoint(body.data.endpoint);
  const keys = body.data.keys;
  if (!endpoint) return fail(400, "bad_endpoint");
  if (!keys || typeof keys !== "object") return fail(400, "bad_keys");

  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  if (!KEY_PATTERN.test(p256dh) || p256dh.length < 40) return fail(400, "bad_keys");
  if (!KEY_PATTERN.test(auth) || auth.length < 12) return fail(400, "bad_keys");

  const userAgent = (request.headers.get("User-Agent") || "").slice(0, 200);

  await env.DB.prepare(
    "INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(endpoint) DO UPDATE SET " +
      "p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent"
  ).bind(endpoint, p256dh, auth, userAgent).run();

  return json({ ok: true, deviceCount: await deviceCount(env) });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  const body = await readJson(request, 4096);
  if (body.error) return fail(400, body.error);

  const endpoint = cleanEndpoint(body.data.endpoint);
  if (!endpoint) return fail(400, "bad_endpoint");

  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
    .bind(endpoint).run();

  return json({ ok: true, deviceCount: await deviceCount(env) });
}
