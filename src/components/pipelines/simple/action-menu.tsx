import { useState } from 'react'

import { Icon } from '#/components/icons'
import { Kbd } from '#/components/ui/kbd'
import { t } from '#/copy'
import { words } from '#/lib/pipelines/simple/words'
import { catalogueItems } from '#/lib/pipelines/simple/catalogue'
import type { CatalogueContext } from '#/lib/pipelines/simple/catalogue'
import { KEEP_KINDS } from '#/lib/pipelines/simple/recipe'
import type { RecipeAction } from '#/lib/pipelines/simple/recipe'

/** The board lists these in two columns: asking and flagging on the left, what it can change on the right. */
const COLUMNS = [
  ['flag', 'ask', 'notify'],
  ['eln', 'keep'],
] as const

/**
 * The "and…" menu: everything Simple can do, in groups. Run code is listed so
 * a person sees where Simple stops, with the way to Standard beside it. The
 * actions that are never offered (signing, approving, deleting) are said once
 * at the bottom.
 */
export function ActionMenu({
  context,
  hasKeep,
  onPick,
  onConvert,
}: {
  context: CatalogueContext
  /** A recipe keeps its results once, so the keep lines go when one is there. */
  hasKeep: boolean
  onPick: (action: RecipeAction) => void
  onConvert: () => void
}) {
  const [query, setQuery] = useState('')

  const items = catalogueItems().filter(
    (item) =>
      item.label.toLowerCase().includes(query.trim().toLowerCase()) &&
      !(hasKeep && KEEP_KINDS.includes(item.make(context).kind)),
  )

  const groupLabel = (group: string) => words('catalogue.groups')(group)

  return (
    // react-doctor-disable-next-line react-doctor/prefer-html-dialog -- this is the body of a popover the recipe opens beside its chip, not a modal.
    <div role="dialog" aria-label={t('features.pipelineSimple.catalogue.aria')}>
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <Icon name="search" size={14} className="text-fg-muted" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('features.pipelineSimple.catalogue.search')}
          aria-label={t('features.pipelineSimple.catalogue.search')}
          className="grow border-0 bg-transparent text-label text-fg outline-none placeholder:text-fg-muted"
        />
        <Kbd>{t('features.pipelineSimple.catalogue.escape')}</Kbd>
      </div>
      <div className="grid grid-cols-2 gap-x-1 p-1 max-md:grid-cols-1">
        {items.length === 0 ? (
          <p className="col-span-2 m-0 p-3 text-label text-fg-muted">
            {t('features.pipelineSimple.catalogue.none')}
          </p>
        ) : null}
        {COLUMNS.map((groups, column) => (
          <div key={groups.join()} className="flex flex-col">
            {groups.map((group) => {
              const inGroup = items.filter((item) => item.group === group)

              if (inGroup.length === 0) return null

              return (
                <div key={group} className="flex flex-col">
                  <div className="px-2 pb-0.5 pt-2 text-caption font-medium text-fg-muted">
                    {groupLabel(group)}
                  </div>
                  {inGroup.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-label text-fg hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                      onClick={() => onPick(item.make(context))}
                    >
                      <Icon
                        name={item.icon}
                        size={14}
                        className="text-fg-muted"
                      />
                      <span className="grow">{item.label}</span>
                      {item.hint ? (
                        <span className="text-caption text-fg-muted">
                          {item.hint}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )
            })}
            {column === 1 ? <CodeRows onConvert={onConvert} /> : null}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 rounded-b-lg border-t border-border bg-surface-muted px-3 py-2 text-caption text-fg-muted">
        <Icon name="lock" size={12} />
        {t('features.pipelineSimple.catalogue.never')}
      </div>
    </div>
  )
}

/** Where Simple stops: running code needs Standard, with the way there beside it. */
function CodeRows({ onConvert }: { onConvert: () => void }) {
  const groupLabel = words('catalogue.groups')

  return (
    <div className="flex flex-col">
      <div className="px-2 pb-0.5 pt-2 text-caption font-medium text-fg-muted">
        {groupLabel('code')}
      </div>
      <div className="flex items-start gap-2 px-2 pb-1.5 text-caption text-fg-muted">
        <Icon name="lock" size={13} className="mt-0.5 shrink-0" />
        <span>
          <b className="font-medium text-fg">
            {t('features.pipelineSimple.catalogue.codeTitle')}
          </b>
          <br />
          {t('features.pipelineSimple.catalogue.needsStandard')} ·{' '}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-caption text-link underline"
            onClick={onConvert}
          >
            {t('features.pipelineSimple.catalogue.convert')}
          </button>
        </span>
      </div>
    </div>
  )
}
