-- Files can live in the database.
--
-- Uploaded files were kept on the app server's own disk, which a hosted
-- deploy replaces, so every release lost them. Files now go to Postgres by
-- default, in one-megabyte pieces so a large file is never one huge row, and
-- move to any S3-compatible service by changing one setting.
--
-- The tables are in `internal`, which the data API does not expose; the app
-- reads and writes them through its own connection.

CREATE TABLE internal.file_blobs (
    storage_key text PRIMARY KEY,
    byte_size bigint NOT NULL,
    checksum text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_file_blobs_byte_size CHECK (byte_size >= 0),
    CONSTRAINT chk_file_blobs_checksum CHECK (checksum ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE internal.file_blobs OWNER TO migrator;
--> statement-breakpoint
CREATE TABLE internal.file_blob_chunks (
    storage_key text NOT NULL REFERENCES internal.file_blobs (storage_key) ON DELETE CASCADE,
    seq integer NOT NULL,
    data bytea NOT NULL,
    PRIMARY KEY (storage_key, seq),
    CONSTRAINT chk_file_blob_chunks_seq CHECK (seq >= 0)
);
--> statement-breakpoint
ALTER TABLE internal.file_blob_chunks OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.file_objects DROP CONSTRAINT chk_file_objects_storage_backend;
--> statement-breakpoint
ALTER TABLE api.file_objects ADD CONSTRAINT chk_file_objects_storage_backend
  CHECK (storage_backend = ANY (ARRAY['database'::text, 'local'::text, 's3'::text]));
--> statement-breakpoint
ALTER TABLE api.file_objects ALTER COLUMN storage_backend SET DEFAULT 'database';
