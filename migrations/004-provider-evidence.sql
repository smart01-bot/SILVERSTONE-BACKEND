-- Additive, synthetic-only evidence model. No backfill, ledger or settlement.
CREATE TABLE ss_v1.provider_attempts (
 id uuid PRIMARY KEY,
 leg_id uuid NOT NULL UNIQUE REFERENCES ss_v1.transaction_legs(id),
 request_id uuid NOT NULL REFERENCES ss_v1.transfer_requests(id),
 provider text NOT NULL CHECK(provider='synthetic_fixture'),
 scope text NOT NULL CHECK(scope='embedded_test'),
 reference text NOT NULL UNIQUE,
 idempotency_key text NOT NULL UNIQUE,
 amount_tzs bigint NOT NULL CHECK(amount_tzs>0),
 currency text NOT NULL CHECK(currency='TZS'),
 network_code text NOT NULL REFERENCES ss_v1.networks(code),
 from_account_id uuid NOT NULL REFERENCES ss_v1.network_accounts(id),
 to_account_id uuid NOT NULL REFERENCES ss_v1.network_accounts(id),
 claim_token uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER provider_attempt_immutable BEFORE UPDATE OR DELETE ON ss_v1.provider_attempts
 FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE TABLE ss_v1.provider_event_inbox (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK(provider='synthetic_fixture'),
 scope text NOT NULL CHECK(scope='embedded_test'),
 event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 128),
 payload_hash text NOT NULL,
 payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,scope,event_key)
);
CREATE TRIGGER provider_event_immutable BEFORE UPDATE OR DELETE ON ss_v1.provider_event_inbox
 FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE TABLE ss_v1.provider_event_results (
 event_id uuid PRIMARY KEY REFERENCES ss_v1.provider_event_inbox(id),
 attempt_id uuid REFERENCES ss_v1.provider_attempts(id),
 disposition text NOT NULL CHECK(disposition IN ('applied','ignored','rejected','conflict')),
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER provider_result_immutable BEFORE UPDATE OR DELETE ON ss_v1.provider_event_results
 FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
-- This is a synthetic evidence projection, never an actual money ledger or leg status.
CREATE TABLE ss_v1.provider_evidence_state (
 attempt_id uuid PRIMARY KEY REFERENCES ss_v1.provider_attempts(id),
 status text NOT NULL CHECK(status IN ('unknown','acknowledged','confirmed','failed','reversed')),
 reconciliation_required boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.provider_evidence_effects (
 attempt_id uuid NOT NULL REFERENCES ss_v1.provider_attempts(id),
 effect text NOT NULL CHECK(effect IN ('synthetic_confirmation','synthetic_reversal')),
 event_id uuid NOT NULL REFERENCES ss_v1.provider_event_inbox(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(attempt_id,effect)
);
CREATE TRIGGER provider_effect_immutable BEFORE UPDATE OR DELETE ON ss_v1.provider_evidence_effects
 FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE INDEX provider_attempt_request ON ss_v1.provider_attempts(request_id);
