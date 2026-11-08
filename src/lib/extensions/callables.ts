/**
 * Plugin work that is called by name: operations, calculators and pipeline
 * steps.
 *
 * The three read the same way from outside: named inputs in, named outputs
 * back. A calculator is an operation that only reads. A pipeline step is an
 * operation whose inputs are tables (a list of row objects each) and whose one
 * output, `rows`, is the table it makes. Treating them as one shape means the
 * assistant tool, the MCP tool, the API route and the pipeline action are
 * generated once and cover all three, and a plugin author declares what the
 * work is, not how it is exposed.
 *
 * Ids are unique across the three in one plugin, because they share one name,
 * `plugin.<key>.<id>`. The manifest check refuses a repeat.
 *
 * Pure and browser safe.
 */
import type { ExtensionManifest } from './manifest'
import type { ExtensionOperationDeclaration, ExtensionField } from './points'

export const CALLABLE_POINTS = [
  'operations',
  'calculators',
  'pipeline-steps',
] as const
export type CallablePoint = (typeof CALLABLE_POINTS)[number]

export function isCallablePoint(value: string): value is CallablePoint {
  return (CALLABLE_POINTS as readonly string[]).includes(value)
}

/** How the Python function is called: a dictionary in, or named tables in. */
export type CallableRunKind = 'operation' | 'step'

export interface CallableItem {
  point: CallablePoint
  id: string
  /** The shape every surface reads. */
  declaration: ExtensionOperationDeclaration
  runKind: CallableRunKind
  /** For a step: which inputs are tables (the rest are settings). */
  tableNames: string[]
}

/** The output every pipeline step has: the table it made. */
export const STEP_OUTPUT_NAME = 'rows'

export function callableItems(manifest: ExtensionManifest): CallableItem[] {
  const out: CallableItem[] = []
  for (const declaration of manifest.contributions.operations ?? []) {
    out.push({
      point: 'operations',
      id: declaration.id,
      declaration,
      runKind: 'operation',
      tableNames: [],
    })
  }
  for (const calc of manifest.contributions.calculators ?? []) {
    out.push({
      point: 'calculators',
      id: calc.id,
      declaration: {
        id: calc.id,
        title: calc.title,
        description: calc.description,
        access: 'read',
        inputs: calc.inputs,
        outputs: calc.outputs,
        runner: calc.runner,
      },
      runKind: 'operation',
      tableNames: [],
    })
  }
  for (const step of manifest.contributions['pipeline-steps'] ?? []) {
    const tables: ExtensionField[] = step.tables.map((table) => ({
      name: table.name,
      type: 'json',
      required: table.required,
      description: `Rows of ${table.label}: a list of objects, one per row.`,
    }))
    out.push({
      point: 'pipeline-steps',
      id: step.id,
      declaration: {
        id: step.id,
        title: step.title,
        description:
          step.description ??
          `Takes ${step.tables.map((t) => t.label).join(' and ')} and gives back a table.`,
        access: 'read',
        inputs: [...tables, ...step.parameters],
        outputs: [
          {
            name: STEP_OUTPUT_NAME,
            type: 'json',
            required: true,
            description: `The table this step makes: ${step.result.columns.map((c) => c.name).join(', ')}.`,
          },
        ],
        runner: step.runner,
      },
      runKind: 'step',
      tableNames: step.tables.map((table) => table.name),
    })
  }
  return out
}

export function findCallable(
  manifest: ExtensionManifest,
  id: string,
): CallableItem | undefined {
  return callableItems(manifest).find((item) => item.id === id)
}
