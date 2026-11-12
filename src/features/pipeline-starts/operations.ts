/**
 * The rules across a pipeline's starts: when it may start (hours), how many
 * new rows a snapshot must bring, how long to wait to batch imports, and what
 * to do about a run that is going and about starts missed while the app was
 * down. Declared once, so the API, the SDKs, MCP, the assistant and agents
 * all come from this entry. The change is sent as `pipeline.updated`.
 *
 * It is not a pipeline action: a pipeline changing the rules that start it
 * would let a run widen its own reach.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const described = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
): OperationInput => ({ ...input(name, type, required), description })

export const PIPELINE_STARTS_OPERATIONS = defineOperations([
  {
    name: 'set_pipeline_start_rules',
    label: 'Set when a pipeline may start',
    summary: 'Set a pipeline’s start rules',
    description:
      'Sets the rules across all of a pipeline’s starts (new snapshots, its webhook and its schedules). `p_rules` is `{ "conditionsMatch": "all" | "any", "window": { "days": "daily" | "weekdays" | "weekends", "from": "07:00", "to": "19:00", "timeZone": "Europe/London" } or null, "minNewRows": a whole number or null, "waitMinutes": 0 to 1440, "missedRuns": "run_once" | "skip" }`. The hours and the row condition decide whether a start runs: with `all` every condition that applies must hold, with `any` one is enough; a schedule or a webhook passes the row condition. `waitMinutes` waits after the last snapshot so a batch of imports runs once. A start while a run is going is skipped. Send `{}` to go back to no extra rules. Replaces the rules as a whole. Returns the pipeline. Sends `pipeline.updated`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      {
        ...input('p_workspace_id', 'uuid'),
        server: 'workspace',
        description: 'Your workspace id.',
      },
      described(
        'p_definition_id',
        'uuid',
        'The pipeline, from `pipeline_definitions`.',
      ),
      described('p_rules', 'json', 'The rules, as above; `{}` clears them.'),
    ],
    result: 'row:pipeline_definitions',
    assistant: { tool: 'sheetbase.pipeline.start_rules_set' },
  },
])
