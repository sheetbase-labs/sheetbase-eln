import { useQuery } from '@tanstack/react-query'

import {
  fetchWorkspaceMemberIdentities,
  workspaceMemberQueryKeys,
} from '#/components/projects/project-data'
import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'
import { displayModelFieldValue } from '#/lib/model-fields'
import { RecordLinkValue } from '#/components/datasets/record-link-value'
import { linkedRecordIds, useRecordLinkLabels } from '#/lib/record-link-labels'

/**
 * Workspace members' names by user id, read only when a person field is on
 * screen. Shares its cache with every other screen that names members.
 */
export function usePersonNames(enabled: boolean) {
  return useQuery({
    queryKey: workspaceMemberQueryKeys.identities,
    queryFn: fetchWorkspaceMemberIdentities,
    select: (members) =>
      new Map(members.map((member) => [member.user_id, member.name])),
    staleTime: 60_000,
    enabled,
  }).data
}

const NO_PEOPLE: ReadonlyArray<{ id: string; label: string }> = []

/**
 * The people a person field can hold, as picker options: the workspace's own
 * members, not client guests, matching `internal.lab_is_workspace_person`.
 */
export function usePeopleOptions(enabled: boolean) {
  return (
    useQuery({
      queryKey: workspaceMemberQueryKeys.identities,
      queryFn: fetchWorkspaceMemberIdentities,
      select: (members) =>
        members
          .filter((member) => member.client_id == null)
          .map((member) => ({ id: member.user_id, label: member.name }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      staleTime: 60_000,
      enabled,
    }).data ?? NO_PEOPLE
  )
}

const NO_IDS: readonly string[] = []

/**
 * A field value as text, with person fields shown by name and links (File
 * fields among them) as the linked record.
 */
export function ModelFieldValueText({
  field,
  value,
}: {
  field: ModelFieldDefinition
  value: ModelFieldRecordValues['customFields'][string] | undefined
}) {
  const people = usePersonNames(field.logicalType === 'person')
  const isLink = field.logicalType === 'reference'
  const labels = useRecordLinkLabels(isLink ? linkedRecordIds([value]) : NO_IDS)

  if (isLink && value != null && value !== '')
    return <RecordLinkValue value={value} labels={labels.data ?? {}} />

  return displayModelFieldValue(field, value, people)
}
