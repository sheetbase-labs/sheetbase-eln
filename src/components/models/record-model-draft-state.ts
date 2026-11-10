import type { RecordModelVersion } from '#/lib/record-model-versions'
import type { ModelVersionField } from './record-model-fields'

export function initialDraftCopy(draft: RecordModelVersion) {
  return {
    fields: draft.definition.fields,
    revision: draft.revision,
    savedAt: draft.updated_at ?? null,
    dirty: false,
    conflict: false,
  }
}

type DraftCopy = ReturnType<typeof initialDraftCopy>

type DraftAction =
  | { type: 'edit'; fields: ModelVersionField[] }
  | {
      type: 'saved'
      version: RecordModelVersion
      submitted: ModelVersionField[]
      savedAt: string
    }
  | { type: 'received'; version: RecordModelVersion }
  | { type: 'conflict' }

/** A working copy belongs to one draft id. Its owner remounts on id changes.
 * Clean copies follow newer revisions; dirty copies retain the author's edits
 * and require explicit conflict resolution rather than silently rebasing them. */
export function draftCopyReducer(
  state: DraftCopy,
  action: DraftAction,
): DraftCopy {
  switch (action.type) {
    case 'edit':
      return { ...state, fields: action.fields, dirty: true }
    case 'saved':
      return {
        ...state,
        revision: action.version.revision,
        savedAt: action.savedAt,
        dirty: state.fields !== action.submitted,
      }
    case 'received':
      if (action.version.revision <= state.revision) return state

      return state.dirty
        ? { ...state, conflict: true }
        : initialDraftCopy(action.version)
    case 'conflict':
      return { ...state, conflict: true }
  }
}
