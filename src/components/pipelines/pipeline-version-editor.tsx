import { FormSection as Section } from '#/components/ui/form-section'
/**
 * AUTO-03 — Pipeline version configuration editor.
 *
 * Edits a draft Pipeline version in place (or creates the first draft), with
 * live validation from the shared config contract. Published versions are
 * read-only here — reproducibility pins exactly what ran.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react'

import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  Switch,
  Textarea,
} from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import { DataClientError } from '#/lib/data-client'
import { PARAMETER_TYPES, validatePipelineConfig } from '#/lib/pipelines/config'
import type { PipelineConfig } from '#/lib/pipelines/config'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import {
  createPipelineDefinitionVersion,
  pipelineQueryKeys,
  updatePipelineDefinitionVersionDraft,
} from '#/lib/pipelines/data'
import { PipelineNotificationsEditor } from './pipeline-notifications-editor'
import { PipelineActionsEditor } from './pipeline-actions-editor'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'

export function emptyConfig(): PipelineConfig {
  return {
    configVersion: 1,
    description: '',
    parameters: [],
    inputs: [{ name: 'input', required: true }],
    transform: { language: 'sql', statement: 'SELECT * FROM input' },
    output: {
      mode: 'create',
      schemaVersionId: '',
      datasetName: '',
      datasetLabel: 'pipeline output',
      fieldMapping: null,
    },
  }
}

export function PipelineVersionEditor({
  dataClient,
  workspaceId,
  definitionId,
  draft,
  canManage,
  initialConfiguration,
  onDirtyChange,
}: {
  dataClient: DataClient
  workspaceId: string
  definitionId: string
  draft: PipelineDefinitionVersionWire | null
  canManage: boolean
  initialConfiguration?: Record<string, unknown>
  onDirtyChange?: (dirty: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<PipelineConfig>(() =>
    normalizeConfig(draft?.configuration ?? initialConfiguration ?? {}),
  )
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [mappingText, setMappingText] = useState(() =>
    config.output.fieldMapping
      ? JSON.stringify(config.output.fieldMapping, null, 2)
      : '',
  )
  const [mappingError, setMappingError] = useState('')
  const [notificationsValid, setNotificationsValid] = useState(true)
  const handleNotificationsValidity = useCallback((valid: boolean) => {
    setNotificationsValid(valid)
    if (!valid) setDirty(true)
  }, [])
  const [actionsValid, setActionsValid] = useState(true)
  const handleActionsValidity = useCallback((valid: boolean) => {
    setActionsValid(valid)
    if (!valid) setDirty(true)
  }, [])
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  const datasetsQuery = useQuery({
    queryKey: ['pipelines', 'output-datasets', workspaceId],
    queryFn: () =>
      dataClient.list<{ id: string; name: string }>(
        'datasets',
        '?select=id,name&lifecycle=eq.active&order=name.asc',
      ),
    enabled: canManage,
  })
  const subscriptionsQuery = useQuery({
    queryKey: ['pipelines', 'notification-subscriptions', workspaceId],
    queryFn: () =>
      dataClient.list<{ id: string; key: string }>(
        'webhook_subscriptions',
        '?select=id,key&status=eq.active&order=key.asc',
      ),
    enabled: canManage,
  })

  const schemasQuery = useQuery({
    queryKey: ['pipelines', 'schemas'],
    queryFn: () => listPublishedDatasetSchemas(dataClient),
    enabled: canManage,
  })

  const runtimeQuery = useQuery({
    queryKey: ['pipelines', 'python-runtime'],
    queryFn: async (): Promise<{
      available: boolean
      runtime?: string
      message?: string
    }> => {
      const response = await fetch('/api/pipelines/runtime')
      if (!response.ok) throw new Error('Python runtime could not be checked.')
      return response.json()
    },
    enabled: canManage,
  })
  const usesPython =
    config.transform.language === 'python' ||
    config.steps?.some((step) => step.language === 'python')
  useEffect(() => {
    if (
      usesPython &&
      !config.pythonRuntime &&
      runtimeQuery.data?.available &&
      runtimeQuery.data.runtime
    ) {
      setConfig((previous) => ({
        ...previous,
        pythonRuntime: runtimeQuery.data.runtime,
      }))
      setDirty(true)
    }
  }, [usesPython, config.pythonRuntime, runtimeQuery.data])
  const errors = useMemo(() => validatePipelineConfig(config), [config])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = config as unknown as Record<string, unknown>
      if (draft) {
        return updatePipelineDefinitionVersionDraft(dataClient, {
          workspaceId,
          versionId: draft.id,
          expectedRevision: Number(draft.revision),
          configuration: payload,
        })
      }
      return createPipelineDefinitionVersion(dataClient, {
        workspaceId,
        definitionId,
        configuration: payload,
      })
    },
    onSuccess: () => {
      setSaveError('')
      setSaved(true)
      setDirty(false)
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.versions(definitionId),
      })
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.definition(definitionId),
      })
    },
    onError: (cause: unknown) => {
      setSaveError(
        cause instanceof DataClientError
          ? cause.message
          : 'Could not save the Pipeline configuration.',
      )
    },
  })

  const update = (patch: Partial<PipelineConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }))
    setSaveError('')
    setSaved(false)
    setDirty(true)
  }

  if (!canManage) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        Only owners, admins and stewards can edit Pipeline configurations.
      </div>
    )
  }

  return (
    <fieldset disabled={saveMutation.isPending} className="min-w-0 space-y-6">
      {!draft && !initialConfiguration && !dirty && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Automate work on ELN records.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              update({
                inputs: [],
                transform: { language: 'none', statement: '' },
                output: { mode: 'none', datasetLabel: 'Pipeline result' },
              })
            }
          >
            Start with ELN actions
          </Button>
        </div>
      )}
      <Section
        title="Inputs"
        hint="Name the datasets this pipeline uses. Choose their saved versions when you run it. Remove all inputs for a standalone automation."
      >
        <div className="space-y-2">
          {config.inputs.map((input, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="font-mono text-sm"
                value={input.name}
                onChange={(event) => {
                  const inputs = [...config.inputs]
                  inputs[index] = { ...input, name: event.target.value }
                  update({ inputs })
                }}
                aria-label="input name"
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={input.required}
                  onCheckedChange={(checked) => {
                    const inputs = [...config.inputs]
                    inputs[index] = { ...input, required: checked }
                    update({ inputs })
                  }}
                />
                required
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label="remove input"
                onClick={() =>
                  update({
                    inputs: config.inputs.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {config.inputs.length < 10 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                update({
                  inputs: [
                    ...config.inputs,
                    {
                      name: `input${config.inputs.length + 1}`,
                      required: true,
                    },
                  ],
                })
              }
            >
              <Plus className="size-4" /> Add input
            </Button>
          )}
        </div>
      </Section>

      <Section
        title="Parameters"
        hint="Values supplied at run time. Use {{name}} in SQL or parameters['name'] in Python."
      >
        <div className="space-y-3">
          {config.parameters.map((parameter, index) => (
            <div
              key={index}
              className="border-border grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_9rem_auto_1fr_2rem]"
            >
              <Input
                className="font-mono text-sm"
                value={parameter.name}
                onChange={(event) => {
                  const parameters = [...config.parameters]
                  parameters[index] = { ...parameter, name: event.target.value }
                  update({ parameters })
                }}
                placeholder="name"
                aria-label="parameter name"
              />
              <Select
                className="font-mono text-sm"
                value={parameter.type}
                onChange={(event) => {
                  const parameters = [...config.parameters]
                  parameters[index] = {
                    ...parameter,
                    type: event.target
                      .value as (typeof PARAMETER_TYPES)[number],
                  }
                  update({ parameters })
                }}
                aria-label="parameter type"
              >
                {PARAMETER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={parameter.required}
                  onCheckedChange={(checked) => {
                    const parameters = [...config.parameters]
                    parameters[index] = {
                      ...parameter,
                      required: checked,
                      default: checked ? undefined : parameter.default,
                    }
                    update({ parameters })
                  }}
                />
                required
              </label>
              {!parameter.required ? (
                <Input
                  className="font-mono text-sm"
                  value={
                    parameter.default === undefined ||
                    parameter.default === null
                      ? ''
                      : String(parameter.default)
                  }
                  onChange={(event) => {
                    const parameters = [...config.parameters]
                    parameters[index] = {
                      ...parameter,
                      default: coerceDefault(
                        parameter.type,
                        event.target.value,
                      ),
                    }
                    update({ parameters })
                  }}
                  placeholder="default"
                  aria-label="parameter default"
                />
              ) : (
                <div className="text-muted-foreground text-sm">no default</div>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="remove parameter"
                onClick={() =>
                  update({
                    parameters: config.parameters.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {config.parameters.length < 50 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                update({
                  parameters: [
                    ...config.parameters,
                    {
                      name: `param${config.parameters.length + 1}`,
                      type: 'decimal',
                      required: false,
                    },
                  ],
                })
              }
            >
              <Plus className="size-4" /> Add parameter
            </Button>
          )}
        </div>
      </Section>

      {usesPython && (
        <div className="space-y-2 text-xs text-muted-foreground">
          {runtimeQuery.isLoading ? (
            'Checking Python runtime…'
          ) : runtimeQuery.data?.available ? (
            <>
              <p className="break-all">
                Python runtime:{' '}
                {config.pythonRuntime ?? runtimeQuery.data.runtime}
              </p>
              {config.pythonRuntime &&
                config.pythonRuntime !== runtimeQuery.data.runtime && (
                  <>
                    <p>
                      This version uses a different Python runtime from the one
                      currently available.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        update({ pythonRuntime: runtimeQuery.data.runtime })
                      }
                    >
                      Use current Python runtime
                    </Button>
                  </>
                )}
            </>
          ) : (
            <p role="alert">
              {runtimeQuery.data?.message ??
                'Python is unavailable. Check the runtime before publishing a Python pipeline.'}
            </p>
          )}
        </div>
      )}
      <Section
        title="Steps"
        hint="Steps run in order. Each returns the rows used by the next step or saved as the output."
      >
        <TransformEditor
          title="Analysis step"
          allowNone
          value={config.transform}
          inputName={config.inputs[0]?.name}
          onChange={(transform) => update({ transform })}
        />
        {(config.steps ?? []).map((step, index) => (
          <div key={index} className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Step ${index + 2} name`}
                className="min-w-0 flex-1"
                value={step.name}
                onChange={(e) =>
                  update({
                    steps: config.steps!.map((item, i) =>
                      i === index ? { ...item, name: e.target.value } : item,
                    ),
                  })
                }
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Move step ${index + 2} up`}
                disabled={index === 0}
                onClick={() => {
                  const steps = [...config.steps!]
                  ;[steps[index - 1], steps[index]] = [
                    steps[index],
                    steps[index - 1],
                  ]
                  update({ steps })
                }}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Move step ${index + 2} down`}
                disabled={index === config.steps!.length - 1}
                onClick={() => {
                  const steps = [...config.steps!]
                  ;[steps[index + 1], steps[index]] = [
                    steps[index],
                    steps[index + 1],
                  ]
                  update({ steps })
                }}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove step ${index + 2}`}
                onClick={() =>
                  update({ steps: config.steps!.filter((_, i) => i !== index) })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <TransformEditor
              title={`Step ${index + 2}`}
              value={step}
              inputName="previous"
              onChange={(transform) => {
                const { language, statement } = transform
                if (language === 'none') return
                update({
                  steps: config.steps!.map((item, i) =>
                    i === index ? { ...item, language, statement } : item,
                  ),
                })
              }}
            />
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={(config.steps?.length ?? 0) >= 9}
          onClick={() => {
            let n = (config.steps?.length ?? 0) + 2
            while (
              [...config.inputs, ...(config.steps ?? [])].some(
                (item) => item.name === `step_${n}`,
              )
            )
              n++
            update({
              steps: [
                ...(config.steps ?? []),
                {
                  name: `step_${n}`,
                  language: 'sql',
                  statement: 'SELECT * FROM previous',
                },
              ],
            })
          }}
        >
          <Plus className="size-4" /> Add step
        </Button>
      </Section>

      <PipelineActionsEditor
        actions={config.actions ?? []}
        onChange={(actions) => update({ actions })}
        onValidityChange={handleActionsValidity}
      />
      <Section
        title="Output"
        hint="Choose where the final rows are saved, or complete without changing a dataset."
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label>Mode</Label>
            <Select
              className="w-56 max-w-full"
              value={config.output.mode}
              onChange={(event) =>
                update({
                  output: {
                    ...config.output,
                    mode: event.target.value as 'create' | 'append' | 'none',
                  },
                })
              }
              aria-label="output mode"
            >
              <option value="create">Create Dataset</option>
              <option value="append">Append to Dataset</option>
              <option value="none">No dataset output</option>
            </Select>
          </div>

          {config.output.mode === 'create' ? (
            <>
              <div className="space-y-1">
                <Label>Output Schema Version</Label>
                <Select
                  className="w-full"
                  value={config.output.schemaVersionId ?? ''}
                  onChange={(event) =>
                    update({
                      output: {
                        ...config.output,
                        schemaVersionId: event.target.value,
                      },
                    })
                  }
                  aria-label="output schema version"
                >
                  <option value="" disabled>
                    Choose a published schema…
                  </option>
                  {schemasQuery.data?.map((schema) => (
                    <option
                      key={schema.schemaVersionId}
                      value={schema.schemaVersionId}
                    >
                      {schema.name} · v{schema.version}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Dataset name</Label>
                <Input
                  value={config.output.datasetName ?? ''}
                  onChange={(event) =>
                    update({
                      output: {
                        ...config.output,
                        datasetName: event.target.value,
                      },
                    })
                  }
                />
              </div>
            </>
          ) : config.output.mode === 'append' ? (
            <div className="space-y-1">
              <Label>Existing dataset</Label>
              <Select
                aria-label="Output dataset"
                className="font-mono text-sm"
                value={config.output.datasetId ?? ''}
                onChange={(event) =>
                  update({
                    output: { ...config.output, datasetId: event.target.value },
                  })
                }
              >
                <option value="">Choose a dataset…</option>
                {datasetsQuery.data?.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </Select>
              {datasetsQuery.isError && (
                <p role="alert" className="text-xs text-destructive">
                  Could not load datasets. Reload to try again.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Complete the steps without creating or changing a dataset.
            </p>
          )}

          {config.output.mode !== 'none' && (
            <>
              <div className="space-y-1">
                <Label>Dataset Version label</Label>
                <Input
                  value={config.output.datasetLabel}
                  onChange={(event) =>
                    update({
                      output: {
                        ...config.output,
                        datasetLabel: event.target.value,
                      },
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label>Field mapping (optional JSON)</Label>
                <Textarea
                  className="font-mono min-h-16 text-xs"
                  value={mappingText}
                  aria-label="Field mapping"
                  aria-invalid={Boolean(mappingError)}
                  onChange={(event) => {
                    const raw = event.target.value
                    setMappingText(raw)
                    setDirty(true)
                    setSaved(false)
                    try {
                      const parsed = raw.trim() ? JSON.parse(raw) : null
                      if (
                        parsed !== null &&
                        (!isRecord(parsed) ||
                          Object.values(parsed).some(
                            (value) => typeof value !== 'string',
                          ))
                      )
                        throw new Error('Use a JSON object with text values.')
                      setMappingError('')
                      update({
                        output: { ...config.output, fieldMapping: parsed },
                      })
                    } catch {
                      setMappingError(
                        'Enter a JSON object mapping result columns to schema fields, or leave this blank.',
                      )
                    }
                  }}
                  placeholder='{ "value": "concentration" }'
                />
                {mappingError && (
                  <p role="alert" className="text-xs text-destructive">
                    {mappingError}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </Section>
      <PipelineNotificationsEditor
        notifications={config.notifications ?? []}
        subscriptions={subscriptionsQuery.data ?? []}
        loading={subscriptionsQuery.isLoading}
        error={subscriptionsQuery.isError}
        onChange={(notifications) => update({ notifications })}
        onValidityChange={handleNotificationsValidity}
      />

      {errors.length > 0 && (
        <div
          role="alert"
          className="border-destructive/40 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <ul className="list-inside list-disc space-y-0.5">
            {errors.slice(0, 6).map((error, index) => (
              <li key={index}>
                <span className="font-mono text-xs">{error.field}:</span>{' '}
                {error.message}
              </li>
            ))}
            {errors.length > 6 && <li>…and {errors.length - 6} more</li>}
          </ul>
        </div>
      )}

      {saveError && (
        <p role="alert" className="text-destructive text-sm">
          {saveError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          disabled={
            errors.length > 0 ||
            !actionsValid ||
            !notificationsValid ||
            (config.output.mode !== 'none' && Boolean(mappingError)) ||
            saveMutation.isPending
          }
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending && (
            <Loader2 className="size-4 animate-spin" />
          )}
          {draft ? 'Save draft' : 'Save first draft'}
        </Button>
        {saved && (
          <span role="status" className="text-xs text-muted-foreground">
            Draft saved. Publish it when ready to run.
          </span>
        )}
        {dirty && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
        {draft && (
          <Badge variant="secondary">
            draft v{draft.version} · revision {String(draft.revision)}
          </Badge>
        )}
      </div>
    </fieldset>
  )
}

function normalizeConfig(raw: Record<string, unknown>): PipelineConfig {
  const config = emptyConfig()
  if (!isRecord(raw)) return config
  const record = raw
  if (typeof record.pythonRuntime === 'string')
    config.pythonRuntime = record.pythonRuntime
  if (typeof record.description === 'string') {
    config.description = record.description
  }
  if (Array.isArray(record.parameters)) {
    config.parameters = record.parameters.map((p) => {
      const param = (p ?? {}) as Record<string, unknown>
      return {
        name: typeof param.name === 'string' ? param.name : '',
        type: (PARAMETER_TYPES as readonly string[]).includes(
          String(param.type ?? 'text'),
        )
          ? (param.type as (typeof PARAMETER_TYPES)[number])
          : 'text',
        required: param.required === true,
        default: param.default,
        description:
          typeof param.description === 'string' ? param.description : undefined,
      }
    })
  }
  if (Array.isArray(record.inputs)) {
    config.inputs = record.inputs.map((input, index) => {
      const item = (input ?? {}) as Record<string, unknown>
      return {
        name:
          typeof item.name === 'string' && item.name.trim()
            ? item.name
            : `input${index + 1}`,
        required: item.required !== false,
        description:
          typeof item.description === 'string' ? item.description : undefined,
      }
    })
  }
  const transform = (record.transform ?? {}) as Record<string, unknown>
  if (transform.language === 'python' || transform.language === 'none')
    config.transform.language = transform.language
  if (Array.isArray(record.actions))
    config.actions = record.actions as NonNullable<PipelineConfig['actions']>
  if (Array.isArray(record.steps))
    config.steps = record.steps as NonNullable<PipelineConfig['steps']>
  if (Array.isArray(record.notifications))
    config.notifications = record.notifications as NonNullable<
      PipelineConfig['notifications']
    >
  if (typeof transform.statement === 'string') {
    config.transform.statement = transform.statement
  }
  const output = (record.output ?? {}) as Record<string, unknown>
  if (
    output.mode === 'append' ||
    output.mode === 'create' ||
    output.mode === 'none'
  ) {
    config.output.mode = output.mode
  }
  if (typeof output.schemaVersionId === 'string') {
    config.output.schemaVersionId = output.schemaVersionId
  }
  if (typeof output.datasetId === 'string') {
    config.output.datasetId = output.datasetId
  }
  if (typeof output.datasetName === 'string') {
    config.output.datasetName = output.datasetName
  }
  if (typeof output.datasetLabel === 'string') {
    config.output.datasetLabel = output.datasetLabel
  }
  if (output.fieldMapping && typeof output.fieldMapping === 'object') {
    config.output.fieldMapping = output.fieldMapping as Record<string, string>
  }
  return config
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coerceDefault(type: string, raw: string): unknown {
  if (raw.trim() === '') return null
  switch (type) {
    case 'integer': {
      const n = Number(raw)
      return Number.isInteger(n) ? n : raw
    }
    case 'decimal': {
      const n = Number(raw)
      return Number.isFinite(n) ? n : raw
    }
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : raw
    default:
      return raw
  }
}

function TransformEditor({
  title,
  value,
  inputName,
  allowNone = false,
  onChange,
}: {
  title: string
  value: PipelineConfig['transform']
  inputName?: string
  allowNone?: boolean
  onChange: (value: PipelineConfig['transform']) => void
}) {
  const [savedCode, setSavedCode] = useState(value.statement)
  const example =
    value.language === 'sql'
      ? inputName
        ? `SELECT * FROM ${inputName}`
        : 'SELECT 1 AS value'
      : `def transform(inputs, parameters):\n    return ${inputName ? `[{k: v for k, v in row.items() if not k.startswith('_sb_')} for row in inputs['${inputName}']]` : "[{'value': 1}]"}`
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{title}</Label>
        <Select
          aria-label={`${title} language`}
          className="w-32"
          value={value.language}
          onChange={(event) => {
            const language = event.target.value as 'sql' | 'python' | 'none'
            if (language === 'none') {
              setSavedCode(value.statement)
              onChange({ language, statement: '' })
            } else
              onChange({
                language,
                statement:
                  value.language === 'none' ? savedCode : value.statement,
              })
          }}
        >
          {allowNone && <option value="none">No analysis</option>}
          <option value="sql">SQL</option>
          <option value="python">Python</option>
        </Select>
      </div>
      {value.language !== 'none' ? (
        <>
          <Textarea
            aria-label={`${title} code`}
            className="min-h-44 font-mono text-xs leading-5"
            spellCheck={false}
            value={value.statement}
            onChange={(event) =>
              onChange({ ...value, statement: event.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {value.language === 'sql'
              ? 'Write a SELECT query. Input names are tables; use {{parameter}} for run values.'
              : 'Define transform(inputs, parameters). Return a list of dictionaries or a pandas DataFrame.'}
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Example
            </summary>
            <pre className="mt-2 overflow-auto rounded-md bg-muted/40 p-3">
              {example}
            </pre>
          </details>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Run ELN actions directly, without a SQL or Python analysis.
        </p>
      )}
    </div>
  )
}
