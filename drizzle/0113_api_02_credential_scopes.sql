-- API-02: canonical Core-domain scopes only. scientific:* is removed, not
-- deprecated. There are no production credentials to migrate.

DELETE FROM internal.api_credentials
WHERE scopes && ARRAY[
  'scientific:read',
  'scientific:write',
  'scientific:schema'
]::text[];

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
      'files:write'
    ]::text[]
  );

ALTER TABLE internal.api_credentials
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
--> statement-breakpoint
