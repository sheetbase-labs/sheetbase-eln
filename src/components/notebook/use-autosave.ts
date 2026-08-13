/**
 * ELN-007 — per-block autosave state machine.
 *
 * A reusable hook that coalesces rapid edits, debounces saves, retries
 * transient failures with bounded backoff, holds saves while offline,
 * keeps validation failures attached to the block, and — on a server
 * version conflict — preserves both the local draft and the canonical
 * server value so the user can choose a resolution instead of having one
 * side silently overwritten.
 *
 * Design invariants (see docs/decisions/0018-notebook-autosave-and-conflict.md):
 *
 * - **Draft revision tracking.** Every edit bumps a monotonic revision.
 *   A save that resolves only marks the block clean when the saved
 *   revision equals the latest draft revision; otherwise a follow-up save
 *   is scheduled immediately. A slow response can therefore never mark a
 *   newer local draft as saved.
 * - **Server-canonical reset.** When `initialValue` changes (live event
 *   or refetch), the draft resets to it only while clean. A dirty /
 *   saving / retrying / offline / failed draft is preserved so the user's
 *   in-flight work is never clobbered. A conflict updates the offered
 *   server value but keeps the draft.
 * - **No silent overwrite.** On `kind: 'conflict'` the hook stops
 *   retrying, retains the draft, records `serverValue`, and waits for an
 *   explicit `discardDraft()` (use server) or `retry()` (keep my edit).
 * - **Transient vs permanent.** Only `kind: 'transient'` is retried
 *   (exponential backoff, `maxRetries` bound). `kind: 'validation'` is
 *   permanent: the failure is attached to the block and never retried
 *   automatically; the next edit re-validates and clears it if valid.
 * - **Offline hold.** While `offline` is true no new saves are started;
 *   dirty work settles into the `offline` status. When connectivity
 *   returns, pending dirty work is flushed.
 * - **Navigation guard signal.** `hasUnsavedWork` is true for every
 *   status except `clean`, so callers can wire `beforeunload` and router
 *   blockers to it without duplicating the state machine.
 *
 * The hook is a pure function of its props and the `save` callback; it
 * owns no network or router concerns, which makes it fully testable with
 * fake timers and a stubbed `save`.
 */
import * as React from 'react'

/** Block-scoped autosave status, surfaced truthfully in the editor. */
export type AutosaveStatus =
  /** No unsaved changes; last save succeeded or the block was never edited. */
  | 'clean'
  /** Draft changed; waiting for the debounce to elapse before saving. */
  | 'dirty'
  /** Save is in flight. */
  | 'saving'
  /** A transient failure occurred; waiting before a bounded retry. */
  | 'retrying'
  /** Connection is offline; saves are held until reconnect. */
  | 'offline'
  /** Permanent failure (validation error or exhausted retries). */
  | 'failed'
  /** Server version diverged; awaiting explicit resolution. */
  | 'conflict'

/** Structured save result the route returns so the hook can branch. */
export interface SaveResult<T> {
  ok: boolean
  /** Failure category. Required when `ok` is false. */
  kind?: 'conflict' | 'validation' | 'transient'
  /** Human-readable failure message. */
  message?: string
  /**
   * On conflict, the canonical server value to offer as the alternative
   * to the local draft. The hook never adopts it automatically.
   */
  serverValue?: T
}

export interface UseAutosaveOptions<T> {
  /** Canonical value from the server. Changes reset the draft while clean. */
  initialValue: T
  /**
   * Validate a draft. Returns error messages; when non-empty the hook
   * never calls `save` and surfaces `failed` once the draft has been
   * touched (debounced or blurred).
   */
  validate: (value: T) => string[]
  /** Persist a value. Returns a structured result so the hook can branch. */
  save: (value: T) => Promise<SaveResult<T>>
  /** Debounce window in ms. Default 800. */
  debounceMs?: number
  /** Max retry attempts for transient failures. Default 3. */
  maxRetries?: number
  /** Initial retry backoff in ms; doubled each attempt. Default 500. */
  initialBackoffMs?: number
  /** When true, no new saves are started and dirty work settles to `offline`. */
  offline?: boolean
  /** Whether the user has interacted (touched) the field; gates `failed`. */
  touched?: boolean
}

