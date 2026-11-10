import { useState } from 'react'

import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { personOption } from '#/components/record-picker/entity-options'
import { Select } from '#/components/ui/select'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
} from '#/components/models/added-fields'
import { t } from '#/copy'

import { modalities, stages } from './options'
import type { NewProjectInput } from './projects-page-model'

/** The Client select's value for "create the client as the project is made". */
const NEW_CLIENT = '__new_client__'

/**
 * The create-project form. A new client can be created in the same act, which
 * is why the client select carries a footer option; the workspace's added
 * fields are part of the form, and the button says why it cannot be pressed
 * rather than being disabled without a reason.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
  error,
  clientOptions,
  memberOptions,
  meId,
  canCreateClient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: NewProjectInput) => void
  creating: boolean
  error: string | null
  clientOptions: { id: string; label: string }[]
  memberOptions: { id: string; label: string }[]
  meId?: string
  canCreateClient: boolean
}) {
  const [title, setTitle] = useState('')
  const addedFields = useAddedFieldDraft('project')
  const [tried, setTried] = useState(false)
  const [clientId, setClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const addingClient = clientId === NEW_CLIENT
  const [stage, setStage] = useState('')
  const [modality, setModality] = useState('')
  // The person creating a project leads it unless they pick someone else.
  const [leadChoice, setLeadChoice] = useState<string | null>(null)

  const leadDefault =
    meId && memberOptions.some((member) => member.id === meId) ? meId : ''

  const lead = leadChoice ?? leadDefault
  const setLead = setLeadChoice
  const [reviewer, setReviewer] = useState('')
  const [agreement, setAgreement] = useState('')
  const [startedOn, setStartedOn] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader title={t('projects.projectsPage.newProject')} />
        <DialogBody>
          <form
            id="new-project-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              setTried(true)

              if (!title.trim()) return

              if (addingClient && !newClientName.trim()) return

              if (!addedFields.valid) return
              onCreate({
                title: title.trim(),
                clientId: addingClient ? null : clientId || null,
                newClientName: addingClient ? newClientName.trim() : null,
                stage: stage || null,
                modality: modality || null,
                leadUserId: lead || null,
                defaultReviewerUserId: reviewer || null,
                agreementReference: agreement || null,
                startedOn: startedOn || null,
                customFields: addedFields.payload(),
                typeKey: addedFields.typeKey,
              })
            }}
          >
            <Field label={t('projects.projectsPage.form.name')}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
                placeholder={t('projects.projectsPage.form.namePlaceholder')}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('projects.projectsPage.columns.client')}>
                <PickerSelect
                  noun="client"
                  value={clientId}
                  onChange={(id) => setClientId(id)}
                  clearLabel="Internal"
                  options={clientOptions.map((c) => ({
                    id: c.id,
                    label: c.label,
                  }))}
                  footerOption={
                    canCreateClient
                      ? {
                          id: NEW_CLIENT,
                          label: t('projects.projectsPage.form.newClient'),
                        }
                      : undefined
                  }
                />
              </Field>
              {addingClient ? (
                <Field
                  label={t('projects.projectsPage.form.newClientName')}
                  className="col-span-2"
                >
                  <Input
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    required
                    placeholder={t(
                      'projects.projectsPage.form.newClientPlaceholder',
                    )}
                  />
                </Field>
              ) : null}
              <Field label={t('projects.projectsPage.columns.modality')}>
                <Select
                  value={modality}
                  onChange={(e) => setModality(e.target.value)}
                >
                  <option value="">—</option>
                  {modalities.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('projects.projectsPage.columns.stage')}>
                <Select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                >
                  <option value="">—</option>
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('projects.projectsPage.columns.lead')}>
                <PickerSelect
                  noun="person"
                  value={lead}
                  onChange={(id) => setLead(id)}
                  clearLabel="Not assigned"
                  options={memberOptions.map((member) =>
                    personOption(member.id, member.label),
                  )}
                />
              </Field>
            </div>
            <Field
              label={t('projects.projectsPage.form.defaultReviewer')}
              hint={t('projects.projectsPage.form.defaultReviewerHint')}
            >
              <PickerSelect
                noun="person"
                value={reviewer}
                onChange={(id) => setReviewer(id)}
                clearLabel="Not assigned"
                options={memberOptions.map((member) =>
                  personOption(member.id, member.label),
                )}
              />
            </Field>
            <Collapsible>
              <CollapsibleTrigger>
                {t('projects.projectsPage.form.agreementAndStart')}
              </CollapsibleTrigger>
              <CollapsiblePanel className="mt-3 grid grid-cols-2 gap-3">
                <Field label={t('projects.projectsPage.form.agreement')}>
                  <Input
                    value={agreement}
                    onChange={(e) => setAgreement(e.target.value)}
                  />
                </Field>
                <Field label={t('projects.projectsPage.form.startDate')}>
                  <Input
                    type="date"
                    value={startedOn}
                    onChange={(e) => setStartedOn(e.target.value)}
                  />
                </Field>
              </CollapsiblePanel>
            </Collapsible>
            {error ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {error}
              </p>
            ) : null}
            <AddedFieldsFormSection draft={addedFields} showErrors={tried} />
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="new-project-form"
            disabled={
              creating ||
              !title.trim() ||
              (addingClient && !newClientName.trim())
            }
          >
            {creating
              ? t('projects.projectsPage.form.creating')
              : t('projects.projectsPage.form.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
