import { t } from '#/copy'

/** One place a plugin's table box can read from: a reference path and its words. */
export interface TableSource {
  ref: string
  label: string
}

/** Sources available to a plugin step in the middle of a pipeline. */
export function pluginStepSources(args: {
  hasPrevious: boolean
  transformRuns: boolean
  inputs: Array<{ name: string }>
  earlier: string[]
}): TableSource[] {
  return [
    ...(args.hasPrevious
      ? [{ ref: 'previous', label: t('data.pluginSteps.resultSoFar') }]
      : []),
    ...args.inputs.map((input) => ({
      ref: `inputs.${input.name}`,
      label: t('data.pluginSteps.inputTable', { name: input.name }),
    })),
    ...(args.transformRuns
      ? [
          {
            ref: 'steps.analysis',
            label: t('data.pluginSteps.rowsFrom', { name: 'analysis' }),
          },
        ]
      : []),
    ...args.earlier.map((name) => ({
      ref: `steps.${name}`,
      label: t('data.pluginSteps.rowsFrom', { name }),
    })),
  ]
}
