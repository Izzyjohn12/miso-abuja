/* Small HTTP helpers shared by the Pages Functions. */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow"
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

export function fail(status, error, extra = {}) {
  return json({ ok: false, error, ...extra }, status);
}

/* Browsers send Origin on same-origin POST/PATCH. A foreign Origin or Referer
   is rejected; a missing one is allowed so command-line checks still work. */
export function sameOrigin(request) {
  const host = new URL(request.url).host;
  const source = request.headers.get("Origin") || request.headers.get("Referer");
  if (!source) return true;
  try {
    return new URL(source).host === host;
  } catch (err) {
    return false;
  }
}

export function hasCsrf(request) {
  return request.headers.get("X-MISO-CSRF") === "1";
}

export async function readJson(request, maxBytes = 32768) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (type.indexOf("application/json") === -1) return { error: "bad_content_type" };
  const text = await request.text();
  if (text.length > maxBytes) return { error: "payload_too_large" };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "bad_json" };
    return { data };
  } catch (err) {
    return { error: "bad_json" };
  }
}

export function clientIp(request) {
  const value =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  return value.split(",")[0].trim().slice(0, 60);
}

export function nowIso() {
  return new Date().toISOString();
}
