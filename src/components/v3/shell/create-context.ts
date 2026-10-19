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
