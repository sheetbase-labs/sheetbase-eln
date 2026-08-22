-- API-02 completion: personal tokens. A second credential kind that acts as
-- its creating member instead of an anonymous workspace actor.
--
-- kind = 'service' (default): the shipped workspace service identity. JWTs
--   carry role 'api_client', no user id; RLS keys on the workspace claim and
--   attribution lands on *_credential_id columns.
-- kind = 'personal': user-scoped credential. The creator is the principal:
--   exchanged JWTs mint role 'authenticated' with a real sub, so member RLS
--   (including GOV-01 viewer read-only) applies and attribution is human.
--   The external allowlist and canonical scope checks are identical; human
--   attestation RPCs stay off the credential surface either way.
--
-- created_by_user_id is NOT NULL and references internal.user, so a personal
-- row always has its acting member. Membership is re-checked at exchange and
-- again per proxied request, so removing or suspending the member stops the
-- token without touching this table.

ALTER TABLE internal.api_credentials
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'service';

ALTER TABLE internal.api_credentials
  ADD CONSTRAINT chk_api_credentials_kind CHECK (kind IN ('service', 'personal'));
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
