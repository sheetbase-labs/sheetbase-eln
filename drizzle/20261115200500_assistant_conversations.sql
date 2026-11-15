-- The Agent page: a person's conversations with the assistant, kept so the
-- list on the page survives a reload. One row per conversation, owned by one
-- person in one workspace; nobody else reads it (not admins, not service
-- credentials). The messages are the chat's own message parts as JSON.

CREATE TABLE api.assistant_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_conversations_pkey PRIMARY KEY (id),
    CONSTRAINT assistant_conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT assistant_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_assistant_conversations_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT chk_assistant_conversations_messages CHECK (
      jsonb_typeof(messages) = 'array'
      AND jsonb_array_length(messages) <= 400
      AND pg_column_size(messages) <= 4000000)
);
--> statement-breakpoint
ALTER TABLE api.assistant_conversations OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_assistant_conversations_user_updated
    ON api.assistant_conversations (user_id, workspace_id, updated_at DESC);
--> statement-breakpoint
ALTER TABLE api.assistant_conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY assistant_conversations_select ON api.assistant_conversations FOR SELECT TO authenticated
    USING (user_id = api.current_user_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.assistant_conversations TO authenticated;
--> statement-breakpoint

-- Change events and webhook names ------------------------------------------------

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
  IF position('''assistant_conversation''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''assistant_conversation''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('assistant.conversation.created'), ('assistant.conversation.deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('assistant.conversation.created'), ('assistant.conversation.deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Saving, renaming, deleting ------------------------------------------------------

-- Starts a conversation, or replaces the messages of one of your own. The
-- title is kept once set unless a new one is given.
CREATE FUNCTION api.save_assistant_conversation(
    p_messages jsonb,
    p_conversation_id uuid DEFAULT NULL,
    p_title text DEFAULT NULL
) RETURNS api.assistant_conversations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user text := api.current_user_id();
  v_workspace uuid := api.current_workspace_id();
  v api.assistant_conversations;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
BEGIN
  IF v_user IS NULL OR v_workspace IS NULL THEN
    RAISE EXCEPTION 'save_assistant_conversation requires an authenticated user in a workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
  END IF;
  IF p_messages IS NULL OR jsonb_typeof(p_messages) <> 'array' THEN
    RAISE EXCEPTION 'messages must be an array' USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NOT NULL THEN
    UPDATE api.assistant_conversations c
       SET messages = p_messages,
           title = coalesce(left(v_title, 200), c.title),
           updated_at = now()
     WHERE c.id = p_conversation_id AND c.user_id = v_user AND c.workspace_id = v_workspace
    RETURNING * INTO v;
    IF v.id IS NOT NULL THEN
      RETURN v;
    END IF;
  END IF;
  INSERT INTO api.assistant_conversations (id, workspace_id, user_id, title, messages)
  VALUES (coalesce(p_conversation_id, gen_random_uuid()), v_workspace, v_user,
          coalesce(left(v_title, 200), 'New chat'), p_messages)
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(v_workspace, 'assistant_conversation', v.id, 'create', NULL, NULL,
    jsonb_build_object('conversationId', v.id, 'title', v.title,
                       'messageCount', jsonb_array_length(v.messages)));
  RETURN v;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.rename_assistant_conversation(p_conversation_id uuid, p_title text)
    RETURNS api.assistant_conversations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.assistant_conversations;
  v_title text := btrim(coalesce(p_title, ''));
BEGIN
  IF api.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'rename_assistant_conversation requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION 'a conversation needs a title' USING ERRCODE = '22023';
  END IF;
  UPDATE api.assistant_conversations c
     SET title = left(v_title, 200)
   WHERE c.id = p_conversation_id AND c.user_id = api.current_user_id()
     AND c.workspace_id = api.current_workspace_id()
  RETURNING * INTO v;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.delete_assistant_conversation(p_conversation_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.assistant_conversations;
BEGIN
  IF api.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'delete_assistant_conversation requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.assistant_conversations c
   WHERE c.id = p_conversation_id AND c.user_id = api.current_user_id()
     AND c.workspace_id = api.current_workspace_id()
  RETURNING * INTO v;
  IF v.id IS NULL THEN
    RETURN;
  END IF;
  PERFORM internal.emit_change_event(v.workspace_id, 'assistant_conversation', v.id, 'delete', NULL, NULL,
    jsonb_build_object('conversationId', v.id, 'title', v.title));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_assistant_conversation(jsonb, uuid, text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.rename_assistant_conversation(uuid, text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.delete_assistant_conversation(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_assistant_conversation(jsonb, uuid, text),
  api.rename_assistant_conversation(uuid, text),
  api.delete_assistant_conversation(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_assistant_conversation(jsonb, uuid, text),
  api.rename_assistant_conversation(uuid, text),
  api.delete_assistant_conversation(uuid) TO authenticated;
