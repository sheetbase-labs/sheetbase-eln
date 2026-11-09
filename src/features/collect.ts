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
  return features.reduce<Record<string, string>>(
    (labels, feature) => Object.assign(labels, feature.eventLabels),
    {},
  )
}

export function featureLabTables(): Record<string, LabTable> {
  return features.reduce<Record<string, LabTable>>(
    (tables, feature) => Object.assign(tables, feature.labTables),
    {},
  )
}

export function featureNotExposed(): Record<string, string> {
  return features.reduce<Record<string, string>>(
    (exemptions, feature) => Object.assign(exemptions, feature.notExposed),
    {},
  )
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
