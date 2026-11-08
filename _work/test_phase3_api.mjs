/* Phase 3 API tests: staff menu editor, guest menu invalidation and alerts.
 * Run against `wrangler pages dev` with the Phase 3 code. */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto as crypto } from "node:crypto";

const STATIC_MENU = (() => {
  const sandbox = { window: {} };
  vm.runInNewContext(
    readFileSync(new URL("../assets/js/menu.js", import.meta.url), "utf8"),
    sandbox,
    { filename: "menu.js" }
  );
  return sandbox.window.MISO_MENU;
})();
const STATIC_ITEM_COUNT = STATIC_MENU.reduce(
  (total, category) =>
    total + category.groups.reduce((count, group) => count + group.items.length, 0),
  0
);
const STATIC_CATEGORY_COUNT = STATIC_MENU.length;

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
    failures.push(name + (detail ? " - " + detail : ""));
    console.log("FAIL  " + name + (detail ? " - " + detail : ""));
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
    text,
    cookie: response.headers.get("set-cookie") || "",
    headers: response.headers
  };
}

async function fakeSubscription() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: "https://push.invalid/miso-test-" + Math.random().toString(36).slice(2, 12),
    keys: {
      p256dh: Buffer.from(raw).toString("base64url"),
      auth: Buffer.from(auth).toString("base64url")
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function containsDishId(text, id) {
  return text.indexOf('"id":"' + id + '"') !== -1;
}

const CSRF = { "X-MISO-CSRF": "1", Origin: BASE };

async function main() {
  /* --------------------------------------------------------- liveness -- */
  let res = await call("/api/health");
  equal("health is public and 200", res.status, 200);
  equal("health reports the database", res.data.db, "ok");
  check("health reports the item count", Number(res.data.items) >= STATIC_ITEM_COUNT,
    "items " + res.data.items + ", expected at least " + STATIC_ITEM_COUNT);

  /* ----------------------------------------------------- unauthorised -- */
  res = await call("/api/menu/items");
  equal("menu list without a session is 401", res.status, 401);

  res = await call("/api/menu/items", {
    method: "POST",
    headers: CSRF,
    body: { name: "Nope", groupId: "japanese/small-plates", price: 100 }
  });
  equal("menu create without a session is 401", res.status, 401);

  res = await call("/api/menu/items/ebi-fry", {
    method: "PATCH",
    headers: CSRF,
    body: { hidden: true }
  });
  equal("menu patch without a session is 401", res.status, 401);

  res = await call("/api/alerts/config");
  equal("alert config without a session is 401", res.status, 401);

  res = await call("/api/alerts/test", { method: "POST", headers: CSRF });
  equal("test alert without a session is 401", res.status, 401);

  /* ------------------------------------------------------------- login -- */
  const ip = { "CF-Connecting-IP": "203.0.113.70", "X-Forwarded-For": "203.0.113.70" };
  res = await call("/api/auth/login", {
    method: "POST",
    headers: { ...CSRF, ...ip },
    body: { passcode: PASSCODE }
  });
  equal("phase 3 login is 200", res.status, 200);
  const cookie = res.cookie.split(";")[0];
  const auth = { Cookie: cookie, ...CSRF };

  res = await call("/api/menu/items", {
    method: "POST",
    headers: { Cookie: cookie },
    body: { name: "No CSRF Dish", groupId: "japanese/small-plates", price: 100 }
  });
  equal("menu create without CSRF is 403", res.status, 403);

  res = await call("/api/menu/items", {
    method: "POST",
    headers: { Cookie: cookie, "X-MISO-CSRF": "1", Origin: "https://evil.example" },
    body: { name: "Foreign Dish", groupId: "japanese/small-plates", price: 100 }
  });
  equal("menu create from a foreign origin is 403", res.status, 403);

  res = await call("/api/alerts/subscribe", {
    method: "POST",
    headers: { Cookie: cookie },
    body: {}
  });
  equal("alert subscribe without CSRF is 403", res.status, 403);

  /* -------------------------------------------------------------- menu -- */
  const guestBefore = await call("/api/menu");
  equal("guest menu is served", guestBefore.status, 200);
  const etagBefore = guestBefore.headers.get("etag");
  check("guest menu has an ETag", Boolean(etagBefore), etagBefore);

  res = await call("/api/menu/items", { headers: { Cookie: cookie } });
  equal("staff menu list is 200", res.status, 200);
  check("staff menu returns every menu item", Number(res.data.itemCount) === STATIC_ITEM_COUNT,
    "itemCount " + res.data.itemCount + ", expected " + STATIC_ITEM_COUNT);
  check("staff menu returns every category", (res.data.categories || []).length === STATIC_CATEGORY_COUNT,
    "categories " + (res.data.categories || []).length + ", expected " + STATIC_CATEGORY_COUNT);

  const allItems = [];
  for (const category of res.data.categories || []) {
    for (const group of category.groups || []) {
      for (const item of group.items || []) allItems.push(item);
    }
  }
  check("menu item IDs are unique", new Set(allItems.map((item) => item.id)).size === allItems.length);
  const phad = allItems.find((item) => item.id === "phad-thai-prawns");
  const mixMeat = allItems.find((item) => item.id === "mix-meat-fried-rice");
  check("Phad Thai stays price on request", phad && phad.price === null);
  check("Mix Meat Fried Rice stays 35000", mixMeat && mixMeat.price === 35000,
    "price " + (mixMeat || {}).price);

  /* Hide leftovers from an earlier failed run so the guest menu stays clean. */
  for (const item of allItems) {
    if (/^Phase Three Test Dish/.test(item.name) && !item.hidden) {
      await call("/api/menu/items/" + encodeURIComponent(item.id), {
        method: "PATCH",
        headers: auth,
        body: { hidden: true }
      });
    }
  }

  /* --------------------------------------------------------- create -- */
  res = await call("/api/menu/items", {
    method: "POST",
    headers: auth,
    body: {
      name: "Phase Three Test Dish",
      groupId: "japanese/small-plates",
      price: 12345,
      description: "Created by the Phase 3 API test.",
      tags: ["spicy", "veg"]
    }
  });
  equal("menu create is 201", res.status, 201);
  const created = res.data.item || {};
  check("created dish has a slug id", typeof created.id === "string" && created.id.length > 2,
    created.id);
  equal("created dish keeps its price", created.price, 12345);
  equal("created dish is visible", created.hidden, false);
  check("created dish carries both tags",
    JSON.stringify(created.tags) === JSON.stringify(["spicy", "veg"]), JSON.stringify(created.tags));
  equal("created dish uses the chosen group", created.groupId, "japanese/small-plates");
  equal("created dish inherits its category name", created.categoryName, "Japanese");

  const guestAfter = await call("/api/menu");
  check("guest menu exposes the new dish", containsDishId(guestAfter.text, created.id));
  check("menu change bumps the guest ETag", guestAfter.headers.get("etag") !== etagBefore,
    guestBefore.headers.get("etag") + " -> " + guestAfter.headers.get("etag"));
  check("guest menu response is JavaScript",
    /window\.MISO_MENU=/.test(guestAfter.text) && /window\.MISO_SIGNATURES=/.test(guestAfter.text));

  /* Repeat names get a suffix rather than a collision. */
  res = await call("/api/menu/items", {
    method: "POST",
    headers: auth,
    body: { name: "Phase Three Test Dish", groupId: "japanese/small-plates", price: 100 }
  });
  equal("duplicate name create is 201", res.status, 201);
  const secondId = res.data.item && res.data.item.id;
  check("duplicate name gets a unique id", secondId && secondId !== created.id,
    created.id + " / " + secondId);

  /* ---------------------------------------------------------- update -- */
  res = await call("/api/menu/items/" + encodeURIComponent(created.id), {
    method: "PATCH",
    headers: auth,
    body: {
      name: "Phase Three Test Dish Updated",
      description: "Edited by the Phase 3 API test.",
      price: 15000,
      tags: ["shellfish"]
    }
  });
  equal("menu update is 200", res.status, 200);
  equal("updated name", res.data.item && res.data.item.name, "Phase Three Test Dish Updated");
  equal("updated price", res.data.item && res.data.item.price, 15000);
  equal("updated tags", JSON.stringify(res.data.item && res.data.item.tags), '["shellfish"]');

  res = await call("/api/menu/items/" + encodeURIComponent(created.id), {
    method: "PATCH",
    headers: auth,
    body: { priceOnRequest: true }
  });
  equal("price-on-request patch is 200", res.status, 200);
  check("price-on-request sets price null", res.data.item && res.data.item.price === null);

  res = await call("/api/menu/items/" + encodeURIComponent(created.id), {
    method: "PATCH",
    headers: auth,
    body: { price: 15000 }
  });
  equal("price restored", res.data.item && res.data.item.price, 15000);

  /* ------------------------------------------------------------ hide -- */
  res = await call("/api/menu/items/" + encodeURIComponent(created.id), {
    method: "PATCH",
    headers: auth,
    body: { hidden: true }
  });
  equal("hide dish is 200", res.status, 200);
  equal("dish is hidden", res.data.item && res.data.item.hidden, true);

  const guestHidden = await call("/api/menu");
  check("hidden dish leaves the guest menu", !containsDishId(guestHidden.text, created.id));

  res = await call("/api/menu/items", { headers: { Cookie: cookie } });
  const hiddenRow = (() => {
    for (const category of res.data.categories || []) {
      for (const group of category.groups || []) {
        const hit = (group.items || []).find((item) => item.id === created.id);
        if (hit) return hit;
      }
    }
    return null;
  })();
  check("staff menu still shows the hidden dish", hiddenRow && hiddenRow.hidden === true);
  check("hidden count is reported", Number(res.data.hiddenCount) >= 1,
    "hiddenCount " + res.data.hiddenCount);

  res = await call("/api/menu/items/" + encodeURIComponent(created.id), {
    method: "PATCH",
    headers: auth,
    body: { hidden: false }
  });
  equal("restore dish is 200", res.status, 200);
  const guestRestored = await call("/api/menu");
  check("restored dish returns to the guest menu", containsDishId(guestRestored.text, created.id));

  /* ------------------------------------------------------ validation -- */
  res = await call("/api/menu/items", {
    method: "POST",
    headers: auth,
    body: { name: "X", groupId: "japanese/small-plates", price: 100 }
  });
  equal("short name is 400", res.status, 400);
  equal("short name error", res.data.error, "name_required");

  res = await call("/api/menu/items", {
    method: "POST",
    headers: auth,
    body: { name: "Bad Group Dish", groupId: "nope/nope", price: 100 }
  });
  equal("unknown group is 400", res.status, 400);
  equal("unknown group error", res.data.error, "bad_group");

  res = await call("/api/menu/items", {
    method: "POST",
    headers: auth,
    body: { name: "Bad Tag Dish", groupId: "japanese/small-plates", price: 100, tags: ["gold"] }
  });
  equal("unknown tag is 400", res.status, 400);
  equal("unknown tag error", res.data.error, "bad_tags");

  res = await call("/api/menu/items", {
    method: "POST",
    headers: auth,
    body: { name: "Bad Price Dish", groupId: "japanese/small-plates", price: -1 }
  });
  equal("negative price is 400", res.status, 400);
  equal("negative price error", res.data.error, "bad_price");

  res = await call("/api/menu/items/" + encodeURIComponent(created.id), {
    method: "PATCH",
    headers: auth,
    body: {}
  });
  equal("empty patch is 400", res.status, 400);
  equal("empty patch error", res.data.error, "nothing_to_update");

  res = await call("/api/menu/items/not-a-real-dish", {
    method: "PATCH",
    headers: auth,
    body: { hidden: true }
  });
  equal("unknown dish patch is 404", res.status, 404);
  equal("unknown dish error", res.data.error, "not_found");

  res = await call("/api/menu/items/ebi-fry", {
    method: "PATCH",
    headers: auth,
    body: { hidden: "yes" }
  });
  equal("non-boolean hidden is 400", res.status, 400);
  equal("non-boolean hidden error", res.data.error, "bad_hidden");

  /* ------------------------------------------------------------ alerts -- */
  res = await call("/api/alerts/config", { headers: { Cookie: cookie } });
  equal("alert config is 200", res.status, 200);
  equal("push is configured locally", res.data.configured, true);
  check("config exposes a VAPID public key",
    typeof res.data.publicKey === "string" && res.data.publicKey.length > 40);
  check("config never exposes a private key",
    !("privateKey" in res.data) && !("VAPID_PRIVATE_KEY" in res.data) &&
    !("privateKey" in (res.data || {})));

  res = await call("/api/alerts/test", { method: "POST", headers: auth });
  equal("test alert with no subscribers is 200", res.status, 200);
  equal("test alert reports no subscribers",
    res.data.result && res.data.result.error, "no_subscribers");

  const fake = await fakeSubscription();
  res = await call("/api/alerts/subscribe", {
    method: "POST",
    headers: auth,
    body: { endpoint: fake.endpoint, keys: fake.keys }
  });
  equal("subscribe is 200", res.status, 200);
  equal("subscribe counts the device", res.data.deviceCount, 1);

  res = await call("/api/alerts/config", { headers: { Cookie: cookie } });
  equal("device count is visible in config", res.data.deviceCount, 1);

  res = await call("/api/alerts/subscribe", {
    method: "POST",
    headers: auth,
    body: { endpoint: "http://insecure.example/push", keys: fake.keys }
  });
  equal("http push endpoint is 400", res.status, 400);
  equal("endpoint error", res.data.error, "bad_endpoint");

  res = await call("/api/alerts/subscribe", {
    method: "POST",
    headers: auth,
    body: { endpoint: fake.endpoint, keys: { p256dh: "short", auth: "short" } }
  });
  equal("short push keys are 400", res.status, 400);
  equal("key error", res.data.error, "bad_keys");

  res = await call("/api/alerts/subscribe", {
    method: "DELETE",
    headers: auth,
    body: { endpoint: fake.endpoint }
  });
  equal("unsubscribe is 200", res.status, 200);
  equal("unsubscribe clears the device", res.data.deviceCount, 0);

  /* ------------------------------------------------------ order alerts -- */
  const orderRef = "MISO-261107-" + String(Math.floor(Math.random() * 9000) + 1000);
  res = await call("/api/orders", {
    method: "POST",
    headers: CSRF,
    body: {
      ref: orderRef,
      clientToken: "phase3-" + Math.random().toString(36).slice(2, 12),
      service: "pickup",
      details: { name: "Alert Test", phone: "08012345678", pickupTime: "9:00 PM" },
      lines: [{ id: "ebi-fry", qty: 1 }]
    }
  });
  equal("order for alert test is 201", res.status, 201);
  const alertOrderId = res.data.order.id;

  let queued = null;
  for (let i = 0; i < 20; i += 1) {
    const queue = await call("/api/orders?status=all", { headers: { Cookie: cookie } });
    queued = (queue.data.orders || []).find((entry) => entry.id === alertOrderId);
    if (queued && queued.notifyError) break;
    await sleep(150);
  }
  check("order records the alert attempt", queued && queued.notifyError === "no_subscribers",
    queued && queued.notifyError);
  check("order exposes notifiedAt", queued && "notifiedAt" in queued);
  check("order exposes notifyError", queued && "notifyError" in queued);

  res = await call("/api/orders/" + alertOrderId, {
    method: "PATCH",
    headers: auth,
    body: { retryAlert: true }
  });
  equal("retry alert is 200", res.status, 200);
  equal("retry alert reports no subscribers", res.data.alert && res.data.alert.error,
    "no_subscribers");
  equal("retry alert leaves the order alone", res.data.order && res.data.order.status, "new");

  res = await call("/api/orders/" + alertOrderId, {
    method: "PATCH",
    headers: auth,
    body: {}
  });
  equal("empty order patch is 400", res.status, 400);
  equal("empty order patch error", res.data.error, "nothing_to_update");

  /* ---------------------------------------------------------- cleanup -- */
  for (const id of [created.id, secondId]) {
    if (id) {
      await call("/api/menu/items/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: auth,
        body: { hidden: true }
      });
    }
  }

  /* ------------------------------------------------------- logout all -- */
  res = await call("/api/auth/logout", { method: "POST", headers: auth, body: { all: true } });
  equal("logout all is 200", res.status, 200);

  res = await call("/api/auth/session", { headers: { Cookie: cookie } });
  equal("session is dead after logout all", res.status, 401);

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
