/**
 * The Requests box on a model: tick it and people can ask for this kind of work
 * from the Requests page. Choose who handles the requests.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchRequestForms,
  messageOf,
  requestKeys,
  setRequestForm,
} from '#/lib/requests'
import {
  fetchWorkspaceMemberIdentities,
  workspaceMemberQueryKeys,
} from '#/components/projects/project-data'
import type { WorkspaceRecordModel } from '#/components/models/models-data'

export function RequestSettingsDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: WorkspaceRecordModel
}) {
  const queryClient = useQueryClient()

  const forms = useQuery({
    queryKey: requestKeys.forms,
    queryFn: () => fetchRequestForms(notebookDataClient),
    staleTime: 10_000,
  })

  const members = useQuery({
    queryKey: workspaceMemberQueryKeys.identities,
    queryFn: fetchWorkspaceMemberIdentities,
    staleTime: 60_000,
  })

  const form = (forms.data ?? []).find((f) => f.model_key === model.key)
  const [accepts, setAccepts] = useState(false)
  const [intro, setIntro] = useState('')
  const [handlers, setHandlers] = useState<string[]>([])

  useEffect(() => {
    if (!open || forms.isPending) return
    setAccepts(Boolean(form))
    setIntro(form?.intro ?? '')
    setHandlers(form?.handler_user_ids ?? [])
  }, [open, forms.isPending, form])

  const save = useMutation({
    mutationFn: () =>
      setRequestForm(notebookDataClient, {
        modelKey: model.key,
        accepts,
        intro: accepts ? intro : '',
        handlerUserIds: accepts ? handlers : [],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestKeys.all })
      toast.success(t('requests.settings.saved'))
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('requests.settings.couldNotSave'))),
  })

  const people = (members.data ?? []).filter(
    (m) => m.role !== 'client_viewer' && m.role !== 'viewer',
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title={t('requests.settings.title')} />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-2 text-body">
              <Checkbox
                checked={accepts}
                onCheckedChange={(checked) => setAccepts(checked === true)}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span className="font-medium">
                  {t('requests.settings.tick')}
                </span>
                <span className="text-label text-fg-muted">
                  {t('requests.settings.tickHint')}
                </span>
              </span>
            </label>
            {accepts ? (
              <>
                <Field
                  label={t('requests.settings.intro')}
                  hint={t('requests.settings.introHint')}
                >
                  <Input
                    value={intro}
                    maxLength={1000}
                    onChange={(e) => setIntro(e.target.value)}
                  />
                </Field>
                <Field
                  label={t('requests.settings.handlers')}
                  hint={t('requests.settings.handlersHint')}
                >
                  <span className="flex max-h-48 flex-col gap-1.5 overflow-auto">
                    {people.map((m) => (
                      <label
                        key={m.user_id}
                        className="flex items-center gap-2 text-body"
                      >
                        <Checkbox
                          checked={handlers.includes(m.user_id)}
                          onCheckedChange={(checked) =>
                            setHandlers((current) =>
                              checked === true
                                ? [...current, m.user_id]
                                : current.filter((id) => id !== m.user_id),
                            )
                          }
                        />
                        {m.name}
                      </label>
                    ))}
                  </span>
                </Field>
              </>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('requests.settings.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('requests.settings.saving')
              : t('requests.settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
