import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
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
  Checkbox,
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
import type { DatasetSchemaFieldInput } from '#/lib/dataset-schema-definition-rpc'
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
  fetchSheetInstances,
  fetchSheetInstance,
  previewSheetInstanceDefinitionUpgrade,
} from '#/lib/sheet-instance-data'
import type { SheetDefinitionExtractionSelection } from '#/lib/sheet-definition-extraction'
import {
  applyDatasetSchemaEvolution,
  previewCalculationPromotion,
  previewDatasetSchemaEvolution,
  previewLocalFieldPromotion,
  promoteCalculation,
  promoteLocalField,
} from '#/lib/schema-evolution'
import { loadConfigurationVocabularies } from '#/lib/configuration-vocabularies'
import type { ConfigurationVocabulary } from '#/lib/configuration-vocabularies'
import { fetchModelKinds } from '#/lib/model-fields'
import { fetchNotebookTemplates } from '#/lib/notebook-template-data'
import {
  formatDate,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import {
  parseSheetDefinitionConfiguration,
  sheetFieldDefinitionSchema,
} from '#/lib/sheet-definition'
import type { SheetDefinitionUpgradePreview } from '#/lib/sheet-definition-upgrade'
import type { SheetDefinitionUpgradeDecisionDraft } from '#/lib/notebook-template-upgrade'
import type { WorkspaceRole } from '#/lib/workspace-admin'
import {
  parentLifecycleBadgeVariant,
  sheetDefinitionNeedsLine,
  summarizeSheetDefinitionRequirements,
  versionLifecycleBadgeVariant,
} from '#/lib/reuse-discovery'
import { cn } from '#/lib/utils'

export type ConfigurationKind =
  'model' | 'schema' | 'definition' | 'template' | 'vocabulary' | 'promotion'

export interface ConfigurationSearch {
  kind: ConfigurationKind
  id: string | undefined
  model: string | undefined
}

const DATASET_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'integer', label: 'Whole number' },
  { value: 'decimal', label: 'Decimal number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'date', label: 'Date' },
  { value: 'timestamp', label: 'Date and time' },
  { value: 'category', label: 'Category' },
  { value: 'reference', label: 'Record reference' },
] as const

type DatasetFieldType = (typeof DATASET_FIELD_TYPES)[number]['value']

const CAPABILITY_LABELS: Record<Capability, string> = {
  'workspace.admin': 'Workspace admin',
  'schema.edit': 'Edit schema',
  'schema.publish': 'Publish schema',
  'schema.retire': 'Retire schema',
  'record.link': 'Link records',
  'record.create': 'Create records',
  'instance.upgrade': 'Upgrade instances',
  'integrations.manage': 'Manage integrations',
  'pipelines.manage': 'Manage Pipelines',
}

