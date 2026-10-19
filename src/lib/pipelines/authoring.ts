/**
 * Pipeline authoring helpers: the parameter and step lists the Steps editor
 * edits, as pure functions over the configuration's own shapes. The shared
 * validator (`validatePipelineConfig`) stays the judge of what is acceptable;
 * these only keep an edit from producing something it can never accept (a
 * required parameter with a default, a skip pointing at a step that was
 * removed).
 */
import type {
  ParameterType,
  PipelineParameter,
  PipelineStep,
  PipelineStepConfirm,
} from './config'

function uniqueName(base: string, taken: string[]): string {
  let n = taken.length + 1
  while (taken.includes(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

export function addParameter(list: PipelineParameter[]): PipelineParameter[] {
  return [
    ...list,
    {
      name: uniqueName(
        'parameter',
        list.map((p) => p.name),
      ),
      type: 'text',
      required: false,
    },
  ]
}

/** A parameter's default as the type's value, or undefined for blank/invalid. */
export function parseDefault(type: ParameterType, text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  switch (type) {
    case 'integer': {
      const n = Number(trimmed)
      return Number.isInteger(n) ? n : undefined
    }
    case 'decimal': {
      const n = Number(trimmed)
      return Number.isFinite(n) ? n : undefined
    }
    case 'boolean':
      return trimmed === 'true' ? true : trimmed === 'false' ? false : undefined
    default:
      return trimmed
  }
}

export function updateParameter(
  list: PipelineParameter[],
  index: number,
  patch: Partial<PipelineParameter>,
): PipelineParameter[] {
  return list.map((parameter, position) => {
    if (position !== index) return parameter
    const next = { ...parameter, ...patch }
    // A required parameter has no default, and a default belongs to a type.
    if (next.required || patch.type !== undefined) delete next.default
    if (next.default === undefined) delete next.default
    return next
  })
}

export function removeParameter(
  list: PipelineParameter[],
  index: number,
): PipelineParameter[] {
  return list.filter((_, position) => position !== index)
}

export function addStep(list: PipelineStep[]): PipelineStep[] {
  return [
    ...list,
    {
      name: uniqueName(
        'step',
        list.map((s) => s.name),
      ),
      language: 'sql',
      statement: 'select * from previous',
    },
  ]
}

export function updateStep(
  list: PipelineStep[],
  index: number,
  patch: Partial<PipelineStep>,
): PipelineStep[] {
  const renamed = patch.name !== undefined ? list[index].name : null
  return list.map((step, position) => {
    if (position === index) return { ...step, ...patch }
    // A rename follows the skips that pointed at the old name.
    if (renamed && step.confirm?.skipSteps?.includes(renamed)) {
      return {
        ...step,
        confirm: {
          ...step.confirm,
          skipSteps: step.confirm.skipSteps.map((n) =>
            n === renamed ? (patch.name as string) : n,
          ),
        },
      }
    }
    return step
  })
}

export function moveStep(
  list: PipelineStep[],
  index: number,
  direction: -1 | 1,
): PipelineStep[] {
  const target = index + direction
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function removeStep(
  list: PipelineStep[],
  index: number,
): PipelineStep[] {
  const name = list[index].name
  return list
    .filter((_, position) => position !== index)
    .map((step) => {
      if (!step.confirm?.skipSteps?.includes(name)) return step
      return {
        ...step,
        confirm: {
          ...step.confirm,
          skipSteps: step.confirm.skipSteps.filter((n) => n !== name),
        },
      }
    })
}

/** The confirm a step starts with: one optional note, 24 hours, ask again. */
export function defaultConfirm(askedUserIds: string[]): PipelineStepConfirm {
  return {
    fields: [{ key: 'note', label: 'Note', type: 'text', required: false }],
    askedUserIds,
    noAnswer: 'reask',
    expiresHours: 24,
  }
}

export function setStepConfirm(
  list: PipelineStep[],
  index: number,
  confirm: PipelineStepConfirm | undefined,
): PipelineStep[] {
  return list.map((step, position) => {
    if (position !== index) return step
    const { confirm: _old, ...rest } = step
    return confirm ? { ...rest, confirm } : rest
  })
}

export function setConfirmPatch(
  list: PipelineStep[],
  index: number,
  patch: Partial<PipelineStepConfirm>,
): PipelineStep[] {
  const confirm = list[index].confirm
  if (!confirm) return list
  return setStepConfirm(list, index, { ...confirm, ...patch })
}
