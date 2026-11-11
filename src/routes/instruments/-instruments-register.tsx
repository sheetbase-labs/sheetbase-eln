/**
 * "Register instrument": the New instrument form, its own draft fields, and
 * the canonical RPC that turns them into a model record.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Choice } from '#/components/ui/choice'
import { RadioGroup } from '#/components/ui/radio-group'
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/ui/dialog'
import {
  INTAKE_METHODS,
  createInstrument,
  intakeMethodNeedsParser,
} from '#/components/instruments/instruments-data'
import type { IntakeMethod } from '#/components/instruments/instruments-data'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
} from '#/components/models/added-fields'
import { instrumentTypeLabel } from '#/lib/instrument-type-label'
import { notebookDataClient } from '#/lib/notebook-data'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import { intakeMethodOf } from './-instruments-model'

const INSTRUMENT_MODEL = requireBuiltInModel('instrument')

/** The New instrument form's own fields, before they become a model record. */
interface InstrumentDraft {
  name: string
  type: string
  make: string
  model: string
  serial: string
  location: string
  method: IntakeMethod
}

export function RegisterInstrument({
  types,
  workspaceId,
  ownerId,
  autoOpen = false,
  onAutoOpened,
}: {
  types: string[]
  workspaceId: string
  ownerId: string
  autoOpen?: boolean
  onAutoOpened?: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // The shell's New menu arrives with `?new=true`: the page that owns the flag
  // asks for the dialog to open once, then drops the flag.
  useEffect(() => {
    if (!autoOpen) return
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- The flag is a one-shot request from the shell's New menu: the page that owns it drops it in onAutoOpened, so this is not state that should follow a prop.
    setOpen(true)
    onAutoOpened?.()
  }, [autoOpen, onAutoOpened])
  const [tried, setTried] = useState(false)

  // A refusal usually belongs to the form, not to one field: only a serial clash is
  // about the serial number, everything else (permission, workspace) shows at the top.
  const [serverError, setServerError] = useState<{
    field: 'serial' | null
    message: string
  } | null>(null)

  const empty: InstrumentDraft = {
    name: '',
    type: 'qpcr',
    make: '',
    model: '',
    serial: '',
    location: '',
    method: 'filedrop',
  }

  const [f, setF] = useState(empty)

  const errors = {
    name:
      f.name.trim().length < 2
        ? t('library.instruments.list.enterTheNameOnThe')
        : null,
    model: !f.model.trim() ? t('library.instruments.list.enterTheModel') : null,
    serial: !f.serial.trim()
      ? t('library.instruments.list.enterTheSerialNumberFrom')
      : serverError?.field === 'serial'
        ? serverError.message
        : null,
    location: !f.location.trim()
      ? t('library.instruments.list.enterWhereItSitsE')
      : null,
  }

  const err = (k: keyof typeof errors) =>
    tried || (k === 'serial' && serverError?.field === 'serial')
      ? errors[k]
      : null

  const addedFields = useAddedFieldDraft('instrument')

  const create = useMutation({
    mutationFn: async () => {
      const row = await createInstrument({
        workspaceId,
        name: f.name.trim(),
        instrumentType: f.type,
        intakeMethod: f.method,
        model: f.model.trim() || null,
        serialNumber: f.serial.trim() || null,
        vendor: f.make.trim() || null,
        location: f.location.trim() || null,
        ownerId,
      })

      const typed = await saveNewObjectFields(
        notebookDataClient,
        INSTRUMENT_MODEL,
        row.id,
        addedFields.typeKey,
        addedFields.payload(),
      )

      return { ...row, displayId: typed.identifier ?? row.displayId }
    },
    onSuccess: (row) => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      setOpen(false)
      setF(empty)
      setTried(false)
      toast(`${f.name.trim()} registered`, {
        description:
          f.method === 'filedrop'
            ? t('library.instruments.list.createdAttachAValidatedParser', {
                name: row.displayId ?? 'the instrument',
              })
            : f.method === 'webhook'
              ? t('library.instruments.list.createdAttachAValidatedParser2', {
                  name: row.displayId ?? 'the instrument',
                })
              : f.method === 'manual'
                ? t('library.instruments.list.createdReadingsAreTypedIn', {
                    name: row.displayId ?? 'the instrument',
                  })
                : t('library.instruments.list.createdNoDataWillArrive', {
                    name: row.displayId ?? 'the instrument',
                  }),
      })
      // Land on the new instrument, where parser, calibration and intake are set up.
      void navigate({
        to: '/instruments/$instrumentId',
        params: { instrumentId: row.id },
      })
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e)
      setServerError(
        message.includes('serial')
          ? {
              field: 'serial',
              message: t('library.instruments.list.anInstrumentWithThisSerial'),
            }
          : {
              field: null,
              message: t(
                'library.instruments.list.couldNotRegisterTheInstrument',
              ),
            },
      )
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)

        if (!o) {
          setF(empty)
          setTried(false)
          setServerError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="primary" icon="plus" />}>
        {t('library.instruments.list.registerInstrument')}
      </DialogTrigger>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.list.registerInstrument')}
          description={
            intakeMethodNeedsParser(f.method)
              ? t('library.instruments.list.itCanBeBookedRight')
              : t('library.instruments.list.itCanBeBookedAnd')
          }
        />
        <DialogBody>
          {serverError && !serverError.field ? (
            <Notice tone="bad" title={serverError.message} />
          ) : null}
          <Field
            label={t('library.instruments.list.name')}
            required
            error={err('name')}
          >
            <Input
              autoFocus
              value={f.name}
              aria-invalid={err('name') ? true : undefined}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder={t('library.instruments.list.eGOsmometerOs02')}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('library.instruments.list.type')} required>
              <Select
                value={f.type}
                onChange={(e) => setF({ ...f, type: e.target.value })}
              >
                {(types.length
                  ? types
                  : ['qpcr', 'sequencer', 'spectrophotometer', 'other']
                ).map((item) => (
                  <option key={item} value={item}>
                    {instrumentTypeLabel(item)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('library.instruments.list.make')}
              hint={t('common.states.optional')}
            >
              <Input
                value={f.make}
                onChange={(e) => setF({ ...f, make: e.target.value })}
              />
            </Field>
            <Field
              label={t('library.instruments.list.model')}
              required
              error={err('model')}
            >
              <Input
                value={f.model}
                aria-invalid={err('model') ? true : undefined}
                onChange={(e) => setF({ ...f, model: e.target.value })}
              />
            </Field>
            <Field
              label={t('library.instruments.list.serialNumber')}
              required
              error={err('serial')}
            >
              <Input
                className="mono"
                value={f.serial}
                aria-invalid={err('serial') ? true : undefined}
                onChange={(e) => {
                  setF({ ...f, serial: e.target.value })
                  setServerError(null)
                }}
              />
            </Field>
          </div>
          <Field
            label={t('library.instruments.list.location')}
            required
            error={err('location')}
          >
            <Input
              value={f.location}
              aria-invalid={err('location') ? true : undefined}
              onChange={(e) => setF({ ...f, location: e.target.value })}
              placeholder={t('library.instruments.list.eGLab2Bench')}
            />
          </Field>
          <RadioGroup
            aria-label={t('library.instruments.list.howDataGetsIn')}
            value={f.method}
            onValueChange={(chosen) => {
              const named = z.string().safeParse(chosen)

              const method = named.success
                ? intakeMethodOf(named.data)
                : undefined

              if (method) setF({ ...f, method })
            }}
          >
            <span className="text-label font-medium text-fg">
              {t('library.instruments.list.howDataGetsIn')}
            </span>
            {INTAKE_METHODS.map((method) => (
              <Choice
                key={method.value}
                value={method.value}
                title={method.title}
              >
                {method.consequence}
              </Choice>
            ))}
          </RadioGroup>
          <AddedFieldsFormSection draft={addedFields} showErrors={tried} />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setTried(true)

              if (Object.values(errors).some(Boolean) || !addedFields.valid)
                return
              create.mutate()
            }}
          >
            {create.isPending
              ? t('library.instruments.list.registering')
              : t('library.instruments.list.registerInstrument')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
