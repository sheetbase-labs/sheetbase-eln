import { createFileRoute, redirect } from '@tanstack/react-router'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { AiPipelineBox } from '#/components/pipelines/ai-pipeline-box'
import { StepInspector } from '#/components/pipelines/step-list/inspector'
import { StepList } from '#/components/pipelines/step-list/step-list'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'

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

function PipelineSteps() {
  const editor = usePipelineEditor()

  if (!editor.config || !editor.aiContext) return null

  const view = editor.aiContext

  return (
    <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 text-label text-fg-muted">
        <span className="min-w-0 flex-1">
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

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <StepList />
        </div>
        <StepInspector />
      </div>
    </div>
  )
}
