/**
 * The materials registry's write surfaces: the forms that collect a lot, a
 * receipt and a replacement, and the dialogs that host them.
 */
import { useState } from 'react'

import {
  FillFromText,
  addedFillFields,
} from '#/components/assist/fill-from-text'
import { onlyIsoDate } from '#/lib/assist-fill'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Textarea } from '#/components/inventory/list'
import { RequestReorderDialog } from '#/components/materials/reagent-orders'
import { MakeSolutionDialog } from '#/components/materials/make-solution-dialog'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
} from '#/components/models/added-fields'
import type { MaterialListRow } from '#/components/materials/materials-data'
import { t } from '#/copy'

import { todayISO } from './-materials-page-model'
import type { RegisterLotInput } from './-materials-page-data'

/** Registers a lot, its properties and any subtype fields in one form. */
export function RegisterLotForm({
  busy,
  projects,
  onSubmit,
}: {
  busy: boolean
  projects: Map<string, string>
  onSubmit: (input: RegisterLotInput) => void
}): React.ReactElement {
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [supplier, setSupplier] = useState('')
  const [catalogNo, setCatalogNo] = useState('')
  const [lot, setLot] = useState('')
  const [expiry, setExpiry] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [storage, setStorage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const addedFields = useAddedFieldDraft('material')
  const [tried, setTried] = useState(false)

  const fillFields = [
    { key: 'name', label: t('library.materials.page.material') },
    { key: 'supplier', label: t('library.materials.page.supplier') },
    { key: 'catalogNo', label: t('library.materials.page.catalogueNo') },
    { key: 'lot', label: t('library.materials.page.lotNumber') },
    {
      key: 'expiry',
      label: t('library.materials.page.expiry'),
      hint: t('library.fill.hintDate'),
    },
    {
      key: 'quantity',
      label: t('library.materials.page.quantity'),
      hint: t('library.fill.hintNumber'),
    },
    { key: 'unit', label: t('library.materials.page.unit') },
    {
      key: 'storage',
      label: t('library.materials.page.storageLocation'),
    },
    ...addedFillFields(addedFields.fields),
  ]

  return (
    <form
      id="register-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)
        const next: Record<string, string> = {}

        if (!projectId)
          next.project = t('library.materials.page.chooseTheProjectThatOwns')

        if (!title.trim())
          next.title = t('library.materials.page.enterTheMaterialName')

        if (quantity.trim() === '' || !Number.isFinite(n) || n <= 0)
          next.quantity = t('library.materials.page.enterAQuantityGreaterThan')

        if (expiry && expiry < todayISO())
          next.expiry = t('library.materials.page.theExpiryMustBeToday')
        setErrors(next)
        setTried(true)

        if (Object.keys(next).length || !addedFields.valid) return
        onSubmit({
          projectId,
          title: title.trim(),
          supplier: supplier.trim() || undefined,
          catalogNo: catalogNo.trim() || undefined,
          lot: lot.trim() || undefined,
          expiry: expiry || undefined,
          quantity: n,
          unit: unit.trim() || undefined,
          storage: storage.trim() || undefined,
          customFields: addedFields.rootPayload(),
          typeKey: addedFields.typeKey,
          typeFields: addedFields.payload(),
        })
      }}
    >
      <FillFromText
        fields={fillFields}
        onFill={(values) => {
          if (values.name) setTitle(values.name)

          if (values.supplier) setSupplier(values.supplier)

          if (values.catalogNo) setCatalogNo(values.catalogNo)

          if (values.lot) setLot(values.lot)

          if (values.expiry && onlyIsoDate(values.expiry))
            setExpiry(values.expiry)

          if (values.quantity && Number.isFinite(Number(values.quantity)))
            setQuantity(values.quantity)

          if (values.unit) setUnit(values.unit)

          if (values.storage) setStorage(values.storage)

          for (const [key, value] of Object.entries(values)) {
            if (key.startsWith('field:'))
              addedFields.setValue(key.slice(6), value)
          }
        }}
      />
      <Field
        label={t('library.materials.page.project')}
        required
        error={errors.project}
      >
        <Select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={busy}
        >
          <option value="">{t('library.materials.page.choose')}</option>
          {[...projects].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t('library.materials.page.material')}
        required
        error={errors.title}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('library.materials.page.supplier')}>
          <Input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.page.catalogueNo')}>
          <Input
            value={catalogNo}
            onChange={(e) => setCatalogNo(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.page.lotNumber')}>
          <Input
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.page.expiry')} error={errors.expiry}>
          <Input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field
          label={t('library.materials.page.quantity')}
          required
          error={errors.quantity}
        >
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.page.unit')}>
          <Input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            disabled={busy}
          />
        </Field>
      </div>
      <Field label={t('library.materials.page.storageLocation')}>
        <Input
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
          disabled={busy}
        />
      </Field>
      <AddedFieldsFormSection draft={addedFields} showErrors={tried} />
    </form>
  )
}

