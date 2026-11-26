import {
  findExperiment,
  instrumentLabel,
  likeValue,
  resolveInstrument,
} from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { findProject } from '#/lib/assistant-labwork.server'
import { findPipeline } from '#/lib/assistant-pipelines.server'
import type { RpcArgument } from '#/lib/assistant-call-cards'
import {
  buildCard,
  cardDefs,
  cardSpec,
} from '#/lib/assistant-call-cards.server'
import type { CardBuilt } from '#/lib/assistant-call-cards.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import { WATCHER_KINDS } from '#/lib/lab-watchers'
import { proposalReference } from '#/lib/scheduler'

import { AUTOMATION_ADMIN_CARDS, automationAdminSchemas } from './cards'
import type {
  AutomationAdminKind,
  AutomationAdminProposeToolName,
} from './cards'

/**
 * The automation cards (see `cards.ts`). Each builder finds what the model
 * named under the signed-in person's own access and returns a card that says
 * exactly what will change. Nothing is written here.
 */

const S = automationAdminSchemas
const C = AUTOMATION_ADMIN_CARDS

const quote = (text: string) => encodeURIComponent(text)

const norm = (text: string) => text.trim().toLowerCase()

const some = <T>(
  value: T | null | undefined,
): value is Exclude<T, null | undefined> =>
  value !== null && value !== undefined

const add = (label: string, after: string | number | null | undefined) =>
  some(after) && after !== ''
    ? [{ label, before: null, after: String(after) }]
    : []

/** Only the arguments the person actually gave, so the database keeps the rest. */
function given(params: Readonly<Record<string, RpcArgument | undefined>>) {
  const out: Record<string, RpcArgument> = {}

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) out[name] = value
  }

  return out
}

const built = (
  target: string,
  changes: CardBuilt['changes'],
  params: CardBuilt['params'],
  openHref: string | null,
): CardBuilt => ({ target, changes, params, openHref })

const PIPELINES = '/pipelines'
const WEBHOOKS = '/settings/workspace/integrations'

async function findRow<TRow>(
  context: LabToolContext,
  table: string,
  query: string,
  what: string,
  wanted: string,
  label: (row: TRow) => string,
  names: (row: TRow) => readonly (string | null)[],
): Promise<Lookup<TRow>> {
  const rows = await context.client.list<TRow>(table, query)
  const lower = norm(wanted)

  return pick(rows, wanted, what, label, (row) =>
    names(row).some((name) => name !== null && norm(name) === lower),
  )
}

interface VersionRow {
  id: string
  version: number
  lifecycle: string
}

async function findVersion(
  context: LabToolContext,
  definitionId: string,
  name: string,
  version: number | undefined,
): Promise<Lookup<VersionRow>> {
  const rows = await context.client.list<VersionRow>(
    'pipeline_definition_versions',
    `?definition_id=eq.${quote(definitionId)}&lifecycle=${version ? 'neq.retired' : 'eq.published'}${version ? `&version=eq.${version}` : ''}&select=id,version,lifecycle&order=version.desc&limit=6`,
  )

  return pick(
    rows,
    version ? `version ${version}` : name,
    `${version ? '' : 'published '}version of ${name}`,
    (row) => `v${row.version} (${row.lifecycle})`,
    (row) => row.version === version,
  )
}

interface SubscriptionRow {
  id: string
  key: string
  description: string | null
  url: string | null
  status: string
  event_types: string[] | null
  max_retries: number
  failure_threshold: number
  rate_limit_per_minute: number | null
}

async function findWebhook(
  context: LabToolContext,
  text: string,
): Promise<Lookup<SubscriptionRow>> {
  const like = likeValue(text)

  return findRow<SubscriptionRow>(
    context,
    'webhook_subscriptions',
    `?status=neq.archived&or=(key.ilike.${like},description.ilike.${like},url.ilike.${like})&select=id,key,description,url,status,event_types,max_retries,failure_threshold,rate_limit_per_minute&order=key.asc&limit=6`,
    'webhook',
    text,
    (row) => row.description ?? row.key,
    (row) => [row.key, row.description, row.url],
  )
}

const webhookLabel = (row: SubscriptionRow) =>
  `${row.description ?? row.key} (${row.key})`

interface SearchRow {
  id: string
  name: string
  visibility: string
}

async function findSearch(
  context: LabToolContext,
  text: string,
): Promise<Lookup<SearchRow>> {
  return findRow<SearchRow>(
    context,
    'saved_searches',
    `?user_id=eq.${quote(context.userId)}&name=ilike.${likeValue(text)}&select=id,name,visibility&order=name.asc&limit=6`,
    'saved search of yours',
    text,
    (row) => row.name,
    (row) => [row.name],
  )
}

