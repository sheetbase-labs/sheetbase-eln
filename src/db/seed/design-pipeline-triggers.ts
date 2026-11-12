/**
 * The Triggers and outputs board for PL-0007: a draft v2 that keeps nothing,
 * proposes a figure block for a person to accept, and tells a Teams channel;
 * plus a trigger that starts the pipeline when DS-0311 gets a new snapshot.
 * Idempotent: it does nothing once the draft and trigger exist.
 */
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { core } from 'zod'

import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

/** An ELN action or notify step; this board replaces those of the published version. */
const effectStep = z.looseObject({ kind: z.enum(['action', 'notify']) })

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const EXP_0142 = '00000000-0000-4000-8000-000000000351'

export async function seedDesignPipelineTriggers(db: Db): Promise<void> {
  const { rows: defs } = await db.execute<{ id: string }>(
    sql`select id from api.pipeline_definitions where workspace_id = ${PROCESS} and key = 'clarification_step_yield'`,
  )

  const definitionId = defs[0]?.id

  if (!definitionId) return

  // The Teams destination the notification table names.
  await db.execute(sql`
    insert into api.webhook_subscriptions (workspace_id, key, description, url, event_types, status)
    select ${PROCESS}, 'aav9-process-teams', 'Teams · #aav9-process',
           'https://example.webhook.office.com/aav9-process', '[]'::jsonb, 'active'
    where not exists (select 1 from api.webhook_subscriptions where workspace_id = ${PROCESS} and key = 'aav9-process-teams')`)

  const { rows: subs } = await db.execute<{ id: string }>(
    sql`select id from api.webhook_subscriptions where workspace_id = ${PROCESS} and key = 'aav9-process-teams'`,
  )

  const subscriptionId = subs[0]?.id

  const { rows: all } = await db.execute<{
    id: string
    lifecycle: string
    configuration: Record<string, core.util.JSONType>
  }>(
    sql`select id, lifecycle, configuration from api.pipeline_definition_versions where definition_id = ${definitionId} order by version`,
  )

  const published = all.find((v) => v.lifecycle === 'published')

  if (published && !all.some((v) => v.lifecycle === 'draft')) {
    const stored = published.configuration

    const kept = Array.isArray(stored.steps)
      ? stored.steps.filter((step) => !effectStep.safeParse(step).success)
      : []

    const configuration = {
      ...stored,
      output: {
        mode: 'none',
        datasetLabel: 'pipeline output',
      },
      steps: [
        ...kept,
        {
          name: 'propose_figure',
          kind: 'action',
          action: {
            operation: 'insert_block',
            mode: 'propose',
            arguments: {
              p_record_id: EXP_0142,
              p_type: 'figure',
              p_payload: {},
            },
          },
        },
        ...(subscriptionId
          ? [{ name: 'tell_teams', kind: 'notify', notify: { subscriptionId } }]
          : []),
      ],
    }

    await withDesignClaims(db, GARETH, PROCESS, async (client) => {
      await client.query(
        'select * from api.create_pipeline_definition_version($1,$2,$3::jsonb)',
        [PROCESS, definitionId, JSON.stringify(configuration)],
      )
    })
  }

  const { rows: events } = await db.execute(
    sql`select 1 from api.pipeline_schedules where definition_id = ${definitionId} and kind = 'event' limit 1`,
  )

  if (events.length === 0) {
    const { rows: ds } = await db.execute<{ id: string }>(
      sql`select id from api.datasets where workspace_id = ${PROCESS} and display_id = 'DS-0311' limit 1`,
    )

    const datasetId = ds[0]?.id

    if (datasetId) {
      await withDesignClaims(db, GARETH, PROCESS, async (client) => {
        await client.query(
          `select api.create_pipeline_schedule($1,$2,'event',$3::jsonb,true)`,
          [
            PROCESS,
            definitionId,
            JSON.stringify({ eventType: 'dataset.versioned', datasetId }),
          ],
        )
      })
    }
  }
}
