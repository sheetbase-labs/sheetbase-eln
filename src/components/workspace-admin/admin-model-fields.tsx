import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LockKeyhole, Pencil, Plus } from 'lucide-react'

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { DataClient } from '#/lib/data-client'
import {
  fieldDefinitionFromModelField,
  validateFieldDefinition,
} from '#/lib/field-definition'
import {
  createModelFieldWithSemantics,
  fetchModelFieldsWithUsage,
  fetchModelKinds,
} from '#/lib/model-fields'
import {
  MODEL_LINK_TYPES,
  configureModelRelationshipRule,
  fetchModelRelationshipRules,
  removeModelRelationshipRule,
  ruleDeclarationGuidance,
  ruleRemovalGuidance,
} from '#/lib/model-relationships'
import type {
  ModelFieldDefinition,
  ModelFieldLogicalType,
} from '#/lib/model-fields'
import {
  countActionableModelImpact,
  discoverModelImpact,
  groupModelImpact,
} from '#/lib/model-impact'
import { discoverObjectDependencies } from '#/lib/object-dependencies'
import {
  applyModelFieldEvolution,
  previewModelFieldEvolution,
} from '#/lib/schema-evolution'

const TYPES: Array<{ value: ModelFieldLogicalType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'integer', label: 'Whole number' },
  { value: 'decimal', label: 'Decimal number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'date', label: 'Date' },
  { value: 'timestamp', label: 'Date and time' },
  { value: 'category', label: 'Category' },
  { value: 'reference', label: 'Record reference' },
]
interface AddFieldForm {
  key: string
  label: string
  type: ModelFieldLogicalType
  description: string
  required: boolean
  defaultValue: string
  quantityKind: string
  quantityDimension: string
  quantityStorageUnit: string
  quantityAllowedUnits: string
  quantityDisplayUnit: string
  minValue: string
  maxValue: string
  minLength: string
  maxLength: string
  pattern: string
  categorySource: 'embedded' | 'vocabulary'
  vocabularyId: string
  options: string
  targetModelKey: string
}

function parseCategoryOptionKeys(input: string): string[] {
  return input
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)
}

function parseCsvSymbols(input: string): string[] {
  return input
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean)
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^-?\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

function parseDefaultValue(type: ModelFieldLogicalType, raw: string): unknown {
  if (raw === '') return null
  if (type === 'integer' || type === 'decimal') return Number(raw)
  if (type === 'boolean') return raw === 'true'
  return raw
}

/**
 * Project the Add-field dialog state through the same canonical adapter the
 * persisted fields use, so inline feedback is the kernel contract
 * (validateFieldDefinition) rather than a second rules engine.
 */
