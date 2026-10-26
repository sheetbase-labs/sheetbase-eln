-- The agent registry the Agents page shows: named automations ("workflows")
-- with a trigger, an owner, the projects they cover and a policy that says what
-- each may do on its own; the runs they have made; and the numbered revisions of
-- that policy. Proposals gain the agent and run they came from, a PR-0000 number,
-- who should approve, and whether approval is an electronic signature.
--
-- The policy is controlled configuration. Only a workspace admin or steward
-- changes it, with a reason and a signature, and each change is a numbered
-- revision. A change applies to proposals made after it.

CREATE FUNCTION internal.valid_agent_policy(p_policy jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT jsonb_typeof(p_policy) = 'object'
     AND p_policy ?& ARRAY['read', 'notebook_blocks', 'dataset_flags', 'create_records', 'messages']
     AND (SELECT count(*) FROM jsonb_object_keys(p_policy)) = 5
     AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(p_policy) e
                      WHERE e.value NOT IN ('never', 'allowed', 'needs_approval', 'needs_signature'))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.valid_agent_policy(p_policy jsonb) OWNER TO migrator;
--> statement-breakpoint
CREATE TABLE api.agent_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    display_id text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'ai'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    trigger_label text NOT NULL,
    project_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    owner_user_id text,
    model_label text,
    reads text[] DEFAULT '{}'::text[] NOT NULL,
    proposes text,
    enabled boolean DEFAULT true NOT NULL,
    policy jsonb DEFAULT '{"read":"allowed","notebook_blocks":"never","dataset_flags":"never","create_records":"never","messages":"never"}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_definitions_pkey PRIMARY KEY (id),
    CONSTRAINT chk_agent_definitions_name CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT chk_agent_definitions_kind CHECK (kind = ANY (ARRAY['ai'::text, 'rule'::text])),
    CONSTRAINT chk_agent_definitions_display_id CHECK (display_id ~ '^AG-[0-9]{4,}$'),
    CONSTRAINT chk_agent_definitions_policy CHECK (internal.valid_agent_policy(policy))
);
--> statement-breakpoint
ALTER TABLE api.agent_definitions OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_definitions
    ADD CONSTRAINT agent_definitions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_definitions
    ADD CONSTRAINT agent_definitions_owner_user_id_user_id_fk FOREIGN KEY (owner_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_agent_definitions_display_id ON api.agent_definitions USING btree (workspace_id, display_id);
--> statement-breakpoint
CREATE TABLE api.agent_policy_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    revision integer NOT NULL,
    summary text NOT NULL,
    change_ref text,
    reason text NOT NULL,
    changed_by_user_id text,
    signed_meaning text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_policy_revisions_pkey PRIMARY KEY (id),
    CONSTRAINT chk_agent_policy_revisions_revision CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE api.agent_policy_revisions OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_policy_revisions
    ADD CONSTRAINT agent_policy_revisions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_policy_revisions
    ADD CONSTRAINT agent_policy_revisions_changed_by_user_id_user_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_agent_policy_revisions_number ON api.agent_policy_revisions USING btree (workspace_id, revision);
--> statement-breakpoint
CREATE TABLE api.agent_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    run_number integer NOT NULL,
    outcome text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    proposal_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_runs_pkey PRIMARY KEY (id),
    CONSTRAINT chk_agent_runs_number CHECK (run_number > 0),
    CONSTRAINT chk_agent_runs_outcome CHECK (outcome = ANY (ARRAY['proposed'::text, 'no_change'::text, 'sent'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE api.agent_runs OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_runs
    ADD CONSTRAINT agent_runs_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_runs
    ADD CONSTRAINT agent_runs_definition_id_agent_definitions_id_fk FOREIGN KEY (definition_id) REFERENCES api.agent_definitions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_runs
    ADD CONSTRAINT agent_runs_proposal_id_agent_operation_proposals_id_fk FOREIGN KEY (proposal_id) REFERENCES api.agent_operation_proposals(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_agent_runs_number ON api.agent_runs USING btree (definition_id, run_number);
--> statement-breakpoint
ALTER TABLE api.agent_operation_proposals
    ADD COLUMN display_id text,
    ADD COLUMN agent_definition_id uuid,
    ADD COLUMN agent_run_id uuid,
    ADD COLUMN approver_user_id text,
    ADD COLUMN signature_required boolean DEFAULT false NOT NULL,
    ADD COLUMN approval_meaning text,
    ADD COLUMN approval_signed_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_operation_proposals
    ADD CONSTRAINT agent_operation_proposals_agent_definition_id_fk FOREIGN KEY (agent_definition_id) REFERENCES api.agent_definitions(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_operation_proposals
    ADD CONSTRAINT agent_operation_proposals_agent_run_id_fk FOREIGN KEY (agent_run_id) REFERENCES api.agent_runs(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY api.agent_operation_proposals
    ADD CONSTRAINT agent_operation_proposals_approver_user_id_fk FOREIGN KEY (approver_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE api.agent_operation_proposals
    ADD CONSTRAINT chk_agent_operation_proposals_display_id CHECK (display_id IS NULL OR display_id ~ '^PR-[0-9]{4,}$');
--> statement-breakpoint
UPDATE api.agent_operation_proposals p SET display_id = 'PR-' || lpad(n.n::text, 4, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS n
          FROM api.agent_operation_proposals) n
 WHERE n.id = p.id;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_agent_operation_proposals_display_id ON api.agent_operation_proposals USING btree (workspace_id, display_id) WHERE display_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_agent_operation_proposals_definition ON api.agent_operation_proposals USING btree (agent_definition_id) WHERE agent_definition_id IS NOT NULL;
--> statement-breakpoint

CREATE FUNCTION internal.assign_agent_display_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_prefix text := CASE TG_TABLE_NAME WHEN 'agent_definitions' THEN 'AG-' ELSE 'PR-' END;
  v_next integer;
BEGIN
  IF NEW.display_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || NEW.workspace_id::text));
  IF TG_TABLE_NAME = 'agent_definitions' THEN
    SELECT coalesce(max(substr(display_id, 4)::integer), 0) + 1 INTO v_next
      FROM api.agent_definitions WHERE workspace_id = NEW.workspace_id;
  ELSE
    SELECT coalesce(max(substr(display_id, 4)::integer), 0) + 1 INTO v_next
      FROM api.agent_operation_proposals WHERE workspace_id = NEW.workspace_id AND display_id IS NOT NULL;
  END IF;
  NEW.display_id := v_prefix || lpad(v_next::text, 4, '0');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.assign_agent_display_id() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.assign_agent_display_id() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER agent_definitions_assign_display_id BEFORE INSERT ON api.agent_definitions FOR EACH ROW EXECUTE FUNCTION internal.assign_agent_display_id();
--> statement-breakpoint
CREATE TRIGGER agent_operation_proposals_assign_display_id BEFORE INSERT ON api.agent_operation_proposals FOR EACH ROW EXECUTE FUNCTION internal.assign_agent_display_id();
--> statement-breakpoint

ALTER TABLE api.agent_definitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_definitions_select ON api.agent_definitions FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_definitions TO authenticated;
--> statement-breakpoint
ALTER TABLE api.agent_policy_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_policy_revisions_select ON api.agent_policy_revisions FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_policy_revisions TO authenticated;
--> statement-breakpoint
ALTER TABLE api.agent_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_runs_select ON api.agent_runs FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_runs TO authenticated;
--> statement-breakpoint

-- Pause or resume a workflow. Its owner or a policy manager may.
CREATE FUNCTION api.set_agent_definition_enabled(p_definition_id uuid, p_enabled boolean) RETURNS api.agent_definitions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_result api.agent_definitions;
  v_actor text := api.current_user_id();
BEGIN
  SELECT * INTO v_result FROM api.agent_definitions
   WHERE id = p_definition_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_result.id IS NULL OR v_actor IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'agent workflow not found' USING ERRCODE = '42501';
  END IF;
  IF v_result.owner_user_id IS DISTINCT FROM v_actor
     AND NOT (api.has_capability(v_result.workspace_id, 'workspace.admin')
              OR api.is_workspace_member(v_result.workspace_id, 'steward')) THEN
    RAISE EXCEPTION 'only the owner or a workspace admin can pause or resume a workflow' USING ERRCODE = '42501';
  END IF;
  UPDATE api.agent_definitions SET enabled = p_enabled, updated_at = now()
   WHERE id = v_result.id RETURNING * INTO v_result;
  PERFORM internal.emit_change_event(
    v_result.workspace_id, 'agent_operation_policy', v_result.id, 'update',
    NULL, NULL, jsonb_build_object('effect', 'agent_workflow_enabled', 'displayId', v_result.display_id, 'enabled', p_enabled)
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.set_agent_definition_enabled(p_definition_id uuid, p_enabled boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_agent_definition_enabled(p_definition_id uuid, p_enabled boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_agent_definition_enabled(p_definition_id uuid, p_enabled boolean) TO authenticated;
--> statement-breakpoint

-- Change one workflow's policy. A policy manager, with a reason and a signature,
-- makes a numbered revision of the workspace's agent policy.
CREATE FUNCTION api.change_agent_policy(p_definition_id uuid, p_policy jsonb, p_change_ref text, p_reason text, p_meaning text) RETURNS api.agent_policy_revisions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_def api.agent_definitions;
  v_actor text := api.current_user_id();
  v_revision api.agent_policy_revisions;
  v_next integer;
  v_parts text[] := '{}';
  v_key text;
  v_label text;
  v_mode text;
BEGIN
  SELECT * INTO v_def FROM api.agent_definitions
   WHERE id = p_definition_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_def.id IS NULL THEN
    RAISE EXCEPTION 'agent workflow not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.require_agent_policy_manager(v_def.workspace_id);
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_meaning, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a signature meaning is required' USING ERRCODE = '22023';
  END IF;
  IF p_change_ref IS NOT NULL AND length(btrim(p_change_ref)) > 40 THEN
    RAISE EXCEPTION 'a change reference is at most 40 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.user_signature_certifications c
    WHERE c.workspace_id = v_def.workspace_id AND c.user_id = v_actor AND c.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'signature certification required' USING ERRCODE = '42501';
  END IF;
  IF p_policy IS NULL OR NOT internal.valid_agent_policy(p_policy) THEN
    RAISE EXCEPTION 'the policy must set read, notebook_blocks, dataset_flags, create_records and messages' USING ERRCODE = '22023';
  END IF;
  IF p_policy = v_def.policy THEN
    RAISE EXCEPTION 'the policy is unchanged' USING ERRCODE = '22023';
  END IF;
  FOR v_key, v_label IN
    SELECT * FROM (VALUES ('read', 'data access'), ('notebook_blocks', 'notebook blocks'),
                          ('dataset_flags', 'flags'), ('create_records', 'records'), ('messages', 'messages')) AS t(k, l)
  LOOP
    IF p_policy->>v_key IS DISTINCT FROM v_def.policy->>v_key THEN
      v_mode := CASE p_policy->>v_key
        WHEN 'never' THEN 'never' WHEN 'allowed' THEN 'allowed'
        WHEN 'needs_approval' THEN 'approval' ELSE 'e-signature' END;
      v_parts := v_parts || (v_def.name || ' ' || v_label || ' → ' || v_mode);
    END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext('agent_policy_revisions' || v_def.workspace_id::text));
  SELECT coalesce(max(revision), 0) + 1 INTO v_next
    FROM api.agent_policy_revisions WHERE workspace_id = v_def.workspace_id;
  UPDATE api.agent_definitions SET policy = p_policy, updated_at = now() WHERE id = v_def.id;
  INSERT INTO api.agent_policy_revisions
    (workspace_id, revision, summary, change_ref, reason, changed_by_user_id, signed_meaning)
  VALUES
    (v_def.workspace_id, v_next, array_to_string(v_parts, '; '), nullif(btrim(coalesce(p_change_ref, '')), ''),
     btrim(p_reason), v_actor, btrim(p_meaning))
  RETURNING * INTO v_revision;
  PERFORM internal.emit_change_event(
    v_def.workspace_id, 'agent_operation_policy', v_def.id, 'update',
    NULL, NULL, jsonb_build_object('effect', 'agent_policy_changed', 'displayId', v_def.display_id,
                                   'revision', v_next, 'policy', p_policy, 'reason', v_revision.reason)
  );
  RETURN v_revision;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.change_agent_policy(p_definition_id uuid, p_policy jsonb, p_change_ref text, p_reason text, p_meaning text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.change_agent_policy(p_definition_id uuid, p_policy jsonb, p_change_ref text, p_reason text, p_meaning text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.change_agent_policy(p_definition_id uuid, p_policy jsonb, p_change_ref text, p_reason text, p_meaning text) TO authenticated;
--> statement-breakpoint

-- Sign a proposal that needs an electronic signature to be approved.
CREATE FUNCTION api.sign_agent_operation(p_proposal_id uuid, p_expected_revision bigint, p_meaning text) RETURNS api.agent_operation_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_result api.agent_operation_proposals;
  v_user text := api.current_user_id();
BEGIN
  IF v_user IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'human session required for signing' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_result FROM api.agent_operation_proposals
   WHERE id = p_proposal_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.require_agent_operation_capability(v_result);
  IF v_result.status <> 'pending' OR v_result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale or decided proposal' USING ERRCODE = 'SB001';
  END IF;
  IF NOT v_result.signature_required THEN
    RAISE EXCEPTION 'this proposal does not need a signature' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_meaning, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a signature meaning is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.user_signature_certifications c
    WHERE c.workspace_id = v_result.workspace_id AND c.user_id = v_user AND c.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'signature certification required' USING ERRCODE = '42501';
  END IF;
  UPDATE api.agent_operation_proposals
     SET approval_meaning = btrim(p_meaning), approval_signed_at = now(), updated_at = now()
   WHERE id = v_result.id RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.sign_agent_operation(p_proposal_id uuid, p_expected_revision bigint, p_meaning text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.sign_agent_operation(p_proposal_id uuid, p_expected_revision bigint, p_meaning text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.sign_agent_operation(p_proposal_id uuid, p_expected_revision bigint, p_meaning text) TO authenticated;
--> statement-breakpoint

-- Approving needs the signature when the proposal asks for one, and a proposal
-- routed to a named approver is decided by that person or a workspace admin.
CREATE OR REPLACE FUNCTION api.decide_agent_operation(p_proposal_id uuid, p_expected_revision bigint, p_decision text, p_reason text DEFAULT NULL::text) RETURNS api.agent_operation_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_result api.agent_operation_proposals;
  v_user text := api.current_user_id();
BEGIN
  IF v_user IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'human session required for approval' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_result FROM api.agent_operation_proposals
   WHERE id=p_proposal_id AND workspace_id=api.current_workspace_id() FOR UPDATE;
  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE='42501';
  END IF;
  PERFORM internal.require_agent_operation_capability(v_result);
  IF v_result.status <> 'pending' OR v_result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale or decided proposal' USING ERRCODE='SB001';
  END IF;
  IF v_result.approver_user_id IS NOT NULL AND v_result.approver_user_id <> v_user
     AND NOT api.has_capability(v_result.workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'this proposal is waiting on its approver' USING ERRCODE='42501';
  END IF;
  IF p_decision = 'approve' THEN
    IF v_result.signature_required AND v_result.approval_meaning IS NULL THEN
      RAISE EXCEPTION 'this proposal needs an electronic signature to approve' USING ERRCODE='42501';
    END IF;
    UPDATE api.agent_operation_proposals
       SET status='approved',revision=revision+1,approved_by_user_id=v_user,
           approved_at=now(),updated_at=now()
     WHERE id=v_result.id RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'approved',
      CASE WHEN v_result.approval_meaning IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('signed', true, 'meaning', v_result.approval_meaning) END);
  ELSIF p_decision = 'reject' AND length(btrim(coalesce(p_reason,''))) BETWEEN 1 AND 1000 THEN
    UPDATE api.agent_operation_proposals
       SET status='rejected',revision=revision+1,rejected_by_user_id=v_user,
           rejected_at=now(),rejection_reason=btrim(p_reason),updated_at=now()
     WHERE id=v_result.id RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'rejected',jsonb_build_object('reason',v_result.rejection_reason));
  ELSE
    RAISE EXCEPTION 'decision must be approve or reject with a reason' USING ERRCODE='22023';
  END IF;
  PERFORM internal.emit_change_event(
    v_result.workspace_id,'agent_operation_proposal',v_result.id,'update',
    NULL,NULL,jsonb_build_object('status',v_result.status,'operationKind',v_result.operation_kind)
  );
  RETURN v_result;
END;
$$;
