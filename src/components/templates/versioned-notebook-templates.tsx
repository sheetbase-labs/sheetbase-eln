import { useEffect, useMemo, useState } from 'react'
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
import {
  parseNotebookTemplateConfiguration,
} from '#/lib/notebook-template'
import type {
  NotebookTemplateConfiguration,
} from '#/lib/notebook-template'
import { scalarParameterValueSchema } from '#/lib/parameter'
import type {
  NotebookTemplateParameterInput,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
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

function parseScalarTemplateParameterValue(
  parameter: NotebookTemplateConfiguration['parameters'][number],
  rawValue: string | undefined,
) {
  if (parameter.type.kind !== 'scalar')
    throw new Error('Only scalar parameters can be parsed here.')
  const trimmed = rawValue?.trim() ?? ''
  const hasInput = trimmed.length > 0
  const value = hasInput ? trimmed : parameter.defaultValue
  if (value === undefined) {
    if (parameter.required)
      throw new Error(`Parameter "${parameter.label}" is required.`)
    return null
  }
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (parameter.type.valueType === 'integer' || parameter.type.valueType === 'decimal') {
      parsed = Number(value)
    } else if (parameter.type.valueType === 'boolean') {
      const normalised = value.toLowerCase()
      if (normalised === 'true') parsed = true
      else if (normalised === 'false') parsed = false
    }
  }
  if (!scalarParameterValueSchema(parameter.type.valueType).safeParse(parsed).success) {
    throw new Error(`Parameter "${parameter.label}" has an invalid value.`)
  }
  if (typeof parsed === 'number') {
    if (parameter.constraints.min !== undefined && parsed < parameter.constraints.min) {
      throw new Error(`Parameter "${parameter.label}" is below the minimum value.`)
    }
    if (parameter.constraints.max !== undefined && parsed > parameter.constraints.max) {
      throw new Error(`Parameter "${parameter.label}" exceeds the maximum value.`)
    }
  }
  if (typeof parsed === 'string') {
    if (parameter.constraints.minLength !== undefined && parsed.length < parameter.constraints.minLength) {
      throw new Error(`Parameter "${parameter.label}" is too short.`)
    }
    if (parameter.constraints.maxLength !== undefined && parsed.length > parameter.constraints.maxLength) {
      throw new Error(`Parameter "${parameter.label}" is too long.`)
    }
    if (parameter.constraints.pattern !== undefined && !new RegExp(parameter.constraints.pattern).test(parsed)) {
      throw new Error(`Parameter "${parameter.label}" does not match the expected format.`)
    }
  }
  if (
    parameter.constraints.allowedValues !== undefined &&
    !parameter.constraints.allowedValues.some((allowed) => allowed === parsed)
  ) {
    throw new Error(`Parameter "${parameter.label}" is not an allowed value.`)
  }
  return parsed
}

