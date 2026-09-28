CREATE TABLE ss_v1.application_drafts (
 agent_id uuid PRIMARY KEY REFERENCES ss_v1.agents(id),
 version integer NOT NULL DEFAULT 0 CHECK(version >= 0),
 data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.reviewer_grants (
 agent_id uuid PRIMARY KEY REFERENCES ss_v1.agents(id),
 granted_by text NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE ss_v1.phone_verifications (
 agent_id uuid PRIMARY KEY REFERENCES ss_v1.agents(id), phone text NOT NULL,
 source text NOT NULL CHECK(source IN ('provider','synthetic_fixture')),
 reference text NOT NULL, verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.documents (
 id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 kind text NOT NULL CHECK(kind IN ('tin','licence','selfie')),
 name text NOT NULL, mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 size integer NOT NULL CHECK(size > 0 AND size <= 2097152),
 sha256 text NOT NULL, content bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(octet_length(content)=size), UNIQUE(agent_id,kind,sha256)
);
CREATE TABLE ss_v1.application_revisions (
 id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 version integer NOT NULL, data jsonb NOT NULL,
 phone_source text NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agent_id,version)
);
CREATE TABLE ss_v1.revision_documents (
 revision_id uuid NOT NULL REFERENCES ss_v1.application_revisions(id),
 document_id uuid NOT NULL REFERENCES ss_v1.documents(id), PRIMARY KEY(revision_id,document_id)
);
CREATE TABLE ss_v1.review_decisions (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL UNIQUE REFERENCES ss_v1.application_revisions(id),
 reviewer_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 decision text NOT NULL CHECK(decision IN ('approved','rejected','changes_requested')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 fields_to_correct jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.document_access_events (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES ss_v1.documents(id),
 actor_id uuid NOT NULL REFERENCES ss_v1.agents(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION ss_v1.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable onboarding record' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON ss_v1.application_revisions FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON ss_v1.documents FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE TRIGGER immutable_decision BEFORE UPDATE OR DELETE ON ss_v1.review_decisions FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE TRIGGER immutable_revision_documents BEFORE UPDATE OR DELETE ON ss_v1.revision_documents FOR EACH ROW EXECUTE FUNCTION ss_v1.immutable_record();
CREATE INDEX revisions_owner ON ss_v1.application_revisions(agent_id,version DESC);
