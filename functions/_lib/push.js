/* Web Push delivery for staff devices (RFC 8291 aes128gcm + VAPID).
 * A failed alert never blocks the guest response; the order row records the
 * outcome so the staff card can offer a retry. */

import { buildPushPayload } from "@block65/webcrypto-web-push";
import { nowIso } from "./http.js";

const SEND_TIMEOUT_MS = 4000;
const TTL_SECONDS = 3600;

export function pushConfigured(env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export function orderNotice(order) {
  const bits = [];
  const service = order.serviceLabel || order.service || "Order";
  const detail = order.serviceDetail || "";
  bits.push(detail ? service + " \u00b7 " + detail : service);

  const itemCount = Number(order.itemCount) || 0;
  if (itemCount) bits.push(itemCount + (itemCount === 1 ? " item" : " items"));

  if (order.total !== undefined && order.total !== null) {
    bits.push("\u20a6" + Number(order.total).toLocaleString("en-NG"));
  }

  return {
    kind: "order",
    title: "New MISO order \u2014 " + order.ref,
    body: bits.join(" \u00b7 "),
    tag: order.ref,
    url: "/staff/#orders",
    orderId: order.id || null,
    ref: order.ref,
    requireInteraction: true
  };
}

function testNotice() {
  return {
    kind: "test",
    title: "MISO test alert",
    body: "Push alerts are working on this staff device.",
    tag: "miso-test",
    url: "/staff/#alerts",
    requireInteraction: false
  };
}

async function recordOrderOutcome(env, orderId, sent, error) {
  if (!orderId) return;
  await env.DB.prepare(
    "UPDATE orders SET notified_at = ?, notify_error = ? WHERE id = ?"
  ).bind(sent > 0 ? nowIso() : null, error, orderId).run();
}

/* Sends to every stored subscription. Removes endpoints the push service no
 * longer knows (404/410). Returns counts only — never keys. */
export async function notifyStaff(env, order, options = {}) {
  const result = { attempted: 0, sent: 0, failed: 0, removed: 0, error: null };

  if (!pushConfigured(env)) {
    result.error = "push_not_configured";
    if (order && order.id) await recordOrderOutcome(env, order.id, 0, result.error);
    return result;
  }

  const rows = await env.DB.prepare(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions"
  ).all();
  const subscriptions = rows.results || [];
  result.attempted = subscriptions.length;

  if (!subscriptions.length) {
    result.error = "no_subscribers";
    if (order && order.id) await recordOrderOutcome(env, order.id, 0, result.error);
    return result;
  }

  const data = options.test ? testNotice() : orderNotice(order);
  const message = {
    data,
    options: { ttl: TTL_SECONDS, urgency: options.test ? "normal" : "high" }
  };
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };

  await Promise.all(subscriptions.map(async (row) => {
    try {
      const payload = await buildPushPayload(
        message,
        {
          endpoint: row.endpoint,
          expirationTime: null,
          keys: { p256dh: row.p256dh, auth: row.auth }
        },
        vapid
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(row.endpoint, {
          method: "POST",
          headers: payload.headers,
          body: payload.body,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 404 || response.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
          .bind(row.endpoint).run();
        result.removed += 1;
      } else if (response.ok) {
        result.sent += 1;
        await env.DB.prepare(
          "UPDATE push_subscriptions SET last_success_at = ? WHERE endpoint = ?"
        ).bind(nowIso(), row.endpoint).run();
      } else {
        result.failed += 1;
      }
    } catch (err) {
      result.failed += 1;
    }
  }));

  result.error = result.sent > 0 ? null : "delivery_failed";
  if (order && order.id) await recordOrderOutcome(env, order.id, result.sent, result.error);
  return result;
}
