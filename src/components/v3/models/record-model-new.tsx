import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Input } from '#/components/v3/ui/input'
import { Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { evaluateModelRules } from '#/lib/model-rules'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  buildRecordModelCustomFields,
  modelFieldErrorMessage,
  modelFieldInputErrors,
  recordModelNextIdentifier,
  useModelRules,
  useRecordModelFields,
  useRecordModelProjects,
  useRecordModelRecords,
  useWorkspaceRecordModel,
} from './models-data'
import type { RecordModelRecord } from './models-data'
import { useModelTypes, useTypeFields } from './model-subtype-data'
import { setModelType, typeRoot } from '#/lib/model-subtypes'

/**
 * MDL-04.2 — the "new record" form is generated from the model's active field
 * definitions: types, units, choices, record links and the model's rules shown
 * inline. The same validation kernel (`validateModelFieldValue` →
 * `parseModelFieldInput`) runs here and in `create_model_record`; the server
 * stays authoritative. No per-model form code.
 */
export function RecordModelNew({ modelKey }: { modelKey: string }) {
  const navigate = useNavigate()
  const model = useWorkspaceRecordModel(modelKey)
  const ownFields = useRecordModelFields(modelKey)
  const rulesQuery = useModelRules(modelKey)
  const projectsQuery = useRecordModelProjects()
  const recordsQuery = useRecordModelRecords(modelKey)
  // A subtype's record is a record of the type at the top of its chain, with
  // every field from there down.
  const types = useModelTypes()
  const parentKey = model.data?.parent_key ?? null
  const rootKey = parentKey && types.data ? typeRoot(types.data, modelKey) : ''
  const chainFields = useTypeFields(types.data, rootKey, modelKey, null, {
    enabled: Boolean(parentKey),
  })
  const fieldsQuery = parentKey ? chainFields : ownFields

  const fields = useMemo(
    () =>
      parentKey
        ? (chainFields.data ?? []).flatMap((group) => group.fields)
        : (ownFields.data ?? []),
    [parentKey, chainFields.data, ownFields.data],
  )
  const rootFieldKeys = new Set(
    (chainFields.data ?? [])
      .filter((group) => group.modelKey === rootKey)
      .flatMap((group) => group.fields.map((field) => field.fieldName)),
  )
  const rules = rulesQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const records = recordsQuery.data ?? []

  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Errors are held back until the person has interacted: a pristine form is
  // not an error state, and the disabled Create button is not the message.
  const [interacted, setInteracted] = useState(false)

  const selectedProject = projectId || projects[0]?.id || ''

  const customFields = useMemo(
    () => buildRecordModelCustomFields(fields, values),
    [fields, values],
  )
  const fieldErrors = useMemo(
    () => modelFieldInputErrors(fields, values),
    [fields, values],
  )
  const validation = useMemo(
    () => evaluateModelRules(rules, customFields),
    [rules, customFields],
  )
  const titleError = title.trim() ? null : 'Name is required'

  const idPreview = recordModelNextIdentifier(
    model.data?.identifier_prefix ?? '',
    records,
  )

  const canSubmit =
    !submitting &&
    !titleError &&
    validation.blocks.length === 0 &&
    Object.keys(fieldErrors).length === 0 &&
    Boolean(selectedProject)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit || !model.data) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const created = await notebookDataClient.rpc<RecordModelRecord>(
        'create_model_record',
        {
          p_project_id: selectedProject,
          p_kind: parentKey ? rootKey : modelKey,
          p_title: title.trim(),
          p_status: 'draft',
          p_tags: [],
          p_properties: {},
          p_custom_fields: parentKey
            ? Object.fromEntries(
                Object.entries(customFields).filter(([key]) =>
                  rootFieldKeys.has(key),
                ),
              )
            : customFields,
        },
      )
      if (parentKey)
        await setModelType(
          notebookDataClient,
          'record',
          created.id,
          modelKey,
          customFields,
        )
      await navigate({
        to: '/models/$modelId/records/$recordId',
        params: {
          modelId: parentKey ? rootKey : modelKey,
          recordId: created.id,
        },
      })
    } catch (caught) {
      setSubmitError(
        caught instanceof Error
          ? caught.message
          : 'Could not create the record.',
      )
      setSubmitting(false)
    }
  }

  if (!model.isLoading && !model.data) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="table"
          title="Model not found"
          description={`No workspace record model with the key “${modelKey}” is visible in this workspace.`}
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/models" />}
            >
              Back to Models
            </Button>
          }
        />
      </div>
    )
  }

  const loading =
    model.isLoading || fieldsQuery.isLoading || projectsQuery.isLoading

  return (
    <form
      onSubmit={submit}
      className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-4 md:px-6"
    >
      <Section
        title={`New ${model.data?.name ?? 'record'}`}
        action={
          <span className="text-label text-fg-muted">
            Model {model.data?.name ?? modelKey}
            {model.data ? ` v${model.data.current_version}` : ''}
          </span>
        }
      >
        <p className="m-0 text-label text-fg-muted">
          This form is generated from the model. The model decides the fields,
          types, units and rules; changing the model changes this form without
          code changes.
        </p>

        {loading ? (
          <p className="text-label text-fg-muted">Loading fields…</p>
        ) : fields.length === 0 ? (
          <p className="text-label text-fg-muted">
            This model has no active fields yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs text-fg-muted">
              Name *
              <Input
                className="mt-1 h-8 text-xs"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setInteracted(true)
                }}
                aria-label="Name"
                required
              />
              {interacted && titleError ? (
                <span role="alert" className="mt-1 block text-danger-text">
                  {titleError}
                </span>
              ) : null}
            </label>

            {projects.length > 1 ? (
              <label className="text-xs text-fg-muted">
                Project *
                <Select
                  className="mt-1 h-8 text-xs"
                  value={selectedProject}
                  onChange={(event) => setProjectId(event.target.value)}
                  aria-label="Project"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </Select>
              </label>
            ) : projects.length === 1 ? (
              <div className="text-xs text-fg-muted">
                Project *
                <p className="mt-1 mb-0 text-body text-fg">
                  {projects[0].title}
                </p>
              </div>
            ) : (
              <div className="md:col-span-2">
                <Notice
                  tone="warn"
                  title="A project is required"
                  action={
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={<Link to="/projects" />}
                    >
                      Projects
                    </Button>
                  }
                >
                  Every record is filed under a project, and this workspace has
                  none yet. Create one, then come back to this form.
                </Notice>
              </div>
            )}

            {fields.map((field) => (
              <div key={field.id} className="flex flex-col gap-1">
                <ModelFieldInput
                  definition={field}
                  value={
                    values[field.fieldName] ??
                    (field.logicalType === 'boolean' ? false : '')
                  }
                  onChange={(value) => {
                    setValues((current) => ({
                      ...current,
                      [field.fieldName]: value,
                    }))
                    setInteracted(true)
                  }}
                />
                {interacted && fieldErrors[field.fieldName] ? (
                  <span
                    role="alert"
                    className="text-[0.65rem] text-danger-text"
                  >
                    {modelFieldErrorMessage(fieldErrors[field.fieldName])}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {validation.blocks.length || validation.warnings.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
            {[...validation.blocks, ...validation.warnings].map((match) => (
              <li
                key={match.ruleId}
                className={
                  match.effect === 'block'
                    ? 'text-danger-text'
                    : 'text-fg-muted'
                }
              >
                {match.effect === 'block' ? 'Blocked: ' : 'Rule: '}
                {match.message}
              </li>
            ))}
          </ul>
        ) : null}

        {submitError ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {submitError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {submitting
              ? 'Creating…'
              : `Create ${model.data?.name ?? 'record'}`}
          </Button>
          <Button
            variant="quiet"
            nativeButton={false}
            render={
              <Link
                to="/models/$modelId/records"
                params={{ modelId: modelKey }}
              />
            }
          >
            Cancel
          </Button>
          <span className="flex-1" />
          {parentKey ? null : (
            <span className="text-label text-fg-muted">
              ID <span className="mono">{idPreview}</span> on save
            </span>
          )}
        </div>
      </Section>
    </form>
  )
}
