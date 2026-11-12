import type { PipelineRecipe } from '../simple/recipe'
import { emptyRecipe } from '../simple/recipe'

/**
 * Starting points for a new Simple pipeline. A template is a recipe with the
 * choices that depend on the lab (the dataset, the column, the people) left
 * for the person to pick, so it never starts out looking finished.
 */
export interface PipelineTemplate {
  id: string
  title: string
  summary: string
  /** The name the new pipeline starts with. */
  pipelineName: string
  recipe: PipelineRecipe
}

/** The blank recipe the "Start empty" choice opens. */
export const BLANK_TEMPLATE: PipelineTemplate = {
  id: 'blank',
  title: 'A blank recipe',
  summary: 'Start with nothing chosen.',
  pipelineName: 'New pipeline',
  recipe: emptyRecipe(),
}

export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    id: 'check-ranges',
    title: 'When an import arrives, check ranges',
    summary: 'Flags rows outside the limits and asks someone to confirm them.',
    pipelineName: 'Check ranges on import',
    recipe: {
      ...emptyRecipe(),
      conditions: [{ column: '', operator: 'above', value: 0 }],
      actions: [
        { kind: 'flag_rows', column: '', fieldId: '' },
        {
          kind: 'ask',
          mode: 'confirm',
          userId: '',
          hours: 24,
          noAnswer: 'reask',
        },
      ],
    },
  },
  {
    id: 'tell-the-team',
    title: 'When a snapshot arrives, tell the team',
    summary: 'Posts to a channel each time new data lands in a dataset.',
    pipelineName: 'Tell the team about new data',
    recipe: {
      ...emptyRecipe(),
      actions: [{ kind: 'notify', channel: 'teams', subscriptionId: '' }],
    },
  },
]

export function templateById(id: string): PipelineTemplate | undefined {
  return [BLANK_TEMPLATE, ...PIPELINE_TEMPLATES].find(
    (template) => template.id === id,
  )
}
