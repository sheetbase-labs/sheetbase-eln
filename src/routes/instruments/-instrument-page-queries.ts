import { useQuery } from '@tanstack/react-query'

import {
  findInstrumentConnector,
  intakeSetupQueryKeys,
} from '#/lib/connectors/intake-setup'
import {
  fetchParserSettings,
  parserSettingsQueryKeys,
} from '#/lib/parser-settings'
import { createDataClient } from '#/lib/data-client'
import {
  fetchOpenQualificationRequests,
  qualificationRequestsQueryKey,
} from '#/lib/instrument-qualification-requests'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  useInstrument,
  useInstrumentCalibrations,
  useInstrumentHistory,
  useInstrumentLastImport,
  useInstrumentNextBooking,
  useInstrumentParsers,
  useInstrumentRuns,
  useInstrumentUsedBy,
  useInstrumentWeek,
} from '#/components/instruments/instruments-data'

import type { QualificationRow } from './-instrument-columns'
import { qualificationQueryKey } from './-instrument-queries'

const intakeDataClient = createDataClient()

/**
 * Every read the instrument record makes: the instrument and its runs,
 * calibrations, parsers, last import, next booking, history and users, plus the
 * certificate projects, intake connector, qualifications and open requests.
 */
export function useInstrumentPageQueries({
  instrumentId,
  workspaceId,
  canCalibrate,
  canQualify,
  recordOpen,
}: {
  instrumentId: string
  workspaceId: string
  canCalibrate: boolean
  canQualify: boolean
  recordOpen: boolean
}) {
  const instrument = useInstrument(instrumentId)
  const runs = useInstrumentRuns(instrumentId)
  const calibrations = useInstrumentCalibrations(instrumentId)
  const parsers = useInstrumentParsers(instrumentId)
  const lastImport = useInstrumentLastImport(instrumentId)
  const booking = useInstrumentNextBooking(instrumentId)
  const history = useInstrumentHistory(instrumentId)
  const usedBy = useInstrumentUsedBy(instrumentId)
  const week = useInstrumentWeek(instrumentId)

  const projects = useQuery({
    queryKey: ['ui-port', 'instrument-certificate-projects'],
    enabled: canCalibrate && recordOpen,
    queryFn: () =>
      notebookDataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
    staleTime: 60_000,
  })

  const intakeConnector = useQuery({
    queryKey: intakeSetupQueryKeys.connector(instrumentId),
    enabled: instrumentId.length > 0 && workspaceId.length > 0,
    queryFn: () => findInstrumentConnector(intakeDataClient, instrumentId),
    staleTime: 15_000,
  })

  const intakeParsers = useQuery({
    queryKey: parserSettingsQueryKeys.list(workspaceId),
    enabled: workspaceId.length > 0 && Boolean(intakeConnector.data?.parser_id),
    queryFn: () => fetchParserSettings(intakeDataClient, workspaceId),
  })

  const qualifications = useQuery({
    queryKey: qualificationQueryKey(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () =>
      notebookDataClient.rpc<QualificationRow[]>(
        'instrument_qualification_list',
        { p_instrument_id: instrumentId },
      ),
    staleTime: 15_000,
  })

  const members = useQuery({
    queryKey: ['ui-port', 'workspace-operators', workspaceId],
    enabled: canQualify && workspaceId.length > 0,
    queryFn: () =>
      notebookDataClient.list<{ user_id: string }>(
        'workspace_memberships',
        `?workspace_id=eq.${encodeURIComponent(workspaceId)}&suspended_at=is.null&select=user_id&order=created_at.asc`,
      ),
    staleTime: 60_000,
  })

  // People who have asked to be qualified: an owner sees everyone's open
  // requests, anyone else only their own (the table's policy decides).
  const openRequests = useQuery({
    queryKey: qualificationRequestsQueryKey(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () =>
      fetchOpenQualificationRequests(notebookDataClient, instrumentId),
    staleTime: 15_000,
  })

  return {
    instrument,
    runs,
    calibrations,
    parsers,
    lastImport,
    booking,
    history,
    usedBy,
    week,
    projects,
    intakeConnector,
    intakeParsers,
    qualifications,
    members,
    openRequests,
  }
}
