/**
 * Runs what a plugin's screen asks Sheetbase to do for it (see
 * `host-capabilities.ts`). Everything goes through the person's own data
 * client, so what they may see and change is all a plugin can reach. Whether a
 * plugin may ask, and the confirmation of a change, are the frame's job; this
 * file does the work.
 */
import {
  addParent,
  asRole,
  createRegistryEntry,
  fetchRegistryModels,
  findDuplicates,
  isDuplicateError,
} from '#/lib/bio-registry'
import type { HostCapabilityName } from '#/lib/extensions/host-capabilities'
import type { NotebookBlock } from '#/lib/notebook-data'
import { notebookDataClient } from '#/lib/notebook-data'
import type { JsonObject } from '#/lib/workspace-admin'
import { z } from 'zod'

/** A plugin's message arguments: the object it handed the frame, unread. */
const hostInputSchema = z.record(z.string(), z.unknown())

type HostInput = z.infer<typeof hostInputSchema>

/** A stored block payload: the JSON object the block type owns. */
type BlockPayload = NotebookBlock['payload']

/** One stored JSON object, as a plugin's arguments arrive. */
const storedObject = z.record(z.string(), z.json())

/** A required, non-empty text argument. */
const requiredText = z.string().min(1)

/** The words a request needs, or the sentence saying which one is missing. */
function textOf(input: HostInput, key: string, what: string): string {
  const parsed = requiredText.safeParse(input[key])

  if (!parsed.success) throw new HostRequestError(`${what} is needed.`)

  return parsed.data
}

/** A stored object argument, or none when the plugin did not send one. */
function objectOf(input: HostInput, key: string): JsonObject {
  return storedObject.safeParse(input[key]).data ?? {}
}

export class HostRequestError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export interface HostEnvironment {
  /** The record the screen is on, when it is on one. */
  recordId: string | null
  /** Put a block in the notebook below this one. Not offered where nothing is being edited. */
  insertBelow?: (type: string, payload: BlockPayload) => void
}

const ID_RE = /^[0-9a-f-]{36}$/i
const KEY_RE = /^[a-z][a-z0-9_-]{0,63}$/

function needRecord(env: HostEnvironment): string {
  if (!env.recordId)
    throw new HostRequestError('This screen is not on a record.')

  return env.recordId
}

async function projectOf(recordId: string): Promise<string> {
  const rows = await notebookDataClient.list<{ project_id: string | null }>(
    'records',
    `?id=eq.${encodeURIComponent(recordId)}&select=project_id`,
  )

  const project = rows.at(0)?.project_id

  if (!project) throw new HostRequestError('That record is not in a project.')

  return project
}

/** One-line description of a change, for the question the person is asked. */
export function describeHostChange(
  name: HostCapabilityName,
  input: HostInput,
): string {
  if (name === 'registry.create')
    return `Add “${requiredText.safeParse(input.title).data ?? ''}” to the ${requiredText.safeParse(input.model).data ?? ''} registry.`

  if (name === 'blocks.insertBelow') return 'Add a block below this one.'

  return ''
}

