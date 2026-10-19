-- QA access default. A workspace administrator can name one internal group
-- (api.set_project_access_defaults) that should be able to view every new
-- project. Until now that choice was stored and never applied, so it changed
-- nothing. A project created after it is set now gets a view-only rule for the
-- group; edit, review, manage and client portal access are never granted.
--
-- The rule is skipped when the group no longer exists in the workspace or has
-- come to include a client user, because the default is meant for internal QA
-- staff. Existing projects are not touched, and a rule an administrator later
-- removes or changes on a project is not put back.

CREATE OR REPLACE FUNCTION internal.apply_project_qa_view_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_group uuid;
  v_actor text;
BEGIN
  -- The rule records who granted it: the person creating the project, or its
  -- lead when no one is signed in (an import). Without either, nothing is
  -- granted rather than inventing an author.
  v_actor := coalesce(api.current_user_id(), NEW.lead_user_id);
  SELECT g.id INTO v_group
    FROM api.workspace_settings s
    JOIN api.workspace_groups g
      ON g.workspace_id = s.workspace_id
     AND g.id::text = s.integration_settings->'projectAccessDefaults'->>'qaViewGroupId'
   WHERE s.workspace_id = NEW.workspace_id
     AND NOT EXISTS (
       SELECT 1
         FROM api.workspace_group_memberships gm
         JOIN api.workspace_memberships m
           ON m.workspace_id = gm.workspace_id AND m.user_id = gm.user_id
        WHERE gm.group_id = g.id AND m.role = 'client_viewer'
     );
  IF v_group IS NOT NULL AND v_actor IS NOT NULL THEN
    INSERT INTO api.project_access(
      workspace_id, project_id, group_id,
      can_view, can_edit, can_review, client_portal, can_manage,
      granted_by_user_id
    ) VALUES (
      NEW.workspace_id, NEW.id, v_group,
      true, false, false, false, false,
      v_actor
    )
    ON CONFLICT (workspace_id, project_id, group_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.apply_project_qa_view_default() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_apply_qa_view_default ON api.projects;
--> statement-breakpoint
CREATE TRIGGER projects_apply_qa_view_default
  AFTER INSERT ON api.projects
  FOR EACH ROW EXECUTE FUNCTION internal.apply_project_qa_view_default();
--> statement-breakpoint

-- The owner rule trigger (0323) already inserted the chosen group's rule
-- unconditionally, ahead of the trigger above, so a group that includes a client
-- user still got access. It now only grants the lead; the default group rule is
-- applied solely by internal.apply_project_qa_view_default().
CREATE OR REPLACE FUNCTION internal.project_owner_rule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE principal text:=coalesce(NEW.lead_user_id,api.current_user_id());
BEGIN
  IF principal IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=NEW.workspace_id AND m.user_id=principal AND m.suspended_at IS NULL AND m.role IN ('owner','admin','member','steward','scientist','analyst','reviewer')) THEN RAISE EXCEPTION 'Active writer lead required' USING ERRCODE='42501'; END IF;
  INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
    VALUES(NEW.workspace_id,NEW.id,principal,true,true,true,true,principal)
  ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET can_view=true,can_edit=true,can_review=true,can_manage=true,updated_at=now();
  RETURN NEW;
END $$;
