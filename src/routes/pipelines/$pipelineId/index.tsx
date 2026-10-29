import { createFileRoute, Link } from '@tanstack/react-router'

import { rich, t } from '#/copy'
import {
  PipelineSteps,
  TemporaryArtefact,
} from '#/components/v3/pipelines/pipeline-code'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { buttonVariants } from '#/components/v3/ui/button'
import { Muted, Section } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import {
  currentVersion,
  draftVersion,
  usePipelineVersions,
  versionStatus,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): the pipeline Overview reads the current
 * version's configuration. Editing steps is deferred to the Steps tab; the
 * configuration is shown exactly as stored. R5-SHELL-06 presents that
 * configuration properly: code names its language and stays text, temporary
 * stores are marked with the rule that ends them, and step navigation is the
 * already-linkable `/pipelines/$pipelineId/steps` route. */
export const Route = createFileRoute('/pipelines/$pipelineId/')({
  component: PipelineOverview,
})

interface ConfigShape {
  description?: string
  parameters?: { name: string; type: string; required?: boolean }[]
  inputs?: { name: string; required?: boolean }[]
  transform?: { language?: string; statement?: string }
  steps?: { name: string; language: string; statement: string }[]
  output?: {
    mode?: string
    datasetName?: string
    datasetLabel?: string
    datasetId?: string
  }
}

