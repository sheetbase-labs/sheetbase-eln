-- AUTH — two-factor (TOTP) for email sign-in. Better Auth owns these shapes.
ALTER TABLE "internal"."user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "internal"."twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failedVerificationCount" integer DEFAULT 0 NOT NULL,
	"lockedUntil" timestamp with time zone,
	CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "internal"."user"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "idx_two_factor_user_id" ON "internal"."twoFactor" ("userId");
