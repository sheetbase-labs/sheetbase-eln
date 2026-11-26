import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { ReportsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runReportsAction(
  client: Pick<DataClient, 'rpc'>,
  action: ReportsAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'report.create': {
      const made = await client.rpc<{ id: string; record_id: string }>(
        'create_report_definition',
        {
          p_workspace_id: action.workspaceId,
          p_title: action.title,
          p_subtitle: action.subtitle,
          p_project_id: action.projectId,
          p_template_record_id: null,
        },
      )

      return { openHref: `/reports/${made.record_id}` }
    }

    case 'report.update':
      await client.rpc('update_report_definition', {
        p_workspace_id: action.workspaceId,
        p_report_id: action.id,
        p_title: action.title,
        p_subtitle: action.subtitle,
        p_status: action.status,
      })

      return undefined

    case 'report.section_add':
      await client.rpc('add_report_section', {
        p_workspace_id: action.workspaceId,
        p_report_id: action.reportId,
        p_title: action.title,
        p_description: action.description,
        p_section_type: action.sectionType,
        p_source_type: 'free_text',
      })

      return undefined

    case 'report.section_update':
      await client.rpc('update_report_section', {
        p_workspace_id: action.workspaceId,
        p_section_id: action.sectionId,
        p_title: action.title,
        p_description: action.description,
        p_section_type: action.sectionType,
        p_position: action.position,
      })

      return undefined

    case 'report.section_bind':
      await client.rpc('bind_report_section_source', {
        p_workspace_id: action.workspaceId,
        p_section_id: action.sectionId,
        p_source_revision_id: action.revisionId,
        p_source_ref: action.source,
      })

      return undefined

    case 'report.section_remove':
      await client.rpc('remove_report_section', {
        p_workspace_id: action.workspaceId,
        p_section_id: action.sectionId,
      })

      return undefined

    case 'report.sections_reorder':
      await client.rpc('reorder_report_sections', {
        p_workspace_id: action.workspaceId,
        p_report_id: action.reportId,
        p_section_ids: action.sectionIds,
      })

      return undefined

    case 'report.schedule_save':
      await client.rpc('save_scheduled_report', {
        p_id: action.id,
        p_name: action.name,
        p_kind: action.reportKind,
        p_project_id:
          action.reportKind === 'instrument_usage' ? null : action.projectId,
        p_period: action.period,
        p_open_hours: action.openHours,
        p_frequency: action.frequency,
        p_weekday: action.weekday,
        p_month_day: action.monthDay,
        p_send_hour: action.sendHour,
        p_time_zone: action.timeZone,
        p_recipient_user_ids: action.recipientUserIds,
        p_active: action.active,
      })

      return undefined

    case 'report.schedule_active':
      await client.rpc('set_scheduled_report_active', {
        p_id: action.id,
        p_active: action.active,
      })

      return undefined

    case 'report.schedule_send':
      await client.rpc('send_scheduled_report_now', { p_id: action.id })

      return undefined

    case 'report.schedule_delete':
      await client.rpc('delete_scheduled_report', { p_id: action.id })

      return undefined
  }
}
