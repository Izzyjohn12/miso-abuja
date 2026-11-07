/* /api/menu/items — staff menu list and create. */
import { fail, hasCsrf, json, readJson, sameOrigin } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/auth.js";
import { createItem, listMenuForStaff } from "../../_lib/menuAdmin.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  const menu = await listMenuForStaff(env);
  return json({ ok: true, ...menu });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  const body = await readJson(request, 8192);
  if (body.error) return fail(400, body.error);

  const result = await createItem(env, body.data);
  if (result.error) {
    return fail(result.error === "not_found" ? 404 : 400, result.error);
  }
  return json({ ok: true, item: result.item }, 201);
}
