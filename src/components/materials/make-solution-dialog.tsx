/**
 * Make a solution from lots: a buffer, medium or any other prep that uses up
 * ingredient lots and becomes a lot of its own (migration 0064).
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Textarea } from '#/components/inventory/list'
import { materialListQueryKeys } from '#/components/materials/materials-data'
import { useProjectNames } from '#/components/samples/samples-data'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import type { Reagent } from '#/lib/reagent-data'
import {
  earliestExpiry,
  prepareSolution,
  searchIngredientLots,
  solutionQueryKeys,
} from '#/lib/solution-prep'
import type {
  PreparedSolution,
  PrepareSolutionInput,
} from '#/lib/solution-prep'
import { t } from '#/copy'

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)

    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}

interface Ingredient {
  lot: Reagent
  /** Typed text, so a half-typed number is not rewritten under the cursor. */
  quantity: string
}

function amount(value: number, unit: string | null): string {
  return `${value.toLocaleString('en-GB', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`
}

/** Name, ID and lot in one line, so two lots of one material can be told apart. */
function lotLabel(lot: Reagent): string {
  return [
    lot.title,
    lot.identifier,
    lot.lot ? t('library.materials.solution.lotOf', { lot: lot.lot }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function MakeSolutionDialog({
  open,
  onOpenChange,
  initialLot,
  onMade,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A lot to start the ingredient list with. */
  initialLot?: Reagent | null
  onMade?: (solution: PreparedSolution) => void
}) {
  const queryClient = useQueryClient()
  const projects = useProjectNames()

  const mutation = useMutation({
    mutationFn: (input: PrepareSolutionInput) =>
      prepareSolution(notebookDataClient, input),
    onSuccess: (solution, input) => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'materials'],
      })
      toast(
        t('library.materials.solution.made', {
          identifier: solution.identifier,
          count: input.ingredients.length,
        }),
      )
      onOpenChange(false)
      onMade?.(solution)
    },
    onError: (error) => {
      toast(
        error instanceof Error
          ? error.message
          : t('library.materials.solution.couldNotMake'),
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.materials.solution.title')}
          description={t('library.materials.solution.description')}
        />
        <DialogBody>
          {open ? (
            <SolutionForm
              busy={mutation.isPending}
              projects={projects.data ?? new Map()}
              initialLot={initialLot ?? null}
              onSubmit={(input) => mutation.mutate(input)}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="make-solution-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? t('library.materials.solution.submitting')
              : t('library.materials.solution.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SolutionForm({
  busy,
  projects,
  initialLot,
  onSubmit,
}: {
  busy: boolean
  projects: Map<string, string>
  initialLot: Reagent | null
  onSubmit: (input: PrepareSolutionInput) => void
}) {
  const [projectId, setProjectId] = useState(initialLot?.projectId ?? '')
  const [title, setTitle] = useState('')
  const [lot, setLot] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [storage, setStorage] = useState('')
  const [expiry, setExpiry] = useState('')
  const [note, setNote] = useState('')

  const [ingredients, setIngredients] = useState<Ingredient[]>(
    initialLot ? [{ lot: initialLot, quantity: '' }] : [],
  )

  const [errors, setErrors] = useState<Record<string, string>>({})

  const earliest = useMemo(
    () => earliestExpiry(ingredients.map((i) => i.lot.expiry)),
    [ingredients],
  )

  const setAmount = (id: string, value: string) =>
    setIngredients((rows) =>
      rows.map((row) =>
        row.lot.id === id ? { ...row, quantity: value } : row,
      ),
    )

  return (
    <form
      id="make-solution-form"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const next: Record<string, string> = {}
        const made = Number(quantity)

        if (!projectId)
          next.project = t('library.materials.solution.chooseProject')

        if (!title.trim())
          next.title = t('library.materials.solution.enterName')

        if (!lot.trim()) next.lot = t('library.materials.solution.enterLot')

        if (quantity.trim() === '' || !Number.isFinite(made) || made <= 0)
          next.quantity = t('library.materials.solution.enterQuantity')

        if (ingredients.length === 0)
          next.ingredients = t('library.materials.solution.addIngredient')

        for (const row of ingredients) {
          const used = Number(row.quantity)

          if (row.quantity.trim() === '' || !Number.isFinite(used) || used <= 0)
            next[row.lot.id] = t('library.materials.solution.enterAmount', {
              name: row.lot.title,
            })
          else if (row.lot.quantity != null && used > row.lot.quantity)
            next[row.lot.id] = t('library.materials.solution.onlyLeft', {
              available: amount(row.lot.quantity, row.lot.unit),
              name: row.lot.title,
            })
        }

        setErrors(next)

        if (Object.keys(next).length) return
        onSubmit({
          projectId,
          title: title.trim(),
          lot: lot.trim(),
          quantity: made,
          unit: unit.trim() || null,
          expiry: expiry || null,
          storage: storage.trim() || null,
          note: note.trim() || null,
          ingredients: ingredients.map((row) => ({
            recordId: row.lot.id,
            quantity: Number(row.quantity),
          })),
        })
      }}
    >
      <Field
        label={t('library.materials.solution.project')}
        required
        error={errors.project}
      >
        <Select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={busy}
        >
          <option value="">{t('library.materials.solution.choose')}</option>
          {[...projects].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field
          label={t('library.materials.solution.name')}
          required
          error={errors.title}
        >
          <Input
            value={title}
            placeholder={t('library.materials.solution.namePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            autoFocus={!initialLot}
          />
        </Field>
        <Field
          label={t('library.materials.solution.lotNumber')}
          required
          error={errors.lot}
        >
          <Input
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field
          label={t('library.materials.solution.quantity')}
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
        <Field label={t('library.materials.solution.unit')}>
          <Input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.solution.storage')}>
          <Input
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field
          label={t('library.materials.solution.expiry')}
          hint={expiryHint(expiry, earliest, ingredients.length > 0)}
        >
          <Input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            disabled={busy}
          />
        </Field>
      </div>

      <section
        aria-label={t('library.materials.solution.ingredients')}
        className="flex flex-col gap-2"
      >
        <h3 className="font-sans text-label font-semibold">
          {t('library.materials.solution.ingredients')}
        </h3>
        {ingredients.length === 0 ? (
          <p className="text-label text-fg-muted">
            {errors.ingredients ? (
              <span className="text-danger-text">{errors.ingredients}</span>
            ) : (
              t('library.materials.solution.ingredientsEmpty')
            )}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {ingredients.map((row) => (
              <li key={row.lot.id} className="flex flex-col gap-1 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body">
                      {lotLabel(row.lot)}
                    </div>
                    <div className="truncate text-label text-fg-muted">
                      {[
                        t('library.materials.solution.inStock', {
                          stock: amount(row.lot.quantity ?? 0, row.lot.unit),
                        }),
                        row.lot.expiry
                          ? t('library.materials.solution.expires', {
                              date: formatDate(row.lot.expiry),
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <Input
                    type="number"
                    className="w-[96px]"
                    aria-label={t('library.materials.solution.amountLabel', {
                      name: row.lot.title,
                    })}
                    aria-invalid={Boolean(errors[row.lot.id])}
                    value={row.quantity}
                    onChange={(e) => setAmount(row.lot.id, e.target.value)}
                    disabled={busy}
                  />
                  <span className="w-8 text-label text-fg-muted">
                    {row.lot.unit}
                  </span>
                  <IconButton
                    icon="trash"
                    label={t('library.materials.solution.removeIngredient', {
                      name: row.lot.title,
                    })}
                    disabled={busy}
                    onClick={() =>
                      setIngredients((rows) =>
                        rows.filter((r) => r.lot.id !== row.lot.id),
                      )
                    }
                  />
                </div>
                {errors[row.lot.id] ? (
                  <span className="text-label text-danger-text">
                    {errors[row.lot.id]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <IngredientSearch
          disabled={busy}
          taken={new Set(ingredients.map((i) => i.lot.id))}
          onPick={(picked) => {
            setIngredients((rows) => [...rows, { lot: picked, quantity: '' }])
            setProjectId((current) => current || picked.projectId || '')
          }}
        />
      </section>

      <Field label={t('library.materials.solution.note')}>
        <Textarea
          value={note}
          placeholder={t('library.materials.solution.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}

function expiryHint(
  expiry: string,
  earliest: string | null,
  hasIngredients: boolean,
): string | undefined {
  if (!hasIngredients) return undefined

  if (!earliest)
    return expiry ? undefined : t('library.materials.solution.expiryNone')

  if (!expiry)
    return t('library.materials.solution.expiryEarliest', {
      date: formatDate(earliest),
    })

  if (expiry > earliest)
    return t('library.materials.solution.expiryLater', {
      date: formatDate(earliest),
    })

  return undefined
}

function IngredientSearch({
  taken,
  disabled,
  onPick,
}: {
  taken: Set<string>
  disabled: boolean
  onPick: (lot: Reagent) => void
}) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const query = useDebounced(text.trim(), 200)

  const results = useQuery({
    queryKey: solutionQueryKeys.candidates(query),
    queryFn: () => searchIngredientLots(notebookDataClient, query),
    enabled: focused || query.length > 0,
    staleTime: 10_000,
  })

  const shown = (results.data ?? []).filter((lot) => !taken.has(lot.id))
  const showList = focused || text.length > 0

  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={t('library.materials.solution.searchLabel')}
        placeholder={t('library.materials.solution.searchPlaceholder')}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {showList ? (
        shown.length > 0 ? (
          <ul
            className="max-h-[180px] overflow-auto rounded-md border border-border bg-surface"
            aria-label={t('library.materials.solution.searchLabel')}
          >
            {shown.map((lot) => (
              <li key={lot.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start px-2 py-1 text-left hover:bg-surface-hover"
                  // Picking must land before the field loses focus and closes the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(lot)
                    setText('')
                  }}
                >
                  <span className="text-body">{lotLabel(lot)}</span>
                  <span className="text-label text-fg-muted">
                    {[
                      t('library.materials.solution.inStock', {
                        stock: amount(lot.quantity ?? 0, lot.unit),
                      }),
                      lot.expiry
                        ? t('library.materials.solution.expires', {
                            date: formatDate(lot.expiry),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : results.isFetching ? (
          <p className="text-label text-fg-muted">
            {t('library.materials.solution.searching')}
          </p>
        ) : query ? (
          <p className="text-label text-fg-muted">
            {t('library.materials.solution.noMatches', { q: query })}
          </p>
        ) : null
      ) : null}
    </div>
  )
}
