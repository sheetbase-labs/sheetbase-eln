import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { personOption } from '#/components/record-picker/entity-options'
import { Checkbox } from '#/components/ui/checkbox'
import { AddedFieldsFormSection } from '#/components/models/added-fields'
import { cancelTarget } from '#/lib/create-context-search'
import { t } from '#/copy'

import type { NewExperimentFormModel } from './-new-experiment-form-model'
import { copyFromSearch, createErrorMessage } from './-new-experiment-form-data'
import { FormNotes } from './-new-experiment-form-notes'

/** A new experiment's inputs as the form has them, from the model. */
type Form = NewExperimentFormModel

/** The project picker, and what the linking page handed over about it. */
export function ProjectFieldSection({ form }: { form: Form }) {
  return (
    <>
      <Field
        label={t('projects.newExperiment.project')}
        required
        error={form.project.projectError}
        hint={form.project.projectHint}
      >
        <PickerSelect
          noun="project"
          value={form.project.effectiveProjectId}
          onChange={(id) => form.setProjectId(id)}
          disabled={
            form.sources.projects.isLoading ||
            form.accessPending ||
            form.rows.length === 0
          }
          placeholder={form.project.projectPlaceholder}
          options={form.project.projectOptions}
        />
      </Field>
      {form.project.projectReplaced ? (
        <Muted>
          {t('projects.newExperiment.replaced', {
            title: form.project.effectiveProject?.title ?? '',
          })}
        </Muted>
      ) : null}
      {form.sources.series.data ? (
        <Muted>
          {t('projects.newExperiment.joinsSeries', {
            identifier: form.sources.series.data.identifier,
            title: form.sources.series.data.title,
          })}
        </Muted>
      ) : null}
      {form.sources.sample.data ? (
        <Muted>
          {t('projects.newExperiment.sampleLinked', {
            identifier: form.sources.sample.data.identifier,
            title: form.sources.sample.data.title,
          })}
        </Muted>
      ) : null}
    </>
  )
}

/** The title, reviewer and planned end, and any fields the model adds. */
export function DetailsFieldSection({ form }: { form: Form }) {
  return (
    <>
      <Field
        label={t('projects.newExperiment.titleLabel')}
        required
        error={form.titleError}
        hint={t('projects.newExperiment.titleHint')}
      >
        <Input
          value={form.title}
          onChange={(e) => form.setTitle(e.target.value)}
          autoFocus
          aria-invalid={Boolean(form.titleError) || undefined}
        />
      </Field>
      <Field
        label={t('projects.newExperiment.reviewer')}
        hint={
          form.reviewerId === null && form.effectiveReviewerId
            ? t('projects.newExperiment.reviewerDefault')
            : t('projects.newExperiment.reviewerHint')
        }
      >
        <PickerSelect
          noun="person"
          value={form.effectiveReviewerId}
          onChange={(id) => form.setReviewerId(id)}
          clearLabel="No reviewer yet"
          options={(form.members.data ?? []).map((m) =>
            personOption(m.user_id, m.name, m.role),
          )}
        />
      </Field>
      <Field
        label={t('projects.newExperiment.plannedEnd')}
        hint={t('projects.newExperiment.plannedEndHint')}
      >
        <Input
          type="date"
          value={form.plannedEnd}
          onChange={(e) => form.setPlannedEnd(e.target.value)}
        />
      </Field>
      <AddedFieldsFormSection
        draft={form.addedFields}
        showErrors={form.touched}
      />
    </>
  )
}

/** Start now, the protocol acknowledgement it asks for, and the copy-from picker. */
export function StartOptionsSection({ form }: { form: Form }) {
  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 text-label">
        <Checkbox
          checked={form.startNow}
          onCheckedChange={(on) => form.setStartNow(Boolean(on))}
        />
        {t('projects.newExperiment.startNow')}
      </label>
      {form.start.needsAcknowledgement ? (
        <Field
          label={t('projects.newExperiment.acknowledgement')}
          error={
            form.touched && !form.acknowledged
              ? t('projects.newExperiment.acknowledgeError')
              : undefined
          }
        >
          <label className="flex cursor-pointer items-center gap-2 text-label">
            <Checkbox
              checked={form.acknowledged}
              onCheckedChange={(on) => form.setAcknowledged(Boolean(on))}
            />
            {t('projects.newExperiment.acknowledge')}
          </label>
        </Field>
      ) : null}
      <Field
        label={t('projects.newExperiment.copyFrom')}
        hint={t('projects.newExperiment.copyHint')}
      >
        <PickerSelect
          noun="experiment"
          value={form.copyFromId}
          onChange={(id, option) => {
            form.setCopyFromId(id)
            form.setCopyFromOption(option)
          }}
          selected={form.copyFromOption}
          clearLabel="Nothing"
          search={copyFromSearch}
        />
      </Field>
    </>
  )
}

/** Create and cancel, followed by what the form's reads are doing. */
export function FormActionsSection({ form }: { form: Form }) {
  return (
    <>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={
            form.create.isPending ||
            form.accessPending ||
            !form.project.effectiveProjectId
          }
        >
          {form.createButtonLabel}
        </Button>
        <Button
          nativeButton={false}
          render={<Link to={cancelTarget(form.search, '/experiments')} />}
        >
          {t('common.actions.cancel')}
        </Button>
      </div>
      <FormNotes
        createError={
          form.create.error ? createErrorMessage(form.create.error) : undefined
        }
        projectsLoading={form.sources.projects.isLoading}
        projectsFailed={form.sources.projects.isError}
        onRetryProjects={() => void form.sources.projects.refetch()}
        accessPending={form.accessPending}
        accessFailed={form.sources.assignments.isError}
        onRetryAccess={() => void form.sources.assignments.refetch()}
        noProjects={
          form.rows.length === 0 &&
          !form.sources.projects.isLoading &&
          !form.sources.projects.isError
        }
        noUsableProject={
          form.accessKnown &&
          form.rows.length > 0 &&
          !form.project.effectiveProjectId
        }
      />
    </>
  )
}
