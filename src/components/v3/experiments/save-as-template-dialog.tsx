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
        description: `Saved from ${experiment.identifier}.`,
      }),
    onSuccess: async ({ template, leftOut }) => {
      onOpenChange(false)
      await queryClient.invalidateQueries({
        queryKey: ['ui-port', 'templates'],
      })
      toast(`${template.name} saved as a template`, {
        description:
          (leftOut.length > 0
            ? `Not carried over: ${leftOut.join(', ')}. `
            : '') +
          'Its first version is a draft; publish it under Versions to use it.',
      })
      await navigate({
        to: '/templates/$templateId',
        params: { templateId: template.id },
      })
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : 'Could not save the template.',
      ),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Save ${experiment.identifier} as a template`}
          description="Takes this experiment's writing, method and sheet structure. Checklists start unchecked; results, files and charts stay behind."
        />
        <DialogBody>
          <Field label="Template name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Key"
            hint="Lowercase letters, digits and underscore, starting with a letter."
            error={
              keyOk
                ? undefined
                : 'Use lowercase letters, digits and underscore.'
            }
          >
            <Input
              value={effectiveKey}
              onChange={(event) => setKey(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button>Cancel</Button>} />
          <Button
            variant="primary"
            disabled={!name.trim() || !keyOk || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save as template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
