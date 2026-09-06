import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import {
  EVENT_ALIASES,
  EVENT_NAMES,
  isEventName,
  resolveEventAlias,
  verifyWebhookSignature,
} from "../src/resources/events.js";

describe("event vocabulary", () => {
  it("pins canonical names with no duplicates", () => {
    expect(EVENT_NAMES.length).toBeGreaterThan(0);
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    expect(EVENT_NAMES).toContain("dataset.versioned");
    expect(EVENT_NAMES).toContain("record.created");
    expect(EVENT_NAMES).toContain("review.decided");
  });

  it("resolves wire aliases to canonical names", () => {
    expect(resolveEventAlias("sheet_instance.updated")).toBe("sheet.updated");
    expect(resolveEventAlias("notebook_template.versioned")).toBe(
      "notebook.template.versioned",
    );
    expect(resolveEventAlias("record.created")).toBe("record.created");
    expect(EVENT_ALIASES["sheet_definition.created"]).toBe(
      "sheet.definition.created",
    );
  });

  it("recognises known names only", () => {
    expect(isEventName("dataset.versioned")).toBe(true);
    expect(isEventName("sheet_instance.created")).toBe(false);
    expect(isEventName("future.unknown")).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ eventType: "record.created", eventId: "e1" });
  const secret = "test-signing-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts a matching signature", async () => {
    await expect(verifyWebhookSignature(body, secret, signature)).resolves.toBe(
      true,
    );
  });

  it("rejects mismatches", async () => {
    await expect(
      verifyWebhookSignature(`${body} `, secret, signature),
    ).resolves.toBe(false);
    await expect(
      verifyWebhookSignature(body, "wrong-secret", signature),
    ).resolves.toBe(false);
    await expect(
      verifyWebhookSignature(body, secret, "sha256=deadbeef"),
    ).resolves.toBe(false);
  });
});
