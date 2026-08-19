import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Layers, Shield } from 'lucide-react'

import { AdminModelFields } from '#/components/workspace-admin/admin-model-fields'
import { VersionedNotebookTemplatePanel } from '#/components/templates/versioned-notebook-templates'
import {
  collectSheetDefinitionUpgradeInputs,
  SheetDefinitionUpgradeForm,
} from '#/components/stewardship/sheet-definition-upgrade-form'
import type { TemplateProject } from '#/components/templates/template-library'
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { hasCapability } from '#/lib/capability'
import type { Capability } from '#/lib/capability'
import type { DataClient } from '#/lib/data-client'
import {
  createDatasetSchemaDefinition,
  listCanonicalDatasetSchemaDefinitions,
  listCanonicalDatasetSchemaVersionFields,
  listCanonicalDatasetSchemaVersions,
  publishDatasetSchemaVersion,
  retireDatasetSchemaDefinition,
} from '#/lib/dataset-schema-definition-rpc'
import { discoverObjectDependencies } from '#/lib/object-dependencies'
import {
  createSheetDefinition,
  createSheetDefinitionVersion,
  extractSheetDefinitionDraft,
  fetchSheetDefinition,
  fetchSheetDefinitions,
  fetchSheetDefinitionVersions,
  publishSheetDefinitionVersion,
  previewSheetDefinitionExtraction,
  retireSheetDefinition,
  retireSheetDefinitionVersion,
  updateSheetDefinitionDraft,
} from '#/lib/sheet-definition-data'
import {
  applySheetInstanceDefinitionUpgrade,
  fetchSheetInstance,
  previewSheetInstanceDefinitionUpgrade,
} from '#/lib/sheet-instance-data'
import type { SheetDefinitionExtractionSelection } from '#/lib/sheet-definition-extraction'
import {
  applyDatasetSchemaEvolution,
  previewDatasetSchemaEvolution,
  previewLocalFieldPromotion,
  promoteLocalField,
} from '#/lib/schema-evolution'
import {
  formatDate,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { parseSheetDefinitionConfiguration } from '#/lib/sheet-definition'
import type { SheetDefinitionUpgradePreview } from '#/lib/sheet-definition-upgrade'
import type { SheetDefinitionUpgradeDecisionDraft } from '#/lib/notebook-template-upgrade'
import type { WorkspaceRole } from '#/lib/workspace-admin'
import { cn } from '#/lib/utils'

export type ConfigurationKind =
  'model' | 'schema' | 'definition' | 'template' | 'promotion'

export interface ConfigurationSearch {
  kind: ConfigurationKind
  id: string | undefined
  model: string | undefined
}

const CAPABILITY_LABELS: Record<Capability, string> = {
  'workspace.admin': 'Workspace admin',
  'schema.edit': 'Edit schema',
  'schema.publish': 'Publish schema',
  'schema.retire': 'Retire schema',
  'record.link': 'Link records',
  'record.create': 'Create records',
  'instance.upgrade': 'Upgrade instances',
}

export function configurationRoleCopy(role: WorkspaceRole | undefined): string {
  if (role === 'viewer') {
    return 'You can inspect this workspace. Creating, linking and upgrading records requires a Member or Data Steward role.'
  }
  if (hasCapability(role, 'schema.publish')) {
    if (hasCapability(role, 'workspace.admin')) {
      return 'You can evolve and publish governed configuration. Workspace security administration remains on Administration.'
    }
    return 'You can evolve and publish Models and Dataset Schema versions. You cannot administer workspace security.'
  }
  return 'You can inspect governed configuration and add Sheet-local fields. Publishing schemas requires a Data Steward.'
}

export function ConfigurationWorkspace({
  client,
  workspaceId,
  role,
  search,
  onSearchChange,
}: {
  client: DataClient
  workspaceId: string
  role: WorkspaceRole | undefined
  search: ConfigurationSearch
  onSearchChange: (search: ConfigurationSearch) => void
}) {
  const canEdit = hasCapability(role, 'schema.edit')
  const canPublish = hasCapability(role, 'schema.publish')
  const canRetire = hasCapability(role, 'schema.retire')
  const schemasQuery = useQuery({
    queryKey: ['configure', 'schemas'],
    queryFn: () => listCanonicalDatasetSchemaDefinitions(client),
  })
  const schemas = schemasQuery.data ?? []
  const definitionsQuery = useQuery({
    queryKey: ['configure', 'definitions'],
    queryFn: () => fetchSheetDefinitions(client),
  })
  const definitions = definitionsQuery.data ?? []
  const projectsQuery = useQuery({
    queryKey: notebookQueryKeys.projectsList(),
    queryFn: () =>
      notebookDataClient.list<TemplateProject>(
        'projects',
        '?order=created_at.desc',
      ),
  })
  const projects = projectsQuery.data ?? []
  const matched = schemas.find((item) => item.id === search.id)
  const selectedSchema =
    matched ?? (schemas.length > 0 ? schemas[0] : undefined)
  const matchedDefinition = definitions.find((item) => item.id === search.id)
  const selectedDefinition =
    matchedDefinition ?? (definitions.length > 0 ? definitions[0] : undefined)

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
      <nav
        aria-label="Configuration catalogue"
        className="border-b border-border p-3 lg:border-r lg:border-b-0"
      >
        <p className="px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Models
        </p>
        <CatalogueButton
          current={search.kind === 'model'}
          onClick={() =>
            onSearchChange({
              kind: 'model',
              id: undefined,
              model: search.model,
            })
          }
        >
          Model fields
        </CatalogueButton>
        <p className="mt-4 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Dataset Schema
        </p>
        {schemas.map((schema) => (
          <CatalogueButton
            key={schema.id}
            current={
              search.kind === 'schema' && selectedSchema?.id === schema.id
            }
            onClick={() =>
              onSearchChange({
                kind: 'schema',
                id: schema.id,
                model: undefined,
              })
            }
          >
            <span className="truncate">{schema.name}</span>
            <Badge variant="outline" className="ml-auto capitalize">
              {schema.lifecycle}
            </Badge>
          </CatalogueButton>
        ))}
        {schemas.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No canonical Dataset Schema Definitions yet.
          </p>
        ) : null}
        <p className="mt-4 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Sheet Definitions
        </p>
        {definitions.map((definition) => (
          <CatalogueButton
            key={definition.id}
            current={
              search.kind === 'definition' &&
              selectedDefinition?.id === definition.id
            }
            onClick={() =>
              onSearchChange({
                kind: 'definition',
                id: definition.id,
                model: undefined,
              })
            }
          >
            <span className="truncate">{definition.name}</span>
            <Badge variant="outline" className="ml-auto capitalize">
              {definition.lifecycle}
            </Badge>
          </CatalogueButton>
        ))}
        {definitions.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No Sheet Definitions yet.
          </p>
        ) : null}
        <p className="mt-4 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Notebook Templates
        </p>
        <CatalogueButton
          current={search.kind === 'template'}
          onClick={() =>
            onSearchChange({
              kind: 'template',
              id: undefined,
              model: undefined,
            })
          }
        >
          Notebook template versions
        </CatalogueButton>
        <p className="mt-4 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Promotion
        </p>
        <CatalogueButton
          current={search.kind === 'promotion'}
          onClick={() =>
            onSearchChange({
              kind: 'promotion',
              id: undefined,
              model: undefined,
            })
          }
        >
          Local field promotion
        </CatalogueButton>
      </nav>
      <section
        className="min-w-0 overflow-y-auto p-4"
        aria-label="Configuration plane"
      >
        {search.kind === 'model' ? (
          <AdminModelFields
            client={client}
            workspaceId={workspaceId}
            canManage={canEdit}
            selectedModelKey={search.model ?? 'sample'}
            onSelectedModelKeyChange={(model) =>
              onSearchChange({ kind: 'model', id: undefined, model })
            }
          />
        ) : null}
        {search.kind === 'schema' ? (
          <CanonicalSchemaPlane
            client={client}
            workspaceId={workspaceId}
            schemaId={selectedSchema?.id ?? null}
            canEdit={canEdit}
            canPublish={canPublish}
            canRetire={canRetire}
          />
        ) : null}
        {search.kind === 'definition' ? (
          <SheetDefinitionPlane
            client={client}
            workspaceId={workspaceId}
            definitionId={selectedDefinition?.id ?? null}
            canEdit={canEdit}
            canPublish={canPublish}
            canRetire={canRetire}
          />
        ) : null}
        {search.kind === 'template' ? (
          <VersionedNotebookTemplatePanel
            workspaceId={workspaceId}
            canEdit={canEdit}
            projects={projects}
          />
        ) : null}
        {search.kind === 'promotion' ? (
          <PromotionPlane client={client} canEdit={canEdit} />
        ) : null}
      </section>
      <aside
        aria-label="Configuration inspector"
        className="border-t border-border p-4 lg:border-t-0 lg:border-l"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Shield className="size-4" aria-hidden="true" />
          Capability state
        </h2>
        <ul className="mt-2 space-y-1">
          {(
            [
              'schema.edit',
              'schema.publish',
              'schema.retire',
              'workspace.admin',
            ] as const
          ).map((capability) => (
            <li
              key={capability}
              className="flex items-center justify-between text-xs"
            >
              <span>{CAPABILITY_LABELS[capability]}</span>
              <Badge
                variant={
                  hasCapability(role, capability) ? 'default' : 'outline'
                }
              >
                {hasCapability(role, capability) ? 'allowed' : 'denied'}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          {configurationRoleCopy(role)}
        </p>
        {search.kind === 'schema' && selectedSchema ? (
          <SchemaImpact client={client} schemaId={selectedSchema.id} />
        ) : null}
        {search.kind === 'definition' && selectedDefinition ? (
          <DefinitionImpact
            client={client}
            definitionId={selectedDefinition.id}
          />
        ) : null}
      </aside>
    </div>
  )
}

function buildDefaultSheetDefinitionConfiguration() {
  const identityColumnId = crypto.randomUUID()
  return {
    formatVersion: 1 as const,
    parameters: [],
    bindings: [],
    rowIdentity: { kind: 'local' as const, columnIds: [identityColumnId] },
    joins: [],
    columns: [
      {
        id: identityColumnId,
        field: {
          fieldId: identityColumnId,
          key: 'row_identity',
          label: 'Row identity',
          description: null,
          logicalType: 'reference' as const,
          nullable: false,
          defaultValue: null,
          cardinality: 'one' as const,
          quantity: null,
          validation: {},
          category: null,
          relationship: {
            target: { kind: 'model' as const, modelKey: 'sample' },
            cardinality: 'one' as const,
          },
          computation: { mode: 'stored' as const },
          lifecycle: 'active' as const,
        },
        source: { kind: 'declared' as const },
      },
    ],
    calculations: [],
    writeBackRules: [],
    actions: [],
    presentation: {
      columnOrder: [identityColumnId],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard' as const,
      filters: [],
      sorts: [],
    },
  }
}

function buildExtractionSelection(
  instance: Awaited<ReturnType<typeof fetchSheetInstance>>,
): SheetDefinitionExtractionSelection {
  if (!instance) throw new Error('Sheet Instance not found.')
  const localFieldIds = instance.state.localFields
    .filter((field) => field.lifecycle === 'active')
    .map((field) => field.fieldId)
  const calculationIds = (instance.state.instanceCalculations ?? [])
    .filter((item) => item.lifecycle === 'active')
    .map((item) => item.id)
  const resolvedIdentity = instance.state.resolvedRowIdentity
  const rowIdentity =
    resolvedIdentity && resolvedIdentity.columnIds.length > 0
      ? {
          kind: resolvedIdentity.kind,
          columnIds: [...resolvedIdentity.columnIds],
        }
      : {
          kind: 'local' as const,
          columnIds:
            localFieldIds.find((fieldId) =>
              instance.state.localFields.find(
                (field) =>
                  field.fieldId === fieldId &&
                  field.lifecycle === 'active' &&
                  field.logicalType === 'reference',
              ),
            ) !== undefined
              ? [
                  localFieldIds.find((fieldId) =>
                    instance.state.localFields.find(
                      (field) =>
                        field.fieldId === fieldId &&
                        field.lifecycle === 'active' &&
                        field.logicalType === 'reference',
                    ),
                  )!,
                ]
              : localFieldIds.slice(0, 1),
        }
  if (rowIdentity.columnIds.length === 0)
    throw new Error('Sheet Instance has no valid row identity fields.')
  return {
    bindings: [],
    columnIds: [],
    joinIds: [],
    localFieldIds,
    calculationIds,
    rowIdentity,
    includePresentation: true,
  }
}

function CatalogueButton({
  current,
  onClick,
  children,
}: {
  current: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
        current ? 'bg-muted font-medium' : 'hover:bg-muted/60',
      )}
    >
      {children}
    </button>
  )
}

