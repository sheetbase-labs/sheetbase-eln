ALTER TABLE "api"."blocks" DROP CONSTRAINT "chk_blocks_type";--> statement-breakpoint
ALTER TABLE "api"."blocks" ADD CONSTRAINT "chk_blocks_type" CHECK ("api"."blocks"."type" IN ('rich_text', 'checklist', 'linked_record', 'callout', 'table', 'sheet', 'chart', 'plate_map', 'file', 'metric', 'procedure_step'));
