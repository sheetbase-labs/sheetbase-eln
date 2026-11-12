import { Fragment, useId } from 'react'

import { t } from '#/copy'
import {
  BoardButton,
  BoardInput,
  BoardSelect,
} from '#/features/pipelines/board/board'
import {
  CONDITION_OPERATORS,
  FORMULA_OPERATORS,
  MAX_CONDITIONS,
  MAX_RANGES,
  MAX_TERMS,
  VALUELESS_OPERATORS,
} from '#/lib/pipelines/no-code/forms'
import type {
  CalculateForm,
  CheckRangesForm,
  Condition,
  FilterForm,
  FlagForm,
  JoinForm,
  NoCodeForm,
  NoCodeKind,
} from '#/lib/pipelines/no-code/forms'
import {
  formulaSymbolFor,
  operatorLabel,
} from '#/lib/pipelines/no-code/summary'

/** The pickers of a no-code step. Each change hands back the whole form. */
export function NoCodeFormFields({
  kind,
  form,
  onChange,
  columns,
  inputs,
  inputColumns,
}: {
  kind: NoCodeKind
  form: NoCodeForm
  onChange: (form: NoCodeForm) => void
  /** Columns of the rows the step reads, when a try or run has shown them. */
  columns: string[]
  inputs: Array<{ name: string }>
  /** Columns of each declared input, when known. */
  inputColumns: Record<string, string[]>
}) {
  const listId = useId()

  return (
    <>
      <datalist id={listId}>
        {columns.map((column) => (
          <option key={column} value={column} />
        ))}
      </datalist>
      {kind === 'filter' ? (
        <ConditionRows
          // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
          form={form as FilterForm}
          onChange={onChange}
          listId={listId}
          lead={t('data.stepList.keepRowsThat')}
        />
      ) : null}
      {kind === 'flag' ? (
        <FlagFields
          // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
          form={form as FlagForm}
          onChange={onChange}
          listId={listId}
        />
      ) : null}
      {kind === 'join' ? (
        <JoinFields
          // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
          form={form as JoinForm}
          onChange={onChange}
          listId={listId}
          inputs={inputs}
          inputColumns={inputColumns}
        />
      ) : null}
      {kind === 'calculate' ? (
        <CalculateFields
          // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
          form={form as CalculateForm}
          onChange={onChange}
          listId={listId}
        />
      ) : null}
      {kind === 'check_ranges' ? (
        <RangeFields
          // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
          form={form as CheckRangesForm}
          onChange={onChange}
          listId={listId}
        />
      ) : null}
    </>
  )
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="frow">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}

function ConditionRows({
  form,
  onChange,
  listId,
  lead,
}: {
  form: { match: 'all' | 'any'; conditions: Condition[] }
  onChange: (form: FilterForm) => void
  listId: string
  lead: string
}) {
  const set = (index: number, patch: Partial<Condition>) =>
    onChange({
      ...form,
      conditions: form.conditions.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      ),
    })

  return (
    <Row label={lead}>
      <div className="flex flex-col gap-1.5">
        {form.conditions.length > 1 ? (
          <BoardSelect
            className="w-[220px]"
            aria-label={t('data.stepList.matchAria')}
            value={form.match}
            onChange={(e) =>
              onChange({
                ...form,
                match: e.target.value === 'any' ? 'any' : 'all',
              })
            }
          >
            <option value="all">{t('data.stepList.matchAll')}</option>
            <option value="any">{t('data.stepList.matchAny')}</option>
          </BoardSelect>
        ) : null}
        {form.conditions.map((condition, index) => (
          <div
            // The list has no ids of its own; a condition is its place in it.
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Conditions are edited in place and reordered never, so their position is their identity.
            key={index}
            className="flex flex-wrap items-center gap-1.5"
          >
            <BoardInput
              list={listId}
              mono
              className="w-[140px]"
              aria-label={t('data.stepList.conditionColumn', { n: index + 1 })}
              value={condition.column}
              onChange={(e) => set(index, { column: e.target.value })}
            />
            <BoardSelect
              className="w-[130px]"
              aria-label={t('data.stepList.conditionOperator', {
                n: index + 1,
              })}
              value={condition.op}
              onChange={(e) => {
                const op = CONDITION_OPERATORS.find((o) => o === e.target.value)

                if (op) set(index, { op })
              }}
            >
              {CONDITION_OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {operatorLabel(op)}
                </option>
              ))}
            </BoardSelect>
            {VALUELESS_OPERATORS.includes(condition.op) ? null : (
              <BoardInput
                className="w-[120px]"
                aria-label={t('data.stepList.conditionValue', { n: index + 1 })}
                value={condition.value ?? ''}
                onChange={(e) => set(index, { value: e.target.value })}
              />
            )}
            <BoardButton
              size="sm"
              variant="quiet"
              aria-label={t('data.stepList.removeCondition', { n: index + 1 })}
              disabled={form.conditions.length === 1}
              onClick={() =>
                onChange({
                  ...form,
                  conditions: form.conditions.filter((_, i) => i !== index),
                })
              }
            >
              {t('common.actions.remove')}
            </BoardButton>
          </div>
        ))}
        <div>
          <BoardButton
            size="sm"
            variant="quiet"
            icon="plus"
            disabled={form.conditions.length >= MAX_CONDITIONS}
            onClick={() =>
              onChange({
                ...form,
                conditions: [
                  ...form.conditions,
                  { column: '', op: 'eq', value: '' },
                ],
              })
            }
          >
            {t('data.stepList.addCondition')}
          </BoardButton>
        </div>
      </div>
    </Row>
  )
}

