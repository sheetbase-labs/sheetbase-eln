import { Icon } from '#/components/icons'
import { Avatar } from '#/components/ui/avatar'
import { IconButton } from '#/components/ui/icon-button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { t } from '#/copy'
import { words } from '#/lib/pipelines/simple/words'
import {
  usePipelineOutputTargets,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { PIPELINE_ACTIONS } from '#/lib/pipelines/actions'
import {
  CONDITION_OPERATORS,
  EVENT_PERSON,
  MAX_RECIPE_ACTIONS,
  MAX_RECIPE_CONDITIONS,
  NUMERIC_OPERATORS,
  START_EVENTS,
} from '#/lib/pipelines/simple/recipe'
import type {
  ConditionOperator,
  PipelineRecipe,
  RecipeAction,
  RecipeCondition,
} from '#/lib/pipelines/simple/recipe'
import { ActionMenu } from './action-menu'
import { TokenAdd, TokenInput, TokenSelect } from './token'
import {
  useDatasetColumns,
  useInstruments,
  useNotificationChannels,
} from './use-simple-data'
import type { DatasetColumn } from './use-simple-data'

const r = words('recipe')

/** The instrument choice that means "from anywhere". */
const ANY = 'any'

/** The word at the left of a line: When, if, then, and. */
function Keyword({ children }: { children?: React.ReactNode }) {
  return (
    <span className="text-right font-sans text-label font-medium leading-[30px] text-fg-muted">
      {children}
    </span>
  )
}

function Row({
  keyword,
  children,
  onRemove,
}: {
  keyword?: string
  children: React.ReactNode
  onRemove?: () => void
}) {
  return (
    <div className="group relative grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-2">
      <Keyword>{keyword}</Keyword>
      <div className="flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-1">
        {children}
        {onRemove ? (
          <IconButton
            icon="x"
            label={r('remove')}
            className="absolute right-0 top-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
            onClick={onRemove}
          />
        ) : null}
      </div>
    </div>
  )
}

const joinWord = (join: 'and' | 'or') =>
  join === 'and' ? r('joinAnd') : r('joinOr')

function ConditionLine({
  condition,
  columns,
  onChange,
}: {
  condition: RecipeCondition
  columns: DatasetColumn[]
  onChange: (next: RecipeCondition) => void
}) {
  const numeric = NUMERIC_OPERATORS.includes(condition.operator)

  return (
    <>
      <TokenSelect
        label={r('pickColumn')}
        value={condition.column}
        placeholder={r('pickColumn')}
        options={columns.map((c) => ({ value: c.key, label: c.label }))}
        onChange={(column) => onChange({ ...condition, column })}
      />
      <TokenSelect
        label={r('operators.equals')}
        value={condition.operator}
        placeholder=""
        options={CONDITION_OPERATORS.map((operator) => ({
          value: operator,
          label: r(`operators.${operator}`),
        }))}
        onChange={(operator) => {
          // SAFETY: the select offers only the operators in CONDITION_OPERATORS.
          const next = operator as ConditionOperator
          const wasNumeric = NUMERIC_OPERATORS.includes(condition.operator)
          const isNumeric = NUMERIC_OPERATORS.includes(next)

          onChange({
            ...condition,
            operator: next,
            value:
              next === 'is_empty'
                ? undefined
                : wasNumeric === isNumeric
                  ? condition.value
                  : isNumeric
                    ? 0
                    : '',
          })
        }}
      />
      {condition.operator === 'is_empty' ? null : (
        <>
          <TokenInput
            label={r('value')}
            type={numeric ? 'number' : 'text'}
            value={String(condition.value ?? '')}
            onChange={(value) =>
              onChange({
                ...condition,
                value: numeric
                  ? value === ''
                    ? undefined
                    : Number(value)
                  : value,
              })
            }
          />
          {numeric ? (
            <TokenInput
              label={r('unitPlaceholder')}
              placeholder={r('unitPlaceholder')}
              value={condition.unit ?? ''}
              onChange={(unit) =>
                onChange({ ...condition, unit: unit || undefined })
              }
              className="border-transparent bg-transparent pl-0 font-normal text-fg-muted hover:bg-transparent"
            />
          ) : null}
        </>
      )}
    </>
  )
}

// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- one line per action kind reads best as one switch over the kinds.
function ActionLine({
  action,
  columns,
  people,
  onChange,
}: {
  action: RecipeAction
  columns: DatasetColumn[]
  people: Record<string, string>
  onChange: (next: RecipeAction) => void
}) {
  const targets = usePipelineOutputTargets()
  const channels = useNotificationChannels()

  const columnOptions = columns.map((c) => ({ value: c.key, label: c.label }))

  switch (action.kind) {
    case 'flag_rows':
      return (
        <>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 font-sans text-body font-medium">
            <Icon name="warn" size={14} className="text-fg-muted" />
            {r('flagRow')}
          </span>
          <span className="font-sans text-body text-fg">{r('flagOn')}</span>
          <TokenSelect
            label={r('pickColumn')}
            value={action.column}
            placeholder={r('pickColumn')}
            options={columnOptions}
            onChange={(column) =>
              onChange({
                ...action,
                column,
                fieldId: columns.find((c) => c.key === column)?.id ?? '',
              })
            }
          />
        </>
      )
    case 'check_range':
      return (
        <>
          <span>{r('checkRange')}</span>
          <TokenSelect
            label={r('pickColumn')}
            value={action.column}
            placeholder={r('pickColumn')}
            options={columnOptions}
            onChange={(column) => onChange({ ...action, column })}
          />
          <span>{r('rangeBetween')}</span>
          <TokenInput
            label={r('rangeMin')}
            type="number"
            placeholder={r('rangeMin')}
            value={action.min === undefined ? '' : String(action.min)}
            onChange={(v) =>
              onChange({ ...action, min: v === '' ? undefined : Number(v) })
            }
          />
          <span>{r('joinAnd')}</span>
          <TokenInput
            label={r('rangeMax')}
            type="number"
            placeholder={r('rangeMax')}
            value={action.max === undefined ? '' : String(action.max)}
            onChange={(v) =>
              onChange({ ...action, max: v === '' ? undefined : Number(v) })
            }
          />
        </>
      )
    case 'ask':
      return (
        <>
          <TokenSelect
            label={r('pickPerson')}
            icon="user"
            lead={r('ask')}
            trail={action.mode === 'confirm' ? r('toConfirm') : r('toChoose')}
            mark={(chosen) => (
              <Avatar name={chosen.label} size="xs" tone="review" />
            )}
            value={action.userId}
            placeholder={r('pickPerson')}
            options={Object.entries(people).map(([id, name]) => ({
              value: id,
              label: name,
            }))}
            onChange={(userId) => onChange({ ...action, userId })}
          />
          {action.mode === 'choose' ? (
            <TokenInput
              label={r('options')}
              placeholder={r('options')}
              value={(action.options ?? []).join(', ')}
              onChange={(text) =>
                onChange({
                  ...action,
                  options: text
                    .split(',')
                    .map((option) => option.trim())
                    .filter(Boolean),
                })
              }
            />
          ) : null}
          <span className="ml-1 font-sans text-caption text-fg-muted">
            {r('waitsNote', { hours: action.hours })}
          </span>
        </>
      )
    case 'notify': {
      const list = (channels.data ?? []).filter(
        (c) => c.channel === action.channel,
      )

      return (
        <>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 font-sans text-body font-medium">
            <Icon
              name={
                action.channel === 'email'
                  ? 'bell'
                  : action.channel === 'teams'
                    ? 'comment'
                    : 'webhook'
              }
              size={14}
              className="text-fg-muted"
            />
            {r(`notify.${action.channel}`)}
          </span>
          <TokenSelect
            label={r('pickChannel')}
            value={action.subscriptionId}
            placeholder={r('pickChannel')}
            options={list.map((c) => ({
              value: c.id,
              label: c.description || c.key,
            }))}
            onChange={(subscriptionId) =>
              onChange({ ...action, subscriptionId })
            }
          />
        </>
      )
    }

    case 'eln_action':
      return (
        <ElnActionLine action={action} columns={columns} onChange={onChange} />
      )
    case 'inbox':
      return (
        <>
          <TokenSelect
            label={r('pickPerson')}
            icon="user"
            lead={action.mode === 'review' ? r('inboxReview') : r('inboxTask')}
            trail={action.mode === 'review' ? r('inboxReviewTrail') : undefined}
            mark={(chosen) => (
              <Avatar name={chosen.label} size="xs" tone="review" />
            )}
            value={action.userId}
            placeholder={r('pickPerson')}
            options={Object.entries(people).map(([id, name]) => ({
              value: id,
              label: name,
            }))}
            onChange={(userId) => onChange({ ...action, userId })}
          />
          {action.mode === 'task' ? (
            <TokenInput
              label={r('inboxText')}
              placeholder={r('inboxText')}
              value={action.text}
              onChange={(text) => onChange({ ...action, text })}
            />
          ) : null}
        </>
      )
    case 'expiring':
      return (
        <>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 font-sans text-body font-medium">
            <Icon name="tube" size={14} className="text-fg-muted" />
            {r('expiring')}
          </span>
          <TokenSelect
            label={r('pickPerson')}
            icon="user"
            mark={(chosen) => (
              <Avatar name={chosen.label} size="xs" tone="review" />
            )}
            value={action.userId}
            placeholder={r('pickPerson')}
            options={Object.entries(people).map(([id, name]) => ({
              value: id,
              label: name,
            }))}
            onChange={(userId) => onChange({ ...action, userId })}
          />
          <span className="font-sans text-body text-fg">
            {r('expiringWithin')}
          </span>
          <TokenInput
            label={r('expiringDays')}
            type="number"
            value={String(action.days)}
            suffix={r('dayUnit')}
            onChange={(value) =>
              onChange({
                ...action,
                days: Math.min(
                  365,
                  Math.max(1, Math.round(Number(value) || 1)),
                ),
              })
            }
          />
        </>
      )
    case 'append':
      return (
        <>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 font-sans text-body font-medium">
            <Icon name="download" size={14} className="text-fg-muted" />
            {r('append')}
          </span>
          <span>{r('to')}</span>
          <TokenSelect
            label={r('pickDataset')}
            icon="database"
            value={action.datasetId}
            placeholder={r('pickDataset')}
            options={(targets.data?.datasets ?? []).map((d) => ({
              value: d.id,
              label: d.displayId ? `${d.displayId} ${d.name}` : d.name,
            }))}
            onChange={(datasetId) => onChange({ ...action, datasetId })}
          />
        </>
      )
    case 'create':
      return (
        <>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 font-sans text-body font-medium">
            <Icon name="plus" size={14} className="text-fg-muted" />
            {r('create')}
          </span>
          <span>{r('named')}</span>
          <TokenInput
            label={r('named')}
            value={action.datasetName}
            onChange={(datasetName) => onChange({ ...action, datasetName })}
          />
          <span>{r('from2')}</span>
          <TokenSelect
            label={r('pickSchema')}
            value={action.schemaVersionId}
            placeholder={r('pickSchema')}
            options={(targets.data?.schemaVersions ?? []).map((s) => ({
              value: s.id,
              label: s.label,
            }))}
            onChange={(schemaVersionId) =>
              onChange({ ...action, schemaVersionId })
            }
          />
        </>
      )
  }
}

/** An ELN action: each argument comes from a column of the row or is a fixed value. */
function ElnActionLine({
  action,
  columns,
  onChange,
}: {
  action: Extract<RecipeAction, { kind: 'eln_action' }>
  columns: DatasetColumn[]
  onChange: (next: RecipeAction) => void
}) {
  const definition = PIPELINE_ACTIONS.find(
    (a) => a.operation === action.operation,
  )

  const setArgument = (
    name: string,
    value: RecipeAction extends never
      ? never
      : { column: string } | { value: string },
  ) =>
    onChange({ ...action, arguments: { ...action.arguments, [name]: value } })

  return (
    <div className="flex flex-col gap-1">
      <span className="font-sans text-body font-medium">
        {definition?.label ?? action.operation}
        <span className="ml-2 font-normal text-fg-muted">
          {action.mode === 'propose'
            ? t('features.pipelineSimple.catalogue.propose')
            : t('features.pipelineSimple.catalogue.perPolicy')}
        </span>
      </span>
      {(definition?.arguments ?? [])
        .filter((a) => !a.server)
        .map((argument) => {
          const mapped = Object.entries(action.arguments).find(
            ([name]) => name === argument.name,
          )?.[1]

          const fromColumn = mapped && 'column' in mapped

          return (
            <span
              key={argument.name}
              className="flex flex-wrap items-center gap-1.5 font-sans text-label"
            >
              <span className="w-40 shrink-0 text-fg-muted">
                {argument.name.replace(/^p_/, '').replaceAll('_', ' ')}
                {argument.required ? ' *' : ''}
              </span>
              <TokenSelect
                label={r('argument')}
                value={fromColumn ? 'column' : 'value'}
                placeholder=""
                options={[
                  { value: 'column', label: r('argFromColumn') },
                  { value: 'value', label: r('argFixed') },
                ]}
                onChange={(next) =>
                  setArgument(
                    argument.name,
                    next === 'column' ? { column: '' } : { value: '' },
                  )
                }
              />
              {fromColumn ? (
                <TokenSelect
                  label={r('pickColumn')}
                  value={mapped.column}
                  placeholder={r('pickColumn')}
                  options={columns.map((c) => ({
                    value: c.key,
                    label: c.label,
                  }))}
                  onChange={(column) => setArgument(argument.name, { column })}
                />
              ) : (
                <TokenInput
                  label={r('argument')}
                  value={
                    mapped && 'value' in mapped ? String(mapped.value) : ''
                  }
                  onChange={(value) => setArgument(argument.name, { value })}
                />
              )}
            </span>
          )
        })}
    </div>
  )
}

/**
 * The recipe as a sentence: When, if, then. Every boxed choice is a picker;
 * nothing is typed as code. Where Simple runs out, the catalogue says what
 * needs Standard and offers to convert.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- the recipe sentence draws When, if and then from one recipe.
export function RecipeEditor({
  recipe,
  onChange,
  onConvert,
  pipelineLabel,
  ownerName,
  readOnly = false,
}: {
  recipe: PipelineRecipe
  onChange: (next: PipelineRecipe) => void
  onConvert: () => void
  pipelineLabel: string
  ownerName: string | null
  readOnly?: boolean
}) {
  const targets = usePipelineOutputTargets()
  const members = useWorkspaceMemberNames()
  const datasets = targets.data?.datasets ?? []
  const dataset = datasets.find((d) => d.id === recipe.when.datasetId)
  const instruments = useInstruments()
  const columns = useDatasetColumns(dataset?.schemaVersionId ?? '')
  const columnList = columns.data ?? []

  // With no snapshot, an Inbox task can go to whoever the event is about.
  const people =
    recipe.when.event && recipe.when.event !== 'weekly'
      ? {
          ...members.data,
          [EVENT_PERSON]: r(`eventPerson.${recipe.when.event}`),
        }
      : (members.data ?? {})

  const keep = recipe.actions.find(
    (a) => a.kind === 'append' || a.kind === 'create',
  )

  const keepName = keep
    ? keep.kind === 'append'
      ? datasets.find((d) => d.id === keep.datasetId)?.name
      : keep.datasetName
    : null

  const setCondition = (index: number, next: RecipeCondition) =>
    onChange({
      ...recipe,
      conditions: recipe.conditions.map((c, i) => (i === index ? next : c)),
    })

  const setAction = (index: number, next: RecipeAction) =>
    onChange({
      ...recipe,
      actions: recipe.actions.map((a, i) => (i === index ? next : a)),
    })

  const datasetLabel = (d: (typeof datasets)[number]) =>
    d.displayId ? `${d.displayId} ${d.name}` : d.name

  return (
    <section
      aria-labelledby="simple-recipe"
      className="rounded-lg border border-border bg-surface"
    >
      <div className="flex items-center gap-2 px-4 pt-3">
        <h2
          id="simple-recipe"
          className="m-0 font-sans text-body font-semibold"
        >
          {r('title')}
        </h2>
        <span className="text-caption text-fg-muted">{r('hint')}</span>
      </div>
      <fieldset
        disabled={readOnly}
        aria-label={r('aria')}
        className="m-0 flex flex-col gap-1.5 border-0 p-4 pt-3.5 font-heading text-[16px] leading-[26px] text-fg"
      >
        <WhenRow
          recipe={recipe}
          onChange={onChange}
          datasets={datasets}
          instruments={instruments.data ?? []}
        />
        <div className="h-1" aria-hidden />
        {recipe.when.event ? null : (
          <>
            {recipe.conditions.length === 0 ? (
              <Row keyword={r('if')}>
                <span className="font-sans text-body text-fg-muted">
                  {r('allRows')}
                </span>
                <TokenAdd
                  aria-label={r('addConditionAria')}
                  onClick={() =>
                    onChange({
                      ...recipe,
                      conditions: [{ column: '', operator: 'above', value: 0 }],
                    })
                  }
                >
                  {r('addCondition')}
                </TokenAdd>
              </Row>
            ) : (
              recipe.conditions.map((condition, index) => (
                <Row
                  // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- a condition has no id; its place in the sentence is its identity.
                  key={index}
                  keyword={index === 0 ? r('if') : undefined}
                  onRemove={() =>
                    onChange({
                      ...recipe,
                      conditions: recipe.conditions.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  {index > 0 ? (
                    <TokenSelect
                      label={r('joinAnd')}
                      value={recipe.join}
                      placeholder=""
                      options={[
                        { value: 'and', label: joinWord('and') },
                        { value: 'or', label: joinWord('or') },
                      ]}
                      onChange={(join) =>
                        // SAFETY: the select offers only these two choices.
                        onChange({ ...recipe, join: join as 'and' | 'or' })
                      }
                    />
                  ) : null}
                  <ConditionLine
                    condition={condition}
                    columns={columnList}
                    onChange={(next) => setCondition(index, next)}
                  />
                  {index === recipe.conditions.length - 1 &&
                  recipe.conditions.length < MAX_RECIPE_CONDITIONS ? (
                    <TokenAdd
                      aria-label={r('addConditionAria')}
                      onClick={() =>
                        onChange({
                          ...recipe,
                          conditions: [
                            ...recipe.conditions,
                            { column: '', operator: 'above', value: 0 },
                          ],
                        })
                      }
                    >
                      {r('addCondition')}
                    </TokenAdd>
                  ) : null}
                </Row>
              ))
            )}
            <div className="h-1" aria-hidden />
          </>
        )}
        {recipe.actions.map((action, index) => (
          <Row
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- an action has no id; its place in the sentence is its identity.
            key={index}
            keyword={index === 0 ? r('thenDo') : r('and')}
            onRemove={() =>
              onChange({
                ...recipe,
                actions: recipe.actions.filter((_, i) => i !== index),
              })
            }
          >
            <ActionLine
              action={action}
              columns={columnList}
              people={people}
              onChange={(next) => setAction(index, next)}
            />
          </Row>
        ))}
        {recipe.actions.length < MAX_RECIPE_ACTIONS ? (
          <Row keyword={recipe.actions.length === 0 ? r('thenDo') : undefined}>
            <Popover>
              <PopoverTrigger
                render={
                  <TokenAdd aria-haspopup="dialog">
                    <Icon name="plus" size={14} />
                    {r('addAction')}
                  </TokenAdd>
                }
              />
              <PopoverContent
                align="start"
                className="w-[484px] max-w-[calc(100vw-24px)] p-0"
              >
                <ActionMenu
                  hasKeep={Boolean(keep)}
                  withoutSnapshot={Boolean(recipe.when.event)}
                  context={{
                    column: recipe.conditions.at(0)?.column ?? '',
                    fieldIds: Object.fromEntries(
                      columnList.map((c) => [c.key, c.id]),
                    ),
                  }}
                  onPick={(action) =>
                    onChange({
                      ...recipe,
                      actions: [...recipe.actions, action],
                    })
                  }
                  onConvert={onConvert}
                />
              </PopoverContent>
            </Popover>
          </Row>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border-subtle px-4 py-2.5 text-caption text-fg-muted">
        <span>
          {t('features.pipelineSimple.recipe.foot.reads')}{' '}
          <b className="font-medium text-fg">
            {dataset ? datasetLabel(dataset) : '—'}
          </b>{' '}
          {t('features.pipelineSimple.recipe.foot.latest')}
        </span>
        <span>
          {keepName ? (
            <>
              {t('features.pipelineSimple.recipe.foot.keeps')}{' '}
              <b className="font-medium text-fg">{keepName}</b>
            </>
          ) : (
            t('features.pipelineSimple.recipe.foot.nowhere')
          )}
        </span>
        <span>
          {t('features.pipelineSimple.recipe.foot.runsAs')}{' '}
          <b className="font-medium text-fg">{pipelineLabel}</b>
          {ownerName ? (
            <>
              , {t('features.pipelineSimple.recipe.foot.ownedBy')} {ownerName}
            </>
          ) : null}
        </span>
        <span>{t('features.pipelineSimple.recipe.foot.noCode')}</span>
      </div>
    </section>
  )
}

/** The weekdays a weekly recipe can start on, Sunday first as the schedule counts them. */
const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6'] as const

/**
 * What starts the recipe: a new snapshot of a dataset (from any instrument or
 * one), or something else the lab does: a run fails, a review is decided, a
 * weekday comes round. One chip carries the choice so the sentence reads as the
 * board draws it.
 */
function WhenRow({
  recipe,
  onChange,
  datasets,
  instruments,
}: {
  recipe: PipelineRecipe
  onChange: (next: PipelineRecipe) => void
  datasets: Array<{ id: string; name: string; displayId?: string | null }>
  instruments: Array<{ id: string; name: string; display_id: string | null }>
}) {
  const { event } = recipe.when
  const EVENT = 'event:'

  const starts = [
    ...datasets.map((d) => ({
      value: d.id,
      label: `${r('snapshotOf')} ${d.displayId ?? d.name}`,
    })),
    ...START_EVENTS.map((name) => ({
      value: EVENT + name,
      label: r(`start.${name}`),
    })),
  ]

  const choose = (value: string) => {
    if (value.startsWith(EVENT)) {
      const next = START_EVENTS.find((name) => EVENT + name === value)

      onChange({
        ...recipe,
        when: {
          datasetId: '',
          event: next,
          weekday: next === 'weekly' ? 1 : undefined,
        },
        conditions: [],
      })

      return
    }

    onChange({
      ...recipe,
      when: { datasetId: value, instrumentId: recipe.when.instrumentId },
      conditions: recipe.conditions.map((c) => ({ ...c, column: '' })),
    })
  }

  return (
    <Row keyword={r('when')}>
      <TokenSelect
        label={r('snapshotOf')}
        icon={event ? 'clock' : 'database'}
        value={event ? EVENT + event : recipe.when.datasetId}
        placeholder={r('pickDataset')}
        options={starts}
        onChange={choose}
      />
      {event === 'weekly' ? (
        <>
          <span className="font-sans text-body text-fg-muted">{r('on')}</span>
          <TokenSelect
            label={r('weekday')}
            value={String(recipe.when.weekday ?? 1)}
            placeholder={r('weekday')}
            options={WEEKDAYS.map((day) => ({
              value: day,
              label: r(`days.${day}`),
            }))}
            onChange={(day) =>
              onChange({
                ...recipe,
                when: { ...recipe.when, weekday: Number(day) },
              })
            }
          />
          <span className="font-sans text-body text-fg-muted">
            {r('weeklyAt')}
          </span>
        </>
      ) : null}
      {event ? null : (
        <>
          <span className="font-sans text-body text-fg-muted">
            {r('fromInstrument')}
          </span>
          <TokenSelect
            label={r('anyInstrument')}
            icon="scan"
            value={recipe.when.instrumentId ?? ANY}
            placeholder={r('anyInstrument')}
            options={[
              { value: ANY, label: r('anyInstrument') },
              ...instruments.map((i) => ({
                value: i.id,
                label: i.display_id ? `${i.name} ${i.display_id}` : i.name,
              })),
            ]}
            onChange={(instrumentId) =>
              onChange({
                ...recipe,
                when: {
                  datasetId: recipe.when.datasetId,
                  instrumentId: instrumentId === ANY ? undefined : instrumentId,
                },
              })
            }
          />
        </>
      )}
    </Row>
  )
}
