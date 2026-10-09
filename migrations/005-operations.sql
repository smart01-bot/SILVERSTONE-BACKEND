-- Local Phase 6 controls. No default grants, destinations, deadlines or financial authority.
CREATE TABLE ss_v1.operations_grants (
 actor_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 main_agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 capability text NOT NULL CHECK(capability IN ('cases.read','cases.manage','cases.own','evidence.record','audit.read','pause.manage')),
 granted_by text NOT NULL CHECK(length(granted_by)>0), granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 PRIMARY KEY(actor_id,main_agent_id,capability)
);
CREATE TABLE ss_v1.operations_controls (
 main_agent_id uuid PRIMARY KEY REFERENCES ss_v1.agents(id),
 requests_paused boolean NOT NULL DEFAULT false, acceptance_paused boolean NOT NULL DEFAULT false,
 preparation_paused boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 0,
 changed_by uuid REFERENCES ss_v1.agents(id), reason text, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.exception_cases (
 request_id uuid PRIMARY KEY REFERENCES ss_v1.transfer_requests(id),
 owner_id uuid NOT NULL REFERENCES ss_v1.agents(id), backup_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 due_at timestamptz, version integer NOT NULL CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(owner_id<>backup_id)
);
CREATE TABLE ss_v1.operations_events (
 id bigserial PRIMARY KEY, main_agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 request_id uuid REFERENCES ss_v1.transfer_requests(id), actor_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 event text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER operations_events_immutable BEFORE UPDATE OR DELETE ON ss_v1.operations_events
 FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE TABLE ss_v1.reconciliation_observations (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES ss_v1.transfer_requests(id),
 leg_id uuid NOT NULL REFERENCES ss_v1.transaction_legs(id), actor_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 source text NOT NULL CHECK(source IN ('synthetic_fixture','submitted_statement')),
 reference text NOT NULL CHECK(length(reference) BETWEEN 3 AND 128), amount_tzs bigint NOT NULL CHECK(amount_tzs>0),
 currency text NOT NULL CHECK(currency='TZS'), from_account_id uuid NOT NULL, to_account_id uuid NOT NULL,
 matches_terms boolean NOT NULL, observed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,leg_id,source,reference)
);
CREATE TRIGGER reconciliation_observations_immutable BEFORE UPDATE OR DELETE ON ss_v1.reconciliation_observations
 FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE TRIGGER document_access_events_immutable BEFORE UPDATE OR DELETE ON ss_v1.document_access_events
 FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE INDEX operations_events_scope ON ss_v1.operations_events(main_agent_id,id);
CREATE INDEX exception_cases_due ON ss_v1.exception_cases(due_at);
