/**
 * What every feature folder declares, gathered for the shared surfaces. The
 * surfaces (operation registry, event catalogue, API tables, agent policy,
 * assistant) read these instead of a list each feature would edit.
 */
import type { EventCatalogueEntry } from '#/lib/event-catalogue'
import type { LabTable } from '#/lib/lab-api-surface'
import type { OperationDescriptor } from '#/lib/operations/descriptor'
import type { Feature, FeatureAgentArea } from './define'
import { FEATURES } from './index.gen'

const features: readonly Feature[] = FEATURES

export function featureOperations(): OperationDescriptor[] {
  return features.flatMap((feature) => feature.operations ?? [])
}

export function featureEvents(): EventCatalogueEntry[] {
  return features.flatMap((feature) => feature.events ?? [])
}

export function featureEventLabels(): Record<string, string> {
  return Object.assign(
    {},
    ...features.map((feature) => feature.eventLabels ?? {}),
  ) as Record<string, string>
}

export function featureLabTables(): Record<string, LabTable> {
  return Object.assign(
    {},
    ...features.map((feature) => feature.labTables ?? {}),
  ) as Record<string, LabTable>
}

export function featureNotExposed(): Record<string, string> {
  return Object.assign(
    {},
    ...features.map((feature) => feature.notExposed ?? {}),
  ) as Record<string, string>
}

export function featureAgentAreas(): FeatureAgentArea[] {
  return features.flatMap((feature) =>
    feature.agentArea ? [feature.agentArea] : [],
  )
}

export function featureAgentDeletes(): string[] {
  return features.flatMap((feature) => feature.agentMayDelete ?? [])
}

export function featureAssistantReadTools(): string[] {
  return features.flatMap((feature) => feature.assistantReadTools ?? [])
}
