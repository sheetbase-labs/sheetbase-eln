import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import { words } from '#/lib/pipelines/simple/words'
import { notebookDataClient } from '#/lib/notebook-data'
import { duplicatePipelineDefinition } from '#/lib/pipelines/simple/data'

const KEY = /^[a-z][a-z0-9_]{0,59}$/

const du = words('duplicate')

const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 60)

/** Make a new pipeline from one version of this one, in the mode it was written in. */
export function DuplicateDialog({
  open,
  onOpenChange,
  workspaceId,
  versionId,
  version,
  mode,
  displayId,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  versionId: string
  version: number
  mode: string
  displayId: string
  name: string
}) {
  const [copyName, setCopyName] = useState(() => du('copyOf', { name }))
  const [key, setKey] = useState(() => keyFrom(du('copyOf', { name })))
  const keyTouched = useRef(false)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const nameError = tried && !copyName.trim() ? du('nameRequired') : null
  const keyError = tried && !KEY.test(key.trim()) ? du('keyInvalid') : null

  const duplicate = useMutation({
    mutationFn: () =>
      duplicatePipelineDefinition(notebookDataClient, {
        workspaceId,
        versionId,
        key: key.trim(),
        name: copyName.trim(),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })
      toast(du('done', { name: created.name }))
      onOpenChange(false)
      void navigate({
        to: '/pipelines/$pipelineId',
        params: { pipelineId: created.id },
      })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : ''

      setServerError(
        /duplicate key/i.test(message)
          ? du('keyTaken')
          : message || du('failed'),
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={du('title', { version })}
          description={du('text', { mode, id: displayId })}
        />
        <DialogBody className="flex flex-col gap-3">
          <Field label={du('name')} error={nameError ?? undefined}>
            <Input
              value={copyName}
              onChange={(event) => {
                setCopyName(event.target.value)

                if (!keyTouched.current) setKey(keyFrom(event.target.value))
              }}
            />
          </Field>
          <Field
            label={du('key')}
            hint={du('keyHint')}
            error={keyError ?? serverError ?? undefined}
          >
            <Input
              value={key}
              onChange={(event) => {
                keyTouched.current = true
                setKey(event.target.value)
                setServerError(null)
              }}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{du('cancel')}</Button>
          <Button
            variant="primary"
            disabled={duplicate.isPending}
            onClick={() => {
              setTried(true)

              if (copyName.trim() && KEY.test(key.trim())) duplicate.mutate()
            }}
          >
            {duplicate.isPending ? du('working') : du('action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
