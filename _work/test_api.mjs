/* Phase 2 API tests against a local `wrangler pages dev` server. */

import { readFileSync } from "node:fs";

const BASE = process.env.MISO_TEST_BASE || "http://127.0.0.1:8788";

function loadPasscode() {
  if (process.env.MISO_TEST_PASSCODE) return process.env.MISO_TEST_PASSCODE;
  try {
    const text = readFileSync(new URL("./staff-passcode.txt", import.meta.url), "utf8");
    const match = text.match(/MISO-[A-Z0-9-]+/);
    return match ? match[0] : "";
  } catch (err) {
    return "";
  }
}

const PASSCODE = loadPasscode();
if (!PASSCODE) {
  console.error("No staff passcode: set MISO_TEST_PASSCODE or keep _work/staff-passcode.txt.");
  process.exit(1);
}

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log("PASS  " + name);
  } else {
    failures.push(name + (detail ? " — " + detail : ""));
    console.log("FAIL  " + name + (detail ? " — " + detail : ""));
  }
}

function equal(name, actual, expected) {
  check(name, actual === expected, "expected " + expected + ", got " + actual);
}

async function call(path, options = {}) {
  const headers = options.headers || {};
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(BASE + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: "manual"
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    data = { raw: text };
  }
  return {
    status: response.status,
    data,
    cookie: response.headers.get("set-cookie") || "",
    headers: response.headers
  };
}

function ref(suffix) {
  return "MISO-261107-" + String(suffix).padStart(4, "0");
}

function payload(overrides = {}) {
  return {
    ref: ref(1),
    clientToken: "test-" + Math.random().toString(36).slice(2, 12),
    service: "pickup",
    details: { name: "Test Guest", phone: "08012345678", pickupTime: "8:00 PM" },
    lines: [
      { id: "ebi-fry", qty: 2, note: "" },
      { id: "miso-shiro", qty: 1, note: "No tofu" }
    ],
    clientTotal: 84095,
    ...overrides
  };
}

const CSRF = { "X-MISO-CSRF": "1", Origin: BASE };