function draftDefinitionFromForm(form: AddFieldForm) {
  const targetModelKey = form.targetModelKey.trim()
  const isNumeric = form.type === 'integer' || form.type === 'decimal'
  const quantityKind = form.quantityKind.trim()
  const quantityDimension = form.quantityDimension.trim()
  const quantityStorageUnit = form.quantityStorageUnit.trim()
  const min = parseOptionalNumber(form.minValue)
  const max = parseOptionalNumber(form.maxValue)
  const minLength = parseOptionalInt(form.minLength)
  const maxLength = parseOptionalInt(form.maxLength)
  const pattern = form.pattern.trim()
  const vocabularyId = form.vocabularyId.trim()
  return fieldDefinitionFromModelField({
    id: 'draft',
    fieldName: form.key.trim(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    logicalType: form.type,
    nullable: !form.required,
    defaultValue: parseDefaultValue(form.type, form.defaultValue),
    unit:
      isNumeric && quantityStorageUnit ? { symbol: quantityStorageUnit } : null,
    quantity:
      isNumeric && (quantityKind || quantityDimension || quantityStorageUnit)
        ? {
            kind: quantityKind,
            dimension: quantityDimension,
            storageUnit: quantityStorageUnit,
            allowedInputUnits: parseCsvSymbols(form.quantityAllowedUnits),
            preferredDisplayUnit: form.quantityDisplayUnit.trim() || undefined,
          }
        : null,
    validation: {
      ...(form.type === 'reference' ? { targetModelKey } : {}),
      ...(isNumeric && min !== null ? { min } : {}),
      ...(isNumeric && max !== null ? { max } : {}),
      ...(form.type === 'text' && minLength !== null ? { minLength } : {}),
      ...(form.type === 'text' && maxLength !== null ? { maxLength } : {}),
      ...(form.type === 'text' && pattern ? { pattern } : {}),
    },
    cardinality: 'one',
    categorySource:
      form.type === 'category' && form.categorySource === 'vocabulary'
        ? { kind: 'vocabulary', vocabularyId }
        : null,
    relationship:
      form.type === 'reference' && targetModelKey
        ? {
            target: { kind: 'model', modelKey: targetModelKey },
            cardinality: 'one',
          }
        : null,
    lifecycle: 'active',
    options:
      form.type === 'category' && form.categorySource === 'embedded'
        ? parseCategoryOptionKeys(form.options).map((key, index) => ({
            id: `draft-${index}`,
            key,
            label: key,
            displayOrder: index,
            lifecycle: 'active' as const,
          }))
        : [],
  })
}
/**
 * Read-path summary of the governed 0060 semantics so Stewards can see
 * quantity, vocabulary, relationship and constraint metadata without
 * opening the raw definition.
 */
function FieldSemanticsSummary({ field }: { field: ModelFieldDefinition }) {
  const segments: string[] = []
  const quantity = field.quantity
  if (quantity) {
    const display =
      quantity.preferredDisplayUnit &&
      quantity.preferredDisplayUnit !== quantity.storageUnit
        ? ` → ${quantity.preferredDisplayUnit}`
        : ''
    segments.push(`${quantity.kind} · ${quantity.storageUnit}${display}`)
  } else if (
    typeof field.unit?.symbol === 'string' &&
    field.unit.symbol.trim()
  ) {
    segments.push(`unit ${field.unit.symbol.trim()} (legacy)`)
  }
  const validation = field.validation
  if (
    typeof validation.min === 'number' ||
    typeof validation.max === 'number'
  ) {
    segments.push(
      `range ${typeof validation.min === 'number' ? validation.min : '−∞'}…${typeof validation.max === 'number' ? validation.max : '+∞'}`,
    )
  }
  if (
    typeof validation.minLength === 'number' ||
    typeof validation.maxLength === 'number'
  ) {
    segments.push(
      `length ${typeof validation.minLength === 'number' ? validation.minLength : '0'}…${typeof validation.maxLength === 'number' ? validation.maxLength : '∞'}`,
    )
  }
  const pattern =
    typeof validation.pattern === 'string'
      ? validation.pattern
      : typeof validation.regex === 'string'
        ? validation.regex
        : null
  if (pattern) {
    segments.push(
      `pattern ${pattern.length > 28 ? `${pattern.slice(0, 27)}…` : pattern}`,
    )
  }
  if (field.logicalType === 'category') {
    segments.push(
      field.categorySource?.kind === 'vocabulary' &&
        field.categorySource.vocabularyId.trim()
        ? `vocabulary ${field.categorySource.vocabularyId.trim()}`
        : `${field.options.length} embedded options`,
    )
  }
  const relationshipTarget = field.relationship?.target
  const legacyTarget =
    typeof validation.targetModelKey === 'string' &&
    validation.targetModelKey.trim()
      ? validation.targetModelKey.trim()
      : null
  if (
    field.logicalType === 'reference' &&
    (relationshipTarget?.kind === 'model' || legacyTarget)
  ) {
    segments.push(
      `→ ${relationshipTarget?.kind === 'model' ? relationshipTarget.modelKey : legacyTarget}`,
    )
  }
  if (field.cardinality && field.cardinality !== 'one') {
    segments.push(`cardinality ${field.cardinality}`)
  }
  if (segments.length === 0) return null
  return (
    <p className="mt-0.5 max-w-56 text-[0.65rem] leading-snug text-muted-foreground">
      {segments.join(' · ')}
    </p>
  )
}
/**
 * MODEL-03: per-Model typed-relationship declarations. Rules close the
 * world for the Model — once any rule exists, only declared (link type,
 * target model) pairs are accepted at link creation (SB080/SB081).
 */
function ModelRelationshipRulesSection({
  client,
  workspaceId,
  modelKey,
  models,
  canManage,
}: {
  client: DataClient
  workspaceId: string
  modelKey: string
  models: { key: string; label: string; identityTable: string }[]
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [linkType, setLinkType] = useState<string>('sample')
  const [targetModelKey, setTargetModelKey] = useState('')
  const [minLinks, setMinLinks] = useState('0')
  const [maxLinks, setMaxLinks] = useState('')
  const [ruleLabel, setRuleLabel] = useState('')
  const [rulesError, setRulesError] = useState<string | null>(null)
  const recordModels = models.filter(
    (model) => model.identityTable === 'api.records',
  )
  const isRecordModel = recordModels.some((model) => model.key === modelKey)
  const rulesQuery = useQuery({
    queryKey: ['model-fields-admin', 'relationship-rules', modelKey],
    queryFn: () => fetchModelRelationshipRules(client, modelKey),
  })
  const rules = rulesQuery.data ?? []
  const declarationGuidance = useMemo(() => {
    if (!targetModelKey) return []
    const min = minLinks.trim() === '' ? 0 : Number(minLinks)
    const max = maxLinks.trim() === '' ? null : Number(maxLinks)
    if (!Number.isInteger(min) || min < 0) return []
    if (max !== null && (!Number.isInteger(max) || max < min)) return []
    return ruleDeclarationGuidance(
      {
        sourceModelKey: modelKey,
        linkType,
        targetModelKey,
        minLinks: min,
        maxLinks: max,
      },
      rules.length,
    )
  }, [modelKey, linkType, targetModelKey, minLinks, maxLinks, rules.length])

  function invalidateRules() {
    void queryClient.invalidateQueries({
      queryKey: ['model-fields-admin', 'relationship-rules', modelKey],
    })
  }

  const save = useMutation({
    mutationFn: () => {
      const min = minLinks.trim() === '' ? 0 : Number(minLinks)
      const max = maxLinks.trim() === '' ? null : Number(maxLinks)
      if (!Number.isInteger(min) || min < 0)
        throw new Error('Minimum must be a whole number of 0 or more.')
      if (max !== null && (!Number.isInteger(max) || max < min))
        throw new Error(
          'Maximum must be empty (unlimited) or a whole number at or above the minimum.',
        )
      return configureModelRelationshipRule(client, {
        workspaceId,
        sourceModelKey: modelKey,
        linkType,
        targetModelKey,
        minLinks: min,
        maxLinks: max,
        label: ruleLabel.trim() === '' ? null : ruleLabel.trim(),
      })
    },
    onSuccess: () => {
      setRulesError(null)
      setTargetModelKey('')
      setMinLinks('0')
      setMaxLinks('')
      setRuleLabel('')
      invalidateRules()
    },
    onError: (cause) =>
      setRulesError(
        cause instanceof Error
          ? cause.message
          : 'Could not save the relationship.',
      ),
  })

  const remove = useMutation({
    mutationFn: (ruleId: string) => removeModelRelationshipRule(client, ruleId),
    onSuccess: () => {
      setRulesError(null)
      invalidateRules()
    },
    onError: (cause) =>
      setRulesError(
        cause instanceof Error
          ? cause.message
          : 'Could not remove the relationship.',
      ),
  })

  return (
    <section
      aria-label="Model relationships"
      className="space-y-3 rounded-md border p-4"
    >
      <div>
        <h3 className="text-sm font-semibold">Relationships</h3>
        <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
          Declare which typed links this Model&apos;s records accept. A Model
          with no declarations stays unrestricted; once any relationship is
          declared, only declared link types are accepted and over-maximum links
          are rejected when created.
        </p>
      </div>
      {!isRecordModel ? (
        <p className="text-xs text-muted-foreground">
          Relationships can only be declared for record-backed Models.
        </p>
      ) : rulesQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading relationships…</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No relationships declared — records of this Model accept every link
          type.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rules.map((rule) => {
            const remainingForLinkType = rules.filter(
              (sibling) =>
                sibling.id !== rule.id && sibling.linkType === rule.linkType,
            ).length
            const remainingForSource = rules.filter(
              (sibling) => sibling.id !== rule.id,
            ).length
            return (
              <li key={rule.id} className="space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs">
                    <span className="font-mono font-medium">
                      {rule.linkType}
                    </span>
                    <span className="text-muted-foreground"> → </span>
                    <span className="font-medium">
                      {recordModels.find(
                        (model) => model.key === rule.targetModelKey,
                      )?.label ?? rule.targetModelKey}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {rule.minLinks}–{rule.maxLinks ?? '∞'}
                      {rule.label ? ` · “${rule.label}”` : null}
                    </span>
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${rule.linkType} to ${rule.targetModelKey}`}
                    disabled={!canManage || remove.isPending}
                    onClick={() => remove.mutate(rule.id)}
                  >
                    Remove
                  </Button>
                </div>
                {canManage ? (
                  <p className="text-xs text-muted-foreground">
                    Removing:{' '}
                    {ruleRemovalGuidance(
                      rule,
                      remainingForLinkType,
                      remainingForSource,
                    ).join(' ')}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {isRecordModel && canManage ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Label className="text-xs text-muted-foreground">
            Link type
            <Select
              className="mt-1"
              aria-label="Link type"
              value={linkType}
              onChange={(event) => setLinkType(event.target.value)}
            >
              {MODEL_LINK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Label>
          <Label className="text-xs text-muted-foreground">
            Target model
            <Select
              className="mt-1"
              aria-label="Target model"
              value={targetModelKey}
              onChange={(event) => setTargetModelKey(event.target.value)}
            >
              <option value="">Select target…</option>
              {recordModels.map((model) => (
                <option key={model.key} value={model.key}>
                  {model.label}
                </option>
              ))}
            </Select>
          </Label>
          <Label className="text-xs text-muted-foreground">
            Minimum
            <Input
              className="mt-1"
              aria-label="Minimum links"
              value={minLinks}
              onChange={(event) => setMinLinks(event.target.value)}
              inputMode="numeric"
            />
          </Label>
          <Label className="text-xs text-muted-foreground">
            Maximum
            <Input
              className="mt-1"
              aria-label="Maximum links"
              value={maxLinks}
              onChange={(event) => setMaxLinks(event.target.value)}
              placeholder="Unlimited"
              inputMode="numeric"
            />
          </Label>
          <Label className="text-xs text-muted-foreground">
            Display name
            <Input
              className="mt-1"
              aria-label="Display name"
              value={ruleLabel}
              onChange={(event) => setRuleLabel(event.target.value)}
              placeholder="Optional — e.g. consumes"
            />
          </Label>
        </div>
      ) : null}
      {isRecordModel && canManage ? (
        <div className="space-y-2">
          {targetModelKey && declarationGuidance.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <p className="font-medium">Before saving</p>
              {declarationGuidance.map((line) => (
                <p key={line} className="mt-1">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
          <Button
            size="sm"
            disabled={!targetModelKey || save.isPending}
            onClick={() => save.mutate()}
          >
            Save relationship
          </Button>
        </div>
      ) : null}
      {rulesError ? (
        <p role="alert" className="text-xs text-destructive">
          {rulesError}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Dependency list reusing the ConfigurationWorkspace impact-panel shape
 * (label · liveness · effect) for model_field discovery.
 */
function ModelFieldImpactList({
  dependencies,
}: {
  dependencies: Array<{
    kind: string
    id: string
    relation: string
    liveness: string
    effect: string
    label: string
  }>
}) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">Dependency impact</h3>
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

/**
 * MODEL-04: per-model impact view. Same label · liveness · effect shape as
 * the other configuration tabs, grouped by consumer class so a Steward sees
 * affected sheets, templates, records and rules before retiring or
 * updating anything. Local working state is never auto-migrated — the
 * panel names what the steward must handle downstream instead.
 */
function ModelImpactPanel({
  client,
  modelKey,
}: {
  client: DataClient
  modelKey: string
}) {
  const impactQuery = useQuery({
    queryKey: ['model-fields-admin', 'model-impact', modelKey],
    queryFn: () => discoverModelImpact(client, modelKey),
  })
  const dependencies = impactQuery.data?.dependencies ?? []
  const groups = groupModelImpact(dependencies)
  const actionable = countActionableModelImpact(dependencies)
  return (
    <section
      aria-label="Model impact"
      className="space-y-2 rounded-md border p-4"
    >
      <div>
        <h3 className="text-sm font-semibold">Model impact</h3>
        <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
          Consumers of this model across records, sheets, templates and
          relationship rules. Review before retiring or updating fields —
          retiring a carried field always needs explicit confirmation and local
          working state is never auto-migrated.
        </p>
      </div>
      {impactQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading model impact…</p>
      ) : impactQuery.isError || !impactQuery.data ? (
        <p className="text-xs text-muted-foreground">
          Model impact unavailable — retire and update actions still run the
          server gate before changing anything.
        </p>
      ) : dependencies.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No dependants outside this field list.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {dependencies.length}{' '}
            {dependencies.length === 1 ? 'consumer' : 'consumers'} ·{' '}
            {actionable} {actionable === 1 ? 'needs' : 'need'} steward handling
            on retire.
          </p>
          {groups.map((group) => (
            <div key={group.group}>
              <h4 className="text-xs font-semibold">{group.title}</h4>
              <ul className="mt-1 space-y-1 text-xs">
                {group.items.map((item) => (
                  <li key={`${item.kind}:${item.id}:${item.relation}`}>
                    {item.label} · {item.liveness} · {item.effect}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {impactQuery.data.truncated ? (
            <p className="text-xs text-muted-foreground">
              Showing the first entries per consumer class — the server caps
              each class. Narrow the model before retiring when capped.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

function UpdateEvolutionCheck({
  client,
  definitionId,
  patch,
}: {
  client: DataClient
  definitionId: string
  patch: Record<string, unknown>
}) {
  const serialized = JSON.stringify(patch)
  const previewQuery = useQuery({
    queryKey: [
      'model-fields-admin',
      'evolution',
      definitionId,
      'update',
      serialized,
    ],
    queryFn: () =>
      previewModelFieldEvolution(client, {
        definitionId,
        action: 'update',
        patch: JSON.parse(serialized) as Record<string, unknown>,
      }),
  })
  const preview = previewQuery.data
  if (previewQuery.isLoading) {
    return (
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Checking evolution impact…
      </p>
    )
  }
  if (previewQuery.isError || !preview) {
    return (
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Evolution preview unavailable — saving still runs the server gate.
      </p>
    )
  }
  const guidance = Array.isArray(preview.guidance)
    ? preview.guidance.filter(
        (line): line is string => typeof line === 'string' && line.length > 0,
      )
    : []
  return (
    <div className="text-xs text-muted-foreground sm:col-span-2">
      <p>
        Evolution check: {String(preview.classification ?? 'unknown')}
        {typeof preview.reason === 'string' && preview.reason
          ? ` — ${preview.reason}`
          : null}
        {preview.blocked ? ' (blocked)' : null}
      </p>
      {guidance.map((line) => (
        <p key={line} className="mt-1">
          {line}
        </p>
      ))}
    </div>
  )
}

function RetireFieldDialog({
  client,
  field,
  onClose,
  onRetired,
}: {
  client: DataClient
  field: ModelFieldDefinition & { usageCount: number }
  onClose: () => void
  onRetired: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const previewQuery = useQuery({
    queryKey: ['model-fields-admin', 'evolution', field.id, 'retire'],
    queryFn: () =>
      previewModelFieldEvolution(client, {
        definitionId: field.id,
        action: 'retire',
      }),
  })
  const impactQuery = useQuery({
    queryKey: ['model-fields-admin', 'impact', field.id],
    queryFn: () => discoverObjectDependencies(client, 'model_field', field.id),
  })
  const preview = previewQuery.data
  const dependencies = impactQuery.data?.dependencies ?? []
  const blocked = preview?.blocked === true
  const apply = useMutation({
    mutationFn: () =>
      applyModelFieldEvolution(client, {
        definitionId: field.id,
        action: 'retire',
        confirm: true,
      }),
    onSuccess: () => {
      setError(null)
      onRetired()
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not retire the field.',
      ),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retire {field.label}</DialogTitle>
          <DialogDescription>
            Retiring keeps stored values but locks the field for new and edited
            records. Review the impact before confirming.
          </DialogDescription>
        </DialogHeader>
        {previewQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">
            Previewing evolution impact…
          </p>
        ) : previewQuery.isError || !preview ? (
          <p className="text-xs text-muted-foreground">
            Evolution preview unavailable — confirming still runs the server
            gate.
          </p>
        ) : (
          <div className="text-xs text-muted-foreground">
            <p>
              Evolution check: {String(preview.classification ?? 'unknown')}
              {typeof preview.reason === 'string' && preview.reason
                ? ` — ${preview.reason}`
                : null}
              {blocked ? ' (blocked)' : null} · {field.usageCount}{' '}
              {field.usageCount === 1 ? 'record carries' : 'records carry'} a
              value.
            </p>
            {Array.isArray(preview.guidance)
              ? preview.guidance
                  .filter(
                    (line): line is string =>
                      typeof line === 'string' && line.length > 0,
                  )
                  .map((line) => (
                    <p key={line} className="mt-1">
                      {line}
                    </p>
                  ))
              : null}
          </div>
        )}
        <ModelFieldImpactList dependencies={dependencies} />
        {impactQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">
            Loading dependent consumers — confirmation stays disabled until the
            consequences are named.
          </p>
        ) : dependencies.length > 0 ? (
          <p className="text-xs font-medium">
            Confirming retires {field.label} for the {dependencies.length}{' '}
            {dependencies.length === 1 ? 'consumer' : 'consumers'} listed above.
            Stored values stay readable; local working state is never
            auto-migrated.
          </p>
        ) : null}
        <p className="mt-4 text-xs">
          <a
            className="text-primary underline-offset-4 hover:underline"
            href="/samples"
            aria-label={`Preview ${field.label} in Records`}
          >
            Preview in Records
          </a>
        </p>
        {blocked ? (
          <p role="alert" className="text-sm text-destructive">
            This retire is blocked by the evolution gate
            {typeof preview.reason === 'string' && preview.reason
              ? `: ${preview.reason}`
              : '.'}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              apply.isPending ||
              previewQuery.isLoading ||
              impactQuery.isLoading ||
              blocked
            }
            onClick={() => apply.mutate()}
          >
            Confirm retire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminModelFields({
  client,
  workspaceId,
  canManage,
  selectedModelKey,
  onSelectedModelKeyChange,
}: {
  client: DataClient
  workspaceId: string
  canManage: boolean
  selectedModelKey?: string
  onSelectedModelKeyChange?: (modelKey: string) => void
}) {
  const queryClient = useQueryClient()
  const [internalModelKey, setInternalModelKey] = useState('sample')
  const modelKey = selectedModelKey ?? internalModelKey
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<
    (ModelFieldDefinition & { usageCount: number }) | null
  >(null)
  const [retiringField, setRetiringField] = useState<
    (ModelFieldDefinition & { usageCount: number }) | null
  >(null)
  const [editForm, setEditForm] = useState({
    label: '',
    description: '',
    displayOrder: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<AddFieldForm>({
    key: '',
    label: '',
    type: 'text',
    description: '',
    required: false,
    defaultValue: '',
    quantityKind: '',
    quantityDimension: '',
    quantityStorageUnit: '',
    quantityAllowedUnits: '',
    quantityDisplayUnit: '',
    minValue: '',
    maxValue: '',
    minLength: '',
    maxLength: '',
    pattern: '',
    categorySource: 'embedded',
    vocabularyId: '',
    options: '',
    targetModelKey: 'sample',
  })
  const modelsQuery = useQuery({
    queryKey: ['model-fields-admin', 'models'],
    queryFn: () => fetchModelKinds(client),
  })
  const fieldsQuery = useQuery({
    queryKey: ['model-fields-admin', modelKey],
    queryFn: () => fetchModelFieldsWithUsage(client, modelKey),
  })
  const baseFieldsQuery = useQuery({
    queryKey: ['model-fields-admin', modelKey, 'base'],
    queryFn: () =>
      client.list<{
        field_key: string
        label: string
        presentation: { editor?: boolean }
      }>('model_base_fields', `?model_key=eq.${modelKey}&order=field_key.asc`),
  })
  const models = modelsQuery.data ?? []
  const fields = fieldsQuery.data ?? []
  const baseFields = (baseFieldsQuery.data ?? []).filter(
    (field) => field.presentation.editor === true,
  )

  useEffect(() => {
    if (models.length > 0 && !models.some((model) => model.key === modelKey)) {
      const fallback = models[0].key
      setInternalModelKey(fallback)
      onSelectedModelKeyChange?.(fallback)
    }
  }, [modelKey, models, onSelectedModelKeyChange])

  function selectModel(nextModelKey: string) {
    setInternalModelKey(nextModelKey)
    onSelectedModelKeyChange?.(nextModelKey)
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['model-fields-admin'] })
    void queryClient.invalidateQueries({ queryKey: ['model-fields'] })
  }

  const draftIssues = useMemo(() => {
    const issues = validateFieldDefinition(draftDefinitionFromForm(form))
    const key = form.key.trim()
    if (key) {
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) {
        issues.push({
          path: 'key',
          message:
            'Stable key must match ^[a-z][a-z0-9_]{0,62}$ — the server rejects anything else.',
        })
      } else if (
        baseFields.some((field) => field.field_key === key) ||
        fields.some((field) => field.fieldName === key)
      ) {
        issues.push({
          path: 'key',
          message: `Stable key "${key}" is already in use — the server rejects protected and duplicate custom field keys.`,
        })
      }
    }
    if (
      form.type === 'category' &&
      form.categorySource === 'embedded' &&
      parseCategoryOptionKeys(form.options).length === 0
    ) {
      issues.push({
        path: 'category',
        message:
          'Category needs an active option — the server rejects activation without one.',
      })
    }
    if (
      form.type === 'category' &&
      form.categorySource === 'vocabulary' &&
      !form.vocabularyId.trim()
    ) {
      issues.push({
        path: 'category',
        message:
          'Vocabulary-backed categories need a vocabulary ID — the server rejects an empty one.',
      })
    }
    if (form.type === 'integer' || form.type === 'decimal') {
      const min = parseOptionalNumber(form.minValue)
      const max = parseOptionalNumber(form.maxValue)
      if (form.minValue.trim() && min === null) {
        issues.push({
          path: 'validation',
          message: 'Minimum must be a finite number.',
        })
      }
      if (form.maxValue.trim() && max === null) {
        issues.push({
          path: 'validation',
          message: 'Maximum must be a finite number.',
        })
      }
      if (min !== null && max !== null && min > max) {
        issues.push({
          path: 'validation',
          message: 'Validation min must not exceed max.',
        })
      }
    }
    if (form.type === 'text') {
      const minLength = parseOptionalInt(form.minLength)
      const maxLength = parseOptionalInt(form.maxLength)
      if (form.minLength.trim() && (minLength === null || minLength < 0)) {
        issues.push({
          path: 'validation',
          message: 'Minimum length must be a non-negative integer.',
        })
      }
      if (form.maxLength.trim() && (maxLength === null || maxLength < 0)) {
        issues.push({
          path: 'validation',
          message: 'Maximum length must be a non-negative integer.',
        })
      }
      if (minLength !== null && maxLength !== null && minLength > maxLength) {
        issues.push({
          path: 'validation',
          message: 'Validation minLength must not exceed maxLength.',
        })
      }
      if (form.pattern.trim()) {
        try {
          new RegExp(form.pattern.trim())
        } catch {
          issues.push({
            path: 'validation',
            message: 'Identifier pattern must be a valid regular expression.',
          })
        }
      }
    }
    return issues
  }, [form, baseFields, fields])

  const create = useMutation({
    mutationFn: async () => {
      const isNumeric = form.type === 'integer' || form.type === 'decimal'
      const quantityKind = form.quantityKind.trim()
      const quantityDimension = form.quantityDimension.trim()
      const quantityStorageUnit = form.quantityStorageUnit.trim()
      const quantityDisplayUnit = form.quantityDisplayUnit.trim()
      const storageUnit = isNumeric ? quantityStorageUnit : ''
      const min = parseOptionalNumber(form.minValue)
      const max = parseOptionalNumber(form.maxValue)
      const minLength = parseOptionalInt(form.minLength)
      const maxLength = parseOptionalInt(form.maxLength)
      const pattern = form.pattern.trim()
      const targetModelKey = form.targetModelKey.trim()
      const vocabularyId = form.vocabularyId.trim()
      await createModelFieldWithSemantics(client, {
        workspaceId,
        modelKey,
        fieldName: form.key.trim(),
        label: form.label.trim(),
        logicalType: form.type,
        nullable: !form.required,
        defaultValue: parseDefaultValue(form.type, form.defaultValue),
        validation: {
          ...(form.type === 'reference' ? { targetModelKey } : {}),
          ...(isNumeric && min !== null ? { min } : {}),
          ...(isNumeric && max !== null ? { max } : {}),
          ...(form.type === 'text' && minLength !== null ? { minLength } : {}),
          ...(form.type === 'text' && maxLength !== null ? { maxLength } : {}),
          ...(form.type === 'text' && pattern ? { pattern } : {}),
        },
        unit: storageUnit ? { symbol: storageUnit } : null,
        description: form.description.trim() || null,
        options:
          form.type === 'category' && form.categorySource === 'embedded'
            ? parseCategoryOptionKeys(form.options).map((option) => ({
                key: option,
                label: option,
              }))
            : [],
        semantics: {
          quantity:
            isNumeric && (quantityKind || quantityDimension || storageUnit)
              ? {
                  kind: quantityKind,
                  dimension: quantityDimension,
                  storageUnit,
                  allowedInputUnits: parseCsvSymbols(form.quantityAllowedUnits),
                  preferredDisplayUnit: quantityDisplayUnit || undefined,
                }
              : null,
          cardinality: 'one',
          categorySource:
            form.type === 'category'
              ? form.categorySource === 'vocabulary'
                ? { kind: 'vocabulary', vocabularyId }
                : { kind: 'embedded' }
              : null,
          relationship:
            form.type === 'reference' && targetModelKey
              ? {
                  target: { kind: 'model', modelKey: targetModelKey },
                  cardinality: 'one',
                }
              : null,
        },
      })
    },
    onSuccess: () => {
      setError(null)
      setDialogOpen(false)
      setForm({
        key: '',
        label: '',
        type: 'text',
        description: '',
        required: false,
        defaultValue: '',
        quantityKind: '',
        quantityDimension: '',
        quantityStorageUnit: '',
        quantityAllowedUnits: '',
        quantityDisplayUnit: '',
        minValue: '',
        maxValue: '',
        minLength: '',
        maxLength: '',
        pattern: '',
        categorySource: 'embedded',
        vocabularyId: '',
        options: '',
        targetModelKey: 'sample',
      })
      invalidate()
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not add the field.',
      ),
  })
  const update = useMutation({
    mutationFn: async () => {
      if (!editingField) throw new Error('No field selected.')
      const patch: Record<string, unknown> = {
        label: editForm.label.trim(),
        description: editForm.description.trim() || null,
        displayOrder: editForm.displayOrder,
      }
      const preview = await previewModelFieldEvolution(client, {
        definitionId: editingField.id,
        action: 'update',
        patch,
      })
      if (preview.blocked === true) {
        throw new Error(
          typeof preview.reason === 'string' && preview.reason
            ? `Change blocked: ${preview.reason}`
            : 'Change blocked by the evolution gate.',
        )
      }
      return applyModelFieldEvolution(client, {
        definitionId: editingField.id,
        action: 'update',
        patch,
        confirm: true,
      })
    },
    onSuccess: () => {
      setError(null)
      setEditingField(null)
      invalidate()
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not update the field.',
      ),
  })

  function beginEditing(field: ModelFieldDefinition & { usageCount: number }) {
    setEditingField(field)
    setEditForm({
      label: field.label,
      description: field.description ?? '',
      displayOrder: field.displayOrder,
    })
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 flex-wrap items-end gap-4">
          <Label className="w-56 text-xs font-medium text-muted-foreground">
            Model
            <Select
              className="mt-1 bg-background text-foreground"
              aria-label="Model"
              value={modelKey}
              onChange={(event) => selectModel(event.target.value)}
              disabled={modelsQuery.isLoading || models.length === 0}
            >
              {!models.some((model) => model.key === modelKey) ? (
                <option value={modelKey}>
                  {modelKey.replaceAll('_', ' ')}
                </option>
              ) : null}
              {models.map((model) => (
                <option key={model.key} value={model.key}>
                  {model.label}
                </option>
              ))}
            </Select>
          </Label>
          <p className="pb-1 text-sm text-muted-foreground">
            {baseFields.length} system{' '}
            {baseFields.length === 1 ? 'field' : 'fields'} · {fields.length}{' '}
            workspace {fields.length === 1 ? 'field' : 'fields'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden max-w-md text-right text-xs text-muted-foreground lg:block">
            Locked fields preserve the model contract. Workspace fields can be
            edited or retired without deleting stored values.
          </p>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={!canManage}
          >
            <Plus className="size-3.5" /> Add field
          </Button>
        </div>
      </div>
      <ModelImpactPanel client={client} modelKey={modelKey} />

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden lg:table-cell">Required</TableHead>
              <TableHead className="hidden xl:table-cell">Usage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell
                colSpan={6}
                className="h-8 py-1 text-xs font-semibold text-muted-foreground"
              >
                System fields
              </TableCell>
            </TableRow>
            {baseFields.map((field) => (
              <TableRow
                key={`base:${field.field_key}`}
                className="bg-muted/15 hover:bg-muted/25"
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <LockKeyhole
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="Locked system field"
                    />
                    <div>
                      <p className="font-medium">{field.label}</p>
                      <p className="font-mono text-[0.65rem] text-muted-foreground">
                        {field.field_key}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  Built in
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  System governed
                </TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">
                  Every record
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="gap-1 text-muted-foreground"
                  >
                    <LockKeyhole className="size-3" /> Locked
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-xs text-muted-foreground">
                    Read only
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {!baseFieldsQuery.isLoading && baseFields.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-destructive"
                >
                  The protected system-field registry is incomplete for this
                  model. Workspace fields cannot be governed safely until it is
                  repaired.
                </TableCell>
              </TableRow>
            ) : null}
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell
                colSpan={6}
                className="h-8 py-1 text-xs font-semibold text-muted-foreground"
              >
                Workspace fields
              </TableCell>
            </TableRow>
            {fields.map((field) => {
              const target = field.relationship?.target
              const targetModelKey =
                target?.kind === 'model' && target.modelKey.trim()
                  ? target.modelKey
                  : typeof field.validation.targetModelKey === 'string' &&
                      field.validation.targetModelKey.trim()
                    ? field.validation.targetModelKey
                    : null
              return (
                <TableRow key={field.id}>
                  <TableCell>
                    <p className="font-medium">{field.label}</p>
                    <p className="font-mono text-[0.65rem] text-muted-foreground">
                      {field.fieldName}
                    </p>
                    {field.description ? (
                      <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                        {field.description}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                      <a
                        className="text-primary underline-offset-4 hover:underline"
                        href="/samples"
                        aria-label={`Preview ${field.label} in Records`}
                      >
                        Preview in Records
                      </a>
                      {field.logicalType === 'reference' && targetModelKey ? (
                        <a
                          className="text-primary underline-offset-4 hover:underline"
                          href={`/configure?kind=model&model=${encodeURIComponent(targetModelKey)}`}
                          aria-label={`Open referenced model for ${field.label}`}
                        >
                          Open referenced model
                        </a>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {
                      TYPES.find((type) => type.value === field.logicalType)
                        ?.label
                    }
                    <FieldSemanticsSummary field={field} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {field.nullable ? 'No' : 'Yes'}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {field.usageCount} records
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        field.lifecycle === 'active' ? 'success' : 'secondary'
                      }
                      className="capitalize"
                    >
                      {field.lifecycle}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${field.label}`}
                        disabled={!canManage}
                        onClick={() => beginEditing(field)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      {field.lifecycle === 'active' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canManage}
                          onClick={() => setRetiringField(field)}
                        >
                          Retire
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {!fieldsQuery.isLoading && fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <p className="font-medium">No workspace fields yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add a field to extend this model without changing its locked
                    system structure.
                  </p>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <ModelRelationshipRulesSection
        client={client}
        workspaceId={workspaceId}
        modelKey={modelKey}
        models={models}
        canManage={canManage}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add workspace field</DialogTitle>
            <DialogDescription>
              The key and type become immutable after activation. Required
              fields need a default when existing records do not have a value.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="text-xs text-muted-foreground">
              Label
              <Input
                className="mt-1"
                value={form.label}
                onChange={(event) =>
                  setForm({ ...form, label: event.target.value })
                }
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Stable key
              <Input
                className="mt-1 font-mono"
                value={form.key}
                onChange={(event) =>
                  setForm({
                    ...form,
                    key: event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, '_'),
                  })
                }
                placeholder="therapeutic_area"
              />
            </Label>
            <Label className="text-xs text-muted-foreground sm:col-span-2">
              Description
              <Input
                className="mt-1"
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="How this property should be used"
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Type
              <Select
                className="mt-1"
                value={form.type}
                onChange={(event) =>
                  setForm({
                    ...form,
                    type: event.target.value as ModelFieldLogicalType,
                  })
                }
              >
                {TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label className="text-xs text-muted-foreground">
              Default value
              <Input
                className="mt-1"
                value={form.defaultValue}
                onChange={(event) =>
                  setForm({ ...form, defaultValue: event.target.value })
                }
              />
            </Label>
            {form.type === 'integer' || form.type === 'decimal' ? (
              <>
                <Label className="text-xs text-muted-foreground">
                  Minimum value
                  <Input
                    className="mt-1"
                    value={form.minValue}
                    onChange={(event) =>
                      setForm({ ...form, minValue: event.target.value })
                    }
                    placeholder="0"
                  />
                </Label>
                <Label className="text-xs text-muted-foreground">
                  Maximum value
                  <Input
                    className="mt-1"
                    value={form.maxValue}
                    onChange={(event) =>
                      setForm({ ...form, maxValue: event.target.value })
                    }
                    placeholder="100"
                  />
                </Label>
                <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
                  <Label className="text-xs text-muted-foreground">
                    Quantity kind
                    <Input
                      className="mt-1"
                      value={form.quantityKind}
                      onChange={(event) =>
                        setForm({ ...form, quantityKind: event.target.value })
                      }
                      placeholder="concentration"
                    />
                  </Label>
                  <Label className="text-xs text-muted-foreground">
                    Dimension
                    <Input
                      className="mt-1"
                      value={form.quantityDimension}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          quantityDimension: event.target.value,
                        })
                      }
                      placeholder="mass/volume"
                    />
                  </Label>
                  <Label className="text-xs text-muted-foreground">
                    Storage unit
                    <Input
                      className="mt-1"
                      value={form.quantityStorageUnit}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          quantityStorageUnit: event.target.value,
                        })
                      }
                      placeholder="mg/mL"
                    />
                  </Label>
                </div>
                <Label className="text-xs text-muted-foreground">
                  Allowed input units, separated by commas
                  <Input
                    className="mt-1"
                    value={form.quantityAllowedUnits}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        quantityAllowedUnits: event.target.value,
                      })
                    }
                    placeholder="mg/mL, µg/mL"
                  />
                </Label>
                <Label className="text-xs text-muted-foreground">
                  Display unit
                  <Input
                    className="mt-1"
                    value={form.quantityDisplayUnit}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        quantityDisplayUnit: event.target.value,
                      })
                    }
                    placeholder="mg/mL"
                  />
                </Label>
              </>
            ) : null}
            {form.type === 'text' ? (
              <>
                <Label className="text-xs text-muted-foreground">
                  Minimum length
                  <Input
                    className="mt-1"
                    value={form.minLength}
                    onChange={(event) =>
                      setForm({ ...form, minLength: event.target.value })
                    }
                    placeholder="0"
                  />
                </Label>
                <Label className="text-xs text-muted-foreground">
                  Maximum length
                  <Input
                    className="mt-1"
                    value={form.maxLength}
                    onChange={(event) =>
                      setForm({ ...form, maxLength: event.target.value })
                    }
                    placeholder="200"
                  />
                </Label>
                <Label className="text-xs text-muted-foreground sm:col-span-2">
                  Identifier pattern (regular expression)
                  <Input
                    className="mt-1 font-mono"
                    value={form.pattern}
                    onChange={(event) =>
                      setForm({ ...form, pattern: event.target.value })
                    }
                    placeholder="^SMP-[0-9]{4}-[0-9]{4}$"
                  />
                </Label>
              </>
            ) : null}
            {form.type === 'category' ? (
              <>
                <Label className="text-xs text-muted-foreground sm:col-span-2">
                  Category source
                  <Select
                    className="mt-1"
                    value={form.categorySource}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        categorySource: event.target.value as
                          'embedded' | 'vocabulary',
                      })
                    }
                  >
                    <option value="embedded">
                      Embedded options (this field)
                    </option>
                    <option value="vocabulary">Controlled vocabulary</option>
                  </Select>
                </Label>
                {form.categorySource === 'embedded' ? (
                  <Label className="text-xs text-muted-foreground sm:col-span-2">
                    Options, separated by commas
                    <Input
                      className="mt-1"
                      value={form.options}
                      onChange={(event) =>
                        setForm({ ...form, options: event.target.value })
                      }
                    />
                  </Label>
                ) : (
                  <Label className="text-xs text-muted-foreground sm:col-span-2">
                    Vocabulary ID
                    <Input
                      className="mt-1 font-mono"
                      value={form.vocabularyId}
                      onChange={(event) =>
                        setForm({ ...form, vocabularyId: event.target.value })
                      }
                      placeholder="therapeutic-area-v1"
                    />
                  </Label>
                )}
              </>
            ) : null}
            {form.type === 'reference' ? (
              <Label className="text-xs text-muted-foreground sm:col-span-2">
                Referenced record model
                <Select
                  className="mt-1"
                  value={form.targetModelKey}
                  onChange={(event) =>
                    setForm({ ...form, targetModelKey: event.target.value })
                  }
                >
                  {models
                    .filter((model) => model.identityTable === 'api.records')
                    .map((model) => (
                      <option key={model.key} value={model.key}>
                        {model.label}
                      </option>
                    ))}
                </Select>
              </Label>
            ) : null}
            <Label className="text-xs text-muted-foreground sm:col-span-2">
              Cardinality
              <Select
                className="mt-1"
                value="one"
                disabled
                aria-label="Cardinality"
              >
                <option value="one">
                  One value per record (many-valued fields are reserved by the
                  server)
                </option>
              </Select>
            </Label>
            <Label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={form.required}
                onCheckedChange={(checked) =>
                  setForm({ ...form, required: checked === true })
                }
              />
              Required for new and editable records
            </Label>
            {draftIssues.length > 0 ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs sm:col-span-2"
              >
                <p className="font-medium">Resolve before adding</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {draftIssues.map((issue) => (
                    <li key={`${issue.path}:${issue.message}`}>
                      {issue.path}: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Field contract valid — the key and type lock on activation.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                create.isPending ||
                !form.label.trim() ||
                !form.key.trim() ||
                (form.type === 'category' &&
                  form.categorySource === 'embedded' &&
                  !form.options.trim()) ||
                (form.type === 'category' &&
                  form.categorySource === 'vocabulary' &&
                  !form.vocabularyId.trim()) ||
                draftIssues.length > 0
              }
              onClick={() => create.mutate()}
            >
              Add and activate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingField !== null}
        onOpenChange={(open) => {
          if (!open) setEditingField(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit workspace field</DialogTitle>
            <DialogDescription>
              The stable key and type are locked after activation. Labels,
              descriptions and display order can be updated without changing
              stored values.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="text-xs text-muted-foreground">
              Label
              <Input
                className="mt-1"
                value={editForm.label}
                onChange={(event) =>
                  setEditForm({ ...editForm, label: event.target.value })
                }
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Display order
              <Input
                className="mt-1"
                type="number"
                value={editForm.displayOrder}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    displayOrder: Number(event.target.value),
                  })
                }
              />
            </Label>
            <Label className="text-xs text-muted-foreground sm:col-span-2">
              Description
              <Input
                className="mt-1"
                value={editForm.description}
                onChange={(event) =>
                  setEditForm({ ...editForm, description: event.target.value })
                }
              />
            </Label>
            <div className="rounded-md border bg-muted/30 p-3 text-xs sm:col-span-2">
              <p className="font-medium">Locked contract</p>
              <p className="mt-1 text-muted-foreground">
                Key: <code>{editingField?.fieldName}</code> · Type:{' '}
                {editingField
                  ? TYPES.find(
                      (type) => type.value === editingField.logicalType,
                    )?.label
                  : null}
              </p>
            </div>
            {editingField ? (
              <UpdateEvolutionCheck
                client={client}
                definitionId={editingField.id}
                patch={{
                  label: editForm.label.trim(),
                  description: editForm.description.trim() || null,
                  displayOrder: editForm.displayOrder,
                }}
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingField(null)}>
              Cancel
            </Button>
            <Button
              disabled={update.isPending || !editForm.label.trim()}
              onClick={() => update.mutate()}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {retiringField ? (
        <RetireFieldDialog
          client={client}
          field={retiringField}
          onClose={() => setRetiringField(null)}
          onRetired={() => {
            setRetiringField(null)
            invalidate()
          }}
        />
      ) : null}
    </div>
  )
}
