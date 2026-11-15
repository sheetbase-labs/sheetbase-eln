-- The earlier budget fix only moved workspaces still on the exact old defaults.
-- A workspace whose limit had been saved at another low value (the demo sat at
-- 10,000 tokens) still ended every request in "budget exceeded", because the
-- limit covers a whole assistant turn and one step alone re-sends the tool list.
-- Lift any limit below the new defaults to them.

UPDATE api.workspace_settings
   SET ai_max_tokens_per_call = 1000000
 WHERE ai_max_tokens_per_call < 1000000;
--> statement-breakpoint

UPDATE api.workspace_settings
   SET ai_max_cost_microusd_per_call = 20000000
 WHERE ai_max_cost_microusd_per_call < 20000000;
