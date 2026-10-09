-- Hosted credential bridge: Supabase Auth owns email/password verification;
-- Silverstone retains approval, authorization and revocable application sessions.
ALTER TABLE ss_v1.agents
  ADD COLUMN auth_user_id uuid UNIQUE,
  ADD COLUMN auth_source text NOT NULL DEFAULT 'local'
    CHECK (auth_source IN ('local','supabase'));

ALTER TABLE ss_v1.agents ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE ss_v1.agents
  ADD CONSTRAINT agents_credential_source
  CHECK (
    (auth_source='local' AND password_hash IS NOT NULL) OR
    (auth_source='supabase' AND auth_user_id IS NOT NULL)
  );

CREATE INDEX agents_auth_user ON ss_v1.agents(auth_user_id)
  WHERE auth_user_id IS NOT NULL;
