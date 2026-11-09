-- An agent may delete a file, behind a confirmation like any other write; a
-- deleted file can be restored. Everything else that deletes stays closed to
-- agents. The same rule is in src/lib/agent-action-policy.ts.
CREATE OR REPLACE FUNCTION internal.agent_action_always_never(p_action_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT (p_action_key ~ '(^|_)(sign|amend|lock|unlock|delete|destroy|purge)(_|$)'
          AND p_action_key NOT IN ('delete_workspace_group', 'delete_file'))
      OR p_action_key ~ '^submit_(experiment|record|review|notebook|for_review)'
      OR p_action_key IN ('submit_for_review', 'decide_review', 'release_sample', 'approve_signature')
$$;
