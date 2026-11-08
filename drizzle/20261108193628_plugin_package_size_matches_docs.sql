-- A plugin package may be as large as the documented bound (64 MiB in all). The
-- table stopped it at 2 MiB, so a plugin that bundles a chemistry or sequence
-- library in its screens could not be added.
ALTER TABLE internal.extension_packages DROP CONSTRAINT chk_extension_packages_size;
--> statement-breakpoint
ALTER TABLE internal.extension_packages ADD CONSTRAINT chk_extension_packages_size CHECK (size BETWEEN 0 AND 67108864);
