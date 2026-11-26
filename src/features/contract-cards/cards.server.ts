import { z } from 'zod'

import { findModel } from '#/lib/assistant-labwork.server'
import { likeValue } from '#/lib/assistant-lab-tools.server'
import {
  cardSchema,
  changed,
  fail,
  findTable,
  ok,
  rpcCard,
  same,
} from '#/lib/assistant-rpc-cards.server'
import type { RpcCard } from '#/lib/assistant-rpc-cards.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import { CONTRACT_CARDS } from './cards'
import type { ContractCardsProposeToolName } from './cards'

/**
 * The data contract and lineage cards (see `cards.ts`). A contract sits on a
 * measurement table or a record type; a rule is one check on a field.
 */

const covers = (tool: ContractCardsProposeToolName): readonly string[] =>
  CONTRACT_CARDS.find((card) => card.tool === tool)?.covers ?? []

interface FoundContract {
  id: string
  name: string
  lifecycle: string
  dataset_schema_id: string | null
  record_model_key: string | null
  rules: unknown
}

async function findContract(
  client: DataClient,
  wanted: string,
): Promise<Lookup<FoundContract>> {
  const rows = await client.list<FoundContract>(
    'data_contracts',
    `?name=ilike.${likeValue(wanted)}&select=id,name,lifecycle,dataset_schema_id,record_model_key,rules&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'data contract',
    (row) => row.name,
    (row) => same(row.name, wanted),
  )
}

const contractRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The data contract, by its name.')

const contractHref = (row: {
  dataset_schema_id: string | null
  record_model_key: string | null
}): string => {
  const model = row.dataset_schema_id ?? row.record_model_key

  return model ? `/models/${encodeURIComponent(model)}/contract` : '/models'
}

const RULE_KINDS = [
  'required',
  'unique',
  'range',
  'units',
  'completeness',
  'row_count',
  'freshness',
] as const

const ruleSpec = z.strictObject({
  id: z
    .string()
    .max(60)
    .optional()
    .describe('A short ID for the rule; one is made if left out.'),
  kind: z.enum(RULE_KINDS),
  field: z
    .string()
    .max(120)
    .optional()
    .describe('The column or field it checks.'),
  mode: z
    .enum(['warn', 'block'])
    .default('warn')
    .describe('warn only flags; block stops a bad write.'),
  min: z.number().optional(),
  max: z.number().optional(),
  units: z.string().max(40).optional(),
  threshold: z.number().optional(),
  maxAgeMinutes: z.number().int().positive().optional(),
})

const where = z.strictObject({
  table: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('The measurement table it sits on, by name, key or ID.'),
  recordType: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Or the record type it sits on, by name or key.'),
})

/** The measurement table or record type a contract sits on. */
async function resolveHome(
  client: DataClient,
  input: z.infer<typeof where>,
): Promise<
  Lookup<{ schemaId: string | null; modelKey: string | null; name: string }>
> {
  if ((input.table ? 1 : 0) + (input.recordType ? 1 : 0) !== 1) {
    return {
      ok: false,
      message:
        'Name either the measurement table or the record type it sits on.',
    }
  }

  if (input.table) {
    const table = await findTable(client, input.table)

    return table.ok
      ? {
          ok: true,
          value: {
            schemaId: table.value.id,
            modelKey: null,
            name: table.value.name,
          },
        }
      : table
  }

  const model = await findModel(client, input.recordType ?? '')

  return model.ok
    ? {
        ok: true,
        value: {
          schemaId: null,
          modelKey: model.value.key,
          name: model.value.name,
        },
      }
    : model
}

// ---------------------------------------------------------------------------

const saveSchema = cardSchema({
  ...where.shape,
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).optional(),
  rules: z
    .array(ruleSpec)
    .max(100)
    .optional()
    .describe(
      'The full list of rules; it replaces the rules now there and makes a new version. Leave out to keep them.',
    ),
  lifecycle: z.enum(['draft', 'active', 'retired']).optional(),
  scheduleMinutes: z
    .number()
    .int()
    .min(0)
    .max(525_600)
    .optional()
    .describe(
      'Check every this many minutes (5 or more); 0 turns scheduled checks off.',
    ),
})

const save = rpcCard({
  tool: 'sheetbase.contract.save',
  covers: covers('sheetbase.contract.save'),
  description:
    'Propose making or changing the data contract on a measurement table or a record type: its rules, name, state or check schedule. Anything left out keeps its value. A change of rules makes a new version.',
  schema: saveSchema,
  async build(input, { client }) {
    const home = await resolveHome(client, input)

    if (!home.ok) return home
    const { rules, scheduleMinutes } = input

    const changes = [changed('Contract on', null, home.value.name)]

    if (input.name) changes.push(changed('Name', null, input.name))

    if (rules) {
      changes.push(
        changed(
          'Rules',
          null,
          rules.length === 0
            ? 'None'
            : rules
                .map(
                  (rule) =>
                    `${rule.kind}${rule.field ? ` ${rule.field}` : ''} (${rule.mode})`,
                )
                .join(', '),
        ),
      )
    }

    if (input.lifecycle) changes.push(changed('State', null, input.lifecycle))

    if (scheduleMinutes !== undefined) {
      changes.push(
        changed(
          'Checked',
          null,
          scheduleMinutes === 0
            ? 'Not on a schedule'
            : `Every ${scheduleMinutes} minutes`,
        ),
      )
    }

    if (changes.length === 1)
      return fail('Nothing to save: give rules, a name, a state or a schedule.')

    return ok({
      target: home.value.name,
      deepLink: contractHref({
        dataset_schema_id: home.value.schemaId,
        record_model_key: home.value.modelKey,
      }),
      changes,
      rpc: 'save_data_contract',
      args: {
        p_dataset_schema_id: home.value.schemaId,
        p_record_model_key: home.value.modelKey,
        p_rules: rules ?? null,
        p_name: input.name ?? null,
        p_description: input.description ?? null,
        p_owner_user_id: null,
        p_lifecycle: input.lifecycle ?? null,
        p_schedule_minutes: scheduleMinutes ?? null,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const deleteSchema = cardSchema({ contract: contractRef })

const deleteContract = rpcCard({
  tool: 'sheetbase.contract.delete',
  covers: covers('sheetbase.contract.delete'),
  description:
    'Propose deleting a data contract and its check history. To stop checking without losing it, set its state to retired with the save tool instead.',
  schema: deleteSchema,
  async build(input, { client }) {
    const found = await findContract(client, input.contract)

    if (!found.ok) return found

    return ok({
      target: found.value.name,
      deepLink: contractHref(found.value),
      changes: [changed('Contract', found.value.name, 'Deleted')],
      rpc: 'delete_data_contract',
      args: { p_contract_id: found.value.id },
    })
  },
})

// ---------------------------------------------------------------------------

const importSchema = cardSchema({
  ...where.shape,
  odcs: z
    .record(z.string(), z.json())
    .describe(
      'An Open Data Contract Standard v3.1 document, as JSON. Only what a Sheetbase rule can say is kept.',
    ),
})

const importOdcs = rpcCard({
  tool: 'sheetbase.contract.import_odcs',
  covers: covers('sheetbase.contract.import_odcs'),
  description:
    'Propose importing a data contract from an Open Data Contract Standard document onto a measurement table or a record type.',
  schema: importSchema,
  async build(input, { client }) {
    const home = await resolveHome(client, input)

    if (!home.ok) return home

    return ok({
      target: home.value.name,
      deepLink: contractHref({
        dataset_schema_id: home.value.schemaId,
        record_model_key: home.value.modelKey,
      }),
      changes: [changed('Contract imported onto', null, home.value.name)],
      rpc: 'import_data_contract_odcs',
      args: {
        p_odcs: input.odcs,
        p_dataset_schema_id: home.value.schemaId,
        p_record_model_key: home.value.modelKey,
      },
    })
  },
})

// ---------------------------------------------------------------------------

const removeRuleSchema = cardSchema({
  contract: contractRef,
  rule: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'The rule, by its ID or by its field (such as “od600”) or kind (such as “freshness”).',
    ),
})

const ruleRow = z.looseObject({
  id: z.string(),
  kind: z.string().optional(),
  field: z.string().nullish(),
  mode: z.string().optional(),
})

const removeRule = rpcCard({
  tool: 'sheetbase.contract.remove_rule',
  covers: covers('sheetbase.contract.remove_rule'),
  description:
    'Propose removing one rule from a data contract. It makes a new version of the contract.',
  schema: removeRuleSchema,
  async build(input, { client }) {
    const found = await findContract(client, input.contract)

    if (!found.ok) return found
    const rules = z.array(ruleRow).safeParse(found.value.rules)

    if (!rules.success)
      return fail(`${found.value.name}’s rules could not be read.`)

    const matches = rules.data.filter(
      (rule) =>
        same(rule.id, input.rule) ||
        same(rule.field ?? '', input.rule) ||
        same(rule.kind ?? '', input.rule),
    )

    const exact = matches.filter((rule) => same(rule.id, input.rule))
    const [only, ...others] = exact.length === 1 ? exact : matches

    if (!only) return fail(`${found.value.name} has no rule “${input.rule}”.`)

    if (others.length > 0) {
      return fail(
        `More than one rule matches “${input.rule}”: ${[only, ...others].map((rule) => `${rule.id} (${rule.kind ?? 'rule'}${rule.field ? ` ${rule.field}` : ''})`).join(', ')}. Ask the person which one.`,
      )
    }

    return ok({
      target: found.value.name,
      deepLink: contractHref(found.value),
      changes: [
        changed(
          `${only.kind ?? 'Rule'}${only.field ? ` on ${only.field}` : ''}`,
          only.mode ?? 'In place',
          'Removed',
        ),
      ],
      rpc: 'remove_contract_rule',
      args: { p_contract_id: found.value.id, p_rule_id: only.id },
    })
  },
})

// ---------------------------------------------------------------------------

interface FoundTarget {
  id: string
  name: string
  endpoint_url: string
  namespace: string
  auth_header_name: string
  enabled: boolean
}

async function findTarget(
  client: DataClient,
  wanted: string,
): Promise<Lookup<FoundTarget>> {
  const rows = await client.list<FoundTarget>(
    'lineage_targets',
    `?name=ilike.${likeValue(wanted)}&select=id,name,endpoint_url,namespace,auth_header_name,enabled&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'lineage target',
    (row) => row.name,
    (row) => same(row.name, wanted),
  )
}