const specs = [
  cardSpec({
    tool: C['pipeline.version_retire'].tool,
    kind: 'pipeline.version_retire' as const,
    description:
      'Propose retiring one version of a pipeline, so it can no longer be run. To retire the whole pipeline, use the pipeline retire tool.',
    schema: S.versionRetire,
    build: async (input, context) => {
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return found.message
      const target = found.value.name

      const version = await findVersion(
        context,
        found.value.id,
        target,
        input.version,
      )

      if (!version.ok) return version.message

      return built(
        `${target} · v${version.value.version}`,
        [
          {
            label: 'Version',
            before: version.value.lifecycle,
            after: 'Retired',
          },
        ],
        {
          p_workspace_id: context.workspaceId,
          p_version_id: version.value.id,
        },
        `${PIPELINES}/${found.value.id}/steps`,
      )
    },
  }),
  cardSpec({
    tool: C['pipeline.run_remind'].tool,
    kind: 'pipeline.run_remind' as const,
    description:
      'Propose reminding the person a pipeline run is waiting on, by sending them an Inbox notice. Only for a run that is waiting for someone to answer.',
    schema: S.runRemind,
    build: async (input, context) => {
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return found.message

      const versions = await context.client.list<{ id: string }>(
        'pipeline_definition_versions',
        `?definition_id=eq.${quote(found.value.id)}&select=id&limit=500`,
      )

      const runs =
        versions.length === 0
          ? []
          : await context.client.list<{ id: string; started_at: string }>(
              'pipeline_runs',
              `?definition_version_id=in.(${versions.map((v) => v.id).join(',')})&status=eq.waiting&select=id,started_at&order=started_at.desc&limit=1`,
            )

      const run = runs.at(0)

      if (!run) return `${found.value.name} has no run waiting for anyone.`

      return built(
        found.value.name,
        [
          {
            label: 'Waiting run',
            before: null,
            after: 'Remind who it is waiting on',
          },
        ],
        { p_workspace_id: context.workspaceId, p_run_id: run.id },
        `${PIPELINES}/${found.value.id}/runs/${run.id}`,
      )
    },
  }),
  cardSpec({
    tool: C['recurring.create'].tool,
    kind: 'recurring.create' as const,
    description:
      'Propose setting up repeating work: an instrument booked again and again, or an experiment started from a template again and again. A repeat always ends: give an end date or a number of times (not needed for offsets). To pause or end one that exists, use the repeat tools.',
    schema: S.recurring,
    build: async (input, context) => {
      if (input.frequency === 'weekly' && !input.weekdays?.length)
        return 'A weekly repeat needs the days of the week.'

      if (input.frequency === 'offsets' && !input.offsetsDays?.length)
        return 'A repeat on set days needs the days after the start, such as 0, 7, 14.'

      if (
        input.frequency !== 'offsets' &&
        !input.endsOn &&
        !input.maxOccurrences
      )
        return 'A repeat needs an end date or a number of times.'

      const changes: CardBuilt['changes'] = [
        { label: 'Repeats', before: null, after: input.name.trim() },
        ...add('How often', describeFrequency(input)),
        ...add('From', input.startsOn),
        ...add('Until', input.endsOn),
        ...add('Times', input.maxOccurrences),
      ]

      let resourceId: string | undefined
      let templateId: string | undefined
      let projectId: string | undefined

      if (input.kind === 'booking') {
        if (!input.instrument || !input.startTime || !input.endTime)
          return 'A repeating booking needs the instrument and the start and end times.'

        if (input.endTime <= input.startTime)
          return 'The end time must be after the start time.'

        if (input.frequency === 'offsets')
          return 'A repeating booking cannot be on set days after a start; use daily, weekly or monthly.'

        const instrument = await resolveInstrument(
          context.client,
          context.workspaceId,
          input.instrument,
        )

        if (!instrument.ok) return instrument.message
        resourceId = instrument.instrument.id

        changes.push(
          ...add('Instrument', instrumentLabel(instrument.instrument)),
          ...add('Time', `${input.startTime} to ${input.endTime}`),
        )
      } else {
        if (!input.template || !input.project)
          return 'A repeating experiment needs a template and a project.'

        const [template, project] = await Promise.all([
          findRow<{
            id: string
            name: string
            display_id: string | null
          }>(
            context,
            'notebook_templates',
            `?lifecycle=eq.active&or=(key.ilike.${likeValue(input.template)},name.ilike.${likeValue(input.template)},display_id.ilike.${likeValue(input.template)})&select=id,name,display_id&order=name.asc&limit=6`,
            'template',
            input.template,
            (row) =>
              `${row.name}${row.display_id ? ` (${row.display_id})` : ''}`,
            (row) => [row.name, row.display_id],
          ),
          findProject(context.client, input.project),
        ])

        if (!template.ok) return template.message

        if (!project.ok) return project.message
        templateId = template.value.id
        projectId = project.value.id

        changes.push(
          ...add('Template', template.value.name),
          ...add('Project', project.value.title),
        )
      }

      if (input.kind === 'booking' && input.project) {
        const project = await findProject(context.client, input.project)

        if (!project.ok) return project.message
        projectId = project.value.id
        changes.push(...add('Project', project.value.title))
      }

      return built(
        input.name.trim(),
        changes,
        given({
          p_kind: input.kind,
          p_title: input.name.trim(),
          p_frequency: input.frequency,
          p_starts_on: input.startsOn,
          p_timezone: context.timeZone,
          p_interval_count: input.every ?? 1,
          p_weekdays: input.weekdays,
          p_offsets_days: input.offsetsDays,
          p_ends_on: input.endsOn,
          p_max_occurrences: input.maxOccurrences,
          p_resource_id: resourceId,
          p_start_time: input.startTime,
          p_end_time: input.endTime,
          p_notebook_template_id: templateId,
          p_lead_days: input.leadDays ?? 0,
          p_project_id: projectId,
          p_notes: input.notes,
        }),
        '/calendar',
      )
    },
  }),
  cardSpec({
    tool: C['search.update'].tool,
    kind: 'search.update' as const,
    description:
      'Propose renaming one of the person’s saved searches, or sharing it with the lab or making it private.',
    schema: S.searchUpdate,
    build: async (input, context) => {
      if (!input.name && !input.visibility)
        return 'Say what to change: a new name or who can see it.'

      const found = await findSearch(context, input.search)

      if (!found.ok) return found.message

      return built(
        found.value.name,
        [
          ...(input.name
            ? [
                {
                  label: 'Name',
                  before: found.value.name,
                  after: input.name.trim(),
                },
              ]
            : []),
          ...(input.visibility
            ? [
                {
                  label: 'Seen by',
                  before: seenBy(found.value.visibility),
                  after: seenBy(input.visibility),
                },
              ]
            : []),
        ],
        given({
          p_id: found.value.id,
          p_name: input.name?.trim(),
          p_visibility: input.visibility,
        }),
        '/search',
      )
    },
  }),
  cardSpec({
    tool: C['search.delete'].tool,
    kind: 'search.delete' as const,
    description: 'Propose deleting one of the person’s saved searches.',
    schema: S.searchDelete,
    build: async (input, context) => {
      const found = await findSearch(context, input.search)

      if (!found.ok) return found.message

      return built(
        found.value.name,
        [{ label: 'Saved search', before: 'Kept', after: 'Deleted' }],
        { p_id: found.value.id },
        '/search',
      )
    },
  }),
  cardSpec({
    tool: C['webhook.update'].tool,
    kind: 'webhook.update' as const,
    description:
      'Propose changing a webhook: its address, the events it hears about, its description, whether it is on, or how it retries. For people who manage integrations.',
    schema: S.webhookUpdate,
    build: async (input, context) => {
      const found = await findWebhook(context, input.webhook)

      if (!found.ok) return found.message
      const row = found.value

      const changes: CardBuilt['changes'] = [
        ...diff('Address', row.url, input.url),
        ...diff('Description', row.description, input.description),
        ...diff('Status', row.status, input.status),
        ...diff('Retries', row.max_retries, input.maxRetries),
        ...diff(
          'Gives up after failures',
          row.failure_threshold,
          input.failureThreshold,
        ),
        ...diff(
          'Per minute',
          row.rate_limit_per_minute,
          input.rateLimitPerMinute,
        ),
        ...(input.eventTypes
          ? [
              {
                label: 'Events',
                before: `${row.event_types?.length ?? 0} events`,
                after: input.eventTypes.join(', ') || 'none',
              },
            ]
          : []),
      ]

      if (changes.length === 0) return 'Say what to change about the webhook.'

      return built(
        webhookLabel(row),
        changes,
        given({
          p_workspace_id: context.workspaceId,
          p_subscription_id: row.id,
          p_url: input.url,
          p_event_types: input.eventTypes,
          p_description: input.description,
          p_status: input.status,
          p_max_retries: input.maxRetries,
          p_failure_threshold: input.failureThreshold,
          p_rate_limit_per_minute: input.rateLimitPerMinute,
        }),
        WEBHOOKS,
      )
    },
  }),
  cardSpec({
    tool: C['webhook.delete'].tool,
    kind: 'webhook.delete' as const,
    description:
      'Propose deleting a webhook, so nothing is sent to it any more. For people who manage integrations.',
    schema: S.webhookDelete,
    build: async (input, context) => {
      const found = await findWebhook(context, input.webhook)

      if (!found.ok) return found.message

      return built(
        webhookLabel(found.value),
        [{ label: 'Webhook', before: found.value.status, after: 'Deleted' }],
        {
          p_workspace_id: context.workspaceId,
          p_subscription_id: found.value.id,
        },
        WEBHOOKS,
      )
    },
  }),
  cardSpec({
    tool: C['webhook.replay_delivery'].tool,
    kind: 'webhook.replay_delivery' as const,
    description:
      'Propose sending one webhook delivery again, usually one that gave up. To send several, use the replay-many tool.',
    schema: S.replayDelivery,
    build: async (input, context) => {
      const hook = await findWebhook(context, input.webhook)

      if (!hook.ok) return hook.message

      const rows = await context.client.list<{
        id: string
        event_type: string
        created_at: string
      }>(
        'webhook_deliveries',
        `?subscription_id=eq.${quote(hook.value.id)}&status=eq.${input.status}${input.event ? `&event_type=eq.${quote(input.event)}` : ''}&select=id,event_type,created_at&order=created_at.desc&limit=6`,
      )

      const found = pick(
        rows,
        webhookLabel(hook.value),
        `${input.status.replace('_', ' ')} delivery`,
        (row) => `${row.event_type} at ${row.created_at.slice(0, 16)}`,
        () => false,
      )

      if (!found.ok) return found.message

      return built(
        webhookLabel(hook.value),
        [
          {
            label: 'Send again',
            before: input.status.replace('_', ' '),
            after: `${found.value.event_type} at ${found.value.created_at.slice(0, 16)}`,
          },
        ],
        {
          p_workspace_id: context.workspaceId,
          p_delivery_id: found.value.id,
        },
        WEBHOOKS,
      )
    },
  }),
  cardSpec({
    tool: C['webhook.replay_deliveries'].tool,
    kind: 'webhook.replay_deliveries' as const,
    description:
      'Propose sending many webhook deliveries again, for one webhook or all, such as everything that gave up since a date.',
    schema: S.replayDeliveries,
    build: async (input, context) => {
      let subscriptionId: string | undefined
      let target = 'All webhooks'

      if (input.webhook) {
        const hook = await findWebhook(context, input.webhook)

        if (!hook.ok) return hook.message
        subscriptionId = hook.value.id
        target = webhookLabel(hook.value)
      }

      return built(
        target,
        [
          {
            label: 'Send again',
            before: null,
            after: `up to ${input.limit} that ${input.status === 'dead_letter' ? 'gave up' : input.status}`,
          },
          ...add('Since', input.since),
          ...add('Until', input.until),
        ],
        given({
          p_workspace_id: context.workspaceId,
          p_subscription_id: subscriptionId,
          p_since: input.since ? `${input.since}T00:00:00Z` : undefined,
          p_until: input.until ? `${input.until}T23:59:59Z` : undefined,
          p_status: input.status,
          p_limit: input.limit,
        }),
        WEBHOOKS,
      )
    },
  }),
  cardSpec({
    tool: C['schedule.request_proposal'].tool,
    kind: 'schedule.request_proposal' as const,
    description:
      'Propose asking the scheduler to plan the bookings for an experiment’s parts. Nothing is booked until a person accepts the plan.',
    schema: S.scheduleRequest,
    build: async (input, context) => {
      const found = await findExperiment(context.client, input.experiment)

      if ('message' in found) return found.message

      return built(
        `${found.identifier} · ${found.title}`,
        [
          {
            label: input.reason === 'slip' ? 'Re-plan' : 'Plan',
            before: null,
            after: 'Ask the scheduler for a plan',
          },
        ],
        { p_record_id: found.id, p_reason: input.reason },
        `/experiments/${found.id}`,
      )
    },
  }),
  cardSpec({
    tool: C['schedule.dismiss_proposal'].tool,
    kind: 'schedule.dismiss_proposal' as const,
    description:
      'Propose dismissing the scheduler’s plan for an experiment without accepting it.',
    schema: S.scheduleDismiss,
    build: async (input, context) => {
      const found = await findExperiment(context.client, input.experiment)

      if ('message' in found) return found.message

      const proposals = await context.client.list<{
        id: string
        number: number
      }>(
        'schedule_proposals',
        `?record_id=eq.${quote(found.id)}&status=eq.proposed&select=id,number&order=created_at.desc&limit=1`,
      )

      const proposal = proposals.at(0)

      if (!proposal)
        return `${found.identifier} has no plan waiting to be accepted.`

      return built(
        `${found.identifier} · ${found.title}`,
        [
          {
            label: 'Plan',
            before: proposalReference(proposal.number),
            after: 'Dismissed',
          },
        ],
        { p_proposal_id: proposal.id },
        `/experiments/${found.id}`,
      )
    },
  }),
  cardSpec({
    tool: C['watcher.run'].tool,
    kind: 'watcher.run' as const,
    description:
      'Propose running one of the lab’s watchers right now instead of waiting for its schedule. Findings go to the Inbox of the person who turned it on.',
    schema: S.watcherRun,
    build: async (input, context) => {
      const wanted = squash(input.watcher)

      const rows = await context.client.list<{
        id: string
        kind: string
        enabled: boolean
      }>('lab_watchers', `?select=id,kind,enabled&order=kind.asc&limit=50`)

      const matches = rows.filter(
        (row) =>
          contains(squash(row.kind), wanted) ||
          contains(wanted, squash(row.kind)),
      )

      const found = pick(
        matches,
        input.watcher,
        `watcher (${WATCHER_KINDS.map((kind) => kind.replaceAll('_', ' ')).join(', ')})`,
        (row) => row.kind.replaceAll('_', ' '),
        (row) => squash(row.kind) === wanted,
      )

      if (!found.ok) return found.message

      return built(
        found.value.kind.replaceAll('_', ' '),
        [{ label: 'Watcher', before: null, after: 'Run now' }],
        { p_watcher_id: found.value.id },
        '/account/watchers',
      )
    },
  }),
  cardSpec({
    tool: C['events.retention'].tool,
    kind: 'events.retention' as const,
    description:
      'Propose how many days the lab keeps its event stream, the history that webhooks and pipelines draw on. For people who manage integrations.',
    schema: S.retention,
    build: async (input, context) => {
      const before = await context.client
        .list<{ event_stream_retention_days: number | null }>(
          'workspace_settings',
          `?workspace_id=eq.${quote(context.workspaceId)}&select=event_stream_retention_days&limit=1`,
        )
        .catch(() => [])

      return built(
        'Event stream',
        [
          {
            label: 'Kept for',
            before: some(before.at(0)?.event_stream_retention_days)
              ? `${before[0].event_stream_retention_days} days`
              : null,
            after: `${input.days} days`,
          },
        ],
        { p_workspace_id: context.workspaceId, p_days: input.days },
        WEBHOOKS,
      )
    },
  }),
]

