-- MISO management app — D1 schema (migration 0001).
-- Menu rows are soft-deleted (hidden = 1) so historical orders keep their
-- names and prices after a dish is removed from the guest menu.

PRAGMA foreign_keys = ON;

/* ---------------------------------------------------------------- menu -- */

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kicker      TEXT NOT NULL DEFAULT '',
  blurb       TEXT NOT NULL DEFAULT '',
  image       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
);

CREATE TABLE IF NOT EXISTS menu_groups (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_id, name)
);

CREATE INDEX IF NOT EXISTS menu_groups_category
  ON menu_groups (category_id, sort_order);

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES menu_groups(id),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER CHECK (price IS NULL OR (price >= 0 AND price <= 10000000)),
  tags        TEXT NOT NULL DEFAULT '[]',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS items_group ON items (group_id, sort_order);
CREATE INDEX IF NOT EXISTS items_hidden ON items (hidden, group_id);

CREATE TABLE IF NOT EXISTS signatures (
  slot    INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 4),
  item_id TEXT NOT NULL REFERENCES items(id),
  image   TEXT,
  label   TEXT NOT NULL DEFAULT '',
  note    TEXT NOT NULL DEFAULT ''
);

/* -------------------------------------------------------------- orders -- */

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  ref            TEXT NOT NULL UNIQUE,
  client_token   TEXT UNIQUE,
  placed_at      TEXT NOT NULL,
  service        TEXT NOT NULL CHECK (service IN ('dine-in', 'pickup', 'maitama', 'abuja')),
  status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'preparing', 'ready', 'completed', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('unpaid', 'paid', 'pay_later')),
  customer_name  TEXT,
  customer_phone TEXT,
  details_json   TEXT NOT NULL DEFAULT '{}',
  notes          TEXT,
  subtotal       INTEGER NOT NULL DEFAULT 0,
  tax            INTEGER NOT NULL DEFAULT 0,
  tax_rate       REAL NOT NULL DEFAULT 0.1,
  fee            INTEGER NOT NULL DEFAULT 0,
  fee_pending    INTEGER NOT NULL DEFAULT 0 CHECK (fee_pending IN (0, 1)),
  total          INTEGER NOT NULL DEFAULT 0,
  due_now        INTEGER NOT NULL DEFAULT 0,
  client_total   INTEGER,
  notified_at    TEXT,
  notify_error   TEXT,
  created_ip     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id    TEXT,
  name       TEXT NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20),
  unit_price INTEGER,
  line_total INTEGER NOT NULL,
  note       TEXT,
  tags       TEXT NOT NULL DEFAULT '[]',
  category   TEXT
);

CREATE INDEX IF NOT EXISTS order_items_order ON order_items (order_id);

/* -------------------------------------------------- alerts and access -- */

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint        TEXT PRIMARY KEY,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_success_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ip           TEXT,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip, at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