const targetRef = z
  .string()
  .min(1)
  .max(80)
  .describe('The lineage target, by its name.')

const saveTargetSchema = cardSchema({
  name: z
    .string()
    .min(1)
    .max(80)
    .describe('The target’s name. An existing one is changed.'),
  endpointUrl: z
    .string()
    .url()
    .max(500)
    .optional()
    .describe(
      'Where lineage events are sent (http or https). Needed for a new target.',
    ),
  namespace: z.string().max(100).optional(),
  authHeaderName: z.string().max(100).optional(),
  enabled: z.boolean().optional().describe('true starts sending events.'),
})

const saveTarget = rpcCard({
  tool: 'sheetbase.lineage.save_target',
  covers: covers('sheetbase.lineage.save_target'),
  description:
    'Propose setting up or changing a lineage target: an endpoint that receives OpenLineage events. A secret for it is never set here; the person adds it in Settings > Integrations.',
  schema: saveTargetSchema,
  async build(input, { client, workspaceId }) {
    const existing = await findTarget(client, input.name)

    const current =
      existing.ok && same(existing.value.name, input.name)
        ? existing.value
        : null

    const url = input.endpointUrl ?? current?.endpoint_url

    if (!url)
      return fail('A new lineage target needs the endpoint URL to send to.')

    const enabled = input.enabled ?? current?.enabled ?? false

    return ok({
      target: input.name,
      deepLink: '/settings/integrations',
      changes: [
        changed(
          current ? 'Target' : 'New target',
          current?.endpoint_url ?? null,
          url,
        ),
        changed(
          'Sending',
          current ? (current.enabled ? 'On' : 'Off') : null,
          enabled ? 'On' : 'Off',
        ),
      ],
      rpc: 'save_lineage_target',
      args: {
        p_workspace_id: workspaceId,
        p_id: current?.id ?? null,
        p_name: input.name,
        p_endpoint_url: url,
        p_namespace: input.namespace ?? current?.namespace ?? 'sheetbase',
        p_auth_header_name:
          input.authHeaderName ?? current?.auth_header_name ?? 'Authorization',
        p_enabled: enabled,
      },
    })
  },
})

