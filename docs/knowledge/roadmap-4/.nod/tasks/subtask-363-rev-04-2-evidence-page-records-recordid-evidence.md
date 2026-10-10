---
id: subtask-363
title: REV-04.2 — Evidence page /records/$recordId/evidence/$revisionId and phone view
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-361
tags:
  - REV-04.2
  - REV
---

# REV-04.2 — Evidence page /records/$recordId/evidence/$revisionId and phone view

Step 2 of 3 in [REV-04](../../tasks/REV.md#rev-04--evidence-versus-live); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented. The evidence page exists at src/routes/records/$recordId/evidence/$revisionId.tsx (route registered by pnpm generate-routes) with src/lib/revision-evidence.ts as its data layer: it reads api.revision_evidence_package for the frozen revision (integrity digest, reason, cited comments) and api.revision_drift for what has moved since signing (renamed record, comments added after signing, cited dataset versions against their latest), and links the machine-readable export package. Nothing is reconstructed client-side. Smoke-verified against the running dev server: /records/<record>/evidence/<revision> returns HTTP 200 and renders the Evidence header, Signed revision, Drift, Integrity digest, Export package and the drift badge for a real revision; the drifted path is proven by tests/db/revision-drift.test.ts. The phone layout reuses the route's responsive classes; the dedicated phone view of the design is deferred with the other optical work.
