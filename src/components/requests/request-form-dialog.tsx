/**
 * Ask for something. The questions come from the model's own fields, the same
 * way the "new record" form is made, so there is no per-form code.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  buildRecordModelCustomFields,
  modelFieldErrorMessage,
  modelFieldInputErrors,
  useRecordModelFields,
  useRecordModelProjects,
} from '#/components/models/models-data'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchRequestForms,
  messageOf,
  requestKeys,
  submitRequest,
} from '#/lib/requests'
import type { RequestForm } from '#/lib/requests'

export function RequestFormDialog({
  open,
  onOpenChange,
  forms,
  initialKey,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  forms: RequestForm[]
  initialKey?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <RequestFormPanel
          forms={forms}
          initialKey={initialKey}
          onSent={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  )
}

/**
 * The form itself. It mounts only while the dialog is open, so every opening
 * starts from empty answers and the model the caller asked for.
 */
function RequestFormPanel({
  forms,
  initialKey,
  onSent,
}: {
  forms: RequestForm[]
  initialKey?: string
  onSent: () => void
}) {
  const queryClient = useQueryClient()

  const [modelKey, setModelKey] = useState(
    initialKey ?? forms.at(0)?.model_key ?? '',
  )

  const form = forms.find((f) => f.model_key === modelKey)

  const fieldsQuery = useRecordModelFields(modelKey)

  const fields = useMemo(
    () => (fieldsQuery.data ?? []).filter((f) => f.lifecycle === 'active'),
    [fieldsQuery.data],
  )

  const projects = useRecordModelProjects().data ?? []

  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [note, setNote] = useState('')
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [interacted, setInteracted] = useState(false)

  const customFields = useMemo(
    () => buildRecordModelCustomFields(fields, values),
    [fields, values],
  )

  const fieldErrors = useMemo(
    () => modelFieldInputErrors(fields, values),
    [fields, values],
  )

  const titleError = title.trim() ? null : t('requests.form.nameRequired')
  const canSend = !titleError && Object.keys(fieldErrors).length === 0

  const send = useMutation({
    mutationFn: () =>
      submitRequest(notebookDataClient, {
        modelKey,
        title: title.trim(),
        customFields,
        projectId: projectId || null,
        note,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: requestKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['work-items'] })
      toast.success(t('requests.form.sent', { identifier: created.identifier }))
      onSent()
    },
    onError: (e) => toast.error(messageOf(e, t('requests.form.couldNotSend'))),
  })

  return (
    <DialogContent className="w-[min(560px,calc(100vw-32px))]">
      <DialogHeader title={t('requests.form.title')} />
      <DialogBody>
        <form
          id="request-form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setInteracted(true)

            if (canSend && !send.isPending) send.mutate()
          }}
        >
          {forms.length > 1 ? (
            <Field label={t('requests.form.which')}>
              <Select
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
              >
                {forms.map((f) => (
                  <option key={f.model_key} value={f.model_key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {form?.intro ? (
            <p className="m-0 text-body text-fg-muted">{form.intro}</p>
          ) : null}
          <Field
            label={t('requests.form.summary')}
            hint={t('requests.form.summaryHint')}
            error={interacted ? titleError : null}
            required
          >
            <Input
              value={title}
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value)
                setInteracted(true)
              }}
            />
          </Field>
          {fieldsQuery.isPending ? null : fields.length === 0 ? (
            <p className="m-0 text-label text-fg-muted">
              {t('requests.form.noFields')}
            </p>
          ) : (
            fields.map((field) => (
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
                  <span role="alert" className="text-label text-danger-text">
                    {modelFieldErrorMessage(fieldErrors[field.fieldName])}
                  </span>
                ) : null}
              </div>
            ))
          )}
          {projects.length > 0 ? (
            <Field label={t('requests.form.project')}>
              <Select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">{t('requests.form.noProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t('requests.form.note')}>
            <Input
              value={note}
              maxLength={4000}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="quiet" />}>
          {t('requests.form.cancel')}
        </DialogClose>
        <Button
          type="submit"
          form="request-form"
          variant="primary"
          disabled={send.isPending || (interacted && !canSend)}
        >
          {send.isPending
            ? t('requests.form.sending')
            : t('requests.form.send')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

/** Kept so callers can share one query for the list of forms. */
export function useRequestForms() {
  return useQuery({
    queryKey: requestKeys.forms,
    queryFn: () => fetchRequestForms(notebookDataClient),
    staleTime: 10_000,
  })
}
