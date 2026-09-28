CREATE TABLE ss_v1.agents (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK (email = lower(email)),
 name text NOT NULL, phone text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'sub-agent' CHECK (role IN ('sub-agent','main-agent')),
 account_status text NOT NULL DEFAULT 'pending' CHECK (account_status IN ('pending','active','suspended','closed')),
 application_status text NOT NULL DEFAULT 'draft' CHECK (application_status IN ('draft','submitted','changes_requested','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.main_agent_assignments (
 sub_agent_id uuid PRIMARY KEY REFERENCES ss_v1.agents(id),
 main_agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 assigned_at timestamptz NOT NULL DEFAULT now(), CHECK (sub_agent_id <> main_agent_id)
);
CREATE FUNCTION ss_v1.check_assignment_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM ss_v1.agents WHERE id=NEW.sub_agent_id AND role='sub-agent') OR
    NOT EXISTS (SELECT 1 FROM ss_v1.agents WHERE id=NEW.main_agent_id AND role='main-agent') THEN
   RAISE EXCEPTION 'Invalid assignment roles' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assignment_roles BEFORE INSERT OR UPDATE ON ss_v1.main_agent_assignments
 FOR EACH ROW EXECUTE FUNCTION ss_v1.check_assignment_roles();
CREATE TABLE ss_v1.sessions (
 id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ss_v1.refresh_tokens (
 token_hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES ss_v1.sessions(id),
 used_at timestamptz
);
CREATE INDEX sessions_agent ON ss_v1.sessions(agent_id);
CREATE TABLE ss_v1.networks (code text PRIMARY KEY, display_name text NOT NULL);
INSERT INTO ss_v1.networks VALUES ('vodacom','M-Pesa'),('airtel','Airtel Money'),('yas','Mixx by Yas'),('halotel','HaloPesa');
CREATE TABLE ss_v1.transfer_requests (
 id uuid PRIMARY KEY, sub_agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 main_agent_id uuid NOT NULL REFERENCES ss_v1.agents(id),
 source_network text NOT NULL REFERENCES ss_v1.networks(code),
 destination_network text NOT NULL REFERENCES ss_v1.networks(code),
 amount_tzs bigint NOT NULL CHECK (amount_tzs > 0), currency text NOT NULL DEFAULT 'TZS' CHECK (currency='TZS'),
 status text NOT NULL CHECK (status IN ('awaiting_review','awaiting_source','source_confirmed','payout_pending','completed','rejected','cancelled','expired','needs_attention','refund_pending','refunded')),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK (sub_agent_id <> main_agent_id)
);
CREATE INDEX requests_owner ON ss_v1.transfer_requests(sub_agent_id,id);
CREATE INDEX requests_reviewer ON ss_v1.transfer_requests(main_agent_id,id);
CREATE TABLE ss_v1.transaction_legs (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES ss_v1.transfer_requests(id),
 leg_type text NOT NULL CHECK (leg_type IN ('origin_in','destination_out')),
 status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','submitted','confirmed','failed','unknown','reversed')),
 UNIQUE(request_id,leg_type)
);
