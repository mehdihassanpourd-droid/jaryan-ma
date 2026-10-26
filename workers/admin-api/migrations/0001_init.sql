-- Jaryan Ma admin database (Cloudflare D1 / SQLite). Single-vendor today; every
-- product belongs to the one store. A future marketplace adds a `vendors` table and
-- a vendor_id column (see docs/admin/ARCHITECTURE.md, "Multi-vendor path").
-- Money is integer Toman. Timestamps are ISO-8601 UTC text.

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  fulfillment    TEXT NOT NULL CHECK (fulfillment IN ('unique', 'stocked', 'made_to_order')),
  price_toman    INTEGER CHECK (price_toman IS NULL OR price_toman >= 0),
  inventory      INTEGER CHECK (inventory IS NULL OR inventory >= 0),
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days > 0),
  -- Normalised name + description + SKUs, used by search (LIKE today, FTS5 later).
  search_text    TEXT NOT NULL DEFAULT '',
  -- Optimistic concurrency: updates must present the version they read.
  version        INTEGER NOT NULL DEFAULT 1,
  -- Random token written by each update; child-row statements in the same batch only
  -- run while it matches, so a lost race can never half-apply an update.
  write_token    TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  published_at   TEXT
);
CREATE INDEX idx_products_status_updated ON products (status, updated_at DESC);
CREATE INDEX idx_products_category ON products (category_id, status);
CREATE INDEX idx_products_fulfillment ON products (fulfillment, status);

CREATE TABLE product_images (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  r2_key     TEXT NOT NULL,
  alt        TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_images_product ON product_images (product_id, position);

CREATE TABLE product_variants (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  options_json TEXT NOT NULL,
  price_toman  INTEGER CHECK (price_toman IS NULL OR price_toman >= 0),
  inventory    INTEGER CHECK (inventory IS NULL OR inventory >= 0),
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_variants_sku ON product_variants (sku);
CREATE INDEX idx_variants_product ON product_variants (product_id, position);

-- Allow-list of administrators. Authentication is done by Cloudflare Access;
-- this table decides who may do what. There is NO default/seeded admin: the first
-- owner is inserted manually once (docs/admin/CLOUDFLARE-SETUP.md).
CREATE TABLE admins (
  email      TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  disabled   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  detail_json  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_at ON audit_log (at DESC);
