/* POST /api/auth/login — shared staff passcode. */
import { clientIp, fail, hasCsrf, json, readJson, sameOrigin } from "../../_lib/http.js";
import {
  clearLoginFailures,
  createSession,
  LOGIN_MAX,
  parsePasscodeHash,
  recentLoginFailures,
  recordLoginFailure,
  sessionCookie,
  verifyPasscode
} from "../../_lib/auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const body = await readJson(request, 4096);
  if (body.error) return fail(400, body.error);

  const passcode = typeof body.data.passcode === "string" ? body.data.passcode.trim() : "";
  if (passcode.length < 4 || passcode.length > 64) return fail(400, "bad_passcode");

  const stored = parsePasscodeHash(env.STAFF_PASSCODE_HASH);
  if (!stored) return fail(503, "login_not_configured");

  const ip = clientIp(request);
  const failures = await recentLoginFailures(env, ip);
  if (failures >= LOGIN_MAX) {
    return json(
      { ok: false, error: "too_many_attempts" },
      429,
      { "Retry-After": "900" }
    );
  }

  const valid = await verifyPasscode(passcode, stored);
  if (!valid) {
    await recordLoginFailure(env, ip);
    return fail(401, "invalid_passcode");
  }

  await clearLoginFailures(env, ip);
  const session = await createSession(env, request);
  return json(
    { ok: true, expiresAt: session.expiresAt },
    200,
    { "Set-Cookie": sessionCookie(request, session.token, session.maxAge) }
  );
}
