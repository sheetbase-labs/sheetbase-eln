/**
 * EXP-02.4 — derive the "open before submission" list from the server's
 * readiness result.
 *
 * `api.experiment_readiness(record_id)` (EXP-02.1) returns the same facts the
 * submit RPC gates on: the checks that did not pass on the latest revision,
 * open comment threads, and required Sheet parameters with no value. This
 * module turns that wire result into one row per thing standing between the
 * experiment and submission, and resolves each row to the exact place in the
 * notebook that clears it.
 *
 * Resolution is deliberately honest. A check that carries a Sheet/cell
 * location names its block and deep-links to `#block-<id>`; a row whose
 * location cannot be derived says so (`unresolvedReason`) instead of pointing
 * at a guessed place.
 */

/** Block identity needed to resolve a sheet instance to its notebook anchor. */
export interface ReadinessBlock {
  id: string
  /** Present on domain blocks; the readiness adapter only needs id and payload. */
  type?: string
  payload: Record<string, unknown>
}

/**
 * EXP-02.2 — protocol progress, derived from the notebook's own steps.
 *
 * LAB-07's protocol step model does not exist yet, so the step status is derived
 * from what the notebook actually records: a `procedure_step` block carries the
 * pinned protocol revision it came from (`sourceProtocolRevisionId`), the step it
 * came from (`sourceStepBlockId`), whether it is done, and who finished it and
 * when. A step with no recorded state is reported as not started rather than
 * guessed at, and a step whose state is missing entirely is not invented.
 */
export interface ProtocolStepProgress {
  blockId: string
  stepNumber: number | null
  text: string
  completed: boolean
  completedAt: string | null
  completedByUserId: string | null
  note: string | null
  sourceProtocolRevisionId: string | null
  sourceStepBlockId: string | null
}

export function protocolStepProgress(
  blocks: readonly ReadinessBlock[],
): ProtocolStepProgress[] {
  const steps: ProtocolStepProgress[] = []
  for (const block of blocks) {
    if (block.type !== 'procedure_step') continue
    const payload = block.payload
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!text) continue
    steps.push({
      blockId: block.id,
      stepNumber:
        typeof payload.stepNumber === 'number' ? payload.stepNumber : null,
      text,
      completed: payload.completed === true,
      completedAt:
        typeof payload.completedAt === 'string' ? payload.completedAt : null,
      completedByUserId:
        typeof payload.completedByUserId === 'string'
          ? payload.completedByUserId
          : null,
      note:
        typeof payload.note === 'string' && payload.note ? payload.note : null,
      sourceProtocolRevisionId:
        typeof payload.sourceProtocolRevisionId === 'string'
          ? payload.sourceProtocolRevisionId
          : null,
      sourceStepBlockId:
        typeof payload.sourceStepBlockId === 'string'
          ? payload.sourceStepBlockId
          : null,
    })
  }
  return steps.sort((a, b) => {
    if (a.stepNumber !== null && b.stepNumber !== null)
      return a.stepNumber - b.stepNumber
    if (a.stepNumber !== null) return -1
    if (b.stepNumber !== null) return 1
    return 0
  })
}

export type ReadinessCheckStatus = 'pass' | 'fail'
export type ReadinessSeverity = 'blocking' | 'warning' | 'informational'

/** One item inside a revision check result (mirrors `CheckItemResult`). */
export interface ReadinessCheckResult {
  key: string
  category: string
  severity: ReadinessSeverity | string
  label: string
  status: ReadinessCheckStatus
  evidence: Record<string, unknown>
}

/** A check result that did not pass on the latest revision. */
export interface ReadinessValidationError {
  revisionId: string
  checkDefinitionKey: string
  checkDefinitionVersion: number
  overallStatus: string
  blockingFailures: number
  warningFailures: number
  results: ReadinessCheckResult[]
  runAt: string
}

/** An open comment thread (root comment only). */
export interface ReadinessCommentThread {
  commentId: string
  body: string
  authorUserId: string | null
  target: {
    blockId?: string
    instanceId?: string
    rowKeys?: string[]
    fieldIds?: string[]
    [key: string]: unknown
  }
  createdAt: string
}

/** A required Sheet parameter with no value and no binding. */
export interface ReadinessRequiredField {
  instanceId: string
  instanceName: string
  parameterId: string
  parameterKey: string
  label: string
}

/** The payload returned by `api.experiment_readiness`. */
export interface ExperimentReadiness {
  recordId: string
  ready: boolean
  validationErrors: ReadinessValidationError[]
  openCommentThreads: ReadinessCommentThread[]
  emptyRequiredFields: ReadinessRequiredField[]
}

export type ReadinessItemKind = 'validation' | 'comment' | 'required-field'

/**
 * One row of "open before submission". `blockId` is the notebook anchor that
 * resolves it; when it is null the row carries `unresolvedReason` naming why no
 * location could be derived.
 */