/** A replacement lot: its own number, expiry, quantity and why. */
export function ReplacementForm({
  busy,
  unit,
  onSubmit,
}: {
  busy: boolean
  unit: string | null
  onSubmit: (input: {
    lot: string
    expiry: string
    quantity: number
    unit?: string
    reason?: string
  }) => void
}): React.ReactElement {
  const [lot, setLot] = useState('')
  const [expiry, setExpiry] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitValue, setUnitValue] = useState(unit ?? '')
  const [reason, setReason] = useState('')
  const [lotError, setLotError] = useState<string | null>(null)
  const [expiryError, setExpiryError] = useState<string | null>(null)
  const [quantityError, setQuantityError] = useState<string | null>(null)

  return (
    <form
      id="replacement-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)

        // A refused submission states why: the form never returns silently.
        const lotProblem = lot.trim()
          ? null
          : t('library.materials.page.enterTheReplacementLot')

        const expiryProblem = !expiry
          ? t('library.materials.page.enterTheReplacementLotsExpiry')
          : expiry < todayISO()
            ? t('library.materials.page.theExpiryMustBeToday')
            : null

        const quantityProblem =
          quantity.trim() === '' || !Number.isFinite(n) || n <= 0
            ? t('library.materials.page.enterAQuantityGreaterThan')
            : null

        setLotError(lotProblem)
        setExpiryError(expiryProblem)
        setQuantityError(quantityProblem)

        if (lotProblem || expiryProblem || quantityProblem) return
        onSubmit({
          lot: lot.trim(),
          expiry,
          quantity: n,
          unit: unitValue.trim() || undefined,
          reason: reason.trim() || undefined,
        })
      }}
    >
      <Field
        label={t('library.materials.page.lotNumber')}
        required
        error={lotError}
      >
        <Input
          value={lot}
          aria-invalid={lotError !== null}
          onChange={(e) => {
            setLot(e.target.value)
            setLotError(null)
          }}
          autoFocus
          disabled={busy}
        />
      </Field>
      <Field
        label={t('library.materials.page.expiry')}
        required
        error={expiryError}
      >
        <Input
          type="date"
          value={expiry}
          aria-invalid={expiryError !== null}
          onChange={(e) => {
            setExpiry(e.target.value)
            setExpiryError(null)
          }}
          disabled={busy}
        />
      </Field>
      <Field
        label={t('library.materials.page.quantity')}
        required
        error={quantityError}
      >
        <Input
          type="number"
          value={quantity}
          aria-invalid={quantityError !== null}
          onChange={(e) => {
            setQuantity(e.target.value)
            setQuantityError(null)
          }}
          disabled={busy}
        />
      </Field>
      <Field label={t('library.materials.page.unit')}>
        <Input
          value={unitValue}
          onChange={(e) => setUnitValue(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Field label={t('library.materials.page.reason')}>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}

/** Receives stock into the open lot. */
export function ReceiveForm({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (input: { quantity: number; reason?: string }) => void
}): React.ReactElement {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [quantityError, setQuantityError] = useState<string | null>(null)

  return (
    <form
      id="receive-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)

        // A refused submission states why: the form never returns silently. The
        // browser empties a number field that holds letters, so an empty value
        // is the same refusal as a zero.
        if (quantity.trim() === '' || !Number.isFinite(n) || n <= 0) {
          setQuantityError(
            t('library.materials.page.enterTheQuantityReceivedGreater'),
          )

          return
        }

        setQuantityError(null)
        onSubmit({ quantity: n, reason: reason || undefined })
      }}
    >
      <Field
        label={t('library.materials.page.quantity')}
        required
        error={quantityError}
      >
        <Input
          type="number"
          value={quantity}
          aria-invalid={quantityError !== null}
          onChange={(e) => {
            setQuantity(e.target.value)
            setQuantityError(null)
          }}
          autoFocus
          disabled={busy}
        />
      </Field>
      <Field label={t('library.materials.page.reason')}>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}

