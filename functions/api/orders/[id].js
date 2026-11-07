/* PATCH /api/orders/:id — staff status and payment transitions. */
import { fail, hasCsrf, json, readJson, sameOrigin } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/auth.js";
import { findOrder } from "../../_lib/orders.js";
import { notifyStaff } from "../../_lib/push.js";

const STATUSES = ["new", "preparing", "ready", "completed", "cancelled"];
const PAYMENTS = ["unpaid", "paid", "pay_later"];
const TRANSITIONS = {
  new: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  const id = params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) return fail(400, "bad_id");

  const body = await readJson(request, 4096);
  if (body.error) return fail(400, body.error);

  const row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!row) return fail(404, "not_found");

  const updates = {};
  const data = body.data;
  const retryAlert = data.retryAlert === true;

  if (data.status !== undefined) {
    const status = String(data.status);
    if (!STATUSES.includes(status)) return fail(400, "bad_status");
    if (status !== row.status) {
      if (!(TRANSITIONS[row.status] || []).includes(status)) {
        return fail(409, "bad_transition", { status: row.status });
      }
      updates.status = status;
    }
  }

  if (data.paymentStatus !== undefined) {
    const paymentStatus = String(data.paymentStatus);
    if (!PAYMENTS.includes(paymentStatus)) return fail(400, "bad_payment_status");
    if (paymentStatus !== row.payment_status) updates.payment_status = paymentStatus;
  }

  const fields = Object.keys(updates);
  if (!fields.length && !retryAlert) return fail(400, "nothing_to_update");

  if (fields.length) {
    const assignments = fields.map((field) => field + " = ?").join(", ");
    await env.DB.prepare("UPDATE orders SET " + assignments + " WHERE id = ?")
      .bind(...fields.map((field) => updates[field]), id)
      .run();
  }

  const order = await findOrder(env, id);
  if (!retryAlert) return json({ ok: true, order });

  const alert = await notifyStaff(env, {
    id: order.id,
    ref: order.ref,
    service: order.service,
    serviceLabel: order.serviceLabel,
    serviceDetail: order.serviceDetail,
    itemCount: order.itemCount,
    total: order.total
  });
  return json({ ok: true, order: await findOrder(env, id), alert });
}
