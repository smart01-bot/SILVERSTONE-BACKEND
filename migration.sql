-- ============================================================
-- Silverstone migration — run once on your Supabase SQL editor
-- ============================================================

-- Agents: add missing columns for mobile app flow
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS name             TEXT,
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','active')),
  ADD COLUMN IF NOT EXISTS pin_set          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS business_name    TEXT,
  ADD COLUMN IF NOT EXISTS business_location TEXT,
  ADD COLUMN IF NOT EXISTS coordinates      JSONB,
  ADD COLUMN IF NOT EXISTS reg_no           TEXT,
  ADD COLUMN IF NOT EXISTS tin              TEXT,
  ADD COLUMN IF NOT EXISTS nida             TEXT,
  ADD COLUMN IF NOT EXISTS float_capacity   NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tin_cert_url     TEXT,
  ADD COLUMN IF NOT EXISTS licence_cert_url TEXT,
  ADD COLUMN IF NOT EXISTS selfie_verified  BOOLEAN NOT NULL DEFAULT FALSE;

-- On insert, keep name in sync with username if name not supplied
CREATE OR REPLACE FUNCTION sync_agent_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS NULL OR NEW.name = '' THEN
    NEW.name := NEW.username;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_agent_name ON agents;
CREATE TRIGGER trg_sync_agent_name
  BEFORE INSERT OR UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION sync_agent_name();

-- Requests: add cancelled status
ALTER TABLE requests
  DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('pending','approved','rejected','completed','cancelled'));

-- ============================================================
-- Migration 002 -- rejection reason + selfie document URL
-- Run this section only; everything above has already been applied.
-- ============================================================

-- Agents: capture why an application was rejected (was collected in the
-- app but had no column to land in, so it was silently discarded)
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Agents: store the actual selfie image URL, not just a verified flag.
-- Mirrors how tin_cert_url / licence_cert_url already work.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS selfie_url TEXT;