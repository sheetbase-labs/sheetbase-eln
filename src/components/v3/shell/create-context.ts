/**
 * The record the person is looking at, read from the URL, so the shell's New
 * menu can hand it to the create routes instead of making them ask again.
 */
export interface CreateContext {
  project?: string
  experiment?: string
  sample?: string
  dataset?: string
}

const SEGMENT_TO_KEY = {
  projects: 'project',
  experiments: 'experiment',
  samples: 'sample',
  datasets: 'dataset',
} as const satisfies Record<string, keyof CreateContext>

/** Pull the open project, experiment, sample or Dataset out of a pathname. */
export function createContextFromPath(pathname: string): CreateContext {
  const [segment, id] = pathname.split('/').filter(Boolean)
  const key = (
    SEGMENT_TO_KEY as Record<string, keyof CreateContext | undefined>
  )[segment]
  // `/experiments/new` and the like are routes, not records.
  if (!key || !id || id === 'new') return {}
  return { [key]: decodeURIComponent(id) }
}

/** The search each New-menu destination gets: what the open page is about, and
 * the page itself as `returnTo`, so Cancel and a finished detour come back. */
export function createMenuSearch(pathname: string) {
  const context = createContextFromPath(pathname)
  const returnTo = Object.keys(context).length > 0 ? pathname : undefined
  return {
    experiment: {
      project: context.project,
      sample: context.sample,
      returnTo,
    },
    sample: {
      new: true as const,
      project: context.project,
      experiment: context.experiment,
      returnTo,
    },
    sheet: {
      project: context.project,
      experiment: context.experiment,
      returnTo,
    },
    import: {
      project: context.project,
      experiment: context.experiment,
      dataset: context.dataset,
      returnTo,
    },
  }
}
