/**
 * POST /api/plugins/publish-dataset: send a dataset's rows to another system
 * with a plugin publisher, as the signed-in person. The server reads the rows
 * (through the same row-level security as the rest of the app, so a dataset the
 * person can't open looks like a missing one) and hands them to the plugin;
 * the browser never carries them. An export receipt records what was sent.
 * Server-only.
 */
import { z } from 'zod'

import { loadDatasetFields, pagedRows } from '../export/routes'
import {
  postgrestSelect,
  realSessionAuthDeps,
  recordDataExportReceipt,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { runExtensionPublisher } from './outgoing-runtime.server'

const bodySchema = z
  .object({
    extensionKey: z.string().regex(/^[a-z][a-z0-9-]{0,48}$/),
    publisherId: z.string().regex(/^[a-z][a-z0-9-]{0,48}$/),
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

interface DatasetWire {
  id: string
  workspace_id: string
  name: string
  revision: number | string
  schema_version_id: string
}

export async function handleDatasetPublish(
  request: Request,
  datasetId: string,
  deps: SessionAuthDeps = realSessionAuthDeps,
  publish: typeof runExtensionPublisher = runExtensionPublisher,
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return requestErrorResponse(400, 'bad_request', 'Send a JSON body.')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success)
    return requestErrorResponse(
      400,
      'bad_request',
      'The request could not be read.',
    )
  const body = parsed.data
  // Sending data out is more than reading it: a viewer can't.
  const { db } = await import('#/db/client.server')
  const { sql } = await import('drizzle-orm')
  const membership = (
    await db.execute(
      sql`SELECT role FROM api.workspace_memberships
           WHERE user_id = ${context.userId} AND workspace_id = ${context.workspaceId}::uuid`,
    )
  ).rows[0] as { role: string } | undefined
  if (!membership || membership.role === 'viewer')
    return requestErrorResponse(
      403,
      'forbidden',
      'Sending data out needs a workspace you can edit.',
    )
  const found = await postgrestSelect<DatasetWire[]>(
    'datasets',
    `id=eq.${encodeURIComponent(datasetId)}&select=id,workspace_id,name,revision,schema_version_id&limit=1`,
    context.token,
  )
  if (found.status >= 400)
    return requestErrorResponse(
      502,
      'upstream_error',
      'Could not load dataset.',
    )
  const dataset = Array.isArray(found.body) ? found.body[0] : undefined
  if (!dataset)
    return requestErrorResponse(404, 'not_found', 'Dataset not found.')
  if (dataset.workspace_id !== context.workspaceId)
    return requestErrorResponse(404, 'not_found', 'Dataset not found.')
  const fields = await loadDatasetFields(
    context.token,
    dataset.schema_version_id,
  )
  const rows = pagedRows(
    'query_dataset_rows',
    { p_dataset_id: datasetId },
    context.token,
    {
      id: datasetId,
      revision: dataset.revision,
      schemaVersionId: dataset.schema_version_id,
    },
  )
  const all: Array<Record<string, unknown>> = []
  // The plugin reads columns by their names (the field keys), not by id.
  for await (const row of rows.rows)
    all.push(
      Object.fromEntries(
        fields.map((field) => [field.key, row.values[field.id] ?? null]),
      ),
    )
  try {
    const sent = await publish({
      workspaceId: dataset.workspace_id,
      actorUserId: context.userId,
      extensionKey: body.extensionKey,
      publisherId: body.publisherId,
      rows: all,
      name: dataset.name,
      parameters: body.parameters,
    })
    await recordDataExportReceipt({
      workspaceId: dataset.workspace_id,
      actorUserId: context.userId,
      objectType: 'dataset',
      objectId: dataset.id,
      format: `plugin:${body.extensionKey}`.slice(0, 40),
      rowCount: all.length,
    })
    return Response.json(
      { ...sent, rows: all.length },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return requestErrorResponse(
      422,
      'plugin_publish_failed',
      error instanceof Error ? error.message : 'The data could not be sent.',
    )
  }
}
