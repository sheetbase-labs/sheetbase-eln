-- The AI budget covers one whole assistant turn: every model step re-sends the
-- tool list and the conversation, so a multi-step task spends far more than a
-- single call. The old defaults (8,000 tokens, $0.05) were spent by the first
-- step, so even tiny requests ended in "budget exceeded". Raise the defaults and
-- the ceilings, and lift workspaces still sitting on the old defaults.

ALTER TABLE api.workspace_settings
  ALTER COLUMN ai_max_tokens_per_call SET DEFAULT 1000000,
  ALTER COLUMN ai_max_cost_microusd_per_call SET DEFAULT 20000000;
--> statement-breakpoint

UPDATE api.workspace_settings
   SET ai_max_tokens_per_call = 1000000
 WHERE ai_max_tokens_per_call = 8000;
--> statement-breakpoint

UPDATE api.workspace_settings
   SET ai_max_cost_microusd_per_call = 20000000
 WHERE ai_max_cost_microusd_per_call = 50000;
--> statement-breakpoint

-- Widen the accepted range inside the two functions that validate it, keeping
-- every other line of their current definitions.
DO $$
DECLARE
  v_def text;
  v_oid oid;
BEGIN
  FOR v_oid IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'api' AND p.proname = 'update_workspace_ai_settings')
        OR (n.nspname = 'internal' AND p.proname = 'agent_admin_operation_contract')
  LOOP
    v_def := pg_get_functiondef(v_oid);
    v_def := replace(v_def, 'BETWEEN 1 AND 100000', 'BETWEEN 1 AND 5000000');
    v_def := replace(v_def, 'BETWEEN 0 AND 10000000', 'BETWEEN 0 AND 500000000');
    EXECUTE v_def;
  END LOOP;
END
$$;
