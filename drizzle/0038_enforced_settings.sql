-- Settings that do what they say.
--
-- The signature meanings, review workflow, change-reason and lock-on-sign
-- settings were saved and shown but nothing read them; calibration and
-- qualification gated booking only; and instrument administration was open to
-- anyone who was not a viewer. Each is now enforced where the data changes.
--
--   * A signature meaning switched off in Settings cannot be signed or asked for.
--   * A workspace that pins its review workflow submits with that workflow and
--     at least its reviewer count (the available workflows follow).
--   * "Require a reason for changes" makes the amendment reason mandatory.
--   * "Lock on sign" off leaves a record open after the approving signature.
--   * Runs and imports on an instrument meet the same retired, qualification and
--     calibration checks booking does: off, warn (flag the data) or block.
--   * Registering, retiring and setting up an instrument needs
--     instrument.manage (the Instruments area on the Roles page); recording a
--     calibration needs calibration.record.
--
-- Every rule is a workspace choice; none is forced on a lab that does not want it.

CREATE OR REPLACE FUNCTION api.create_instrument(p_workspace_id uuid, p_name text, p_instrument_type text DEFAULT 'qpcr'::text, p_model text DEFAULT NULL::text, p_serial_number text DEFAULT NULL::text, p_vendor text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_owner_id text DEFAULT NULL::text, p_config jsonb DEFAULT '{}'::jsonb, p_position integer DEFAULT 0, p_intake_method text DEFAULT 'none'::text)
 RETURNS api.instruments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v api.instruments; v_dup boolean;
BEGIN
 IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE='SB033'; END IF;
 IF NOT api.has_capability(p_workspace_id, 'instrument.manage') OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'instrument denied' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid instrument name' USING ERRCODE='SB034'; END IF;
 IF p_instrument_type NOT IN ('qpcr','sequencer','spectrophotometer','other') THEN RAISE EXCEPTION 'invalid instrument type' USING ERRCODE='SB035'; END IF;
 IF p_intake_method NOT IN ('filedrop','webhook','manual','none') THEN RAISE EXCEPTION 'invalid intake method' USING ERRCODE='SB035'; END IF;
 IF p_location IS NOT NULL AND length(btrim(p_location)) > 200 THEN RAISE EXCEPTION 'invalid location' USING ERRCODE='SB034'; END IF;
 IF p_serial_number IS NOT NULL AND btrim(p_serial_number) <> '' THEN
  SELECT EXISTS (SELECT 1 FROM api.instruments i WHERE i.workspace_id = p_workspace_id AND i.serial_number = btrim(p_serial_number)) INTO v_dup;
  IF v_dup THEN RAISE EXCEPTION 'serial already registered' USING ERRCODE='23505'; END IF;
 END IF;
 INSERT INTO api.instruments(workspace_id,name,instrument_type,model,serial_number,vendor,location,owner_id,intake_method,config,position,created_by_user_id,updated_by_user_id)
 VALUES(p_workspace_id,btrim(p_name),p_instrument_type,p_model,NULLIF(btrim(COALESCE(p_serial_number,'')),''),p_vendor,p_location,p_owner_id,p_intake_method,COALESCE(p_config,'{}'),p_position,api.current_user_id(),api.current_user_id())
 RETURNING * INTO v; RETURN v;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.set_instrument_retired(p_instrument_id uuid, p_retired boolean)
 RETURNS api.instruments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v api.instruments;
BEGIN
 SELECT * INTO v FROM api.instruments WHERE id=p_instrument_id;
 IF v.id IS NULL OR api.current_workspace_id() IS DISTINCT FROM v.workspace_id OR NOT api.has_capability(v.workspace_id, 'instrument.manage') OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'instrument denied' USING ERRCODE='42501'; END IF;
 UPDATE api.instruments SET retired_at=CASE WHEN p_retired THEN now() ELSE NULL END,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_instrument_id RETURNING * INTO v; RETURN v;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.set_instrument_intake_method(p_instrument_id uuid, p_intake_method text)
 RETURNS api.instruments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v api.instruments;
