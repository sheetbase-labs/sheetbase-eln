CREATE TABLE "api"."user_signature_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"statement_version" integer NOT NULL,
	"certified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "uq_user_signature_certifications_user" UNIQUE("workspace_id","user_id"),
	CONSTRAINT "chk_user_signature_certifications_version" CHECK ("api"."user_signature_certifications"."statement_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD CONSTRAINT "user_signature_certifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD CONSTRAINT "user_signature_certifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_signature_certifications_workspace" ON "api"."user_signature_certifications" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON api.user_signature_certifications TO authenticated;
--> statement-breakpoint
CREATE POLICY "user_signature_certifications_select" ON api.user_signature_certifications
	FOR SELECT TO authenticated
	USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.certify_signature(
  p_workspace_id uuid,
  p_statement_version integer
)
RETURNS api.user_signature_certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.user_signature_certifications;
BEGIN
  IF p_statement_version IS NULL OR p_statement_version < 1 THEN
    RAISE EXCEPTION 'invalid statement version' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace denied' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.user_signature_certifications(
    workspace_id, user_id, statement_version, certified_at, revoked_at
  ) VALUES (
    p_workspace_id, api.current_user_id(), p_statement_version, now(), NULL
  )
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET statement_version = EXCLUDED.statement_version,
        certified_at = now(),
        revoked_at = NULL
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.certify_signature(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.certify_signature(uuid, integer) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.withdraw_signature_certification(p_workspace_id uuid)
RETURNS api.user_signature_certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.user_signature_certifications;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace denied' USING ERRCODE = '42501';
  END IF;
  UPDATE api.user_signature_certifications
    SET revoked_at = now()
    WHERE workspace_id = p_workspace_id
      AND user_id = api.current_user_id()
      AND revoked_at IS NULL
    RETURNING * INTO v;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'no active certification' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.withdraw_signature_certification(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.withdraw_signature_certification(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.workspace_signature_certifications()
RETURNS TABLE(
  user_id text, name text, statement_version integer,
  certified_at timestamptz, revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id, u.name, c.statement_version, c.certified_at, c.revoked_at
  FROM api.workspace_memberships m
  JOIN internal."user" u ON u.id = m.user_id
  LEFT JOIN api.user_signature_certifications c
    ON c.workspace_id = m.workspace_id AND c.user_id = m.user_id
  WHERE m.workspace_id = api.current_workspace_id()
    AND m.suspended_at IS NULL
    AND api.is_workspace_member(m.workspace_id)
  ORDER BY u.name
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.workspace_signature_certifications() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.workspace_signature_certifications() TO authenticated;
