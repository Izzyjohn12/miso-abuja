/* Order validation, server-side re-pricing and serialisation.
 * Client totals are never trusted; every line is looked up in D1. */

const SERVICES = ["dine-in", "pickup", "maitama", "abuja"];
const SERVICE_NAMES = {
  "dine-in": "Dine-in",
  pickup: "Pickup",
  maitama: "Delivery in Maitama",
  abuja: "Delivery across Abuja"
};
const MAX_LINES = 30;
const MAX_QTY = 20;
const MAX_NOTE = 140;
const MAX_ORDER_NOTE = 500;
const TAX_RATE = 0.1;
const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT = 12;

const DETAIL_LIMITS = {
  tableNumber: 20,
  pickupTime: 80,
  maitamaAddress: 200,
  maitamaLandmark: 120,
  abujaArea: 80,
  abujaAddress: 200,
  abujaLandmark: 120,
  name: 80,
  phone: 30
};

function cleanString(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function cleanDetails(raw, service) {
  const details = {
    service,
    serviceLabel: SERVICE_NAMES[service]
  };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(DETAIL_LIMITS)) {
      details[key] = cleanString(raw[key], DETAIL_LIMITS[key]);
    }
    details.notes = cleanString(raw.notes, MAX_ORDER_NOTE);
  }

  if (service === "pickup") {
    if (details.name.length < 2) return { error: "name_required" };
    if (details.phone.length < 5) return { error: "phone_required" };
  }
  if (service === "maitama") {
    if (details.name.length < 2) return { error: "name_required" };
    if (details.phone.length < 5) return { error: "phone_required" };
    if (details.maitamaAddress.length < 4) return { error: "address_required" };
  }
  if (service === "abuja") {
    if (details.name.length < 2) return { error: "name_required" };
    if (details.phone.length < 5) return { error: "phone_required" };
    if (details.abujaAddress.length < 4) return { error: "address_required" };
    if (details.abujaArea.length < 2) return { error: "area_required" };
  }

  return { details };
}

function parseLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: "lines_required" };
  if (rawLines.length > MAX_LINES) return { error: "too_many_lines" };

  const merged = new Map();
  for (const raw of rawLines) {
    if (!raw || typeof raw !== "object") return { error: "bad_line" };
    const id = cleanString(raw.id, 80);
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(id)) return { error: "bad_item" };

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: "bad_qty" };

    const note = cleanString(raw.note, MAX_NOTE);
    const existing = merged.get(id);
    if (existing) {
      if (existing.qty + qty > MAX_QTY) return { error: "bad_qty" };
      existing.qty += qty;
      if (note) existing.note = note;
    } else {
      merged.set(id, { id, qty, note });
    }
    if (merged.size > MAX_LINES) return { error: "too_many_lines" };
  }

  return { lines: [...merged.values()] };
}

export function parseOrderBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "bad_body" };

  const ref = cleanString(body.ref, 32);
  if (!/^MISO-\d{6}-\d{4}$/.test(ref)) return { error: "bad_ref" };

  const clientToken = cleanString(body.clientToken, 100);
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(clientToken)) return { error: "bad_client_token" };

  const service = cleanString(body.service, 20);
  if (!SERVICES.includes(service)) return { error: "bad_service" };

  const details = cleanDetails(body.details, service);
  if (details.error) return details;

  const parsedLines = parseLines(body.lines);
  if (parsedLines.error) return parsedLines;

  let clientTotal = null;
  if (Number.isInteger(body.clientTotal) && body.clientTotal >= 0 && body.clientTotal <= 10000000) {
    clientTotal = body.clientTotal;
  }

  return {
    value: {
      ref,
      clientToken,
      service,
      details: details.details,
      lines: parsedLines.lines,
      clientTotal
    }
  };
}

/* Look up every dish, reject unknown/hidden/price-on-request rows and price
   the order from the database. */
export async function priceLines(env, lines) {
  const ids = lines.map((line) => line.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    "SELECT i.id, i.name, i.price, i.tags, i.hidden, c.name AS category " +
      "FROM items i " +
      "JOIN menu_groups g ON g.id = i.group_id " +
      "JOIN categories c ON c.id = g.category_id " +
      "WHERE i.id IN (" + placeholders + ")"
  ).bind(...ids).all();

  const found = new Map((rows.results || []).map((row) => [row.id, row]));
  const unavailable = [];
  let subtotal = 0;
  const priced = [];

  for (const line of lines) {
    const row = found.get(line.id);
    if (!row || row.hidden || row.price === null) {
      unavailable.push(line.id);
      continue;
    }
    const unitPrice = Number(row.price);
    const lineTotal = unitPrice * line.qty;
    subtotal += lineTotal;
    priced.push({
      itemId: row.id,
      name: row.name,
      qty: line.qty,
      unitPrice,
      lineTotal,
      note: line.note,
      tags: row.tags || "[]",
      category: row.category
    });
  }

  if (unavailable.length) return { unavailable };
  return { items: priced, subtotal };
}

