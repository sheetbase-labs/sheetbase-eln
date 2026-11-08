/**
 * What plugin hooks left on a record: summaries, holds and sign-off steps.
 * Read through the person's own access (row-level security); a sign-off is
 * pressed by a person and checked by the database.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

export interface PluginSummary {
  extension_key: string
  extension_name: string
  hook_id: string
  summary: string
  updated_at: string
}

export interface PluginFlag {
  id: string
  extension_key: string
  extension_name: string
  flag_key: string
  kind: 'flag' | 'sign_off'
  title: string
  message: string
  roles: string[]
  approvals_needed: number
  independent: boolean
  raised_by_user_id: string | null
  raised_at: string
  /** How many people have signed so far (sign-offs only). */
  signed: number
  /** True when the signed-in person has already pressed it. */
  signedByMe: boolean
}

export interface PluginRecordState {
  summaries: PluginSummary[]
  flags: PluginFlag[]
}

interface FlagWire extends Omit<PluginFlag, 'signed' | 'signedByMe'> {
  plugin_flag_sign_offs?: Array<{ signer_user_id: string }>
}

export const pluginRecordKeys = {
  record: (recordId: string) => ['plugin-record', recordId] as const,
}

export async function fetchPluginRecordState(
  client: DataClient,
  recordId: string,
  myUserId: string | null,
): Promise<PluginRecordState> {
  const [summaries, flags] = await Promise.all([
    client.list<PluginSummary>(
      'plugin_record_outputs',
      `?select=extension_key,extension_name,hook_id,summary,updated_at` +
        `&record_id=eq.${recordId}&order=updated_at.desc`,
    ),
    client.list<FlagWire>(
      'plugin_flags',
      `?select=id,extension_key,extension_name,flag_key,kind,title,message,roles,approvals_needed,independent,raised_by_user_id,raised_at,plugin_flag_sign_offs(signer_user_id)` +
        `&record_id=eq.${recordId}&state=eq.open&order=raised_at.asc`,
    ),
  ])
  return {
    summaries,
    flags: flags.map(({ plugin_flag_sign_offs, ...flag }) => ({
      ...flag,
      signed: plugin_flag_sign_offs?.length ?? 0,
      signedByMe: Boolean(
        myUserId &&
        plugin_flag_sign_offs?.some((s) => s.signer_user_id === myUserId),
      ),
    })),
  }
}

export function usePluginRecordState(
  recordId: string,
  myUserId: string | null,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: pluginRecordKeys.record(recordId),
    queryFn: () => fetchPluginRecordState(client, recordId, myUserId),
    staleTime: 10_000,
  })
}

export function useSignOffPluginStep(
  recordId: string,
  client: DataClient = notebookDataClient,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: { flagId: string; comment?: string }) =>
      client.rpc('sign_off_plugin_step', {
        p_flag_id: args.flagId,
        p_comment: args.comment ?? null,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: pluginRecordKeys.record(recordId),
      }),
  })
}
