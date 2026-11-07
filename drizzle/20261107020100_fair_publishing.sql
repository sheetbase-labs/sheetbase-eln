-- FAIR data: ontology terms on fields and vocabulary terms, and publishing to a
-- DOI-minting repository.
--
-- Ontology terms (OBI, ChEBI, CL, UBERON, NCBITaxon, UO ...) are kept beside the
-- thing they describe in api.ontology_annotations, so the model, schema and
-- vocabulary tables stay as they are and any of them can carry terms. Looking a
-- term up asks the EBI Ontology Lookup Service, which an admin turns on first.
--
-- A repository (Zenodo, InvenioRDM, Figshare, Dataverse) is a publication
-- target with a token the server seals. Publishing is two steps because a DOI
-- is for good: the server sends a draft with the RO-Crate package and reserves
-- the DOI, then a person presses Publish.

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
  IF position('''publication''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''publication''::text, ''publication_target''::text, ''ontology_annotation''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('publication.created'), ('publication.drafted'), ('publication.published'), ('publication.failed'),
  ('publication_target.updated'), ('ontology.term.linked'), ('ontology.term.unlinked'),
  ('ontology.settings.updated')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Ontology terms
-- ---------------------------------------------------------------------------

CREATE TABLE api.ontology_annotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    ontology text NOT NULL,
    iri text NOT NULL,
    short_form text,
    label text NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ontology_annotations_pkey PRIMARY KEY (id),
    CONSTRAINT ontology_annotations_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT ontology_annotations_unique UNIQUE (workspace_id, target_kind, target_id, iri),
    CONSTRAINT chk_ontology_annotations_kind CHECK (target_kind IN ('model_field', 'schema_field', 'definition_field', 'vocabulary_term')),
    CONSTRAINT chk_ontology_annotations_iri CHECK (iri ~ '^https?://[^\s]+$' AND length(iri) <= 500),
    CONSTRAINT chk_ontology_annotations_label CHECK (length(btrim(label)) BETWEEN 1 AND 300),
    CONSTRAINT chk_ontology_annotations_ontology CHECK (ontology ~ '^[a-z][a-z0-9_-]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE api.ontology_annotations OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_ontology_annotations_target ON api.ontology_annotations (workspace_id, target_kind, target_id);
--> statement-breakpoint
ALTER TABLE api.ontology_annotations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ontology_annotations_select ON api.ontology_annotations FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY ontology_annotations_client_select ON api.ontology_annotations FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.ontology_annotations TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.ontology_settings(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT coalesce(integration_settings->'ontology', '{}'::jsonb) INTO v
    FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  v := coalesce(v, '{}'::jsonb);
  RETURN jsonb_build_object(
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'ontologies', coalesce(v->'ontologies', '["obi","chebi","cl","uberon","ncbitaxon","uo"]'::jsonb));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.ontology_settings(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.ontology_settings(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.ontology_settings(uuid) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.set_ontology_settings(p_workspace_id uuid, p_enabled boolean, p_ontologies text[] DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_settings jsonb;
  v_list jsonb;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integrations access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_ontologies IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(p_ontologies) o WHERE o !~ '^[a-z][a-z0-9_-]{0,39}$') OR cardinality(p_ontologies) > 40 THEN
      RAISE EXCEPTION 'ontology names are short lowercase ids such as obi or chebi' USING ERRCODE = '22023';
    END IF;
    v_list := to_jsonb(p_ontologies);
  END IF;
  v_settings := jsonb_build_object('enabled', p_enabled)
                || CASE WHEN v_list IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('ontologies', v_list) END;
  UPDATE api.workspace_settings
     SET integration_settings = jsonb_set(coalesce(integration_settings, '{}'::jsonb), '{ontology}',
           coalesce(integration_settings->'ontology', '{}'::jsonb) || v_settings),
         updated_at = now()
   WHERE workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    INSERT INTO api.workspace_settings (workspace_id, created_by_user_id, integration_settings)
    VALUES (p_workspace_id, api.current_user_id(), jsonb_build_object('ontology', v_settings));
  END IF;
  PERFORM internal.emit_change_event(p_workspace_id, 'ontology_annotation', p_workspace_id, 'update', NULL, NULL,
    jsonb_build_object('action', 'ontology-settings', 'enabled', p_enabled));
  RETURN api.ontology_settings(p_workspace_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_ontology_settings(uuid, boolean, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_ontology_settings(uuid, boolean, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_ontology_settings(uuid, boolean, text[]) TO authenticated;
--> statement-breakpoint

-- Link a term to a field or vocabulary term. The person needs to be able to
-- edit data models: data access, or general settings.
CREATE FUNCTION api.link_ontology_term(
    p_workspace_id uuid, p_target_kind text, p_target_id uuid, p_ontology text,
    p_iri text, p_label text, p_short_form text DEFAULT NULL)
    RETURNS api.ontology_annotations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.ontology_annotations;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT (api.has_data_access(p_workspace_id) OR api.has_settings_access(p_workspace_id, 'general', 'manage')) THEN
    RAISE EXCEPTION 'data access required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.ontology_annotations (workspace_id, target_kind, target_id, ontology, iri, short_form, label, created_by_user_id)
  VALUES (p_workspace_id, p_target_kind, p_target_id, lower(p_ontology), btrim(p_iri), p_short_form, btrim(p_label), api.current_user_id())
  ON CONFLICT (workspace_id, target_kind, target_id, iri) DO UPDATE
    SET label = EXCLUDED.label, short_form = EXCLUDED.short_form, ontology = EXCLUDED.ontology
  RETURNING * INTO r;
  PERFORM internal.emit_change_event(p_workspace_id, 'ontology_annotation', r.id, 'create', NULL, NULL,
    jsonb_build_object('action', 'term-linked', 'targetKind', p_target_kind, 'targetId', p_target_id,
                       'iri', r.iri, 'label', r.label, 'ontology', r.ontology));
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.link_ontology_term(uuid, text, uuid, text, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.link_ontology_term(uuid, text, uuid, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.link_ontology_term(uuid, text, uuid, text, text, text, text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.unlink_ontology_term(p_annotation_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.ontology_annotations;
BEGIN
  SELECT * INTO r FROM api.ontology_annotations WHERE id = p_annotation_id;
  IF r.id IS NULL OR api.current_user_id() IS NULL OR r.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT (api.has_data_access(r.workspace_id) OR api.has_settings_access(r.workspace_id, 'general', 'manage')) THEN
    RAISE EXCEPTION 'data access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.ontology_annotations WHERE id = r.id;
  PERFORM internal.emit_change_event(r.workspace_id, 'ontology_annotation', r.id, 'delete', NULL, NULL,
    jsonb_build_object('action', 'term-unlinked', 'targetKind', r.target_kind, 'targetId', r.target_id,
                       'iri', r.iri, 'label', r.label));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.unlink_ontology_term(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.unlink_ontology_term(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.unlink_ontology_term(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Publishing
-- ---------------------------------------------------------------------------

CREATE TABLE api.publication_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    base_url text NOT NULL,
    collection text,
    license text DEFAULT 'cc-by-4.0' NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    token_set boolean DEFAULT false NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT publication_targets_pkey PRIMARY KEY (id),
    CONSTRAINT publication_targets_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT publication_targets_name_key UNIQUE (workspace_id, name),
    CONSTRAINT chk_publication_targets_kind CHECK (kind IN ('zenodo', 'invenio', 'figshare', 'dataverse')),
    CONSTRAINT chk_publication_targets_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT chk_publication_targets_url CHECK (base_url ~ '^https?://[^\s]+$' AND length(base_url) <= 300),
    CONSTRAINT chk_publication_targets_license CHECK (license ~ '^[a-z0-9][a-z0-9.+-]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE api.publication_targets OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.publication_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY publication_targets_select ON api.publication_targets FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY publication_targets_client_select ON api.publication_targets FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.publication_targets TO authenticated, api_client;
--> statement-breakpoint

CREATE TABLE internal.publication_target_secrets (
    target_id uuid NOT NULL,
    ciphertext text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT publication_target_secrets_pkey PRIMARY KEY (target_id),
    CONSTRAINT publication_target_secrets_target_fkey FOREIGN KEY (target_id) REFERENCES api.publication_targets(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.publication_target_secrets OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON TABLE internal.publication_target_secrets FROM PUBLIC;
--> statement-breakpoint

CREATE TABLE api.publications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_id uuid NOT NULL,
    object_kind text NOT NULL,
    object_id uuid NOT NULL,
    title text NOT NULL,
    license text NOT NULL,
    status text DEFAULT 'queued' NOT NULL,
    stage text DEFAULT 'send' NOT NULL,
    doi text,
    record_url text,
    draft_url text,
    remote_id text,
    package_name text,
    package_bytes bigint,
    package_sha256 text,
    includes_run_crate boolean DEFAULT false NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_by_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT publications_pkey PRIMARY KEY (id),
    CONSTRAINT publications_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT publications_target_fkey FOREIGN KEY (target_id) REFERENCES api.publication_targets(id) ON DELETE RESTRICT,
    CONSTRAINT chk_publications_kind CHECK (object_kind IN ('experiment', 'dataset_version')),
    CONSTRAINT chk_publications_status CHECK (status IN ('queued', 'sending', 'draft', 'publishing', 'published', 'failed', 'discarded')),
    CONSTRAINT chk_publications_stage CHECK (stage IN ('send', 'publish')),
    CONSTRAINT chk_publications_published CHECK (status <> 'published' OR (doi IS NOT NULL AND published_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE api.publications OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_publications_due ON api.publications (next_attempt_at) WHERE status IN ('queued', 'publishing');
--> statement-breakpoint
CREATE INDEX idx_publications_object ON api.publications (workspace_id, object_kind, object_id);
--> statement-breakpoint
ALTER TABLE api.publications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY publications_select ON api.publications FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id)
           AND internal.can_access_object(CASE object_kind WHEN 'experiment' THEN 'record' ELSE 'dataset_version' END, object_id, 'view'));
--> statement-breakpoint
CREATE POLICY publications_client_select ON api.publications FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.publications TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.save_publication_target(
    p_workspace_id uuid, p_id uuid, p_kind text, p_name text, p_base_url text,
    p_collection text DEFAULT NULL, p_license text DEFAULT 'cc-by-4.0', p_enabled boolean DEFAULT true)
    RETURNS api.publication_targets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.publication_targets;
  v_url text := regexp_replace(btrim(coalesce(p_base_url, '')), '/+$', '');
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integrations access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO api.publication_targets (workspace_id, kind, name, base_url, collection, license, enabled, created_by_user_id)
    VALUES (p_workspace_id, p_kind, btrim(p_name), v_url, nullif(btrim(coalesce(p_collection, '')), ''),
            lower(coalesce(p_license, 'cc-by-4.0')), coalesce(p_enabled, true), api.current_user_id())
    RETURNING * INTO r;
  ELSE
    UPDATE api.publication_targets
       SET kind = p_kind, name = btrim(p_name), base_url = v_url,
           collection = nullif(btrim(coalesce(p_collection, '')), ''),
           license = lower(coalesce(p_license, 'cc-by-4.0')), enabled = coalesce(p_enabled, true),
           updated_at = now()
     WHERE id = p_id AND workspace_id = p_workspace_id
     RETURNING * INTO r;
    IF r.id IS NULL THEN
      RAISE EXCEPTION 'repository not found' USING ERRCODE = 'SB127';
    END IF;
  END IF;
  PERFORM internal.emit_change_event(p_workspace_id, 'publication_target', r.id, 'update', NULL, NULL,
    jsonb_build_object('action', 'target-saved', 'kind', r.kind, 'name', r.name, 'enabled', r.enabled));
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_publication_target(uuid, uuid, text, text, text, text, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_publication_target(uuid, uuid, text, text, text, text, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_publication_target(uuid, uuid, text, text, text, text, text, boolean) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.delete_publication_target(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.publication_targets;
BEGIN
  SELECT * INTO r FROM api.publication_targets WHERE id = p_id;
  IF r.id IS NULL OR api.current_user_id() IS NULL OR r.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(r.workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integrations access required' USING ERRCODE = 'SB060';
  END IF;
  IF EXISTS (SELECT 1 FROM api.publications p WHERE p.target_id = r.id) THEN
    RAISE EXCEPTION 'this repository has publications; turn it off instead' USING ERRCODE = '22023';
  END IF;
  DELETE FROM api.publication_targets WHERE id = r.id;
  PERFORM internal.emit_change_event(r.workspace_id, 'publication_target', r.id, 'delete', NULL, NULL,
    jsonb_build_object('action', 'target-deleted', 'name', r.name));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_publication_target(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_publication_target(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_publication_target(uuid) TO authenticated;
--> statement-breakpoint

-- Server side: store a sealed token.
CREATE FUNCTION internal.set_publication_target_secret(p_target_id uuid, p_ciphertext text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH s AS (
    INSERT INTO internal.publication_target_secrets (target_id, ciphertext) VALUES (p_target_id, p_ciphertext)
    ON CONFLICT (target_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now()
    RETURNING target_id)
  UPDATE api.publication_targets t SET token_set = true, updated_at = now() FROM s WHERE t.id = s.target_id
$$;
--> statement-breakpoint
ALTER FUNCTION internal.set_publication_target_secret(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.set_publication_target_secret(uuid, text) FROM PUBLIC;
--> statement-breakpoint

-- Ask for an experiment or a dataset version to be sent to a repository as a
-- draft. Nothing is public until publish_publication.
CREATE FUNCTION api.request_publication(
    p_target_id uuid, p_object_kind text, p_object_id uuid,
    p_title text DEFAULT NULL, p_license text DEFAULT NULL)
    RETURNS api.publications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  t api.publication_targets;
  r api.publications;
  v_title text;
  v_ws uuid;
BEGIN
  SELECT * INTO t FROM api.publication_targets WHERE id = p_target_id;
  IF t.id IS NULL OR api.current_user_id() IS NULL OR t.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(t.workspace_id) THEN
    RAISE EXCEPTION 'repository not found' USING ERRCODE = 'SB127';
  END IF;
  IF NOT t.enabled OR NOT t.token_set THEN
    RAISE EXCEPTION 'this repository is off or has no token yet (Settings > Open data)' USING ERRCODE = '22023';
  END IF;
  IF p_object_kind = 'experiment' THEN
    IF NOT internal.can_access_object('record', p_object_id, 'edit') THEN
      RAISE EXCEPTION 'you need edit access to publish this experiment' USING ERRCODE = '42501';
    END IF;
    SELECT x.title, x.workspace_id INTO v_title, v_ws FROM api.records x WHERE x.id = p_object_id AND x.kind = 'experiment';
  ELSIF p_object_kind = 'dataset_version' THEN
    IF NOT internal.can_access_object('dataset_version', p_object_id, 'edit') THEN
      RAISE EXCEPTION 'you need edit access to publish this dataset version' USING ERRCODE = '42501';
    END IF;
    SELECT d.name || ' · ' || v.label, v.workspace_id INTO v_title, v_ws
      FROM api.dataset_versions v JOIN api.datasets d ON d.id = v.dataset_id WHERE v.id = p_object_id;
  ELSE
    RAISE EXCEPTION 'only experiments and dataset versions can be published' USING ERRCODE = '22023';
  END IF;
  IF v_ws IS DISTINCT FROM t.workspace_id THEN
    RAISE EXCEPTION 'nothing to publish there' USING ERRCODE = 'SB127';
  END IF;
  IF EXISTS (SELECT 1 FROM api.publications p
              WHERE p.target_id = t.id AND p.object_kind = p_object_kind AND p.object_id = p_object_id
                AND p.status IN ('queued', 'sending', 'draft', 'publishing')) THEN
    RAISE EXCEPTION 'this is already on its way to that repository' USING ERRCODE = '23505';
  END IF;
  INSERT INTO api.publications (workspace_id, target_id, object_kind, object_id, title, license, requested_by_user_id)
  VALUES (t.workspace_id, t.id, p_object_kind, p_object_id,
          left(coalesce(nullif(btrim(p_title), ''), v_title), 300),
          lower(coalesce(nullif(btrim(p_license), ''), t.license)), api.current_user_id())
  RETURNING * INTO r;
  PERFORM internal.emit_change_event(t.workspace_id, 'publication', r.id, 'create',
    CASE WHEN p_object_kind = 'experiment' THEN p_object_id END, NULL,
    jsonb_build_object('action', 'publication-created', 'objectKind', p_object_kind, 'objectId', p_object_id,
                       'repository', t.name, 'title', r.title));
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_publication(uuid, text, uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_publication(uuid, text, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_publication(uuid, text, uuid, text, text) TO authenticated;
--> statement-breakpoint

-- The step that cannot be undone: a draft becomes public and its DOI is
-- registered. Only a person asks for it, never an unattended credential.
CREATE FUNCTION api.publish_publication(p_id uuid) RETURNS api.publications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.publications;
BEGIN
  SELECT * INTO r FROM api.publications WHERE id = p_id;
  IF r.id IS NULL OR api.current_user_id() IS NULL OR r.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT internal.can_access_object(CASE r.object_kind WHEN 'experiment' THEN 'record' ELSE 'dataset_version' END, r.object_id, 'edit') THEN
    RAISE EXCEPTION 'publication not found' USING ERRCODE = 'SB127';
  END IF;
  IF r.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be published' USING ERRCODE = '22023';
  END IF;
  UPDATE api.publications SET status = 'publishing', stage = 'publish', attempts = 0, last_error = NULL,
         next_attempt_at = now(), updated_at = now()
   WHERE id = r.id RETURNING * INTO r;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.publish_publication(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.publish_publication(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.publish_publication(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.discard_publication(p_id uuid) RETURNS api.publications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.publications;
BEGIN
  SELECT * INTO r FROM api.publications WHERE id = p_id;
  IF r.id IS NULL OR api.current_user_id() IS NULL OR r.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT internal.can_access_object(CASE r.object_kind WHEN 'experiment' THEN 'record' ELSE 'dataset_version' END, r.object_id, 'edit') THEN
    RAISE EXCEPTION 'publication not found' USING ERRCODE = 'SB127';
  END IF;
  IF r.status NOT IN ('queued', 'draft', 'failed') THEN
    RAISE EXCEPTION 'only a draft that has not been published can be dropped' USING ERRCODE = '22023';
  END IF;
  UPDATE api.publications SET status = 'discarded', updated_at = now() WHERE id = r.id RETURNING * INTO r;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.discard_publication(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.discard_publication(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.discard_publication(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.retry_publication(p_id uuid) RETURNS api.publications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.publications;
BEGIN
  SELECT * INTO r FROM api.publications WHERE id = p_id;
  IF r.id IS NULL OR api.current_user_id() IS NULL OR r.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT internal.can_access_object(CASE r.object_kind WHEN 'experiment' THEN 'record' ELSE 'dataset_version' END, r.object_id, 'edit') THEN
    RAISE EXCEPTION 'publication not found' USING ERRCODE = 'SB127';
  END IF;
  IF r.status <> 'failed' THEN
    RAISE EXCEPTION 'only a failed publication can be tried again' USING ERRCODE = '22023';
  END IF;
  UPDATE api.publications
     SET status = CASE WHEN stage = 'publish' THEN 'publishing' ELSE 'queued' END,
         attempts = 0, next_attempt_at = now(), updated_at = now()
   WHERE id = r.id RETURNING * INTO r;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.retry_publication(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.retry_publication(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.retry_publication(uuid) TO authenticated;
--> statement-breakpoint

-- Server side ------------------------------------------------------------

-- Work for the publisher: queued sends and confirmed publishes, with the
-- target's address and sealed token.
CREATE FUNCTION internal.publications_due(p_limit integer)
    RETURNS TABLE(id uuid, workspace_id uuid, object_kind text, object_id uuid, title text, license text,
                  status text, remote_id text, requested_by_user_id text, kind text, base_url text,
                  collection text, ciphertext text, target_name text, package_name text, doi text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.id, p.workspace_id, p.object_kind, p.object_id, p.title, p.license, p.status, p.remote_id,
         p.requested_by_user_id, t.kind, t.base_url, t.collection, s.ciphertext, t.name, p.package_name, p.doi
    FROM api.publications p
    JOIN api.publication_targets t ON t.id = p.target_id
    LEFT JOIN internal.publication_target_secrets s ON s.target_id = t.id
   WHERE p.status IN ('queued', 'publishing') AND p.next_attempt_at <= now()
   ORDER BY p.next_attempt_at
   LIMIT greatest(p_limit, 1)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.publications_due(integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.publications_due(integer) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.mark_publication_sending(p_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH u AS (
    UPDATE api.publications SET status = 'sending', updated_at = now()
     WHERE id = p_id AND status = 'queued' RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.mark_publication_sending(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.mark_publication_sending(uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.record_publication_draft(
    p_id uuid, p_remote_id text, p_draft_url text, p_doi text, p_package_name text,
    p_package_bytes bigint, p_package_sha256 text, p_includes_run_crate boolean)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.publications;
BEGIN
  UPDATE api.publications
     SET status = 'draft', stage = 'send', remote_id = p_remote_id, draft_url = p_draft_url, doi = p_doi,
         package_name = p_package_name, package_bytes = p_package_bytes, package_sha256 = p_package_sha256,
         includes_run_crate = p_includes_run_crate, last_error = NULL, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  IF r.id IS NOT NULL THEN
    PERFORM internal.emit_change_event_as_actor(r.requested_by_user_id, r.workspace_id, 'publication', r.id, 'update',
      CASE WHEN r.object_kind = 'experiment' THEN r.object_id END, NULL,
      jsonb_build_object('action', 'publication-drafted', 'objectKind', r.object_kind, 'objectId', r.object_id,
                         'doi', r.doi, 'draftUrl', r.draft_url));
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_publication_draft(uuid, text, text, text, text, bigint, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_publication_draft(uuid, text, text, text, text, bigint, text, boolean) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.record_publication_published(p_id uuid, p_doi text, p_record_url text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.publications;
BEGIN
  UPDATE api.publications
     SET status = 'published', doi = p_doi, record_url = p_record_url, published_at = now(),
         last_error = NULL, updated_at = now()
   WHERE id = p_id AND status = 'publishing' RETURNING * INTO r;
  IF r.id IS NOT NULL THEN
    PERFORM internal.emit_change_event_as_actor(r.requested_by_user_id, r.workspace_id, 'publication', r.id, 'update',
      CASE WHEN r.object_kind = 'experiment' THEN r.object_id END, NULL,
      jsonb_build_object('action', 'publication-published', 'objectKind', r.object_kind, 'objectId', r.object_id,
                         'doi', r.doi, 'recordUrl', r.record_url));
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_publication_published(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_publication_published(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint

-- A failed attempt: wait longer each time, and give up after five.
CREATE FUNCTION internal.record_publication_failure(p_id uuid, p_stage text, p_error text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.publications;
BEGIN
  UPDATE api.publications
     SET attempts = attempts + 1, last_error = left(p_error, 500), stage = p_stage,
         status = CASE WHEN attempts + 1 >= 5 THEN 'failed'
                       WHEN p_stage = 'publish' THEN 'publishing' ELSE 'queued' END,
         next_attempt_at = now() + (interval '2 minutes' * power(3, least(attempts, 3))),
         updated_at = now()
   WHERE id = p_id AND status IN ('queued', 'sending', 'publishing') RETURNING * INTO r;
  IF r.id IS NOT NULL AND r.status = 'failed' THEN
    PERFORM internal.emit_change_event_as_actor(r.requested_by_user_id, r.workspace_id, 'publication', r.id, 'update',
      CASE WHEN r.object_kind = 'experiment' THEN r.object_id END, NULL,
      jsonb_build_object('action', 'publication-failed', 'objectKind', r.object_kind, 'objectId', r.object_id,
                         'error', left(p_error, 200)));
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_publication_failure(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_publication_failure(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint

-- A pipeline can prepare a repository draft for a dataset version or an
-- experiment. Making the draft public stays a person's second step in the app,
-- so there is no pipeline action for it.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"request_publication","rpc":"request_publication","label":"Prepare a repository draft","description":"Package an experiment or dataset version as an RO-Crate and send a draft to a publishing repository. A person publishes it from the app.","arguments":[{"name":"p_target_id","type":"uuid","required":true,"nullable":false},{"name":"p_object_kind","type":"text","required":true,"nullable":false},{"name":"p_object_id","type":"uuid","required":true,"nullable":false},{"name":"p_title","type":"text","required":false,"nullable":true},{"name":"p_license","type":"text","required":false,"nullable":true}]}$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || ']$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
