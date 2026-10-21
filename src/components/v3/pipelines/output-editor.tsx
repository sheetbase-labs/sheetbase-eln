import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import {
  checkOutputFit,
  columnForField,
  setFieldColumn,
} from '#/lib/pipelines/authoring'
import {
  usePipelineOutputTargets,
  useSchemaVersionFields,
} from '#/components/v3/pipelines/pipelines-data'

export type OutputMode = 'create' | 'append' | 'none'

export interface OutputDraft {
  mode: OutputMode
  datasetName: string
  schemaVersionId: string
  datasetId: string
  datasetLabel: string
  fieldMapping: Record<string, string> | null
}

const MODE_HELP: Record<OutputMode, string> = {
  none: 'The result is shown on the run page for that run only. Nothing is stored as a dataset.',
  create:
    'The dataset is created the first time the pipeline runs. Every later run adds its rows to it and saves a new Dataset Version, so the dataset grows and each version is a snapshot.',
  append:
    'Every run adds its result rows to the dataset you choose and saves a new Dataset Version. Re-running adds the rows again.',
}

/**
 * Where a pipeline's result goes. A scientist picks a mode in plain words, then
 * the dataset (or the schema a new one is built from), and sees the columns the
 * result must produce. A result column that is named differently from the
 * schema field it feeds is matched here, with the columns of the last run
 * offered as suggestions, instead of in configuration JSON.
 */
