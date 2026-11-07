/* GET /api/alerts/config — VAPID public key and delivery status for staff. */
import { fail, json } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/auth.js";
import { pushConfigured } from "../../_lib/push.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n, MAX(last_success_at) AS last FROM push_subscriptions"
  ).first();

  return json({
    ok: true,
    configured: pushConfigured(env),
    publicKey: env.VAPID_PUBLIC_KEY || null,
    subject: env.VAPID_SUBJECT || null,
    deviceCount: row ? Number(row.n) : 0,
    lastSuccessAt: (row && row.last) || null
  });
}
