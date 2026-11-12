import {
  createFileRoute,
  redirect,
  useSearch,
} from '@tanstack/react-router'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { AiPipelineBox } from '#/components/pipelines/ai-pipeline-box'
import { StepList } from '#/components/pipelines/step-list/step-list'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import {
  draftVersion,
  usePipelineVersions,
} from '#/components/pipelines/pipelines-data'
import { SimpleEditor } from '#/components/pipelines/simple/simple-editor'
import { recipeOf } from '#/lib/pipelines/simple/compile'
import { templateById } from '#/lib/pipelines/templates'

/** The Standard editor: every step in order, with the selected step's settings beside it. */
export const Route = createFileRoute('/pipelines/$pipelineId/steps')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: PipelineSteps,
})

/** A Simple pipeline is edited as a recipe; every other mode in the step list below. */
function PipelineSteps() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []

  const source =
    draftVersion(list) ??
    list.find((v) => v.lifecycle === 'published') ??
    list.at(0)

  // SAFETY: `template` is the only search key this page reads; any other value is ignored.
  const search = useSearch({ strict: false }) as { template?: string }
  const template = search.template ? templateById(search.template) : undefined

  if (recipeOf(source?.configuration) || (!source && template))
    return (
      <SimpleEditor
        pipelineId={pipelineId}
        workspaceId={context.workspace?.id ?? ''}
        starting={
          template
            ? { recipe: template.recipe, fromTemplate: template.title }
            : undefined
        }
      />
    )

  return <StandardSteps />
}

function StandardSteps() {
  const editor = usePipelineEditor()

  if (!editor.config || !editor.aiContext) return null

  const view = editor.aiContext

  return (
    <div className="pb-scope flex min-w-0 flex-1 flex-col gap-2 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 text-label text-fg-muted">
        <h2 className="m-0 font-heading text-[15px] font-semibold text-fg">
          {t('data.stepList.heading')}
        </h2>
        <span className="min-w-0 flex-1 text-right">
          {editor.trialAt
            ? t('data.stepList.triedAt', {
                when: formatNotebookDateTime(editor.trialAt.toISOString(), {
                  zone: true,
                }),
              })
            : t('data.stepList.notTriedYet')}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={
            !editor.dirty || !editor.canSave || editor.saveDraft.isPending
          }
          onClick={() => editor.saveDraft.mutate()}
        >
          {t('data.stepList.saveDraft')}
        </Button>
      </div>

      {editor.pythonUnavailable ? (
        <Notice tone="bad" title={t('data.pipelineSteps.pythonAvailable')}>
          {editor.pythonUnavailable}
        </Notice>
      ) : null}

      <AiPipelineBox
        current={{
          description: view.description,
          inputs: view.inputs,
          parameters: view.parameters,
          statement: view.transform.statement,
          language: view.transform.language,
          steps: view.steps ?? [],
        }}
        onApply={editor.applyAiDraft}
      />

      <StepList />
    </div>
  )
}