export function VersionedNotebookTemplatePanel({
  workspaceId,
  canEdit,
  projects,
}: {
  workspaceId: string
  canEdit: boolean
  projects: TemplateProject[]
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createProjectId, setCreateProjectId] = useState(projects[0]?.id ?? '')
  const [createVersionId, setCreateVersionId] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  )
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [builderSourceVersionId, setBuilderSourceVersionId] = useState('')
  const [builderConfigurationText, setBuilderConfigurationText] = useState('')
  const [builderError, setBuilderError] = useState<string | null>(null)
  const [retargetPlacementId, setRetargetPlacementId] = useState('')
  const [retargetDefinitionId, setRetargetDefinitionId] = useState('')
  const [retargetDefinitionVersionId, setRetargetDefinitionVersionId] =
    useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, string>>(
    {},
  )
  const [upgradeRecordId, setUpgradeRecordId] = useState('')
  const [upgradeExpectedStructureVersion, setUpgradeExpectedStructureVersion] =
    useState('')
  const [upgradePreviewText, setUpgradePreviewText] = useState<string | null>(null)

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
    () => (selectedTemplateId ? versionsByTemplate.get(selectedTemplateId) : []),
    [selectedTemplateId, versionsByTemplate],
  )
  const selectedVersion =
    selectedTemplateVersions?.find((version) => version.id === selectedVersionId) ??
    null
  const instantiateVersion =
    (versions.data ?? []).find((version) => version.id === createVersionId) ?? null

  useEffect(() => {
    const firstTemplateId = templates.data?.[0]?.id ?? null
    if (!selectedTemplateId && firstTemplateId) setSelectedTemplateId(firstTemplateId)
  }, [templates.data, selectedTemplateId])

  useEffect(() => {
    if (!selectedTemplateId) return
    const current = versionsByTemplate.get(selectedTemplateId) ?? []
    const firstVersionId = current[0]?.id ?? null
    if (!selectedVersionId || !current.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(firstVersionId)
    }
    if (!builderSourceVersionId && firstVersionId) {
      setBuilderSourceVersionId(firstVersionId)
    }
  }, [builderSourceVersionId, selectedTemplateId, selectedVersionId, versionsByTemplate])

  useEffect(() => {
    if (!selectedVersion) return
    setBuilderConfigurationText(JSON.stringify(selectedVersion.configuration, null, 2))
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
      fetchSheetDefinitionVersions(retargetDefinitionId, sheetDefinitionDataClient),
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
      queryClient.invalidateQueries({ queryKey: ['notebook-template-versions'] })
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
      queryClient.invalidateQueries({ queryKey: ['notebook-template-versions'] })
    },
  })
  const instantiate = useMutation({
    mutationFn: () => {
      const sourceVersion = instantiateVersion
      if (!sourceVersion) throw new Error('Template version is no longer available.')
      const parameterInputs = sourceVersion.configuration.parameters
        .map((parameter): NotebookTemplateParameterInput | null => {
            const value = (parameterValues[parameter.id] ?? '').trim()
            if (parameter.type.kind === 'scalar')
              return {
                parameterId: parameter.id,
                kind: 'scalar',
                value: parseScalarTemplateParameterValue(parameter, parameterValues[parameter.id]),
              }
            if (!value && parameter.required)
              throw new Error(`Parameter "${parameter.label}" is required.`)
            if (!value && !parameter.required) return null
            if (parameter.type.kind === 'record')
              return {
                parameterId: parameter.id,
                kind: 'record',
                recordId: value,
              }
            if (parameter.type.kind === 'dataset')
              return {
                parameterId: parameter.id,
                kind: 'dataset',
                datasetId: value,
              }
            return {
              parameterId: parameter.id,
              kind: 'dataset-version',
              datasetVersionId: value,
            }
          })
        .filter((item): item is NotebookTemplateParameterInput => item !== null)
      return instantiateNotebookTemplateVersion({
        versionId: createVersionId ?? '',
        targetProjectId: createProjectId,
        title: createTitle.trim() || undefined,
        parameterInputs,
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: (result) => {
      const project = result.record.project_id
      if (!project) return
      setCreateOpen(false)
      void navigate({
        to: '/projects/$projectId/experiments/$recordId',
        params: { projectId: project, recordId: result.record.id },
      })
    },
  })
  const previewUpgrade = useMutation({
    mutationFn: () => {
      if (!selectedVersion) throw new Error('No template version selected.')
      if (!upgradeRecordId.trim()) throw new Error('Notebook record ID is required.')
      return previewNotebookTemplateUpgrade(upgradeRecordId.trim(), selectedVersion.id)
    },
    onSuccess: (result) => {
      const parsed = result as { automatic?: unknown[]; conflicts?: unknown[] }
      setUpgradePreviewText(
        `${parsed.automatic?.length ?? 0} automatic change(s), ${parsed.conflicts?.length ?? 0} conflict(s).`,
      )
    },
  })
  const applyUpgrade = useMutation({
    mutationFn: () => {
      if (!selectedVersion) throw new Error('No template version selected.')
      if (!upgradeRecordId.trim()) throw new Error('Notebook record ID is required.')
      const expectedVersion = Number(upgradeExpectedStructureVersion.trim())
      if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
        throw new Error('Expected structure version must be a positive integer.')
      }
      return applyNotebookTemplateUpgrade({
        recordId: upgradeRecordId.trim(),
        expectedStructureVersion: expectedVersion,
        targetVersionId: selectedVersion.id,
        decisions: [],
        parameterInputs: [],
      })
    },
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
      <label htmlFor="notebook-template-search" className="sr-only">
        Search notebook templates
      </label>
      <Input
        id="notebook-template-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name or key"
        className="max-w-md"
      />
      {templates.isLoading || versions.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading notebook templates…
        </p>
      ) : templates.data?.length ? (
        <Table containerClassName="rounded-md border">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Latest</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.data.map((template) => {
              const templateVersions = versionsByTemplate.get(template.id) ?? []
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
                  </TableCell>
                  <TableCell>
                    {templateVersions.length === 0 ? (
                      '—'
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span>v{templateVersions[0].version}</span>
                        <Badge
                          variant={
                            templateVersions[0].lifecycle === 'published'
                              ? 'success'
                              : 'outline'
                          }
                          className="text-xs"
                        >
                          {templateVersions[0].lifecycle}
                        </Badge>
                      </span>
                    )}
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
                        onClick={() => setSelectedTemplateId(template.id)}
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
          No notebook templates match that search.
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
                      variant={
                        version.lifecycle === 'published' ? 'success' : 'outline'
                      }
                      className="text-xs"
                    >
                      {version.lifecycle}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {version.publishedAt ? formatDate(version.publishedAt) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      {canEdit && version.lifecycle === 'draft' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            publish.mutate({ id: version.id, revision: version.revision })
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
                            retire.mutate({ id: version.id, revision: version.revision })
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
                <p className="text-xs text-muted-foreground">
                  {selectedVersion.configuration.placements.length} placements ·{' '}
                  {selectedVersion.configuration.parameters.length} parameters
                </p>
                <Textarea
                  value={JSON.stringify(selectedVersion.configuration, null, 2)}
                  readOnly
                  className="min-h-56 font-mono text-xs"
                />
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <h4 className="text-sm font-semibold">Dependencies</h4>
                {versionDependencies.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading dependencies…</p>
                ) : versionDependencies.data?.dependencies.length ? (
                  <ul className="space-y-1 text-xs">
                    {versionDependencies.data.dependencies.map((dependency) => (
                      <li key={`${dependency.kind}:${dependency.id}`}>
                        {dependency.label} · {dependency.liveness} · {dependency.effect}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No dependants discovered.</p>
                )}
              </div>
            </div>
          ) : null}

          {canEdit && selectedVersion ? (
            <div className="space-y-2 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Create new draft version</h4>
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
                <FieldLabel htmlFor="builder-config">Configuration JSON</FieldLabel>
                <Textarea
                  id="builder-config"
                  className="min-h-56 font-mono text-xs"
                  value={builderConfigurationText}
                  onChange={(event) => setBuilderConfigurationText(event.target.value)}
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
                  const template = templates.data?.find((item) => item.id === selectedTemplateId)
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
              <h4 className="text-sm font-semibold">Retarget Sheet placement</h4>
              <div className="grid gap-2 lg:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="retarget-placement">Sheet placement</FieldLabel>
                  <Select
                    id="retarget-placement"
                    value={retargetPlacementId}
                    onChange={(event) => setRetargetPlacementId(event.target.value)}
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
                  <FieldLabel htmlFor="retarget-definition">Definition</FieldLabel>
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

          {canEdit && selectedVersion && selectedVersion.lifecycle === 'published' ? (
            <div className="space-y-2 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Upgrade existing Notebooks</h4>
              <p className="text-xs text-muted-foreground">
                Preview and apply an explicit upgrade to this published template version.
              </p>
              <div className="grid gap-2 lg:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="upgrade-record-id">Notebook record ID</FieldLabel>
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
              {upgradePreviewText ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {upgradePreviewText}
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
          {instantiateVersion?.configuration.parameters.length ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Template parameters
              </p>
              {instantiateVersion.configuration.parameters.map((parameter) => (
                <Field key={parameter.id}>
                  <FieldLabel htmlFor={`template-parameter-${parameter.id}`}>
                    {parameter.label}
                  </FieldLabel>
                  <Input
                    id={`template-parameter-${parameter.id}`}
                    value={parameterValues[parameter.id] ?? ''}
                    onChange={(event) =>
                      setParameterValues((current) => ({
                        ...current,
                        [parameter.id]: event.target.value,
                      }))
                    }
                    placeholder={
                      parameter.type.kind === 'scalar'
                        ? 'Enter a value'
                        : 'Enter object ID'
                    }
                  />
                </Field>
              ))}
            </div>
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
                !createProjectId || !createVersionId || instantiate.isPending
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
