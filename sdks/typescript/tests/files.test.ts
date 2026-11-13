import { describe, it, expect } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import { BASE_URL, CREDENTIAL, createMockFetch } from "./helpers.js";

const FILE = "770e8400-e29b-41d4-a716-446655440020";

function makeClient() {
  const fetch = createMockFetch([
    {
      method: "POST",
      path: "/api/files/upload-authorize",
      handler: () => ({ status: 201, json: { fileRecordId: FILE, uploadUrl: `/api/files/${FILE}/upload` } }),
    },
    {
      method: "PUT",
      path: `/api/files/${FILE}/upload`,
      handler: () => ({ status: 200, json: { fileRecordId: FILE, byteSize: "5", status: "active" } }),
    },
    {
      method: "GET",
      path: `/api/files/${FILE}/download`,
      handler: () => ({ status: 200, text: "bytes" }),
    },
  ]);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["files:write", "files:read"],
    fetch,
  });
  return { client, fetch };
}

describe("FilesResource", () => {
  it("upload authorises with a checksum, then sends the bytes", async () => {
    const { client, fetch } = makeClient();
    const result = await client.files.upload("proj", "hello", { name: "gel.txt" });
    const authorise = fetch.calls.find((c) => c.url.endsWith("/upload-authorize"))!;
    const body = JSON.parse(authorise.body as string);
    expect(body.mediaType).toBe("text/plain");
    expect(body.byteSize).toBe(5);
    expect(body.checksum).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(result.status).toBe("active");
    expect(result.fileRecordId).toBe(FILE);
  });

  it("download returns the bytes", async () => {
    const { client } = makeClient();
    const bytes = await client.files.download(FILE);
    expect(new TextDecoder().decode(bytes)).toBe("bytes");
  });
});