export interface ReadinessItem {
  id: string
  kind: ReadinessItemKind
  severity: ReadinessSeverity
  title: string
  detail: string | null
  actionLabel: string
  blockId: string | null
  unresolvedReason: string | null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Map each canonical Sheet instance to the block that renders it. */
export function blockIdByInstanceId(
  blocks: readonly ReadinessBlock[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of blocks) {
    const instanceId = block.payload?.instanceId
    if (typeof instanceId === 'string') map.set(instanceId, block.id)
  }
  return map
}

interface DerivedLocation {
  blockId: string | null
  detail: string | null
  unresolvedReason: string | null
}

/** Resolve the deepest location a check's evidence names, without inventing one. */
function locationForCheck(result: ReadinessCheckResult): DerivedLocation {
  const evidence = asRecord(result.evidence)

  const invalidColumns = asArray(evidence.invalidColumns)
  if (invalidColumns.length > 0) {
    const first = asRecord(invalidColumns[0])
    const fieldName = asString(first.fieldName) ?? asString(first.columnId)
    const logicalType = asString(first.logicalType)
    return {
      blockId: asString(first.tableId),
      detail:
        fieldName != null
          ? `Column “${fieldName}”${
              logicalType ? ` has unsupported type ${logicalType}` : ''
            }.`
          : 'A sheet column has an unsupported type.',
      unresolvedReason: null,
    }
  }

  for (const key of [
    'unsupportedFormulas',
    'staleFormulas',
    'missingResults',
  ]) {
    const formulas = asArray(evidence[key])
    if (formulas.length > 0) {
      const first = asRecord(formulas[0])
      const formulaId = asString(first.id)
      const separator = formulaId?.indexOf(':') ?? -1
      const reason = asString(first.reason) ?? asString(first.status)
      return {
        blockId:
          formulaId && separator > 0 ? formulaId.slice(0, separator) : null,
        detail: `Formula ${formulaId ?? 'artifact'}${
          reason ? ` (${reason})` : ''
        }.`,
        unresolvedReason: null,
      }
    }
  }

  const missingLinkTypes = asArray(evidence.missingLinkTypes)
  if (missingLinkTypes.length > 0) {
    return {
      blockId: null,
      detail: `Missing required link: ${missingLinkTypes
        .map((type) => String(type))
        .join(', ')}.`,
      unresolvedReason:
        'The check is record-level; no cell location resolves it.',
    }
  }

  const path = asString(evidence.path)
  if (path != null) {
    const count = evidence.count
    const minCount = evidence.minCount
    return {
      blockId: null,
      detail: `Found ${String(count ?? 0)} of ${String(
        minCount ?? 0,
      )} required at ${path}.`,
      unresolvedReason:
        'The check is record-level; no cell location resolves it.',
    }
  }

  return {
    blockId: null,
    detail: null,
    unresolvedReason: 'The check does not name a location inside the notebook.',
  }
}

const SEVERITY_ORDER: Record<ReadinessSeverity, number> = {
  blocking: 0,
  warning: 1,
  informational: 2,
}

function coerceSeverity(value: string): ReadinessSeverity {
  return value === 'blocking' ||
    value === 'warning' ||
    value === 'informational'
    ? value
    : 'warning'
}

function locationForComment(
  thread: ReadinessCommentThread,
  blocksById: Map<string, string>,
): DerivedLocation {
  const blockId = asString(thread.target?.blockId)
  if (blockId) return { blockId, detail: null, unresolvedReason: null }

  const instanceId = asString(thread.target?.instanceId)
  if (instanceId) {
    const resolved = blocksById.get(instanceId) ?? null
    return {
      blockId: resolved,
      detail: null,
      unresolvedReason: resolved
        ? null
        : `Thread is anchored to a Sheet instance (${instanceId}) that is not in this record's document.`,
    }
  }

  return {
    blockId: null,
    detail: null,
    unresolvedReason:
      'Thread is anchored to the revision, not to a block or cell.',
  }
}

/**
 * Derive the ordered readiness rows. Blocking validation failures come first,
 * then warnings, then comment threads and empty required fields.
 */
export function readinessItems(
  readiness: ExperimentReadiness | null | undefined,
  blocks: readonly ReadinessBlock[],
  commentAuthorLabel: (userId: string | null) => string = () => 'Someone',
): ReadinessItem[] {
  if (!readiness) return []
  const blocksById = blockIdByInstanceId(blocks)
  const items: ReadinessItem[] = []

  for (const [errorIndex, error] of readiness.validationErrors.entries()) {
    const failing = (error.results ?? []).filter(
      (result) => result.status === 'fail',
    )
    for (const [resultIndex, result] of failing.entries()) {
      const location = locationForCheck(result)
      items.push({
        id: `validation:${error.checkDefinitionKey}:${errorIndex}:${result.key}:${resultIndex}`,
        kind: 'validation',
        severity: coerceSeverity(result.severity),
        title: result.label || result.key,
        detail: location.detail,
        actionLabel: 'Go to cell',
        blockId: location.blockId,
        unresolvedReason: location.unresolvedReason,
      })
    }
  }

  for (const [index, thread] of readiness.openCommentThreads.entries()) {
    const location = locationForComment(thread, blocksById)
    const collapsed = thread.body.replace(/\s+/g, ' ').trim()
    const excerpt =
      collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed
    items.push({
      id: `comment:${thread.commentId}:${index}`,
      kind: 'comment',
      severity: 'warning',
      title: 'Open comment thread',
      detail: `${commentAuthorLabel(thread.authorUserId)}: ${excerpt}`,
      actionLabel: 'Open thread',
      blockId: location.blockId,
      unresolvedReason: location.unresolvedReason,
    })
  }

  for (const [index, field] of readiness.emptyRequiredFields.entries()) {
    const blockId = blocksById.get(field.instanceId) ?? null
    items.push({
      id: `required-field:${field.instanceId}:${field.parameterId}:${index}`,
      kind: 'required-field',
      severity: 'blocking',
      title: `${field.label || field.parameterKey} is empty`,
      detail: `Required by ${field.instanceName}.`,
      actionLabel: 'Fill in',
      blockId,
      unresolvedReason: blockId
        ? null
        : `Sheet instance ${field.instanceName} (${field.instanceId}) is not in this record's document.`,
    })
  }

  return items.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
}
