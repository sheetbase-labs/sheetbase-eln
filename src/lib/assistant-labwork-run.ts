import type { DataClient } from './data-client'
import { setFavourite } from './favourites'
import {
  applyRetention,
  createLegalHold,
  releaseLegalHold,
  saveFieldLimits,
  saveRetentionRule,
} from './result-quality'
import { createRegistryEntry } from './bio-registry'
import { setBookingRules } from './booking-rules'
import { endRepeat, setRepeatPaused } from './recurring'
import { poolSamples } from './samples'
import { saveSearchOnAccount } from './search'
import { enrolSample, leaveRun } from './sample-workflows'
import { prepareSolution } from './solution-prep'
import { completeStocktake, startStocktake } from './stocktake'
import { endStepTimer } from './step-timers'
import { requestShellRefresh } from './shell-refresh'
import type { LabworkAction, LabworkActionResult } from './assistant-labwork'

/** Runs a lab-work card's action. Loaded only in the browser, when a button is pressed. */

async function sendLogo(method: 'PUT' | 'DELETE', body?: Blob): Promise<void> {
  const response = await fetch('/api/workspace-logo', {
    method,
    body,
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(
      response.status === 413
        ? 'The logo must be under 1 MB.'
        : response.status === 415
          ? 'Use a PNG or JPEG image.'
          : response.status === 401 || response.status === 403
            ? 'Only an administrator can change the lab logo.'
            : 'The logo could not be saved.',
    )
  }
  requestShellRefresh()
}

const PIN_HREF = {
  record: (id: string) => `/records/${id}`,
  project: (id: string) => `/projects/${id}`,
  instrument: () => '/instruments',
  pipeline: (id: string) => `/pipelines/${id}`,
} as const

export async function runLabworkAction(
  client: DataClient,
  action: LabworkAction,
): Promise<LabworkActionResult | undefined> {
  switch (action.kind) {
    case 'stocktake.start': {
      const made = await startStocktake(client, {
        level: action.level,
        scopeId: action.scopeId,
        note: action.note,
      })
      return { openHref: `/stocktake/${made.id}` }
    }
    case 'stocktake.complete':
      await completeStocktake(client, action.stocktakeId)
      return { openHref: `/stocktake/${action.stocktakeId}` }
    case 'hold.create':
      await createLegalHold(client, {
        name: action.name,
        reason: action.reason,
        projectId: action.projectId,
        kind: action.recordKind,
      })
      return { openHref: '/settings/lab/retention' }
    case 'hold.release':
      await releaseLegalHold(client, action.holdId, action.note)
      return { openHref: '/settings/lab/retention' }
    case 'retention.set':
      await saveRetentionRule(
        client,
        action.recordKind,
        action.keepMonths,
        action.note,
      )
      return { openHref: '/settings/lab/retention' }
    case 'retention.apply':
      if (action.recordKind === null) await applyRetention(client)
      else {
        await client.rpc('apply_retention', { p_kind: action.recordKind })
      }
      return { openHref: '/settings/lab/retention' }
    case 'registry.add': {
      const made = await createRegistryEntry<{ id: string } | null>(client, {
        projectId: action.projectId,
        kind: action.recordKind,
        title: action.title,
        customFields: action.customFields,
        allowDuplicate: false,
      })
      return { openHref: made?.id ? `/records/${made.id}` : '/registry' }
    }
    case 'workflow.enrol':
      await enrolSample(client, action.sampleId, action.workflowId)
      return { openHref: `/records/${action.sampleId}` }
    case 'workflow.leave':
      await leaveRun(client, action.runId)
      return { openHref: `/records/${action.sampleId}` }
    case 'limits.set':
      await saveFieldLimits(
        client,
        action.recordKind,
        action.fieldName,
        {
          lowerLimit: action.lowerLimit,
          upperLimit: action.upperLimit,
          alertLower: action.alertLower,
          alertUpper: action.alertUpper,
        },
        action.note,
      )
      return { openHref: '/models' }
    case 'booking_rules.set':
      await setBookingRules(client, {
        instrumentId: action.instrumentId,
        protocolIds: action.protocolIds,
        maxBookingMinutes: action.maxBookingMinutes,
        maxAdvanceDays: action.maxAdvanceDays,
      })
      return { openHref: '/instruments' }
    case 'timer.end':
      await endStepTimer(action.timerId, client)
      return action.recordId
        ? { openHref: `/records/${action.recordId}` }
        : undefined
    case 'recurring.pause':
      await setRepeatPaused(client, action.scheduleId, action.paused)
      return { openHref: '/schedule' }
    case 'recurring.end':
      await endRepeat(client, action.scheduleId, action.cancelUpcoming)
      return { openHref: '/schedule' }
    case 'sample.pool': {
      const made = await poolSamples(client, {
        sources: action.sources,
        purposeExperimentId: action.experimentId,
        unit: action.unit ?? undefined,
        notes: action.notes ?? undefined,
        newContainer:
          action.poolName || action.storageLocation
            ? {
                title: action.poolName ?? undefined,
                storageLocation: action.storageLocation ?? undefined,
              }
            : undefined,
      })
      return { openHref: `/records/${made.pool.id}` }
    }
    case 'solution.prepare': {
      const made = await prepareSolution(client, {
        projectId: action.projectId,
        title: action.title,
        lot: action.lot,
        quantity: action.quantity,
        unit: action.unit,
        expiry: action.expiry,
        storage: action.storage,
        note: action.note,
        ingredients: action.ingredients,
      })
      return { openHref: `/records/${made.id}` }
    }
    case 'search.save':
      await saveSearchOnAccount(
        client,
        action.name,
        { q: action.words },
        action.visibility,
      )
      return { openHref: '/saved-searches' }
    case 'pin.set':
      await setFavourite(client, action.target, action.id, action.pinned)
      return { openHref: PIN_HREF[action.target](action.id) }
    case 'logo.set': {
      const response = await fetch(
        `/api/files/${encodeURIComponent(action.fileRecordId)}/download`,
        { credentials: 'same-origin' },
      )
      if (!response.ok) {
        throw new Error(
          `The image could not be read (${response.status}). Upload it to the lab first.`,
        )
      }
      await sendLogo('PUT', await response.blob())
      return { openHref: '/settings/workspace' }
    }
    case 'logo.remove':
      await sendLogo('DELETE')
      return { openHref: '/settings/workspace' }
  }
}
