-- API-02: widen internal.api_credentials CHECK to the API-01 product
-- vocabulary. scientific:* remains allowed on existing rows so they can
-- still exchange; createCredential rejects issuing those scopes anew.

ALTER TABLE internal.api_credentials DROP CONSTRAINT chk_api_credentials_scopes;

ALTER TABLE internal.api_credentials
  ADD CONSTRAINT chk_api_credentials_scopes CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY[
      'projects:read',
      'projects:write',
      'datasets:read',
      'datasets:write',
      'schema:read',
      'schema:write',
      'schema:publish',
      'sheets:read',
      'sheets:write',
      'models:read',
      'models:write',
      'templates:read',
      'templates:write',
      'reviews:read',
      'reviews:write',
      'files:read',
      'files:write',
      'scientific:read',
      'scientific:write',
      'scientific:schema'
    ]::text[]
  );
--> statement-breakpoint
