/* /api/orders
 * POST — public, creates an order after re-pricing it from D1.
 * GET  — staff only, returns the order queue.
 */
import { clientIp, fail, hasCsrf, json, nowIso, readJson, sameOrigin } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/auth.js";
import {
  checkOrderRate,
  listOrders,
  loadOrderItems,
  parseOrderBody,
  priceLines,
  serializeOrder,
  totalsFor
} from "../../_lib/orders.js";

function duplicateResponse(env, row) {
  return loadOrderItems(env, [row.id]).then((items) =>
    json(
      {
        ok: true,
        duplicate: true,
        order: serializeOrder(row, items.get(row.id) || [])
      },
      200
    )
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return fail(403, "forbidden");
  if (!hasCsrf(request)) return fail(403, "forbidden");

  const body = await readJson(request, 32768);
  if (body.error) return fail(400, body.error);

  const parsed = parseOrderBody(body.data);
  if (parsed.error) return fail(400, parsed.error);
  const { ref, clientToken, service, details, lines, clientTotal } = parsed.value;

  const existing = await env.DB.prepare(
    "SELECT * FROM orders WHERE client_token = ?"
  ).bind(clientToken).first();
  if (existing) return duplicateResponse(env, existing);

  const ip = clientIp(request);
  if (!(await checkOrderRate(env, ip))) {
    return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "600" });
  }

  const refTaken = await env.DB.prepare("SELECT id FROM orders WHERE ref = ?").bind(ref).first();
  if (refTaken) return fail(409, "ref_taken");

  const priced = await priceLines(env, lines);
  if (priced.unavailable) {
    return fail(409, "menu_changed", { items: priced.unavailable });
  }

  const totals = totalsFor(priced.subtotal, service);
  const orderId = crypto.randomUUID();
  const placedAt = nowIso();
  const dineIn = service === "dine-in";

  const insertOrder = env.DB.prepare(
    "INSERT INTO orders (" +
      "id, ref, client_token, placed_at, service, status, payment_status, " +
      "customer_name, customer_phone, details_json, notes, subtotal, tax, tax_rate, " +
      "fee, fee_pending, total, due_now, client_total, created_ip" +
      ") VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    orderId,
    ref,
    clientToken,
    placedAt,
    service,
    dineIn ? "pay_later" : "unpaid",
    dineIn ? null : details.name,
    dineIn ? null : details.phone,
    JSON.stringify(details),
    details.notes || null,
    totals.subtotal,
    totals.tax,
    totals.taxRate,
    totals.fee,
    totals.feePending ? 1 : 0,
    totals.total,
    totals.dueNow,
    clientTotal,
    ip
  );

  const statements = [insertOrder];
  for (const item of priced.items) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO order_items (" +
          "order_id, item_id, name, qty, unit_price, line_total, note, tags, category" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        orderId,
        item.itemId,
        item.name,
        item.qty,
        item.unitPrice,
        item.lineTotal,
        item.note || null,
        item.tags,
        item.category
      )
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (err) {
    // A racing retry or another device can win the unique index.
    const retry = await env.DB.prepare(
      "SELECT * FROM orders WHERE client_token = ?"
    ).bind(clientToken).first();
    if (retry) return duplicateResponse(env, retry);
    const refRetry = await env.DB.prepare("SELECT id FROM orders WHERE ref = ?").bind(ref).first();
    if (refRetry) return fail(409, "ref_taken");
    console.error("order_insert_failed", err);
    return fail(500, "server_error");
  }

  return json(
    {
      ok: true,
      duplicate: false,
      order: {
        id: orderId,
        ref,
        status: "new",
        paymentStatus: dineIn ? "pay_later" : "unpaid",
        placedAt,
        subtotal: totals.subtotal,
        tax: totals.tax,
        taxRate: totals.taxRate,
        fee: totals.fee,
        feePending: totals.feePending,
        total: totals.total,
        dueNow: totals.dueNow
      }
    },
    201
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await requireStaff(env, request);
  if (!session) return fail(401, "unauthenticated");

  const status = new URL(request.url).searchParams.get("status");
  const filter = status === "all" || status === "cancelled" ? status : "active";
  const orders = await listOrders(env, filter);
  return json({ ok: true, orders, count: orders.length, serverTime: nowIso() });
}
