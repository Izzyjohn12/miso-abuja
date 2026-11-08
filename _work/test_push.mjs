/* Unit test for functions/_lib/push.js with a fake D1 binding and fetch.
 * Verifies RFC 8291 payload construction, delivery counts, 410 cleanup and the
 * alert outcome written back to the order row. No network is used. */

import { webcrypto as crypto } from "node:crypto";

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log("PASS  " + name);
  } else {
    failures.push(name + (detail ? " - " + detail : ""));
    console.log("FAIL  " + name + (detail ? " - " + detail : ""));
  }
}

function equal(name, actual, expected) {
  check(name, actual === expected, "expected " + expected + ", got " + actual);
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function makeVapid() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: base64url(raw), privateKey: jwk.d };
}

async function makeSubscription(endpoint) {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { endpoint, p256dh: base64url(raw), auth: base64url(auth) };
}

class FakeDB {
  constructor(subscriptions) {
    this.subscriptions = subscriptions;
    this.calls = [];
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async run() {
            db.calls.push({ sql, args });
            return { success: true };
          },
          async all() {
            db.calls.push({ sql, args });
            return { results: db.subscriptions };
          },
          async first() {
            db.calls.push({ sql, args });
            return null;
          }
        };
      },
      async all() {
        db.calls.push({ sql, args: [] });
        return { results: db.subscriptions };
      },
      async first() {
        db.calls.push({ sql, args: [] });
        return null;
      },
      async run() {
        db.calls.push({ sql, args: [] });
        return { success: true };
      }
    };
  }

  servedOrderUpdate() {
    const updates = this.calls.filter((call) =>
      call.sql.indexOf("UPDATE orders SET notified_at") === 0
    );
    return updates.length ? updates[updates.length - 1].args : null;
  }

  removed(endpoint) {
    return this.calls.some((call) =>
      call.sql.indexOf("DELETE FROM push_subscriptions") === 0 && call.args[0] === endpoint
    );
  }
}

const { notifyStaff, orderNotice, pushConfigured } = await import("../functions/_lib/push.js");

const vapid = await makeVapid();
const baseEnv = {
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "https://miso-abuja.pages.dev"
};

const order = {
  id: "order-1",
  ref: "MISO-261107-0001",
  serviceLabel: "Pickup",
  serviceDetail: "8:00 PM",
  itemCount: 3,
  total: 84095
};

/* ------------------------------------------------------ notice shaping -- */
const notice = orderNotice(order);
equal("notice title names the order", notice.title, "New MISO order \u2014 MISO-261107-0001");
check("notice body has service, items and total",
  notice.body.indexOf("Pickup") !== -1 &&
  notice.body.indexOf("3 items") !== -1 &&
  notice.body.indexOf("\u20a684,095") !== -1,
  notice.body);
equal("notice deep-links to the queue", notice.url, "/staff/#orders");
equal("notice tag is the order reference", notice.tag, "MISO-261107-0001");
equal("notice requires interaction", notice.requireInteraction, true);
equal("notice marks the order kind", notice.kind, "order");
equal("notice carries the order id", notice.orderId, order.id);
equal("notice carries the reference", notice.ref, order.ref);

const singular = orderNotice({ ...order, itemCount: 1 });
check("single item is not pluralised", singular.body.indexOf("1 item") !== -1, singular.body);

/* ---------------------------------------------------- unconfigured env -- */
let db = new FakeDB([]);
let result = await notifyStaff({ DB: db }, order);
equal("missing keys report push_not_configured", result.error, "push_not_configured");
let outcome = db.servedOrderUpdate();
check("unconfigured alert records the failure", outcome && outcome[0] === null &&
  outcome[1] === "push_not_configured", JSON.stringify(outcome));
check("pushConfigured is false without a private key",
  pushConfigured({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_SUBJECT: "x" }) === false);

/* ------------------------------------------------------ no subscribers -- */
db = new FakeDB([]);
result = await notifyStaff({ ...baseEnv, DB: db }, order);
equal("no subscriptions report no_subscribers", result.error, "no_subscribers");
equal("no subscriptions are attempted", result.attempted, 0);
outcome = db.servedOrderUpdate();
check("no-subscriber alert records the failure", outcome && outcome[1] === "no_subscribers",
  JSON.stringify(outcome));