function FlagFields({
  form,
  onChange,
  listId,
}: {
  form: FlagForm
  onChange: (form: NoCodeForm) => void
  listId: string
}) {
  const id = useId()

  return (
    <>
      <Row label={t('data.stepList.newColumn')} htmlFor={id}>
        <BoardInput
          id={id}
          mono
          value={form.column}
          onChange={(e) => onChange({ ...form, column: e.target.value })}
        />
      </Row>
      <ConditionRows
        form={form}
        listId={listId}
        lead={t('data.stepList.flagRowsThat')}
        onChange={(next) => onChange({ ...form, ...next })}
      />
    </>
  )
}

function JoinFields({
  form,
  onChange,
  listId,
  inputs,
  inputColumns,
}: {
  form: JoinForm
  onChange: (form: NoCodeForm) => void
  listId: string
  inputs: Array<{ name: string }>
  inputColumns: Record<string, string[]>
}) {
  const withId = useId()
  const rightList = `${listId}-right`
  const known = inputColumns[form.with] ?? []

  return (
    <>
      <datalist id={rightList}>
        {known.map((column) => (
          <option key={column} value={column} />
        ))}
      </datalist>
      <Row label={t('data.stepList.joinWith')} htmlFor={withId}>
        <div className="flex flex-wrap items-center gap-2">
          <BoardSelect
            id={withId}
            className="w-[200px]"
            value={form.with}
            onChange={(e) => onChange({ ...form, with: e.target.value })}
          >
            <option value="">{t('data.stepList.chooseInput')}</option>
            {inputs.map((input) => (
              <option key={input.name} value={input.name}>
                {input.name}
              </option>
            ))}
          </BoardSelect>
          <BoardSelect
            className="w-[160px]"
            aria-label={t('data.stepList.joinKind')}
            value={form.type}
            onChange={(e) =>
              onChange({
                ...form,
                type: e.target.value === 'inner' ? 'inner' : 'left',
              })
            }
          >
            <option value="left">{t('data.stepList.joinLeft')}</option>
            <option value="inner">{t('data.stepList.joinInner')}</option>
          </BoardSelect>
        </div>
      </Row>
      <Row label={t('data.stepList.whereMatches')}>
        <div className="flex flex-col gap-1.5">
          {form.keys.map((key, index) => (
            <div
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Join keys are edited in place and never reordered, so their position is their identity.
              key={index}
              className="flex flex-wrap items-center gap-1.5"
            >
              <BoardInput
                list={listId}
                mono
                className="w-[140px]"
                aria-label={t('data.stepList.joinLeftColumn', { n: index + 1 })}
                value={key.left}
                onChange={(e) =>
                  onChange({
                    ...form,
                    keys: form.keys.map((k, i) =>
                      i === index ? { ...k, left: e.target.value } : k,
                    ),
                  })
                }
              />
              <span className="text-fg-muted">=</span>
              <BoardInput
                list={rightList}
                mono
                className="w-[140px]"
                aria-label={t('data.stepList.joinRightColumn', {
                  n: index + 1,
                })}
                value={key.right}
                onChange={(e) =>
                  onChange({
                    ...form,
                    keys: form.keys.map((k, i) =>
                      i === index ? { ...k, right: e.target.value } : k,
                    ),
                  })
                }
              />
              <BoardButton
                size="sm"
                variant="quiet"
                disabled={form.keys.length === 1}
                aria-label={t('data.stepList.removeJoinKey', { n: index + 1 })}
                onClick={() =>
                  onChange({
                    ...form,
                    keys: form.keys.filter((_, i) => i !== index),
                  })
                }
              >
                {t('common.actions.remove')}
              </BoardButton>
            </div>
          ))}
          <div>
            <BoardButton
              size="sm"
              variant="quiet"
              icon="plus"
              disabled={form.keys.length >= 10}
              onClick={() =>
                onChange({
                  ...form,
                  keys: [...form.keys, { left: '', right: '' }],
                })
              }
            >
              {t('data.stepList.addJoinKey')}
            </BoardButton>
          </div>
        </div>
      </Row>
      <Row label={t('data.stepList.bringIn')}>
        <BoardInput
          mono
          aria-label={t('data.stepList.bringInAria')}
          placeholder={t('data.stepList.bringInPlaceholder')}
          value={form.bring.join(', ')}
          onChange={(e) =>
            onChange({
              ...form,
              bring: e.target.value
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean),
            })
          }
        />
      </Row>
    </>
  )
}

