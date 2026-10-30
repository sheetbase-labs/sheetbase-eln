-- Regulated-lab rules become a workspace choice.
--
-- Three rules were hard-wired for every lab, though only a regulated one
-- wants them: a signer's identity had to be verified by a different
-- administrator (so a lab with one administrator could never sign), an
-- experiment could only finish through review, and everyone was signed out
-- after 30 idle minutes. One "Regulated lab" setting now decides all three.
--
-- New workspaces start unregulated. Every workspace that exists when this
-- migration runs is marked regulated, so none of them changes behaviour.

ALTER TABLE api.workspace_settings
    ADD COLUMN regulated_lab boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- A workspace without a settings row has been living by the regulated rules,
-- so give it a row that says so before the default starts meaning "off".
INSERT INTO api.workspace_settings (workspace_id, created_by_user_id)
SELECT w.id,
       coalesce((SELECT m.user_id FROM api.workspace_memberships m
                  WHERE m.workspace_id = w.id AND m.role = 'owner'
                  ORDER BY m.created_at LIMIT 1), 'system')
  FROM api.workspaces w
 WHERE NOT EXISTS (SELECT 1 FROM api.workspace_settings s WHERE s.workspace_id = w.id);
--> statement-breakpoint
UPDATE api.workspace_settings SET regulated_lab = true;
--> statement-breakpoint

