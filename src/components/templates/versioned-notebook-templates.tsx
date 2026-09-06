import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { SearchableSelect } from '#/components/ui/searchable-select'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '#/components/ui'
import type { TemplateProject } from '#/components/templates/template-library'
import { TemplateParameterInputs } from '#/components/templates/template-parameter-inputs'
import { formatDate } from '#/lib/notebook-data'
import { discoverObjectDependencies } from '#/lib/object-dependencies'
import {
  createNotebookTemplateVersion,
  createNotebookTemplate,
  applyNotebookTemplateUpgrade,
  fetchAllNotebookTemplateVersions,
  fetchNotebookTemplates,
  instantiateNotebookTemplateVersion,
  notebookTemplateDataClient,
  previewNotebookTemplateUpgrade,
  publishNotebookTemplateVersion,
  retargetNotebookTemplateSheetPlacement,
  retireNotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import { parseNotebookTemplateConfiguration } from '#/lib/notebook-template'
import type { NotebookTemplateConfiguration } from '#/lib/notebook-template'
import {
  matchesNotebookTemplateNeeds,
  notebookTemplateNeedsLine,
  parentLifecycleBadgeVariant,
  summarizeNotebookTemplateRequirements,
  versionLifecycleBadgeVariant,
} from '#/lib/reuse-discovery'
import type {
  NotebookTemplateNeedsFilter,
  NotebookTemplateRequirementSummary,
} from '#/lib/reuse-discovery'
import { buildParameterInputs, defaultParameterDrafts } from '#/lib/parameter-input'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import type {
  NotebookUpgradeDecisionDraft,
  NotebookUpgradePreview,
} from '#/lib/notebook-template-upgrade'
import {
  NotebookTemplateUpgradeForm,
  collectNotebookTemplateUpgradeInputs,
} from '#/components/stewardship/notebook-template-upgrade-form'
import {
  fetchSheetDefinitions,
  fetchSheetDefinitionVersions,
  sheetDefinitionDataClient,
} from '#/lib/sheet-definition-data'
function emptyNotebookTemplateConfiguration(): NotebookTemplateConfiguration {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id: crypto.randomUUID(),
        kind: 'narrative',
        order: 1,
        blockType: 'rich_text',
        payload: {
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
      },
    ],
  }
}

function notebookTemplateKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const base = slug.length > 0 ? slug : 'notebook'
  return `${base}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

export function VersionedNotebookTemplatePanel({
  workspaceId,
  canEdit,
  projects,
  selectedTemplateId: selectedTemplateIdProp,
  onSelectedTemplateIdChange,
  headerActions,
}: {
  workspaceId: string
  canEdit: boolean
  projects: TemplateProject[]
  selectedTemplateId?: string | null
  onSelectedTemplateIdChange?: (templateId: string | null) => void
  /** Optional per-selected-template actions (e.g. the FIND-02 favourite star). */
  headerActions?: ReactNode
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [lifecycleFilter, setLifecycleFilter] = useState<
    'all' | 'published' | 'draft' | 'retired'
  >('all')
  const [needsFilter, setNeedsFilter] =
    useState<NotebookTemplateNeedsFilter>('all')
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createProjectId, setCreateProjectId] = useState(projects[0]?.id ?? '')
  const [createVersionId, setCreateVersionId] = useState<string | null>(null)
  const [internalSelectedTemplateId, setInternalSelectedTemplateId] = useState<
    string | null
  >(null)
  const isTemplateSelectionControlled = selectedTemplateIdProp !== undefined
  const selectedTemplateId = isTemplateSelectionControlled
    ? selectedTemplateIdProp
    : internalSelectedTemplateId

  function selectTemplate(templateId: string) {
    if (!isTemplateSelectionControlled) {
      setInternalSelectedTemplateId(templateId)
    }
    onSelectedTemplateIdChange?.(templateId)
  }
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  )
  const [builderSourceVersionId, setBuilderSourceVersionId] = useState('')
  const [builderConfigurationText, setBuilderConfigurationText] = useState('')
  const [builderError, setBuilderError] = useState<string | null>(null)
  const [retargetPlacementId, setRetargetPlacementId] = useState('')
  const [retargetDefinitionId, setRetargetDefinitionId] = useState('')
  const [retargetDefinitionVersionId, setRetargetDefinitionVersionId] =
    useState('')
  const [parameterValues, setParameterValues] = useState<
    Record<string, string>
  >({})
  const [upgradeRecordId, setUpgradeRecordId] = useState('')
  const [upgradeExpectedStructureVersion, setUpgradeExpectedStructureVersion] =
    useState('')
  const [upgradePreview, setUpgradePreview] =
    useState<NotebookUpgradePreview | null>(null)
  const [upgradeDecisionDrafts, setUpgradeDecisionDrafts] = useState<
    Record<string, NotebookUpgradeDecisionDraft>
  >({})
  const [upgradeParameterDrafts, setUpgradeParameterDrafts] = useState<
    Record<string, string>
  >({})
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  const templates = useQuery({
    queryKey: ['notebook-templates', workspaceId, search],
    queryFn: () =>
      fetchNotebookTemplates(notebookTemplateDataClient, {
        search,
        limit: 100,
      }),
  })
  const versions = useQuery({
    queryKey: ['notebook-template-versions'],
    queryFn: () => fetchAllNotebookTemplateVersions(notebookTemplateDataClient),
  })
  const versionsByTemplate = useMemo(() => {
    const map = new Map<string, NotebookTemplateVersion[]>()
    for (const version of versions.data ?? []) {
      const list = map.get(version.templateId) ?? []
      list.push(version)
      map.set(version.templateId, list)
    }
    return map
  }, [versions.data])
  const selectedTemplateVersions = useMemo(
    () =>
      selectedTemplateId ? versionsByTemplate.get(selectedTemplateId) : [],
    [selectedTemplateId, versionsByTemplate],
  )
  // REUSE-01: per-template latest-version requirement summaries back the
  // lifecycle + needs facets and the catalogue "Needs" column, so every
  // entry previews what instantiation needs before the user opens it.
  const summariesByTemplate = useMemo(() => {
    const map = new Map<string, NotebookTemplateRequirementSummary | null>()
    for (const template of templates.data ?? []) {
      const latest = versionsByTemplate.get(template.id)?.[0] ?? null
      map.set(
        template.id,
        latest
          ? summarizeNotebookTemplateRequirements(latest.configuration)
          : null,
      )
    }
    return map
  }, [templates.data, versionsByTemplate])
  const visibleTemplates = useMemo(
    () =>
      (templates.data ?? []).filter((template) => {
        const latest = versionsByTemplate.get(template.id)?.[0] ?? null
        if (lifecycleFilter !== 'all' && latest?.lifecycle !== lifecycleFilter)
          return false
        if (needsFilter !== 'all') {
          const summary = summariesByTemplate.get(template.id)
          if (!summary || !matchesNotebookTemplateNeeds(summary, needsFilter))
            return false
        }
        return true
      }),
    [templates.data, versionsByTemplate, summariesByTemplate, lifecycleFilter, needsFilter],
  )
  const selectedVersion =
    selectedTemplateVersions?.find(
      (version) => version.id === selectedVersionId,
    ) ?? null
  const instantiateVersion =
    (versions.data ?? []).find((version) => version.id === createVersionId) ??
    null

  // REUSE-02: client-side fail-closed gate mirroring the server contract —
  // a required parameter counts as resolved when it carries a visible draft
  // value or a declared scalar default (pre-filled on open, overridable).
  const missingRequiredParameters = useMemo(() => {
    if (!instantiateVersion) return []
    return instantiateVersion.configuration.parameters.filter((parameter) => {
      if (!parameter.required) return false
      if ((parameterValues[parameter.id] ?? '').trim().length > 0) return false
      if (
        parameter.type.kind === 'scalar' &&
        parameter.defaultValue !== undefined
      )
        return false
      return true
    })
  }, [instantiateVersion, parameterValues])

  useEffect(() => {
    const firstTemplateId = visibleTemplates[0]?.id ?? null
    if (
      !isTemplateSelectionControlled &&
      !selectedTemplateId &&
      firstTemplateId
    ) {
      setInternalSelectedTemplateId(firstTemplateId)
    }
  }, [isTemplateSelectionControlled, selectedTemplateId, visibleTemplates])

  useEffect(() => {
    if (!selectedTemplateId) return
    const current = versionsByTemplate.get(selectedTemplateId) ?? []
    const firstVersionId = current[0]?.id ?? null
    if (
      !selectedVersionId ||
      !current.some((version) => version.id === selectedVersionId)
    ) {
      setSelectedVersionId(firstVersionId)
    }
    if (!builderSourceVersionId && firstVersionId) {
      setBuilderSourceVersionId(firstVersionId)
    }
  }, [
    builderSourceVersionId,
    selectedTemplateId,
    selectedVersionId,
    versionsByTemplate,
  ])

  useEffect(() => {
    if (!selectedVersion) return
    setBuilderConfigurationText(
      JSON.stringify(selectedVersion.configuration, null, 2),
    )
    setParameterValues({})
    setRetargetPlacementId('')
    setRetargetDefinitionId('')
    setRetargetDefinitionVersionId('')
  }, [selectedVersion?.id])

  const definitionCatalogue = useQuery({
    queryKey: ['sheet-definitions', 'catalogue'],
    queryFn: () => fetchSheetDefinitions(sheetDefinitionDataClient),
  })
  const selectedDefinitionVersions = useQuery({
    queryKey: ['sheet-definition-versions', retargetDefinitionId],
    queryFn: () =>
      fetchSheetDefinitionVersions(
        retargetDefinitionId,
        sheetDefinitionDataClient,
      ),
    enabled: Boolean(retargetDefinitionId),
  })
  const versionDependencies = useQuery({
    queryKey: ['notebook-template-version-dependencies', selectedVersionId],
    queryFn: () =>
      discoverObjectDependencies(
        notebookTemplateDataClient,
        'notebook_template_version',
        selectedVersionId!,
      ),
    enabled: Boolean(selectedVersionId),
  })
  const create = useMutation({
    mutationFn: (name: string) =>
      createNotebookTemplate({
        workspaceId,
        key: notebookTemplateKey(name),
        name: name.trim(),
        configuration: emptyNotebookTemplateConfiguration(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notebook-templates'] })
      queryClient.invalidateQueries({
        queryKey: ['notebook-template-versions'],
      })
      setDraftOpen(false)
      setDraftName('')
    },
  })
  const publish = useMutation({
    mutationFn: (input: { id: string; revision: number }) =>
      publishNotebookTemplateVersion(input.id, input.revision),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['notebook-template-versions'],
      }),
  })
  const retire = useMutation({
    mutationFn: (input: { id: string; revision: number }) =>
      retireNotebookTemplateVersion(input.id, input.revision),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['notebook-template-versions'],
      }),
  })
  const createVersion = useMutation({
    mutationFn: (input: {
      templateId: string
      expectedTemplateRevision: number
      configuration: NotebookTemplateConfiguration
    }) =>
      createNotebookTemplateVersion(
        input.templateId,
        input.expectedTemplateRevision,
        input.configuration,
      ),
    onSuccess: () => {
      setBuilderError(null)
      queryClient.invalidateQueries({
        queryKey: ['notebook-template-versions'],
      })
    },
    onError: (cause) =>
      setBuilderError(
        cause instanceof Error
          ? cause.message
          : 'Could not create a new draft version.',
      ),
  })
  const retarget = useMutation({
    mutationFn: (input: {
      versionId: string
      expectedRevision: number
      placementId: string
      targetDefinitionVersionId: string
    }) => retargetNotebookTemplateSheetPlacement(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['notebook-template-versions'],
      })
    },
  })
  const instantiate = useMutation({
    mutationFn: () => {
      const sourceVersion = instantiateVersion
      if (!sourceVersion)
        throw new Error('Template version is no longer available.')
      const parameterInputs = buildParameterInputs(
        sourceVersion.configuration.parameters,
        parameterValues,
      )
      return instantiateNotebookTemplateVersion({
        versionId: createVersionId ?? '',
        targetProjectId: createProjectId,
        title: createTitle.trim() || undefined,
        parameterInputs,
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: (result) => {
      setCreateOpen(false)
      void navigate({
        to: '/records/$recordId',
        params: { recordId: result.record.id },
      })
    },
  })
  const previewUpgrade = useMutation({
    mutationFn: () => {
      if (!selectedVersion) throw new Error('No template version selected.')
      if (!upgradeRecordId.trim())
        throw new Error('Notebook record ID is required.')
      return previewNotebookTemplateUpgrade(
        upgradeRecordId.trim(),
        selectedVersion.id,
      )
    },
    onSuccess: (result) => {
      setUpgradePreview(result)
      setUpgradeDecisionDrafts({})
      setUpgradeParameterDrafts({})
      setUpgradeError(null)
    },
    onError: (cause) =>
      setUpgradeError(
        cause instanceof Error ? cause.message : 'Could not preview upgrade.',
      ),
  })
  const applyUpgrade = useMutation({
    mutationFn: () => {
      if (!selectedVersion) throw new Error('No template version selected.')
      if (!upgradeRecordId.trim())
        throw new Error('Notebook record ID is required.')
      if (!upgradePreview)
        throw new Error('Preview the upgrade before applying.')
      const expectedVersion = Number(upgradeExpectedStructureVersion.trim())
      if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
        throw new Error(
          'Expected structure version must be a positive integer.',
        )
      }
      const collected = collectNotebookTemplateUpgradeInputs(
        upgradePreview,
        selectedVersion.configuration,
        upgradeDecisionDrafts,
        upgradeParameterDrafts,
      )
      return applyNotebookTemplateUpgrade({
        recordId: upgradeRecordId.trim(),
        expectedStructureVersion: expectedVersion,
        targetVersionId: selectedVersion.id,
        decisions: collected.decisions,
        parameterInputs: collected.parameterInputs,
      })
    },
    onSuccess: () => setUpgradeError(null),
    onError: (cause) =>
      setUpgradeError(
        cause instanceof Error ? cause.message : 'Could not apply upgrade.',
      ),
  })

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Notebook templates</h2>
          <p className="text-xs text-muted-foreground">
            Search the catalogue, then create a Notebook from a published
            version.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setDraftOpen(true)}
              disabled={create.isPending}
            >
              New draft
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex max-w-2xl flex-wrap items-center gap-2">
        <label htmlFor="notebook-template-search" className="sr-only">
          Search notebook templates
        </label>
        <Input
          id="notebook-template-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or key"
          className="min-w-48 flex-1"
        />
        <label htmlFor="notebook-template-lifecycle" className="sr-only">
          Filter by lifecycle
        </label>
        <Select
          id="notebook-template-lifecycle"
          value={lifecycleFilter}
          onChange={(event) =>
            setLifecycleFilter(
              event.target.value as typeof lifecycleFilter,
            )
          }
          className="w-auto"
        >
          <option value="all">All lifecycles</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="retired">Retired</option>
        </Select>
        <label htmlFor="notebook-template-needs" className="sr-only">
          Filter by instantiation needs
        </label>
        <Select
          id="notebook-template-needs"
          value={needsFilter}
          onChange={(event) =>
            setNeedsFilter(event.target.value as NotebookTemplateNeedsFilter)
          }
          className="w-auto"
        >
          <option value="all">All needs</option>
          <option value="none">No parameters</option>
          <option value="optional-only">Optional only</option>
          <option value="has-required">Has required</option>
        </Select>
      </div>
      {templates.isLoading || versions.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading notebook templates…
        </p>
      ) : visibleTemplates.length ? (
        <Table containerClassName="rounded-md border">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Latest</TableHead>
              <TableHead>Needs</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTemplates.map((template) => {
              const templateVersions = versionsByTemplate.get(template.id) ?? []
              const latest = templateVersions[0] ?? null
              const summary = summariesByTemplate.get(template.id) ?? null
              const published = templateVersions.find(
                (version) => version.lifecycle === 'published',
              )
              const draft = templateVersions.find(
                (version) => version.lifecycle === 'draft',
              )
              return (
                <TableRow key={template.id}>
                  <TableCell>
                    <p className="font-medium">{template.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {template.key}
                    </p>
                    <Badge
                      variant={parentLifecycleBadgeVariant(template.lifecycle)}
                      className="mt-1 text-xs"
                    >
                      {template.lifecycle}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {latest ? (
                      <span className="inline-flex items-center gap-2">
                        <span>v{latest.version}</span>
                        <Badge
                          variant={versionLifecycleBadgeVariant(
                            latest.lifecycle,
                          )}
                          className="text-xs"
                        >
                          {latest.lifecycle}
                        </Badge>
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {summary ? notebookTemplateNeedsLine(summary) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(template.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => selectTemplate(template.id)}
                      >
                        Open
                      </Button>
                      {canEdit && draft ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            publish.mutate({
                              id: draft.id,
                              revision: draft.revision,
                            })
                          }
                        >
                          Publish
                        </Button>
                      ) : null}
                      {published && projects.length > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCreateVersionId(published.id)
                            setCreateTitle(template.name)
                            setCreateProjectId(projects[0]?.id ?? '')
                            // REUSE-02: pre-fill declared defaults visibly so
                            // what the user sees is what gets instantiated.
                            setParameterValues(
                              defaultParameterDrafts(
                                published.configuration.parameters,
                              ),
                            )
                            setCreateOpen(true)
                          }}
                        >
                          Create notebook
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          No notebook templates match the current filters.
        </p>
      )}
      {templates.data && templates.data.length === 100 ? (
        <p className="text-xs text-muted-foreground">
          Showing the first 100 matches. Narrow the search to find a specific
          template.
        </p>
      ) : null}

      {selectedTemplateId && selectedTemplateVersions?.length ? (
        <section className="space-y-3 rounded-md border p-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Version history</h3>
            <p className="text-xs text-muted-foreground">
              Inspect lifecycle, dependencies, placements, and prepare explicit
              new drafts from a chosen version.
            </p>
          </div>
          <Table containerClassName="rounded-md border">
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Published</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedTemplateVersions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium underline-offset-4 hover:underline"
                      onClick={() => setSelectedVersionId(version.id)}
                    >
                      v{version.version}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={versionLifecycleBadgeVariant(version.lifecycle)}
                      className="text-xs"
                    >
                      {version.lifecycle}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {version.publishedAt
                      ? formatDate(version.publishedAt)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      {canEdit && version.lifecycle === 'draft' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            publish.mutate({
                              id: version.id,
                              revision: version.revision,
                            })
                          }
                        >
                          Publish
                        </Button>
                      ) : null}
                      {canEdit && version.lifecycle !== 'retired' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            retire.mutate({
                              id: version.id,
                              revision: version.revision,
                            })
                          }
                        >
                          Retire
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {selectedVersion ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2 rounded-md border p-3">
                <h4 className="text-sm font-semibold">
                  Selected version details (v{selectedVersion.version})
                </h4>
                {(() => {
                  const summary = summarizeNotebookTemplateRequirements(
                    selectedVersion.configuration,
                  )
                  return (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {notebookTemplateNeedsLine(summary)}
                        {summary.placements.sheet > 0
                          ? ` (${summary.placements.sheet} sheet, ${summary.placements.narrative} narrative, ${summary.placements.placeholder} placeholder)`
                          : summary.placements.total > 0
                            ? ` (${summary.placements.narrative} narrative, ${summary.placements.placeholder} placeholder)`
                            : ''}
                        {summary.mappedTemplateParameterIds.length > 0
                          ? ` · ${summary.mappedTemplateParameterIds.length} of ${summary.parameterCount} wired into sheets`
                          : ''}
                      </p>
                      {summary.requiredParameters.length > 0 ? (
                        <ul className="space-y-1 text-xs">
                          {summary.requiredParameters.map((parameter) => (
                            <li key={parameter.id}>
                              <span className="font-medium">
                                {parameter.label}
                              </span>{' '}
                              <span className="text-muted-foreground">
                                ({parameter.key} · {parameter.detail}
                                {parameter.hasDefault ? ' · has default' : ''})
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No required parameters — instantiation needs only a
                          title and target project.
                        </p>
                      )}
                    </>
                  )
                })()}
                <Textarea
                  value={JSON.stringify(selectedVersion.configuration, null, 2)}
                  readOnly
                  className="min-h-56 font-mono text-xs"
                />
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <h4 className="text-sm font-semibold">Dependencies</h4>
                {versionDependencies.isLoading ? (
                  <p className="text-xs text-muted-foreground">
                    Loading dependencies…
                  </p>
                ) : versionDependencies.data?.dependencies.length ? (
                  <ul className="space-y-1 text-xs">
                    {versionDependencies.data.dependencies.map((dependency) => (
                      <li key={`${dependency.kind}:${dependency.id}`}>
                        {dependency.label} · {dependency.liveness} ·{' '}
                        {dependency.effect}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No dependants discovered.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {canEdit && selectedVersion ? (
            <div className="space-y-2 rounded-md border p-3">
              <h4 className="text-sm font-semibold">
                Create new draft version
              </h4>
              <p className="text-xs text-muted-foreground">
                Edit JSON carefully to control typed parameters, mappings, and
                placements. Publishing remains explicit.
              </p>
              <Field>
                <FieldLabel htmlFor="source-version">Source version</FieldLabel>
                <Select
                  id="source-version"
                  value={builderSourceVersionId}
                  onChange={(event) => {
                    const nextId = event.target.value
                    setBuilderSourceVersionId(nextId)
                    const next = selectedTemplateVersions.find(
                      (version) => version.id === nextId,
                    )
                    if (next) {
                      setBuilderConfigurationText(
                        JSON.stringify(next.configuration, null, 2),
                      )
                    }
                  }}
                >
                  {selectedTemplateVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version} ({version.lifecycle})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="builder-config">
                  Configuration JSON
                </FieldLabel>
                <Textarea
                  id="builder-config"
                  className="min-h-56 font-mono text-xs"
                  value={builderConfigurationText}
                  onChange={(event) =>
                    setBuilderConfigurationText(event.target.value)
                  }
                />
              </Field>
              {builderError ? (
                <p className="text-sm text-destructive" role="alert">
                  {builderError}
                </p>
              ) : null}
              <Button
                type="button"
                disabled={createVersion.isPending}
                onClick={() => {
                  if (!selectedTemplateId) return
                  const template = templates.data?.find(
                    (item) => item.id === selectedTemplateId,
                  )
                  if (!template) return
                  try {
                    const parsed = parseNotebookTemplateConfiguration(
                      JSON.parse(builderConfigurationText),
                    )
                    setBuilderError(null)
                    createVersion.mutate({
                      templateId: selectedTemplateId,
                      expectedTemplateRevision: template.revision,
                      configuration: parsed,
                    })
                  } catch (cause) {
                    setBuilderError(
                      cause instanceof Error
                        ? cause.message
                        : 'Configuration is not valid JSON.',
                    )
                  }
                }}
              >
                Create draft from configuration
              </Button>
            </div>
          ) : null}

          {canEdit &&
          selectedVersion &&
          selectedVersion.lifecycle === 'draft' &&
          selectedVersion.configuration.placements.some(
            (placement) => placement.kind === 'sheet',
          ) ? (
            <div className="space-y-2 rounded-md border p-3">
              <h4 className="text-sm font-semibold">
                Retarget Sheet placement
              </h4>
              <div className="grid gap-2 lg:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="retarget-placement">
                    Sheet placement
                  </FieldLabel>
                  <Select
                    id="retarget-placement"
                    value={retargetPlacementId}
                    onChange={(event) =>
                      setRetargetPlacementId(event.target.value)
                    }
                  >
                    <option value="">Select a placement</option>
                    {selectedVersion.configuration.placements
                      .filter((placement) => placement.kind === 'sheet')
                      .map((placement) => (
                        <option key={placement.id} value={placement.id}>
                          {placement.title || placement.id}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="retarget-definition">
                    Definition
                  </FieldLabel>
                  <Select
                    id="retarget-definition"
                    value={retargetDefinitionId}
                    onChange={(event) => {
                      setRetargetDefinitionId(event.target.value)
                      setRetargetDefinitionVersionId('')
                    }}
                  >
                    <option value="">Select a definition</option>
                    {(definitionCatalogue.data ?? []).map((definition) => (
                      <option key={definition.id} value={definition.id}>
                        {definition.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {retargetDefinitionId ? (
                <Field>
                  <FieldLabel htmlFor="retarget-definition-version">
                    Target definition version
                  </FieldLabel>
                  <Select
                    id="retarget-definition-version"
                    value={retargetDefinitionVersionId}
                    onChange={(event) =>
                      setRetargetDefinitionVersionId(event.target.value)
                    }
                  >
                    <option value="">Select a version</option>
                    {(selectedDefinitionVersions.data ?? []).map((version) => (
                      <option key={version.id} value={version.id}>
                        v{version.version} ({version.lifecycle})
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Button
                type="button"
                disabled={
                  !retargetPlacementId ||
                  !retargetDefinitionVersionId ||
                  retarget.isPending
                }
                onClick={() => {
                  retarget.mutate({
                    versionId: selectedVersion.id,
                    expectedRevision: selectedVersion.revision,
                    placementId: retargetPlacementId,
                    targetDefinitionVersionId: retargetDefinitionVersionId,
                  })
                }}
              >
                Retarget placement
              </Button>
            </div>
          ) : null}

          {canEdit &&
          selectedVersion &&
          selectedVersion.lifecycle === 'published' ? (
            <div className="space-y-2 rounded-md border p-3">
              <h4 className="text-sm font-semibold">
                Upgrade existing Notebooks
              </h4>
              <p className="text-xs text-muted-foreground">
                Preview and apply an explicit upgrade to this published template
                version.
              </p>
              <div className="grid gap-2 lg:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="upgrade-record-id">
                    Notebook record ID
                  </FieldLabel>
                  <Input
                    id="upgrade-record-id"
                    value={upgradeRecordId}
                    onChange={(event) => setUpgradeRecordId(event.target.value)}
                    placeholder="Enter notebook record ID"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="upgrade-expected-structure-version">
                    Expected structure version
                  </FieldLabel>
                  <Input
                    id="upgrade-expected-structure-version"
                    value={upgradeExpectedStructureVersion}
                    onChange={(event) =>
                      setUpgradeExpectedStructureVersion(event.target.value)
                    }
                    placeholder="e.g. 1"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={previewUpgrade.isPending}
                  onClick={() => previewUpgrade.mutate()}
                >
                  Preview upgrade
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={applyUpgrade.isPending}
                  onClick={() => applyUpgrade.mutate()}
                >
                  Apply upgrade
                </Button>
              </div>
              {upgradePreview ? (
                <NotebookTemplateUpgradeForm
                  preview={upgradePreview}
                  targetConfiguration={selectedVersion.configuration}
                  decisionDrafts={upgradeDecisionDrafts}
                  parameterDrafts={upgradeParameterDrafts}
                  disabled={applyUpgrade.isPending}
                  client={notebookTemplateDataClient}
                  workspaceId={workspaceId}
                  onDecisionChange={(conflictId, draft) =>
                    setUpgradeDecisionDrafts((current) => ({
                      ...current,
                      [conflictId]: draft,
                    }))
                  }
                  onParameterChange={(parameterId, value) =>
                    setUpgradeParameterDrafts((current) => ({
                      ...current,
                      [parameterId]: value,
                    }))
                  }
                />
              ) : null}
              {upgradeError ? (
                <p className="text-sm text-destructive" role="alert">
                  {upgradeError}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New notebook template</DialogTitle>
            <DialogDescription>
              Name the template. Publish a version when it is ready to create
              Notebooks.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="notebook-template-name">Name</FieldLabel>
            <Input
              id="notebook-template-name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Stability run notebook"
            />
          </Field>
          {create.error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not create the template. Check the name and try again.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraftOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!draftName.trim() || create.isPending}
              onClick={() => create.mutate(draftName)}
            >
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create notebook from template</DialogTitle>
            <DialogDescription>
              Search for a project, name the Notebook, then open it.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="notebook-title">Notebook title</FieldLabel>
            <Input
              id="notebook-title"
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="notebook-project">Project</FieldLabel>
            <SearchableSelect
              id="notebook-project"
              items={projects}
              value={createProjectId}
              onChange={setCreateProjectId}
              getId={(project) => project.id}
              getLabel={(project) => project.title}
              getDescription={(project) => project.key}
              placeholder="Search projects"
              triggerLabel="Select a project"
              emptyLabel="No projects match that search."
            />
          </Field>
          {instantiateVersion ? (
            <p className="text-xs text-muted-foreground">
              This version needs:{' '}
              {notebookTemplateNeedsLine(
                summarizeNotebookTemplateRequirements(
                  instantiateVersion.configuration,
                ),
              )}
              . Resolve each input before creating the Notebook.
            </p>
          ) : null}
          {instantiateVersion &&
          instantiateVersion.configuration.placements.some(
            (placement) => placement.kind === 'sheet',
          ) ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Composed sheets
              </p>
              <ul className="space-y-1 text-xs">
                {instantiateVersion.configuration.placements
                  .filter((placement) => placement.kind === 'sheet')
                  .map((placement) => {
                    if (placement.kind !== 'sheet') return null
                    const mapped = placement.parameterMappings
                      .map((mapping) =>
                        instantiateVersion?.configuration.parameters.find(
                          (parameter) =>
                            parameter.id === mapping.templateParameterId,
                        ),
                      )
                      .filter(
                        (parameter): parameter is NonNullable<typeof parameter> =>
                          parameter != null,
                      )
                    return (
                      <li key={placement.id}>
                        <span className="font-medium">
                          {placement.title ?? 'Notebook sheet'}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          · governed pin{' '}
                          {placement.definitionVersionId.slice(0, 8)}
                          {mapped.length > 0
                            ? ` · inputs: ${mapped
                                .map(
                                  (parameter) =>
                                    `${parameter.label}${parameter.required ? '' : ' (optional)'}`,
                                )
                                .join(', ')}`
                            : ' · no inputs'}
                        </span>
                      </li>
                    )
                  })}
              </ul>
              <p className="text-xs text-muted-foreground">
                Governed pins name the exact published versions composed. Each
                sheet becomes an independent instance — no part mutates
                another. Titles, projects and parameter values stay local.
              </p>
            </div>
          ) : null}
          {instantiateVersion?.configuration.parameters.length ? (
            <TemplateParameterInputs
              client={notebookTemplateDataClient}
              workspaceId={workspaceId}
              parameters={instantiateVersion.configuration.parameters}
              values={parameterValues}
              onChange={(parameterId, value) =>
                setParameterValues((current) => ({
                  ...current,
                  [parameterId]: value,
                }))
              }
            />
          ) : null}
          {missingRequiredParameters.length > 0 ? (
            <p className="text-sm text-destructive" role="alert">
              Missing required:{' '}
              {missingRequiredParameters.map((parameter) => parameter.label).join(', ')}
              . No Notebook is created until every required input resolves.
            </p>
          ) : null}
          {instantiate.error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not create the Notebook. Try again.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !createProjectId ||
                !createVersionId ||
                instantiate.isPending ||
                missingRequiredParameters.length > 0
              }
              onClick={() => instantiate.mutate()}
            >
              Create and open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
