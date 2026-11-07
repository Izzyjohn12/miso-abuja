/* PATCH /api/menu/items/:id — edit, move, hide or restore a dish. */
import { fail, hasCsrf, json, readJson, sameOrigin } from "../../../_lib/http.js";
import { requireStaff } from "../../../_lib/auth.js";
import { updateItem } from "../../../_lib/menuAdmin.js";

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  const id = String(params.id || "");
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) return fail(400, "bad_id");

  const body = await readJson(request, 8192);
  if (body.error) return fail(400, body.error);

  const result = await updateItem(env, id, body.data);
  if (result.error) {
    return fail(result.error === "not_found" ? 404 : 400, result.error);
  }
  return json({ ok: true, item: result.item });
}
