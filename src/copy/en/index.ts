/**
 * The English catalogue: every piece of text the app shows. Each area of
 * the app has its own file, and this index joins them. English is the
 * source language, so its exact strings decide the shape every other
 * language must match.
 */
import { account } from './account'
import { agentRequests, agents } from './agents'
import { automation } from './automation'
import { calculators } from './calculators'
import { calendarFeed } from './calendar-feed'
import { common } from './common'
import { data } from './data'
import { library } from './library'
import { notebook } from './notebook'
import { people } from './people'
import { plates } from './plates'
import { projects } from './projects'
import { pwa } from './pwa'
import { quality } from './quality'
import { registry } from './registry'
import { requests } from './requests'
import { safety } from './safety'
import { sequences } from './sequences'
import { shipments } from './shipments'
import { settings } from './settings'
import { spend } from './spend'

export const en = {
  common,
  account,
  agents,
  agentRequests,
  automation,
  people,
  calculators,
  calendarFeed,
  notebook,
  data,
  library,
  settings,
  projects,
  registry,
  quality,
  requests,
  shipments,
  plates,
  sequences,
  safety,
  spend,
  pwa,
} as const
