/* POST /api/alerts/test — send a test notification to every staff device. */
import { fail, hasCsrf, json, sameOrigin } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/auth.js";
import { notifyStaff, pushConfigured } from "../../_lib/push.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  if (!pushConfigured(env)) return fail(503, "push_not_configured");

  const result = await notifyStaff(env, null, { test: true });
  return json({ ok: result.sent > 0, result });
}
