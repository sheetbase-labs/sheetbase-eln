-- Sign-off per part of an experiment.
--
-- A part can be set up to need a signature. When its steps are done the person
-- doing the work signs the part: the part's blocks are frozen as a snapshot
-- with a digest, the signature is recorded the way every other signature is
-- (fresh password or the demo's typed name, never a standing login), and the
-- part after it opens. A signed part is read-only. Amending it asks for a
-- reason, reopens only that part, and keeps the old signature as evidence.
-- A countersign by another person is an optional request on top.
--
--   * api.experiment_parts            requires_sign_off, signed_off_at, signed_off_by_user_id, signoff_id
--   * api.experiment_part_signoffs    the signatures (immutable), with the frozen snapshot
--   * api.experiment_part_requests    a request to sign or countersign a part
--   * api.experiment_part_amendments  why a signed part was reopened (immutable)
--   * a signed part's blocks, day, order and title cannot change; later parts
--     cannot be worked while an earlier part that needs a signature is unsigned
--   * the current part is the first one not finished, and a part that needs a
--     signature is finished only once it is signed
--   * a notebook template can ask for sign-off on all its parts

-- ---------------------------------------------------------------------------
-- Columns, tables
-- ---------------------------------------------------------------------------
ALTER TABLE api.experiment_parts
    ADD COLUMN requires_sign_off boolean DEFAULT false NOT NULL,
    ADD COLUMN signed_off_at timestamp with time zone,
    ADD COLUMN signed_off_by_user_id text,
    ADD COLUMN signoff_id uuid;
--> statement-breakpoint

CREATE TABLE api.experiment_part_signoffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    part_id uuid NOT NULL,
    part_number integer NOT NULL,
    part_title text NOT NULL,
    -- signed: the person who did the part. witnessed: a countersign of that signature.
    meaning text NOT NULL,
    countersigns_id uuid,
    -- What was signed: the part's blocks and links at that moment, and its digest.
    snapshot jsonb NOT NULL,
    snapshot_digest text NOT NULL,
    signer_user_id text NOT NULL,
    signer_name text NOT NULL,
    signer_session_id text NOT NULL,
    auth_method text NOT NULL,
    confirmation_phrase text NOT NULL,
    signed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT experiment_part_signoffs_pkey PRIMARY KEY (id),
    CONSTRAINT experiment_part_signoffs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_signoffs_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_signoffs_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_signoffs_signer_fk FOREIGN KEY (signer_user_id) REFERENCES internal."user"(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_signoffs_countersigns_fk FOREIGN KEY (countersigns_id) REFERENCES api.experiment_part_signoffs(id) ON DELETE RESTRICT,
    CONSTRAINT chk_experiment_part_signoffs_meaning CHECK (meaning IN ('signed', 'witnessed')),
    CONSTRAINT chk_experiment_part_signoffs_countersign CHECK ((meaning = 'signed') = (countersigns_id IS NULL)),
    CONSTRAINT chk_experiment_part_signoffs_digest CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_experiment_part_signoffs_auth CHECK (auth_method IN ('password', 'demo'))
);
--> statement-breakpoint
ALTER TABLE api.experiment_part_signoffs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_experiment_part_signoffs_part ON api.experiment_part_signoffs (part_id, signed_at);
--> statement-breakpoint
CREATE INDEX idx_experiment_part_signoffs_record ON api.experiment_part_signoffs (record_id, signed_at);
--> statement-breakpoint
-- A person countersigns a given signature once.
CREATE UNIQUE INDEX uq_experiment_part_countersign ON api.experiment_part_signoffs (countersigns_id, signer_user_id)
    WHERE countersigns_id IS NOT NULL;
--> statement-breakpoint

ALTER TABLE api.experiment_parts
    ADD CONSTRAINT experiment_parts_signoff_fk FOREIGN KEY (signoff_id) REFERENCES api.experiment_part_signoffs(id) ON DELETE RESTRICT,
    ADD CONSTRAINT chk_experiment_parts_signed CHECK ((signed_off_at IS NULL) = (signoff_id IS NULL));
--> statement-breakpoint

CREATE TABLE api.experiment_part_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    part_id uuid NOT NULL,
    -- sign: please sign this part. countersign: please countersign a signed part.
    kind text NOT NULL,
    signoff_id uuid,
    requested_user_id text NOT NULL,
    requested_by_user_id text NOT NULL,
    note text,
    due_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fulfilled_at timestamp with time zone,
    CONSTRAINT experiment_part_requests_pkey PRIMARY KEY (id),
    CONSTRAINT experiment_part_requests_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT experiment_part_requests_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE CASCADE,
    CONSTRAINT experiment_part_requests_signoff_fk FOREIGN KEY (signoff_id) REFERENCES api.experiment_part_signoffs(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_requests_user_fk FOREIGN KEY (requested_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_experiment_part_requests_kind CHECK (kind IN ('sign', 'countersign')),
    CONSTRAINT chk_experiment_part_requests_target CHECK ((kind = 'countersign') = (signoff_id IS NOT NULL)),
    CONSTRAINT chk_experiment_part_requests_note CHECK (note IS NULL OR char_length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE api.experiment_part_requests OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_experiment_part_requests_user ON api.experiment_part_requests (requested_user_id) WHERE fulfilled_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_experiment_part_requests_record ON api.experiment_part_requests (record_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_experiment_part_request_open ON api.experiment_part_requests (part_id, kind, requested_user_id)
    WHERE fulfilled_at IS NULL;
--> statement-breakpoint

CREATE TABLE api.experiment_part_amendments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    part_id uuid NOT NULL,
    -- The signature this amendment set aside.
    signoff_id uuid NOT NULL,
    reason text NOT NULL,
    amended_by_user_id text NOT NULL,
    amended_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT experiment_part_amendments_pkey PRIMARY KEY (id),
    CONSTRAINT experiment_part_amendments_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_amendments_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_amendments_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_amendments_signoff_fk FOREIGN KEY (signoff_id) REFERENCES api.experiment_part_signoffs(id) ON DELETE RESTRICT,
    CONSTRAINT experiment_part_amendments_user_fk FOREIGN KEY (amended_by_user_id) REFERENCES internal."user"(id) ON DELETE RESTRICT,
    CONSTRAINT chk_experiment_part_amendments_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000)
);
--> statement-breakpoint
ALTER TABLE api.experiment_part_amendments OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_experiment_part_amendments_part ON api.experiment_part_amendments (part_id, amended_at);
--> statement-breakpoint

-- Signatures and amendments are evidence: nobody changes or removes them. The
-- migrator login is exempt, as it is for signatures, so a test database can reset.
CREATE FUNCTION internal.prevent_part_evidence_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_user = 'migrator' AND session_user = 'migrator' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'part sign-offs are immutable' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.prevent_part_evidence_mutation() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.prevent_part_evidence_mutation() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER prevent_part_signoff_mutation BEFORE UPDATE OR DELETE ON api.experiment_part_signoffs
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_part_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER prevent_part_amendment_mutation BEFORE UPDATE OR DELETE ON api.experiment_part_amendments
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_part_evidence_mutation();
--> statement-breakpoint

-- Reading follows the experiment: whoever can see it can see who signed what.
ALTER TABLE api.experiment_part_signoffs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY experiment_part_signoffs_select ON api.experiment_part_signoffs FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
CREATE POLICY experiment_part_signoffs_select_api_client ON api.experiment_part_signoffs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id() AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
ALTER TABLE api.experiment_part_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY experiment_part_requests_select ON api.experiment_part_requests FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
CREATE POLICY experiment_part_requests_select_api_client ON api.experiment_part_requests FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id() AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
ALTER TABLE api.experiment_part_amendments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY experiment_part_amendments_select ON api.experiment_part_amendments FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
CREATE POLICY experiment_part_amendments_select_api_client ON api.experiment_part_amendments FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id() AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_part_signoffs TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_part_signoffs TO api_client;
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_part_requests TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_part_requests TO api_client;
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_part_amendments TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_part_amendments TO api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The signing grant learns about parts
-- ---------------------------------------------------------------------------
ALTER TABLE internal.signature_grants ADD COLUMN part_id uuid;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE internal.signature_grants DROP CONSTRAINT chk_signature_grants_purpose;
  ALTER TABLE internal.signature_grants ADD CONSTRAINT chk_signature_grants_purpose
    CHECK (purpose = ANY (ARRAY['sign'::text, 'author-submit'::text, 'sign-part'::text, 'certify'::text, 'practice'::text, 'enroll'::text, 'recover'::text]));
  ALTER TABLE internal.signature_grants DROP CONSTRAINT chk_signature_grants_binding;
  ALTER TABLE internal.signature_grants ADD CONSTRAINT chk_signature_grants_binding CHECK (
    (purpose = 'sign' AND submission_id IS NOT NULL AND revision_digest ~ '^[0-9a-f]{64}$'
       AND record_id IS NULL AND submission_arguments IS NULL AND part_id IS NULL)
    OR (purpose = 'author-submit' AND submission_id IS NULL AND revision_digest ~ '^[0-9a-f]{64}$'
       AND record_id IS NOT NULL AND signature_meaning = 'authored'
       AND jsonb_typeof(submission_arguments) = 'object' AND part_id IS NULL)
    OR (purpose = 'sign-part' AND submission_id IS NULL AND part_id IS NOT NULL
       AND revision_digest ~ '^[0-9a-f]{64}$' AND record_id IS NOT NULL
       AND signature_meaning IN ('signed', 'witnessed') AND submission_arguments IS NULL)
    OR (purpose <> ALL (ARRAY['sign'::text, 'author-submit'::text, 'sign-part'::text])
       AND submission_id IS NULL AND revision_digest IS NULL AND record_id IS NULL
       AND signature_meaning IS NULL AND submission_arguments IS NULL AND part_id IS NULL));
END $$;
--> statement-breakpoint

-- Consuming a grant checks the signer's certification for the purposes that
-- sign; signing a part is one of them. (Patched in place so any later change
-- to the function body is kept.)
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.consume_signature_grant(text,text,uuid,text,text,uuid,text)'::regprocedure) INTO v_def;
  IF position('''sign'',''practice'',''author-submit''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.consume_signature_grant';
  END IF;
  v_def := replace(v_def, '''sign'',''practice'',''author-submit''', '''sign'',''practice'',''author-submit'',''sign-part''');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Change feed, webhooks, notifications, pipeline triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  v_def := replace(v_def, '::text]', '::text, ''part_signoff''::text, ''part_countersign''::text, ''part_amendment''::text, ''part_signoff_request''::text]');
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('experiment.part_signed'), ('experiment.part_countersigned'), ('experiment.part_amended');
--> statement-breakpoint

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''experiment.part_opened'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''experiment.part_opened'',',
    '''experiment.part_opened'', ''experiment.part_signed'', ''experiment.part_countersigned'', ''experiment.part_amended'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email, default_push)
VALUES ('part_signoff_request', 'notification', ARRAY[]::text[], false, true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Templates ask for sign-off on all their parts
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('internal.validate_notebook_template_configuration(uuid,jsonb)'::regprocedure) INTO v_def;
  v_new := regexp_replace(v_def, '(ARRAY\[''formatVersion''[^\]]*)\](,\s*''configuration'')', E'\\1,''signOffParts'']\\2');
  IF v_new = v_def OR position('IF p_config ? ''parts'' THEN' IN v_new) = 0 THEN
    RAISE EXCEPTION 'could not patch internal.validate_notebook_template_configuration';
  END IF;
  v_new := replace(v_new, 'IF p_config ? ''parts'' THEN',
    $sign$IF p_config ? 'signOffParts' AND jsonb_typeof(p_config->'signOffParts') <> 'boolean' THEN
    RAISE EXCEPTION 'invalid Notebook Template sign-off setting' USING ERRCODE = 'SB091';
  END IF;
  IF p_config ? 'parts' THEN$sign$);
  EXECUTE v_new;
END $$;
--> statement-breakpoint

-- Parts of an experiment made from such a template need a signature. A part
-- added later takes the same setting as the parts already there.
CREATE FUNCTION internal.apply_template_part_signoff() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_config jsonb;
  v_on boolean;
BEGIN
  SELECT configuration INTO v_config FROM api.notebook_template_versions WHERE id = NEW.template_version_id;
  -- Unset means the lab's default: on in a regulated lab.
  IF v_config IS NOT NULL AND v_config ? 'signOffParts' THEN
    v_on := v_config->'signOffParts' = 'true'::jsonb;
  ELSE
    v_on := internal.is_regulated_lab((SELECT r.workspace_id FROM api.records r WHERE r.id = NEW.record_id));
  END IF;
  IF v_on THEN
    UPDATE api.experiment_parts SET requires_sign_off = true
     WHERE record_id = NEW.record_id AND signed_off_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.apply_template_part_signoff() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.apply_template_part_signoff() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER template_parts_signoff AFTER INSERT ON api.notebook_template_instantiations
  FOR EACH ROW EXECUTE FUNCTION internal.apply_template_part_signoff();
--> statement-breakpoint

CREATE FUNCTION internal.inherit_part_sign_off() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT NEW.requires_sign_off AND EXISTS (
       SELECT 1 FROM api.experiment_parts x WHERE x.record_id = NEW.record_id AND x.requires_sign_off) THEN
    NEW.requires_sign_off := true;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.inherit_part_sign_off() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.inherit_part_sign_off() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER inherit_part_sign_off BEFORE INSERT ON api.experiment_parts
  FOR EACH ROW EXECUTE FUNCTION internal.inherit_part_sign_off();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The lock on a signed part
-- ---------------------------------------------------------------------------

-- A signed part's blocks cannot be changed, removed, or moved out, and nothing
-- can be put into it. Moving blocks around by order alone (when another part
-- changes) is not a change to the part. Amending the part lifts the lock.
CREATE FUNCTION internal.guard_signed_part_blocks() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.part_id IS NOT NULL
     AND NOT (TG_OP = 'UPDATE' AND NEW.part_id IS NOT DISTINCT FROM OLD.part_id
              AND NEW.type = OLD.type AND NEW.payload IS NOT DISTINCT FROM OLD.payload)
     AND EXISTS (SELECT 1 FROM api.experiment_parts p WHERE p.id = OLD.part_id AND p.signed_off_at IS NOT NULL) THEN
    RAISE EXCEPTION 'this part is signed: amend it to change it' USING ERRCODE = 'SB150';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.part_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.part_id IS DISTINCT FROM OLD.part_id)
     AND EXISTS (SELECT 1 FROM api.experiment_parts p WHERE p.id = NEW.part_id AND p.signed_off_at IS NOT NULL) THEN
    RAISE EXCEPTION 'this part is signed: amend it to change it' USING ERRCODE = 'SB150';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.guard_signed_part_blocks() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.guard_signed_part_blocks() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER part_signoff_lock BEFORE INSERT OR UPDATE OR DELETE ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION internal.guard_signed_part_blocks();
--> statement-breakpoint

-- Samples and data linked to a signed part are part of what was signed.
CREATE FUNCTION internal.guard_signed_part_links() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.part_id IS NOT NULL
     AND NOT (TG_OP = 'UPDATE' AND NEW.part_id IS NOT DISTINCT FROM OLD.part_id
              AND NEW.target_identifier = OLD.target_identifier AND NEW.link_type = OLD.link_type)
     AND EXISTS (SELECT 1 FROM api.experiment_parts p WHERE p.id = OLD.part_id AND p.signed_off_at IS NOT NULL) THEN
    RAISE EXCEPTION 'this part is signed: amend it to change it' USING ERRCODE = 'SB150';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.part_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.part_id IS DISTINCT FROM OLD.part_id)
     AND EXISTS (SELECT 1 FROM api.experiment_parts p WHERE p.id = NEW.part_id AND p.signed_off_at IS NOT NULL) THEN
    RAISE EXCEPTION 'this part is signed: amend it to change it' USING ERRCODE = 'SB150';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.guard_signed_part_links() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.guard_signed_part_links() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER part_signoff_lock BEFORE INSERT OR UPDATE OR DELETE ON api.record_links
  FOR EACH ROW EXECUTE FUNCTION internal.guard_signed_part_links();
--> statement-breakpoint

-- A step cannot be finished in a part while an earlier part that needs a
-- signature has not been signed.
CREATE FUNCTION internal.assert_earlier_parts_signed(p_part_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_blocking record;
BEGIN
  SELECT e.title,
         (SELECT count(*) FROM api.experiment_parts z
           WHERE z.record_id = e.record_id AND (z."position", z.id) <= (e."position", e.id))::integer AS number
    INTO v_blocking
    FROM api.experiment_parts me
    JOIN api.experiment_parts e ON e.record_id = me.record_id
   WHERE me.id = p_part_id AND e.requires_sign_off AND e.signed_off_at IS NULL
     AND (e."position", e.id) < (me."position", me.id)
   ORDER BY e."position", e.id
   LIMIT 1;
  IF v_blocking.title IS NOT NULL THEN
    RAISE EXCEPTION 'sign off Part % (%) before working on this part', v_blocking.number, v_blocking.title
      USING ERRCODE = 'SB151';
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.assert_earlier_parts_signed(p_part_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.assert_earlier_parts_signed(p_part_id uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.guard_part_step_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.type = 'procedure_step' AND NEW.part_id IS NOT NULL
     AND coalesce(NEW.payload->>'completed', 'false') = 'true'
     AND coalesce(OLD.payload->>'completed', 'false') <> 'true' THEN
    PERFORM internal.assert_earlier_parts_signed(NEW.part_id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.guard_part_step_order() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.guard_part_step_order() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER part_signoff_order BEFORE UPDATE OF payload ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION internal.guard_part_step_order();
--> statement-breakpoint

-- A signed part keeps its title, day, place and finished state; it cannot be
-- deleted once it has been signed; and a part cannot be marked done while an
-- earlier part that needs a signature is unsigned.
CREATE FUNCTION internal.guard_signed_part() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM api.experiment_part_signoffs s WHERE s.part_id = OLD.id) THEN
      RAISE EXCEPTION 'a part that has been signed cannot be deleted' USING ERRCODE = 'SB150';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.signed_off_at IS NOT NULL AND NEW.signed_off_at IS NOT NULL
     AND (NEW.title, NEW.day_offset, NEW."position", NEW.completed_at, NEW.requires_sign_off)
         IS DISTINCT FROM (OLD.title, OLD.day_offset, OLD."position", OLD.completed_at, OLD.requires_sign_off) THEN
    RAISE EXCEPTION 'this part is signed: amend it to change it' USING ERRCODE = 'SB150';
  END IF;
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    PERFORM internal.assert_earlier_parts_signed(NEW.id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.guard_signed_part() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.guard_signed_part() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_signed_part BEFORE UPDATE OR DELETE ON api.experiment_parts
  FOR EACH ROW EXECUTE FUNCTION internal.guard_signed_part();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A part that needs a signature is finished only when it is signed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.refresh_record_parts(uuid)'::regprocedure) INTO v_def;
  IF position('IF NOT v_done AND NOT v_current_found THEN' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.refresh_record_parts';
  END IF;
  v_def := replace(v_def, 'IF NOT v_done AND NOT v_current_found THEN',
    'IF NOT (v_done AND (NOT v_part.requires_sign_off OR v_part.signed_off_at IS NOT NULL)) AND NOT v_current_found THEN');
  EXECUTE v_def;

  SELECT pg_get_functiondef('api.record_parts(uuid)'::regprocedure) INTO v_def;
  IF position('SELECT id FROM parts WHERE completed_at IS NULL ORDER BY n LIMIT 1' IN v_def) = 0
     OR position('CASE WHEN p.completed_at IS NOT NULL THEN ''done''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.record_parts';
  END IF;
  v_def := replace(v_def, 'SELECT id FROM parts WHERE completed_at IS NULL ORDER BY n LIMIT 1',
    'SELECT id FROM parts WHERE NOT (completed_at IS NOT NULL AND (NOT requires_sign_off OR signed_off_at IS NOT NULL)) ORDER BY n LIMIT 1');
  v_def := replace(v_def, 'CASE WHEN p.completed_at IS NOT NULL THEN ''done''',
    'CASE WHEN p.completed_at IS NOT NULL AND (NOT p.requires_sign_off OR p.signed_off_at IS NOT NULL) THEN ''done''');
  EXECUTE v_def;

  SELECT pg_get_functiondef('api.parts_in_range(date,date)'::regprocedure) INTO v_def;
  IF position('min(CASE WHEN p.completed_at IS NULL THEN p."position" END)' IN v_def) = 0
     OR position('CASE WHEN p.completed_at IS NOT NULL THEN ''done''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.parts_in_range';
  END IF;
  v_def := replace(v_def, 'min(CASE WHEN p.completed_at IS NULL THEN p."position" END)',
    'min(CASE WHEN NOT (p.completed_at IS NOT NULL AND (NOT p.requires_sign_off OR p.signed_off_at IS NOT NULL)) THEN p."position" END)');
  v_def := replace(v_def, 'CASE WHEN p.completed_at IS NOT NULL THEN ''done''',
    'CASE WHEN p.completed_at IS NOT NULL AND (NOT p.requires_sign_off OR p.signed_off_at IS NOT NULL) THEN ''done''');
  EXECUTE v_def;

  SELECT pg_get_functiondef('api.record_steps(uuid)'::regprocedure) INTO v_def;
  IF position('SELECT p.id, p.title, p.completed_at, row_number()' IN v_def) = 0
     OR position('SELECT id FROM parts WHERE completed_at IS NULL ORDER BY n LIMIT 1' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.record_steps';
  END IF;
  v_def := replace(v_def, 'SELECT p.id, p.title, p.completed_at, row_number()',
    'SELECT p.id, p.title, p.completed_at, p.requires_sign_off, p.signed_off_at, row_number()');
  v_def := replace(v_def, 'SELECT id FROM parts WHERE completed_at IS NULL ORDER BY n LIMIT 1',
    'SELECT id FROM parts WHERE NOT (completed_at IS NOT NULL AND (NOT requires_sign_off OR signed_off_at IS NOT NULL)) ORDER BY n LIMIT 1');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- What a signature covers
-- ---------------------------------------------------------------------------

-- The part as it is now: its blocks in order and the samples and data linked
-- to it. Signing freezes exactly this; its digest is what the signer approves.
CREATE FUNCTION internal.part_snapshot(p_part_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
    'formatVersion', 1,
    'record', jsonb_build_object('id', r.id, 'identifier', r.identifier, 'title', r.title),
    'part', jsonb_build_object(
      'id', p.id,
      'number', (SELECT count(*) FROM api.experiment_parts z
                  WHERE z.record_id = p.record_id AND (z."position", z.id) <= (p."position", p.id))::integer,
      'title', p.title, 'dayOffset', p.day_offset),
    'blocks', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'type', b.type, 'payload', b.payload)
                                         ORDER BY b."order", b.id)
                          FROM api.blocks b WHERE b.part_id = p.id), '[]'::jsonb),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'linkType', l.link_type,
                                                           'target', l.target_identifier)
                                        ORDER BY l.id)
                         FROM api.record_links l WHERE l.part_id = p.id), '[]'::jsonb))
    FROM api.experiment_parts p JOIN api.records r ON r.id = p.record_id
   WHERE p.id = p_part_id;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.part_snapshot(p_part_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_snapshot(p_part_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- What the signer is about to sign: the digest to bind the password check to,
-- and a count of what it covers.
CREATE FUNCTION api.part_signoff_preview(p_part_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts
   WHERE id = p_part_id AND workspace_id = api.current_workspace_id();
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('record', v_part.record_id, 'view');
  v_snapshot := internal.part_snapshot(p_part_id);
  RETURN jsonb_build_object(
    'part_id', p_part_id, 'record_id', v_part.record_id,
    'digest', internal.revision_integrity_digest(v_snapshot),
    'part_number', (v_snapshot->'part'->>'number')::integer,
    'title', v_part.title,
    'block_count', jsonb_array_length(v_snapshot->'blocks'),
    'step_count', (SELECT count(*) FROM jsonb_array_elements(v_snapshot->'blocks') e WHERE e->>'type' = 'procedure_step'),
    'requires_sign_off', v_part.requires_sign_off,
    'work_done', v_part.completed_at IS NOT NULL,
    'signed', v_part.signed_off_at IS NOT NULL);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.part_signoff_preview(p_part_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.part_signoff_preview(p_part_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.part_signoff_preview(p_part_id uuid) TO authenticated;
--> statement-breakpoint

-- One event for a sign-off, countersign, amendment or request.
CREATE FUNCTION internal.emit_part_signoff_event(p_part api.experiment_parts, p_entity_type text, p_entity_id uuid, p_change text, p_extra jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_number integer;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_part.record_id;
  IF v_record.id IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*)::integer INTO v_number FROM api.experiment_parts
   WHERE record_id = p_part.record_id AND ("position", id) <= (p_part."position", p_part.id);
  PERFORM internal.emit_change_event(v_record.workspace_id, p_entity_type, p_entity_id, 'create',
    p_part.record_id, v_record.project_id,
    jsonb_build_object('change', p_change,
                       'partId', p_part.id, 'partNumber', v_number, 'part', p_part.title,
                       'recordId', p_part.record_id,
                       'identifier', v_record.identifier, 'title', v_record.title,
                       'dayOffset', p_part.day_offset,
                       'assigneeUserId', p_part.assignee_user_id) || p_extra);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_part_signoff_event(p_part api.experiment_parts, p_entity_type text, p_entity_id uuid, p_change text, p_extra jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.emit_part_signoff_event(p_part api.experiment_parts, p_entity_type text, p_entity_id uuid, p_change text, p_extra jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Who may sign: a signed-in person with a live session, a writer in the
-- workspace, with the experiment open to them.
CREATE FUNCTION internal.assert_part_signer(p_record_id uuid, p_permission text) RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  w uuid := api.current_workspace_id();
  a text := api.current_user_id();
  session_id text := api.claim_probe()->>'session_id';
  v_record api.records;
BEGIN
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated' OR NOT api.is_workspace_writer(w)
     OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships WHERE workspace_id = w AND user_id = a AND suspended_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM internal.session WHERE id = session_id AND "userId" = a AND "expiresAt" > clock_timestamp()) THEN
    RAISE EXCEPTION 'valid human signing session required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND workspace_id = w AND deleted_at IS NULL;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'experiment not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, p_permission);
  IF v_record.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'this experiment is archived' USING ERRCODE = 'SB006';
  END IF;
  IF v_record.locked_at IS NOT NULL OR internal.record_is_locked(p_record_id) THEN
    RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
  END IF;
  RETURN v_record;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.assert_part_signer(p_record_id uuid, p_permission text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.assert_part_signer(p_record_id uuid, p_permission text) FROM PUBLIC;
--> statement-breakpoint

-- Whether this person may sign (or countersign) this part right now, against
-- this digest. The password check asks it before issuing a grant, and signing
-- asks it again before using the grant, so the two cannot disagree.
CREATE FUNCTION internal.assert_part_signature_target(p_part_id uuid, p_meaning text, p_digest text) RETURNS api.experiment_parts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  w uuid := api.current_workspace_id();
  a text := api.current_user_id();
  v_part api.experiment_parts;
  v_signed api.experiment_part_signoffs;
  v_digest text;
BEGIN
  IF p_meaning IS NULL OR p_meaning NOT IN ('signed', 'witnessed') THEN
    RAISE EXCEPTION 'a part is signed or countersigned' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id AND workspace_id = w;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_part_signer(v_part.record_id, CASE WHEN p_meaning = 'signed' THEN 'edit' ELSE 'view' END);
  IF NOT v_part.requires_sign_off THEN
    RAISE EXCEPTION 'this part is not set up for sign-off' USING ERRCODE = 'SB152';
  END IF;
  v_digest := internal.revision_integrity_digest(internal.part_snapshot(p_part_id));
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR p_digest <> v_digest THEN
    RAISE EXCEPTION 'the part changed since it was shown to you' USING ERRCODE = 'SB001';
  END IF;
  IF p_meaning = 'signed' THEN
    IF v_part.signed_off_at IS NOT NULL THEN
      RAISE EXCEPTION 'this part is already signed' USING ERRCODE = 'SB152';
    END IF;
    IF v_part.completed_at IS NULL THEN
      RAISE EXCEPTION 'finish the part before signing it' USING ERRCODE = 'SB152';
    END IF;
  ELSE
    SELECT * INTO v_signed FROM api.experiment_part_signoffs WHERE id = v_part.signoff_id;
    IF v_signed.id IS NULL THEN
      RAISE EXCEPTION 'the part has to be signed before it can be countersigned' USING ERRCODE = 'SB152';
    END IF;
    IF a = v_signed.signer_user_id THEN
      RAISE EXCEPTION 'a countersign has to come from someone other than the signer' USING ERRCODE = 'SB152';
    END IF;
    IF v_digest <> v_signed.snapshot_digest THEN
      RAISE EXCEPTION 'the part no longer matches what was signed' USING ERRCODE = 'SB001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM api.experiment_part_requests q
                    WHERE q.part_id = p_part_id AND q.kind = 'countersign' AND q.signoff_id = v_signed.id
                      AND q.requested_user_id = a AND q.fulfilled_at IS NULL) THEN
      RAISE EXCEPTION 'an explicit request to countersign is required' USING ERRCODE = 'SB152';
    END IF;
  END IF;
  RETURN v_part;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.assert_part_signature_target(p_part_id uuid, p_meaning text, p_digest text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.assert_part_signature_target(p_part_id uuid, p_meaning text, p_digest text) FROM PUBLIC;
--> statement-breakpoint

-- Sign a part, or countersign it. The caller has proved who they are with a
-- fresh password (or, in the demo, their typed name) for exactly this part and
-- exactly this digest; the grant is spent here. Signing a part freezes it and
-- opens the next. People named in `p_countersign_user_ids` are asked to
-- countersign; that is a request, not a gate.
CREATE FUNCTION api.sign_experiment_part(p_part_id uuid, p_meaning text, p_confirmation_phrase text, p_expected_digest text, p_signing_token text, p_countersign_user_ids text[] DEFAULT '{}'::text[], p_due_at timestamp with time zone DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  w uuid := api.current_workspace_id();
  a text := api.current_user_id();
  session_id text := api.claim_probe()->>'session_id';
  v_part api.experiment_parts;
  v_signed api.experiment_part_signoffs;
  v_row api.experiment_part_signoffs;
  v_snapshot jsonb;
  v_digest text;
  v_name text;
  v_grant internal.signature_grants;
  v_method text;
  v_witness text;
BEGIN
  PERFORM 1 FROM api.experiment_parts WHERE id = p_part_id AND workspace_id = w FOR UPDATE;
  v_part := internal.assert_part_signature_target(p_part_id, p_meaning, p_expected_digest);
  v_digest := p_expected_digest;
  IF p_meaning = 'witnessed' THEN
    SELECT * INTO v_signed FROM api.experiment_part_signoffs WHERE id = v_part.signoff_id;
  END IF;
  -- Same lock order as password issuance and certification withdrawal.
  PERFORM internal.signature_identity(w, a, session_id);
  v_snapshot := internal.part_snapshot(p_part_id);
  SELECT name INTO v_name FROM internal."user" WHERE id = a;
  IF v_name IS NULL OR btrim(lower(p_confirmation_phrase)) IS DISTINCT FROM btrim(lower(v_name)) THEN
    RAISE EXCEPTION 'confirmation phrase does not match signer name' USING ERRCODE = 'SB009';
  END IF;
  IF p_signing_token IS NULL THEN
    RAISE EXCEPTION 'fresh password token required' USING ERRCODE = 'SB002';
  END IF;
  v_grant := internal.consume_signature_grant(p_signing_token, 'sign-part', w, a, session_id, NULL, v_digest);
  IF v_grant.part_id IS DISTINCT FROM p_part_id OR v_grant.signature_meaning IS DISTINCT FROM p_meaning THEN
    RAISE EXCEPTION 'password token does not match this signature' USING ERRCODE = 'SB002';
  END IF;
  v_method := CASE WHEN current_setting('sheetbase.signature_auth_method', true) = 'demo'
                    AND session_id LIKE 'dev-auth-free-session%' THEN 'demo' ELSE 'password' END;
  INSERT INTO api.experiment_part_signoffs
    (workspace_id, record_id, part_id, part_number, part_title, meaning, countersigns_id,
     snapshot, snapshot_digest, signer_user_id, signer_name, signer_session_id, auth_method, confirmation_phrase)
  VALUES (w, v_part.record_id, p_part_id, (v_snapshot->'part'->>'number')::integer, v_part.title, p_meaning,
          v_signed.id, v_snapshot, v_digest, a, v_name, session_id, v_method, p_confirmation_phrase)
  RETURNING * INTO v_row;

  IF p_meaning = 'signed' THEN
    UPDATE api.experiment_parts
       SET signed_off_at = v_row.signed_at, signed_off_by_user_id = a, signoff_id = v_row.id,
           updated_by_user_id = a
     WHERE id = p_part_id RETURNING * INTO v_part;
    UPDATE api.experiment_part_requests SET fulfilled_at = now()
     WHERE part_id = p_part_id AND kind = 'sign' AND fulfilled_at IS NULL;
    PERFORM internal.emit_part_signoff_event(v_part, 'part_signoff', v_row.id, 'signed',
      jsonb_build_object('signoffId', v_row.id, 'signedByUserId', a, 'signerName', v_name,
                         'digest', v_digest, 'authMethod', v_method));
    FOREACH v_witness IN ARRAY coalesce(p_countersign_user_ids, '{}'::text[]) LOOP
      PERFORM internal.request_part_countersign(v_part, v_row, v_witness, p_due_at);
    END LOOP;
    PERFORM internal.refresh_record_parts(v_part.record_id);
  ELSE
    UPDATE api.experiment_part_requests SET fulfilled_at = now()
     WHERE part_id = p_part_id AND kind = 'countersign' AND signoff_id = v_signed.id
       AND requested_user_id = a AND fulfilled_at IS NULL;
    PERFORM internal.emit_part_signoff_event(v_part, 'part_countersign', v_row.id, 'countersigned',
      jsonb_build_object('signoffId', v_row.id, 'countersignsId', v_signed.id, 'signedByUserId', a,
                         'signerName', v_name, 'digest', v_digest, 'authMethod', v_method));
  END IF;
  RETURN jsonb_build_object('signoff_id', v_row.id, 'part_id', p_part_id, 'meaning', p_meaning,
                            'digest', v_digest, 'signed_at', v_row.signed_at, 'auth_method', v_method);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.sign_experiment_part(p_part_id uuid, p_meaning text, p_confirmation_phrase text, p_expected_digest text, p_signing_token text, p_countersign_user_ids text[], p_due_at timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.sign_experiment_part(p_part_id uuid, p_meaning text, p_confirmation_phrase text, p_expected_digest text, p_signing_token text, p_countersign_user_ids text[], p_due_at timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.sign_experiment_part(p_part_id uuid, p_meaning text, p_confirmation_phrase text, p_expected_digest text, p_signing_token text, p_countersign_user_ids text[], p_due_at timestamp with time zone) TO authenticated;
--> statement-breakpoint

-- Ask someone to countersign a signed part: they get a bell notification and
-- the request shows against the part. Not the signer, and someone who can see
-- the experiment.
CREATE FUNCTION internal.request_part_countersign(p_part api.experiment_parts, p_signoff api.experiment_part_signoffs, p_user_id text, p_due_at timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_by text := api.current_user_id();
BEGIN
  IF p_user_id IS NULL OR p_user_id = p_signoff.signer_user_id THEN
    RAISE EXCEPTION 'ask someone other than the signer to countersign' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.workspace_memberships m
                  WHERE m.workspace_id = p_part.workspace_id AND m.user_id = p_user_id AND m.suspended_at IS NULL) THEN
    RAISE EXCEPTION 'that person is not in this workspace' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_record FROM api.records WHERE id = p_part.record_id;
  INSERT INTO api.experiment_part_requests
    (workspace_id, record_id, part_id, kind, signoff_id, requested_user_id, requested_by_user_id, due_at)
  VALUES (p_part.workspace_id, p_part.record_id, p_part.id, 'countersign', p_signoff.id, p_user_id, v_by, p_due_at)
  ON CONFLICT (part_id, kind, requested_user_id) WHERE fulfilled_at IS NULL DO NOTHING;
  IF FOUND AND internal.notification_recipient_enabled(p_user_id, 'part_signoff_request') THEN
    INSERT INTO internal.notifications (workspace_id, user_id, event_type, title, body, record_id, project_id)
    VALUES (p_part.workspace_id, p_user_id, 'part_signoff_request',
            'Countersign Part ' || (SELECT count(*) FROM api.experiment_parts z
                                     WHERE z.record_id = p_part.record_id
                                       AND (z."position", z.id) <= (p_part."position", p_part.id)) || ': ' || p_part.title,
            v_record.identifier || ' ' || v_record.title, p_part.record_id, v_record.project_id);
  END IF;
  PERFORM internal.emit_part_signoff_event(p_part, 'part_signoff_request', gen_random_uuid(), 'countersign_requested',
    jsonb_build_object('requestedUserId', p_user_id, 'requestedByUserId', v_by, 'kind', 'countersign'));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.request_part_countersign(p_part api.experiment_parts, p_signoff api.experiment_part_signoffs, p_user_id text, p_due_at timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.request_part_countersign(p_part api.experiment_parts, p_signoff api.experiment_part_signoffs, p_user_id text, p_due_at timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint

-- Ask a person to sign a part (when it is finished and waiting), or to
-- countersign it (when it is signed). A request only asks: nothing is signed
-- for them.
CREATE FUNCTION api.request_part_signoff(p_part_id uuid, p_user_id text, p_note text DEFAULT NULL, p_due_at timestamp with time zone DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_record api.records;
  v_signoff api.experiment_part_signoffs;
  v_by text := api.current_user_id();
  v_kind text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_request api.experiment_part_requests;
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id AND workspace_id = api.current_workspace_id();
  IF v_part.id IS NULL OR v_by IS NULL OR NOT api.is_workspace_writer(v_part.workspace_id) THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('record', v_part.record_id, 'edit');
  IF NOT v_part.requires_sign_off THEN
    RAISE EXCEPTION 'this part is not set up for sign-off' USING ERRCODE = 'SB152';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'a note can be up to 500 characters' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships m
       WHERE m.workspace_id = v_part.workspace_id AND m.user_id = p_user_id AND m.suspended_at IS NULL) THEN
    RAISE EXCEPTION 'that person is not in this workspace' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_record FROM api.records WHERE id = v_part.record_id;
  IF v_part.signed_off_at IS NULL THEN
    v_kind := 'sign';
    IF v_part.completed_at IS NULL THEN
      RAISE EXCEPTION 'finish the part before asking for a signature' USING ERRCODE = 'SB152';
    END IF;
    IF NOT internal.can_access_object('record', v_part.record_id, 'edit') THEN
      RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
    END IF;
    INSERT INTO api.experiment_part_requests
      (workspace_id, record_id, part_id, kind, requested_user_id, requested_by_user_id, note, due_at)
    VALUES (v_part.workspace_id, v_part.record_id, p_part_id, 'sign', p_user_id, v_by, v_note, p_due_at)
    ON CONFLICT (part_id, kind, requested_user_id) WHERE fulfilled_at IS NULL DO NOTHING
    RETURNING * INTO v_request;
    IF v_request.id IS NOT NULL AND internal.notification_recipient_enabled(p_user_id, 'part_signoff_request') THEN
      INSERT INTO internal.notifications (workspace_id, user_id, event_type, title, body, record_id, project_id)
      VALUES (v_part.workspace_id, p_user_id, 'part_signoff_request',
              'Sign off Part ' || (SELECT count(*) FROM api.experiment_parts z
                                    WHERE z.record_id = v_part.record_id
                                      AND (z."position", z.id) <= (v_part."position", v_part.id)) || ': ' || v_part.title,
              v_record.identifier || ' ' || v_record.title, v_part.record_id, v_record.project_id);
    END IF;
    PERFORM internal.emit_part_signoff_event(v_part, 'part_signoff_request', coalesce(v_request.id, gen_random_uuid()),
      'sign_requested', jsonb_build_object('requestedUserId', p_user_id, 'requestedByUserId', v_by, 'kind', 'sign'));
  ELSE
    v_kind := 'countersign';
    SELECT * INTO v_signoff FROM api.experiment_part_signoffs WHERE id = v_part.signoff_id;
    PERFORM internal.request_part_countersign(v_part, v_signoff, p_user_id, p_due_at);
    SELECT * INTO v_request FROM api.experiment_part_requests
     WHERE part_id = p_part_id AND kind = 'countersign' AND requested_user_id = p_user_id AND fulfilled_at IS NULL;
  END IF;
  RETURN jsonb_build_object('part_id', p_part_id, 'kind', v_kind, 'requested_user_id', p_user_id,
                            'request_id', v_request.id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_part_signoff(p_part_id uuid, p_user_id text, p_note text, p_due_at timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_part_signoff(p_part_id uuid, p_user_id text, p_note text, p_due_at timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_part_signoff(p_part_id uuid, p_user_id text, p_note text, p_due_at timestamp with time zone) TO authenticated;
--> statement-breakpoint

-- Reopen a signed part, with a reason. Only that part: the signature stays on
-- record, the part can be edited and finished again, and it needs signing
-- again before the parts after it can go on.
CREATE FUNCTION api.amend_experiment_part(p_part_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_amendment api.experiment_part_amendments;
  v_signoff uuid;
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id FOR UPDATE;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.part_write_record(v_part.record_id);
  IF v_part.signed_off_at IS NULL THEN
    RAISE EXCEPTION 'this part is not signed' USING ERRCODE = 'SB152';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'say why you are amending this part (3 to 2000 characters)' USING ERRCODE = '22023';
  END IF;
  v_signoff := v_part.signoff_id;
  INSERT INTO api.experiment_part_amendments
    (workspace_id, record_id, part_id, signoff_id, reason, amended_by_user_id)
  VALUES (v_part.workspace_id, v_part.record_id, p_part_id, v_signoff, v_reason, api.current_user_id())
  RETURNING * INTO v_amendment;
  UPDATE api.experiment_parts
     SET signed_off_at = NULL, signed_off_by_user_id = NULL, signoff_id = NULL,
         updated_by_user_id = api.current_user_id()
   WHERE id = p_part_id RETURNING * INTO v_part;
  UPDATE api.experiment_part_requests SET fulfilled_at = now()
   WHERE part_id = p_part_id AND kind = 'countersign' AND fulfilled_at IS NULL;
  PERFORM internal.emit_part_signoff_event(v_part, 'part_amendment', v_amendment.id, 'amended',
    jsonb_build_object('amendmentId', v_amendment.id, 'signoffId', v_signoff, 'reason', v_reason,
                       'amendedByUserId', api.current_user_id()));
  PERFORM internal.refresh_record_parts(v_part.record_id);
  RETURN jsonb_build_object('part_id', p_part_id, 'amendment_id', v_amendment.id, 'signoff_id', v_signoff);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.amend_experiment_part(p_part_id uuid, p_reason text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.amend_experiment_part(p_part_id uuid, p_reason text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.amend_experiment_part(p_part_id uuid, p_reason text) TO authenticated;
--> statement-breakpoint

-- Switch sign-off on or off for the parts of an experiment that are not signed yet.
CREATE FUNCTION api.set_parts_sign_off(p_record_id uuid, p_required boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_changed integer;
BEGIN
  PERFORM internal.part_write_record(p_record_id);
  UPDATE api.experiment_parts
     SET requires_sign_off = coalesce(p_required, true), updated_by_user_id = api.current_user_id()
   WHERE record_id = p_record_id AND signed_off_at IS NULL
     AND requires_sign_off IS DISTINCT FROM coalesce(p_required, true);
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  PERFORM internal.refresh_record_parts(p_record_id);
  RETURN jsonb_build_object('record_id', p_record_id, 'required', coalesce(p_required, true), 'parts_changed', v_changed);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_parts_sign_off(p_record_id uuid, p_required boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_parts_sign_off(p_record_id uuid, p_required boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_parts_sign_off(p_record_id uuid, p_required boolean) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Where each part stands on signatures: whether it needs one, who signed and
-- when, who has been asked to countersign, and whether it was amended.
CREATE FUNCTION api.record_part_signoffs(p_record_id uuid)
  RETURNS TABLE (
    part_id uuid, part_number integer, title text, requires_sign_off boolean,
    work_done boolean, awaiting_sign_off boolean, signed boolean,
    signoff_id uuid, signed_at timestamptz, signed_by_user_id text, signer_name text,
    snapshot_digest text, countersigned_by text[], countersign_requested_from text[],
    sign_requested_from text[], amendment_count integer, last_amended_at timestamptz,
    last_amendment_reason text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH parts AS (
    SELECT p.*, row_number() OVER (ORDER BY p."position", p.id)::integer AS n
      FROM api.experiment_parts p WHERE p.record_id = p_record_id
  )
  SELECT p.id, p.n, p.title, p.requires_sign_off,
         p.completed_at IS NOT NULL,
         (p.requires_sign_off AND p.completed_at IS NOT NULL AND p.signed_off_at IS NULL),
         p.signed_off_at IS NOT NULL,
         p.signoff_id, p.signed_off_at, p.signed_off_by_user_id, s.signer_name, s.snapshot_digest,
         coalesce((SELECT array_agg(c.signer_user_id ORDER BY c.signed_at) FROM api.experiment_part_signoffs c
                    WHERE c.countersigns_id = p.signoff_id), '{}'::text[]),
         coalesce((SELECT array_agg(q.requested_user_id ORDER BY q.created_at) FROM api.experiment_part_requests q
                    WHERE q.part_id = p.id AND q.kind = 'countersign' AND q.fulfilled_at IS NULL), '{}'::text[]),
         coalesce((SELECT array_agg(q.requested_user_id ORDER BY q.created_at) FROM api.experiment_part_requests q
                    WHERE q.part_id = p.id AND q.kind = 'sign' AND q.fulfilled_at IS NULL), '{}'::text[]),
         (SELECT count(*)::integer FROM api.experiment_part_amendments m WHERE m.part_id = p.id),
         (SELECT max(m.amended_at) FROM api.experiment_part_amendments m WHERE m.part_id = p.id),
         (SELECT m.reason FROM api.experiment_part_amendments m WHERE m.part_id = p.id ORDER BY m.amended_at DESC LIMIT 1)
    FROM parts p LEFT JOIN api.experiment_part_signoffs s ON s.id = p.signoff_id
   ORDER BY p.n;
$$;
--> statement-breakpoint
ALTER FUNCTION api.record_part_signoffs(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_part_signoffs(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_part_signoffs(p_record_id uuid) TO authenticated;
--> statement-breakpoint

-- A pipeline can ask someone to sign or countersign a part. The database's
-- copy of the action catalogue (checked when a pipeline is saved) gains the action.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"request_part_signoff","rpc":"request_part_signoff","label":"Ask someone to sign off a part","description":"Ask a person to sign a finished part of an experiment, or to countersign a signed one. They are notified. Nothing is signed for them.","arguments":[{"name":"p_part_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_note","type":"text","required":false,"nullable":true}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
