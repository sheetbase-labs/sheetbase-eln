import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
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
import { DuplicateDialog } from '#/components/pipelines/history/duplicate-dialog'
import { t } from '#/copy'
import { words } from '#/lib/pipelines/simple/words'
import { notebookDataClient } from '#/lib/notebook-data'
import { simpleConfig, recipeOf } from '#/lib/pipelines/simple/compile'
import { recipeProblems } from '#/lib/pipelines/simple/recipe'
import type { PipelineRecipe } from '#/lib/pipelines/simple/recipe'
import { validatePipelineConfig } from '#/lib/pipelines/config'
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
  const [duplicateOpen, setDuplicateOpen] = useState(false)
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
  const dirty = edited !== null || (!draft && Boolean(starting))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

  const save = useMutation({
    mutationFn: () => {
      if (!built) throw new Error(e('finish'))

      return draft
        ? notebookDataClient.rpc('update_pipeline_definition_version_draft', {
            p_workspace_id: workspaceId,
            p_version_id: draft.id,
            p_expected_revision: draft.revision,
            p_configuration: built,
          })
        : notebookDataClient.rpc('create_pipeline_definition_version', {
            p_workspace_id: workspaceId,
            p_definition_id: pipelineId,
            p_configuration: built,
          })
    },
    onSuccess: async () => {
      await invalidate()
      setEdited(null)
      toast(e('saved'))
    },
    onError: (error) =>
      toast.error(e('couldNotSave'), {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  const publish = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error(e('savedFirst'))

      return notebookDataClient.rpc('publish_pipeline_definition_version', {
        p_workspace_id: workspaceId,
        p_version_id: draft.id,
      })
    },
    onSuccess: async () => {
      await invalidate()
      toast(e('published'))
    },
    onError: (error) =>
      toast.error(e('couldNotPublish'), {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

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
    <div className="flex min-w-0 flex-1 gap-5 overflow-auto bg-bg px-6 py-5 max-lg:flex-col max-md:px-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {starting?.fromTemplate && !draft ? (
          <Notice tone="info" icon="info">
            {e('template', { template: starting.fromTemplate })}
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={draft && !dirty ? 'secondary' : 'primary'}
            disabled={!complete || !dirty || save.isPending}
            title={complete ? undefined : e('finish')}
            onClick={() => save.mutate()}
          >
            {save.isPending ? e('saving') : e('save')}
          </Button>
          {draft ? (
            <Button
              variant="primary"
              disabled={dirty || publish.isPending || !complete}
              title={dirty ? e('savedFirst') : undefined}
              onClick={() => publish.mutate()}
            >
              {publish.isPending
                ? e('publishing')
                : e('publish', { version: draft.version })}
            </Button>
          ) : null}
          {dirty ? (
            <span className="text-label text-fg-muted">{e('unsaved')}</span>
          ) : null}
          <span className="grow" />
          <Link
            to="/pipelines/$pipelineId/history"
            params={{ pipelineId }}
            className="text-label"
          >
            {e('history')}
          </Link>
          <Button
            disabled={!source || !stored}
            onClick={() => setConvertOpen(true)}
          >
            {e('convert')}
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
        />
      </div>
      <aside
        aria-label={e('history')}
        className="flex w-[312px] shrink-0 flex-col gap-5 max-lg:w-full"
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
            onDuplicate={() => {
              setConvertOpen(false)
              setDuplicateOpen(true)
            }}
            onConverted={() => setEdited(null)}
          />
          <DuplicateDialog
            open={duplicateOpen}
            onOpenChange={setDuplicateOpen}
            workspaceId={workspaceId}
            versionId={source.id}
            version={source.version}
            mode={t('features.pipelineSimple.mode.simple')}
            displayId={displayId}
            name={d.name}
          />
        </>
      ) : null}
    </div>
  )
}