export async function runHostRequest(
  name: HostCapabilityName,
  input: HostInput,
  env: HostEnvironment,
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- A host request answers with the plugin's own JSON result, which the frame posts back unchanged; the capability, not this file, owns that shape.
): Promise<unknown> {
  switch (name) {
    case 'blocks.list': {
      const recordId = needRecord(env)

      const requestedType = requiredText.safeParse(input.type).data

      const type =
        requestedType && KEY_RE.test(requestedType)
          ? `&type=eq.${requestedType}`
          : ''

      const rows = await notebookDataClient.list<{
        id: string
        type: string
        payload: unknown
      }>(
        'blocks',
        `?record_id=eq.${encodeURIComponent(recordId)}${type}&order=order.asc&select=id,type,payload`,
      )

      return rows
    }

    case 'blocks.insertBelow': {
      if (!env.insertBelow)
        throw new HostRequestError('Nothing is being edited here.')
      const type = textOf(input, 'type', 'A block type')

      if (!KEY_RE.test(type))
        throw new HostRequestError('That is not a block type.')

      const payload = storedObject.safeParse(input.payload)

      if (!payload.success)
        throw new HostRequestError('The block needs a payload.')
      env.insertBelow(type, payload.data)

      return { ok: true }
    }

    case 'files.list': {
      const recordId = needRecord(env)

      const links = await notebookDataClient.list<{
        target_record_id: string | null
      }>(
        'record_links',
        `?source_record_id=eq.${encodeURIComponent(recordId)}&target_kind=eq.file&select=target_record_id`,
      )

      const ids = [
        ...new Set(
          links
            .map((l) => l.target_record_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ]

      if (ids.length === 0) return []

      const files = await notebookDataClient.list<{
        record_id: string
        display_name: string
        created_at: string
        version: number
      }>(
        'file_objects',
        `?record_id=in.(${ids.map(encodeURIComponent).join(',')})&select=record_id,display_name,created_at,version&order=version.asc`,
      )

      const latest = new Map<string, (typeof files)[number]>()

      for (const f of files) latest.set(f.record_id, f)

      return [...latest.values()].map((f) => ({
        fileRecordId: f.record_id,
        name: f.display_name,
        createdAt: f.created_at,
      }))
    }

    case 'files.read': {
      const id = textOf(input, 'fileRecordId', 'A file')

      if (!ID_RE.test(id)) throw new HostRequestError('That is not a file.')
      const res = await fetch(`/api/files/${id}/download`)

      if (!res.ok)
        throw new HostRequestError(
          `The file could not be opened (${res.status}).`,
        )

      if (input.as === 'base64') {
        const bytes = new Uint8Array(await res.arrayBuffer())
        let binary = ''

        for (let i = 0; i < bytes.length; i += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))

        return { encoding: 'base64', content: btoa(binary) }
      }

      return { encoding: 'text', content: await res.text() }
    }

    case 'registry.models':
      return fetchRegistryModels(notebookDataClient)
    case 'registry.findDuplicates': {
      const model = textOf(input, 'model', 'A registry')

      if (!KEY_RE.test(model))
        throw new HostRequestError('That is not a registry.')

      return findDuplicates(notebookDataClient, {
        kind: model,
        title: requiredText.safeParse(input.title).data ?? '',
        customFields: objectOf(input, 'customFields'),
      })
    }

    case 'registry.create': {
      const recordId = needRecord(env)
      const model = textOf(input, 'model', 'A registry')

      if (!KEY_RE.test(model))
        throw new HostRequestError('That is not a registry.')
      const title = textOf(input, 'title', 'A name')

      const customFields = objectOf(input, 'customFields')

      const projectId = await projectOf(recordId)

      const make = (fields: JsonObject) =>
        createRegistryEntry<{ id: string; identifier: string; title: string }>(
          notebookDataClient,
          {
            projectId,
            kind: model,
            title,
            customFields: fields,
            allowDuplicate: input.allowDuplicate === true,
          },
        )

      let entry

      try {
        entry = await make(customFields)
      } catch (error) {
        if (isDuplicateError(error))
          throw new HostRequestError(
            error instanceof Error ? error.message : 'Already registered.',
            'duplicate',
          )

        // A registry without some of the fields: try the ones it must have.
        const fallback = storedObject.safeParse(input.fallbackCustomFields)

        if (!fallback.success) throw error
        entry = await make(fallback.data)
      }

      const parents = z.array(z.unknown()).safeParse(input.parents).data ?? []

      for (const parent of parents) {
        const link = z
          .looseObject({ recordId: z.string(), role: z.string().optional() })
          .safeParse(parent)

        if (!link.success || !ID_RE.test(link.data.recordId)) continue

        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Parent links are written in the order the plugin sent them, and a refused link stops the rest rather than racing them.
        await addParent(
          notebookDataClient,
          entry.id,
          link.data.recordId,
          asRole(link.data.role ?? 'insert'),
        )
      }

      return {
        recordId: entry.id,
        identifier: entry.identifier,
        title: entry.title,
      }
    }
  }
}
