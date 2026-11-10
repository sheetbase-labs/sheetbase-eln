import { useState } from 'react'

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
import { Textarea } from '#/components/inventory/list'
import { t } from '#/copy'
import { modelCreateErrors } from './model-create-validation'
import type { ModelCreateInput } from './model-create-validation'

/**
 * The Models board's create affordance, ported from the design: the reference
 * board has a primary "New model" header action
 * (`tests/visual/design-reference/SchemasList-light.png`) opening a "New model"
 * dialog whose primary action is "Create draft"
 * (`sheetbase-app-ui-only/src/routes/_app/models/index.tsx`, `NewModel`).
 *
 * The capture choice selects a canonical creation RPC, not a cosmetic tag:
 * record types require their own identifier prefix; measurement tables create
 * Dataset Schema definitions. Both require schema.edit and begin as drafts.
 */

interface ModelCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: ModelCreateInput) => void
  creating: boolean
  error: string | null
}

function useModelCreateDraft(onCreate: ModelCreateDialogProps['onCreate']) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'record' | 'dataset'>('dataset')
  const [identifierPrefix, setIdentifierPrefix] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const errors = modelCreateErrors({ key, name, description })
  // A field stays quiet until it holds something or a create was attempted, so
  // the dialog does not open shouting at an empty form.
  const showKey = submitted || key.length > 0
  const showName = submitted || name.length > 0
  const showDescription = submitted || description.length > 0

  const prefixError =
    kind === 'record' && !/^[A-Z][A-Z0-9]{0,7}$/.test(identifierPrefix.trim())
      ? t('library.models.modelCreateDialog.use18UpperCase')
      : null

  const invalid = Object.keys(errors).length > 0 || Boolean(prefixError)

  function submit() {
    setSubmitted(true)

    if (invalid) return

    const input: ModelCreateInput = {
      key: key.trim(),
      name: name.trim(),
      description: description.trim() || null,
      kind,
    }

    if (kind === 'record') input.identifierPrefix = identifierPrefix.trim()
    onCreate(input)
  }

  function reset() {
    setKey('')
    setName('')
    setDescription('')
    setKind('dataset')
    setIdentifierPrefix('')
    setSubmitted(false)
  }

  return {
    key,
    setKey,
    name,
    setName,
    description,
    setDescription,
    kind,
    setKind,
    identifierPrefix,
    setIdentifierPrefix,
    submitted,
    errors,
    showKey,
    showName,
    showDescription,
    prefixError,
    submit,
    reset,
  }
}

export function ModelCreateDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
  error,
}: ModelCreateDialogProps) {
  const {
    key,
    setKey,
    name,
    setName,
    description,
    setDescription,
    kind,
    setKind,
    identifierPrefix,
    setIdentifierPrefix,
    submitted,
    errors,
    showKey,
    showName,
    showDescription,
    prefixError,
    submit,
    reset,
  } = useModelCreateDraft(onCreate)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)

        if (!next) reset()
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.models.modelCreateDialog.newModel')}
          description={t(
            'library.models.modelCreateDialog.chooseWhatYouNeedTo',
          )}
        />
        <DialogBody>
          <form
            id="new-model-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Field
              label={t('library.models.modelCreateDialog.captureStructure')}
              hint={
                kind === 'record'
                  ? t(
                      'library.models.modelCreateDialog.identifiableEntitiesSuchAsCell',
                    )
                  : t(
                      'library.models.modelCreateDialog.rowsOfObservationsSuchAs',
                    )
              }
            >
              <Select
                value={kind}
                onChange={(event) =>
                  setKind(
                    event.target.value === 'record' ? 'record' : 'dataset',
                  )
                }
              >
                <option value="dataset">
                  {t(
                    'library.models.modelCreateDialog.measurementTableDatasetSchema',
                  )}
                </option>
                <option value="record">
                  {t('library.models.modelCreateDialog.recordTypeRecordModel')}
                </option>
              </Select>
            </Field>
            {kind === 'record' ? (
              <Field
                label={t('library.models.modelCreateDialog.recordIdPrefix')}
                required
                error={
                  submitted || identifierPrefix
                    ? (prefixError ?? undefined)
                    : undefined
                }
                hint={t(
                  'library.models.modelCreateDialog.uniqueInThisWorkspaceE',
                )}
              >
                <Input
                  value={identifierPrefix}
                  maxLength={8}
                  placeholder={t('library.models.modelCreateDialog.cb')}
                  onChange={(event) =>
                    setIdentifierPrefix(event.target.value.toUpperCase())
                  }
                />
              </Field>
            ) : null}
            <Field
              label={t('library.models.modelCreateDialog.key')}
              required
              hint={t(
                'library.models.modelCreateDialog.lowerCaseLettersDigitsAnd',
              )}
              error={showKey ? errors.key : undefined}
            >
              <Input
                autoFocus
                className="mono"
                value={key}
                aria-invalid={showKey && errors.key ? true : undefined}
                placeholder="cell_bank_reading"
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.models.modelCreateDialog.name')}
              required
              error={showName ? errors.name : undefined}
            >
              <Input
                value={name}
                placeholder={t(
                  'library.models.modelCreateDialog.eGCellBankReading',
                )}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.models.modelCreateDialog.description')}
              hint={t('common.states.optional')}
              error={showDescription ? errors.description : undefined}
            >
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {error ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {error}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="new-model-form"
            disabled={creating}
          >
            {creating
              ? t('library.models.modelCreateDialog.creating')
              : t('library.models.modelCreateDialog.createDraft')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
