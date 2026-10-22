/**
 * Pipeline authoring helpers: the parameter and step lists the Steps editor
 * edits, as pure functions over the configuration's own shapes. The shared
 * validator (`validatePipelineConfig`) stays the judge of what is acceptable;
 * these only keep an edit from producing something it can never accept (a
 * required parameter with a default, a skip pointing at a step that was
 * removed).
 */
import {
  DEFAULT_SQL_STATEMENT,
  isStarterStatement,
  pythonSkeleton,
} from './python'
import type { PythonContract, SkeletonOptions } from './python'
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
      statement: DEFAULT_SQL_STATEMENT,
    },
  ]
}

/**
 * Change a step's language. An untouched starter statement is swapped for the
 * other language's starter, so choosing Python never leaves SQL in the editor
 * (and the reverse); anything the person has written is kept as it is, and a
 * Python-only data contract goes with the language.
 */
export function setStepLanguage(
  list: PipelineStep[],
  index: number,
  language: PipelineStep['language'],
  context: Omit<SkeletonOptions, 'contract'> = { inputs: [], parameters: [] },
): PipelineStep[] {
  return list.map((step, position) => {
    if (position !== index || step.language === language) return step
    const { contract, ...rest } = step
    return {
      ...rest,
      language,
      statement: statementForLanguage(
        step.statement,
        language,
        { ...context, contract },
        DEFAULT_SQL_STATEMENT,
      ),
      ...(language === 'python' && contract ? { contract } : {}),
    }
  })
}

/**
 * The statement to show after a language change: an untouched starter becomes
 * the new language's starter; code the person wrote is left alone.
 */
export function statementForLanguage(
  statement: string,
  language: 'sql' | 'python',
  context: SkeletonOptions,
  sqlStarter = '',
): string {
  if (!isStarterStatement(statement)) return statement
  return language === 'python' ? pythonSkeleton(context) : sqlStarter
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

/** Set or clear a Python step's data contract. */
export function setStepContract(
  list: PipelineStep[],
  index: number,
  contract: PythonContract | undefined,
): PipelineStep[] {
  return list.map((step, position) => {
    if (position !== index) return step
    const { contract: _old, ...rest } = step
    return contract ? { ...rest, contract } : rest
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

/**
 * A pipeline key suggested from its name: lower-case words joined by `_`, in
 * the shape the database accepts (a letter first, then letters, digits and
 * underscores, at most 60 characters). Empty when the name has nothing to use.
 */
export function suggestPipelineKey(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug) return ''
  const lettered = /^[a-z]/.test(slug) ? slug : `p_${slug}`
  return lettered.slice(0, 60).replace(/_+$/, '')
}

/** The result column feeding a schema field, or '' when the column is called
 * the same as the field (the default). */
export function columnForField(
  mapping: Record<string, string> | null | undefined,
  fieldKey: string,
): string {
  for (const [column, target] of Object.entries(mapping ?? {})) {
    if (target === fieldKey) return column
  }
  return ''
}

/** Feed a schema field from a differently named result column; an empty or
 * identical column clears the mapping. Returns null when nothing is mapped. */
export function setFieldColumn(
  mapping: Record<string, string> | null | undefined,
  fieldKey: string,
  column: string,
): Record<string, string> | null {
  const next: Record<string, string> = {}
  for (const [existing, target] of Object.entries(mapping ?? {})) {
    if (target !== fieldKey) next[existing] = target
  }
  const trimmed = column.trim()
  if (trimmed && trimmed !== fieldKey) next[trimmed] = fieldKey
  return Object.keys(next).length ? next : null
}

export interface OutputFit {
  /** Required schema fields no result column feeds. */
  missing: string[]
  /** Result columns that no schema field takes. */
  unmatched: string[]
}

/** How a known set of result columns lines up with a schema's fields, using
 * the same rule as the executor: a column feeds the field its mapping names,
 * or the field with its own name. */
export function checkOutputFit(
  fields: ReadonlyArray<{ key: string; required: boolean }>,
  mapping: Record<string, string> | null | undefined,
  resultColumns: readonly string[],
): OutputFit {
  const keys = new Set(fields.map((f) => f.key))
  const fed = new Set<string>()
  const unmatched: string[] = []
  for (const column of resultColumns) {
    const target = mapping?.[column] ?? column
    if (keys.has(target)) fed.add(target)
    else unmatched.push(column)
  }
  return {
    missing: fields
      .filter((f) => f.required && !fed.has(f.key))
      .map((f) => f.key),
    unmatched,
  }
}