const deleteTargetSchema = cardSchema({ target: targetRef })

const deleteTarget = rpcCard({
  tool: 'sheetbase.lineage.delete_target',
  covers: covers('sheetbase.lineage.delete_target'),
  description: 'Propose deleting a lineage target and its waiting deliveries.',
  schema: deleteTargetSchema,
  async build(input, { client }) {
    const found = await findTarget(client, input.target)

    if (!found.ok) return found

    return ok({
      target: found.value.name,
      deepLink: '/settings/integrations',
      changes: [changed('Lineage target', found.value.endpoint_url, 'Deleted')],
      rpc: 'delete_lineage_target',
      args: { p_id: found.value.id },
    })
  },
})

const retrySchema = cardSchema({ target: targetRef })

const retry = rpcCard({
  tool: 'sheetbase.lineage.retry',
  covers: covers('sheetbase.lineage.retry'),
  description: 'Propose sending a lineage target’s failed deliveries again.',
  schema: retrySchema,
  async build(input, { client }) {
    const found = await findTarget(client, input.target)

    if (!found.ok) return found

    return ok({
      target: found.value.name,
      deepLink: '/settings/integrations',
      changes: [changed('Failed deliveries', 'Waiting', 'Sent again')],
      rpc: 'retry_lineage_deliveries',
      args: { p_target_id: found.value.id },
    })
  },
})

export const CONTRACT_CARD_SPECS: readonly RpcCard[] = [
  save,
  deleteContract,
  importOdcs,
  removeRule,
  saveTarget,
  deleteTarget,
  retry,
]
