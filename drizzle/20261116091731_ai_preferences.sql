-- AI preferences: short standing notes the assistant keeps about how the lab
-- (or one person) likes things done, such as "96-well plates: blanks in
-- column 12" or "name experiments PROJECT-YYMMDD-initials". A person confirms
-- each one on a card before it is saved; the assistant reads the saved ones
-- before it plans.
--
-- Two scopes. A lab preference ('workspace') is an admin's choice: it needs
-- AI settings (manage) and a person in the app, never a token or a pipeline,
-- because it steers what the assistant proposes for everyone. A personal
-- preference ('user') belongs to one person and is private to them.
--
-- Kept small on purpose: a one-line note, at most 25 per scope.

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
  IF position('''ai_preference''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''ai_preference''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('ai.preference.saved'),
  ('ai.preference.updated'),
  ('ai.preference.deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('ai.preference.saved'),
  ('ai.preference.updated'),
  ('ai.preference.deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Forgetting a preference is a delete, but it is small and the person
-- confirms the card, so agents may do it.
INSERT INTO internal.agent_allowed_deletes (action_key) VALUES ('delete_ai_preference')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE TABLE api.ai_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    scope text NOT NULL,
    user_id text,
    topic text,
    body text NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_preferences_pkey PRIMARY KEY (id),
    CONSTRAINT ai_preferences_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_ai_preferences_scope CHECK (
      (scope = 'workspace' AND user_id IS NULL)
      OR (scope = 'user' AND user_id IS NOT NULL)),
    CONSTRAINT chk_ai_preferences_body CHECK (length(btrim(body)) BETWEEN 1 AND 300),
    CONSTRAINT chk_ai_preferences_topic CHECK (topic IS NULL OR length(btrim(topic)) BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE api.ai_preferences OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_ai_preferences_body ON api.ai_preferences
  (workspace_id, scope, coalesce(user_id, ''), lower(btrim(body)));
--> statement-breakpoint
CREATE INDEX idx_ai_preferences_workspace ON api.ai_preferences (workspace_id, scope, created_at);
--> statement-breakpoint
ALTER TABLE api.ai_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Everyone in the workspace reads the lab's preferences; a person reads only
-- their own personal ones.
CREATE POLICY ai_preferences_select ON api.ai_preferences FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND (scope = 'workspace' OR user_id = api.current_user_id()));
--> statement-breakpoint
CREATE POLICY ai_preferences_client_select ON api.ai_preferences FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id()
           AND (scope = 'workspace' OR user_id = api.current_user_id()));
--> statement-breakpoint
GRANT SELECT ON TABLE api.ai_preferences TO authenticated, api_client;
--> statement-breakpoint

-- Whether the caller may change a preference of this scope.
CREATE FUNCTION internal.ai_preference_check(p_workspace_id uuid, p_scope text, p_user_id text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF p_scope = 'workspace' THEN
    IF NOT internal.is_person_in_app() THEN
      RAISE EXCEPTION 'The lab’s AI preferences are changed by a person in the app, not by a token or a pipeline. Save a personal one instead.' USING ERRCODE = '42501';
    END IF;
    IF NOT api.has_settings_access(p_workspace_id, 'ai', 'manage') THEN
      RAISE EXCEPTION 'Only someone who manages the AI settings can change the lab’s AI preferences.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF api.current_user_id() IS NULL THEN
      RAISE EXCEPTION 'Personal AI preferences belong to a person; a service credential has none.' USING ERRCODE = '42501';
    END IF;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.ai_preference_check(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.ai_preference_check(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.ai_preference_check(uuid, text, text) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.save_ai_preference(
    p_body text,
    p_scope text DEFAULT 'user',
    p_topic text DEFAULT NULL
) RETURNS api.ai_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_user_id text := api.current_user_id();
  v_scope text := coalesce(nullif(btrim(p_scope), ''), 'user');
  v_body text := btrim(coalesce(p_body, ''));
  v_topic text := nullif(btrim(coalesce(p_topic, '')), '');
  v_row api.ai_preferences;
BEGIN
  IF v_scope NOT IN ('user', 'workspace') THEN
    RAISE EXCEPTION 'The scope is "user" or "workspace".' USING ERRCODE = 'SB034';
  END IF;
  PERFORM internal.ai_preference_check(v_workspace_id, v_scope, v_user_id);
  IF length(v_body) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'A preference is one note of up to 300 characters.' USING ERRCODE = 'SB034';
  END IF;
  IF v_topic IS NOT NULL AND length(v_topic) > 60 THEN
    RAISE EXCEPTION 'The topic is up to 60 characters.' USING ERRCODE = 'SB034';
  END IF;
  IF (SELECT count(*) FROM api.ai_preferences p
       WHERE p.workspace_id = v_workspace_id AND p.scope = v_scope
         AND p.user_id IS NOT DISTINCT FROM CASE WHEN v_scope = 'user' THEN v_user_id END) >= 25 THEN
    RAISE EXCEPTION 'That is 25 preferences already. Remove one to save another.' USING ERRCODE = 'SB034';
  END IF;

  BEGIN
    INSERT INTO api.ai_preferences (workspace_id, scope, user_id, topic, body, created_by_user_id)
    VALUES (v_workspace_id, v_scope, CASE WHEN v_scope = 'user' THEN v_user_id END, v_topic, v_body, v_user_id)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That preference is already saved.' USING ERRCODE = 'SB034';
  END;

  PERFORM internal.emit_change_event(v_workspace_id, 'ai_preference', v_row.id, 'create', NULL, NULL,
    jsonb_build_object('preferenceId', v_row.id, 'scope', v_scope, 'topic', v_topic));

  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_ai_preference(text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_ai_preference(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.save_ai_preference(text, text, text) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.update_ai_preference(
    p_preference_id uuid,
    p_body text,
    p_topic text DEFAULT NULL
) RETURNS api.ai_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_row api.ai_preferences;
  v_body text := btrim(coalesce(p_body, ''));
  v_topic text := nullif(btrim(coalesce(p_topic, '')), '');
BEGIN
  SELECT * INTO v_row FROM api.ai_preferences
   WHERE id = p_preference_id AND workspace_id = v_workspace_id
     AND (scope = 'workspace' OR user_id = api.current_user_id())
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such preference.' USING ERRCODE = 'SB036';
  END IF;
  PERFORM internal.ai_preference_check(v_workspace_id, v_row.scope, v_row.user_id);
  IF length(v_body) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'A preference is one note of up to 300 characters.' USING ERRCODE = 'SB034';
  END IF;
  IF v_topic IS NOT NULL AND length(v_topic) > 60 THEN
    RAISE EXCEPTION 'The topic is up to 60 characters.' USING ERRCODE = 'SB034';
  END IF;

  BEGIN
    UPDATE api.ai_preferences SET body = v_body, topic = v_topic, updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That preference is already saved.' USING ERRCODE = 'SB034';
  END;

  PERFORM internal.emit_change_event(v_workspace_id, 'ai_preference', v_row.id, 'update', NULL, NULL,
    jsonb_build_object('preferenceId', v_row.id, 'scope', v_row.scope, 'topic', v_topic));

  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_ai_preference(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_ai_preference(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_ai_preference(uuid, text, text) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.delete_ai_preference(p_preference_id uuid) RETURNS api.ai_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_row api.ai_preferences;
BEGIN
  SELECT * INTO v_row FROM api.ai_preferences
   WHERE id = p_preference_id AND workspace_id = v_workspace_id
     AND (scope = 'workspace' OR user_id = api.current_user_id())
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such preference.' USING ERRCODE = 'SB036';
  END IF;
  PERFORM internal.ai_preference_check(v_workspace_id, v_row.scope, v_row.user_id);
  DELETE FROM api.ai_preferences WHERE id = v_row.id;

  PERFORM internal.emit_change_event(v_workspace_id, 'ai_preference', v_row.id, 'delete', NULL, NULL,
    jsonb_build_object('preferenceId', v_row.id, 'scope', v_row.scope, 'topic', v_row.topic));

  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_ai_preference(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_ai_preference(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.delete_ai_preference(uuid) TO authenticated, api_client;
--> statement-breakpoint

-- The pipeline actions. Mirrors src/features/ai-preferences/operations.ts.
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
('save_ai_preference', '{"operation":"save_ai_preference","rpc":"save_ai_preference","label":"Remember an AI preference","description":"Saves one short note about how things are done, such as \"96-well plates: blanks in column 12\", which the assistant reads before it plans. Up to 300 characters and 25 per scope. A personal preference is yours alone. A lab preference (`workspace`) is for everyone and needs AI settings (manage) and a person in the app: a token or a pipeline is refused. Returns the preference. Sends `ai.preference.saved`.","arguments":[{"name":"p_body","type":"text","required":true,"nullable":false},{"name":"p_scope","type":"text","required":false,"nullable":false},{"name":"p_topic","type":"text","required":false,"nullable":true}]}'::jsonb),
  ('update_ai_preference', '{"operation":"update_ai_preference","rpc":"update_ai_preference","label":"Change an AI preference","description":"Rewrites the text and topic of a saved preference. A personal preference is yours alone. A lab preference (`workspace`) is for everyone and needs AI settings (manage) and a person in the app: a token or a pipeline is refused. Returns the preference. Sends `ai.preference.updated`.","arguments":[{"name":"p_preference_id","type":"uuid","required":true,"nullable":false},{"name":"p_body","type":"text","required":true,"nullable":false},{"name":"p_topic","type":"text","required":false,"nullable":true}]}'::jsonb),
  ('delete_ai_preference', '{"operation":"delete_ai_preference","rpc":"delete_ai_preference","label":"Forget an AI preference","description":"Removes a saved preference; the assistant stops following it. A personal preference is yours alone. A lab preference (`workspace`) is for everyone and needs AI settings (manage) and a person in the app: a token or a pipeline is refused. Returns the preference that was removed. Sends `ai.preference.deleted`.","arguments":[{"name":"p_preference_id","type":"uuid","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
