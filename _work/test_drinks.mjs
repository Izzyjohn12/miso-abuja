/* Drinks menu tests: static data, live D1 parity and ordering.
 * Run against `wrangler pages dev` on 8788 after applying migration 0003. */

import { readFileSync } from "node:fs";
import vm from "node:vm";

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
  return { status: response.status, data, text, cookie: response.headers.get("set-cookie") || "" };
}

function staticMenu() {
  const sandbox = { window: {} };
  vm.runInNewContext(
    readFileSync(new URL("../assets/js/menu.js", import.meta.url), "utf8"),
    sandbox,
    { filename: "menu.js" }
  );
  return { menu: sandbox.window.MISO_MENU, signatures: sandbox.window.MISO_SIGNATURES };
}

function flatten(menu) {
  const rows = [];
  for (const category of menu) {
    for (const group of category.groups) {
      for (const item of group.items) rows.push({ category: category.id, group: group.name, ...item });
    }
  }
  return rows;
}

const CSRF = { "X-MISO-CSRF": "1", Origin: BASE };

async function main() {
  const { menu, signatures } = staticMenu();
  const rows = flatten(menu);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  equal("static menu has 9 categories", menu.length, 9);
  equal("static menu has 281 items", rows.length, 281);
  equal("signatures are untouched", signatures.length, 4);

  const drinks = menu.find((cat) => cat.id === "drinks");
  const spirits = menu.find((cat) => cat.id === "spirits");
  const wine = menu.find((cat) => cat.id === "wine");
  check("drinks category is present at position 7", menu[6] && menu[6].id === "drinks");
  equal("drinks has 8 groups", drinks.groups.length, 8);
  equal("drinks has 59 items", flatten([drinks]).length, 59);
  equal("spirits has 14 groups", spirits.groups.length, 14);
  equal("spirits has 70 items", flatten([spirits]).length, 70);
  equal("wine has 10 groups", wine.groups.length, 10);
  equal("wine has 38 items", flatten([wine]).length, 38);

  check("drinks has a hero image", drinks.image === "drinks");
  check("spirits has a hero image", spirits.image === "spirits");
  check("wine has a hero image", wine.image === "wine");

  /* Exact prices from the printed drinks menu. */
  const prices = {
    "miso-signature": 15000,
    "whiskey-sour": 10000,
    "strawberry-daiquiri": 12000,
    "virgin-mojito": 9000,
    "champion": 10000,
    "milk-shake": 15000,
    "chivita-orange-pack": 10000,
    "chivita-orange-glass": 5000,
    "cranberry-pack": 20000,
    "cranberry-glass": 6500,
    "fresh-orange-juice": 5000,
    "nestle-water": 1200,
    "guinness-stout-60cl": 6000,
    "smirnoff-ice-30cl": 3500,
    "red-bull": 10000,
    "masala-tea": 6000,
    "magic-love-mixed": 12000,
    "moet-rose": 250000,
    "moet-imperial": 200000,
    "chivas-12": 74000,
    "jw-blue-reserve": 600000,
    "monkey-shoulder": 67700,
    "macallan-12": 250000,
    "glenfiddich-18": 340000,
    "wild-turkey-101": 79500,
    "jack-daniels-single-barrel": 150000,
    "teeling-single-grain": 75000,
    "kurayoshi-pure-malt": 165000,
    "olmeca": 90000,
    "martini-extra-dry": 50000,
    "remy-martin-vsop": 200000,
    "hennessy-vsop": 250000,
    "baileys": 95000,
    "belvedere": 108000,
    "shot-belvedere": 12000,
    "shot-teeling-small-batch": 11000,
    "nederburg": 50000,
    "mouton-cadet": 50000,
    "noble-hills-mourvedre-rose": 40000,
    "four-cousins": 35000
  };
  let priceFailures = 0;
  for (const [id, price] of Object.entries(prices)) {
    if (!byId[id] || byId[id].price !== price) {
      priceFailures += 1;
      console.log("  price mismatch: " + id + " expected " + price + ", got " + (byId[id] || {}).price);
    }
  }
  equal("all sampled drink prices match the PDF", priceFailures, 0);

  check("juice pack and glass are separate items",
    byId["chivita-orange-pack"].price === 10000 && byId["chivita-orange-glass"].price === 5000);
  check("cranberry pack and glass are separate items",
    byId["cranberry-pack"].price === 20000 && byId["cranberry-glass"].price === 6500);

  /* Printed typos normalised, no duplicates. */
  check("Olmeca is spelled correctly", Boolean(byId["olmeca"]) &&
    !rows.some((row) => row.name === "Olmea"));
  check("Glenmorangie is spelled correctly", Boolean(byId["glenmorangie-12"]) &&
    !rows.some((row) => /Glenmorengie/i.test(row.name)));
  check("Teeling Small Batch is spelled correctly",
    byId["teeling-small-batch"].name === "Teeling Small Batch");
  check("all drink ids are unique", new Set(rows.map((row) => row.id)).size === rows.length);
  const drinkRows = rows.filter((row) => ["drinks", "spirits", "wine"].includes(row.category));
  check("no drink item is price on request", drinkRows.every((row) => Number.isFinite(row.price)));

  /* ------------------------------------------------------------ live D1 -- */
  const live = await call("/api/menu");
  equal("live menu is served", live.status, 200);
  const sandbox = { window: {} };
  vm.runInNewContext(live.text, sandbox);
  const liveRows = flatten(sandbox.window.MISO_MENU);
  equal("live menu has the same item count", liveRows.length, rows.length);

  const staticIds = rows.map((row) => row.category + "/" + row.id).sort();
  const liveIds = liveRows.map((row) => row.category + "/" + row.id).sort();
  check("live menu matches the static menu",
    JSON.stringify(staticIds) === JSON.stringify(liveIds));

  let livePriceFailures = 0;
  for (const row of rows) {
    const match = liveRows.find((item) => item.id === row.id && item.category === row.category);
    if (!match || match.price !== row.price || match.name !== row.name) livePriceFailures += 1;
  }
  equal("live names and prices match the source", livePriceFailures, 0);

  /* ------------------------------------------------------------- order -- */
  const orderRes = await call("/api/orders", {
    method: "POST",
    headers: { ...CSRF, "CF-Connecting-IP": "203.0.113.77", "X-Forwarded-For": "203.0.113.77" },
    body: {
      ref: "MISO-261108-" + String(Math.floor(Math.random() * 9000) + 1000),
      clientToken: "drinks-test-" + Math.random().toString(36).slice(2, 12),
      service: "pickup",
      details: { name: "Drinks Test", phone: "08012345678", pickupTime: "8:00 PM" },
      lines: [
        { id: "mojito", qty: 2, note: "" },
        { id: "chivita-orange-glass", qty: 1, note: "" },
        { id: "shot-belvedere", qty: 1, note: "Neat" }
      ],
      clientTotal: 1
    }
  });
  equal("drinks order is accepted", orderRes.status, 201);
  const order = orderRes.data.order || {};
  equal("server prices the drinks order", order.subtotal, 37000);
  equal("drinks order tax is 10%", order.tax, 3700);
  equal("drinks order total is 40700", order.total, 40700);

  if (PASSCODE && order.id) {
    const login = await call("/api/auth/login", { method: "POST", headers: CSRF, body: { passcode: PASSCODE } });
    equal("staff login works for cleanup", login.status, 200);
    const cookie = login.cookie.split(";")[0];
    const queue = await call("/api/orders?status=all", { headers: { Cookie: cookie } });
    const entry = (queue.data.orders || []).find((row) => row.id === order.id);
    check("staff queue shows the drinks order", Boolean(entry));
    check("queue line names come from the drinks menu", entry &&
      entry.items.some((line) => line.name === "Mojito") &&
      entry.items.some((line) => line.name === "Belvedere"));

    const cancel = await call("/api/orders/" + order.id, {
      method: "PATCH",
      headers: { Cookie: cookie, ...CSRF },
      body: { status: "cancelled" }
    });
    equal("test drinks order is cancelled", cancel.status, 200);
    await call("/api/auth/logout", { method: "POST", headers: { Cookie: cookie, ...CSRF } });
  }

  console.log("\n" + passed + " passed, " + failures.length + " failed");
  if (failures.length) {
    console.log("Failures:\n" + failures.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
