/**
 * Agent operation and workflow resources.
 *
 * Operation, plan, budget and provenance values remain canonical wire
 * payloads. PostgreSQL validates policy and workflow semantics; this SDK only
 * maps language-idiomatic parameter names onto the public AUTO-04/05 RPCs.
 */
import type { HttpTransport } from "../http.js";

export interface AgentProvenance {
  agentId: string;
  agentName?: string;
  tool: { name: string; version?: string };
  model: { provider: string; name: string; version?: string };
  invocationId: string;
}

export type AgentOperation = Record<string, unknown> & { kind: string };

export interface AgentWorkflowPlan {
  formatVersion: 1;
  steps: Array<{
    key: string;
    title: string;
    summary: string;
    tool: string;
    operation: AgentOperation;
    inputReferences: Record<string, unknown>[];
  }>;
}

export interface AgentWorkflowBudget {
  maxOperations: number;
  maxTokens: number;
  maxCostMicrousd: number;
}

export interface AgentWorkflowUsage {
  tokens: number;
  costMicrousd: number;
}

export class AgentOperationsResource {
  constructor(private transport: HttpTransport) {}

  async listProposals(options?: {
    params?: Record<string, string | number | undefined>;
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get("/api/db/agent_operation_proposals", options);
  }

  async listProposalEvents(options?: {
    params?: Record<string, string | number | undefined>;
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get("/api/db/agent_operation_events", options);
  }

  async listWorkflows(options?: {
    params?: Record<string, string | number | undefined>;
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get("/api/db/agent_workflows", options);
  }

  async listWorkflowSteps(options?: {
    params?: Record<string, string | number | undefined>;
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get("/api/db/agent_workflow_steps", options);
  }

  async listWorkflowEvents(options?: {
    params?: Record<string, string | number | undefined>;
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get("/api/db/agent_workflow_events", options);
  }

  async propose(params: {
    workspaceId: string;
    title: string;
    summary: string;
    operation: AgentOperation;
    provenance: AgentProvenance;
    idempotencyKey: string;
  }): Promise<unknown> {
    return this.transport.post("/api/db/rpc/propose_agent_operation", {
      jsonBody: {
        p_workspace_id: params.workspaceId,
        p_title: params.title,
        p_summary: params.summary,
        p_operation: params.operation,
        p_provenance: params.provenance,
        p_idempotency_key: params.idempotencyKey,
      },
    });
  }

  async createWorkflow(params: {
    workspaceId: string;
    goal: string;
    plan: AgentWorkflowPlan;
    budget: AgentWorkflowBudget;
    initialUsage: AgentWorkflowUsage;
    provenance: AgentProvenance;
    idempotencyKey: string;
  }): Promise<unknown> {
    return this.transport.post("/api/db/rpc/create_agent_workflow", {
      jsonBody: {
        p_workspace_id: params.workspaceId,
        p_goal: params.goal,
        p_plan: params.plan,
        p_budget: params.budget,
        p_initial_usage: params.initialUsage,
        p_provenance: params.provenance,
        p_idempotency_key: params.idempotencyKey,
      },
    });
  }

  async advanceWorkflow(
    workflowId: string,
    expectedRevision: number,
  ): Promise<unknown> {
    return this.transport.post("/api/db/rpc/advance_agent_workflow", {
      jsonBody: {
        p_workflow_id: workflowId,
        p_expected_revision: expectedRevision,
      },
    });
  }

  async reportWorkflowUsage(
    workflowId: string,
    expectedRevision: number,
    usage: AgentWorkflowUsage,
  ): Promise<unknown> {
    return this.transport.post("/api/db/rpc/report_agent_workflow_usage", {
      jsonBody: {
        p_workflow_id: workflowId,
        p_expected_revision: expectedRevision,
        p_tokens: usage.tokens,
        p_cost_microusd: usage.costMicrousd,
      },
    });
  }

  async cancelWorkflow(
    workflowId: string,
    expectedRevision: number,
    reason: string,
  ): Promise<unknown> {
    return this.transport.post("/api/db/rpc/cancel_agent_workflow", {
      jsonBody: {
        p_workflow_id: workflowId,
        p_expected_revision: expectedRevision,
        p_reason: reason,
      },
    });
  }
}