export interface UseAutosaveResult<T> {
  draft: T
  setDraft: React.Dispatch<React.SetStateAction<T>>
  status: AutosaveStatus
  /** Human-readable status for the per-block badge. */
  statusLabel: string
  /** Last failure message (validation / exhausted transient / conflict). */
  error: string | null
  /** Server value when `status === 'conflict'`; null otherwise. */
  serverValue: T | null
  /** Validation errors for the current draft (empty when valid). */
  validationErrors: string[]
  /** Flush the debounce immediately (used on blur / explicit save). */
  flush: () => void
  /** Discard the local draft and adopt the server value (`conflict`). */
  discardDraft: () => void
  /** Re-attempt saving the local draft (`conflict` / `failed`). */
  retry: () => void
  /** True for every status except `clean` — use for navigation guards. */
  hasUnsavedWork: boolean
}

const DEFAULT_DEBOUNCE_MS = 800
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BACKOFF_MS = 500

const STATUS_LABELS: Record<AutosaveStatus, string> = {
  clean: 'Saved',
  dirty: 'Editing…',
  saving: 'Saving…',
  retrying: 'Retrying…',
  offline: 'Offline — will save when reconnected',
  failed: 'Save failed',
  conflict: 'Conflict — needs review',
}

/**
 * Race-safe save attempt. Resolves to either the save result or
 * `{ ok: false, kind: 'transient' }` when the promise rejects without a
 * structured result (network error, aborted fetch, etc.).
 */
async function runSave<T>(
  save: (value: T) => Promise<SaveResult<T>>,
  value: T,
): Promise<SaveResult<T>> {
  try {
    return await save(value)
  } catch (err) {
    return {
      ok: false,
      kind: 'transient',
      message: err instanceof Error ? err.message : 'Save failed.',
    }
  }
}

