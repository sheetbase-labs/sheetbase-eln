-- API-005: scoped external API credentials. Credentials live in internal
-- (never exposed to PostgREST's api schema); exchange happens through a
-- server-side route that verifies the secret, checks revocation and scope,
-- and mints a short-lived PostgREST JWT with the workspace_id and a
-- narrower role claim ('api_client'). RLS policies in AUTH-004 are member-
-- based; API clients get a separate claim shape and will be authorised by
-- later policies. For now, the initial scope (projects:read, projects:write)
-- is enforced at exchange time and encoded in the token; API-007 will add
-- policy-level enforcement for api_client.
--
-- The secret is stored hashed (SHA-256, salted with the credential id) so a
-- database leak does not expose usable credentials. The full secret is shown
-- to the user exactly once at creation. A display prefix (first 8 chars)
-- is stored to help users identify a credential without revealing it.

CREATE TABLE "internal"."api_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "display_prefix" text NOT NULL,
  "secret_hash" text NOT NULL,
  "name" text NOT NULL,
  "scopes" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_by_user_id" text NOT NULL,
  CONSTRAINT "uq_api_credentials_prefix" UNIQUE ("display_prefix")
);--> statement-breakpoint

ALTER TABLE "internal"."api_credentials"
  ADD CONSTRAINT "api_credentials_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "internal"."api_credentials"
  ADD CONSTRAINT "api_credentials_created_by_user_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_api_credentials_workspace_id"
  ON "internal"."api_credentials" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_api_credentials_secret_hash"
  ON "internal"."api_credentials" USING btree ("secret_hash");--> statement-breakpoint

-- Valid scopes are checked at exchange; the constraint prevents garbage at
-- insert time. The initial vocabulary is intentionally small (projects:read,
-- projects:write); future tickets extend it.
ALTER TABLE "internal"."api_credentials"
  ADD CONSTRAINT "chk_api_credentials_scopes"
  CHECK (
    "scopes"::text[] <@ ARRAY['projects:read', 'projects:write']::text[]
  );--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
