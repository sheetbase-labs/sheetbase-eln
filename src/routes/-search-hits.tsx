import { SemanticHitsTable } from '#/components/search/semantic-hits'
import { PluginHitsTable } from '#/components/search/plugin-hits'
import type { SemanticHit } from '#/lib/ai-embeddings'
import type { PluginSearchHit } from '#/lib/extensions/plugin-search.server'
import { t } from '#/copy'

/**
 * What the words missed but the meaning caught, under the word results. The
 * section is only mounted where search by meaning is switched on.
 */
export function MeaningSection({
  pending,
  extras,
  used,
  message,
}: {
  pending: boolean
  extras: SemanticHit[]
  used: boolean | undefined
  message: string | undefined
}) {
  return (
    <section
      className="mb-6 flex flex-col gap-2"
      aria-label={t('projects.searchMeaning.heading')}
      data-testid="search-by-meaning"
    >
      <div className="flex items-baseline gap-2 px-4 md:px-6">
        <h2 className="m-0 text-body font-medium text-fg">
          {t('projects.searchMeaning.heading')}
        </h2>
        <span className="text-label text-fg-muted">
          {t('projects.searchMeaning.headingNote')}
        </span>
      </div>
      {pending ? null : extras.length > 0 ? (
        <div
          className="shrink-0"
          style={{
            height: Math.min(extras.length * 46 + 48, 460),
          }}
        >
          <SemanticHitsTable
            hits={extras}
            label={t('projects.searchMeaning.heading')}
          />
        </div>
      ) : (
        <p className="m-0 px-4 text-label text-fg-muted md:px-6">
          {used === false ? message : t('projects.searchMeaning.nothingYet')}
        </p>
      )}
    </section>
  )
}

/** What the workspace's search plugins found, with anything they could not do. */
export function PluginsSection({
  pending,
  hits,
  problems,
}: {
  pending: boolean
  hits: PluginSearchHit[]
  problems: string[]
}) {
  return (
    <section
      className="mt-6 mb-6 flex flex-col gap-2"
      aria-label={t('plugins.search.heading')}
      data-testid="search-by-plugins"
    >
      <div className="flex items-baseline gap-2 px-4 md:px-6">
        <h2 className="m-0 text-body font-medium text-fg">
          {t('plugins.search.heading')}
        </h2>
        <span className="text-label text-fg-muted">
          {t('plugins.search.headingNote')}
        </span>
      </div>
      {pending ? null : hits.length > 0 ? (
        <div
          className="shrink-0"
          style={{
            height: Math.min(hits.length * 46 + 48, 460),
          }}
        >
          <PluginHitsTable hits={hits} label={t('plugins.search.heading')} />
        </div>
      ) : (
        <p className="m-0 px-4 text-label text-fg-muted md:px-6">
          {t('plugins.search.nothing')}
        </p>
      )}
      {problems.map((problem) => (
        <p
          key={problem}
          className="m-0 px-4 text-label text-warning-text md:px-6"
        >
          {problem}
        </p>
      ))}
    </section>
  )
}
