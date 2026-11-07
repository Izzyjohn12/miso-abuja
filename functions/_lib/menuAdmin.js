/* Staff menu administration: read every dish (including hidden ones), create
 * dishes and edit them. Hiding is the only removal — order snapshots and
 * historical names stay intact. */

const ALLOWED_TAGS = ["spicy", "veg", "shellfish"];
const MAX_PRICE = 10000000;

function cleanString(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function cleanTags(value) {
  if (!Array.isArray(value)) return { error: "bad_tags" };
  const tags = [];
  for (const raw of value) {
    if (typeof raw !== "string" || ALLOWED_TAGS.indexOf(raw) === -1) return { error: "bad_tags" };
    if (tags.indexOf(raw) === -1) tags.push(raw);
  }
  return { tags };
}

function cleanPrice(value) {
  if (value === null || value === "" || value === undefined) return { price: null };
  const price = Number(value);
  if (!Number.isInteger(price) || price < 0 || price > MAX_PRICE) return { error: "bad_price" };
  return { price };
}

function slugify(name) {
  const slug = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "dish";
}

async function uniqueId(env, name) {
  const base = slugify(name);
  let id = base;
  let suffix = 2;
  while (
    await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(id).first()
  ) {
    id = base.slice(0, 54) + "-" + suffix;
    suffix += 1;
  }
  return id;
}

async function groupExists(env, groupId) {
  return Boolean(
    await env.DB.prepare("SELECT id FROM menu_groups WHERE id = ?").bind(groupId).first()
  );
}

export async function bumpMenuVersion(env) {
  await env.DB.prepare(
    "INSERT INTO meta (key, value) VALUES ('menu_version', '2') " +
      "ON CONFLICT(key) DO UPDATE SET " +
      "value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)"
  ).run();
}

function serializeItem(row) {
  let tags = [];
  try {
    const parsed = JSON.parse(row.tags || "[]");
    if (Array.isArray(parsed)) tags = parsed.filter((tag) => typeof tag === "string");
  } catch (err) {
    tags = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    price: row.price === null ? null : Number(row.price),
    tags,
    hidden: Boolean(row.hidden),
    sortOrder: Number(row.sort_order) || 0,
    groupId: row.group_id,
    groupName: row.group_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    updatedAt: row.updated_at || null
  };
}

const ITEM_SELECT =
  "SELECT i.id, i.name, i.description, i.price, i.tags, i.hidden, i.sort_order, " +
  "i.updated_at, g.id AS group_id, g.name AS group_name, " +
  "c.id AS category_id, c.name AS category_name " +
  "FROM items i JOIN menu_groups g ON g.id = i.group_id " +
  "JOIN categories c ON c.id = g.category_id ";

export async function getItem(env, id) {
  const row = await env.DB.prepare(ITEM_SELECT + "WHERE i.id = ?").bind(id).first();
  return row ? serializeItem(row) : null;
}

export async function listMenuForStaff(env) {
  const [catRows, groupRows, itemRows, versionRow] = await Promise.all([
    env.DB.prepare(
      "SELECT id, name, image, hidden, sort_order FROM categories ORDER BY sort_order, id"
    ).all(),
    env.DB.prepare(
      "SELECT id, category_id, name, sort_order FROM menu_groups ORDER BY sort_order, id"
    ).all(),
    env.DB.prepare(ITEM_SELECT + "ORDER BY i.sort_order, i.id").all(),
    env.DB.prepare("SELECT value FROM meta WHERE key = 'menu_version'").first()
  ]);

  const itemsByGroup = new Map();
  let hiddenCount = 0;
  for (const row of itemRows.results || []) {
    const item = serializeItem(row);
    if (item.hidden) hiddenCount += 1;
    if (!itemsByGroup.has(item.groupId)) itemsByGroup.set(item.groupId, []);
    itemsByGroup.get(item.groupId).push(item);
  }

  const groupsByCategory = new Map();
  for (const row of groupRows.results || []) {
    if (!groupsByCategory.has(row.category_id)) groupsByCategory.set(row.category_id, []);
    groupsByCategory.get(row.category_id).push({
      id: row.id,
      name: row.name,
      sortOrder: Number(row.sort_order) || 0,
      items: itemsByGroup.get(row.id) || []
    });
  }

  const categories = (catRows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    image: row.image || null,
    hidden: Boolean(row.hidden),
    sortOrder: Number(row.sort_order) || 0,
    groups: groupsByCategory.get(row.id) || []
  }));

  return {
    version: String((versionRow && versionRow.value) || "0"),
    categories,
    itemCount: (itemRows.results || []).length,
    hiddenCount
  };
}

export async function createItem(env, body) {
  if (!body || typeof body !== "object") return { error: "bad_body" };

  const name = cleanString(body.name, 80);
  if (name.length < 2) return { error: "name_required" };

  const groupId = cleanString(body.groupId, 80);
  if (!groupId || !(await groupExists(env, groupId))) return { error: "bad_group" };

  const description = cleanString(body.description, 500);

  const price = body.priceOnRequest ? { price: null } : cleanPrice(body.price);
  if (price.error) return price;

  const tags = body.tags === undefined ? { tags: [] } : cleanTags(body.tags);
  if (tags.error) return tags;

  const hidden = body.hidden === true || body.hidden === 1 ? 1 : 0;
  const id = await uniqueId(env, name);

  const orderRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS top FROM items WHERE group_id = ?"
  ).bind(groupId).first();
  const sortOrder = Number(orderRow && orderRow.top) + 1;

  await env.DB.prepare(
    "INSERT INTO items (id, group_id, name, description, price, tags, sort_order, hidden) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, groupId, name, description, price.price, JSON.stringify(tags.tags), sortOrder, hidden).run();

  await bumpMenuVersion(env);
  return { item: await getItem(env, id) };
}

export async function updateItem(env, id, body) {
  if (!body || typeof body !== "object") return { error: "bad_body" };

  const existing = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(id).first();
  if (!existing) return { error: "not_found" };

  const updates = {};

  if (body.name !== undefined) {
    const name = cleanString(body.name, 80);
    if (name.length < 2) return { error: "name_required" };
    updates.name = name;
  }

  if (body.description !== undefined) {
    updates.description = cleanString(body.description, 500);
  }

  if (body.price !== undefined || body.priceOnRequest !== undefined) {
    const price = body.priceOnRequest ? { price: null } : cleanPrice(body.price);
    if (price.error) return price;
    updates.price = price.price;
  }

  if (body.tags !== undefined) {
    const tags = cleanTags(body.tags);
    if (tags.error) return tags;
    updates.tags = JSON.stringify(tags.tags);
  }

  if (body.groupId !== undefined) {
    const groupId = cleanString(body.groupId, 80);
    if (!groupId || !(await groupExists(env, groupId))) return { error: "bad_group" };
    updates.group_id = groupId;
  }

  if (body.hidden !== undefined) {
    if (typeof body.hidden !== "boolean") return { error: "bad_hidden" };
    updates.hidden = body.hidden ? 1 : 0;
  }

  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      return { error: "bad_sort_order" };
    }
    updates.sort_order = sortOrder;
  }

  const fields = Object.keys(updates);
  if (!fields.length) return { error: "nothing_to_update" };

  updates.updated_at = new Date().toISOString();
  const assignments = Object.keys(updates).map((field) => field + " = ?").join(", ");
  await env.DB.prepare("UPDATE items SET " + assignments + " WHERE id = ?")
    .bind(...Object.keys(updates).map((field) => updates[field]), id)
    .run();

  await bumpMenuVersion(env);
  return { item: await getItem(env, id) };
}
