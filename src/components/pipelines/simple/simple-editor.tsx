import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import {
  currentVersion,
  draftVersion,
  usePipelineDefinition,
  usePipelineOutputTargets,
  usePipelineVersions,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { ConvertDialog } from '#/components/pipelines/convert-dialog'
import { t } from '#/copy'
import { words } from '#/lib/pipelines/simple/words'
import { notebookDataClient } from '#/lib/notebook-data'
import { simpleConfig, recipeOf } from '#/lib/pipelines/simple/compile'
import { recipeProblems } from '#/lib/pipelines/simple/recipe'
import type { PipelineRecipe } from '#/lib/pipelines/simple/recipe'
import { validatePipelineConfig } from '#/lib/pipelines/config'
import { usePipelineEditor } from '../step-list/use-pipeline-editor'
import { DryRunPanel } from './dry-run-panel'
import { HowItRuns } from './how-it-runs'
import { RecipeEditor } from './recipe-editor'
import { useNotificationChannels } from './use-simple-data'
import { LastRuns } from './last-runs'

const e = words('editor')

/**
 * The Steps tab of a Simple pipeline: the recipe on the left, a dry run of the
 * draft on the latest snapshot on the right. The recipe is saved on the draft
 * version with the steps it compiles to, so nothing but steps ever runs.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- the editor owns the recipe, its checks, save and the dialogs that share them.
export function SimpleEditor({
  pipelineId,
  workspaceId,
  starting,
}: {
  pipelineId: string
  workspaceId: string
  /** A template or a blank recipe a new pipeline starts from, before anything is saved. */
  starting?: { recipe: PipelineRecipe; fromTemplate: string | null }
}) {
  const definition = usePipelineDefinition(pipelineId)
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const draft = draftVersion(list)
  const published = list.find((v) => v.lifecycle === 'published')
  const source = draft ?? currentVersion(list)
  const stored = recipeOf(source?.configuration)
  const [edited, setEdited] = useState<PipelineRecipe | null>(null)
  const recipe = edited ?? stored ?? starting?.recipe
  const members = useWorkspaceMemberNames()
  const channels = useNotificationChannels()
  const targets = usePipelineOutputTargets()
  const queryClient = useQueryClient()
  const [convertOpen, setConvertOpen] = useState(false)
  const d = definition.data

  const problems = useMemo(
    () => (recipe ? recipeProblems(recipe) : []),
    [recipe],
  )

  const built = useMemo(
    () =>
      recipe && problems.length === 0
        ? simpleConfig(recipe, d?.description ?? undefined)
        : null,
    [recipe, problems.length, d?.description],
  )

  const compiledProblems = useMemo(
    () => (built ? validatePipelineConfig(built) : []),
    [built],
  )

  const complete = problems.length === 0 && compiledProblems.length === 0
  const dirty = edited !== null || (!source && Boolean(starting))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

  const persist = async (): Promise<string | undefined> => {
    if (!built) throw new Error(e('finish'))

    const saved = draft
      ? await notebookDataClient.rpc(
          'update_pipeline_definition_version_draft',
          {
            p_workspace_id: workspaceId,
            p_version_id: draft.id,
            p_expected_revision: draft.revision,
            p_configuration: built,
          },
        )
      : await notebookDataClient.rpc('create_pipeline_definition_version', {
          p_workspace_id: workspaceId,
          p_definition_id: pipelineId,
          p_configuration: built,
        })

    setEdited(null)

    // SAFETY: the version rpcs return the version row, whose id is all that is read.
    return (saved as { id?: string } | null)?.id ?? draft?.id
  }

  const save = useMutation({
    mutationFn: persist,
    onSuccess: async () => {
      await invalidate()
      toast(e('saved'))
    },
    onError: (error) =>
      toast.error(e('couldNotSave'), {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  // Tell the header what is unsaved, so its Publish saves the recipe first. The
  // header calls the latest save through a ref, so only the flags re-announce.
  const { setSimple } = usePipelineEditor()
  const persistRef = useRef(persist)

  useEffect(() => {
    persistRef.current = persist
  })

  useEffect(() => {
    setSimple({ dirty, complete, save: () => persistRef.current() })

    return () => setSimple(null)
  }, [dirty, complete, setSimple])

  if (!recipe || !d) return null

  const displayId = d.display_id ?? d.key
  const datasets = targets.data?.datasets ?? []
  const dataset = datasets.find((x) => x.id === recipe.when.datasetId)

  const datasetLabel = dataset
    ? dataset.displayId
      ? `${dataset.displayId} ${dataset.name}`
      : dataset.name
    : '—'

  const destinations = (id: string) => {
    const channel = (channels.data ?? []).find((c) => c.id === id)

    return channel ? channel.description || channel.key : '—'
  }

  const datasetName = (id: string) =>
    datasets.find((x) => x.id === id)?.name ?? '—'

  const owner = d.created_by_user_id
    ? (members.data?.[d.created_by_user_id] ?? null)
    : null

  return (
    <div className="flex min-w-0 flex-1 overflow-auto max-lg:flex-col">
      <div className="flex min-w-0 flex-1 flex-col gap-4 bg-bg px-6 py-5 max-md:px-4">
        {starting?.fromTemplate && !source ? (
          <Notice tone="info" icon="info">
            {e('template', { template: starting.fromTemplate })}
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 text-label text-fg-muted">
          <h2 className="m-0 font-heading text-[15px] font-semibold text-fg">
            {t('data.stepList.heading')}
          </h2>
          <span className="min-w-0 flex-1 text-right">
            {dirty ? e('unsaved') : ''}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!complete || !dirty || save.isPending}
            title={complete ? undefined : e('finish')}
            onClick={() => save.mutate()}
          >
            {save.isPending ? e('saving') : e('save')}
          </Button>
        </div>
        {!complete && problems.length ? (
          <p className="m-0 text-label text-fg-muted">{problems[0].message}</p>
        ) : null}
        <RecipeEditor
          recipe={recipe}
          onChange={setEdited}
          onConvert={() => setConvertOpen(true)}
          pipelineLabel={displayId}
          ownerName={owner}
        />
        <HowItRuns
          pipelineId={pipelineId}
          workspaceId={workspaceId}
          recipe={recipe}
          datasetLabel={datasetLabel}
          pipelineLink={`/pipelines/${pipelineId}/triggers`}
          onChange={setEdited}
        />
      </div>
      <aside
        aria-label={e('history')}
        className="flex w-[300px] shrink-0 flex-col gap-5 border-l border-border bg-surface p-4 max-lg:w-full max-lg:border-l-0 max-lg:border-t"
      >
        <DryRunPanel
          workspaceId={workspaceId}
          recipe={recipe}
          complete={complete}
          datasetLabel={datasetLabel}
          people={members.data ?? {}}
          destinations={destinations}
          datasetName={datasetName}
        />
        <LastRuns
          pipelineId={pipelineId}
          published={published?.version ?? null}
          draft={draft?.version ?? null}
        />
      </aside>
      {source && stored ? (
        <>
          <ConvertDialog
            open={convertOpen}
            onOpenChange={setConvertOpen}
            workspaceId={workspaceId}
            pipelineId={pipelineId}
            displayId={displayId}
            name={d.name}
            draftVersion={draft ? draft.version : source.version + 1}
            publishedVersion={published?.version ?? null}
            onDuplicate={() => setConvertOpen(false)}
            onConverted={() => setEdited(null)}
          />
        </>
      ) : null}
    </div>
  )
}