function PipelineOverview() {
  useDisplayTimeZone()
  const { pipelineId } = Route.useParams()
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const version = currentVersion(list)
  const draft = draftVersion(list)
  const shown = draft ?? version
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    shown?.id ?? null,
    () => {},
  )

  if (versions.isLoading || versions.isError) {
    return (
      <div className="px-4 py-4 md:px-6">
        {versions.isError ? (
          <ProjectListFailure
            error={versions.error}
            what="pipeline versions"
            onRetry={() => void versions.refetch()}
          />
        ) : (
          <Muted>{t('data.pipelineOverview.loadingPipelineVersions')}</Muted>
        )}
      </div>
    )
  }

  if (!shown) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          title={t('data.pipelineOverview.createFirstVersion')}
          description={t('data.pipelineOverview.configureSqlPythonSteps')}
          action={
            <Link
              to="/pipelines/$pipelineId/steps"
              params={{ pipelineId }}
              className={buttonVariants({ variant: 'primary' })}
            >
              {t('data.pipelineOverview.configureSteps')}
            </Link>
          }
        />
        <Muted>{t('data.pipelineOverview.preferLocalPythonFiles')}</Muted>
      </div>
    )
  }

  type ConfigInput = NonNullable<ConfigShape['inputs']>[number]
  type ConfigParameter = NonNullable<ConfigShape['parameters']>[number]

  const inputColumns: RegistryColumn<ConfigInput>[] = [
    {
      id: 'name',
      header: t('data.pipelineOverview.name'),
      cell: ({ row }) => <span className="mono">{row.original.name}</span>,
    },
    {
      id: 'required',
      header: t('common.states.required'),
      cell: ({ row }) =>
        row.original.required ? t('data.pipelineOverview.yes') : 'No',
    },
  ]

  const parameterColumns: RegistryColumn<ConfigParameter>[] = [
    {
      id: 'name',
      header: t('data.pipelineOverview.name'),
      cell: ({ row }) => <span className="mono">{row.original.name}</span>,
    },
    {
      id: 'type',
      header: t('data.pipelineOverview.type'),
      cell: ({ row }) => row.original.type,
    },
    {
      id: 'required',
      header: t('common.states.required'),
      cell: ({ row }) =>
        row.original.required ? t('data.pipelineOverview.yes') : 'No',
    },
  ]

  const versionColumns: RegistryColumn<(typeof list)[number]>[] = [
    {
      id: 'version',
      header: t('data.pipelineOverview.version'),
      cell: ({ row }) => (
        <span className="font-medium">v{row.original.version}</span>
      ),
    },
    {
      id: 'status',
      header: t('data.pipelineOverview.status'),
      cell: ({ row }) => {
        const status = versionStatus(row.original.lifecycle)
        return <Status tone={status.tone}>{status.label}</Status>
      },
    },
    {
      id: 'published',
      header: t('data.pipelineOverview.published2'),
      cell: ({ row }) =>
        row.original.published_at
          ? formatNotebookDateTime(row.original.published_at, { zone: true })
          : '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]

  const config = shown.configuration as ConfigShape
  // R5-SHELL-06: what the run keeps, and where a person can act on its
  // retention. Only an append output has a dataset to link to; a create output
  // makes its dataset at run time.
  const output = config.output
  const keepsArtefact = Boolean(output && output.mode !== 'none')
  const keptDatasetId = output?.mode === 'append' ? output.datasetId : undefined
  return (
    <div className="@container/overview min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-col gap-5">
        <Section
          title={t('data.pipelineOverview.configuration')}
          className="border-b border-border pb-4"
          count={
            <span className="flex items-center gap-2">
              <Status tone={versionStatus(shown.lifecycle).tone}>
                {versionStatus(shown.lifecycle).label} v{shown.version}
              </Status>
            </span>
          }
        >
          <Muted>
            {[
              draft && version?.lifecycle === 'published'
                ? t('data.pipelineOverview.showingDraftVRuns', {
                    version: draft.version,
                    published: version.version,
                  })
                : null,
              shown.published_at
                ? t('data.pipelineOverview.published', {
                    when: formatNotebookDateTime(shown.published_at, {
                      zone: true,
                    }),
                  })
                : t('data.pipelineOverview.notPublished'),
              t('data.pipelineOverview.newRunsPinExact'),
            ]
              .filter(Boolean)
              .join(' ')}
          </Muted>
        </Section>

        <div className="grid min-w-0 grid-cols-1 gap-6 @min-[900px]/overview:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Section
              title={t('data.pipelineOverview.executionOrder')}
              count={
                (config.transform?.statement &&
                config.transform.language !== 'none'
                  ? 1
                  : 0) + (config.steps?.length ?? 0)
              }
            >
              <Muted>
                {rich('data.pipelineOverview.transformRunsFirstFurther', {
                  code: (text) => <code>{text}</code>,
                })}
              </Muted>
              <PipelineSteps
                pipelineId={pipelineId}
                steps={config.steps ?? []}
                transform={
                  config.transform?.statement &&
                  config.transform.language !== 'none'
                    ? {
                        name: t('data.pipelineOverview.transform'),
                        language: config.transform.language ?? 'sql',
                        statement: config.transform.statement,
                      }
                    : undefined
                }
              />
            </Section>
            <Section
              title={t('data.pipelineOverview.versionHistory')}
              count={list.length}
            >
              <TableBox>
                <RegistryGrid
                  label={t('data.pipelineOverview.pipelineVersions')}
                  rows={list}
                  columns={versionColumns}
                  getRowId={(v) => v.id}
                  selectable={false}
                  rowSelection={rowSelection}
                  onRowSelectionChange={onRowSelectionChange}
                />
              </TableBox>
            </Section>
          </div>
          <div className="flex min-w-0 flex-col gap-5 @min-[900px]/overview:border-l @min-[900px]/overview:border-border @min-[900px]/overview:pl-5">
            <Section
              title={t('data.pipelineOverview.inputs')}
              count={config.inputs?.length ?? 0}
            >
              {config.inputs?.length ? (
                <div className="flex flex-col gap-2">
                  <TableBox>
                    <RegistryGrid
                      label={t('data.pipelineOverview.pipelineInputs')}
                      rows={config.inputs}
                      columns={inputColumns}
                      getRowId={(i) => i.name}
                      selectable={false}
                    />
                  </TableBox>
                  <div className="flex flex-wrap items-center gap-2">
                    <TemporaryArtefact>
                      {t('data.pipelineOverview.temporaryTables')}
                    </TemporaryArtefact>
                    <Muted className="text-caption">
                      {t('data.pipelineOverview.eachRunWorksCopy')}
                    </Muted>
                  </div>
                </div>
              ) : (
                <Muted>{t('data.pipelineOverview.inputsDeclared')}</Muted>
              )}
            </Section>

            <Section
              title={t('data.pipelineOverview.parameters')}
              count={config.parameters?.length ?? 0}
            >
              {config.parameters?.length ? (
                <TableBox>
                  <RegistryGrid
                    label={t('data.pipelineOverview.pipelineParameters')}
                    rows={config.parameters}
                    columns={parameterColumns}
                    getRowId={(p) => p.name}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <Muted>{t('data.pipelineOverview.parametersDeclared')}</Muted>
              )}
            </Section>

            <Section title={t('data.pipelineOverview.output')}>
              <div className="flex flex-col gap-1.5">
                <Muted>
                  {!output || output.mode === 'none'
                    ? t('data.pipelineOverview.previewOnlyDatasetSnapshot')
                    : output.mode === 'append'
                      ? t('data.pipelineOverview.appendsDataset', {
                          dataset: output.datasetId ?? '',
                          label: output.datasetLabel ?? '',
                        })
                      : output.datasetName
                        ? t('data.pipelineOverview.createsDatasetNamed', {
                            name: output.datasetName,
                            label: output.datasetLabel ?? '',
                          })
                        : t('data.pipelineOverview.createsDatasetLabelled', {
                            label: output.datasetLabel ?? '',
                          })}
                </Muted>
                {keepsArtefact ? (
                  <>
                    <Muted className="text-caption">
                      {t('data.pipelineOverview.keptDatasetSnapshotRun')}
                    </Muted>
                    {keptDatasetId ? (
                      <Link
                        to="/datasets/$datasetId/snapshots"
                        params={{ datasetId: keptDatasetId }}
                        className="text-link self-start text-label"
                      >
                        {t('data.pipelineOverview.snapshotsRetention')}
                      </Link>
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <TemporaryArtefact>
                      {t('data.pipelineOverview.nothingKept')}
                    </TemporaryArtefact>
                    <Muted className="text-caption">
                      {t('data.pipelineOverview.intermediateStepTablesDropped')}
                    </Muted>
                  </div>
                )}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}
