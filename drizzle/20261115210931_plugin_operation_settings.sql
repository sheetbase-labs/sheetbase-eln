-- A plugin's operations may ask an administrator for settings (an address, a
-- token). They are shared by name across the plugin's operations, kept like a
-- connector's (sealed when secret) under the one scope `operations`.
ALTER TABLE internal.extension_settings DROP CONSTRAINT chk_extension_settings_scope;
--> statement-breakpoint
ALTER TABLE internal.extension_settings ADD CONSTRAINT chk_extension_settings_scope
  CHECK (scope ~ '^(connectors|publishers|notification-channels):[a-z][a-z0-9-]{0,48}$' OR scope = 'operations');
