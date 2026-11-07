/* Read the live menu from D1 and shape it exactly like assets/js/menu.js.
 * The guest app expects:
 *   MISO_MENU      = [{id, name, kicker, blurb, image, groups:[{name, items:[…]}]}]
 *   MISO_SIGNATURES = [{itemId, image, label, note}]
 */

function parseTags(value) {
  try {
    const tags = JSON.parse(value || "[]");
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
  } catch (err) {
    return [];
  }
}

export async function loadMenu(env) {
  if (!env || !env.DB) throw new Error("D1 binding DB is not configured");

  const [catRows, groupRows, itemRows, sigRows, versionRow] = await Promise.all([
    env.DB.prepare(
      "SELECT id, name, kicker, blurb, image " +
        "FROM categories WHERE hidden = 0 ORDER BY sort_order, id"
    ).all(),
    env.DB.prepare(
      "SELECT id, category_id, name FROM menu_groups ORDER BY sort_order, id"
    ).all(),
    env.DB.prepare(
      "SELECT id, group_id, name, description, price, tags " +
        "FROM items WHERE hidden = 0 ORDER BY sort_order, id"
    ).all(),
    env.DB.prepare(
      "SELECT s.item_id, s.image, s.label, s.note FROM signatures s " +
        "JOIN items i ON i.id = s.item_id WHERE i.hidden = 0 ORDER BY s.slot"
    ).all(),
    env.DB.prepare("SELECT value FROM meta WHERE key = 'menu_version'").first()
  ]);

  const itemsByGroup = new Map();
  for (const row of itemRows.results || []) {
    const item = {
      id: row.id,
      name: row.name,
      desc: row.description || "",
      price: row.price === null ? null : Number(row.price),
      tags: parseTags(row.tags)
    };
    if (!itemsByGroup.has(row.group_id)) itemsByGroup.set(row.group_id, []);
    itemsByGroup.get(row.group_id).push(item);
  }

  const groupsByCategory = new Map();
  for (const row of groupRows.results || []) {
    const items = itemsByGroup.get(row.id);
    if (!items || !items.length) continue; // hide empty groups with no visible dishes
    if (!groupsByCategory.has(row.category_id)) groupsByCategory.set(row.category_id, []);
    groupsByCategory.get(row.category_id).push({ name: row.name, items });
  }

  const categories = (catRows.results || [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      kicker: row.kicker || "",
      blurb: row.blurb || "",
      image: row.image || null,
      groups: groupsByCategory.get(row.id) || []
    }))
    .filter((cat) => cat.groups.length);

  const signatures = (sigRows.results || []).map((row) => ({
    itemId: row.item_id,
    image: row.image || null,
    label: row.label || "",
    note: row.note || ""
  }));

  return {
    categories,
    signatures,
    version: String((versionRow && versionRow.value) || "0")
  };
}

export function menuScript(menu) {
  return (
    "/* MISO live menu — generated from D1 */\n" +
    "window.MISO_MENU=" +
    JSON.stringify(menu.categories) +
    ";\nwindow.MISO_SIGNATURES=" +
    JSON.stringify(menu.signatures) +
    ";\n"
  );
}
