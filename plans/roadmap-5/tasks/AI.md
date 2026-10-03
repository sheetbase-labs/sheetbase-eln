# Optional live assistance

Planned at `e5801327`, 2 October 2026. Read [GUIDE.md](../GUIDE.md), the accepted agent proposal/human-attestation contracts, `src/lib/ai-context.ts`, `src/lib/ai-gateway.ts` and `src/lib/assist-explain.ts`. This task is optional and must justify its usefulness. It does not block the scientific workflow programme.

## R5-AI-01: explain one validation failure with cited context

**Outcome:** a scientist receives a useful explanation grounded in the validation result and sources they can access. Priority P3, effort L, high risk. Depends on BASE-02 and a selected provider/data-handling/evaluation policy.

**Current state and scope:** `src/lib/ai-gateway.ts:370` defaults to `StubModelProvider`; its hashing comment explains that the module is bundled for the browser. `src/lib/assist-explain.ts:374` and `assist-drafts.ts:699` directly create stub providers. Adding an adapter alone would neither move credentials server-side nor route the chosen UI through a governed gateway. High confidence in the current stub boundary, medium confidence in product value until evaluated.

Scope is one explanation operation, authenticated server invocation, permission-scoped context, provider integration, attribution, citations, resource/cost controls and a bounded evaluation set. Draft generation and autonomous writes remain out of scope.

**Steps:**

1. Choose real validation cases: wrong units, missing required field, stale revision, denied access and insufficient evidence. Define expert-rated correctness/usefulness thresholds and a cost/latency budget before live evaluation. Decide allowed data disclosure and retention; use non-sensitive fixtures until that decision is made.
2. Add a server endpoint deriving identity and authorized context from the session. Isolate secrets/provider SDK from browser bundles. Use the existing gateway/context contracts with server-side budgets, timeouts and output bounds; route the selected UI caller through this endpoint.
3. Render deterministic validation facts first, then clearly attributed assistance with checked citations. Retain the stub only for deterministic tests. Provider failure displays unavailability rather than returning believable canned success. The assistant cannot change data, approve a proposal or sign evidence.

**Verification/exit:** extend gateway/context/assist unit tests, add API authorization and browser-unavailable-state cases, run `pnpm validate`, then the explicitly configured real-provider evaluation. Record evaluated cases, observed errors, actual usage/cost and expert judgement. No inaccessible context or unsupported citation is accepted in the evaluated corpus; generated text never overrides the deterministic validation result. If usefulness/cost targets are not met, defer the feature and retain the evaluation evidence.