export function OutputEditor({
  value,
  onChange,
  resultColumns,
  fieldErrors,
}: {
  value: OutputDraft
  onChange: (patch: Partial<OutputDraft>) => void
  /** Column names of the newest successful run, to suggest and to check against. */
  resultColumns: string[]
  /** Contract errors for `output.*`, keyed by the part after `output.`. */
  fieldErrors: Record<string, string>
}) {
  const targets = usePipelineOutputTargets()
  const dataset = (targets.data?.datasets ?? []).find(
    (d) => d.id === value.datasetId,
  )
  const fieldsSchemaVersion =
    value.mode === 'create'
      ? value.schemaVersionId
      : value.mode === 'append'
        ? (dataset?.schemaVersionId ?? '')
        : ''
  const fields = useSchemaVersionFields(fieldsSchemaVersion)
  const fieldList = fields.data ?? []
  const fit = checkOutputFit(fieldList, value.fieldMapping, resultColumns)

  return (
    <div className="flex flex-col gap-4">
      <Field label="What should a run keep?" hint={MODE_HELP[value.mode]}>
        <Select
          aria-label="Output mode"
          value={value.mode}
          onChange={(event) =>
            onChange({ mode: event.target.value as OutputMode })
          }
        >
          <option value="none">Just show the result (save nothing)</option>
          <option value="create">Save to a new dataset</option>
          <option value="append">Add to an existing dataset</option>
        </Select>
      </Field>

      {value.mode === 'create' ? (
        <>
          <Field
            label="Dataset name"
            error={fieldErrors.datasetName}
            hint="Shown in the Datasets list. Changing it later starts a new dataset."
          >
            <Input
              aria-label="Dataset name"
              value={value.datasetName}
              onChange={(e) => onChange({ datasetName: e.target.value })}
            />
          </Field>
          <Field
            label="Dataset schema version"
            error={fieldErrors.schemaVersionId}
            hint="The columns the dataset has. Your result must produce them."
          >
            <Select
              aria-label="Dataset schema version"
              value={value.schemaVersionId}
              onChange={(e) =>
                onChange({
                  schemaVersionId: e.target.value,
                  fieldMapping: null,
                })
              }
            >
              <option value="">Choose a schema version…</option>
              {(targets.data?.schemaVersions ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          {!targets.isLoading &&
          !targets.isError &&
          (targets.data?.schemaVersions.length ?? 0) === 0 ? (
            <Notice tone="warn">
              This workspace has no active dataset schema yet. Import a file to
              create a dataset, or publish a schema, then come back.
            </Notice>
          ) : null}
        </>
      ) : null}

      {value.mode === 'append' ? (
        <Field
          label="Dataset"
          error={fieldErrors.datasetId}
          hint="Each run adds a Dataset Version to this dataset."
        >
          <Select
            aria-label="Dataset"
            value={value.datasetId}
            onChange={(e) =>
              onChange({ datasetId: e.target.value, fieldMapping: null })
            }
          >
            <option value="">Choose a dataset…</option>
            {(targets.data?.datasets ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayId ? `${d.displayId} · ${d.name}` : d.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {value.mode !== 'none' ? (
        <Field
          label="Dataset version label"
          error={fieldErrors.datasetLabel}
          hint="Names each version a run writes, for example “Weekly readings”."
        >
          <Input
            aria-label="Dataset version label"
            value={value.datasetLabel}
            onChange={(e) => onChange({ datasetLabel: e.target.value })}
          />
        </Field>
      ) : null}

      {value.mode !== 'none' && fieldsSchemaVersion ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-label font-medium text-fg">
            Columns the result must produce
          </legend>
          {fields.isLoading ? (
            <p className="m-0 text-label text-fg-muted">Loading columns…</p>
          ) : fieldList.length === 0 ? (
            <p className="m-0 text-label text-fg-muted">
              This schema has no active fields.
            </p>
          ) : (
            <>
              <p className="m-0 text-label text-fg-muted">
                Name each result column after its field, or say which result
                column feeds it. Fields marked * are required.
              </p>
              <datalist id="pipeline-result-columns">
                {resultColumns.map((column) => (
                  <option key={column} value={column} />
                ))}
              </datalist>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {fieldList.map((field) => (
                  <li
                    key={field.key}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="w-[200px] min-w-0">
                      <span className="mono text-xs">{field.key}</span>
                      {field.required ? (
                        <span aria-hidden="true"> *</span>
                      ) : null}
                      <span className="block text-caption text-fg-muted">
                        {field.label} · {field.type}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-fg-muted">
                      ←
                    </span>
                    <Input
                      className="mono h-8 w-[200px] text-xs"
                      list="pipeline-result-columns"
                      aria-label={`Result column for ${field.key}`}
                      placeholder={field.key}
                      value={columnForField(value.fieldMapping, field.key)}
                      onChange={(e) =>
                        onChange({
                          fieldMapping: setFieldColumn(
                            value.fieldMapping,
                            field.key,
                            e.target.value,
                          ),
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
              {resultColumns.length ? (
                fit.missing.length || fit.unmatched.length ? (
                  <Notice
                    tone="warn"
                    title="The last run’s columns do not fit."
                  >
                    {fit.missing.length
                      ? `No column feeds ${fit.missing.join(', ')}. `
                      : ''}
                    {fit.unmatched.length
                      ? `${fit.unmatched.join(', ')} ${fit.unmatched.length === 1 ? 'matches' : 'match'} no field.`
                      : ''}
                  </Notice>
                ) : (
                  <p className="m-0 text-label text-fg-muted">
                    The columns of the last run ({resultColumns.join(', ')}) fit
                    this schema.
                  </p>
                )
              ) : (
                <p className="m-0 text-label text-fg-muted">
                  Run the pipeline once and its result columns are suggested
                  here and checked against these fields.
                </p>
              )}
              {value.fieldMapping ? (
                <div>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => onChange({ fieldMapping: null })}
                  >
                    Clear column matching
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </fieldset>
      ) : null}

      {value.mode !== 'none' && targets.isError ? (
        <Notice tone="bad" title="Couldn’t load datasets and schemas">
          The choices above come from the workspace’s datasets.{' '}
          <Button size="sm" onClick={() => void targets.refetch()}>
            Try again
          </Button>
        </Notice>
      ) : null}
    </div>
  )
}
