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
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { projectOption } from '#/components/v3/record-picker/entity-options'
import { toast } from '#/components/v3/ui/sonner'
import { useWritableProjects } from '#/components/v3/projects/use-writable-projects'
import { createBlankExperiment } from '#/lib/notebook-create'
import { notebookDataClient } from '#/lib/notebook-data'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
} from '#/components/v3/models/added-fields'
import { t } from '#/copy'

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
      ? t('library.protocols.newProtocolDialog.giveTheProtocolATitle')
      : undefined

  const addedFields = useAddedFieldDraft('protocol_template')

  const create = useMutation({
    mutationFn: async () => {
      const record = await createBlankExperiment(notebookDataClient, {
        projectId: effectiveProjectId,
        title: title.trim(),
        kind: 'protocol_template',
      })
      const typed = await saveNewObjectFields(
        notebookDataClient,
        PROTOCOL_MODEL,
        record.id,
        addedFields.typeKey,
        addedFields.payload(),
      )
      return { ...record, identifier: typed.identifier ?? record.identifier }
    },
    onSuccess: (record) => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'protocols'] })
      setOpen(false)
      toast(
        t('library.protocols.newProtocolDialog.protocolCreated', {
          identifier: record.identifier,
        }),
        {
          description: t(
            'library.protocols.newProtocolDialog.writeTheStepsThenSubmit',
          ),
        },
      )
      void navigate({
        to: '/records/$recordId/notebook',
        params: { recordId: record.id },
      })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      toast.error(
        /row-level security|permission denied/i.test(message)
          ? t('library.protocols.newProtocolDialog.youDontHavePermissionTo')
          : message ||
              t(
                'library.protocols.newProtocolDialog.couldNotCreateTheProtocol',
              ),
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
        {t('library.protocols.newProtocolDialog.newProtocol')}
      </DialogTrigger>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.protocols.newProtocolDialog.newProtocol')}
          description={t(
            'library.protocols.newProtocolDialog.aProtocolStartsAsA',
          )}
        />
        <DialogBody>
          {projects.isError ? (
            <Notice
              tone="bad"
              title={t(
                'library.protocols.newProtocolDialog.couldNotLoadYourProjects',
              )}
              action={
                <Button size="sm" onClick={projects.refetch}>
                  {t('common.actions.tryAgain')}
                </Button>
              }
            >
              {t('library.protocols.newProtocolDialog.aProtocolLivesInA')}
            </Notice>
          ) : null}
          <Field
            label={t('library.protocols.newProtocolDialog.project')}
            required
            error={
              touched && !effectiveProjectId
                ? t('library.protocols.newProtocolDialog.chooseAProjectYouCan')
                : undefined
            }
            hint={
              !projects.isLoading && projects.usable.length === 0
                ? t('library.protocols.newProtocolDialog.youCantEditAnyActive')
                : undefined
            }
          >
            <PickerSelect
              noun="project"
              value={effectiveProjectId}
              onChange={(id) => setProjectId(id)}
              disabled={projects.isLoading || projects.usable.length === 0}
              placeholder={
                projects.isLoading
                  ? 'Loading projects…'
                  : projects.usable.length === 0
                    ? 'No project available'
                    : undefined
              }
              options={projects.usable.map((p) => projectOption(p))}
            />
          </Field>
          <Field
            label={t('library.protocols.newProtocolDialog.title')}
            required
            error={titleError}
          >
            <Input
              autoFocus
              value={title}
              placeholder={t(
                'library.protocols.newProtocolDialog.eGDepthFilterClarification',
              )}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <AddedFieldsFormSection draft={addedFields} showErrors={touched} />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending || !effectiveProjectId}
            onClick={() => {
              setTouched(true)
              if (title.trim().length < 3 || !addedFields.valid) return
              create.mutate()
            }}
          >
            {create.isPending
              ? t('library.protocols.newProtocolDialog.creating')
              : t('library.protocols.newProtocolDialog.createProtocol')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
