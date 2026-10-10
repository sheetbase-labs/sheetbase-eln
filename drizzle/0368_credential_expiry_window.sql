-- SET-04.2 — an API token expires within 90 days and a refusal is recorded.
--
-- The design's SettingsApi and TokenCreate boards state a 90-day maximum expiry
-- and surface expired tokens that are still being used with a refusal count and
-- a "create replacement" action. The window is enforced where the row is written
-- (the app uses Drizzle directly, so a trigger is the only place that holds for
-- every writer), and the count is written by the exchange path when it refuses.
CREATE OR REPLACE FUNCTION internal.enforce_credential_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Only the 90-day window is a database rule: "not in the past" is the app's
  -- create-time validation, and a stored row must be able to age into expiry.
  IF NEW.expires_at IS NOT NULL THEN
    IF NEW.expires_at > coalesce(NEW.created_at, now()) + interval '90 days' THEN
      RAISE EXCEPTION 'a token may not live longer than 90 days' USING ERRCODE = 'SB117';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.enforce_credential_expiry() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

DROP TRIGGER IF EXISTS enforce_credential_expiry ON internal.api_credentials;
--> statement-breakpoint
CREATE TRIGGER enforce_credential_expiry BEFORE INSERT OR UPDATE ON internal.api_credentials
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_credential_expiry();
--> statement-breakpoint

-- A token presented after it expired is refused by the exchange path, which
-- records the refusal so the owner sees it on the API settings page.
CREATE OR REPLACE FUNCTION internal.record_credential_refusal(p_credential_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE internal.api_credentials
     SET refusal_count = refusal_count + 1,
         last_refused_at = now()
   WHERE id = p_credential_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_credential_refusal(uuid) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

-- The API settings read: one row per token with the state the design shows.
CREATE OR REPLACE FUNCTION api.api_credential_status()
RETURNS TABLE(
  id uuid,
  display_prefix text,
  name text,
  kind text,
  scopes text[],
  created_at timestamp with time zone,
  expires_at timestamp with time zone,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  refusal_count integer,
  last_refused_at timestamp with time zone,
  expired boolean,
  unused_days integer,
  needs_replacement boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.display_prefix, c.name, c.kind, c.scopes, c.created_at, c.expires_at,
         c.last_used_at, c.revoked_at, c.refusal_count, c.last_refused_at,
         (c.expires_at IS NOT NULL AND c.expires_at <= now()) AS expired,
         CASE WHEN c.last_used_at IS NULL THEN NULL
              ELSE floor(extract(epoch FROM now() - c.last_used_at) / 86400)::integer END AS unused_days,
         (c.revoked_at IS NULL
          AND ((c.expires_at IS NOT NULL AND c.expires_at <= now() AND c.refusal_count > 0)
               OR (c.last_used_at IS NOT NULL
                   AND c.last_used_at < now() - interval '30 days'))) AS needs_replacement
    FROM internal.api_credentials c
   WHERE c.workspace_id = api.current_workspace_id()
     AND api.has_capability(c.workspace_id, 'workspace.admin')
   ORDER BY c.created_at DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.api_credential_status() FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.api_credential_status() TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
