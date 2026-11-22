-- ============================================================================
-- Café Companion: VibeCraft & CounterFlow
-- Cloud SQL for PostgreSQL 16 + pgvector Production Migration Script
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Customers & Palate Preferences
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'patron',
  dietary_limits JSONB NOT NULL DEFAULT '[]'::jsonb,
  taste_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Live Menu Inventory & Craft Complexity
CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  prep_complexity INTEGER NOT NULL DEFAULT 2 CHECK (prep_complexity BETWEEN 1 AND 5),
  base_prep_seconds INTEGER NOT NULL DEFAULT 180,
  caffeine_level TEXT NOT NULL,
  acidity_level TEXT NOT NULL,
  dietary_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  flavor_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  stock_count INTEGER NOT NULL DEFAULT 25 CHECK (stock_count >= 0),
  image_url TEXT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Omnichannel Orders (Walk-in POS + Mobile PWA)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_code TEXT NOT NULL UNIQUE,
  customer_uid TEXT REFERENCES customers(uid) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('COUNTER_POS', 'MOBILE_PWA')),
  table_code TEXT,
  status TEXT NOT NULL DEFAULT 'GRINDING_EXTRACTION'
    CHECK (status IN ('QUEUED','GRINDING_EXTRACTION','STEAMING_POUR','QUALITY_PLATING','READY_PICKUP','COMPLETED')),
  estimated_seconds INTEGER NOT NULL DEFAULT 240,
  remaining_seconds INTEGER NOT NULL DEFAULT 240,
  complexity_score REAL NOT NULL DEFAULT 1.0,
  ai_wait_reasoning TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL DEFAULT 0,
  handoff_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Order Line Items
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  modifiers TEXT NOT NULL DEFAULT '',
  unit_price_cents INTEGER NOT NULL
);

-- 5. KDS Ticket Stage Audit & SLA Timings
CREATE TABLE IF NOT EXISTS kds_ticket_stages (
  id SERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  barista_note TEXT NOT NULL DEFAULT '',
  sla_target_seconds INTEGER NOT NULL DEFAULT 90
);

-- 6. Table Connect Ephemeral Vector Vibes (768-dim pgvector + IVFFlat)
CREATE TABLE IF NOT EXISTS community_vibes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_uid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  table_zone TEXT NOT NULL,
  focus_tag TEXT NOT NULL,
  focus_description TEXT NOT NULL,
  open_to_connect BOOLEAN NOT NULL DEFAULT TRUE,
  embedding vector(768) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_vibes_embedding_ivfflat
  ON community_vibes USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_community_vibes_expires_at
  ON community_vibes (expires_at);

-- 7. Ambient Vibe & Operations Pulse Telemetry
CREATE TABLE IF NOT EXISTS ambient_telemetry_logs (
  id SERIAL PRIMARY KEY,
  zone TEXT NOT NULL,
  decibels REAL,
  feedback_type TEXT NOT NULL,
  raw_message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  ai_category TEXT NOT NULL DEFAULT 'General',
  ai_corrective_action TEXT NOT NULL DEFAULT '',
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Native PostgreSQL LISTEN/NOTIFY Trigger for Real-Time KDS & WebSocket CDC
CREATE OR REPLACE FUNCTION notify_kds_ticket_event()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  payload := json_build_object(
    'event', TG_OP,
    'order_id', NEW.id,
    'order_code', NEW.order_code,
    'status', NEW.status,
    'remaining_seconds', NEW.remaining_seconds,
    'updated_at', NEW.updated_at
  );
  PERFORM pg_notify('kds_ticket_updates', payload::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_kds_notify ON orders;
CREATE TRIGGER trg_orders_kds_notify
AFTER INSERT OR UPDATE OF status, remaining_seconds ON orders
FOR EACH ROW EXECUTE FUNCTION notify_kds_ticket_event();