CREATE FUNCTION internal.is_regulated_lab(p_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce((SELECT s.regulated_lab FROM api.workspace_settings s
                    WHERE s.workspace_id = p_workspace_id), false);
$$;
--> statement-breakpoint
ALTER FUNCTION internal.is_regulated_lab(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.is_regulated_lab(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.is_regulated_lab(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.set_regulated_lab(p_workspace_id uuid, p_regulated boolean) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_regulated IS NULL THEN
    RAISE EXCEPTION 'invalid regulated lab setting' USING ERRCODE = 'SB057';
  END IF;
  INSERT INTO api.workspace_settings (workspace_id, regulated_lab, created_by_user_id)
  VALUES (p_workspace_id, p_regulated, api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET regulated_lab = p_regulated, updated_at = now()
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'regulated_lab', 'regulatedLab', v.regulated_lab));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_regulated_lab(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_regulated_lab(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_regulated_lab(uuid, boolean) TO authenticated;
--> statement-breakpoint

-- A signer's identity: another administrator's verification always counts; the
-- signer's own counts only while the lab is not regulated. Switching a lab to
-- regulated therefore stops self-certified signers from signing until a
-- different administrator verifies them.
CREATE OR REPLACE FUNCTION internal.signature_identity(p_workspace uuid, p_actor text, p_session text) RETURNS api.user_signature_certifications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE c api.user_signature_certifications;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.workspace_memberships
    WHERE workspace_id=p_workspace AND user_id=p_actor AND suspended_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM internal.session
    WHERE id=p_session AND "userId"=p_actor AND "expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'valid signing session required' USING ERRCODE='SB002';
  END IF;
  SELECT * INTO c FROM api.user_signature_certifications
    WHERE workspace_id=p_workspace AND user_id=p_actor FOR UPDATE;
  IF c.identity_verified_by IS NULL
    OR (c.identity_verified_by=p_actor AND internal.is_regulated_lab(p_workspace))
    OR c.identity_verified_at IS NULL OR c.verified_email IS DISTINCT FROM
      (SELECT email FROM internal."user" WHERE id=p_actor) THEN
    RAISE EXCEPTION 'independent identity verification required' USING ERRCODE='42501';
  END IF;
  RETURN c;
END $$;
--> statement-breakpoint

-- The signer confirms their own identity, in the session that asked for it.
-- The signing password is still set through the emailed one-use secret and
-- still checked at certification and at every signature.
CREATE FUNCTION api.self_verify_signature_identity(p_email text) RETURNS api.user_signature_certifications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE w uuid:=api.current_workspace_id(); a text:=api.current_user_id();
  s text:=api.claim_probe()->>'session_id'; c api.user_signature_certifications;
BEGIN
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated'
    OR internal.is_regulated_lab(w)
    OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships
      WHERE workspace_id=w AND user_id=a AND suspended_at IS NULL
        AND role IN ('owner','admin','steward','member','scientist','analyst','reviewer'))
    OR NOT EXISTS (SELECT 1 FROM internal.session
      WHERE id=s AND "userId"=a AND "expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'independent active administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM api.user_signature_certifications
    WHERE workspace_id=w AND user_id=a FOR UPDATE;
  IF c.id IS NULL OR c.credential_session_id IS DISTINCT FROM s
    OR p_email IS NULL OR p_email IS DISTINCT FROM
      (SELECT email FROM internal."user" WHERE id=a) THEN
    RAISE EXCEPTION 'current requested session and verified email required' USING ERRCODE='22023';
  END IF;
  UPDATE api.user_signature_certifications SET identity_verified_by=a,
    identity_verified_at=clock_timestamp(),verified_email=p_email,
    credential_authorization_id=gen_random_uuid(),credential_authorization_consumed_at=NULL,
    revoked_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
  UPDATE internal.signature_grants SET consumed_at=clock_timestamp()
    WHERE user_id=a AND consumed_at IS NULL;
  INSERT INTO internal.signature_authentication_events(workspace_id,user_id,session_id,event)
    VALUES(w,a,s,'identity-self-verified');
  RETURN c;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.self_verify_signature_identity(text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.self_verify_signature_identity(text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.self_verify_signature_identity(text) TO authenticated;
--> statement-breakpoint

-- Finishing without review. An unregulated lab can mark an experiment
-- Completed straight from In progress, and reopen it later. Completed is not
-- Approved: nobody reviewed it, and it is not locked. Review still works the
-- same way for labs that use it.
CREATE OR REPLACE FUNCTION api.set_experiment_status(p_record_id uuid, p_expected_metadata_version bigint, p_status text, p_reason text) RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL FOR UPDATE;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_record.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_expected_metadata_version IS NULL
     OR p_expected_metadata_version IS DISTINCT FROM v_record.metadata_version THEN
    RAISE EXCEPTION 'stale Record metadata revision' USING ERRCODE = 'SB001';
  END IF;
  IF p_status IS NULL
     OR p_status NOT IN ('draft', 'in_progress', 'on_hold', 'in_review', 'returned', 'approved', 'completed') THEN
    RAISE EXCEPTION 'invalid experiment status' USING ERRCODE = '22023';
  END IF;
  IF v_record.status = p_status THEN
    RAISE EXCEPTION 'experiment already has that status' USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('in_review', 'returned', 'approved') THEN
    RAISE EXCEPTION 'the review sets this status; submit the notebook for review' USING ERRCODE = 'SB116';
  END IF;
  IF p_status = 'completed' AND internal.is_regulated_lab(v_record.workspace_id) THEN
    RAISE EXCEPTION 'this lab finishes experiments through review; submit the notebook for review' USING ERRCODE = 'SB116';
  END IF;
  IF p_status = 'in_progress' AND v_record.status = 'draft' THEN
    RAISE EXCEPTION 'start an experiment with api.start_experiment' USING ERRCODE = 'SB109';
  END IF;
  IF NOT (
       (v_record.status = 'in_progress' AND p_status IN ('in_review', 'on_hold', 'completed'))
    OR (v_record.status = 'on_hold' AND p_status = 'in_progress')
    OR (v_record.status = 'in_review' AND p_status IN ('returned', 'approved'))
    OR (v_record.status = 'returned' AND p_status = 'in_progress')
    OR (v_record.status = 'approved' AND p_status = 'in_progress')
    OR (v_record.status = 'completed' AND p_status = 'in_progress')
  ) THEN
    RAISE EXCEPTION 'illegal experiment status transition' USING ERRCODE = 'SB111';
  END IF;
  IF v_record.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'record is locked; create an amendment instead' USING ERRCODE = 'SB112';
  END IF;
  IF p_status IN ('returned', 'approved') THEN
    IF v_record.project_id IS NULL OR NOT internal.can_review_project(v_record.project_id) THEN
      RAISE EXCEPTION 'project review authority required' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_record.project_id IS NULL OR NOT internal.can_edit_project(v_record.project_id) THEN
      RAISE EXCEPTION 'project edit authority required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_record.status <> 'draft'
     AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000) THEN
    RAISE EXCEPTION 'a transition reason is required' USING ERRCODE = '22023';
  END IF;

  UPDATE api.records
     SET status = p_status,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_record.id
  RETURNING * INTO v_record;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update',
    v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'experiment_status', 'status', p_status,
      'reason', btrim(coalesce(p_reason, ''))));
  RETURN v_record;
END $$;
--> statement-breakpoint

-- A finished experiment is closed to notebook edits until it is reopened,
-- just as an approved one is.
CREATE OR REPLACE FUNCTION internal.trg_blocks_closed_when_approved() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record_id uuid;
  v_status text;
BEGIN
  v_record_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END;
  SELECT status INTO v_status FROM api.records
   WHERE id = v_record_id
     AND kind = 'experiment'
     AND status IN ('approved', 'completed')
     AND deleted_at IS NULL;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'this experiment is approved; reopen or amend it to change the notebook'
      USING ERRCODE = 'SB116';
  ELSIF v_status = 'completed' THEN
    RAISE EXCEPTION 'this experiment is finished; reopen it to change the notebook'
      USING ERRCODE = 'SB116';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
