/**
 * The dialog that registers an entry or edits one. It asks for the fields of
 * its kind, reads a construct's sequence file to fingerprint it, and checks for
 * duplicates as the person types so a repeat is caught before it is saved.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Textarea } from '#/components/v3/inventory/list'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  DETAIL_FIELDS,
  PARENT_ROLES,
  REGISTRY_KINDS,
  createEntry,
  entryFingerprint,
  findDuplicates,
  isDuplicateError,
  messageOf,
  readSequence,
  registryKeys,
  updateEntry,
} from '#/lib/bio-registry'
import type {
  DuplicateMatch,
  ParentRole,
  RegistryEntry,
  RegistryKind,
} from '#/lib/bio-registry'
import { SEQUENCE_ACCEPT, parseSequenceFile } from '#/lib/sequence'

import { fieldLabel, kindLabel, roleLabel, valueLabel } from './registry-shared'

const client = notebookDataClient

interface ParentChoice {
  id: string
  role: ParentRole
}

/** The role a parent most likely plays for a new entry of this kind. */
function defaultRole(kind: RegistryKind): ParentRole {
  return kind === 'construct'
    ? 'vector'
    : kind === 'cell_line'
      ? 'parent'
      : 'parent'
}

function DetailInputs({
  kind,
  details,
  onChange,
  disabled,
}: {
  kind: RegistryKind
  details: Record<string, string>
  onChange: (key: string, value: string) => void
  disabled: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
      {DETAIL_FIELDS[kind].map((field) => (
        <Field
          key={field.key}
          label={fieldLabel(field.key)}
          hint={
            field.key === 'externalId'
              ? t('registry.fields.externalIdHint')
              : undefined
          }
        >
          {field.type === 'choice' ? (
            <Select
              value={details[field.key] ?? ''}
              disabled={disabled}
              onChange={(e) => onChange(field.key, e.target.value)}
            >
              <option value="">{t('registry.choices.none')}</option>
              {field.choices?.map((choice) => (
                <option key={choice} value={choice}>
                  {valueLabel(choice)}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={details[field.key] ?? ''}
              disabled={disabled}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          )}
        </Field>
      ))}
    </div>
  )
}

export function DuplicateNotice({
  kind,
  matches,
  acknowledged,
  onAcknowledge,
}: {
  kind: RegistryKind
  matches: DuplicateMatch[]
  acknowledged: boolean
  onAcknowledge: (value: boolean) => void
}) {
  const exact = matches.filter((m) => m.match === 'exact')
  const listed = exact.length > 0 ? exact : matches
  const entries = listed
    .map(
      (m) =>
        `${m.registryId} ${m.name}${m.status === 'retired' ? t('registry.duplicate.retiredNote') : ''}`,
    )
    .join(', ')
  return (
    <Notice
      tone="warn"
      title={
        exact.length > 0
          ? t('registry.duplicate.exactTitle')
          : t('registry.duplicate.nameTitle')
      }
    >
      <div className="flex flex-col gap-2">
        <p className="m-0">
          {exact.length > 0
            ? t(`registry.duplicate.exactBody.${kind}`, { entries })
            : t('registry.duplicate.nameBody', { entries })}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {listed.map((m) => (
            <Link
              key={m.id}
              to="/registry/$entryId"
              params={{ entryId: m.id }}
              className="text-link underline-offset-2 hover:underline"
            >
              {t('registry.duplicate.use', { number: m.registryId })}
            </Link>
          ))}
        </div>
        <label className="flex items-start gap-2 text-label">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => onAcknowledge(checked === true)}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="font-medium">
              {t('registry.duplicate.registerAnyway')}
            </span>
            <span className="text-fg-muted">
              {t('registry.duplicate.anywayHint')}
            </span>
          </span>
        </label>
      </div>
    </Notice>
  )
}

export function RegistryFormDialog({
  open,
  onOpenChange,
  entry,
  initialKind = 'construct',
  entries,
  fromEntry,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The entry being edited; absent when registering a new one. */
  entry?: RegistryEntry
  initialKind?: RegistryKind
  /** Every entry, for choosing where a new one came from. */
  entries: RegistryEntry[]
  /** A new entry that starts as derived from this one. */
  fromEntry?: RegistryEntry
  onSaved: (entry: RegistryEntry) => void
}) {
  const queryClient = useQueryClient()
  const editing = entry !== undefined
  const [kind, setKind] = useState<RegistryKind>(entry?.kind ?? initialKind)
  const [name, setName] = useState(entry?.name ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [details, setDetails] = useState<Record<string, string>>(
    entry?.details ?? {},
  )
  const [fingerprint, setFingerprint] = useState<string | null>(
    entry?.fingerprint ?? null,
  )
  const [parents, setParents] = useState<ParentChoice[]>(
    fromEntry ? [{ id: fromEntry.id, role: defaultRole(fromEntry.kind) }] : [],
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [sequenceError, setSequenceError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Start clean each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setKind(entry?.kind ?? fromEntry?.kind ?? initialKind)
    setName(entry?.name ?? '')
    setDescription(entry?.description ?? '')
    setDetails(entry?.details ?? {})
    setFingerprint(entry?.fingerprint ?? null)
    setParents(
      fromEntry
        ? [{ id: fromEntry.id, role: defaultRole(fromEntry.kind) }]
        : [],
    )
    setAcknowledged(false)
    setNameError(null)
    setSequenceError(null)
  }, [open, entry, fromEntry, initialKind])

  const effectiveFingerprint =
    kind === 'construct' ? fingerprint : entryFingerprint(kind, details)
  const [settledName, setSettledName] = useState(name)
  const [settledFingerprint, setSettledFingerprint] =
    useState(effectiveFingerprint)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettledName(name)
      setSettledFingerprint(effectiveFingerprint)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [name, effectiveFingerprint])

  const duplicates = useQuery({
    queryKey: [
      ...registryKeys.all,
      'duplicates',
      kind,
      settledName.trim().toLowerCase(),
      settledFingerprint,
      entry?.id ?? null,
    ],
    queryFn: () =>
      findDuplicates(client, {
        kind,
        name: settledName,
        fingerprint: settledFingerprint,
        excludeId: entry?.id ?? null,
      }),
    enabled: open && (settledName.trim() !== '' || settledFingerprint !== null),
    staleTime: 5_000,
  })
  const matches = useMemo(
    () => (duplicates.data ?? []).filter((m) => m.id !== entry?.id),
    [duplicates.data, entry?.id],
  )
  const blockedByDuplicate = !editing && matches.length > 0 && !acknowledged

  const candidates = useMemo(
    () => entries.filter((e) => e.id !== entry?.id),
    [entries, entry?.id],
  )

  const save = useMutation({
    mutationFn: async () => {
      const input = {
        name: name.trim(),
        description: description.trim() || null,
        details,
        fingerprint: effectiveFingerprint,
      }
      if (entry) return updateEntry(client, entry.id, input)
      return createEntry(
        client,
        {
          ...input,
          kind,
          parents: parents.filter((p) => p.id),
        },
        acknowledged,
      )
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      onOpenChange(false)
      onSaved(saved)
    },
    onError: (e: unknown) => {
      if (isDuplicateError(e)) {
        void duplicates.refetch()
        return
      }
      toast.error(messageOf(e, t('registry.form.couldNotSave')))
    },
  })

  async function chooseFile(file: File | undefined) {
    if (!file) return
    setReading(true)
    setSequenceError(null)
    try {
      const parsed = parseSequenceFile(await file.text())
      if (parsed.length === 0) throw new Error('')
      const first = parsed[0]
      const info = await readSequence(first)
      setFingerprint(info.fingerprint)
      setDetails((prev) => ({
        ...prev,
        seqMolecule: info.molecule,
        seqTopology: info.topology,
        seqLength: String(info.length),
        seqName: first.name,
      }))
      if (!name.trim()) setName(first.name)
      if (parsed.length > 1) {
        setSequenceError(
          t('registry.form.sequenceOnlyFirst', { count: parsed.length }),
        )
      }
    } catch (e) {
      setFingerprint(null)
      setSequenceError(
        t('registry.form.sequenceError', { message: messageOf(e, '') }),
      )
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function clearSequence() {
    setFingerprint(null)
    setSequenceError(null)
    setDetails((prev) => {
      const next = { ...prev }
      for (const key of [
        'seqMolecule',
        'seqTopology',
        'seqLength',
        'seqName',
      ]) {
        delete next[key]
      }
      return next
    })
  }

  const busy = save.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader
          title={
            editing
              ? t('registry.form.editTitle', { number: entry.registryId })
              : t('registry.form.registerTitle', {
                  kind: kindLabel(kind).toLowerCase(),
                })
          }
        />
        <DialogBody>
          <form
            id="registry-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) {
                setNameError(t('registry.form.nameRequired'))
                return
              }
              setNameError(null)
              save.mutate()
            }}
          >
            {!editing ? (
              <Field label={t('registry.form.kind')}>
                <Select
                  value={kind}
                  disabled={busy}
                  onChange={(e) => {
                    setKind(e.target.value as RegistryKind)
                    setDetails({})
                    setFingerprint(null)
                    setAcknowledged(false)
                  }}
                >
                  {REGISTRY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label={t('registry.form.name')} required error={nameError}>
              <Input
                value={name}
                placeholder={t(`registry.form.namePlaceholder.${kind}`)}
                aria-invalid={nameError !== null}
                disabled={busy}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError(null)
                }}
              />
            </Field>

            {!editing && matches.length > 0 ? (
              <DuplicateNotice
                kind={kind}
                matches={matches}
                acknowledged={acknowledged}
                onAcknowledge={setAcknowledged}
              />
            ) : null}

            {kind === 'construct' ? (
              <Field
                label={t('registry.form.sequence')}
                hint={t('registry.form.sequenceHint')}
                error={sequenceError}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept={SEQUENCE_ACCEPT}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => void chooseFile(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    disabled={busy || reading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {details.seqLength
                      ? t('registry.form.changeSequence')
                      : t('registry.form.chooseSequence')}
                  </Button>
                  {details.seqLength ? (
                    <>
                      <span className="text-label text-fg-muted">
                        {details.seqName ? `${details.seqName} · ` : ''}
                        {t(
                          `sequences.summary.length.${details.seqMolecule === 'protein' ? 'protein' : details.seqMolecule === 'rna' ? 'rna' : 'dna'}`,
                          { count: Number(details.seqLength) },
                        )}
                        {details.seqTopology
                          ? ` · ${t(`sequences.summary.${details.seqTopology === 'circular' ? 'circular' : 'linear'}`)}`
                          : ''}
                      </span>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={clearSequence}
                      >
                        {t('registry.form.removeSequence')}
                      </Button>
                    </>
                  ) : null}
                </span>
              </Field>
            ) : null}

            <DetailInputs
              kind={kind}
              details={details}
              disabled={busy}
              onChange={(key, value) => {
                setDetails((prev) => ({ ...prev, [key]: value }))
                setAcknowledged(false)
              }}
            />
            <Field label={t('registry.form.description')}>
              <Textarea
                rows={3}
                value={description}
                disabled={busy}
                placeholder={t('registry.form.descriptionPlaceholder')}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            {!editing ? (
              <Field
                label={t('registry.form.madeFrom')}
                hint={t('registry.form.madeFromHint')}
              >
                <span className="flex flex-col gap-2">
                  {parents.map((parent, index) => (
                    <span key={index} className="flex items-center gap-2">
                      <Select
                        aria-label={t('registry.form.pickParent')}
                        value={parent.id}
                        disabled={busy}
                        onChange={(e) =>
                          setParents((prev) =>
                            prev.map((p, i) =>
                              i === index ? { ...p, id: e.target.value } : p,
                            ),
                          )
                        }
                      >
                        <option value="">
                          {t('registry.form.pickParent')}
                        </option>
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.registryId} · {c.name}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label={t('registry.entry.lineageColumns.role')}
                        value={parent.role}
                        disabled={busy}
                        onChange={(e) =>
                          setParents((prev) =>
                            prev.map((p, i) =>
                              i === index
                                ? { ...p, role: e.target.value as ParentRole }
                                : p,
                            ),
                          )
                        }
                      >
                        {PARENT_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          setParents((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        {t('registry.form.removeParent', {
                          number:
                            candidates.find((c) => c.id === parent.id)
                              ?.registryId ?? '',
                        })}
                      </Button>
                    </span>
                  ))}
                  <span>
                    <Button
                      type="button"
                      disabled={busy || candidates.length === 0}
                      onClick={() =>
                        setParents((prev) => [
                          ...prev,
                          { id: '', role: defaultRole(kind) },
                        ])
                      }
                    >
                      {t('registry.form.addParent')}
                    </Button>
                  </span>
                </span>
              </Field>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('registry.form.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="registry-form"
            disabled={busy || reading || blockedByDuplicate}
          >
            {busy
              ? editing
                ? t('registry.form.saving')
                : t('registry.form.registering')
              : editing
                ? t('registry.form.save')
                : t('registry.register')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
