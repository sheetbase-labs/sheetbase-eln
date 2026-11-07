/**
 * Sign-off per part of an experiment (see the part_sign_off migration).
 *
 * A part can need a signature. When its steps are done the person who did the
 * work signs it: the part is frozen with a digest, the next part opens, and
 * the signed part cannot be changed until someone amends it with a reason.
 * Another person can be asked to countersign. The database decides all of
 * this; these are the reads and writes the page uses, and the same functions
 * serve the API, the assistant and pipelines.
 */
import type { DataClient } from '#/lib/data-client'
import { requestSignatureStepUp } from '#/lib/signatures'

export const partSignoffQueryKeys = {
  forRecord: (recordId: string) =>
    ['notebook', 'part-signoffs', recordId] as const,
  requests: (recordId: string) =>
    ['notebook', 'part-signoffs', recordId, 'requests'] as const,
  preview: (partId: string) =>
    ['notebook', 'part-signoffs', 'preview', partId] as const,
}

/** One row of `api.record_part_signoffs`. */
export interface PartSignoffStatus {
  partId: string
  partNumber: number
  title: string
  requiresSignOff: boolean
  workDone: boolean
  awaitingSignOff: boolean
  signed: boolean
  signoffId: string | null
  signedAt: string | null
  signedByUserId: string | null
  signerName: string | null
  snapshotDigest: string | null
  countersignedBy: string[]
  countersignRequestedFrom: string[]
  signRequestedFrom: string[]
  amendmentCount: number
  lastAmendedAt: string | null
  lastAmendmentReason: string | null
}

interface PartSignoffStatusWire {
  part_id: string
  part_number: number
  title: string
  requires_sign_off: boolean
  work_done: boolean
  awaiting_sign_off: boolean
  signed: boolean
  signoff_id: string | null
  signed_at: string | null
  signed_by_user_id: string | null
  signer_name: string | null
  snapshot_digest: string | null
  countersigned_by: string[] | null
  countersign_requested_from: string[] | null
  sign_requested_from: string[] | null
  amendment_count: number
  last_amended_at: string | null
  last_amendment_reason: string | null
}

export function fetchPartSignoffs(
  client: DataClient,
  recordId: string,
): Promise<PartSignoffStatus[]> {
  return client
    .rpc<PartSignoffStatusWire[]>('record_part_signoffs', {
      p_record_id: recordId,
    })
    .then((rows) =>
      rows.map((row) => ({
        partId: row.part_id,
        partNumber: row.part_number,
        title: row.title,
        requiresSignOff: row.requires_sign_off,
        workDone: row.work_done,
        awaitingSignOff: row.awaiting_sign_off,
        signed: row.signed,
        signoffId: row.signoff_id,
        signedAt: row.signed_at,
        signedByUserId: row.signed_by_user_id,
        signerName: row.signer_name,
        snapshotDigest: row.snapshot_digest,
        countersignedBy: row.countersigned_by ?? [],
        countersignRequestedFrom: row.countersign_requested_from ?? [],
        signRequestedFrom: row.sign_requested_from ?? [],
        amendmentCount: row.amendment_count,
        lastAmendedAt: row.last_amended_at,
        lastAmendmentReason: row.last_amendment_reason,
      })),
    )
}

/** What signing a part would cover; the digest is what the password check binds to. */
export interface PartSignoffPreview {
  partId: string
  recordId: string
  digest: string
  partNumber: number
  title: string
  blockCount: number
  stepCount: number
  requiresSignOff: boolean
  workDone: boolean
  signed: boolean
}

interface PartSignoffPreviewWire {
  part_id: string
  record_id: string
  digest: string
  part_number: number
  title: string
  block_count: number
  step_count: number
  requires_sign_off: boolean
  work_done: boolean
  signed: boolean
}

export function previewPartSignoff(
  client: DataClient,
  partId: string,
): Promise<PartSignoffPreview> {
  return client
    .rpc<PartSignoffPreviewWire>('part_signoff_preview', { p_part_id: partId })
    .then((row) => ({
      partId: row.part_id,
      recordId: row.record_id,
      digest: row.digest,
      partNumber: row.part_number,
      title: row.title,
      blockCount: row.block_count,
      stepCount: row.step_count,
      requiresSignOff: row.requires_sign_off,
      workDone: row.work_done,
      signed: row.signed,
    }))
}

/** A request to sign or countersign a part, for the person asked. */
export interface PartSignoffRequest {
  id: string
  recordId: string
  partId: string
  kind: 'sign' | 'countersign'
  requestedUserId: string
  requestedByUserId: string
  note: string | null
  dueAt: string | null
  createdAt: string
}

interface PartSignoffRequestWire {
  id: string
  record_id: string
  part_id: string
  kind: 'sign' | 'countersign'
  requested_user_id: string
  requested_by_user_id: string
  note: string | null
  due_at: string | null
  created_at: string
}

/** The open requests addressed to one person on one experiment. */
export function fetchPartSignoffRequests(
  client: DataClient,
  recordId: string,
  userId: string,
): Promise<PartSignoffRequest[]> {
  return client
    .list<PartSignoffRequestWire>(
      'experiment_part_requests',
      `?record_id=eq.${recordId}&requested_user_id=eq.${encodeURIComponent(userId)}&fulfilled_at=is.null&order=created_at.asc`,
    )
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        recordId: row.record_id,
        partId: row.part_id,
        kind: row.kind,
        requestedUserId: row.requested_user_id,
        requestedByUserId: row.requested_by_user_id,
        note: row.note,
        dueAt: row.due_at,
        createdAt: row.created_at,
      })),
    )
}

