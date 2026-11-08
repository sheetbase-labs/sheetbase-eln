/**
 * POST /api/plugins/data: the data and search points, called from the app's own
 * screens as the signed-in person.
 *
 * - `import`: read a file with a plugin importer into a table;
 * - `connector`: pull data in with a plugin connector;
 * - `export`: write rows as a file with a plugin exporter;
 * - `preview`: show what is inside a file with a plugin preview;
 * - `check`: run a plugin check on a table;
 * - `sameness-key`: work out the key a registry model's same-thing rule gives;
 * - `gate-check`: run a plugin check on a table of an experiment for a gate,
 *   reading the table here and storing the answer for the gate to read.
 *
 * Same sign-in, workspace and rate limit as `/api/plugins/run`; the plugin
 * runtime does the rest (see `data-runtime.server.ts`). Searching, same-thing
 * rules and event reactions are called by the server itself, not from here.
 */
import { z } from 'zod'

import { defaultGateCheckDeps, runGateCheck } from './gate-check.server'
import type { GateCheckDeps } from './gate-check.server'
import {
  runExtensionCheck,
  runExtensionConnector,
  runExtensionExporter,
  runExtensionImporter,
  runExtensionPreview,
  runExtensionSamenessKey,
} from './data-runtime.server'
import {
  defaultRouteDeps,
  failure,
  largestDataLimitBytes,
  rateDecision,
  tooMuchData,
  refuse,
  reply,
} from './run-route.server'
import type { ExtensionRunRouteDeps } from './run-route.server'
import { pluginLimits } from './runtime.server'

const id = z.string().regex(/^[a-z][a-z0-9-]{0,48}$/)
const row = z.record(z.string(), z.unknown())

const bodySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('import'),
      extensionKey: id,
      importerId: id,
      filename: z.string().min(1).max(255),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('connector'),
      extensionKey: id,
      connectorId: id,
      parameters: z.record(z.string(), z.unknown()).default({}),
      settings: z.record(z.string(), z.string().max(2000)).default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal('export'),
      extensionKey: id,
      exporterId: id,
      name: z.string().min(1).max(120),
      rows: z.array(row).max(100_000),
      options: z.record(z.string(), z.unknown()).default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal('preview'),
      extensionKey: id,
      previewId: id,
      filename: z.string().min(1).max(255),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('check'),
      extensionKey: id,
      checkId: id,
      rows: z.array(row).max(100_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('sameness-key'),
      extensionKey: id,
      keyId: id,
      values: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal('gate-check'),
      extensionKey: id,
      checkId: id,
      recordId: z.string().uuid(),
      blockId: z.string().uuid(),
      columns: z.record(z.string(), z.string().max(200)).default({}),
    })
    .strict(),
])

export async function handleExtensionData(
  request: Request,
  deps: ExtensionRunRouteDeps & {
    gateCheck?: GateCheckDeps
  } = defaultRouteDeps(),
): Promise<Response> {
  const session = await deps.getSession(request.headers)
  if (!session) return refuse(401, 'Sign in to use plugins.')
  const member = await deps.getMember(session.user.id)
  if (!member) return refuse(403, 'You need a workspace to use plugins.')
  let raw: unknown
  let size = 0
  try {
    const text = await request.text()
    size = text.length
    // The most any plugin here takes; the plugin's own limit is checked once we know which.
    if (size > (await largestDataLimitBytes(deps.runtime, member.workspaceId)))
      return refuse(413, 'That is too much data to send to a plugin.')
    raw = JSON.parse(text)
  } catch {
    return refuse(400, 'Send a JSON body.')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return refuse(400, 'The request could not be read.')
  const body = parsed.data
  {
    const install = await deps.runtime.loadInstall(
      member.workspaceId,
      body.extensionKey,
    )
    if (install) {
      const limits = await pluginLimits(
        deps.runtime,
        member.workspaceId,
        install.id,
      )
      const decision = rateDecision(
        limits.callsPerMinute,
        `extension-run:${body.extensionKey}:${session.user.id}`,
      )
      if (!decision.allowed)
        return refuse(
          429,
          `Too many calls to this plugin. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
        )
      if (size > limits.dataMb * 1024 * 1024)
        return refuse(413, tooMuchData(limits.dataMb))
    }
  }
  const caller = {
    workspaceId: member.workspaceId,
    actorUserId: session.user.id,
    extensionKey: body.extensionKey,
  }
  try {
    switch (body.kind) {
      case 'import': {
        if (member.role === 'viewer')
          return refuse(403, 'Importing needs a workspace you can edit.')
        const table = await runExtensionImporter(
          {
            ...caller,
            importerId: body.importerId,
            filename: body.filename,
            content: body.content,
          },
          deps.runtime,
        )
        return reply(table)
      }
      case 'connector': {
        if (member.role === 'viewer')
          return refuse(403, 'Importing needs a workspace you can edit.')
        const table = await runExtensionConnector(
          {
            ...caller,
            connectorId: body.connectorId,
            parameters: body.parameters,
            settings: body.settings,
          },
          deps.runtime,
        )
        return reply(table)
      }
      case 'export':
        return reply(
          await runExtensionExporter(
            {
              ...caller,
              exporterId: body.exporterId,
              name: body.name,
              rows: body.rows,
              options: body.options,
            },
            deps.runtime,
          ),
        )
      case 'preview':
        return reply(
          await runExtensionPreview(
            {
              ...caller,
              previewId: body.previewId,
              filename: body.filename,
              content: body.content,
            },
            deps.runtime,
          ),
        )
      case 'check':
        return reply(
          await runExtensionCheck(
            { ...caller, checkId: body.checkId, rows: body.rows },
            deps.runtime,
          ),
        )
      case 'sameness-key':
        return reply({
          key: await runExtensionSamenessKey(
            { ...caller, keyId: body.keyId, values: body.values },
            deps.runtime,
          ),
        })
      case 'gate-check': {
        if (member.role === 'viewer')
          return refuse(403, 'Running a check needs a workspace you can edit.')
        return reply(
          await runGateCheck(
            request.headers,
            {
              ...caller,
              checkId: body.checkId,
              recordId: body.recordId,
              blockId: body.blockId,
              columns: body.columns,
            },
            deps.gateCheck ?? {
              ...defaultGateCheckDeps(),
              runtime: deps.runtime,
            },
          ),
        )
      }
    }
  } catch (error) {
    return failure(error)
  }
}
