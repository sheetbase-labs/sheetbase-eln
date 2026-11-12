import { z } from 'zod'

import { parsePluginName } from './extensions/points'
import {
  ExtensionRunError,
  defaultDeps,
  openCallable,
} from './extensions/runtime.server'
import type { ExtensionRuntimeDeps } from './extensions/runtime.server'
import type { PipelinePluginDataStep as PipelineStep } from './pipelines/config'
import { pipelineJsonObjectSchema } from './pipelines/types'
import type { PythonInputRow } from './pipeline-python.server'

/** A table a plugin step reads or returns: the pipeline's rows. */
type Rows = PythonInputRow[]

/** A value a plugin step is given: JSON, or the table of rows a reference names. */
type PluginValue = z.core.util.JSONType | Rows

/** What a plugin step can read: the result so far, the inputs, earlier steps and settings. */
export interface PluginStepScope {
  parameters: Record<string, z.core.util.JSONType>
  /** The result of the step before, if any step ran. */
  previous: Rows | undefined
  /** Rows of a declared input, read when a step asks for them. */
  inputRows: (name: string) => Promise<Rows | undefined>
  /** Rows each earlier step in this run gave back, by step name. */
  steps: Record<string, Rows>
}

export class PluginStepError extends Error {}

async function resolveRef(
  ref: string,
  scope: PluginStepScope,
): Promise<PluginValue> {
  const [root, name] = ref.split('.')

  if (root === 'previous') {
    if (!scope.previous)
      throw new PluginStepError(
        'There is no result before this step. Pick an input or an earlier step as its table.',
      )

    return scope.previous
  }

  if (root === 'parameters') {
    if (!name || !Object.hasOwn(scope.parameters, name))
      throw new PluginStepError(`The pipeline setting “${name}” has no value.`)

    return scope.parameters[name]
  }

  if (root === 'inputs') {
    const rows = name ? await scope.inputRows(name) : undefined

    if (!rows)
      throw new PluginStepError(`This pipeline has no input called “${name}”.`)

    return rows
  }

  if (root === 'steps') {
    const rows = name && Object.hasOwn(scope.steps, name) && scope.steps[name]

    if (!rows)
      throw new PluginStepError(
        `Step “${name}” has not run before this step, so there is no table from it.`,
      )

    return rows
  }

  throw new PluginStepError('That table reference is not one a step can read.')
}

/**
 * Runs one plugin step in the middle of a pipeline: the plugin gets the tables
 * the step names and gives one table back, which the next step reads as
 * `previous`. It runs in the same isolated runner as every plugin step; nothing
 * about it is looser because it sits between two other steps.
 */
export async function runPluginStep(
  args: {
    workspaceId: string
    actorUserId: string
    step: PipelineStep
    /** Absent means the workspace's installed plugins. */
    deps?: ExtensionRuntimeDeps
  },
  scope: PluginStepScope,
): Promise<{ rows: Rows }> {
  const plugin = args.step.plugin
  const name = parsePluginName(plugin.operation)

  if (!name) throw new PluginStepError('This step does not name a plugin step.')

  try {
    const deps = args.deps ?? defaultDeps()
    const opened = await openCallable(deps, args.workspaceId, name.key, name.id)

    // Only a plugin step that turns tables into a table belongs between steps.
    // A publisher or a check shares a name space with it and must not run here.
    if (opened.callable.point !== 'pipeline-steps')
      throw new PluginStepError(
        'Only a plugin step that gives back a table can run inside a pipeline.',
      )
    const input: Record<string, PluginValue | undefined> = {}

    for (const [key, value] of Object.entries(plugin.arguments)) {
      const object = pipelineJsonObjectSchema.safeParse(value)
      const ref = object.success ? z.string().safeParse(object.data.$ref) : null

      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- An input and a step table read the same tables in the order the step names them, so one missing reference fails with its own message first.
      input[key] = ref?.success ? await resolveRef(ref.data, scope) : value
    }

    // A table the step does not name is the result so far, the usual case.
    for (const table of opened.callable.tableNames)
      if (input[table] === undefined && scope.previous)
        input[table] = scope.previous

    // A step may call into the app (`host_call`) as the run's person, changes
    // included, like the API and the agent can.
    const { invokeWithHostCalls, personClient } =
      await import('./extensions/operation-host.server')

    const hosted = await invokeWithHostCalls(
      {
        workspaceId: args.workspaceId,
        actorUserId: args.actorUserId,
        extensionKey: name.key,
        itemId: name.id,
        input,
      },
      {
        workspaceId: args.workspaceId,
        userId: args.actorUserId,
        approve: 'all',
        client: () => personClient(args.workspaceId, args.actorUserId),
      },
      deps,
    )

    if (hosted.kind === 'confirm')
      throw new PluginStepError('The plugin step could not carry on.')

    const output = pipelineJsonObjectSchema.safeParse(hosted.result.output)

    if (!output.success)
      throw new PluginStepError('The plugin step did not give back a table.')

    const table = z.array(pipelineJsonObjectSchema).safeParse(output.data.rows)

    if (!table.success)
      throw new PluginStepError('The plugin step did not give back a table.')

    return { rows: table.data }
  } catch (error) {
    if (error instanceof PluginStepError) throw error
    throw new PluginStepError(
      error instanceof ExtensionRunError || error instanceof Error
        ? error.message
        : String(error),
    )
  }
}