async function main() {
  /* ---------------------------------------------------- unauthenticated -- */
  let res = await call("/api/orders?status=all");
  equal("GET orders without a session is 401", res.status, 401);

  res = await call("/api/orders", { method: "POST", body: payload() });
  equal("POST order without CSRF is 403", res.status, 403);

  res = await call("/api/orders", {
    method: "POST",
    headers: { "X-MISO-CSRF": "1", Origin: "https://evil.example" },
    body: payload()
  });
  equal("POST order from foreign origin is 403", res.status, 403);

  res = await call("/api/auth/session");
  equal("session check before login is 401", res.status, 401);

  /* ------------------------------------------------------------ orders -- */
  const first = payload({ ref: ref(11), clientTotal: 1 });
  const ip = { "CF-Connecting-IP": "203.0.113.11", "X-Forwarded-For": "203.0.113.11" };

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: first
  });
  equal("valid order returns 201", res.status, 201);
  const order = res.data.order || {};
  check("server prices the order (84095)", order.total === 84095, "total " + order.total);
  check("subtotal is 76450", order.subtotal === 76450, "subtotal " + order.subtotal);
  check("tax is 7645", order.tax === 7645, "tax " + order.tax);
  equal("order starts as new", order.status, "new");
  equal("pickup is unpaid", order.paymentStatus, "unpaid");
  check("clientTotal is not trusted", order.total === 84095 && order.total !== 1);

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: first
  });
  equal("repeat clientToken returns 200", res.status, 200);
  equal("repeat marks duplicate", res.data.duplicate, true);
  equal("duplicate returns the same order", res.data.order && res.data.order.id, order.id);

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: payload({ ref: ref(11), clientTotal: 84095 })
  });
  equal("reused reference is 409", res.status, 409);
  equal("reused reference error", res.data.error, "ref_taken");

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: payload({ ref: ref(12), lines: [{ id: "phad-thai-prawns", qty: 1 }] })
  });
  equal("price-on-request dish is 409", res.status, 409);
  equal("price-on-request error", res.data.error, "menu_changed");

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: payload({ ref: ref(13), lines: [{ id: "not-a-dish", qty: 1 }] })
  });
  equal("unknown dish is 409", res.status, 409);
  equal("unknown dish error", res.data.error, "menu_changed");

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: payload({ ref: ref(14), lines: [{ id: "ebi-fry", qty: 21 }] })
  });
  equal("qty above 20 is 400", res.status, 400);
  equal("qty error", res.data.error, "bad_qty");

  const many = [];
  for (let i = 0; i < 31; i += 1) many.push({ id: "x" + i, qty: 1 });
  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: payload({ ref: ref(15), lines: many })
  });
  equal("more than 30 lines is 400", res.status, 400);
  equal("line-count error", res.data.error, "too_many_lines");

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: payload({ ref: "NOPE-1" })
  });
  equal("malformed reference is 400", res.status, 400);
  equal("reference error", res.data.error, "bad_ref");

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: payload({ ref: ref(16), service: "maitama", details: { name: "Test Guest", phone: "08012345678" } })
  });
  equal("delivery without address is 400", res.status, 400);
  equal("delivery address error", res.data.error, "address_required");

  res = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: payload({
      ref: ref(17),
      service: "dine-in",
      details: { tableNumber: "12" },
      lines: [{ id: "mix-meat-fried-rice", qty: 1 }]
    })
  });
  equal("dine-in order returns 201", res.status, 201);
  check("dine-in is pay later", res.data.order && res.data.order.paymentStatus === "pay_later");
  check("dine-in total is 38500", res.data.order.total === 38500, "total " + (res.data.order || {}).total);
  const dineInId = res.data.order.id;

  /* ------------------------------------------------------------- auth -- */
  const badIp = { "CF-Connecting-IP": "203.0.113.50", "X-Forwarded-For": "203.0.113.50" };
  const probeIp = { "CF-Connecting-IP": "203.0.113.60", "X-Forwarded-For": "203.0.113.60" };

  res = await call("/api/auth/login", {
    method: "POST",
    headers: { ...CSRF, ...probeIp },
    body: { passcode: "WRONG-CODE" }
  });
  equal("wrong passcode is 401", res.status, 401);

  res = await call("/api/auth/login", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: { passcode: PASSCODE }
  });
  equal("correct passcode is 200", res.status, 200);
  const cookie = res.cookie.split(";")[0];
  check("login sets a session cookie", Boolean(cookie && cookie.indexOf("miso_staff=") === 0), cookie);
  check("session cookie is HttpOnly", /HttpOnly/i.test(res.cookie));
  check("session cookie is SameSite=Strict", /SameSite=Strict/i.test(res.cookie));

  res = await call("/api/auth/session", { headers: { Cookie: cookie } });
  equal("session check after login is 200", res.status, 200);
  equal("session is authenticated", res.data.authenticated, true);

  res = await call("/api/orders?status=all", { headers: { Cookie: cookie } });
  equal("staff queue is 200", res.status, 200);
  check("staff queue contains the order", Array.isArray(res.data.orders) &&
    res.data.orders.some((entry) => entry.id === order.id));
  check("queue items carry names and prices", (() => {
    const entry = res.data.orders.find((row) => row.id === order.id);
    return entry && entry.items.length === 2 && entry.items[0].name === "Ebi Fry" &&
      entry.items[0].lineTotal === 57200;
  })());

  /* ------------------------------------------------------------ patches -- */
  res = await call("/api/orders/" + order.id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: { status: "preparing" }
  });
  equal("PATCH without CSRF is 403", res.status, 403);

  res = await call("/api/orders/" + order.id, {
    method: "PATCH",
    headers: { Cookie: cookie, ...CSRF },
    body: { status: "ready" }
  });
  equal("illegal transition is 409", res.status, 409);
  equal("transition error", res.data.error, "bad_transition");

  res = await call("/api/orders/" + order.id, {
    method: "PATCH",
    headers: { Cookie: cookie, ...CSRF },
    body: { status: "preparing" }
  });
  equal("new to preparing is 200", res.status, 200);
  equal("order is preparing", res.data.order && res.data.order.status, "preparing");

  res = await call("/api/orders/" + order.id, {
    method: "PATCH",
    headers: { Cookie: cookie, ...CSRF },
    body: { status: "ready" }
  });
  equal("preparing to ready is 200", res.status, 200);

  res = await call("/api/orders/" + order.id, {
    method: "PATCH",
    headers: { Cookie: cookie, ...CSRF },
    body: { paymentStatus: "paid" }
  });
  equal("mark paid is 200", res.status, 200);
  equal("order is paid", res.data.order && res.data.order.paymentStatus, "paid");

  res = await call("/api/orders/" + order.id, {
    method: "PATCH",
    headers: { Cookie: cookie, ...CSRF },
    body: { status: "completed" }
  });
  equal("ready to completed is 200", res.status, 200);

  res = await call("/api/orders/" + dineInId, {
    method: "PATCH",
    headers: { Cookie: cookie, ...CSRF },
    body: { status: "cancelled" }
  });
  equal("new to cancelled is 200", res.status, 200);

  res = await call("/api/orders?status=active", { headers: { Cookie: cookie } });
  check("completed order leaves the active queue",
    Array.isArray(res.data.orders) && !res.data.orders.some((entry) => entry.id === order.id));

  res = await call("/api/orders?status=cancelled", { headers: { Cookie: cookie } });
  check("cancelled order appears in the cancelled filter",
    Array.isArray(res.data.orders) && res.data.orders.some((entry) => entry.id === dineInId));

  res = await call("/api/orders/not-a-uuid", {
    method: "PATCH",
    headers: { Cookie: cookie, ...CSRF },
    body: { status: "preparing" }
  });
  equal("bad order id is 400", res.status, 400);

  /* ------------------------------------------------------- throttling -- */
  res = await call("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie, ...CSRF }
  });
  equal("logout is 200", res.status, 200);

  res = await call("/api/orders?status=all", { headers: { Cookie: cookie } });
  equal("session is dead after logout", res.status, 401);

  for (let i = 0; i < 5; i += 1) {
    res = await call("/api/auth/login", {
      method: "POST",
      headers: { ...CSRF, ...badIp },
      body: { passcode: "WRONG-" + i }
    });
    equal("failed login " + (i + 1) + " is 401", res.status, 401);
  }
  res = await call("/api/auth/login", {
    method: "POST",
    headers: { ...CSRF, ...badIp },
    body: { passcode: "WRONG-5" }
  });
  equal("sixth failed login is 429", res.status, 429);
  equal("throttle error", res.data.error, "too_many_attempts");
  equal("throttle sets Retry-After", res.headers.get("retry-after"), "900");

  console.log("\n" + passed + " passed, " + failures.length + " failed");
  if (failures.length) {
    console.log("Failures:");
    failures.forEach((name) => console.log("  - " + name));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exitCode = 1;
});
