/**
 * Pipeline connections: the https addresses pipeline web call steps may reach,
 * and the names of the secrets they sign with. Operations, API table,
 * assistant cards and events are declared in this folder.
 *
 * Secret values are the one thing kept off every surface: a person types one
 * into Settings, it is sealed, and only the run that calls ever sees it.
 */
import { defineFeature } from '../define'
import { PIPELINE_CONNECTION_LAB_TABLES } from './api-tables'
import { CONNECTIONS_READ_TOOL } from './cards'
import { PIPELINE_CONNECTION_EVENTS } from './events'
import { PIPELINE_CONNECTION_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'pipeline-connections',
  operations: PIPELINE_CONNECTION_OPERATIONS,
  events: PIPELINE_CONNECTION_EVENTS,
  eventLabels: {
    'pipeline_connection.created': 'A pipeline connection is approved',
    'pipeline_connection.updated': 'A pipeline connection is changed',
    'pipeline_connection.deleted': 'A pipeline connection is removed',
  },
  labTables: PIPELINE_CONNECTION_LAB_TABLES,
  agentArea: {
    area: 'Pipelines and plugins',
    match: /pipeline_connection/,
    beforeCore: true,
  },
  assistantReadTools: [CONNECTIONS_READ_TOOL],
})
