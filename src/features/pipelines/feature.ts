/**
 * Pipelines and plugins: making, publishing and retiring pipelines, running,
 * retrying and cancelling runs, their schedules, and switching plugins on and
 * off or removing them, on the API, MCP, the assistant, pipelines and webhooks.
 *
 * The pipeline events themselves stay in the core catalogue, next to the
 * general `pipeline.run.updated` and `pipeline.version.updated` they must be
 * tried before.
 */
import { PIPELINE_LAB_TABLES } from './api-tables'
import { PIPELINES_EXTENSIONS_OPERATIONS } from './operations'
import { WEBHOOK_SSE_PIPELINE, defineFeature } from '../define'

export const feature = defineFeature({
  name: 'pipelines',
  operations: PIPELINES_EXTENSIONS_OPERATIONS,
  events: [
    {
      name: 'extension.installed',
      family: 'administration',
      summary: 'An administrator installed a plugin.',
      producer: {
        entityType: 'extension',
        operation: 'create',
        when: { key: 'change', equals: 'installed' },
      },
      wireName: 'extension.installed',
      status: 'stable',
      introducedIn: 'extensions-05',
      consumers: WEBHOOK_SSE_PIPELINE,
      notes: 'Payload carries `extensionKey`, `name`, `version` and `status`.',
    },
    {
      name: 'extension.updated',
      family: 'administration',
      summary:
        'An administrator installed a new version of a plugin; it comes back switched off until reviewed.',
      producer: {
        entityType: 'extension',
        operation: 'update',
        when: { key: 'change', equals: 'updated' },
      },
      wireName: 'extension.updated',
      status: 'stable',
      introducedIn: 'extensions-05',
      consumers: WEBHOOK_SSE_PIPELINE,
      notes: 'Payload carries `extensionKey`, `version` and `previousVersion`.',
    },
    {
      name: 'extension.enabled',
      family: 'administration',
      summary: 'An administrator switched a plugin on.',
      producer: {
        entityType: 'extension',
        operation: 'update',
        when: { key: 'change', equals: 'enabled' },
      },
      wireName: 'extension.enabled',
      status: 'stable',
      introducedIn: 'extensions-05',
      consumers: WEBHOOK_SSE_PIPELINE,
      notes: 'Payload carries `extensionKey` and `version`.',
    },
    {
      name: 'extension.disabled',
      family: 'administration',
      summary: 'An administrator switched a plugin off.',
      producer: {
        entityType: 'extension',
        operation: 'update',
        when: { key: 'change', equals: 'disabled' },
      },
      wireName: 'extension.disabled',
      status: 'stable',
      introducedIn: 'extensions-05',
      consumers: WEBHOOK_SSE_PIPELINE,
      notes: 'Payload carries `extensionKey` and `version`.',
    },
    {
      name: 'extension.removed',
      family: 'administration',
      summary: 'An administrator removed a plugin.',
      producer: {
        entityType: 'extension',
        operation: 'delete',
        when: { key: 'change', equals: 'removed' },
      },
      wireName: 'extension.removed',
      status: 'stable',
      introducedIn: 'extensions-05',
      consumers: WEBHOOK_SSE_PIPELINE,
      notes:
        'Payload carries `extensionKey` and the `version` that was installed.',
    },
  ],
  eventLabels: {
    'extension.installed': 'A plugin is installed',
    'extension.updated': 'A plugin is updated',
    'extension.enabled': 'A plugin is switched on',
    'extension.disabled': 'A plugin is switched off',
    'extension.removed': 'A plugin is removed',
  },
  labTables: PIPELINE_LAB_TABLES,
  notExposed: {
    start_pipeline_run:
      'Its trigger kind, occurrence and schedule are written by the scheduler and the webhook trigger, so a caller could make a run look scheduled; callers use run_pipeline, run_pipeline_version and retry_pipeline_run, which start the same run as a manual one.',
    answer_pipeline_run_prompt:
      'A run that waits is the pipeline asking a named person to confirm a step; that person answers in the app, so a token or an agent cannot answer for them. The prompts are readable on pipeline_run_prompts.',
    pipeline_run_request_errors:
      'Checks a run request (version, parameters, inputs) before the run starts; the run calls already make it.',
    pipeline_schedule_next_run:
      'Works out when a schedule is next due as it is saved; the schedule calls already make it, and next_run_at is readable on pipeline_schedules.',
    install_extension:
      'The install route stores the plugin’s code with the row; this call alone would make an install with no code. Callers use POST /api/plugins/install, which takes an admin:write token.',
    update_extension:
      'The install route stores the new code with the row; this call alone would change the version without it. Callers use POST /api/plugins/install, which takes an admin:write token.',
    extension_capabilities:
      'Whether a plugin declared a permission, asked by the plugin runtime before each call it makes; the declared permissions are readable on extensions.manifest.',
  },
  // Before the built-in groups, so `cancel_pipeline_run` and the plugin calls
  // are not filed under runs or settings.
  agentArea: {
    area: 'Pipelines and plugins',
    match: /pipeline|extension/,
    beforeCore: true,
  },
  // Deleting a schedule stops future runs only, and the schedule can be added
  // again; removing a plugin can be undone by installing it again.
  agentMayDelete: ['delete_pipeline_schedule'],
})
