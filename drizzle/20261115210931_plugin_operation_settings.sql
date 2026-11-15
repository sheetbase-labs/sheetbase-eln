-- A plugin operation may ask an administrator for settings (an address, a
-- token), kept like a connector's: sealed when secret, scope `operations:<id>`.
ALTER TABLE internal.extension_settings DROP CONSTRAINT chk_extension_settings_scope;
--> statement-breakpoint
ALTER TABLE internal.extension_settings ADD CONSTRAINT chk_extension_settings_scope
  CHECK (scope ~ '^(connectors|publishers|notification-channels|operations):[a-z][a-z0-9-]{0,48}$');
