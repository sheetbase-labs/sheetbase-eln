import { t } from '#/copy'
import { PickerSelect } from '#/components/record-picker/entity-picker'

import { Notice } from '#/components/ui/alert'
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
import { useSheetPromote } from './sheet-promote-controller'
import type {
  SheetPromoteLocalField,
  SheetPromoteProps,
} from './sheet-promote-controller'

export type { SheetPromoteLocalField } from './sheet-promote-controller'

const TYPE_LABELS = new Map(
  Object.entries({
    text: t('notebook.sheetPromote.text'),
    integer: t('notebook.sheetPromote.numberWhole'),
    decimal: t('notebook.sheetPromote.number'),
    boolean: t('notebook.sheetPromote.yesNo'),
    date: t('notebook.sheetPromote.date'),
    timestamp: t('notebook.sheetPromote.dateAndTime'),
    category: t('notebook.sheetPromote.choice'),
    reference: t('notebook.sheetPromote.reference'),
  }),
)

/**
 * SHEET-02.3 — the Promote local columns dialog (canvas/SheetPromote).
 *
 * A local column becomes a dataset column only through a reviewed request. The
 * dialog names the target Dataset Schema Definition, shows the field type and
 * unit that will be added, and takes a reason. It submits through
 * `request_column_promotion` — never the direct `promote_local_field` path —
 * so nothing is written to the dataset until the MDL-03 approval is granted.
 */
export function SheetPromote(props: SheetPromoteProps) {
  const {
    field,
    trigger = true,
    triggerLabel = t('notebook.sheetPromote.promoteColumn'),
  } = props

  const {
    open,
    setOpen,
    definitionId,
    setDefinitionId,
    reason,
    setReason,
    busy,
    error,
    definitions,
    submit,
  } = useSheetPromote(props)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <Button onClick={() => setOpen(true)}>{triggerLabel}</Button>
      ) : null}
      <DialogContent className="w-[min(680px,calc(100vw-32px))]">
        <DialogHeader
          title={t('notebook.sheetPromote.title', { label: field.label })}
          description={t('notebook.sheetPromote.description')}
        />
        <DialogBody>
          <Field label={t('notebook.sheetPromote.label')} required>
            <PickerSelect
              noun="dataset schema"
              value={definitionId}
              onChange={(id) => setDefinitionId(id)}
              disabled={definitions.isPending || definitions.isError}
              placeholder={
                definitions.isPending
                  ? t('notebook.sheetPromote.loadingSchemas')
                  : t('notebook.sheetPromote.chooseADatasetSchema')
              }
              options={(definitions.data ?? []).map((definition) => ({
                id: definition.id,
                label: definition.name,
              }))}
            />
          </Field>
          {definitions.isError ? (
            <Notice
              tone="bad"
              title={t('notebook.sheetPromote.couldNotLoadDatasetTitle')}
              action={
                <Button onClick={() => void definitions.refetch()}>
                  {t('common.actions.tryAgain')}
                </Button>
              }
            >
              {t('notebook.sheetPromote.checkYourWorkspaceConnection')}
            </Notice>
          ) : definitions.isSuccess && !definitions.data.length ? (
            <Notice
              title={t('notebook.sheetPromote.noDatasetSchemaDefinitionsTitle')}
            >
              {t('notebook.sheetPromote.askAStewardTo')}
            </Notice>
          ) : null}
          <table className="w-full border-collapse text-label">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  {t('notebook.sheetPromote.localColumn')}
                </th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  {t('notebook.sheetPromote.newField')}
                </th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  {t('notebook.sheetPromote.type')}
                </th>
                <th className="border-b border-border-subtle py-1.5 font-medium">
                  {t('notebook.sheetPromote.unit')}
                </th>
              </tr>
            </thead>
            <tbody>
              <PromoteFieldRow field={field} />
            </tbody>
          </table>
          <Field
            label={t('notebook.sheetPromote.reasonLabel')}
            required
            hint={t('notebook.sheetPromote.hint')}
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('notebook.sheetPromote.placeholder')}
            />
          </Field>
          <Notice
            tone="info"
            title={t('notebook.sheetPromote.whatHappensNextTitle')}
          >
            {t('notebook.sheetPromote.aDraftSchemaVersion')}
          </Notice>
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={
              busy ||
              definitions.isPending ||
              definitions.isError ||
              !definitions.data.length
            }
            onClick={submit}
          >
            {busy
              ? t('notebook.sheetPromote.requesting')
              : t('notebook.sheetPromote.requestPromotion')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PromoteFieldRow({ field }: { field: SheetPromoteLocalField }) {
  return (
    <tr>
      <td className="border-b border-border-subtle py-1.5 pr-2">
        {field.label}
      </td>
      <td className="border-b border-border-subtle py-1.5 pr-2 font-mono">
        {field.key}
      </td>
      <td className="border-b border-border-subtle py-1.5 pr-2">
        {TYPE_LABELS.get(field.logicalType) ?? field.logicalType}
      </td>
      <td className="border-b border-border-subtle py-1.5">
        {field.quantity?.preferredDisplayUnit ??
          field.quantity?.storageUnit ??
          '—'}
      </td>
    </tr>
  )
}
