-- An agent may delete a workspace group, behind a confirmation like any other
-- write. Everything else that deletes stays closed to agents. The same rule is
-- in src/lib/agent-action-policy.ts.
CREATE OR REPLACE FUNCTION internal.agent_action_always_never(p_action_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT (p_action_key ~ '(^|_)(sign|amend|lock|unlock|delete|destroy|purge)(_|$)'
          AND p_action_key <> 'delete_workspace_group')
      OR p_action_key ~ '^submit_(experiment|record|review|notebook|for_review)'
      OR p_action_key IN ('submit_for_review', 'decide_review', 'release_sample', 'approve_signature')
$$;
