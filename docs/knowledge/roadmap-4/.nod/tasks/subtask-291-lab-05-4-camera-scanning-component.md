---
id: subtask-291
title: LAB-05.4 — Camera scanning component
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-287
tags:
  - LAB-05.4
  - LAB
---

# LAB-05.4 — Camera scanning component

Step 4 of 4 in [LAB-05](../../tasks/LAB.md#lab-05--labels-and-scanning); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed (delegated, then verified by the coordinator). The decoder fallback is now real: loadCodeDecoder returns a jsQR-backed decoder where BarcodeDetector is absent, so the component samples the video frame and reads a code instead of falling straight to typing. It is honest about coverage - jsQR reads QR only, not Data Matrix or Code 128 - so while a limited decoder is scanning the component says so and keeps the typed path; it reports nothing for an unreadable frame and never runs outside a live camera loop. Tests round-trip a genuine QR built with the qrcode package: camera-scanner 11 cases, scan route 3. The task text's 'WASM decoder fallback' is now recorded as jsQR (pure JavaScript, same capability, no WASM toolchain). Dependency note: qrcode and jsqr were added on the owner's decision.
  - 2026-10-10: partially implemented (delegated, then verified by the coordinator); stays open on one point. The scanning logic that lived inline in /scan is now a reusable component (src/components/scan/camera-scanner.tsx) with a code-decoder interface, honest states (idle, starting, scanning, no camera API, unsupported, denied, unavailable, error), an always-present typed-ID fallback, a last-scan line, and no repeated report while the same code stays in frame; /scan mounts it and keeps its resolution, suggestions and recent scans unchanged. Nine tests pass across the component and route files. NOT done: the WASM decoder fallback is a registration seam only - the repository bundles no decoder dependency and adding one is an owner decision, so loadCodeDecoder returns null and the component states it cannot read labels rather than pretending. Also not done: mounting it in MOB-02, which was out of scope for this slice.
