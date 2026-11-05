/**
 * The English catalogue: every piece of text the app shows. Each area of
 * the app has its own file, and this index joins them. English is the
 * source language, so its exact strings decide the shape every other
 * language must match.
 */
import { calculators } from './calculators'
import { common } from './common'
import { data } from './data'
import { library } from './library'
import { notebook } from './notebook'
import { projects } from './projects'
import { registry } from './registry'
import { safety } from './safety'
import { sequences } from './sequences'
import { settings } from './settings'

export const en = {
  common,
  calculators,
  notebook,
  data,
  library,
  settings,
  projects,
  registry,
  sequences,
  safety,
} as const
