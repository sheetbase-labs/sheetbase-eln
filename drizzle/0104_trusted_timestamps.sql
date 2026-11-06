-- Trusted timestamps for signed revisions, and a signing key for export bundles.
--
-- A workspace can choose a time-stamping authority (RFC 3161). The server asks
-- it to timestamp every signature as it is made; the authority's answer is kept
-- beside the signature and can be checked by anyone with the authority's
-- certificate, without Sheetbase. Nothing leaves the install until an admin
-- turns this on.
--
-- Each workspace also gets an Ed25519 key that signs the export bundles it
-- downloads, so a bundle can be checked offline. The private half stays in
-- internal.workspace_signing_keys and is only read by the server.

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
  IF position('''signature_timestamp''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''signature_timestamp''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('signature.timestamped'), ('signature.timestamp_failed'),
  ('workspace.timestamping.updated')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE TABLE api.signature_timestamps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    signature_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    signed_data text,
    imprint_sha256 text,
    authority_name text,
    authority_url text,
    response_b64 text,
    gen_time timestamp with time zone,
    serial text,
    signer text,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT signature_timestamps_pkey PRIMARY KEY (id),
    CONSTRAINT signature_timestamps_signature_key UNIQUE (signature_id),
    CONSTRAINT signature_timestamps_signature_fkey FOREIGN KEY (signature_id) REFERENCES api.signatures(id),
    CONSTRAINT signature_timestamps_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_signature_timestamps_status CHECK (status IN ('pending', 'stamped', 'failed')),
    CONSTRAINT chk_signature_timestamps_imprint CHECK (imprint_sha256 IS NULL OR imprint_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_signature_timestamps_stamped CHECK (
      status <> 'stamped'
      OR (signed_data IS NOT NULL AND imprint_sha256 IS NOT NULL
          AND response_b64 IS NOT NULL AND gen_time IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE api.signature_timestamps OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_signature_timestamps_due ON api.signature_timestamps (next_attempt_at) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX idx_signature_timestamps_workspace ON api.signature_timestamps (workspace_id, status);
--> statement-breakpoint
ALTER TABLE api.signature_timestamps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_timestamps_select ON api.signature_timestamps FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY signature_timestamps_client_select ON api.signature_timestamps FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.signature_timestamps TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.signature_timestamps TO api_client;
--> statement-breakpoint

CREATE TABLE internal.workspace_signing_keys (
    workspace_id uuid NOT NULL,
    algorithm text DEFAULT 'ed25519' NOT NULL,
    public_key_pem text NOT NULL,
    private_key_pem text NOT NULL,
    fingerprint text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_signing_keys_pkey PRIMARY KEY (workspace_id),
    CONSTRAINT workspace_signing_keys_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_workspace_signing_keys_algorithm CHECK (algorithm = 'ed25519')
);
--> statement-breakpoint
ALTER TABLE internal.workspace_signing_keys OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON TABLE internal.workspace_signing_keys FROM PUBLIC;
--> statement-breakpoint

-- The authority a workspace stamps with. Stored with the workspace's other
-- integration settings; this is the only reader and writer.
CREATE FUNCTION api.timestamp_settings(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v jsonb;
BEGIN
  IF api.current_user_id() IS NULL AND api.claim_probe() IS NOT NULL
     AND api.claim_probe()->>'credential_id' IS NULL THEN
    RAISE EXCEPTION 'sign-in required' USING ERRCODE = '42501';
  END IF;
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT coalesce(integration_settings->'timestamps', '{}'::jsonb) INTO v
    FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  v := coalesce(v, '{}'::jsonb);
  RETURN jsonb_build_object(
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'authority', v->>'authority',
    'url', v->>'url');
END $$;
--> statement-breakpoint
ALTER FUNCTION api.timestamp_settings(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.timestamp_settings(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.timestamp_settings(uuid) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.set_timestamp_settings(
    p_workspace_id uuid, p_enabled boolean, p_authority text DEFAULT NULL, p_url text DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_url text;
  v_settings jsonb;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'audit', 'manage') THEN
    RAISE EXCEPTION 'audit access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_enabled THEN
    IF p_authority IS NULL OR p_authority NOT IN ('dfn', 'digicert', 'custom') THEN
      RAISE EXCEPTION 'choose a time-stamping authority: DFN, DigiCert or your own'
        USING ERRCODE = '22023';
    END IF;
    v_url := CASE p_authority
      WHEN 'dfn' THEN 'https://zeitstempel.dfn.de'
      WHEN 'digicert' THEN 'http://timestamp.digicert.com'
      ELSE btrim(coalesce(p_url, '')) END;
    IF p_authority = 'custom' AND (v_url !~ '^https?://[^\s]+$' OR length(v_url) > 500) THEN
      RAISE EXCEPTION 'enter the address of your time-stamping authority, starting with http:// or https://'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  v_settings := CASE WHEN p_enabled
    THEN jsonb_build_object('enabled', true, 'authority', p_authority, 'url', v_url)
    ELSE jsonb_build_object('enabled', false) END;
  UPDATE api.workspace_settings
     SET integration_settings = jsonb_set(coalesce(integration_settings, '{}'::jsonb), '{timestamps}', v_settings),
         updated_at = now()
   WHERE workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    INSERT INTO api.workspace_settings (workspace_id, created_by_user_id, integration_settings)
    VALUES (p_workspace_id, api.current_user_id(), jsonb_build_object('timestamps', v_settings));
  END IF;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'signature_timestamp', p_workspace_id, 'update', NULL, NULL,
    jsonb_build_object('action', 'timestamping-set', 'enabled', p_enabled,
                       'authority', p_authority));
  RETURN api.timestamp_settings(p_workspace_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_timestamp_settings(uuid, boolean, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_timestamp_settings(uuid, boolean, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_timestamp_settings(uuid, boolean, text, text) TO authenticated;
--> statement-breakpoint

-- Ask for a signature to be timestamped now (again): the server picks it up
-- within a minute. Needs audit access.
CREATE FUNCTION api.request_signature_timestamp(p_signature_id uuid) RETURNS api.signature_timestamps
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.signatures;
  r api.signature_timestamps;
BEGIN
  SELECT * INTO s FROM api.signatures WHERE id = p_signature_id;
  IF s.id IS NULL OR api.current_user_id() IS NULL
     OR s.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(s.workspace_id, 'audit', 'manage') THEN
    RAISE EXCEPTION 'audit access required' USING ERRCODE = 'SB060';
  END IF;
  IF NOT coalesce((api.timestamp_settings(s.workspace_id)->>'enabled')::boolean, false) THEN
    RAISE EXCEPTION 'turn on trusted timestamps in Settings > Audit first' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.signature_timestamps (workspace_id, signature_id, revision_id)
  VALUES (s.workspace_id, s.id, s.revision_id)
  ON CONFLICT (signature_id) DO UPDATE
    SET status = CASE WHEN api.signature_timestamps.status = 'stamped'
                      THEN 'stamped' ELSE 'pending' END,
        attempts = CASE WHEN api.signature_timestamps.status = 'stamped'
                        THEN api.signature_timestamps.attempts ELSE 0 END,
        next_attempt_at = now(), updated_at = now()
  RETURNING * INTO r;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_signature_timestamp(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_signature_timestamp(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_signature_timestamp(uuid) TO authenticated;
--> statement-breakpoint

-- Server side: what still needs a timestamp. Signatures of workspaces that
-- turned timestamps on and have no stamped row, whose retry time has come.
CREATE FUNCTION internal.signatures_due_timestamp(p_limit integer)
    RETURNS TABLE(signature_id uuid, workspace_id uuid, revision_id uuid, record_id uuid,
                  signature_meaning text, revision_integrity_digest text, signer_user_id text,
                  signed_at timestamp with time zone, authority text, authority_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT s.id, s.workspace_id, s.revision_id, s.record_id, s.signature_meaning,
         s.revision_integrity_digest, s.signer_user_id, s.signed_at,
         ws.integration_settings->'timestamps'->>'authority',
         ws.integration_settings->'timestamps'->>'url'
    FROM api.signatures s
    JOIN api.workspace_settings ws ON ws.workspace_id = s.workspace_id
    LEFT JOIN api.signature_timestamps t ON t.signature_id = s.id
   WHERE coalesce((ws.integration_settings->'timestamps'->>'enabled')::boolean, false)
     AND (t.id IS NULL OR (t.status = 'pending' AND t.next_attempt_at <= now()))
   ORDER BY s.signed_at
   LIMIT greatest(p_limit, 1)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.signatures_due_timestamp(integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.signatures_due_timestamp(integer) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.record_signature_timestamp(
    p_signature_id uuid, p_authority_name text, p_authority_url text, p_signed_data text,
    p_response_b64 text, p_gen_time timestamp with time zone, p_serial text, p_signer text)
    RETURNS api.signature_timestamps
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.signatures;
  r api.signature_timestamps;
  v_sequence bigint;
BEGIN
  SELECT * INTO s FROM api.signatures WHERE id = p_signature_id;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'signature not found' USING ERRCODE = 'SB036';
  END IF;
  INSERT INTO api.signature_timestamps (
    workspace_id, signature_id, revision_id, status, signed_data, imprint_sha256, authority_name,
    authority_url, response_b64, gen_time, serial, signer, attempts, last_error, updated_at)
  VALUES (s.workspace_id, s.id, s.revision_id, 'stamped', p_signed_data,
          encode(sha256(convert_to(p_signed_data, 'UTF8')), 'hex'), p_authority_name,
          p_authority_url, p_response_b64, p_gen_time, p_serial, p_signer, 1, NULL, now())
  ON CONFLICT (signature_id) DO UPDATE
    SET status = 'stamped', signed_data = EXCLUDED.signed_data,
        imprint_sha256 = EXCLUDED.imprint_sha256,
        authority_name = EXCLUDED.authority_name, authority_url = EXCLUDED.authority_url,
        response_b64 = EXCLUDED.response_b64, gen_time = EXCLUDED.gen_time,
        serial = EXCLUDED.serial, signer = EXCLUDED.signer,
        attempts = api.signature_timestamps.attempts + 1, last_error = NULL, updated_at = now()
    WHERE api.signature_timestamps.status <> 'stamped'
  RETURNING * INTO r;
  IF r.id IS NULL THEN
    -- Another replica stamped it first; the first stamp stands.
    SELECT * INTO r FROM api.signature_timestamps WHERE signature_id = p_signature_id;
    RETURN r;
  END IF;
  INSERT INTO api.workspace_change_seq(workspace_id, last_seq) VALUES (s.workspace_id, 1)
    ON CONFLICT (workspace_id) DO UPDATE
      SET last_seq = api.workspace_change_seq.last_seq + 1, updated_at = now()
    RETURNING last_seq INTO v_sequence;
  INSERT INTO api.change_events (id, workspace_id, sequence, entity_type, entity_uuid, operation, record_id, payload)
    VALUES (gen_random_uuid(), s.workspace_id, v_sequence, 'signature_timestamp', r.id, 'create', s.record_id,
            jsonb_build_object('action', 'timestamped', 'signatureId', s.id, 'revisionId', s.revision_id,
                               'authority', p_authority_name, 'genTime', p_gen_time));
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_signature_timestamp(uuid, text, text, text, text, timestamp with time zone, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_signature_timestamp(uuid, text, text, text, text, timestamp with time zone, text, text) FROM PUBLIC;
--> statement-breakpoint

-- A failed attempt: try again with a growing wait, and say so once it gives up.
CREATE FUNCTION internal.record_signature_timestamp_failure(p_signature_id uuid, p_error text)
    RETURNS api.signature_timestamps
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.signatures;
  r api.signature_timestamps;
  v_sequence bigint;
BEGIN
  SELECT * INTO s FROM api.signatures WHERE id = p_signature_id;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'signature not found' USING ERRCODE = 'SB036';
  END IF;
  INSERT INTO api.signature_timestamps (workspace_id, signature_id, revision_id, attempts, last_error, next_attempt_at)
  VALUES (s.workspace_id, s.id, s.revision_id, 1, left(p_error, 500), now() + interval '5 minutes')
  ON CONFLICT (signature_id) DO UPDATE
    SET attempts = api.signature_timestamps.attempts + 1,
        last_error = left(p_error, 500),
        next_attempt_at = now() + (interval '5 minutes' * power(3, least(api.signature_timestamps.attempts, 4))),
        status = CASE WHEN api.signature_timestamps.attempts + 1 >= 6 THEN 'failed' ELSE 'pending' END,
        updated_at = now()
    WHERE api.signature_timestamps.status <> 'stamped'
  RETURNING * INTO r;
  IF r.id IS NOT NULL AND r.status = 'failed' THEN
    INSERT INTO api.workspace_change_seq(workspace_id, last_seq) VALUES (s.workspace_id, 1)
      ON CONFLICT (workspace_id) DO UPDATE
        SET last_seq = api.workspace_change_seq.last_seq + 1, updated_at = now()
      RETURNING last_seq INTO v_sequence;
    INSERT INTO api.change_events (id, workspace_id, sequence, entity_type, entity_uuid, operation, record_id, payload)
      VALUES (gen_random_uuid(), s.workspace_id, v_sequence, 'signature_timestamp', r.id, 'update', s.record_id,
              jsonb_build_object('action', 'timestamp-failed', 'signatureId', s.id, 'revisionId', s.revision_id,
                                 'error', left(p_error, 200)));
  END IF;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_signature_timestamp_failure(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_signature_timestamp_failure(uuid, text) FROM PUBLIC;
--> statement-breakpoint

-- The workspace's export key. The server makes the pair; the first one stored
-- wins, so two replicas never end up with different keys.
CREATE FUNCTION internal.ensure_workspace_signing_key(p_workspace_id uuid, p_public text, p_private text, p_fingerprint text)
    RETURNS TABLE(public_key_pem text, private_key_pem text, fingerprint text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO internal.workspace_signing_keys (workspace_id, public_key_pem, private_key_pem, fingerprint)
  VALUES (p_workspace_id, p_public, p_private, p_fingerprint)
  ON CONFLICT (workspace_id) DO NOTHING;
  RETURN QUERY SELECT k.public_key_pem, k.private_key_pem, k.fingerprint, k.created_at
                 FROM internal.workspace_signing_keys k WHERE k.workspace_id = p_workspace_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.ensure_workspace_signing_key(uuid, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.ensure_workspace_signing_key(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint

-- The public half, for anyone in the workspace who wants to check a bundle.
CREATE FUNCTION api.workspace_signing_key(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  k internal.workspace_signing_keys;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT * INTO k FROM internal.workspace_signing_keys WHERE workspace_id = p_workspace_id;
  IF k.workspace_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('algorithm', k.algorithm, 'publicKeyPem', k.public_key_pem,
                            'fingerprint', k.fingerprint, 'createdAt', k.created_at);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.workspace_signing_key(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.workspace_signing_key(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.workspace_signing_key(uuid) TO authenticated, api_client;
--> statement-breakpoint

-- Credentials with admin or review scopes already exist; nothing to widen.
