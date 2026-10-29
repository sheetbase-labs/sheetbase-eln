import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { toast } from '#/components/v3/ui/sonner'
import {
  saveExperimentAsTemplate,
  templateKeyFromName,
} from '#/lib/experiment-to-template'
import { notebookDataClient } from '#/lib/notebook-data'
import { t } from '#/copy'

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/

/**
 * Save an experiment's writing, method and sheet structure as a notebook
 * template. Creating lands on the template, where its first version is a draft
 * to publish; what was not carried over is named in the confirmation.
 */
export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  experiment,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  experiment: {
    id: string
    workspace_id: string
    identifier: string
    title: string
  }
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(experiment.title)
  const [key, setKey] = useState<string | null>(null)
  const effectiveKey = key ?? templateKeyFromName(name)
  const keyOk = KEY_PATTERN.test(effectiveKey)

  const save = useMutation({
    mutationFn: () =>
      saveExperimentAsTemplate(notebookDataClient, {
        workspaceId: experiment.workspace_id,
        experimentId: experiment.id,
        key: effectiveKey,
        name: name.trim(),
        description: t('projects.saveAsTemplate.description', {
          identifier: experiment.identifier,
        }),
      }),
    onSuccess: async ({ template, leftOut }) => {
      onOpenChange(false)
      await queryClient.invalidateQueries({
        queryKey: ['ui-port', 'templates'],
      })
      toast(t('projects.saveAsTemplate.saved', { name: template.name }), {
        description:
          (leftOut.length > 0
            ? t('projects.saveAsTemplate.leftOut', { list: leftOut.join(', ') })
            : '') + t('projects.saveAsTemplate.draftNote'),
      })
      await navigate({
        to: '/templates/$templateId',
        params: { templateId: template.id },
      })
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('projects.saveAsTemplate.failed'),
      ),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={t('projects.saveAsTemplate.title', {
            identifier: experiment.identifier,
          })}
          description={t('projects.saveAsTemplate.intro')}
        />
        <DialogBody>
          <Field label={t('projects.saveAsTemplate.name')} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label={t('projects.saveAsTemplate.key')}
            hint={t('projects.saveAsTemplate.keyHint')}
            error={keyOk ? undefined : t('projects.saveAsTemplate.keyError')}
          >
            <Input
              value={effectiveKey}
              onChange={(event) => setKey(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button>{t('common.actions.cancel')}</Button>} />
          <Button
            variant="primary"
            disabled={!name.trim() || !keyOk || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('common.states.saving')
              : t('projects.saveAsTemplate.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
