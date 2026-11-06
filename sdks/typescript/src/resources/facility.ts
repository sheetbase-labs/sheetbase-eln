/**
 * Facility resource — suppliers, order prices, instrument rates, spend and
 * usage reports and scheduled reports.
 *
 * Reads need the `facility:read` scope and writes `facility:write`. Money is
 * per currency: totals are never converted between currencies.
 */
import type { HttpTransport } from '../http.js'

export class FacilityResource {
  constructor(private transport: HttpTransport) {}

  async createSupplierModel(params: {
    key: string
    name: string
    prefix: string
    description: string
    fields: unknown
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_key: params.key,
      p_name: params.name,
      p_prefix: params.prefix,
      p_description: params.description,
      p_fields: params.fields,
    }
    return this.transport.post('/api/db/rpc/create_supplier_model', {
      jsonBody: body,
    })
  }

  async setModelSupplierList(params: {
    modelKey: string
    enabled: boolean
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_model_key: params.modelKey,
      p_enabled: params.enabled,
    }
    return this.transport.post('/api/db/rpc/set_model_supplier_list', {
      jsonBody: body,
    })
  }

  async setReagentOrderPrice(params: {
    orderId: string
    totalPrice: number
    currency?: string
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_order_id: params.orderId,
      p_total_price: params.totalPrice,
    }
    if (params.currency !== undefined) body.p_currency = params.currency
    return this.transport.post('/api/db/rpc/set_reagent_order_price', {
      jsonBody: body,
    })
  }

  async setInstrumentRate(params: {
    instrumentId: string
    ratePerHour: number
    currency?: string
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_instrument_id: params.instrumentId,
      p_rate_per_hour: params.ratePerHour,
    }
    if (params.currency !== undefined) body.p_currency = params.currency
    return this.transport.post('/api/db/rpc/set_instrument_rate', {
      jsonBody: body,
    })
  }

  async reportSpendLines(params: {
    workspaceId: string
    from: string
    to: string
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: params.workspaceId,
      p_from: params.from,
      p_to: params.to,
    }
    return this.transport.post('/api/db/rpc/report_spend_lines', {
      jsonBody: body,
    })
  }

  async reportUsageLines(params: {
    workspaceId: string
    from: string
    to: string
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: params.workspaceId,
      p_from: params.from,
      p_to: params.to,
    }
    return this.transport.post('/api/db/rpc/report_usage_lines', {
      jsonBody: body,
    })
  }

  async reportProjectStatus(params: {
    workspaceId: string
    projectId?: string
    from: string
    to: string
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: params.workspaceId,
      p_from: params.from,
      p_to: params.to,
    }
    if (params.projectId !== undefined) body.p_project_id = params.projectId
    return this.transport.post('/api/db/rpc/report_project_status', {
      jsonBody: body,
    })
  }

  async saveScheduledReport(params: {
    id?: string
    name: string
    kind: string
    projectId?: string
    period: string
    openHours?: unknown
    frequency: string
    weekday?: number
    monthDay?: number
    sendHour?: number
    timeZone?: string
    recipientUserIds: unknown
    active?: boolean
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_name: params.name,
      p_kind: params.kind,
      p_period: params.period,
      p_frequency: params.frequency,
      p_recipient_user_ids: params.recipientUserIds,
    }
    if (params.id !== undefined) body.p_id = params.id
    if (params.projectId !== undefined) body.p_project_id = params.projectId
    if (params.openHours !== undefined) body.p_open_hours = params.openHours
    if (params.weekday !== undefined) body.p_weekday = params.weekday
    if (params.monthDay !== undefined) body.p_month_day = params.monthDay
    if (params.sendHour !== undefined) body.p_send_hour = params.sendHour
    if (params.timeZone !== undefined) body.p_time_zone = params.timeZone
    if (params.active !== undefined) body.p_active = params.active
    return this.transport.post('/api/db/rpc/save_scheduled_report', {
      jsonBody: body,
    })
  }

  async setScheduledReportActive(params: {
    id: string
    active: boolean
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_id: params.id,
      p_active: params.active,
    }
    return this.transport.post('/api/db/rpc/set_scheduled_report_active', {
      jsonBody: body,
    })
  }

  async sendScheduledReportNow(params: { id: string }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_id: params.id,
    }
    return this.transport.post('/api/db/rpc/send_scheduled_report_now', {
      jsonBody: body,
    })
  }

  async deleteScheduledReport(params: { id: string }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_id: params.id,
    }
    return this.transport.post('/api/db/rpc/delete_scheduled_report', {
      jsonBody: body,
    })
  }
}