const contains = (text: string, part: string) => text.includes(part)

const squash = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9]/g, '')

const seenBy = (visibility: string) =>
  visibility === 'workspace' ? 'Everyone in the lab' : 'Only you'

function diff(
  label: string,
  before: string | number | null,
  after: string | number | undefined,
): CardBuilt['changes'] {
  return after === undefined
    ? []
    : [
        {
          label,
          before: before === null ? null : String(before),
          after: String(after),
        },
      ]
}

function describeFrequency(input: {
  frequency: string
  every?: number
  weekdays?: number[]
  offsetsDays?: number[]
}): string {
  const every = input.every ?? 1
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  switch (input.frequency) {
    case 'daily':
      return every === 1 ? 'Every day' : `Every ${every} days`
    case 'weekly':
      return `${every === 1 ? 'Every week' : `Every ${every} weeks`} on ${(input.weekdays ?? []).map((d) => days[d - 1]).join(', ')}`
    case 'monthly':
      return every === 1 ? 'Every month' : `Every ${every} months`
    default:
      return `On days ${(input.offsetsDays ?? []).join(', ')} after the start`
  }
}

export function isAutomationAdminProposalTool(
  name: string,
): name is AutomationAdminProposeToolName {
  return specs.some((spec) => spec.tool === name)
}

export const automationAdminProposalDefs = () => cardDefs(specs)

export const buildAutomationAdminProposal = (
  name: AutomationAdminProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; each spec parses them with its own schema before reading a field.
  args: unknown,
  context: LabToolContext,
) =>
  buildCard<AutomationAdminProposeToolName, AutomationAdminKind>(
    specs,
    name,
    args,
    context,
  )
