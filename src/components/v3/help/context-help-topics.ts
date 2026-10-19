import type { LinkProps } from '@tanstack/react-router'

/**
 * Contextual help: a short explanation of the page you are on, with a link to
 * the longer help when there is one. Matching is by path prefix, most specific
 * first, so a page with nothing written for it falls back to no help rather
 * than to a wrong explanation.
 */
export interface ContextHelpTopic {
  title: string
  /** One or two plain sentences; nothing here is a promise about data. */
  text: string
  /** Where the longer explanation lives, when it does. */
  more?: { label: string; link: LinkProps }
}

const RECORDS_MORE = {
  label: 'How records, reviews and signatures work',
  link: { to: '/help/records' } as LinkProps,
}

const TOPICS: ReadonlyArray<{
  prefix: string
  topic: ContextHelpTopic
}> = [
  {
    prefix: '/settings/clients',
    topic: {
      title: 'Clients',
      text: 'A client organisation sees only the approved records you share with it, read-only, in the client portal. Preview shows exactly what its portal lists.',
    },
  },
  {
    prefix: '/settings/access',
    topic: {
      title: 'Project access',
      text: 'Projects are private to their lead until a rule names a person or group. The QA default gives one group view-only access to projects created after it is set.',
    },
  },
  {
    prefix: '/settings/audit',
    topic: {
      title: 'Audit and retention',
      text: 'Every change is recorded with who made it, when and why. Filter by record or by day range to follow one record’s history.',
    },
  },
  {
    prefix: '/settings/api',
    topic: {
      title: 'API and SDK',
      text: 'Personal tokens are for your own scripts and tools. The example request shows how to call the API with one.',
    },
  },
  {
    prefix: '/pipelines/runs',
    topic: {
      title: 'Pipeline run',
      text: 'A run records its inputs, parameters and log. A run that stopped can be retried on the version it used, or on the current version with the same inputs.',
    },
  },
  {
    prefix: '/pipelines',
    topic: {
      title: 'Pipelines',
      text: 'A pipeline turns datasets into a new snapshot. Triggers start runs of the published version; a confirm step pauses for a person before anything is applied.',
    },
  },
  {
    prefix: '/analysis',
    topic: {
      title: 'Analysis studio',
      text: 'Draw a figure from a dataset, set axis titles, units, ranges and a caption, export it as PNG or SVG, or cite it in a notebook as a frozen version.',
    },
  },
  {
    prefix: '/evidence',
    topic: {
      title: 'Signed evidence',
      text: 'The record as it was signed, with its signatures and any drift since in the side panel. Export a PDF for internal use.',
      more: RECORDS_MORE,
    },
  },
  {
    prefix: '/review',
    topic: {
      title: 'Review',
      text: 'Read what the author submitted, then sign it as approved or return it with comments. Amending a signed record needs a reason.',
      more: RECORDS_MORE,
    },
  },
  {
    prefix: '/search',
    topic: {
      title: 'Search',
      text: 'Search records, datasets, samples, projects, pipelines and analyses. Narrow by owner and date, and save a search to run it again.',
      more: {
        label: 'Keyboard shortcuts',
        link: { to: '/help/shortcuts' },
      },
    },
  },
  {
    prefix: '/experiments',
    topic: {
      title: 'Experiments',
      text: 'An experiment is a notebook record. It saves as you write; submit it for review when it is ready, and a signature locks it.',
      more: RECORDS_MORE,
    },
  },
  {
    prefix: '/datasets',
    topic: {
      title: 'Datasets',
      text: 'A dataset keeps its rows in versions. Pipelines and analyses read a pinned version, so results stay reproducible.',
    },
  },
  {
    prefix: '/client-portal',
    topic: {
      title: 'Client portal',
      text: 'The approved records and projects shared with your organisation. Everything here is read-only.',
    },
  },
]

/** The help for a path, or null when nothing is written for that page. */
export function contextHelpFor(pathname: string): ContextHelpTopic | null {
  for (const { prefix, topic } of TOPICS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return topic
  }
  return null
}
