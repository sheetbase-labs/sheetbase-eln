import { describe, it, expect } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import { BASE_URL, CREDENTIAL, createMockFetch } from "./helpers.js";

const GENERATION = "880e8400-e29b-41d4-a716-446655440030";

describe("reports", () => {
  it("download asks for the format", async () => {
    const urls: string[] = [];
    const fetch = createMockFetch([
      {
        method: "GET",
        path: `/api/export/report-generation/${GENERATION}`,
        handler: (request: Request) => {
          urls.push(request.url);
          return { status: 200, text: "bytes" };
        },
      },
    ]);
    const client = new SheetbaseClient({
      baseUrl: BASE_URL,
      credential: CREDENTIAL,
      scopes: ["lab:read"],
      fetch,
    });
    const bytes = await client.reports.download(GENERATION, { format: "pdf" });
    expect(new TextDecoder().decode(bytes)).toBe("bytes");
    expect(urls[0]).toContain("format=pdf");
  });
});
