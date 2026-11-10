/**
 * Requests (migration 0076). Any record model can take requests: the model's
 * own fields make the form, and a request is an ordinary record of the model
 * that starts as "requested". The people who handle that model's requests see
 * it in their Inbox and accept, decline or complete it.
 *
 * Reads go straight to the tables under row-level security; every change goes
 * through an RPC so who may do what, and who is told, stay in the database.
 */
import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'
import type { ModelFieldRecordValues } from '#/lib/model-fields'

export const requestKeys = {
  all: ['requests'] as const,
  forms: ['requests', 'forms'] as const,
  handled: ['requests', 'handled'] as const,
  list: (kinds: readonly string[]) => ['requests', 'list', ...kinds] as const,
}

export const REQUEST_STATUSES = [
  'requested',
  'accepted',
  'declined',
  'completed',
] as const

export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export type RequestDecision = Exclude<RequestStatus, 'requested'>

const requestStatusSchema = z.enum(REQUEST_STATUSES)

export function asRequestStatus(value: string): RequestStatus {
  const status = requestStatusSchema.safeParse(value)

  return status.success ? status.data : 'requested'
}

/** A request is open until it is declined or completed. */
export function isOpenRequest(status: RequestStatus): boolean {
  return status === 'requested' || status === 'accepted'
}

/** What a handler can do next with a request in this state. */
export function nextDecisions(status: RequestStatus): RequestDecision[] {
  if (status === 'requested') return ['accepted', 'declined', 'completed']

  if (status === 'accepted') return ['completed', 'declined']

  return []
}

export interface RequestForm {
  model_key: string
  intro: string | null
  handler_user_ids: string[]
  name: string
  identifier_prefix: string
}

interface RequestFormWire {
  model_key: string
  intro: string | null
  handler_user_ids: string[]
}

interface ModelWire {
  key: string
  name: string
  identifier_prefix: string
}

export async function fetchRequestForms(
  client: DataClient,
): Promise<RequestForm[]> {
  const forms = await client.list<RequestFormWire>(
    'request_forms',
    '?select=model_key,intro,handler_user_ids&order=model_key.asc',
  )

  if (forms.length === 0) return []
  const keys = forms.map((f) => encodeURIComponent(f.model_key)).join(',')

  const models = await client.list<ModelWire>(
    'record_models',
    `?key=in.(${keys})&select=key,name,identifier_prefix`,
  )

  const byKey = new Map(models.map((m) => [m.key, m] as const))

  return forms
    .map((f) => ({
      ...f,
      name: byKey.get(f.model_key)?.name ?? f.model_key,
      identifier_prefix: byKey.get(f.model_key)?.identifier_prefix ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The forms the caller handles: they are named on it, or none is named and they run the lab's setup. */
export async function fetchHandledForms(client: DataClient): Promise<string[]> {
  return client.rpc<string[]>('my_request_forms', {})
}

export interface RequestRow {
  id: string
  identifier: string
  title: string
  kind: string
  status: RequestStatus
  custom_fields: ModelFieldRecordValues['customFields'] | null
  created_at: string
  created_by_user_id: string
  project_id: string | null
  note: string | null
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
}

interface RequestRecordWire {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  custom_fields: ModelFieldRecordValues['customFields'] | null
  created_at: string
  created_by_user_id: string
  project_id: string | null
}

interface RequestDetailWire {
  record_id: string
  note: string | null
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
}

export async function fetchRequests(
  client: DataClient,
  kinds: readonly string[],
): Promise<RequestRow[]> {
  if (kinds.length === 0) return []
  const list = kinds.map((k) => encodeURIComponent(k)).join(',')

  const records = await client.list<RequestRecordWire>(
    'records',
    `?kind=in.(${list})&deleted_at=is.null&order=created_at.desc&limit=2000&select=id,identifier,title,kind,status,custom_fields,created_at,created_by_user_id,project_id`,
  )

  if (records.length === 0) return []

  const details = await client.list<RequestDetailWire>(
    'request_details',
    `?record_id=in.(${records.map((r) => r.id).join(',')})&select=record_id,note,decided_by,decided_at,decision_note`,
  )

  const byRecord = new Map(details.map((d) => [d.record_id, d] as const))

  return records.map((r) => {
    const d = byRecord.get(r.id)

    return {
      ...r,
      status: asRequestStatus(r.status),
      note: d?.note ?? null,
      decided_by: d?.decided_by ?? null,
      decided_at: d?.decided_at ?? null,
      decision_note: d?.decision_note ?? null,
    }
  })
}

export async function setRequestForm(
  client: DataClient,
  input: {
    modelKey: string
    accepts: boolean
    intro: string
    handlerUserIds: string[]
  },
): Promise<void> {
  await client.rpc<null>('set_request_form', {
    p_model_key: input.modelKey,
    p_accepts: input.accepts,
    p_intro: input.intro.trim() === '' ? null : input.intro.trim(),
    p_handler_user_ids: input.handlerUserIds,
  })
}

export async function submitRequest(
  client: DataClient,
  input: {
    modelKey: string
    title: string
    customFields: ModelFieldRecordValues['customFields']
    projectId: string | null
    note: string
  },
): Promise<{ id: string; identifier: string }> {
  return client.rpc<{ id: string; identifier: string }>('submit_request', {
    p_model_key: input.modelKey,
    p_title: input.title,
    p_custom_fields: input.customFields,
    p_project_id: input.projectId,
    p_note: input.note.trim() === '' ? null : input.note.trim(),
  })
}

export async function decideRequest(
  client: DataClient,
  input: { recordId: string; decision: RequestDecision; note: string },
): Promise<void> {
  await client.rpc<unknown>('decide_request', {
    p_record_id: input.recordId,
    p_decision: input.decision,
    p_note: input.note.trim() === '' ? null : input.note.trim(),
  })
}

/** A ready-made form for the lab's first request type. */
export interface StarterRequest {
  key: string
  name: string
  prefix: string
  description: string
  intro: string
  fields: Array<{
    field_name: string
    label: string
    logical_type: 'text' | 'date' | 'category'
    show_in_list?: boolean
  }>
}

export const STARTER_REQUESTS: readonly StarterRequest[] = [
  {
    key: 'analysis_request',
    name: 'Analysis request',
    prefix: 'REQ',
    description: 'Ask for samples to be tested or data to be analysed.',
    intro: 'Say what you need run and by when. The team replies in your Inbox.',
    fields: [
      {
        field_name: 'what_is_needed',
        label: 'What do you need?',
        logical_type: 'text',
        show_in_list: true,
      },
      {
        field_name: 'sample_details',
        label: 'Samples (what and how many)',
        logical_type: 'text',
      },
      {
        field_name: 'needed_by',
        label: 'Needed by',
        logical_type: 'date',
        show_in_list: true,
      },
    ],
  },
]

export async function createStarterRequest(
  client: DataClient,
  starter: StarterRequest,
): Promise<void> {
  await client.rpc<unknown>('create_request_model', {
    p_key: starter.key,
    p_name: starter.name,
    p_prefix: starter.prefix,
    p_description: starter.description,
    p_fields: starter.fields,
    p_intro: starter.intro,
  })
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A caught throw is untyped by definition; an Error supplies its message and anything else falls back.
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
