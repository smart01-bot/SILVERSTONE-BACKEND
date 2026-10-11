-- Additive, private server-side orchestration. No provider, funding or test data seeded.
CREATE TABLE ss_v1.payment_funding (
 id uuid PRIMARY KEY, main_agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 provider text NOT NULL, scope text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 balance_tzs bigint NOT NULL DEFAULT 0 CHECK(balance_tzs>=0),
 held_tzs bigint NOT NULL DEFAULT 0 CHECK(held_tzs>=0 AND held_tzs<=balance_tzs),
 verified_at timestamptz, UNIQUE(provider,scope)
);
CREATE TABLE ss_v1.payment_routes (
 id uuid PRIMARY KEY, funding_id uuid NOT NULL REFERENCES ss_v1.payment_funding(id),
 source_network text NOT NULL REFERENCES ss_v1.networks(code), destination_network text NOT NULL REFERENCES ss_v1.networks(code),
 source_type text NOT NULL CHECK(source_type IN ('phone','agent','till')),
 destination_type text NOT NULL CHECK(destination_type IN ('phone','agent','till')),
 max_fee_tzs bigint NOT NULL CHECK(max_fee_tzs>=0), enabled boolean NOT NULL DEFAULT false,
 UNIQUE(funding_id,source_network,destination_network,source_type,destination_type)
);
CREATE TABLE ss_v1.payment_holds (
 request_id uuid PRIMARY KEY REFERENCES ss_v1.transfer_requests(id),
 funding_id uuid NOT NULL REFERENCES ss_v1.payment_funding(id), amount_tzs bigint NOT NULL CHECK(amount_tzs>0),
 status text NOT NULL CHECK(status IN ('held','released','consumed')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.payment_tasks (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES ss_v1.transfer_requests(id),
 kind text NOT NULL CHECK(kind IN ('collect','payout')),
 provider text NOT NULL, scope text NOT NULL, terms jsonb NOT NULL,
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','pending','confirmed','failed','attention','cancelled')),
 verification_due boolean NOT NULL DEFAULT false, dispatched_at timestamptz, claim_token uuid, lease_until timestamptz,
 next_at timestamptz NOT NULL DEFAULT now(), checks integer NOT NULL DEFAULT 0,
 provider_reference text, last_code text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,kind), UNIQUE(provider,scope,provider_reference)
);
CREATE INDEX payment_tasks_due ON ss_v1.payment_tasks(next_at) WHERE status IN ('ready','pending');
CREATE INDEX payment_funding_owner ON ss_v1.payment_funding(main_agent_id);
CREATE TABLE ss_v1.payment_events (
 id bigserial PRIMARY KEY, task_id uuid NOT NULL REFERENCES ss_v1.payment_tasks(id),
 event text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.payment_webhooks (
 provider text NOT NULL, scope text NOT NULL, event_id text NOT NULL,
 task_id uuid NOT NULL REFERENCES ss_v1.payment_tasks(id), payload_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,scope,event_id)
);
CREATE FUNCTION ss_v1.protect_payment_task() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, ss_v1 AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment tasks cannot be deleted'; END IF;
 IF ROW(NEW.id,NEW.request_id,NEW.kind,NEW.provider,NEW.scope,NEW.terms,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.request_id,OLD.kind,OLD.provider,OLD.scope,OLD.terms,OLD.created_at)
 OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at) THEN
 RAISE EXCEPTION 'Payment instructions are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_payment_task BEFORE UPDATE OR DELETE ON ss_v1.payment_tasks
 FOR EACH ROW EXECUTE FUNCTION ss_v1.protect_payment_task();
CREATE FUNCTION ss_v1.protect_payment_event() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, ss_v1 AS $$
BEGIN RAISE EXCEPTION 'Payment evidence is append only'; END $$;
CREATE TRIGGER protect_payment_event BEFORE UPDATE OR DELETE ON ss_v1.payment_events
 FOR EACH ROW EXECUTE FUNCTION ss_v1.protect_payment_event();
CREATE TRIGGER protect_payment_webhook BEFORE UPDATE OR DELETE ON ss_v1.payment_webhooks
 FOR EACH ROW EXECUTE FUNCTION ss_v1.protect_payment_event();
ALTER TABLE ss_v1.payment_funding ENABLE ROW LEVEL SECURITY;
ALTER TABLE ss_v1.payment_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ss_v1.payment_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE ss_v1.payment_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ss_v1.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ss_v1.payment_webhooks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ss_v1.payment_funding,ss_v1.payment_routes,ss_v1.payment_holds,ss_v1.payment_tasks,ss_v1.payment_events,ss_v1.payment_webhooks FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 REVOKE ALL ON ss_v1.payment_funding,ss_v1.payment_routes,ss_v1.payment_holds,ss_v1.payment_tasks,ss_v1.payment_events,ss_v1.payment_webhooks FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 REVOKE ALL ON ss_v1.payment_funding,ss_v1.payment_routes,ss_v1.payment_holds,ss_v1.payment_tasks,ss_v1.payment_events,ss_v1.payment_webhooks FROM authenticated;
 END IF;
END $$;

CREATE FUNCTION ss_v1.protect_payment_funding_identity() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, ss_v1 AS $$
BEGIN
 IF ROW(NEW.id,NEW.main_agent_id,NEW.provider,NEW.scope) IS DISTINCT FROM ROW(OLD.id,OLD.main_agent_id,OLD.provider,OLD.scope) THEN
 RAISE EXCEPTION 'Create a new funding pool instead of changing its identity'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_payment_funding_identity BEFORE UPDATE ON ss_v1.payment_funding
 FOR EACH ROW EXECUTE FUNCTION ss_v1.protect_payment_funding_identity();
CREATE FUNCTION ss_v1.protect_payment_hold() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, ss_v1 AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment reservations cannot be deleted'; END IF;
 IF ROW(NEW.request_id,NEW.funding_id,NEW.amount_tzs,NEW.created_at) IS DISTINCT FROM ROW(OLD.request_id,OLD.funding_id,OLD.amount_tzs,OLD.created_at)
 OR (OLD.status <> 'held' AND NEW.status <> OLD.status) THEN RAISE EXCEPTION 'Payment reservation terms are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_payment_hold BEFORE UPDATE OR DELETE ON ss_v1.payment_holds
 FOR EACH ROW EXECUTE FUNCTION ss_v1.protect_payment_hold();
CREATE INDEX payment_holds_funding ON ss_v1.payment_holds(funding_id);
CREATE INDEX payment_events_task ON ss_v1.payment_events(task_id);
CREATE INDEX payment_webhooks_task ON ss_v1.payment_webhooks(task_id);
