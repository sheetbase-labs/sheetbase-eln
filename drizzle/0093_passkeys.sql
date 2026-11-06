-- Passkeys.
--
-- A person can add a passkey (a fingerprint, face or device PIN on a phone,
-- laptop or security key) and use it to sign in without an emailed link. The
-- sign-in library owns this table; it is one row per registered passkey.

CREATE TABLE internal.passkey (
    id text NOT NULL,
    name text,
    "publicKey" text NOT NULL,
    "userId" text NOT NULL,
    "credentialID" text NOT NULL,
    counter integer NOT NULL,
    "deviceType" text NOT NULL,
    "backedUp" boolean NOT NULL,
    transports text,
    "createdAt" timestamp with time zone DEFAULT now(),
    aaguid text,
    CONSTRAINT passkey_pkey PRIMARY KEY (id),
    CONSTRAINT passkey_credential_id_key UNIQUE ("credentialID"),
    CONSTRAINT passkey_user_id_fkey FOREIGN KEY ("userId") REFERENCES internal."user"(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.passkey OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_passkey_user_id ON internal.passkey USING btree ("userId");