function CalculateFields({
  form,
  onChange,
  listId,
}: {
  form: CalculateForm
  onChange: (form: NoCodeForm) => void
  listId: string
}) {
  const nameId = useId()

  const setTerm = (index: number, patch: CalculateForm['terms'][number]) =>
    onChange({
      ...form,
      terms: form.terms.map((term, i) => (i === index ? patch : term)),
    })

  return (
    <>
      <Row label={t('data.stepList.newColumn')} htmlFor={nameId}>
        <BoardInput
          id={nameId}
          mono
          value={form.column}
          onChange={(e) => onChange({ ...form, column: e.target.value })}
        />
      </Row>
      <Row label={t('data.stepList.formula')}>
        <div
          role="group"
          aria-label={t('data.stepList.formula')}
          className="pb-expr"
        >
          {form.terms.map((term, index) => (
            <Fragment
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Formula terms are edited in place, so their position is their identity.
              key={index}
            >
              {index > 0 ? (
                <select
                  className="op"
                  aria-label={t('data.stepList.termOperator', { n: index + 1 })}
                  value={term.op ?? '+'}
                  onChange={(e) => {
                    const op = FORMULA_OPERATORS.find(
                      (o) => o === e.target.value,
                    )

                    if (op) setTerm(index, { ...term, op })
                  }}
                >
                  {FORMULA_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {formulaSymbolFor(op)}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                list={listId}
                className="col"
                aria-label={t('data.stepList.termValue', { n: index + 1 })}
                placeholder={t('data.stepList.termPlaceholder')}
                value={term.column ?? (term.number ?? '').toString()}
                onChange={(e) => {
                  const text = e.target.value.trim()
                  const { op } = term
                  const base = op ? { op } : {}

                  if (text !== '' && Number.isFinite(Number(text)))
                    setTerm(index, { ...base, number: Number(text) })
                  else setTerm(index, { ...base, column: e.target.value })
                }}
              />
              {form.terms.length > 1 ? (
                <button
                  type="button"
                  className="op rm"
                  aria-label={t('data.stepList.removeTerm', { n: index + 1 })}
                  onClick={() =>
                    onChange({
                      ...form,
                      terms: form.terms
                        .filter((_, i) => i !== index)
                        .map((tm, i) =>
                          i === 0
                            ? { column: tm.column, number: tm.number }
                            : tm,
                        ),
                    })
                  }
                >
                  ×
                </button>
              ) : null}
            </Fragment>
          ))}
          <button
            type="button"
            className="add"
            disabled={form.terms.length >= MAX_TERMS}
            onClick={() =>
              onChange({
                ...form,
                terms: [...form.terms, { op: '+', column: '' }],
              })
            }
          >
            {t('data.stepList.addTerm')}
          </button>
        </div>
      </Row>
      <Row label={t('data.stepList.roundAndUnit')}>
        <div className="flex flex-wrap gap-2">
          <BoardSelect
            className="w-[150px]"
            aria-label={t('data.stepList.roundTo')}
            value={form.places === null ? '' : String(form.places)}
            onChange={(e) =>
              onChange({
                ...form,
                places: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          >
            <option value="">{t('data.stepList.noRounding')}</option>
            {[0, 1, 2, 3, 4].map((places) => (
              <option key={places} value={places}>
                {t('data.stepList.decimalPlaces', { count: places })}
              </option>
            ))}
          </BoardSelect>
          <BoardInput
            className="w-[90px]"
            aria-label={t('data.stepList.unit')}
            placeholder={t('data.stepList.unit')}
            value={form.unit ?? ''}
            onChange={(e) => {
              const { unit: _unit, ...rest } = form

              onChange(
                e.target.value ? { ...rest, unit: e.target.value } : rest,
              )
            }}
          />
        </div>
      </Row>
    </>
  )
}

function RangeFields({
  form,
  onChange,
  listId,
}: {
  form: CheckRangesForm
  onChange: (form: NoCodeForm) => void
  listId: string
}) {
  const setRange = (index: number, next: CheckRangesForm['ranges'][number]) =>
    onChange({
      ...form,
      ranges: form.ranges.map((r, i) => (i === index ? next : r)),
    })

  const limit = (text: string) =>
    text.trim() !== '' && Number.isFinite(Number(text))
      ? Number(text)
      : undefined

  return (
    <>
      <Row label={t('data.stepList.checkColumns')}>
        <div className="flex flex-col gap-1.5">
          {form.ranges.map((range, index) => (
            <div
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Ranges are edited in place and never reordered, so their position is their identity.
              key={index}
              className="flex flex-wrap items-center gap-1.5"
            >
              <BoardInput
                list={listId}
                mono
                className="w-[140px]"
                aria-label={t('data.stepList.rangeColumn', { n: index + 1 })}
                value={range.column}
                onChange={(e) =>
                  setRange(index, { ...range, column: e.target.value })
                }
              />
              <BoardInput
                className="h-7 w-[84px] text-xs"
                inputMode="decimal"
                aria-label={t('data.stepList.rangeMin', { n: index + 1 })}
                placeholder={t('data.stepList.rangeMinPlaceholder')}
                value={range.min ?? ''}
                onChange={(e) => {
                  const { min: _min, ...rest } = range
                  const min = limit(e.target.value)

                  setRange(index, min === undefined ? rest : { ...rest, min })
                }}
              />
              <span className="text-fg-muted">–</span>
              <BoardInput
                className="h-7 w-[84px] text-xs"
                inputMode="decimal"
                aria-label={t('data.stepList.rangeMax', { n: index + 1 })}
                placeholder={t('data.stepList.rangeMaxPlaceholder')}
                value={range.max ?? ''}
                onChange={(e) => {
                  const { max: _max, ...rest } = range
                  const max = limit(e.target.value)

                  setRange(index, max === undefined ? rest : { ...rest, max })
                }}
              />
              <BoardButton
                size="sm"
                variant="quiet"
                disabled={form.ranges.length === 1}
                aria-label={t('data.stepList.removeRange', { n: index + 1 })}
                onClick={() =>
                  onChange({
                    ...form,
                    ranges: form.ranges.filter((_, i) => i !== index),
                  })
                }
              >
                {t('common.actions.remove')}
              </BoardButton>
            </div>
          ))}
          <div>
            <BoardButton
              size="sm"
              variant="quiet"
              icon="plus"
              disabled={form.ranges.length >= MAX_RANGES}
              onClick={() =>
                onChange({ ...form, ranges: [...form.ranges, { column: '' }] })
              }
            >
              {t('data.stepList.addRange')}
            </BoardButton>
          </div>
        </div>
      </Row>
      <Row label={t('data.stepList.passOn')}>
        <BoardSelect
          className="w-[260px]"
          aria-label={t('data.stepList.passOn')}
          value={form.keep}
          onChange={(e) =>
            onChange({
              ...form,
              keep: e.target.value === 'outside' ? 'outside' : 'all',
            })
          }
        >
          <option value="all">{t('data.stepList.passAll')}</option>
          <option value="outside">{t('data.stepList.passOutside')}</option>
        </BoardSelect>
      </Row>
    </>
  )
}
