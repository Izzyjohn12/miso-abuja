/* GET /api/health — public liveness check. Exposes counts only, never keys. */
import { json } from "../_lib/http.js";

export async function onRequestGet(context) {
  try {
    const [itemRow, versionRow] = await Promise.all([
      context.env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE hidden = 0").first(),
      context.env.DB.prepare("SELECT value FROM meta WHERE key = 'menu_version'").first()
    ]);
    return json({
      ok: true,
      db: "ok",
      items: Number((itemRow && itemRow.n) || 0),
      menuVersion: String((versionRow && versionRow.value) || "0")
    });
  } catch (err) {
    return json({ ok: false, error: "db_unavailable" }, 503);
  }
}
