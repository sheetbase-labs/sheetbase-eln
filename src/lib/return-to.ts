/**
 * Leaving a task and coming back to it.
 *
 * A dialog that sends a person elsewhere to unblock themselves (certify a
 * signature, create a model) hands over the page to come back to as `returnTo`
 * (see `safeReturnTo` in `create-context-search.ts`). When the task was an open
 * dialog, the return path also carries `reopen=<task>` so the page opens the
 * same dialog again instead of leaving the person to find it.
 */
import { safeReturnTo } from './create-context-search'

/** The dialogs a page can reopen on return. */
export type ReopenTask = 'submit' | 'sign'

const TASKS: readonly ReopenTask[] = ['submit', 'sign']

/** `/records/1` + `submit` becomes `/records/1?reopen=submit`. */
export function withReopen(path: string, task: ReopenTask): string {
  const url = new URL(path, 'https://return.invalid')
  url.searchParams.set('reopen', task)
  return `${url.pathname}${url.search}${url.hash}`
}

/** The task a page should reopen, from its raw search. */
export function reopenTaskFromSearch(search: unknown): ReopenTask | undefined {
  if (!search || typeof search !== 'object') return undefined
  const value = (search as Record<string, unknown>).reopen
  return TASKS.find((task) => task === value)
}

/** The task a return path reopens, for naming the way back. */
export function reopenTaskOf(returnTo: string | undefined): ReopenTask | null {
  const safe = safeReturnTo(returnTo)
  if (!safe) return null
  const value = new URL(safe, 'https://return.invalid').searchParams.get(
    'reopen',
  )
  return TASKS.find((task) => task === value) ?? null
}

/** The label for the control that goes back. */
export function returnLabel(returnTo: string | undefined): string {
  const task = reopenTaskOf(returnTo)
  if (task === 'submit') return 'Back to Submit'
  if (task === 'sign') return 'Back to Sign'
  return 'Back to what you were doing'
}

/**
 * The page the person is on now, as a path to come back to (reopening `task`
 * when one is given). Browser only: there is nowhere to return to on the
 * server, and the controls that use it render after interaction.
 */
export function returnToHere(task?: ReopenTask): string | undefined {
  if (typeof window === 'undefined') return undefined
  const path = `${window.location.pathname}${window.location.search}`
  return safeReturnTo(task ? withReopen(path, task) : path)
}