/** A signature, countersign or amendment as the sign-off history shows it. */
export interface PartSignoffEntry {
  id: string
  partId: string
  partNumber: number
  partTitle: string
  meaning: 'signed' | 'witnessed'
  countersignsId: string | null
  snapshotDigest: string
  signerUserId: string
  signerName: string
  authMethod: 'password' | 'demo'
  signedAt: string
}

interface PartSignoffEntryWire {
  id: string
  part_id: string
  part_number: number
  part_title: string
  meaning: 'signed' | 'witnessed'
  countersigns_id: string | null
  snapshot_digest: string
  signer_user_id: string
  signer_name: string
  auth_method: 'password' | 'demo'
  signed_at: string
}

/** Every signature given on the parts of an experiment, oldest first. */
export function fetchPartSignoffEntries(
  client: DataClient,
  recordId: string,
): Promise<PartSignoffEntry[]> {
  return client
    .list<PartSignoffEntryWire>(
      'experiment_part_signoffs',
      `?record_id=eq.${recordId}&select=id,part_id,part_number,part_title,meaning,countersigns_id,snapshot_digest,signer_user_id,signer_name,auth_method,signed_at&order=signed_at.asc`,
    )
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        partId: row.part_id,
        partNumber: row.part_number,
        partTitle: row.part_title,
        meaning: row.meaning,
        countersignsId: row.countersigns_id,
        snapshotDigest: row.snapshot_digest,
        signerUserId: row.signer_user_id,
        signerName: row.signer_name,
        authMethod: row.auth_method,
        signedAt: row.signed_at,
      })),
    )
}

export interface PartAmendmentEntry {
  id: string
  partId: string
  signoffId: string
  reason: string
  amendedByUserId: string
  amendedAt: string
}

interface PartAmendmentEntryWire {
  id: string
  part_id: string
  signoff_id: string
  reason: string
  amended_by_user_id: string
  amended_at: string
}

export function fetchPartAmendments(
  client: DataClient,
  recordId: string,
): Promise<PartAmendmentEntry[]> {
  return client
    .list<PartAmendmentEntryWire>(
      'experiment_part_amendments',
      `?record_id=eq.${recordId}&order=amended_at.asc`,
    )
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        partId: row.part_id,
        signoffId: row.signoff_id,
        reason: row.reason,
        amendedByUserId: row.amended_by_user_id,
        amendedAt: row.amended_at,
      })),
    )
}

/**
 * Sign a part (or countersign it). The password check asks the server for a
 * one-use token tied to this part and this digest; the write spends it. Nothing
 * here remembers the password.
 */
export async function signExperimentPart(
  client: DataClient,
  input: {
    workspaceId: string
    partId: string
    meaning: 'signed' | 'witnessed'
    digest: string
    confirmation: string
    password: string
    /** People to ask to countersign, when the part was just signed. */
    countersignUserIds?: readonly string[]
  },
) {
  const proof = await requestSignatureStepUp({
    workspaceId: input.workspaceId,
    password: input.password,
    purpose: 'sign-part',
    partId: input.partId,
    revisionDigest: input.digest,
    signatureMeaning: input.meaning,
  })
  return client.rpc<{
    signoff_id: string
    part_id: string
    meaning: 'signed' | 'witnessed'
    digest: string
    signed_at: string
    auth_method: 'password' | 'demo'
  }>('sign_experiment_part', {
    p_part_id: input.partId,
    p_meaning: input.meaning,
    p_confirmation_phrase: input.confirmation,
    p_expected_digest: input.digest,
    p_signing_token: proof.token,
    p_countersign_user_ids: [...(input.countersignUserIds ?? [])],
    p_due_at: null,
  })
}

/** Ask a person to sign a finished part, or to countersign a signed one. */
export function requestPartSignoff(
  client: DataClient,
  input: { partId: string; userId: string; note?: string },
) {
  return client.rpc<{ part_id: string; kind: 'sign' | 'countersign' }>(
    'request_part_signoff',
    {
      p_part_id: input.partId,
      p_user_id: input.userId,
      p_note: input.note?.trim() ? input.note.trim() : null,
      p_due_at: null,
    },
  )
}

/** Reopen a signed part, with the reason. */
export function amendExperimentPart(
  client: DataClient,
  partId: string,
  reason: string,
) {
  return client.rpc<{ part_id: string; amendment_id: string }>(
    'amend_experiment_part',
    { p_part_id: partId, p_reason: reason },
  )
}

/** Require a signature on the parts of an experiment that are not signed yet, or stop requiring it. */
export function setPartsSignOff(
  client: DataClient,
  recordId: string,
  required: boolean,
) {
  return client.rpc<{
    record_id: string
    required: boolean
    parts_changed: number
  }>('set_parts_sign_off', { p_record_id: recordId, p_required: required })
}

/**
 * Who to name for the part a request is for: the first open request addressed
 * to this person, sign requests before countersign requests.
 */
export function requestFor(
  requests: readonly PartSignoffRequest[],
  partId: string,
  kind: PartSignoffRequest['kind'],
): PartSignoffRequest | null {
  return (
    requests.find(
      (request) => request.partId === partId && request.kind === kind,
    ) ?? null
  )
}