export function configurationRoleCopy(role: WorkspaceRole | undefined): string {
  if (role === 'viewer') {
    return 'You can inspect this workspace. Creating, linking and upgrading records requires a Member or Data Steward role.'
  }
  if (hasCapability(role, 'schema.publish')) {
    if (hasCapability(role, 'workspace.admin')) {
      return 'You can evolve and publish Models, Dataset Schemas, Sheet Definitions and Notebook Templates. Workspace security administration remains on Administration.'
    }
    return 'You can evolve and publish Models, Dataset Schemas, Sheet Definitions and Notebook Templates. You cannot administer workspace security.'
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
  // REUSE-01: purpose/context facets for the versioned definition/template
  // lists, from stable metadata already on the rows (name/key text search +
  // parent lifecycle). No free-text purpose inference.
  const [catalogueSearch, setCatalogueSearch] = useState('')
  const [catalogueLifecycle, setCatalogueLifecycle] = useState<
    'all' | 'active' | 'retired'
  >('all')
  const schemasQuery = useQuery({
    queryKey: ['configure', workspaceId, 'schemas'],
    queryFn: () => listCanonicalDatasetSchemaDefinitions(client),
  })
  const schemas = schemasQuery.data ?? []
  const definitionsQuery = useQuery({
    queryKey: ['configure', workspaceId, 'definitions'],
    queryFn: () => fetchSheetDefinitions(client),
  })
  const definitions = useMemo(() => {
    const needle = catalogueSearch.trim().toLowerCase()
    return (definitionsQuery.data ?? []).filter(
      (definition) =>
        (catalogueLifecycle === 'all' ||
          definition.lifecycle === catalogueLifecycle) &&
        (!needle ||
          definition.name.toLowerCase().includes(needle) ||
          definition.key.toLowerCase().includes(needle)),
    )
  }, [definitionsQuery.data, catalogueSearch, catalogueLifecycle])
  const notebookTemplatesQuery = useQuery({
    queryKey: ['configure', workspaceId, 'notebook-templates'],
    queryFn: () => fetchNotebookTemplates(client, { limit: 200 }),
  })
  const notebookTemplates = useMemo(() => {
    const needle = catalogueSearch.trim().toLowerCase()
    return (notebookTemplatesQuery.data ?? []).filter(
      (template) =>
        (catalogueLifecycle === 'all' ||
          template.lifecycle === catalogueLifecycle) &&
        (!needle ||
          template.name.toLowerCase().includes(needle) ||
          template.key.toLowerCase().includes(needle)),
    )
  }, [notebookTemplatesQuery.data, catalogueSearch, catalogueLifecycle])
  const vocabulariesQuery = useInfiniteQuery({
    queryKey: ['configure', workspaceId, 'vocabularies'],
    queryFn: ({ pageParam }) =>
      loadConfigurationVocabularies(client, workspaceId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length * 200 : undefined,
    enabled: search.kind === 'vocabulary',
  })
  const vocabularies =
    vocabulariesQuery.data?.pages.flatMap((page) => page.items) ?? []
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
  const matchedVocabulary = vocabularies.find((item) => item.id === search.id)
  const selectedVocabulary =
    matchedVocabulary ?? (vocabularies.length > 0 ? vocabularies[0] : undefined)
  const matchedTemplate = notebookTemplates.find(
    (item) => item.id === search.id,
  )
  const selectedTemplate =
    matchedTemplate ??
    (notebookTemplates.length > 0 ? notebookTemplates[0] : undefined)

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
        <div className="mt-4 space-y-2 px-2">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Reusable catalogue
          </p>
          <label htmlFor="configure-catalogue-search" className="sr-only">
            Filter Sheet Definitions and Notebook Templates
          </label>
          <Input
            id="configure-catalogue-search"
            value={catalogueSearch}
            onChange={(event) => setCatalogueSearch(event.target.value)}
            placeholder="Filter definitions and templates"
            className="h-8 text-xs"
          />
          <label htmlFor="configure-catalogue-lifecycle" className="sr-only">
            Filter by lifecycle
          </label>
          <Select
            id="configure-catalogue-lifecycle"
            value={catalogueLifecycle}
            onChange={(event) =>
              setCatalogueLifecycle(
                event.target.value as typeof catalogueLifecycle,
              )
            }
            className="h-8 text-xs"
          >
            <option value="all">All lifecycles</option>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </Select>
        </div>
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
            <Badge
              variant={parentLifecycleBadgeVariant(definition.lifecycle)}
              className="ml-auto capitalize"
            >
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
        {notebookTemplates.map((template) => (
          <CatalogueButton
            key={template.id}
            current={
              search.kind === 'template' && selectedTemplate?.id === template.id
            }
            onClick={() =>
              onSearchChange({
                kind: 'template',
                id: template.id,
                model: undefined,
              })
            }
          >
            <span className="truncate">{template.name}</span>
            <Badge
              variant={parentLifecycleBadgeVariant(template.lifecycle)}
              className="ml-auto capitalize"
            >
              {template.lifecycle}
            </Badge>
          </CatalogueButton>
        ))}
        {notebookTemplates.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No Notebook Templates yet.
          </p>
        ) : null}
        <p className="mt-4 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Vocabularies
        </p>
        <CatalogueButton
          current={search.kind === 'vocabulary' && !search.id}
          onClick={() =>
            onSearchChange({
              kind: 'vocabulary',
              id: undefined,
              model: undefined,
            })
          }
        >
          Vocabularies
        </CatalogueButton>
        {search.kind === 'vocabulary'
          ? vocabularies.map((vocabulary) => (
              <CatalogueButton
                key={vocabulary.id}
                current={
                  search.kind === 'vocabulary' &&
                  selectedVocabulary?.id === vocabulary.id
                }
                onClick={() =>
                  onSearchChange({
                    kind: 'vocabulary',
                    id: vocabulary.id,
                    model: undefined,
                  })
                }
              >
                <span className="truncate">{vocabulary.label}</span>
              </CatalogueButton>
            ))
          : null}
        {search.kind === 'vocabulary' && vocabulariesQuery.isLoading ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Loading category sources…
          </p>
        ) : null}
        {search.kind === 'vocabulary' && vocabulariesQuery.isError ? (
          <p className="px-2 py-2 text-xs text-destructive" role="alert">
            Could not load category sources.
          </p>
        ) : null}
        {search.kind === 'vocabulary' && vocabulariesQuery.hasNextPage ? (
          <Button
            className="mx-2 mt-2"
            size="sm"
            variant="outline"
            disabled={vocabulariesQuery.isFetchingNextPage}
            onClick={() => vocabulariesQuery.fetchNextPage()}
          >
            {vocabulariesQuery.isFetchingNextPage
              ? 'Loading more…'
              : 'Load more category sources'}
          </Button>
        ) : null}
        {search.kind === 'vocabulary' &&
        !vocabulariesQuery.isLoading &&
        !vocabulariesQuery.isError &&
        vocabularies.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No category vocabularies collected yet.
          </p>
        ) : null}
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
          Field and calculation promotion
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
            selectedTemplateId={search.id ?? selectedTemplate?.id ?? null}
            onSelectedTemplateIdChange={(templateId) =>
              onSearchChange({
                kind: 'template',
                id: templateId ?? undefined,
                model: undefined,
              })
            }
          />
        ) : null}
        {search.kind === 'vocabulary' ? (
          <VocabularyPlane vocabulary={selectedVocabulary} />
        ) : null}
        {search.kind === 'promotion' ? (
          <PromotionPlane
            client={client}
            workspaceId={workspaceId}
            canEdit={canEdit}
            schemas={schemas}
          />
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
        {search.kind === 'template' && (search.id ?? selectedTemplate?.id) ? (
          <TemplateImpact
            client={client}
            templateId={search.id ?? selectedTemplate!.id}
          />
        ) : null}
        {search.kind === 'vocabulary' && selectedVocabulary ? (
          <VocabularyInspector vocabulary={selectedVocabulary} />
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
  const [fieldType, setFieldType] = useState<DatasetFieldType>('text')
  const [fieldDescription, setFieldDescription] = useState('')
  const [fieldRequired, setFieldRequired] = useState(false)
  const [fieldCardinality, setFieldCardinality] = useState<'one' | 'many'>(
    'one',
  )
  const [fieldDefaultValue, setFieldDefaultValue] = useState('')
  const [fieldCategoryOptions, setFieldCategoryOptions] = useState('')
  const [fieldVocabularyId, setFieldVocabularyId] = useState('')
  const [fieldReferenceModel, setFieldReferenceModel] = useState('sample')
  const [fieldQuantityKind, setFieldQuantityKind] = useState('')
  const [fieldQuantityDimension, setFieldQuantityDimension] = useState('')
  const [fieldQuantityStorageUnit, setFieldQuantityStorageUnit] = useState('')
  const [fieldValidation, setFieldValidation] = useState('{}')
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

  function buildNextFields(): DatasetSchemaFieldInput[] {
    let validation: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(fieldValidation)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Validation must be a JSON object.')
      }
      validation = parsed as Record<string, unknown>
    } catch (cause) {
      throw cause instanceof Error
        ? cause
        : new Error('Validation must be a JSON object.')
    }

    if (
      fieldType === 'boolean' &&
      fieldDefaultValue.trim() !== '' &&
      fieldDefaultValue !== 'true' &&
      fieldDefaultValue !== 'false'
    ) {
      throw new Error('Boolean defaults must be true or false.')
    }
    if (
      (fieldType === 'category' || fieldType === 'reference') &&
      fieldDefaultValue.trim()
    ) {
      throw new Error(
        'Category and reference defaults must be configured from stable IDs.',
      )
    }
    const defaultValue = fieldDefaultValue.trim()
      ? fieldType === 'integer' || fieldType === 'decimal'
        ? Number(fieldDefaultValue)
        : fieldType === 'boolean'
          ? fieldDefaultValue === 'true'
          : fieldDefaultValue
      : null
    if (
      fieldDefaultValue.trim() &&
      (fieldType === 'integer' || fieldType === 'decimal') &&
      Number.isNaN(defaultValue)
    ) {
      throw new Error('Numeric defaults must be valid numbers.')
    }
    if (fieldCardinality === 'many' && defaultValue !== null) {
      throw new Error('Many-valued fields cannot have a default value.')
    }
    const category =
      fieldType !== 'category'
        ? null
        : fieldVocabularyId.trim()
          ? { kind: 'vocabulary', vocabularyId: fieldVocabularyId.trim() }
          : {
              kind: 'embedded',
              options: fieldCategoryOptions
                .split(',')
                .map((option) => option.trim())
                .filter(Boolean)
                .map((option, index) => ({
                  id: crypto.randomUUID(),
                  key: option.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                  label: option,
                  displayOrder: index,
                  lifecycle: 'active',
                })),
            }
    if (
      fieldType === 'category' &&
      !fieldVocabularyId.trim() &&
      !fieldCategoryOptions.trim()
    ) {
      throw new Error(
        'Category fields need options or a reusable vocabulary ID.',
      )
    }
    const quantity =
      fieldQuantityKind.trim() ||
      fieldQuantityDimension.trim() ||
      fieldQuantityStorageUnit.trim()
        ? {
            kind: fieldQuantityKind.trim(),
            dimension: fieldQuantityDimension.trim(),
            storageUnit: fieldQuantityStorageUnit.trim(),
          }
        : null
    if (quantity && fieldType !== 'integer' && fieldType !== 'decimal') {
      throw new Error('Quantity semantics require a numeric field.')
    }
    if (
      quantity &&
      (!quantity.kind || !quantity.dimension || !quantity.storageUnit)
    ) {
      throw new Error(
        'Quantity kind, dimension and storage unit must all be supplied.',
      )
    }
    const newField = {
      fieldId: crypto.randomUUID(),
      key: fieldKey.trim(),
      label: fieldLabel.trim() || fieldKey.trim(),
      description: fieldDescription.trim() || null,
      logicalType: fieldType,
      nullable: !fieldRequired,
      defaultValue,
      cardinality: fieldCardinality,
      quantity,
      validation,
      category,
      relationship:
        fieldType === 'reference'
          ? {
              target: { kind: 'model', modelKey: fieldReferenceModel.trim() },
              cardinality: fieldCardinality,
            }
          : null,
      computation: { mode: 'stored' },
      lifecycle: 'active' as const,
    }
    sheetFieldDefinitionSchema.parse(newField)
    return [
      ...fields.map((field) => ({
        fieldId: field.field_id,
        key: field.key,
        label: field.label,
        description: field.description,
        logicalType: field.logical_type,
        nullable: field.nullable,
        defaultValue: field.default_value,
        quantity: field.quantity,
        validation: field.validation ?? {},
        category: field.category,
        relationship: field.relationship,
        cardinality: field.cardinality as 'one' | 'many',
        lifecycle: field.lifecycle as 'active' | 'retired',
        displayOrder: field.display_order,
      })),
      { ...newField, displayOrder: fields.length },
    ]
  }

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
    const nextFields = buildNextFields()
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
        CORE-02 Dataset Schema Definitions are the only schema editor in this
        workspace.
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
      <div className="space-y-3 rounded-md border p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
          <Label className="text-xs">
            Type
            <Select
              className="mt-1"
              value={fieldType}
              disabled={!canEdit}
              onChange={(event) =>
                setFieldType(event.target.value as DatasetFieldType)
              }
            >
              {DATASET_FIELD_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Label>
          <Label className="text-xs">
            Cardinality
            <Select
              className="mt-1"
              value={fieldCardinality}
              disabled={!canEdit}
              onChange={(event) =>
                setFieldCardinality(event.target.value as 'one' | 'many')
              }
            >
              <option value="one">One value</option>
              <option value="many">Many values</option>
            </Select>
          </Label>
          <Label className="text-xs sm:col-span-2">
            Description
            <Input
              className="mt-1"
              value={fieldDescription}
              disabled={!canEdit}
              onChange={(event) => setFieldDescription(event.target.value)}
            />
          </Label>
          <Label className="text-xs">
            Default value
            <Input
              className="mt-1"
              value={fieldDefaultValue}
              disabled={
                !canEdit ||
                fieldCardinality === 'many' ||
                fieldType === 'category' ||
                fieldType === 'reference'
              }
              onChange={(event) => setFieldDefaultValue(event.target.value)}
            />
          </Label>
          <Label className="flex items-center gap-2 self-end pb-2 text-xs">
            <Checkbox
              checked={fieldRequired}
              disabled={!canEdit}
              onCheckedChange={(checked) => setFieldRequired(checked === true)}
            />
            Required
          </Label>
          {fieldType === 'category' ? (
            <>
              <Label className="text-xs sm:col-span-2">
                Embedded options, comma separated
                <Input
                  className="mt-1"
                  value={fieldCategoryOptions}
                  disabled={!canEdit || Boolean(fieldVocabularyId.trim())}
                  onChange={(event) =>
                    setFieldCategoryOptions(event.target.value)
                  }
                  placeholder="pass, fail, pending"
                />
              </Label>
              <Label className="text-xs sm:col-span-2">
                Or reusable vocabulary ID
                <Input
                  className="mt-1 font-mono"
                  value={fieldVocabularyId}
                  disabled={!canEdit || Boolean(fieldCategoryOptions.trim())}
                  onChange={(event) => setFieldVocabularyId(event.target.value)}
                />
              </Label>
            </>
          ) : null}
          {fieldType === 'reference' ? (
            <Label className="text-xs sm:col-span-2">
              Referenced Model key
              <Input
                className="mt-1 font-mono"
                value={fieldReferenceModel}
                disabled={!canEdit}
                onChange={(event) => setFieldReferenceModel(event.target.value)}
              />
            </Label>
          ) : null}
          {fieldType === 'integer' || fieldType === 'decimal' ? (
            <>
              <Label className="text-xs">
                Quantity kind
                <Input
                  className="mt-1"
                  value={fieldQuantityKind}
                  disabled={!canEdit}
                  onChange={(event) => setFieldQuantityKind(event.target.value)}
                  placeholder="concentration"
                />
              </Label>
              <Label className="text-xs">
                Dimension
                <Input
                  className="mt-1"
                  value={fieldQuantityDimension}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setFieldQuantityDimension(event.target.value)
                  }
                  placeholder="mass / volume"
                />
              </Label>
              <Label className="text-xs">
                Storage unit
                <Input
                  className="mt-1"
                  value={fieldQuantityStorageUnit}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setFieldQuantityStorageUnit(event.target.value)
                  }
                  placeholder="mg/mL"
                />
              </Label>
            </>
          ) : null}
          <Label className="text-xs sm:col-span-2">
            Validation JSON
            <Input
              className="mt-1 font-mono"
              value={fieldValidation}
              disabled={!canEdit}
              onChange={(event) => setFieldValidation(event.target.value)}
            />
          </Label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="self-end"
            disabled={!canEdit || !currentVersion || !fieldKey.trim()}
            onClick={() =>
              void previewEvolution().catch((cause: unknown) =>
                setError(
                  cause instanceof Error ? cause.message : 'Could not preview.',
                ),
              )
            }
          >
            Preview impact
          </Button>
          <Button
            className="self-end"
            disabled={
              !canPublish ||
              !currentVersion ||
              !fieldKey.trim() ||
              evolve.isPending
            }
            onClick={() => evolve.mutate()}
          >
            Publish evolution
          </Button>
        </div>
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
  // REUSE-01: usage/dependency visibility at catalogue level for the latest
  // version — the same discover_object_dependencies surface templates use.
  const usageQuery = useQuery({
    queryKey: ['configure', 'definition-usage', latestVersion?.id],
    queryFn: () =>
      discoverObjectDependencies(
        client,
        'sheet_definition_version',
        latestVersion!.id,
      ),
    enabled: Boolean(latestVersion),
  })
  const usageDependencies = usageQuery.data?.dependencies ?? []
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
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-medium">
            Reuse requirements · v{latestVersion.version}{' '}
            <Badge
              variant={versionLifecycleBadgeVariant(latestVersion.lifecycle)}
              className="ml-1 capitalize"
            >
              {latestVersion.lifecycle}
            </Badge>
          </p>
          {(() => {
            const summary = summarizeSheetDefinitionRequirements(
              latestVersion.configuration,
            )
            return (
              <>
                <p className="text-xs text-muted-foreground">
                  {sheetDefinitionNeedsLine(summary)} ·{' '}
                  {summary.columnCount}{' '}
                  {summary.columnCount === 1 ? 'column' : 'columns'}
                  {summary.joinCount > 0
                    ? ` · ${summary.joinCount} ${summary.joinCount === 1 ? 'join' : 'joins'}`
                    : ''}
                  {summary.writeBackRuleCount > 0
                    ? ` · ${summary.writeBackRuleCount} write-back ${summary.writeBackRuleCount === 1 ? 'rule' : 'rules'}`
                    : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reusing this version pins its configuration: consuming Sheet
                  Instances resolve the listed parameters and supply a dataset
                  for each of the {summary.bindingCount}{' '}
                  {summary.bindingCount === 1 ? 'binding' : 'bindings'}.
                  Preview consumer upgrades before applying them below.
                </p>
              </>
            )
          })()}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No versions available for this Definition yet.
        </p>
      )}
      {latestVersion ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-medium">
            Usage & dependencies · v{latestVersion.version}
          </p>
          {usageQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">
              Loading usage…
            </p>
          ) : usageDependencies.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {usageDependencies.map((dependency) => (
                <li key={`${dependency.kind}:${dependency.id}`}>
                  {dependency.label} · {dependency.liveness} ·{' '}
                  {dependency.effect}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No dependants discovered for this version.
            </p>
          )}
        </div>
      ) : null}
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
                <TableCell>
                  <Badge
                    variant={versionLifecycleBadgeVariant(version.lifecycle)}
                    className="capitalize"
                  >
                    {version.lifecycle}
                  </Badge>
                </TableCell>
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
            client={client}
            workspaceId={workspaceId}
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
  workspaceId,
  canEdit,
  schemas,
}: {
  client: DataClient
  workspaceId: string
  canEdit: boolean
  schemas: Awaited<ReturnType<typeof listCanonicalDatasetSchemaDefinitions>>
}) {
  const [instanceId, setInstanceId] = useState('')
  const [fieldId, setFieldId] = useState('')
  const [schemaId, setSchemaId] = useState('')
  const [target, setTarget] = useState<'dataset_schema' | 'model_field'>(
    'dataset_schema',
  )
  const [modelKey, setModelKey] = useState('')
  const [fieldMessage, setFieldMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [calculationId, setCalculationId] = useState('')
  const [calculationTarget, setCalculationTarget] = useState<
    'sheet_definition' | 'dataset_schema'
  >('sheet_definition')
  const [calculationSchemaId, setCalculationSchemaId] = useState('')
  const [calculationMessage, setCalculationMessage] = useState<string | null>(
    null,
  )
  const [calculationError, setCalculationError] = useState<string | null>(null)
  const instancesQuery = useQuery({
    queryKey: ['configure', workspaceId, 'promotion-instances'],
    queryFn: () => fetchSheetInstances(client),
  })
  const modelsQuery = useQuery({
    queryKey: ['configure', workspaceId, 'promotion-models'],
    queryFn: () => fetchModelKinds(client),
  })
  const instances = (instancesQuery.data ?? []).filter(
    (instance) =>
      instance.workspaceId === workspaceId && instance.lifecycle === 'active',
  )
  const selectedInstance = instances.find(
    (instance) => instance.id === instanceId,
  )
  const previewField = useMutation({
    mutationFn: () =>
      previewLocalFieldPromotion(client, {
        instanceId,
        fieldId,
        target,
        schemaDefinitionId: schemaId || null,
        modelKey: target === 'model_field' ? modelKey : null,
      }),
    onSuccess: (result) =>
      setFieldMessage(
        result.ok
          ? 'Existing local values stay on the Instance after promotion.'
          : 'Existing local values are incompatible.',
      ),
    onError: (cause: unknown) =>
      setFieldError(cause instanceof Error ? cause.message : 'Preview failed.'),
  })
  const promoteField = useMutation({
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
      setFieldMessage('Promoted. Historical Instance values remain local.'),
    onError: (cause: unknown) =>
      setFieldError(
        cause instanceof Error ? cause.message : 'Promotion failed.',
      ),
  })
  const previewCalculation = useMutation({
    mutationFn: () =>
      previewCalculationPromotion(client, {
        instanceId,
        calculationId,
        target: calculationTarget,
      }),
    onSuccess: (result) =>
      setCalculationMessage(
        result.ok
          ? 'Existing local calculation results stay on the Instance after promotion.'
          : 'Existing local calculation results are incompatible.',
      ),
    onError: (cause: unknown) =>
      setCalculationError(
        cause instanceof Error ? cause.message : 'Preview failed.',
      ),
  })
  const promoteCalculationMutation = useMutation({
    mutationFn: () =>
      promoteCalculation(client, {
        instanceId,
        calculationId,
        target: calculationTarget,
        schemaDefinitionId:
          calculationTarget === 'dataset_schema'
            ? calculationSchemaId || null
            : null,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () =>
      setCalculationMessage(
        'Promoted. Historical Instance calculation results remain local.',
      ),
    onError: (cause: unknown) =>
      setCalculationError(
        cause instanceof Error ? cause.message : 'Promotion failed.',
      ),
  })
  return (
    <div className="max-w-xl space-y-8">
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Layers className="size-4" aria-hidden="true" />
          Promote a local field
        </h2>
        <p className="text-xs text-muted-foreground">
          Promotion is explicit. Values already stored on the Sheet Instance
          stay local; the new Model or Dataset Schema field is a governed
          identity.
        </p>
        <Label className="text-xs">
          Sheet
          <Select
            className="mt-1 font-mono"
            value={instanceId}
            disabled={!canEdit}
            onChange={(event) => {
              setInstanceId(event.target.value)
              setFieldId('')
              setCalculationId('')
            }}
          >
            <option value="">Select a Sheet</option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </Select>
        </Label>
        <Label className="text-xs">
          Local field
          <Select
            className="mt-1 font-mono"
            value={fieldId}
            disabled={!canEdit}
            onChange={(event) => setFieldId(event.target.value)}
          >
            <option value="">Select a local field</option>
            {(selectedInstance?.state.localFields ?? [])
              .filter((field) => field.lifecycle === 'active')
              .map((field) => (
                <option key={field.fieldId} value={field.fieldId}>
                  {field.label}
                </option>
              ))}
          </Select>
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
            Dataset Schema
            <Select
              className="mt-1"
              value={schemaId}
              disabled={!canEdit}
              onChange={(event) => setSchemaId(event.target.value)}
            >
              <option value="">Select a Dataset Schema</option>
              {schemas.map((schema) => (
                <option key={schema.id} value={schema.id}>
                  {schema.name}
                </option>
              ))}
            </Select>
          </Label>
        ) : (
          <Label className="text-xs">
            Target Model
            <Select
              className="mt-1"
              value={modelKey}
              disabled={!canEdit}
              onChange={(event) => setModelKey(event.target.value)}
            >
              <option value="">Select a Model</option>
              {(modelsQuery.data ?? []).map((model) => (
                <option key={model.key} value={model.key}>
                  {model.label}
                </option>
              ))}
            </Select>
          </Label>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={
              !canEdit ||
              !instanceId ||
              !fieldId ||
              (target === 'dataset_schema' ? !schemaId : !modelKey)
            }
            onClick={() => previewField.mutate()}
          >
            Preview field promotion
          </Button>
          <Button
            disabled={
              !canEdit ||
              !instanceId ||
              !fieldId ||
              (target === 'dataset_schema' ? !schemaId : !modelKey)
            }
            onClick={() => promoteField.mutate()}
          >
            Promote field
          </Button>
        </div>
        {fieldMessage ? <p className="text-xs">{fieldMessage}</p> : null}
        {fieldError ? (
          <p role="alert" className="text-sm text-destructive">
            {fieldError}
          </p>
        ) : null}
      </div>
      <div className="space-y-3 border-t pt-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Layers className="size-4" aria-hidden="true" />
          Promote a local calculation
        </h2>
        <p className="text-xs text-muted-foreground">
          Promotion is explicit. Calculation results already stored on the Sheet
          Instance stay local; the promoted calculation becomes a governed Sheet
          Definition or Dataset Schema identity.
        </p>
        <Label className="text-xs">
          Sheet
          <Select
            className="mt-1 font-mono"
            value={instanceId}
            disabled={!canEdit}
            onChange={(event) => {
              setInstanceId(event.target.value)
              setFieldId('')
              setCalculationId('')
            }}
          >
            <option value="">Select a Sheet</option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </Select>
        </Label>
        <Label className="text-xs">
          Local calculation
          <Select
            className="mt-1 font-mono"
            value={calculationId}
            disabled={!canEdit}
            onChange={(event) => setCalculationId(event.target.value)}
          >
            <option value="">Select a local calculation</option>
            {(selectedInstance?.state.instanceCalculations ?? [])
              .filter((calculation) => calculation.lifecycle === 'active')
              .map((calculation) => (
                <option key={calculation.id} value={calculation.id}>
                  {calculation.label}
                </option>
              ))}
          </Select>
        </Label>
        <Label className="text-xs">
          Target
          <Select
            className="mt-1"
            value={calculationTarget}
            disabled={!canEdit}
            onChange={(event) =>
              setCalculationTarget(
                event.target.value as 'sheet_definition' | 'dataset_schema',
              )
            }
          >
            <option value="sheet_definition">Sheet Definition</option>
            <option value="dataset_schema">Dataset Schema</option>
          </Select>
        </Label>
        {calculationTarget === 'dataset_schema' ? (
          <Label className="text-xs">
            Dataset Schema
            <Select
              className="mt-1"
              value={calculationSchemaId}
              disabled={!canEdit}
              onChange={(event) => setCalculationSchemaId(event.target.value)}
            >
              <option value="">Select a Dataset Schema</option>
              {schemas.map((schema) => (
                <option key={schema.id} value={schema.id}>
                  {schema.name}
                </option>
              ))}
            </Select>
          </Label>
        ) : null}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={
              !canEdit ||
              !instanceId ||
              !calculationId ||
              (calculationTarget === 'dataset_schema' && !calculationSchemaId)
            }
            onClick={() => previewCalculation.mutate()}
          >
            Preview calculation promotion
          </Button>
          <Button
            disabled={
              !canEdit ||
              !instanceId ||
              !calculationId ||
              (calculationTarget === 'dataset_schema' && !calculationSchemaId)
            }
            onClick={() => promoteCalculationMutation.mutate()}
          >
            Promote calculation
          </Button>
        </div>
        {calculationMessage ? (
          <p className="text-xs">{calculationMessage}</p>
        ) : null}
        {calculationError ? (
          <p role="alert" className="text-sm text-destructive">
            {calculationError}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function VocabularyPlane({
  vocabulary,
}: {
  vocabulary: ConfigurationVocabulary | undefined
}) {
  if (!vocabulary) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a vocabulary from the catalogue.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{vocabulary.label}</h2>
      <p className="text-xs text-muted-foreground">
        {vocabulary.sourceLabel} · {vocabulary.fieldKey} ·{' '}
        {vocabulary.categoryKind === 'vocabulary'
          ? `reusable vocabulary ${vocabulary.vocabularyId ?? '—'}`
          : 'embedded category options'}
      </p>
      {vocabulary.terms.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Lifecycle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vocabulary.terms.map((term) => (
              <TableRow key={term.id}>
                <TableCell className="font-mono text-xs">{term.key}</TableCell>
                <TableCell>{term.label}</TableCell>
                <TableCell className="capitalize">{term.lifecycle}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-xs text-muted-foreground">
          No embedded terms. Historical values still bind to the stable
          vocabulary identity.
        </p>
      )}
    </div>
  )
}

function VocabularyInspector({
  vocabulary,
}: {
  vocabulary: ConfigurationVocabulary
}) {
  return (
    <div className="mt-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Vocabulary terms</h3>
        {vocabulary.terms.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No embedded terms. This vocabulary references an external identity.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {vocabulary.terms.map((term) => (
              <li key={term.id}>
                {term.label} ({term.key}) · {term.lifecycle}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold">Consumer</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          {vocabulary.sourceKind} · {vocabulary.sourceLabel} · field{' '}
          {vocabulary.fieldKey}
        </p>
      </div>
    </div>
  )
}

function TemplateImpact({
  client,
  templateId,
}: {
  client: DataClient
  templateId: string
}) {
  const templateImpactQuery = useQuery({
    queryKey: ['configure', 'template-impact', templateId],
    queryFn: async () => {
      try {
        return await discoverObjectDependencies(
          client,
          'notebook_template',
          templateId,
        )
      } catch {
        return await discoverObjectDependencies(
          client,
          'notebook_template_version',
          templateId,
        )
      }
    },
  })
  const dependencies = useMemo(
    () => templateImpactQuery.data?.dependencies ?? [],
    [templateImpactQuery.data],
  )
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Template dependencies</h3>
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
