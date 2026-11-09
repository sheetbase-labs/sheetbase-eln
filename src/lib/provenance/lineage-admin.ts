/**
 * Settings > Integrations: where lineage events go, plus how long the event
 * stream keeps what it has recorded. Every function needs `integrations.manage`;
 * the RPCs behind them check the same thing again. The header value is sealed
 * here and never sent back to anyone.
 */
import { createServerFn } from '@tanstack/react-start'

import { requireCapability } from '#/lib/admin-platform'

export interface LineageTargetWire {
  id: string
  name: string
  endpointUrl: string
  namespace: string
  authHeaderName: string
  hasSecret: boolean
  enabled: boolean
  pending: number
  failed: number
  lastTestAt: string | null
  lastTestOk: boolean | null
  lastTestMessage: string | null
}

export interface LineageSettingsWire {
  targets: LineageTargetWire[]
  retentionDays: number
}

export const lineageAdminKeys = {
  settings: (workspaceId: string) =>
    ['provenance', 'lineage-settings', workspaceId] as const,
}

export const listLineageSettingsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<LineageSettingsWire> => {
    const session = await requireCapability(
      data.workspaceId,
      'settings.integrations.view',
    )

    try {
      const { rows } = await session.client.query(
        `SELECT t.id, t.name, t.endpoint_url, t.namespace, t.auth_header_name,
                t.has_secret, t.enabled, t.last_test_at::text AS last_test_at,
                t.last_test_ok, t.last_test_message,
                count(d.*) FILTER (WHERE d.status = 'pending')::int AS pending,
                count(d.*) FILTER (WHERE d.status = 'failed')::int AS failed
           FROM api.lineage_targets t
           LEFT JOIN api.lineage_deliveries d ON d.target_id = t.id
          WHERE t.workspace_id = $1::uuid
          GROUP BY t.id
          ORDER BY lower(t.name)`,
        [data.workspaceId],
      )

      const retention = await session.client.query(
        `SELECT event_stream_retention_days AS days
           FROM api.workspace_settings WHERE workspace_id = $1::uuid`,
        [data.workspaceId],
      )

      return {
        retentionDays: Number(retention.rows[0]?.days ?? 30),
        targets: rows.map((row: Record<string, unknown>) => ({
          id: String(row.id),
          name: String(row.name),
          endpointUrl: String(row.endpoint_url),
          namespace: String(row.namespace),
          authHeaderName: String(row.auth_header_name),
          hasSecret: Boolean(row.has_secret),
          enabled: Boolean(row.enabled),
          pending: Number(row.pending ?? 0),
          failed: Number(row.failed ?? 0),
          lastTestAt: row.last_test_at ? String(row.last_test_at) : null,
          lastTestOk:
            row.last_test_ok == null ? null : Boolean(row.last_test_ok),
          lastTestMessage: row.last_test_message
            ? String(row.last_test_message)
            : null,
        })),
      }
    } finally {
      await session.release()
    }
  })

export interface SaveLineageTargetInput {
  workspaceId: string
  id: string | null
  name: string
  endpointUrl: string
  namespace: string
  authHeaderName: string
  /** Blank keeps what is stored. */
  headerValue: string
  enabled: boolean
}

export const saveLineageTargetFn = createServerFn({ method: 'POST' })
  .validator((input: SaveLineageTargetInput) => input)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )

    try {
      const { rows } = await session.client.query(
        `SELECT id FROM api.save_lineage_target($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
        [
          data.workspaceId,
          data.id,
          data.name.trim(),
          data.endpointUrl.trim(),
          data.namespace.trim() || 'sheetbase',
          data.authHeaderName.trim() || 'Authorization',
          data.enabled,
        ],
      )

      const id = String(rows[0].id)

      if (data.headerValue.trim()) {
        const { sealSecret, secretKey } =
          await import('#/lib/connector-secrets.server')

        await session.client.query(
          `SELECT id FROM api.set_lineage_target_secret($1::uuid, $2)`,
          [id, sealSecret(data.headerValue.trim(), secretKey())],
        )
      }

      return { id }
    } finally {
      await session.release()
    }
  })

export const deleteLineageTargetFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; id: string }) => input)
  .handler(async ({ data }) => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )

    try {
      await session.client.query(`SELECT api.delete_lineage_target($1::uuid)`, [
        data.id,
      ])

      return { ok: true }
    } finally {
      await session.release()
    }
  })

export const retryLineageDeliveriesFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; id: string }) => input)
  .handler(async ({ data }): Promise<{ requeued: number }> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )

    try {
      const { rows } = await session.client.query(
        `SELECT api.retry_lineage_deliveries($1::uuid) AS n`,
        [data.id],
      )

      return { requeued: Number(rows[0]?.n ?? 0) }
    } finally {
      await session.release()
    }
  })

export const setEventStreamRetentionFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; days: number }) => input)
  .handler(async ({ data }): Promise<{ days: number }> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )

    try {
      const { rows } = await session.client.query(
        `SELECT api.set_event_stream_retention($1::uuid, $2::int) AS days`,
        [data.workspaceId, Math.round(data.days)],
      )

      return { days: Number(rows[0]?.days) }
    } finally {
      await session.release()
    }
  })

/** Send one sample event so the person can see the endpoint answers. */
export const testLineageTargetFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; id: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const session = await requireCapability(
      data.workspaceId,
      'integrations.manage',
    )

    try {
      const { db } = await import('#/db/client.server')
      const { sql } = await import('drizzle-orm')

      const result = await db.execute(sql`
        SELECT t.endpoint_url, t.auth_header_name, t.namespace, s.sealed
          FROM api.lineage_targets t
          LEFT JOIN internal.lineage_target_secrets s ON s.target_id = t.id
         WHERE t.id = ${data.id}::uuid AND t.workspace_id = ${data.workspaceId}::uuid`)

      const target = result.rows[0] as
        | {
            endpoint_url: string
            auth_header_name: string
            namespace: string
            sealed: string | null
          }
        | undefined

      if (!target) throw new Error('That endpoint no longer exists.')
      const { buildRunEvent } = await import('./openlineage')
      const { sendToTarget } = await import('./lineage-emitter.server')
      const { env } = await import('#/env.server')
      const now = new Date().toISOString()

      const event = buildRunEvent(
        {
          eventType: 'COMPLETE',
          eventTime: now,
          runId: crypto.randomUUID(),
          jobName: 'sheetbase.test-send',
          jobType: 'PIPELINE',
          inputs: [],
          outputs: [],
        },
        target.namespace,
        env.SHEETBASE_ARTIFACT_VERSION,
      )

      let ok = false
      let message: string

      try {
        const status = await sendToTarget(target, target.sealed, event)
        ok = status >= 200 && status < 300
        message = `The service answered ${status}.`
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }

      await session.client.query(
        `SELECT api.record_lineage_test($1::uuid, $2, $3)`,
        [data.id, ok, message.slice(0, 300)],
      )

      return { ok, message }
    } finally {
      await session.release()
    }
  })