export function useAutosave<T>({
  initialValue,
  validate,
  save,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  initialBackoffMs = DEFAULT_BACKOFF_MS,
  offline = false,
  touched = false,
}: UseAutosaveOptions<T>): UseAutosaveResult<T> {
  const [draft, setDraftState] = React.useState<T>(initialValue)
  const [status, setStatus] = React.useState<AutosaveStatus>('clean')
  const [error, setError] = React.useState<string | null>(null)
  const [serverValue, setServerValue] = React.useState<T | null>(null)

  // Refs hold mutable values the async save loop must read at resolve
  // time without re-subscribing on every render.
  const revisionRef = React.useRef(0)
  const draftRef = React.useRef(initialValue)
  const initialRef = React.useRef(initialValue)
  const initialSerializedRef = React.useRef(JSON.stringify(initialValue))
  const inFlightRef = React.useRef(false)
  const pendingAfterFlightRef = React.useRef(false)
  const retryCountRef = React.useRef(0)
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const offlineRef = React.useRef<boolean>(offline)
  const touchedRef = React.useRef(touched)
  const saveRef = React.useRef(save)
  const validateRef = React.useRef(validate)
  const statusRef = React.useRef<AutosaveStatus>('clean')
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    saveRef.current = save
    validateRef.current = validate
    offlineRef.current = offline
    touchedRef.current = touched
    statusRef.current = status
  }, [save, validate, offline, touched, status])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  function setStatusSafe(next: AutosaveStatus) {
    statusRef.current = next
    if (mountedRef.current) setStatus(next)
  }

  function clearTimers() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  // Reset the draft to a new canonical value only while clean. Dirty,
  // saving, retrying, offline and failed drafts are preserved; a
  // conflict updates the offered server value but keeps the draft.
  const initialSerialized = JSON.stringify(initialValue)
  React.useEffect(() => {
    if (initialSerializedRef.current === initialSerialized) return
    initialSerializedRef.current = initialSerialized
    initialRef.current = initialValue
    const current = statusRef.current
    if (current === 'clean') {
      draftRef.current = initialValue
      revisionRef.current = 0
      retryCountRef.current = 0
      setServerValue(null)
      setError(null)
      setDraftState(initialValue)
    } else if (current === 'conflict') {
      // The server moved again while we were showing a conflict; update
      // the offered alternative but never touch the user's draft.
      setServerValue(initialValue)
    }
  }, [initialSerialized, initialValue])

  function setDraft(next: React.SetStateAction<T>) {
    const resolved =
      typeof next === 'function'
        ? (next as (prev: T) => T)(draftRef.current)
        : next
    draftRef.current = resolved
    revisionRef.current += 1
    // Editing clears a permanent validation failure if the new draft
    // validates; a conflict is sticky until explicitly resolved.
    if (statusRef.current === 'failed') {
      const errs = validateRef.current(resolved)
      if (errs.length === 0) {
        setError(null)
      }
    }
    if (statusRef.current !== 'conflict') {
      setStatusSafe('dirty')
    }
    // (Re)start the debounce timer.
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    if (offlineRef.current) {
      // Offline: hold the save; the offline effect below flushes on
      // reconnect.
      setStatusSafe('offline')
    } else {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void startSave(resolved, revisionRef.current)
      }, debounceMs)
    }
    setDraftState(resolved)
  }

  async function startSave(value: T, savedRevision: number) {
    // Validate first; invalid drafts never reach the server.
    const errs = validateRef.current(value)
    if (errs.length > 0) {
      if (touchedRef.current) {
        setError(errs.join('; '))
        setStatusSafe('failed')
      } else {
        // Not touched yet (e.g. debounce fired without blur); stay dirty
        // so the user can keep typing without a scary failure banner.
        setStatusSafe('dirty')
      }
      return
    }
    if (offlineRef.current) {
      setStatusSafe('offline')
      return
    }
    if (inFlightRef.current) {
      // A save is already running; queue a follow-up for the latest
      // draft once it settles.
      pendingAfterFlightRef.current = true
      return
    }
    inFlightRef.current = true
    setStatusSafe('saving')
    const result = await runSave(saveRef.current, value)
    if (!mountedRef.current) return
    inFlightRef.current = false

    if (result.ok) {
      retryCountRef.current = 0
      setError(null)
      setServerValue(null)
      // Only mark clean if no newer draft exists; otherwise immediately
      // schedule another save for the latest draft.
      if (revisionRef.current === savedRevision) {
        setStatusSafe('clean')
        pendingAfterFlightRef.current = false
      } else {
        pendingAfterFlightRef.current = false
        setStatusSafe('dirty')
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
        // The ref is mutated on every render (line 190); the rule's
        // control-flow analysis cannot see that, so it falsely narrows
        // the initial value to `false`.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (offlineRef.current) {
          setStatusSafe('offline')
        } else {
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null
            void startSave(draftRef.current, revisionRef.current)
          }, 0)
        }
      }
      return
    }

    // Failure branch.
    if (result.kind === 'conflict') {
      retryCountRef.current = 0
      setError(result.message ?? 'The block changed elsewhere.')
      setServerValue(result.serverValue ?? initialRef.current)
      setStatusSafe('conflict')
      return
    }
    if (result.kind === 'validation') {
      retryCountRef.current = 0
      setError(result.message ?? 'The block failed validation.')
      setStatusSafe('failed')
      return
    }
    // transient
    retryCountRef.current += 1
    if (retryCountRef.current > maxRetries) {
      setError(result.message ?? 'Save failed after several attempts.')
      setStatusSafe('failed')
      return
    }
    setError(result.message ?? 'Save failed. Retrying…')
    setStatusSafe('retrying')
    const backoff = initialBackoffMs * 2 ** (retryCountRef.current - 1)
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      // Re-save the latest draft (not the stale value) so retries
      // capture continued typing.
      void startSave(draftRef.current, revisionRef.current)
    }, backoff)
  }

  function flush() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    // A pending retry timer is superseded by an explicit flush.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (statusRef.current === 'conflict') {
      // Don't auto-flush through a conflict; the user must choose.
      return
    }
    if (statusRef.current === 'clean') {
      // Nothing to flush.
      return
    }
    void startSave(draftRef.current, revisionRef.current)
  }

  function discardDraft() {
    clearTimers()
    const canonical = serverValue ?? initialRef.current
    draftRef.current = canonical
    revisionRef.current += 1
    retryCountRef.current = 0
    setServerValue(null)
    setError(null)
    setDraftState(canonical)
    setStatusSafe('clean')
  }

  function retry() {
    clearTimers()
    retryCountRef.current = 0
    setServerValue(null)
    setError(null)
    // Read the latest canonical version on the next save by letting the
    // route's save() read the query cache at call time.
    setStatusSafe('dirty')
    void startSave(draftRef.current, revisionRef.current)
  }

  // Flush pending dirty work when connectivity returns.
  React.useEffect(() => {
    if (!offline && statusRef.current === 'offline') {
      setStatusSafe('dirty')
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void startSave(draftRef.current, revisionRef.current)
      }, debounceMs)
    }
  }, [offline, debounceMs])

  const validationErrors = validateRef.current(draft)

  return {
    draft,
    setDraft,
    status,
    statusLabel: STATUS_LABELS[status],
    error,
    serverValue,
    validationErrors,
    flush,
    discardDraft,
    retry,
    hasUnsavedWork: status !== 'clean',
  }
}
