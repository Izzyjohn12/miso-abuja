/* GET /api/menu
 *
 * Served as JavaScript, not JSON, so the storefront can load it with a plain
 * deferred <script> between menu.js and app.js. If this endpoint fails, the
 * static menu.js remains in place and the guest site still works.
 */
import { loadMenu, menuScript } from "../_lib/menu.js";

const DEFAULT_MAX_AGE = 30;

function cacheSeconds(env) {
  const value = Number(env && env.MENU_CACHE_SECONDS);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 300) : DEFAULT_MAX_AGE;
}

function jsHeaders(env, version, extra) {
  return {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=" + cacheSeconds(env) + ", must-revalidate",
    ETag: '"miso-menu-' + version + '"',
    "X-Menu-Version": version,
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    ...extra
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  let menu;
  try {
    menu = await loadMenu(env);
  } catch (err) {
    return new Response("/* MISO menu temporarily unavailable */\n", {
      status: 503,
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "30",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow"
      }
    });
  }

  const etag = '"miso-menu-' + menu.version + '"';
  const headers = jsHeaders(env, menu.version);
  if ((request.headers.get("If-None-Match") || "").includes(etag)) {
    delete headers["Content-Type"];
    return new Response(null, { status: 304, headers });
  }

  return new Response(menuScript(menu), { status: 200, headers });
}
