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

/** A field value as text, with person fields shown by name. */
export function ModelFieldValueText({
  field,
  value,
}: {
  field: ModelFieldDefinition
  value: ModelFieldRecordValues['customFields'][string] | undefined
}) {
  const people = usePersonNames(field.logicalType === 'person')

  return displayModelFieldValue(field, value, people)
}
