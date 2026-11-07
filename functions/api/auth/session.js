/* GET /api/auth/session — is this browser signed in? */
import { fail, json } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/auth.js";

export async function onRequestGet(context) {
  const session = await requireStaff(context.env, context.request);
  if (!session) return fail(401, "unauthenticated");
  return json({ ok: true, authenticated: true, expiresAt: session.expiresAt });
}