export function totalsFor(subtotal, service) {
  const tax = Math.round(subtotal * TAX_RATE);
  const feePending = service === "maitama" || service === "abuja";
  return {
    subtotal,
    tax,
    taxRate: TAX_RATE,
    fee: 0,
    feePending,
    total: subtotal + tax,
    dueNow: subtotal + tax
  };
}

export function formatServiceDetail(details) {
  if (!details || typeof details !== "object") return "";
  switch (details.service) {
    case "dine-in":
      return details.tableNumber ? "Table " + details.tableNumber : "Seated at the rooftop";
    case "pickup":
      return details.pickupTime || "Pickup";
    case "maitama":
      return details.maitamaAddress +
        (details.maitamaLandmark ? " (landmark: " + details.maitamaLandmark + ")" : "");
    case "abuja":
      return details.abujaAddress + ", " + details.abujaArea +
        (details.abujaLandmark ? " (landmark: " + details.abujaLandmark + ")" : "");
    default:
      return "";
  }
}

function safeDetails(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function safeTags(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

export function serializeOrder(row, items) {
  const details = safeDetails(row.details_json);
  return {
    id: row.id,
    ref: row.ref,
    status: row.status,
    paymentStatus: row.payment_status,
    placedAt: row.placed_at,
    service: row.service,
    serviceLabel: SERVICE_NAMES[row.service] || row.service,
    serviceDetail: formatServiceDetail(details),
    details,
    customerName: row.customer_name || "",
    customerPhone: row.customer_phone || "",
    notes: row.notes || "",
    subtotal: row.subtotal,
    tax: row.tax,
    taxRate: row.tax_rate,
    fee: row.fee,
    feePending: Boolean(row.fee_pending),
    total: row.total,
    dueNow: row.due_now,
    itemCount: (items || []).reduce((sum, item) => sum + item.qty, 0),
    notifiedAt: row.notified_at || null,
    notifyError: row.notify_error || null,
    items: (items || []).map((item) => ({
      id: item.item_id,
      name: item.name,
      qty: item.qty,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
      note: item.note || "",
      tags: safeTags(item.tags),
      category: item.category || ""
    }))
  };
}

export async function loadOrderItems(env, orderIds) {
  if (!orderIds.length) return new Map();
  const placeholders = orderIds.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    "SELECT * FROM order_items WHERE order_id IN (" + placeholders + ") ORDER BY id"
  ).bind(...orderIds).all();

  const grouped = new Map();
  for (const row of rows.results || []) {
    if (!grouped.has(row.order_id)) grouped.set(row.order_id, []);
    grouped.get(row.order_id).push(row);
  }
  return grouped;
}

export async function checkOrderRate(env, ip) {
  const windowStart = String(
    Math.floor(Date.now() / 1000 / RATE_WINDOW_SECONDS) * RATE_WINDOW_SECONDS
  );
  const key = "order:" + ip;

  await env.DB.prepare(
    "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) " +
      "ON CONFLICT(key) DO UPDATE SET " +
      "count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, " +
      "window_start = excluded.window_start"
  ).bind(key, windowStart).run();

  const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE key = ?").bind(key).first();
  return !row || Number(row.count) <= RATE_LIMIT;
}

export async function listOrders(env, filter) {
  const where =
    filter === "active"
      ? "status IN ('new', 'preparing', 'ready')"
      : filter === "cancelled"
        ? "status = 'cancelled'"
        : "1 = 1";

  const rows = await env.DB.prepare(
    "SELECT * FROM orders WHERE " + where + " ORDER BY created_at DESC LIMIT 100"
  ).all();

  const orders = rows.results || [];
  const items = await loadOrderItems(env, orders.map((order) => order.id));
  return orders.map((order) => serializeOrder(order, items.get(order.id) || []));
}

export async function findOrder(env, id) {
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!row) return null;
  const items = await loadOrderItems(env, [row.id]);
  return serializeOrder(row, items.get(row.id) || []);
}

export { SERVICES, SERVICE_NAMES };