/* ------------------------------------------------------------- success -- */
const okSub = await makeSubscription("https://push.example/send/ok");
const goneSub = await makeSubscription("https://push.example/send/gone");
db = new FakeDB([okSub, goneSub]);

const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url, init });
  if (String(url).indexOf("/gone") !== -1) return new Response("", { status: 410 });
  return new Response("", { status: 201 });
};

result = await notifyStaff({ ...baseEnv, DB: db }, order);
equal("two subscriptions are attempted", result.attempted, 2);
equal("one alert is sent", result.sent, 1);
equal("no alerts fail", result.failed, 0);
equal("the gone endpoint is removed", result.removed, 1);
equal("a successful alert clears the error", result.error, null);
check("the 410 endpoint is deleted", db.removed(goneSub.endpoint));
check("the live endpoint gets last_success_at",
  db.calls.some((call) => call.sql.indexOf("UPDATE push_subscriptions") === 0 &&
    call.args[1] === okSub.endpoint));
outcome = db.servedOrderUpdate();
check("a successful alert stamps notified_at",
  outcome && typeof outcome[0] === "string" && outcome[1] === null, JSON.stringify(outcome));

equal("one HTTP request per subscription", requests.length, 2);
const sent = requests.find((entry) => entry.url === okSub.endpoint);
check("push request uses POST", sent && sent.init.method === "POST");
check("push request is aes128gcm",
  sent && /aes128gcm/i.test(sent.init.headers["content-encoding"] || sent.init.headers["Content-Encoding"] || ""),
  sent && JSON.stringify(Object.keys(sent.init.headers)));
check("push request is VAPID authorised",
  sent && /^vapid\s+t=/i.test(sent.init.headers.authorization || sent.init.headers.Authorization || ""),
  sent && (sent.init.headers.authorization || sent.init.headers.Authorization));
check("push payload is padded to 4096 octets", sent && sent.init.body.length === 4096,
  sent && sent.init.body.length);
check("push request sets a TTL",
  sent && Boolean(sent.init.headers.ttl || sent.init.headers.TTL),
  sent && JSON.stringify(sent.init.headers));

/* ---------------------------------------------------------- all failed -- */
const failSub = await makeSubscription("https://push.example/send/fail");
db = new FakeDB([failSub]);
globalThis.fetch = async () => new Response("", { status: 500 });

result = await notifyStaff({ ...baseEnv, DB: db }, order);
equal("a 500 counts as failed", result.failed, 1);
equal("nothing is sent", result.sent, 0);
equal("all-failed reports delivery_failed", result.error, "delivery_failed");
outcome = db.servedOrderUpdate();
check("all-failed clears notified_at and stores the error",
  outcome && outcome[0] === null && outcome[1] === "delivery_failed", JSON.stringify(outcome));

/* ------------------------------------------------------- network error -- */
db = new FakeDB([failSub]);
globalThis.fetch = async () => { throw new Error("offline"); };
result = await notifyStaff({ ...baseEnv, DB: db }, order);
equal("a network error counts as failed", result.failed, 1);
equal("network error keeps the endpoint", result.removed, 0);
equal("network error reports delivery_failed", result.error, "delivery_failed");

/* ------------------------------------------------------- test notice -- */
db = new FakeDB([okSub]);
const testRequests = [];
globalThis.fetch = async (url, init) => {
  testRequests.push({ url, init });
  return new Response("", { status: 201 });
};
result = await notifyStaff({ ...baseEnv, DB: db }, null, { test: true });
equal("a test alert is sent", result.sent, 1);
equal("a test alert does not touch an order", db.servedOrderUpdate(), null);
check("a test payload is still 4096 octets", testRequests[0].init.body.length === 4096);

console.log("\n" + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  console.log("Failures:");
  failures.forEach((name) => console.log("  - " + name));
  process.exitCode = 1;
}