/** Every dialog the list opens: reorder, receive, solution, register,
 * replacement and quarantine. */
export function MaterialsDialogs({
  sel,
  projects,
  reorderOpen,
  onReorderOpenChange,
  receiveOpen,
  onReceiveOpenChange,
  receiveBusy,
  onReceive,
  solutionOpen,
  onSolutionOpenChange,
  registerOpen,
  onRegisterOpenChange,
  registerBusy,
  onRegister,
  replacementOpen,
  onReplacementOpenChange,
  replacementBusy,
  onReplacement,
  quarantineOpen,
  onQuarantineOpenChange,
  quarantineReason,
  onQuarantineReasonChange,
  quarantineBusy,
  onQuarantine,
}: {
  sel: MaterialListRow | undefined
  projects: Map<string, string>
  reorderOpen: boolean
  onReorderOpenChange: (open: boolean) => void
  receiveOpen: boolean
  onReceiveOpenChange: (open: boolean) => void
  receiveBusy: boolean
  onReceive: (input: { quantity: number; reason?: string }) => void
  solutionOpen: boolean
  onSolutionOpenChange: (open: boolean) => void
  registerOpen: boolean
  onRegisterOpenChange: (open: boolean) => void
  registerBusy: boolean
  onRegister: (input: RegisterLotInput) => void
  replacementOpen: boolean
  onReplacementOpenChange: (open: boolean) => void
  replacementBusy: boolean
  onReplacement: (input: {
    lot: string
    expiry: string
    quantity: number
    unit?: string
    reason?: string
  }) => void
  quarantineOpen: boolean
  onQuarantineOpenChange: (open: boolean) => void
  quarantineReason: string
  onQuarantineReasonChange: (reason: string) => void
  quarantineBusy: boolean
  onQuarantine: () => void
}): React.ReactElement {
  return (
    <>
      <RequestReorderDialog
        open={reorderOpen}
        onOpenChange={onReorderOpenChange}
        material={
          sel
            ? { uuid: sel.uuid, id: sel.id, name: sel.name, unit: sel.unit }
            : undefined
        }
      />

      <Dialog open={receiveOpen} onOpenChange={onReceiveOpenChange}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.materials.page.receiveLot')}
            description={sel ? `${sel.id} · ${sel.name}` : undefined}
          />
          <DialogBody>
            <ReceiveForm busy={receiveBusy} onSubmit={onReceive} />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="receive-lot-form"
              disabled={receiveBusy}
            >
              {receiveBusy
                ? t('library.materials.page.receiving')
                : t('library.materials.page.receive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MakeSolutionDialog
        open={solutionOpen}
        onOpenChange={onSolutionOpenChange}
      />

      <Dialog open={registerOpen} onOpenChange={onRegisterOpenChange}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.materials.page.registerMaterialLot')}
          />
          <DialogBody>
            <RegisterLotForm
              busy={registerBusy}
              projects={projects}
              onSubmit={onRegister}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="register-lot-form"
              disabled={registerBusy}
            >
              {registerBusy
                ? t('library.materials.page.registering')
                : t('library.materials.page.register')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replacementOpen} onOpenChange={onReplacementOpenChange}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.materials.page.registerReplacementLot')}
            description={sel ? `${sel.id} · ${sel.name}` : undefined}
          />
          <DialogBody>
            <ReplacementForm
              busy={replacementBusy}
              unit={sel?.unit ?? null}
              onSubmit={onReplacement}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="replacement-lot-form"
              disabled={replacementBusy}
            >
              {replacementBusy
                ? t('library.materials.page.registering')
                : t('library.materials.page.register')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={quarantineOpen}
        onOpenChange={onQuarantineOpenChange}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('library.materials.page.quarantineThisLot')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {sel ? `${sel.id} · ${sel.name}. ` : ''}
              {t('library.materials.page.aQuarantinedLotIsHeld')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <Textarea
            className="mx-5 my-3 box-border min-h-[70px] w-[calc(100%-2.5rem)]"
            placeholder={t('library.materials.page.whyIsThisLotHeld')}
            value={quarantineReason}
            onChange={(event) => onQuarantineReasonChange(event.target.value)}
          />
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={quarantineBusy}
              onClick={onQuarantine}
            >
              {quarantineBusy
                ? t('library.materials.page.quarantining')
                : t('library.materials.page.quarantine')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}
