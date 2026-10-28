import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { useWritableProjects } from '#/components/v3/projects/use-writable-projects'
import { createBlankExperiment } from '#/lib/notebook-create'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  requireBuiltInModel,
  saveAddedFieldValues,
} from '#/lib/built-in-models'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
} from '#/components/v3/models/added-fields'

const PROTOCOL_MODEL = requireBuiltInModel('protocol_template')

/**
 * Start a protocol: a draft `protocol_template` record in a project, opened on
 * its working document. Submitting that document for review freezes the first
 * version, which is what experiments pin when they start.
 */
export function NewProtocolDialog({
  autoOpen = false,
  onAutoOpened,
}: {
  autoOpen?: boolean
  onAutoOpened?: () => void
} = {}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // The shell's New menu arrives with `?new=true`: open once, then drop the flag.
  useEffect(() => {
    if (!autoOpen) return
    setOpen(true)
    onAutoOpened?.()
  }, [autoOpen, onAutoOpened])
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [touched, setTouched] = useState(false)
  const projects = useWritableProjects(open)
  const effectiveProjectId = projects.usable.some((p) => p.id === projectId)
    ? projectId
    : (projects.usable.at(0)?.id ?? '')
  const titleError =
    touched && title.trim().length < 3
      ? 'Give the protocol a title of at least 3 characters.'
      : undefined

  const addedFields = useAddedFieldDraft('protocol_template')

  const create = useMutation({
    mutationFn: async () => {
      const record = await createBlankExperiment(notebookDataClient, {
        projectId: effectiveProjectId,
        title: title.trim(),
        kind: 'protocol_template',
      })
      await saveAddedFieldValues(
        notebookDataClient,
        PROTOCOL_MODEL,
        record.id,
        addedFields.payload(),
      )
      return record
    },
    onSuccess: (record) => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'protocols'] })
      setOpen(false)
      toast(`Protocol ${record.identifier} created`, {
        description:
          'Write the steps, then submit it for review to freeze its first version.',
      })
      void navigate({
        to: '/records/$recordId/notebook',
        params: { recordId: record.id },
      })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      toast.error(
        /row-level security|permission denied/i.test(message)
          ? 'You don’t have permission to create protocols in that project. Pick a project you can edit, or ask a workspace owner for edit access.'
          : message || 'Could not create the protocol.',
      )
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setTitle('')
          setTouched(false)
        }
      }}
    >
      <DialogTrigger render={<Button variant="primary" icon="plus" />}>
        New protocol
      </DialogTrigger>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="New protocol"
          description="A protocol starts as a draft you write in the notebook editor. Submitting it for review freezes a version that experiments can follow."
        />
        <DialogBody>
          {projects.isError ? (
            <Notice
              tone="bad"
              title="Could not load your projects"
              action={
                <Button size="sm" onClick={projects.refetch}>
                  Try again
                </Button>
              }
            >
              A protocol lives in a project, so the list has to load first.
            </Notice>
          ) : null}
          <Field
            label="Project"
            required
            error={
              touched && !effectiveProjectId
                ? 'Choose a project you can edit that is not archived.'
                : undefined
            }
            hint={
              !projects.isLoading && projects.usable.length === 0
                ? 'You can’t edit any active project. Ask a project owner for edit access.'
                : undefined
            }
          >
            <Select
              value={effectiveProjectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={projects.isLoading || projects.usable.length === 0}
            >
              {projects.isLoading ? (
                <option value="">Loading projects…</option>
              ) : projects.usable.length === 0 ? (
                <option value="">No project available</option>
              ) : (
                projects.usable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))
              )}
            </Select>
          </Field>
          <Field label="Title" required error={titleError}>
            <Input
              autoFocus
              value={title}
              placeholder="e.g. Depth-filter clarification"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <AddedFieldsFormSection draft={addedFields} showErrors={touched} />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending || !effectiveProjectId}
            onClick={() => {
              setTouched(true)
              if (title.trim().length < 3 || !addedFields.valid) return
              create.mutate()
            }}
          >
            {create.isPending ? 'Creating…' : 'Create protocol'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