BEGIN
 IF p_intake_method NOT IN ('filedrop','webhook','manual','none') THEN RAISE EXCEPTION 'invalid intake method' USING ERRCODE='SB035'; END IF;
 SELECT * INTO v FROM api.instruments WHERE id=p_instrument_id;
 IF v.id IS NULL OR api.current_workspace_id() IS DISTINCT FROM v.workspace_id OR NOT api.has_capability(v.workspace_id, 'instrument.manage') OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'instrument denied' USING ERRCODE='42501'; END IF;
 UPDATE api.instruments SET intake_method=p_intake_method,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_instrument_id RETURNING * INTO v; RETURN v;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_calendar_resource(p_workspace_id uuid, p_name text, p_code text, p_resource_type text DEFAULT 'instrument'::text, p_location text DEFAULT NULL::text, p_capacity integer DEFAULT 1, p_timezone text DEFAULT 'UTC'::text, p_project_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS api.calendar_resources
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row "api"."calendar_resources";
BEGIN
 IF p_project_id IS NOT NULL THEN PERFORM internal.assert_object_access('project',p_project_id,'edit'); END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  -- Registering an instrument for booking is instrument administration.
  IF p_resource_type = 'instrument' AND NOT api.has_capability(p_workspace_id, 'instrument.manage') THEN
    RAISE EXCEPTION 'instrument access required' USING ERRCODE = '42501';
  END IF;
  IF p_resource_type NOT IN ('instrument','room','equipment') THEN
    RAISE EXCEPTION 'unsupported resource type: %', p_resource_type USING ERRCODE = 'SB005';
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 THEN
    RAISE EXCEPTION 'capacity must be at least 1' USING ERRCODE = 'SB005';
  END IF;

  INSERT INTO "api"."calendar_resources"
    (workspace_id, project_id, name, code, resource_type, location,
     capacity, timezone, metadata, created_by_user_id, updated_by_user_id)
  VALUES
    (p_workspace_id, p_project_id, btrim(p_name), btrim(p_code),
     p_resource_type, p_location, p_capacity, COALESCE(p_timezone, 'UTC'),
     COALESCE(p_metadata, '{}'::jsonb),
     "api"."current_user_id"(), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.record_instrument_calibration(p_instrument_id uuid, p_performed_at timestamp with time zone, p_due_at timestamp with time zone, p_certificate_file_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS api.instrument_calibrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v api.instrument_calibrations;
  i api.instruments;
BEGIN
  SELECT * INTO i FROM api.instruments WHERE id = p_instrument_id;
  IF i.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM i.workspace_id
     OR NOT api.has_capability(i.workspace_id, 'calibration.record')
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'instrument denied' USING ERRCODE = '42501';
  END IF;
  IF p_performed_at IS NULL OR p_due_at IS NULL OR p_due_at < p_performed_at THEN
    RAISE EXCEPTION 'invalid calibration dates' USING ERRCODE = '22023';
  END IF;
  IF p_certificate_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.file_objects
      WHERE id = p_certificate_file_id AND workspace_id = i.workspace_id
  ) THEN
    RAISE EXCEPTION 'certificate not in workspace' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.instrument_calibrations (
    workspace_id, instrument_id, performed_at, due_at,
    certificate_file_id, performed_by_user_id, notes, created_by_user_id
  ) VALUES (
    i.workspace_id, i.id, p_performed_at, p_due_at,
    p_certificate_file_id, api.current_user_id(), p_notes, api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_mask text;
BEGIN
  v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
  IF v_mask IS NOT NULL
     AND coalesce(current_setting('role', true), '') = 'api_client' THEN
    RAISE EXCEPTION 'capability mask is not caller-controlled'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    IF p_capability IN ('record.create', 'record.link', 'instance.upgrade', 'integrations.manage') THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM api.agent_operation_proposals proposal
      WHERE proposal.workspace_id = p_workspace_id
        AND proposal.status = 'executing'
        AND proposal.executed_by_credential_id = api.current_credential_id()
        AND (
          (proposal.operation_kind LIKE 'pipeline_definition.%'
           AND p_capability = 'pipelines.manage'
           AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
          OR (proposal.operation_kind IN (
            'dataset_schema.create',
            'sheet_definition.create',
            'sheet_definition.update_draft'
          ) AND p_capability = 'schema.edit'
          AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
        )
    );
  END IF;
  IF api.current_user_id() IS NULL THEN
    RETURN false;
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF session_user = 'migrator' AND v_mask IS NOT NULL THEN
    RETURN p_capability = ANY (
      string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
    );
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'integrations.manage' THEN
      RETURN api.has_settings_access(p_workspace_id, 'integrations', 'manage');
    WHEN p_capability ~ '^settings\.[a-z_]+\.(view|manage)$' THEN
      RETURN api.has_settings_access(
        p_workspace_id, split_part(p_capability, '.', 2), split_part(p_capability, '.', 3));
    -- Instrument administration follows the Instruments settings area, so the
    -- Roles page decides who registers, retires and sets up instruments.
    WHEN p_capability = 'instrument.manage' THEN
      RETURN api.has_settings_access(p_workspace_id, 'instruments', 'manage');
    -- Calibrations are recorded by the people who run the instruments, plus
    -- anyone who manages instruments.
    WHEN p_capability = 'calibration.record' THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist', 'member')
        OR api.has_settings_access(p_workspace_id, 'instruments', 'manage');
    WHEN p_capability = 'pipelines.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'extensions.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    -- LAB-02 step 2: release is the authorised-person QC gate; quarantine and
    -- disposal are scientific actions. api_client stays fail-closed (the
    -- sample RPCs are not in the external allowlist).
    WHEN p_capability = 'sample.release' THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist', 'reviewer');
    WHEN p_capability IN ('sample.quarantine', 'sample.dispose') THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_amendment(p_record_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_actor text;
  v_session text;
  v_role text;
  v_record api.records;
  v_locked_revision_id uuid;
  v_project uuid;
  v_envelope jsonb;
  v_digest text;
  v_new_revision_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
 IF p_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_record_id,'edit'); END IF;
  v_claims := api.claim_probe();
  IF v_claims IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  v_actor := nullif(v_claims->>'sub', '');
  v_session := nullif(v_claims->>'session_id', '');
  v_role := nullif(v_claims->>'role', '');
  IF v_workspace IS NULL OR v_actor IS NULL OR v_session IS NULL
     OR v_role <> 'authenticated'
     OR NOT api.is_workspace_writer(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT s.require_change_reason FROM api.workspace_settings s WHERE s.workspace_id = v_workspace), false)
     AND length(btrim(coalesce(p_note, ''))) = 0 THEN
    RAISE EXCEPTION 'this workspace requires a reason for the change' USING ERRCODE = 'SB133';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'note must be 1–8000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_record FROM api.records
  WHERE id = p_record_id AND workspace_id = v_workspace
  FOR UPDATE;
  IF v_record.id IS NULL OR v_record.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  -- The record must be locked — amendments only begin from a locked record.
  IF v_record.locked_at IS NULL THEN
    RAISE EXCEPTION 'record is not locked; nothing to amend'
      USING ERRCODE = 'SB012';
  END IF;
  v_locked_revision_id := v_record.locked_by_revision_id;

  v_envelope := internal.build_revision_envelope(v_record.id);
  v_digest := internal.revision_integrity_digest(v_envelope);

  INSERT INTO api.revisions (
    record_id, workspace_id, structure_version, metadata_version,
    metadata_snapshot, block_snapshot, canonical_snapshot,
    integrity_algorithm, integrity_digest, reason, created_at, updated_at,
    created_by_user_id
  ) VALUES (
    v_record.id, v_record.workspace_id, v_record.structure_version,
    v_record.metadata_version, v_envelope->'record', v_envelope->'blocks',
    v_envelope, 'sha256', v_digest, 'amend', v_now, v_now, v_actor
  ) RETURNING id INTO v_new_revision_id;

  -- Supersede the locked revision so history shows the amendment branch.
  IF v_locked_revision_id IS NOT NULL THEN
    UPDATE api.revisions
      SET superseded_by_revision_id = v_new_revision_id
      WHERE id = v_locked_revision_id;
  END IF;

  -- Unlock the record so the author can edit the new draft. Runs as migrator
  -- (SECURITY DEFINER), bypassing the locked-record mutation trigger.
  UPDATE api.records
    SET locked_at = NULL,
        locked_by_revision_id = NULL,
        updated_at = now(),
        updated_by_user_id = v_actor
    WHERE id = v_record.id;

  v_project := v_record.project_id;
  PERFORM internal.emit_change_event(
    v_workspace, 'record', v_record.id, 'amend', v_record.id, v_project,
    jsonb_build_object(
      'revisionId', v_new_revision_id,
      'supersedesRevisionId', v_locked_revision_id,
      'actorUserId', v_actor,
      'note', p_note
    )
  );

  RETURN jsonb_build_object(
    'revisionId', v_new_revision_id,
    'supersedesRevisionId', v_locked_revision_id,
    'recordId', v_record.id,
    'integrityDigest', v_digest,
    'unlockedAt', v_now
  );
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.lock_record_after_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.signature_meaning='reviewed-and-approved'
     AND coalesce((SELECT s.lock_on_sign FROM api.workspace_settings s WHERE s.workspace_id = NEW.workspace_id), true) THEN
    PERFORM internal.lock_record(NEW.record_id,NEW.revision_id,NEW.signed_at);
  END IF;
  RETURN NEW;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.update_workspace_settings(p_workspace_id uuid, p_registration_mode text DEFAULT NULL::text, p_review_workflow_enabled boolean DEFAULT NULL::boolean, p_review_workflow_config jsonb DEFAULT NULL::jsonb, p_signature_policy jsonb DEFAULT NULL::jsonb, p_audit_retention_days integer DEFAULT NULL::integer, p_integration_settings jsonb DEFAULT NULL::jsonb, p_require_change_reason boolean DEFAULT NULL::boolean, p_lock_on_sign boolean DEFAULT NULL::boolean, p_allow_offline_editing boolean DEFAULT NULL::boolean)
 RETURNS api.workspace_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v api.workspace_settings;
BEGIN
  -- Each setting is gated by the settings area it belongs to.
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR (p_registration_mode IS NOT NULL
         AND NOT api.has_settings_access(p_workspace_id, 'members', 'manage'))
     OR ((p_review_workflow_enabled IS NOT NULL OR p_review_workflow_config IS NOT NULL)
         AND NOT api.has_settings_access(p_workspace_id, 'signatures', 'manage'))
     OR ((p_require_change_reason IS NOT NULL OR p_lock_on_sign IS NOT NULL
          OR p_allow_offline_editing IS NOT NULL)
         AND NOT api.has_settings_access(p_workspace_id, 'general', 'manage'))
     OR (p_signature_policy IS NOT NULL
         AND NOT api.has_settings_access(p_workspace_id, 'signatures', 'manage'))
     OR (p_audit_retention_days IS NOT NULL
         AND NOT api.has_settings_access(p_workspace_id, 'audit', 'manage'))
     OR (p_integration_settings IS NOT NULL
         AND NOT api.has_settings_access(p_workspace_id, 'integrations', 'manage')) THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_registration_mode IS NOT NULL AND p_registration_mode NOT IN ('open', 'invitation_only') THEN
    RAISE EXCEPTION 'invalid registration mode' USING ERRCODE = 'SB056';
  END IF;
  IF p_review_workflow_config IS NOT NULL THEN
    IF jsonb_typeof(p_review_workflow_config) <> 'object'
       OR (p_review_workflow_config ? 'workflow'
           AND NOT EXISTS (SELECT 1 FROM internal.review_workflow_definitions d
                            WHERE d.definition_key = p_review_workflow_config->>'workflow'))
       OR (p_review_workflow_config ? 'minReviewers'
           AND (jsonb_typeof(p_review_workflow_config->'minReviewers') <> 'number'
                OR (p_review_workflow_config->>'minReviewers')::numeric NOT BETWEEN 1 AND 5
                OR (p_review_workflow_config->>'minReviewers')::numeric <> trunc((p_review_workflow_config->>'minReviewers')::numeric))) THEN
      RAISE EXCEPTION 'invalid review workflow settings' USING ERRCODE = 'SB057';
    END IF;
  END IF;
  IF p_audit_retention_days IS NOT NULL AND p_audit_retention_days <= 0 THEN
    RAISE EXCEPTION 'invalid retention days' USING ERRCODE = 'SB057';
  END IF;
  INSERT INTO api.workspace_settings(
    workspace_id, registration_mode, review_workflow_enabled, review_workflow_config,
    signature_policy, audit_retention_days, integration_settings,
    require_change_reason, lock_on_sign, allow_offline_editing, created_by_user_id)
  VALUES (
    p_workspace_id, coalesce(p_registration_mode, 'open'), coalesce(p_review_workflow_enabled, false),
    coalesce(p_review_workflow_config, '{}'), coalesce(p_signature_policy, '{}'),
    coalesce(p_audit_retention_days, 2555), coalesce(p_integration_settings, '{}'),
    coalesce(p_require_change_reason, false), coalesce(p_lock_on_sign, true),
    coalesce(p_allow_offline_editing, true), api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET
    registration_mode = coalesce(p_registration_mode, api.workspace_settings.registration_mode),
    review_workflow_enabled = coalesce(p_review_workflow_enabled, api.workspace_settings.review_workflow_enabled),
    review_workflow_config = coalesce(p_review_workflow_config, api.workspace_settings.review_workflow_config),
    signature_policy = coalesce(p_signature_policy, api.workspace_settings.signature_policy),
    audit_retention_days = coalesce(p_audit_retention_days, api.workspace_settings.audit_retention_days),
    integration_settings = coalesce(p_integration_settings, api.workspace_settings.integration_settings),
    require_change_reason = coalesce(p_require_change_reason, api.workspace_settings.require_change_reason),
    lock_on_sign = coalesce(p_lock_on_sign, api.workspace_settings.lock_on_sign),
    allow_offline_editing = coalesce(p_allow_offline_editing, api.workspace_settings.allow_offline_editing),
    updated_at = now()
  RETURNING * INTO v;
  IF p_require_change_reason IS NOT NULL OR p_lock_on_sign IS NOT NULL OR p_allow_offline_editing IS NOT NULL THEN
    PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
      jsonb_build_object('effect', 'editing_rules',
        'requireChangeReason', v.require_change_reason,
        'lockOnSign', v.lock_on_sign,
        'allowOfflineEditing', v.allow_offline_editing));
  END IF;
  RETURN v;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.available_review_workflows()
 RETURNS TABLE(definition_key text, version integer, requires_signature boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT d.definition_key,d.version,coalesce((d.definition->>'requiresSignature')::boolean,false)
  FROM internal.review_workflow_definitions d
  WHERE api.is_workspace_member(api.current_workspace_id())
    -- A workspace that pins its review workflow offers only that one.
    AND (NOT coalesce((SELECT s.review_workflow_enabled FROM api.workspace_settings s
                        WHERE s.workspace_id = api.current_workspace_id()), false)
         OR d.definition_key = coalesce((SELECT s.review_workflow_config->>'workflow' FROM api.workspace_settings s
                                          WHERE s.workspace_id = api.current_workspace_id()), 'default-scientific-review'))
  ORDER BY d.definition_key,d.version;
$function$;
--> statement-breakpoint
-- Whether an instrument that is overdue for calibration, retired, or not
-- qualified for the person at the keyboard may take data. Booking has always
-- refused these; this extends the same rule to runs and imports. off ignores
-- it, warn takes the data and flags it, block refuses it.
ALTER TABLE api.workspace_settings
    ADD COLUMN instrument_gate_mode text DEFAULT 'warn' NOT NULL;
--> statement-breakpoint
ALTER TABLE api.workspace_settings
    ADD CONSTRAINT chk_workspace_settings_instrument_gate_mode CHECK (instrument_gate_mode IN ('off', 'warn', 'block'));
--> statement-breakpoint
CREATE FUNCTION api.set_instrument_gate_mode(p_workspace_id uuid, p_mode text) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'instruments', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'warn', 'block') THEN
    RAISE EXCEPTION 'invalid instrument gate mode' USING ERRCODE = 'SB057';
  END IF;
  INSERT INTO api.workspace_settings (workspace_id, instrument_gate_mode, created_by_user_id)
  VALUES (p_workspace_id, p_mode, api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET instrument_gate_mode = p_mode, updated_at = now()
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'instrument_gate', 'mode', v.instrument_gate_mode));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_instrument_gate_mode(p_workspace_id uuid, p_mode text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_instrument_gate_mode(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_instrument_gate_mode(uuid, text) TO authenticated;
--> statement-breakpoint
-- What stands between an instrument and new data, in the order a person would
-- fix it: retired, then the person not being qualified, then calibration.
CREATE FUNCTION internal.instrument_gate_findings(p_instrument_id uuid, p_user_id text) RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument api.instruments;
  v_due timestamptz;
  v_found text[] := '{}';
BEGIN
  SELECT * INTO v_instrument FROM api.instruments WHERE id = p_instrument_id;
  IF v_instrument.id IS NULL THEN RETURN v_found; END IF;
  IF v_instrument.retired_at IS NOT NULL THEN v_found := array_append(v_found, 'retired'); END IF;
  -- Folder agents and credentials have no person to qualify.
  IF p_user_id IS NOT NULL AND NOT internal.instrument_qualified(v_instrument.id, p_user_id) THEN
    v_found := array_append(v_found, 'unqualified');
  END IF;
  SELECT c.due_at INTO v_due FROM api.instrument_calibrations c
   WHERE c.instrument_id = v_instrument.id
   ORDER BY c.performed_at DESC NULLS LAST, c.created_at DESC LIMIT 1;
  IF v_due IS NOT NULL AND v_due < now() THEN v_found := array_append(v_found, 'calibration_overdue'); END IF;
  RETURN v_found;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.instrument_gate_findings(p_instrument_id uuid, p_user_id text) OWNER TO migrator;
--> statement-breakpoint
-- Refuses (block) or reports (warn) when an instrument is not fit to take data.
-- Returns the findings to flag, or an empty array.
CREATE FUNCTION internal.apply_instrument_gate(p_workspace_id uuid, p_instrument_id uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_mode text;
  v_found text[];
BEGIN
  SELECT s.instrument_gate_mode INTO v_mode FROM api.workspace_settings s WHERE s.workspace_id = p_workspace_id;
  v_mode := coalesce(v_mode, 'warn');
  IF v_mode = 'off' OR p_instrument_id IS NULL THEN RETURN '{}'; END IF;
  v_found := internal.instrument_gate_findings(p_instrument_id, api.current_user_id());
  IF v_mode = 'block' AND cardinality(v_found) > 0 THEN
    IF v_found[1] = 'retired' THEN
      RAISE EXCEPTION 'this instrument is retired and cannot take new data' USING ERRCODE = 'SB134';
    ELSIF v_found[1] = 'unqualified' THEN
      RAISE EXCEPTION 'a current qualification is required to put data on this instrument' USING ERRCODE = 'SB115';
    ELSE
      RAISE EXCEPTION 'the instrument calibration is overdue' USING ERRCODE = 'SB116';
    END IF;
  END IF;
  RETURN v_found;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.apply_instrument_gate(p_workspace_id uuid, p_instrument_id uuid) OWNER TO migrator;
--> statement-breakpoint
-- Runs and imports are the two ways instrument data enters. The gate sits on
-- the tables so every path (the app, the folder agent, the API) meets it.
CREATE FUNCTION internal.gate_instrument_import() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_found text[];
BEGIN
  IF NEW.instrument_id IS NOT NULL THEN
    v_found := internal.apply_instrument_gate(NEW.workspace_id, NEW.instrument_id);
    IF cardinality(v_found) > 0 THEN
      NEW.outcome := CASE WHEN jsonb_typeof(NEW.outcome) = 'object' THEN NEW.outcome ELSE jsonb_build_object('result', NEW.outcome) END
        || jsonb_build_object('instrumentWarnings', to_jsonb(v_found));
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.gate_instrument_import() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER gate_instrument_import BEFORE INSERT ON api.dataset_imports
    FOR EACH ROW EXECUTE FUNCTION internal.gate_instrument_import();
--> statement-breakpoint
CREATE FUNCTION internal.gate_instrument_run() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_found text[];
BEGIN
  v_found := internal.apply_instrument_gate(NEW.workspace_id, NEW.instrument_id);
  IF cardinality(v_found) > 0 THEN
    NEW.tags := NEW.tags || ARRAY(SELECT 'flag:' || f FROM unnest(v_found) f WHERE NOT ('flag:' || f) = ANY (NEW.tags));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.gate_instrument_run() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER gate_instrument_run BEFORE INSERT ON api.instrument_runs
    FOR EACH ROW EXECUTE FUNCTION internal.gate_instrument_run();
--> statement-breakpoint
-- A signature meaning the workspace switched off cannot be signed or asked for.
-- Authored is always on. The sign dialog hides the meaning; this is the backstop.
CREATE FUNCTION internal.signature_meaning_enabled(p_workspace_id uuid, p_meaning text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce((
    SELECT (s.signature_policy->'meanings'->>(CASE p_meaning
        WHEN 'witnessed' THEN 'Witnessed'
        WHEN 'reviewed' THEN 'Reviewed'
        WHEN 'reviewed-and-approved' THEN 'Approved'
      END))::boolean
    FROM api.workspace_settings s WHERE s.workspace_id = p_workspace_id
  ), true)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.signature_meaning_enabled(p_workspace_id uuid, p_meaning text) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION internal.enforce_signature_meaning() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT internal.signature_meaning_enabled(NEW.workspace_id, NEW.signature_meaning) THEN
    RAISE EXCEPTION 'this signature meaning is switched off for the workspace' USING ERRCODE = 'SB130';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.enforce_signature_meaning() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER enforce_signature_meaning BEFORE INSERT ON api.signatures
    FOR EACH ROW EXECUTE FUNCTION internal.enforce_signature_meaning();
--> statement-breakpoint
CREATE FUNCTION internal.enforce_witness_meaning() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT internal.signature_meaning_enabled(NEW.workspace_id, 'witnessed') THEN
    RAISE EXCEPTION 'witnessing is switched off for the workspace' USING ERRCODE = 'SB130';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.enforce_witness_meaning() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER enforce_witness_meaning BEFORE INSERT ON api.signature_witness_requests
    FOR EACH ROW EXECUTE FUNCTION internal.enforce_witness_meaning();
--> statement-breakpoint
-- A workspace that pins its review workflow submits every review with that
-- workflow and at least the reviewer count it names.
CREATE FUNCTION internal.enforce_review_workflow() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.workspace_settings;
  v_workflow text;
  v_min integer;
BEGIN
  SELECT * INTO s FROM api.workspace_settings WHERE workspace_id = NEW.workspace_id;
  IF s.workspace_id IS NULL OR NOT s.review_workflow_enabled THEN RETURN NEW; END IF;
  v_workflow := coalesce(s.review_workflow_config->>'workflow', 'default-scientific-review');
  v_min := coalesce((s.review_workflow_config->>'minReviewers')::integer, 1);
  IF NEW.workflow_definition_key <> v_workflow THEN
    RAISE EXCEPTION 'this workspace reviews with a different workflow' USING ERRCODE = 'SB131';
  END IF;
  IF coalesce(cardinality(NEW.assigned_reviewer_user_ids), 0) < v_min THEN
    RAISE EXCEPTION 'this workspace needs at least % reviewers', v_min USING ERRCODE = 'SB132';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.enforce_review_workflow() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER enforce_review_workflow BEFORE INSERT ON api.review_submissions
    FOR EACH ROW EXECUTE FUNCTION internal.enforce_review_workflow();
--> statement-breakpoint
-- Every review workflow the product ships, for the admin who picks the one the
-- workspace uses. (available_review_workflows follows that choice.)
CREATE FUNCTION api.review_workflow_options() RETURNS TABLE(definition_key text, version integer, requires_signature boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT d.definition_key, d.version, coalesce((d.definition->>'requiresSignature')::boolean, false)
  FROM internal.review_workflow_definitions d
  WHERE api.is_workspace_member(api.current_workspace_id())
  ORDER BY d.definition_key, d.version;
$$;
--> statement-breakpoint
ALTER FUNCTION api.review_workflow_options() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.review_workflow_options() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.review_workflow_options() TO authenticated;
