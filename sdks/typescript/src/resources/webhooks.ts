/** Webhook subscription, delivery-history and replay resources. */
import type { HttpTransport } from "../http.js";

export class WebhooksResource {
  constructor(private transport: HttpTransport) {}

  async listSubscriptions(options?: {
    params?: Record<string, string | number | undefined>;
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get("/api/db/webhook_subscriptions", options);
  }

  async listDeliveryRows(options?: {
    params?: Record<string, string | number | undefined>;
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get("/api/db/webhook_deliveries", options);
  }

  async createSubscription(params: {
    workspaceId: string;
    key: string;
    url: string;
    eventTypes?: string[];
    description?: string;
    maxRetries?: number;
    failureThreshold?: number;
    signingSecret?: string;
    rateLimitPerMinute?: number;
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: params.workspaceId,
      p_key: params.key,
      p_url: params.url,
    };
    if (params.eventTypes !== undefined) body.p_event_types = params.eventTypes;
    if (params.description !== undefined)
      body.p_description = params.description;
    if (params.maxRetries !== undefined) body.p_max_retries = params.maxRetries;
    if (params.failureThreshold !== undefined) {
      body.p_failure_threshold = params.failureThreshold;
    }
    if (params.signingSecret !== undefined)
      body.p_signing_secret = params.signingSecret;
    if (params.rateLimitPerMinute !== undefined) {
      body.p_rate_limit_per_minute = params.rateLimitPerMinute;
    }
    return this.transport.post("/api/db/rpc/create_webhook_subscription", {
      jsonBody: body,
    });
  }

  async updateSubscription(params: {
    workspaceId: string;
    subscriptionId: string;
    url?: string;
    eventTypes?: string[];
    description?: string;
    status?: string;
    maxRetries?: number;
    failureThreshold?: number;
    rateLimitPerMinute?: number;
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: params.workspaceId,
      p_subscription_id: params.subscriptionId,
    };
    if (params.url !== undefined) body.p_url = params.url;
    if (params.eventTypes !== undefined) body.p_event_types = params.eventTypes;
    if (params.description !== undefined)
      body.p_description = params.description;
    if (params.status !== undefined) body.p_status = params.status;
    if (params.maxRetries !== undefined) body.p_max_retries = params.maxRetries;
    if (params.failureThreshold !== undefined) {
      body.p_failure_threshold = params.failureThreshold;
    }
    if (params.rateLimitPerMinute !== undefined) {
      body.p_rate_limit_per_minute = params.rateLimitPerMinute;
    }
    return this.transport.post("/api/db/rpc/update_webhook_subscription", {
      jsonBody: body,
    });
  }

  async deleteSubscription(
    workspaceId: string,
    subscriptionId: string,
  ): Promise<unknown> {
    return this.transport.post("/api/db/rpc/delete_webhook_subscription", {
      jsonBody: {
        p_workspace_id: workspaceId,
        p_subscription_id: subscriptionId,
      },
    });
  }

  async rotateSecret(
    workspaceId: string,
    subscriptionId: string,
    newSecret?: string,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: workspaceId,
      p_subscription_id: subscriptionId,
    };
    if (newSecret !== undefined) body.p_new_secret = newSecret;
    return this.transport.post("/api/db/rpc/rotate_webhook_secret", {
      jsonBody: body,
    });
  }

  async listDeliveries(params: {
    workspaceId: string;
    subscriptionId?: string;
    status?: string;
    eventType?: string;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: params.workspaceId,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    };
    if (params.subscriptionId !== undefined) {
      body.p_subscription_id = params.subscriptionId;
    }
    if (params.status !== undefined) body.p_status = params.status;
    if (params.eventType !== undefined) body.p_event_type = params.eventType;
    if (params.since !== undefined) body.p_since = params.since;
    if (params.until !== undefined) body.p_until = params.until;
    return this.transport.post("/api/db/rpc/list_webhook_deliveries", {
      jsonBody: body,
    });
  }

  async replayDelivery(
    workspaceId: string,
    deliveryId: string,
  ): Promise<unknown> {
    return this.transport.post("/api/db/rpc/replay_webhook_delivery", {
      jsonBody: {
        p_workspace_id: workspaceId,
        p_delivery_id: deliveryId,
      },
    });
  }

  async replayDeliveries(params: {
    workspaceId: string;
    subscriptionId?: string;
    since?: string;
    until?: string;
    status?: string;
    limit?: number;
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: params.workspaceId,
    };
    if (params.subscriptionId !== undefined) {
      body.p_subscription_id = params.subscriptionId;
    }
    if (params.since !== undefined) body.p_since = params.since;
    if (params.until !== undefined) body.p_until = params.until;
    if (params.status !== undefined) body.p_status = params.status;
    if (params.limit !== undefined) body.p_limit = params.limit;
    return this.transport.post("/api/db/rpc/replay_webhook_deliveries", {
      jsonBody: body,
    });
  }

  async endpointHealth(
    workspaceId: string,
    subscriptionId?: string,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: workspaceId,
    };
    if (subscriptionId !== undefined) body.p_subscription_id = subscriptionId;
    return this.transport.post("/api/db/rpc/get_webhook_endpoint_health", {
      jsonBody: body,
    });
  }
}
