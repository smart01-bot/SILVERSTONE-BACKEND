-- Additive Phase 3. No legacy/public data, external balance or settlement writes.
CREATE TABLE ss_v1.network_accounts (
 id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 network_code text NOT NULL REFERENCES ss_v1.networks(code),
 identifier_type text NOT NULL CHECK(identifier_type IN ('phone','agent','till','account')),
 identifier text NOT NULL CHECK(length(identifier) BETWEEN 1 AND 64),
 verification_status text NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','synthetic_fixture','verified','revoked')),
 verification_source text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agent_id,network_code,identifier_type,identifier),
 CHECK(verification_status NOT IN ('synthetic_fixture','verified') OR verification_source IS NOT NULL)
);
ALTER TABLE ss_v1.transfer_requests
 ADD COLUMN source_account_id uuid REFERENCES ss_v1.network_accounts(id),
 ADD COLUMN destination_account_id uuid REFERENCES ss_v1.network_accounts(id),
 ADD COLUMN collection_account_id uuid REFERENCES ss_v1.network_accounts(id),
 ADD COLUMN payout_account_id uuid REFERENCES ss_v1.network_accounts(id),
 ADD COLUMN account_snapshot jsonb,
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN urgent boolean NOT NULL DEFAULT false,
 ADD COLUMN queue_sequence bigserial;
CREATE UNIQUE INDEX exchange_queue_sequence ON ss_v1.transfer_requests(queue_sequence);
CREATE TABLE ss_v1.exchange_capacity (
 account_id uuid PRIMARY KEY REFERENCES ss_v1.network_accounts(id),
 total_tzs bigint NOT NULL CHECK(total_tzs>=0),
 held_tzs bigint NOT NULL DEFAULT 0 CHECK(held_tzs>=0 AND held_tzs<=total_tzs),
 source text NOT NULL CHECK(source='synthetic_fixture')
);
CREATE TABLE ss_v1.exchange_reservations (
 request_id uuid PRIMARY KEY REFERENCES ss_v1.transfer_requests(id),
 account_id uuid NOT NULL REFERENCES ss_v1.exchange_capacity(account_id),
 amount_tzs bigint NOT NULL CHECK(amount_tzs>0),
 status text NOT NULL CHECK(status IN ('held','released','consumed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.exchange_history (
 id bigserial PRIMARY KEY, request_id uuid NOT NULL REFERENCES ss_v1.transfer_requests(id),
 actor_id uuid REFERENCES ss_v1.agents(id), event text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER exchange_history_immutable BEFORE UPDATE OR DELETE ON ss_v1.exchange_history
 FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE TABLE ss_v1.exchange_commands (
 actor_id uuid NOT NULL REFERENCES ss_v1.agents(id), operation text NOT NULL,
 key text NOT NULL, payload_hash text NOT NULL, response jsonb,
 PRIMARY KEY(actor_id,operation,key), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.exchange_jobs (
 id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE REFERENCES ss_v1.transfer_requests(id),
 kind text NOT NULL CHECK(kind='prepare_collection'),
 status text NOT NULL CHECK(status IN ('ready','claimed','blocked','reconciliation','cancelled')),
 claim_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exchange_jobs_eligible ON ss_v1.exchange_jobs(status,available_at,lease_until);
-- Assignment cannot silently transfer outstanding financial work.
CREATE FUNCTION ss_v1.protect_exchange_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.main_agent_id=OLD.main_agent_id AND NEW.sub_agent_id=OLD.sub_agent_id THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM ss_v1.transfer_requests WHERE sub_agent_id=OLD.sub_agent_id AND source_account_id IS NOT NULL
   AND status NOT IN ('completed','rejected','cancelled','expired','refunded')) THEN
   RAISE EXCEPTION 'Outstanding exchanges require an audited handover' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_exchange_assignment BEFORE UPDATE OR DELETE ON ss_v1.main_agent_assignments
 FOR EACH ROW EXECUTE FUNCTION ss_v1.protect_exchange_assignment();
CREATE FUNCTION ss_v1.protect_exchange_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.source_account_id IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exchange history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.sub_agent_id,NEW.main_agent_id,NEW.source_network,NEW.destination_network,NEW.amount_tzs,NEW.currency,
    NEW.source_account_id,NEW.destination_account_id,NEW.collection_account_id,NEW.payout_account_id,NEW.account_snapshot,NEW.queue_sequence,NEW.created_at,NEW.urgent)
   IS DISTINCT FROM ROW(OLD.sub_agent_id,OLD.main_agent_id,OLD.source_network,OLD.destination_network,OLD.amount_tzs,OLD.currency,
    OLD.source_account_id,OLD.destination_account_id,OLD.collection_account_id,OLD.payout_account_id,OLD.account_snapshot,OLD.queue_sequence,OLD.created_at,OLD.urgent) THEN
   RAISE EXCEPTION 'Exchange terms are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_exchange_terms BEFORE UPDATE OR DELETE ON ss_v1.transfer_requests
 FOR EACH ROW EXECUTE FUNCTION ss_v1.protect_exchange_terms();