function CanonicalSchemaPlane({
  client,
  workspaceId,
  schemaId,
  canEdit,
  canPublish,
  canRetire,
}: {
  client: DataClient
  workspaceId: string
  schemaId: string | null
  canEdit: boolean
  canPublish: boolean
  canRetire: boolean
}) {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [fieldLabel, setFieldLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const versionsQuery = useQuery({
    queryKey: ['configure', 'schema-versions', schemaId],
    queryFn: () => listCanonicalDatasetSchemaVersions(client, schemaId!),
    enabled: Boolean(schemaId),
  })
  const currentVersion = versionsQuery.data?.[0] ?? null
  const fieldsQuery = useQuery({
    queryKey: ['configure', 'schema-fields', currentVersion?.id],
    queryFn: () =>
      listCanonicalDatasetSchemaVersionFields(client, currentVersion!.id),
    enabled: Boolean(currentVersion?.id),
  })
  const fields = fieldsQuery.data ?? []

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['configure'] })
  }

  const create = useMutation({
    mutationFn: () =>
      createDatasetSchemaDefinition(client, {
        workspaceId,
        key,
        name,
      }),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not create schema.',
      ),
  })
  const publish = useMutation({
    mutationFn: () => publishDatasetSchemaVersion(client, currentVersion!.id),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not publish.'),
  })
  const retire = useMutation({
    mutationFn: () => retireDatasetSchemaDefinition(client, schemaId!),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not retire.'),
  })

  async function previewEvolution() {
    if (!currentVersion) return
    const nextFields = [
      ...fields.map((field) => ({
        fieldId: field.field_id,
        key: field.key,
        label: field.label,
        logicalType: field.logical_type,
        nullable: field.nullable,
        cardinality: field.cardinality as 'one' | 'many',
      })),
      {
        key: fieldKey,
        label: fieldLabel || fieldKey,
        logicalType: 'text',
        nullable: true,
      },
    ]
    const result = await previewDatasetSchemaEvolution(client, {
      schemaVersionId: currentVersion.id,
      fields: nextFields,
    })
    setPreview(
      `${result.classification ?? 'unknown'} — live Datasets stay on the previous version.`,
    )
    return nextFields
  }

  const evolve = useMutation({
    mutationFn: async () => {
      const nextFields = await previewEvolution()
      if (!currentVersion || !nextFields)
        throw new Error('No Schema Version selected.')
      return applyDatasetSchemaEvolution(client, {
        schemaVersionId: currentVersion.id,
        fields: nextFields,
        idempotencyKey: crypto.randomUUID(),
        expectedRevision: Number(currentVersion.revision),
      })
    },
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not evolve schema.',
      ),
  })

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Database className="size-4" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Canonical Dataset Schema</h2>
      </header>
      <p className="text-xs text-muted-foreground">
        This plane uses CORE-02 Dataset Schema Definitions. The legacy SCI-010
        editor on Schemas is compatibility-only.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Label className="text-xs">
          Stable key
          <Input
            className="mt-1 font-mono"
            value={key}
            disabled={!canEdit}
            onChange={(event) => setKey(event.target.value)}
          />
        </Label>
        <Label className="text-xs">
          Name
          <Input
            className="mt-1"
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
        </Label>
        <Button
          className="self-end"
          disabled={!canEdit || create.isPending}
          onClick={() => create.mutate()}
        >
          Create draft
        </Button>
      </div>
      {currentVersion ? (
        <p className="text-xs text-muted-foreground">
          Version {currentVersion.version} · {currentVersion.lifecycle}
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Required</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field) => (
            <TableRow key={field.field_id}>
              <TableCell className="font-mono text-xs">{field.key}</TableCell>
              <TableCell>{field.label}</TableCell>
              <TableCell>{field.logical_type}</TableCell>
              <TableCell>{field.nullable ? 'optional' : 'required'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Label className="text-xs">
          New field key
          <Input
            className="mt-1 font-mono"
            value={fieldKey}
            disabled={!canEdit}
            onChange={(event) => setFieldKey(event.target.value)}
          />
        </Label>
        <Label className="text-xs">
          Label
          <Input
            className="mt-1"
            value={fieldLabel}
            disabled={!canEdit}
            onChange={(event) => setFieldLabel(event.target.value)}
          />
        </Label>
        <Button
          variant="outline"
          className="self-end"
          disabled={!canEdit || !currentVersion}
          onClick={() => void previewEvolution()}
        >
          Preview impact
        </Button>
        <Button
          className="self-end"
          disabled={!canPublish || !currentVersion || evolve.isPending}
          onClick={() => evolve.mutate()}
        >
          Publish evolution
        </Button>
      </div>
      {preview ? <p className="text-xs">{preview}</p> : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!canPublish || !currentVersion || publish.isPending}
          onClick={() => publish.mutate()}
        >
          Publish version
        </Button>
        <Button
          variant="ghost"
          disabled={!canRetire || !schemaId || retire.isPending}
          onClick={() => retire.mutate()}
        >
          Retire definition
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function SheetDefinitionPlane({
  client,
  workspaceId,
  definitionId,
  canEdit,
  canPublish,
  canRetire,
}: {
  client: DataClient
  workspaceId: string
  definitionId: string | null
  canEdit: boolean
  canPublish: boolean
  canRetire: boolean
}) {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [instanceId, setInstanceId] = useState('')
  const [selectionPreview, setSelectionPreview] = useState<string | null>(null)
  const [configurationText, setConfigurationText] = useState('')
  const [consumerUpgradeInstanceId, setConsumerUpgradeInstanceId] = useState('')
  const [consumerUpgradeExpectedRevision, setConsumerUpgradeExpectedRevision] =
    useState('')
  const [consumerUpgradePreview, setConsumerUpgradePreview] =
    useState<SheetDefinitionUpgradePreview | null>(null)
  const [consumerUpgradeDecisionDrafts, setConsumerUpgradeDecisionDrafts] =
    useState<Record<string, SheetDefinitionUpgradeDecisionDraft>>({})
  const [consumerUpgradeParameterDrafts, setConsumerUpgradeParameterDrafts] =
    useState<Record<string, string>>({})
  const [consumerUpgradeMessage, setConsumerUpgradeMessage] = useState<
    string | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const versionsQuery = useQuery({
    queryKey: ['configure', 'definition-versions', definitionId],
    queryFn: () => {
      if (!definitionId) throw new Error('No Sheet Definition selected.')
      return fetchSheetDefinitionVersions(definitionId, client)
    },
    enabled: Boolean(definitionId),
  })
  const versions = versionsQuery.data ?? []
  const latestVersion =
    versions.length > 0 ? versions[versions.length - 1] : null
  const selectedDefinitionQuery = useQuery({
    queryKey: ['configure', 'definition', definitionId],
    queryFn: () => {
      if (!definitionId) throw new Error('No Sheet Definition selected.')
      return fetchSheetDefinition(definitionId, client)
    },
    enabled: Boolean(definitionId),
  })
  useEffect(() => {
    setConfigurationText(
      latestVersion ? JSON.stringify(latestVersion.configuration, null, 2) : '',
    )
  }, [latestVersion])

  const create = useMutation({
    mutationFn: () =>
      createSheetDefinition(
        {
          workspaceId,
          key,
          name,
          configuration: {
            ...buildDefaultSheetDefinitionConfiguration(),
          },
        },
        client,
      ),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['configure'] })
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not create definition.',
      ),
  })

  const publish = useMutation({
    mutationFn: () => {
      if (!latestVersion) throw new Error('No Definition version selected.')
      return publishSheetDefinitionVersion(
        latestVersion.id,
        latestVersion.revision,
        client,
      )
    },
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['configure'] })
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not publish version.',
      ),
  })

  const retireDefinition = useMutation({
    mutationFn: () => {
      if (!definitionId) throw new Error('No Sheet Definition selected.')
      const expectedRevision = selectedDefinitionQuery.data?.revision
      if (expectedRevision === undefined)
        throw new Error('Selected Sheet Definition was not found.')
      return retireSheetDefinition(definitionId, expectedRevision, client)
    },
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['configure'] })
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not retire definition.',
      ),
  })

  const retireVersion = useMutation({
    mutationFn: () => {
      if (!latestVersion) throw new Error('No Definition version selected.')
      return retireSheetDefinitionVersion(
        latestVersion.id,
        latestVersion.revision,
        client,
      )
    },
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['configure'] })
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not retire version.',
      ),
  })

  const createFromInstance = useMutation({
    mutationFn: async () => {
      const instance = await fetchSheetInstance(instanceId, client)
      const selection = buildExtractionSelection(instance)
      const source = instance!
      const preview = await previewSheetDefinitionExtraction(
        source.id,
        source.revision,
        selection,
        client,
      )
      setSelectionPreview(
        `Preview reusable: ${preview.manifest.reusable.localFieldIds.length} fields, ${preview.manifest.reusable.calculationIds.length} calculations.`,
      )
      return extractSheetDefinitionDraft(
        {
          instanceId,
          expectedInstanceRevision: source.revision,
          key: key || `sheet_def_${crypto.randomUUID().slice(0, 8)}`,
          name: name || 'Extracted Sheet Definition',
          selection,
        },
        client,
      )
    },
    onSuccess: () => {
      setError(null)
      setSelectionPreview(null)
      void queryClient.invalidateQueries({ queryKey: ['configure'] })
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not extract definition.',
      ),
  })
  const updateDraft = useMutation({
    mutationFn: () => {
      if (!latestVersion) throw new Error('No Definition version selected.')
      const parsedConfiguration = parseSheetDefinitionConfiguration(
        JSON.parse(configurationText),
      )
      return updateSheetDefinitionDraft(
        latestVersion.id,
        latestVersion.revision,
        parsedConfiguration,
        client,
      )
    },
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['configure'] })
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update draft version.',
      ),
  })
  const previewConsumerUpgrade = useMutation({
    mutationFn: () => {
      if (!latestVersion) throw new Error('No Definition version selected.')
      const targetInstanceId = consumerUpgradeInstanceId.trim()
      const expectedRevision = Number(consumerUpgradeExpectedRevision.trim())
      if (!targetInstanceId) throw new Error('Sheet Instance ID is required.')
      if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) {
        throw new Error(
          'Expected instance revision must be a positive integer.',
        )
      }
      return previewSheetInstanceDefinitionUpgrade(
        targetInstanceId,
        expectedRevision,
        latestVersion.id,
        client,
      )
    },
    onSuccess: (result) => {
      setConsumerUpgradePreview(result)
      setConsumerUpgradeDecisionDrafts({})
      setConsumerUpgradeParameterDrafts({})
      setConsumerUpgradeMessage(null)
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not preview consumer upgrade.',
      ),
  })
  const applyConsumerUpgrade = useMutation({
    mutationFn: () => {
      if (!latestVersion) throw new Error('No Definition version selected.')
      if (!consumerUpgradePreview)
        throw new Error('Preview the consumer upgrade before applying.')
      const targetInstanceId = consumerUpgradeInstanceId.trim()
      const expectedRevision = Number(consumerUpgradeExpectedRevision.trim())
      if (!targetInstanceId) throw new Error('Sheet Instance ID is required.')
      if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) {
        throw new Error(
          'Expected instance revision must be a positive integer.',
        )
      }
      const collected = collectSheetDefinitionUpgradeInputs(
        consumerUpgradePreview,
        latestVersion.configuration.parameters,
        consumerUpgradeDecisionDrafts,
        consumerUpgradeParameterDrafts,
      )
      return applySheetInstanceDefinitionUpgrade(
        {
          instanceId: targetInstanceId,
          expectedRevision,
          targetDefinitionVersionId: latestVersion.id,
          decisions: collected.decisions,
          parameterInputs: collected.parameterInputs,
        },
        client,
      )
    },
    onSuccess: (result) =>
      setConsumerUpgradeMessage(
        result.status === 'applied'
          ? 'Upgrade applied.'
          : 'Upgrade deferred until conflicts are resolved.',
      ),
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not apply consumer upgrade.',
      ),
  })
  const forkVersion = useMutation({
    mutationFn: () => {
      if (!definitionId) throw new Error('No Sheet Definition selected.')
      const sourceVersion = latestVersion
      if (!sourceVersion) throw new Error('No source version selected.')
      const selectedDefinition = selectedDefinitionQuery.data
      if (!selectedDefinition)
        throw new Error('Selected Sheet Definition was not found.')
      return createSheetDefinitionVersion(
        definitionId,
        selectedDefinition.revision,
        sourceVersion.configuration,
        client,
      )
    },
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['configure'] })
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not create new draft version.',
      ),
  })

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Layers className="size-4" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Sheet Definition catalogue</h2>
      </header>
      <p className="text-xs text-muted-foreground">
        Manage reusable Definitions with stable identity, version history,
        create-from-Instance extraction, and explicit lifecycle controls.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Label className="text-xs">
          Stable key
          <Input
            className="mt-1 font-mono"
            value={key}
            disabled={!canEdit}
            onChange={(event) => setKey(event.target.value)}
          />
        </Label>
        <Label className="text-xs">
          Name
          <Input
            className="mt-1"
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
        </Label>
        <Button
          className="self-end"
          disabled={!canEdit || !key || !name || create.isPending}
          onClick={() => create.mutate()}
        >
          Create draft
        </Button>
      </div>
      {latestVersion ? (
        <p className="text-xs text-muted-foreground">
          Latest version v{latestVersion.version} · {latestVersion.lifecycle}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          No versions available for this Definition yet.
        </p>
      )}
      {versions.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Lifecycle</TableHead>
              <TableHead>Published</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...versions].reverse().map((version) => (
              <TableRow key={version.id}>
                <TableCell>v{version.version}</TableCell>
                <TableCell>{version.lifecycle}</TableCell>
                <TableCell>
                  {version.publishedAt ? formatDate(version.publishedAt) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={
            !canEdit ||
            !latestVersion ||
            latestVersion.lifecycle !== 'draft' ||
            updateDraft.isPending
          }
          onClick={() => updateDraft.mutate()}
        >
          Save draft
        </Button>
        <Button
          variant="outline"
          disabled={
            !canEdit || !definitionId || !latestVersion || forkVersion.isPending
          }
          onClick={() => forkVersion.mutate()}
        >
          New draft version
        </Button>
        <Button
          variant="outline"
          disabled={!canPublish || !latestVersion || publish.isPending}
          onClick={() => publish.mutate()}
        >
          Publish latest
        </Button>
        <Button
          variant="outline"
          disabled={!canRetire || !latestVersion || retireVersion.isPending}
          onClick={() => retireVersion.mutate()}
        >
          Retire latest version
        </Button>
        <Button
          variant="ghost"
          disabled={!canRetire || !definitionId || retireDefinition.isPending}
          onClick={() => retireDefinition.mutate()}
        >
          Retire definition
        </Button>
      </div>
      {latestVersion?.lifecycle === 'draft' ? (
        <Label className="text-xs">
          Draft configuration JSON
          <textarea
            className="mt-1 min-h-56 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            value={configurationText}
            onChange={(event) => setConfigurationText(event.target.value)}
          />
        </Label>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Label className="text-xs">
          Create from Sheet Instance ID
          <Input
            className="mt-1 font-mono"
            value={instanceId}
            disabled={!canEdit}
            onChange={(event) => setInstanceId(event.target.value)}
          />
        </Label>
        <Button
          className="self-end"
          variant="outline"
          disabled={!canEdit || !instanceId || createFromInstance.isPending}
          onClick={() => createFromInstance.mutate()}
        >
          Create from Instance
        </Button>
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-xs font-medium">
          Upgrade Sheet Definition consumers
        </p>
        <p className="text-xs text-muted-foreground">
          Preview and apply explicit upgrades for Sheet Instances consuming this
          Definition version.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Label className="text-xs">
            Sheet Instance ID
            <Input
              className="mt-1 font-mono"
              value={consumerUpgradeInstanceId}
              disabled={!canEdit}
              onChange={(event) =>
                setConsumerUpgradeInstanceId(event.target.value)
              }
            />
          </Label>
          <Label className="text-xs">
            Expected instance revision
            <Input
              className="mt-1"
              value={consumerUpgradeExpectedRevision}
              disabled={!canEdit}
              onChange={(event) =>
                setConsumerUpgradeExpectedRevision(event.target.value)
              }
            />
          </Label>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={
              !canEdit || !latestVersion || previewConsumerUpgrade.isPending
            }
            onClick={() => previewConsumerUpgrade.mutate()}
          >
            Preview consumer upgrade
          </Button>
          <Button
            variant="outline"
            disabled={
              !canEdit || !latestVersion || applyConsumerUpgrade.isPending
            }
            onClick={() => applyConsumerUpgrade.mutate()}
          >
            Apply consumer upgrade
          </Button>
        </div>
        {consumerUpgradePreview && latestVersion ? (
          <SheetDefinitionUpgradeForm
            preview={consumerUpgradePreview}
            targetParameters={latestVersion.configuration.parameters}
            decisionDrafts={consumerUpgradeDecisionDrafts}
            parameterDrafts={consumerUpgradeParameterDrafts}
            disabled={applyConsumerUpgrade.isPending}
            onDecisionChange={(conflictId, draft) =>
              setConsumerUpgradeDecisionDrafts((current) => ({
                ...current,
                [conflictId]: draft,
              }))
            }
            onParameterChange={(parameterId, value) =>
              setConsumerUpgradeParameterDrafts((current) => ({
                ...current,
                [parameterId]: value,
              }))
            }
          />
        ) : null}
      </div>
      {consumerUpgradeMessage ? (
        <p className="text-xs text-muted-foreground" role="status">
          {consumerUpgradeMessage}
        </p>
      ) : null}
      {selectionPreview ? (
        <p className="text-xs text-muted-foreground" role="status">
          {selectionPreview}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function PromotionPlane({
  client,
  canEdit,
}: {
  client: DataClient
  canEdit: boolean
}) {
  const [instanceId, setInstanceId] = useState('')
  const [fieldId, setFieldId] = useState('')
  const [schemaId, setSchemaId] = useState('')
  const [target, setTarget] = useState<'dataset_schema' | 'model_field'>(
    'dataset_schema',
  )
  const [modelKey, setModelKey] = useState('sample')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const preview = useMutation({
    mutationFn: () =>
      previewLocalFieldPromotion(client, {
        instanceId,
        fieldId,
        target,
        schemaDefinitionId: schemaId || null,
        modelKey: target === 'model_field' ? modelKey : null,
      }),
    onSuccess: (result) =>
      setMessage(
        result.ok
          ? 'Existing local values stay on the Instance after promotion.'
          : 'Existing local values are incompatible.',
      ),
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Preview failed.'),
  })
  const promote = useMutation({
    mutationFn: () =>
      promoteLocalField(client, {
        instanceId,
        fieldId,
        target,
        schemaDefinitionId: schemaId || null,
        modelKey: target === 'model_field' ? modelKey : null,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () =>
      setMessage('Promoted. Historical Instance values remain local.'),
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Promotion failed.'),
  })
  return (
    <div className="max-w-xl space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Layers className="size-4" aria-hidden="true" />
        Promote a local field
      </h2>
      <p className="text-xs text-muted-foreground">
        Promotion is explicit. Values already stored on the Sheet Instance stay
        local; the new Model or Dataset Schema field is a governed identity.
      </p>
      <Label className="text-xs">
        Instance ID
        <Input
          className="mt-1 font-mono"
          value={instanceId}
          disabled={!canEdit}
          onChange={(event) => setInstanceId(event.target.value)}
        />
      </Label>
      <Label className="text-xs">
        Local field ID
        <Input
          className="mt-1 font-mono"
          value={fieldId}
          disabled={!canEdit}
          onChange={(event) => setFieldId(event.target.value)}
        />
      </Label>
      <Label className="text-xs">
        Target
        <Select
          className="mt-1"
          value={target}
          disabled={!canEdit}
          onChange={(event) =>
            setTarget(event.target.value as 'dataset_schema' | 'model_field')
          }
        >
          <option value="dataset_schema">Dataset Schema field</option>
          <option value="model_field">Model field</option>
        </Select>
      </Label>
      {target === 'dataset_schema' ? (
        <Label className="text-xs">
          Dataset Schema Definition ID
          <Input
            className="mt-1 font-mono"
            value={schemaId}
            disabled={!canEdit}
            onChange={(event) => setSchemaId(event.target.value)}
          />
        </Label>
      ) : (
        <Label className="text-xs">
          Target Model key
          <Input
            className="mt-1 font-mono"
            value={modelKey}
            disabled={!canEdit}
            onChange={(event) => setModelKey(event.target.value)}
          />
        </Label>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!canEdit}
          onClick={() => preview.mutate()}
        >
          Preview
        </Button>
        <Button disabled={!canEdit} onClick={() => promote.mutate()}>
          Promote
        </Button>
      </div>
      {message ? <p className="text-xs">{message}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function DefinitionImpact({
  client,
  definitionId,
}: {
  client: DataClient
  definitionId: string
}) {
  const versionsQuery = useQuery({
    queryKey: ['configure', 'definition-versions', definitionId],
    queryFn: () => fetchSheetDefinitionVersions(definitionId, client),
  })
  const versionId = versionsQuery.data?.[versionsQuery.data.length - 1]?.id
  const impactQuery = useQuery({
    queryKey: ['configure', 'definition-impact', versionId],
    queryFn: () =>
      discoverObjectDependencies(
        client,
        'sheet_definition_version',
        versionId!,
      ),
    enabled: Boolean(versionId),
  })
  const dependencies = useMemo(
    () => impactQuery.data?.dependencies ?? [],
    [impactQuery.data],
  )
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Definition dependencies</h3>
      {dependencies.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No dependants.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {dependencies.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              {item.label} · {item.liveness} · {item.effect}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SchemaImpact({
  client,
  schemaId,
}: {
  client: DataClient
  schemaId: string
}) {
  const versionsQuery = useQuery({
    queryKey: ['configure', 'schema-versions', schemaId],
    queryFn: () => listCanonicalDatasetSchemaVersions(client, schemaId),
  })
  const versionId = versionsQuery.data?.[0]?.id
  const impactQuery = useQuery({
    queryKey: ['configure', 'impact', versionId],
    queryFn: () =>
      discoverObjectDependencies(client, 'dataset_schema_version', versionId!),
    enabled: Boolean(versionId),
  })
  const dependencies = useMemo(
    () => impactQuery.data?.dependencies ?? [],
    [impactQuery.data],
  )
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Dependency impact</h3>
      {dependencies.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No dependents.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {dependencies.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              {item.label} · {item.liveness} · {item.effect}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
