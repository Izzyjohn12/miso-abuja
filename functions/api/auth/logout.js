/* POST /api/auth/logout — drop this browser's session. */
import { fail, hasCsrf, json, sameOrigin } from "../../_lib/http.js";
import { clearedCookie, deleteSession, requireStaff } from "../../_lib/auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const session = await requireStaff(env, request);
  if (session) await deleteSession(env, session.id);

  return json({ ok: true }, 200, { "Set-Cookie": clearedCookie(request) });
}
