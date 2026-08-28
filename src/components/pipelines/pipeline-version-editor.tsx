/**
 * AUTO-03 — Pipeline version configuration editor.
 *
 * Edits a draft Pipeline version in place (or creates the first draft), with
 * live validation from the shared config contract. Published versions are
 * read-only here — reproducibility pins exactly what ran.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react'

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
}: {
  dataClient: DataClient
  workspaceId: string
  definitionId: string
  draft: PipelineDefinitionVersionWire | null
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<PipelineConfig>(() =>
    draft ? normalizeConfig(draft.configuration) : emptyConfig(),
  )
  const [saveError, setSaveError] = useState('')

  const schemasQuery = useQuery({
    queryKey: ['pipelines', 'schemas'],
    queryFn: () => listPublishedDatasetSchemas(dataClient),
    enabled: canManage,
  })

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

  const update = (patch: Partial<PipelineConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }))

  if (!canManage) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        Only owners, admins and stewards can edit Pipeline configurations.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Section
        title="Inputs"
        hint="Explicit Dataset Version inputs. Each input becomes a temp table of the same name inside the transform."
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
        hint="Typed parameters referenced in the transform as {{name}} placeholders. Required parameters have no default."
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
                    parameters[index] = { ...parameter, required: checked }
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

      <Section
        title="Transform"
        hint="Exactly one deterministic SELECT over the input temp tables. {{param}} placeholders are replaced with typed literals. Runs inside a sandboxed role with a fixed 60s timeout and a 100,000-row result cap."
      >
        <Textarea
          className="font-mono min-h-40 text-xs"
          value={config.transform.statement}
          onChange={(event) =>
            update({
              transform: { ...config.transform, statement: event.target.value },
            })
          }
          aria-label="transform SQL"
        />
      </Section>

      <Section
        title="Output"
        hint="The result column names must match the output Schema field slugs, or map them with fieldMapping."
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label>Mode</Label>
            <Select
              className="w-40"
              value={config.output.mode}
              onChange={(event) =>
                update({
                  output: {
                    ...config.output,
                    mode: event.target.value as 'create' | 'append',
                  },
                })
              }
              aria-label="output mode"
            >
              <option value="create">Create Dataset</option>
              <option value="append">Append to Dataset</option>
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
          ) : (
            <div className="space-y-1">
              <Label>Existing Dataset id</Label>
              <Input
                className="font-mono text-sm"
                value={config.output.datasetId ?? ''}
                onChange={(event) =>
                  update({
                    output: { ...config.output, datasetId: event.target.value },
                  })
                }
              />
            </div>
          )}

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
              value={
                config.output.fieldMapping
                  ? JSON.stringify(config.output.fieldMapping, null, 2)
                  : ''
              }
              onChange={(event) => {
                const raw = event.target.value.trim()
                let mapping: Record<string, string> | null = null
                if (raw) {
                  try {
                    const parsed = JSON.parse(raw)
                    if (
                      parsed &&
                      typeof parsed === 'object' &&
                      !Array.isArray(parsed)
                    ) {
                      mapping = parsed as Record<string, string>
                    }
                  } catch {
                    // keep previous value; validation surfaces the error
                  }
                }
                update({ output: { ...config.output, fieldMapping: mapping } })
              }}
              placeholder='{ "value": "concentration" }'
            />
          </div>
        </div>
      </Section>

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
          disabled={errors.length > 0 || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending && (
            <Loader2 className="size-4 animate-spin" />
          )}
          {draft ? 'Save draft' : 'Create draft version'}
        </Button>
        {draft && (
          <Badge variant="secondary">
            draft v{draft.version} · revision {String(draft.revision)}
          </Badge>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function normalizeConfig(raw: Record<string, unknown>): PipelineConfig {
  const config = emptyConfig()
  if (!isRecord(raw)) return config
  const record = raw
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
  if (typeof transform.statement === 'string') {
    config.transform.statement = transform.statement
  }
  const output = (record.output ?? {}) as Record<string, unknown>
  if (output.mode === 'append' || output.mode === 'create') {
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
