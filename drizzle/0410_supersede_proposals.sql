-- PIPE-03.2 — a proposal is superseded when the same change is proposed again.
--
-- A pipeline runs on a schedule, so a propose step proposes the *same* change on every run:
-- "add a summary block after Figure 1" from run 9 is the same request as from run 8. Only the
-- newest one should be actionable — the older one is the same decision, asked twice, and
-- leaving both pending would ask a person to decide the same thing twice.
--
-- Superseded is therefore precise: the same operation payload (the same change) against the
-- same target, with a newer proposal existing. Two *different* changes to one record do not
-- collide, because their payloads differ — which is why this compares the operation and not
-- just the target.
--
-- The superseded proposal is cancelled, not deleted: it stays readable so the history shows
-- the request was made and that it was superseded, with the reason recorded.

DO $$
DECLARE
  def text;
  marker text := '  INSERT INTO api.agent_operation_proposals(';
  block text;
BEGIN
  def := pg_get_functiondef('api.propose_agent_operation(uuid,text,text,jsonb,jsonb,text)'::regprocedure);
  IF position('superseded' in def) > 0 THEN RETURN; END IF;
  IF position(marker in def) = 0 THEN
    RAISE EXCEPTION 'propose patch marker not found';
  END IF;

  block := E'  -- Supersede the older pending proposals for the same change.\n'
    || E'  UPDATE api.agent_operation_proposals\n'
    || E'     SET status = ''cancelled'',\n'
    || E'         revision = revision + 1,\n'
    || E'         rejection_reason = ''Superseded by a newer proposal for the same change.'',\n'
    || E'         updated_at = now()\n'
    || E'   WHERE workspace_id = p_workspace_id\n'
    || E'     AND status = ''pending''\n'
    || E'     AND operation_kind = p_operation->>''kind''\n'
    || E'     AND operation = p_operation\n'
    || E'     AND policy_target IS NOT DISTINCT FROM v_contract->''preview''->''target'';\n'
    || E'\n';

  def := replace(def, marker, block || marker);
  EXECUTE def;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
