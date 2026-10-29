-- A new lab can start on day one.
--
--   * An admin lists the lab's email domains. Anyone who signs in with a
--     verified address on one joins that workspace instead of getting a
--     personal one, and someone who already has a personal workspace is offered
--     the lab. A domain can only be added by a person whose own address uses it,
--     public mail domains are refused, and one domain belongs to one workspace.
--   * The first admin of a workspace runs one short setup: the lab's name, its
--     time zone and which starter tables to keep.
--   * A workspace starts with real, editable starter tables, so the first
--     import has somewhere to go, and anyone who can work with datasets can
--     make a table from the columns of the file they are importing.
--   * Member and Scientist were the same role. Members become scientists.

-- ---------------------------------------------------------------------------
-- Join by email domain
-- ---------------------------------------------------------------------------

CREATE TABLE api.workspace_join_domains (
    domain text NOT NULL,
    workspace_id uuid NOT NULL,
    role text DEFAULT 'scientist'::text NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_join_domains_pkey PRIMARY KEY (domain),
    CONSTRAINT chk_workspace_join_domains_domain CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
    CONSTRAINT chk_workspace_join_domains_role CHECK (role IN ('scientist', 'analyst', 'reviewer', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE api.workspace_join_domains OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.workspace_join_domains
    ADD CONSTRAINT workspace_join_domains_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.workspace_join_domains
    ADD CONSTRAINT workspace_join_domains_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX idx_workspace_join_domains_workspace ON api.workspace_join_domains (workspace_id);
--> statement-breakpoint
ALTER TABLE api.workspace_join_domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_join_domains_select ON api.workspace_join_domains FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.workspace_join_domains TO authenticated;
--> statement-breakpoint
CREATE FUNCTION internal.public_email_domain(p_domain text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT lower(p_domain) = ANY (ARRAY[
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
    'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
    'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
    'mail.com', 'zoho.com', 'yandex.com', 'qq.com', '163.com', 'fastmail.com',
    'hey.com', 'tutanota.com', 'users.noreply.github.com'
  ])
$$;
--> statement-breakpoint
ALTER FUNCTION internal.public_email_domain(p_domain text) OWNER TO migrator;
--> statement-breakpoint
-- Adds the person to the workspace that claims their email domain. Quiet when
-- there is nothing to join, the address is not verified, or they already have
-- a membership there (a suspended one stays suspended).
CREATE FUNCTION internal.join_workspace_by_email_domain(p_user_id text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_email text;
  v_verified boolean;
  v_join api.workspace_join_domains;
BEGIN
  SELECT u.email, u."emailVerified" INTO v_email, v_verified
    FROM internal."user" u WHERE u.id = p_user_id;
  IF v_email IS NULL OR v_verified IS NOT TRUE THEN RETURN NULL; END IF;
  SELECT * INTO v_join FROM api.workspace_join_domains
   WHERE domain = lower(split_part(v_email, '@', 2));
  IF v_join.domain IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM api.workspaces w WHERE w.id = v_join.workspace_id AND w.status = 'active') THEN
    RETURN NULL;
  END IF;
  INSERT INTO api.workspace_memberships (workspace_id, user_id, role)
  VALUES (v_join.workspace_id, p_user_id, v_join.role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN v_join.workspace_id;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.join_workspace_by_email_domain(p_user_id text) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION api.set_join_domains(p_workspace_id uuid, p_domains text[], p_role text DEFAULT 'scientist') RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_actor_domain text;
  v_actor_verified boolean;
  v_domains text[];
  v_domain text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.has_settings_access(p_workspace_id, 'members', 'manage') THEN
    RAISE EXCEPTION 'managing members needs access to Members and roles' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('scientist', 'analyst', 'reviewer', 'viewer') THEN
    RAISE EXCEPTION 'choose a role people can join as' USING ERRCODE = '22023';
  END IF;
  SELECT lower(split_part(u.email, '@', 2)), u."emailVerified" INTO v_actor_domain, v_actor_verified
    FROM internal."user" u WHERE u.id = v_actor;
  SELECT coalesce(array_agg(DISTINCT lower(btrim(d))), ARRAY[]::text[]) INTO v_domains
    FROM unnest(coalesce(p_domains, ARRAY[]::text[])) AS d WHERE btrim(d) <> '';
  FOREACH v_domain IN ARRAY v_domains LOOP
    IF v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
      RAISE EXCEPTION '% isn''t a valid email domain', v_domain USING ERRCODE = '22023';
    END IF;
    IF internal.public_email_domain(v_domain) THEN
      RAISE EXCEPTION '% is a public email domain and can''t be added', v_domain USING ERRCODE = 'SB210';
    END IF;
    IF EXISTS (SELECT 1 FROM api.workspace_join_domains j
                WHERE j.domain = v_domain AND j.workspace_id <> p_workspace_id) THEN
      RAISE EXCEPTION '% already belongs to another workspace', v_domain USING ERRCODE = 'SB211';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM api.workspace_join_domains j
                    WHERE j.domain = v_domain AND j.workspace_id = p_workspace_id)
       AND (v_actor_domain IS DISTINCT FROM v_domain OR v_actor_verified IS NOT TRUE) THEN
      RAISE EXCEPTION 'You can only add a domain your own verified email address uses' USING ERRCODE = 'SB212';
    END IF;
  END LOOP;
  DELETE FROM api.workspace_join_domains
   WHERE workspace_id = p_workspace_id AND NOT (domain = ANY (v_domains));
  INSERT INTO api.workspace_join_domains (domain, workspace_id, role, created_by_user_id)
  SELECT d, p_workspace_id, p_role, v_actor FROM unnest(v_domains) AS d
  ON CONFLICT (domain) DO UPDATE SET role = excluded.role;
  PERFORM internal.emit_change_event(p_workspace_id, 'workspace_settings', p_workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'join_domains', 'domains', to_jsonb(v_domains), 'role', p_role));
  RETURN jsonb_build_object('domains', to_jsonb(v_domains), 'role', p_role);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.set_join_domains(p_workspace_id uuid, p_domains text[], p_role text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_join_domains(p_workspace_id uuid, p_domains text[], p_role text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_join_domains(p_workspace_id uuid, p_domains text[], p_role text) TO authenticated;
--> statement-breakpoint
-- The lab the signed-in person could join through their email domain and has
-- not joined yet.
CREATE FUNCTION api.my_join_offer() RETURNS TABLE(workspace_id uuid, workspace_name text, domain text, role text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT w.id, w.name, j.domain, j.role
    FROM internal."user" u
    JOIN api.workspace_join_domains j ON j.domain = lower(split_part(u.email, '@', 2))
    JOIN api.workspaces w ON w.id = j.workspace_id AND w.status = 'active'
   WHERE u.id = api.current_user_id()
     AND u."emailVerified" IS TRUE
     AND NOT EXISTS (
       SELECT 1 FROM api.workspace_memberships m
        WHERE m.workspace_id = w.id AND m.user_id = u.id)
$$;
--> statement-breakpoint
ALTER FUNCTION api.my_join_offer() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.my_join_offer() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.my_join_offer() TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.join_my_domain_workspace() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_workspace uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501';
  END IF;
  v_workspace := internal.join_workspace_by_email_domain(v_actor);
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'No workspace is open to your email address' USING ERRCODE = 'SB213';
  END IF;
  RETURN v_workspace;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.join_my_domain_workspace() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.join_my_domain_workspace() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.join_my_domain_workspace() TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tables a workspace can start from
-- ---------------------------------------------------------------------------

ALTER TABLE api.dataset_schema_definitions
  ADD COLUMN origin text DEFAULT 'designed'::text NOT NULL,
  ADD CONSTRAINT chk_dataset_schema_definitions_origin CHECK (origin IN ('designed', 'starter', 'import'));
--> statement-breakpoint
ALTER TABLE api.workspace_settings ADD COLUMN setup_completed_at timestamp with time zone;
--> statement-breakpoint
CREATE FUNCTION internal.starter_structures() RETURNS TABLE(key text, name text, description text, fields jsonb)
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT * FROM (VALUES
    ('plate_reader', 'Plate reader readout', 'One row per well from a plate reader export.',
     '[{"key":"well","label":"Well","logical_type":"text"},
       {"key":"sample","label":"Sample","logical_type":"text"},
       {"key":"replicate","label":"Replicate","logical_type":"integer"},
       {"key":"signal","label":"Signal","logical_type":"decimal","quantity":{"kind":"quantity","symbol":"AU","dimension":"AU","storageUnit":"AU"}},
       {"key":"read_time","label":"Read time","logical_type":"timestamp"},
       {"key":"notes","label":"Notes","logical_type":"text"}]'::jsonb),
    ('qpcr', 'qPCR results', 'Cq values per well and target.',
     '[{"key":"well","label":"Well","logical_type":"text"},
       {"key":"sample","label":"Sample","logical_type":"text"},
       {"key":"target","label":"Target","logical_type":"text"},
       {"key":"cq","label":"Cq","logical_type":"decimal","quantity":{"kind":"quantity","symbol":"cycles","dimension":"cycles","storageUnit":"cycles"}},
       {"key":"melt_temperature","label":"Melt temperature","logical_type":"decimal","quantity":{"kind":"quantity","symbol":"°C","dimension":"°C","storageUnit":"°C"}}]'::jsonb),
    ('chromatography', 'Chromatography peaks', 'One row per integrated peak.',
     '[{"key":"sample","label":"Sample","logical_type":"text"},
       {"key":"injection","label":"Injection","logical_type":"integer"},
       {"key":"peak","label":"Peak","logical_type":"text"},
       {"key":"retention_time","label":"Retention time","logical_type":"decimal","quantity":{"kind":"quantity","symbol":"min","dimension":"min","storageUnit":"min"}},
       {"key":"area","label":"Area","logical_type":"decimal","quantity":{"kind":"quantity","symbol":"mAU·min","dimension":"mAU·min","storageUnit":"mAU·min"}},
       {"key":"height","label":"Height","logical_type":"decimal","quantity":{"kind":"quantity","symbol":"mAU","dimension":"mAU","storageUnit":"mAU"}}]'::jsonb),
    ('cell_counts', 'Cell counts', 'Viable cell density and viability per count.',
     '[{"key":"sample","label":"Sample","logical_type":"text"},
       {"key":"counted_at","label":"Counted at","logical_type":"timestamp"},
       {"key":"viable_cell_density","label":"Viable cell density","logical_type":"decimal","quantity":{"kind":"quantity","symbol":"cells/mL","dimension":"cells/mL","storageUnit":"cells/mL"}},
       {"key":"viability","label":"Viability","logical_type":"decimal","quantity":{"kind":"quantity","symbol":"%","dimension":"%","storageUnit":"%"}}]'::jsonb),
    ('general', 'General measurements', 'Any measurement of a sample: a value with its unit.',
     '[{"key":"sample","label":"Sample","logical_type":"text"},
       {"key":"measurement","label":"Measurement","logical_type":"text"},
       {"key":"value","label":"Value","logical_type":"decimal"},
       {"key":"unit","label":"Unit","logical_type":"text"},
       {"key":"measured_at","label":"Measured at","logical_type":"timestamp"}]'::jsonb)
  ) AS s(key, name, description, fields)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.starter_structures() OWNER TO migrator;
--> statement-breakpoint
-- Publishing a table normally needs schema.publish. Starter tables and tables
-- made from an imported file are published by the functions below, which say
-- so for the length of their own transaction step.
DO $$
DECLARE
  d text;
BEGIN
  d := pg_get_functiondef('internal.require_schema_publish_for_lifecycle()'::regprocedure);
  d := replace(
    d,
    E'  IF TG_TABLE_NAME = ''dataset_schema_versions'' THEN',
    E'  IF coalesce(current_setting(''sheetbase.structure_bypass'', true), '''') = ''on'' THEN\n    RETURN NEW;\n  END IF;\n  IF TG_TABLE_NAME = ''dataset_schema_versions'' THEN');
  IF position('structure_bypass' IN d) = 0 THEN
    RAISE EXCEPTION 'could not extend require_schema_publish_for_lifecycle';
  END IF;
  EXECUTE d;
END $$;
--> statement-breakpoint
-- Writes a published table (definition, first version and its fields) in one go.
CREATE FUNCTION internal.create_published_dataset_structure(p_workspace_id uuid, p_user_id text, p_key text, p_name text, p_description text, p_fields jsonb, p_origin text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_definition api.dataset_schema_definitions;
  v_version api.dataset_schema_versions;
BEGIN
  IF p_origin NOT IN ('starter', 'import') THEN
    RAISE EXCEPTION 'only starter and imported tables are published this way' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('sheetbase.structure_bypass', 'on', true);
  INSERT INTO api.dataset_schema_definitions (workspace_id, key, name, description, lifecycle, created_by_user_id, origin)
  VALUES (p_workspace_id, p_key, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), 'active', p_user_id, p_origin)
  RETURNING * INTO v_definition;
  INSERT INTO api.dataset_schema_versions (schema_id, version, lifecycle, created_by_user_id, published_at)
  VALUES (v_definition.id, 1, 'draft', p_user_id, NULL)
  RETURNING * INTO v_version;
  PERFORM internal.replace_dataset_schema_version_fields(v_version.id, p_fields);
  UPDATE api.dataset_schema_versions
     SET lifecycle = 'active', published_at = now(), updated_at = now()
   WHERE id = v_version.id;
  PERFORM set_config('sheetbase.structure_bypass', 'off', true);
  RETURN jsonb_build_object(
    'schema_definition_id', v_definition.id,
    'schema_version_id', v_version.id
  );
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.create_published_dataset_structure(p_workspace_id uuid, p_user_id text, p_key text, p_name text, p_description text, p_fields jsonb, p_origin text) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION internal.install_starter_structures(p_workspace_id uuid, p_user_id text, p_keys text[]) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s record;
  v_installed text[] := ARRAY[]::text[];
BEGIN
  FOR s IN SELECT * FROM internal.starter_structures() st WHERE p_keys IS NULL OR st.key = ANY (p_keys) LOOP
    IF NOT EXISTS (SELECT 1 FROM api.dataset_schema_definitions d
                    WHERE d.workspace_id = p_workspace_id AND d.key = 'starter_' || s.key) THEN
      PERFORM internal.create_published_dataset_structure(
        p_workspace_id, p_user_id, 'starter_' || s.key, s.name, s.description, s.fields, 'starter');
      v_installed := v_installed || s.key;
    END IF;
  END LOOP;
  RETURN v_installed;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.install_starter_structures(p_workspace_id uuid, p_user_id text, p_keys text[]) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION api.install_starter_structures(p_workspace_id uuid, p_keys text[] DEFAULT NULL) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'schema.edit');
  RETURN internal.install_starter_structures(p_workspace_id, api.current_user_id(), p_keys);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.install_starter_structures(p_workspace_id uuid, p_keys text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.install_starter_structures(p_workspace_id uuid, p_keys text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.install_starter_structures(p_workspace_id uuid, p_keys text[]) TO authenticated;
--> statement-breakpoint
-- One short setup for the first admin: the lab's name, its time zone and the
-- starter tables to keep. Finishing it is what marks the workspace set up.
CREATE FUNCTION api.complete_workspace_setup(p_workspace_id uuid, p_name text, p_timezone text, p_starter_keys text[] DEFAULT ARRAY[]::text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_installed text[];
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE = 'SB056';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'the lab name must be 1–120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p_timezone) THEN
    RAISE EXCEPTION 'choose a time zone from the list' USING ERRCODE = '22023';
  END IF;
  UPDATE api.workspaces SET name = btrim(p_name), updated_at = now() WHERE id = p_workspace_id;
  INSERT INTO api.workspace_settings (workspace_id, created_by_user_id)
  VALUES (p_workspace_id, api.current_user_id())
  ON CONFLICT (workspace_id) DO NOTHING;
  UPDATE api.workspace_settings
     SET timezone = p_timezone, setup_completed_at = now(), updated_at = now()
   WHERE workspace_id = p_workspace_id;
  v_installed := internal.install_starter_structures(
    p_workspace_id, api.current_user_id(), coalesce(p_starter_keys, ARRAY[]::text[]));
  PERFORM internal.emit_change_event(p_workspace_id, 'workspace_settings', p_workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'setup_completed', 'starterTables', to_jsonb(v_installed)));
  RETURN jsonb_build_object('installed', to_jsonb(v_installed));
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.complete_workspace_setup(p_workspace_id uuid, p_name text, p_timezone text, p_starter_keys text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.complete_workspace_setup(p_workspace_id uuid, p_name text, p_timezone text, p_starter_keys text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.complete_workspace_setup(p_workspace_id uuid, p_name text, p_timezone text, p_starter_keys text[]) TO authenticated;
--> statement-breakpoint
-- A table made from the columns of the file being imported. Anyone who works
-- with datasets can do it, so a first import never waits for an admin; the
-- table is marked as made from an import so a data steward can tidy it later.
CREATE FUNCTION api.create_dataset_structure_from_file(p_workspace_id uuid, p_name text, p_fields jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_key text;
  v_base text;
  item jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF api.has_capability(p_workspace_id, 'work.datasets') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.datasets' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'name the dataset' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) = 0 THEN
    RAISE EXCEPTION 'keep at least one column' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    IF coalesce(item->>'logical_type', '') NOT IN ('text', 'integer', 'decimal', 'boolean', 'date', 'timestamp') THEN
      RAISE EXCEPTION 'unsupported column type %', item->>'logical_type' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_base := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '_', 'g');
  v_base := btrim(v_base, '_');
  IF v_base !~ '^[a-z]' THEN v_base := 'file_' || v_base; END IF;
  v_base := left(v_base, 46);
  LOOP
    v_key := v_base || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM api.dataset_schema_definitions d
                           WHERE d.workspace_id = p_workspace_id AND d.key = v_key);
  END LOOP;
  RETURN internal.create_published_dataset_structure(
    p_workspace_id, api.current_user_id(), v_key, p_name,
    'Made from an imported file.', p_fields, 'import');
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.create_dataset_structure_from_file(p_workspace_id uuid, p_name text, p_fields jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_dataset_structure_from_file(p_workspace_id uuid, p_name text, p_fields jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_dataset_structure_from_file(p_workspace_id uuid, p_name text, p_fields jsonb) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- One role where there were two
-- ---------------------------------------------------------------------------

UPDATE api.workspace_memberships SET role = 'scientist' WHERE role = 'member';
--> statement-breakpoint
UPDATE api.workspace_invitations SET role = 'scientist' WHERE role = 'member';
--> statement-breakpoint
DELETE FROM api.settings_access m
 WHERE m.role = 'member'
   AND EXISTS (SELECT 1 FROM api.settings_access s
                WHERE s.workspace_id = m.workspace_id AND s.area = m.area AND s.role = 'scientist');
--> statement-breakpoint
UPDATE api.settings_access SET role = 'scientist' WHERE role = 'member';
--> statement-breakpoint
UPDATE api.workspace_settings
   SET data_access_roles = ARRAY(
     SELECT DISTINCT CASE WHEN r = 'member' THEN 'scientist' ELSE r END
       FROM unnest(data_access_roles) AS r)
 WHERE 'member' = ANY (data_access_roles);
--> statement-breakpoint
-- Signing witnesses and study links listed Member but not Scientist; with the
-- roles merged, a scientist is a member-class actor for both.
DO $$
DECLARE
  f text;
  d text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'api.signature_witness_candidates(uuid)',
    'api.link_study_experiment(uuid,uuid,text)',
    'api.request_signature_witness(uuid,text,text,timestamp with time zone)'
  ] LOOP
    d := pg_get_functiondef(f::regprocedure);
    d := replace(d, '''member'',''editor''', '''member'',''scientist'',''analyst'',''editor''');
    EXECUTE d;
  END LOOP;
END $$;
