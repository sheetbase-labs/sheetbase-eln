/**
 * Runs what a plugin's screen asks Sheetbase to do for it (see
 * `host-capabilities.ts`). Everything goes through the person's own data
 * client, so what they may see and change is all a plugin can reach. Whether a
 * plugin may ask, and the confirmation of a change, are the frame's job; this
 * file does the work.
 */
import {
  addParent,
  createRegistryEntry,
  fetchRegistryModels,
  findDuplicates,
  isDuplicateError,
} from '#/lib/bio-registry'
import type { ParentRole } from '#/lib/bio-registry'
import type { HostCapabilityName } from '#/lib/extensions/host-capabilities'
import { notebookDataClient } from '#/lib/notebook-data'

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
  insertBelow?: (type: string, payload: Record<string, unknown>) => void
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const text = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || v.length === 0)
    throw new HostRequestError(`${what} is needed.`)

  return v
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
  input: Record<string, unknown>,
): string {
  if (name === 'registry.create')
    return `Add “${typeof input.title === 'string' ? input.title : ''}” to the ${typeof input.model === 'string' ? input.model : ''} registry.`

  if (name === 'blocks.insertBelow') return 'Add a block below this one.'

  return ''
}

export async function runHostRequest(
  name: HostCapabilityName,
  input: Record<string, unknown>,
  env: HostEnvironment,
): Promise<unknown> {
  switch (name) {
    case 'blocks.list': {
      const recordId = needRecord(env)

      const type =
        typeof input.type === 'string' && KEY_RE.test(input.type)
          ? `&type=eq.${input.type}`
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
      const type = text(input.type, 'A block type')

      if (!KEY_RE.test(type))
        throw new HostRequestError('That is not a block type.')

      if (!isRecord(input.payload))
        throw new HostRequestError('The block needs a payload.')
      env.insertBelow(type, input.payload)

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
      const id = text(input.fileRecordId, 'A file')

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
      const model = text(input.model, 'A registry')

      if (!KEY_RE.test(model))
        throw new HostRequestError('That is not a registry.')

      return findDuplicates(notebookDataClient, {
        kind: model,
        title: typeof input.title === 'string' ? input.title : '',
        customFields: isRecord(input.customFields) ? input.customFields : {},
      })
    }

    case 'registry.create': {
      const recordId = needRecord(env)
      const model = text(input.model, 'A registry')

      if (!KEY_RE.test(model))
        throw new HostRequestError('That is not a registry.')
      const title = text(input.title, 'A name')

      const customFields = isRecord(input.customFields)
        ? input.customFields
        : {}

      const projectId = await projectOf(recordId)

      const make = (fields: Record<string, unknown>) =>
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
        if (!isRecord(input.fallbackCustomFields)) throw error
        entry = await make(input.fallbackCustomFields)
      }

      const parents = Array.isArray(input.parents) ? input.parents : []

      for (const parent of parents) {
        if (!isRecord(parent) || typeof parent.recordId !== 'string') continue

        if (!ID_RE.test(parent.recordId)) continue
        await addParent(
          notebookDataClient,
          entry.id,
          parent.recordId,
          (typeof parent.role === 'string'
            ? parent.role
            : 'insert') as ParentRole,
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
