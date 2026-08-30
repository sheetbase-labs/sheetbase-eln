import { describe, it, expect } from "vitest";
import { SheetbaseClient } from "../src/client.js";
import {
  BASE_URL,
  CREDENTIAL,
  createMockFetch,
  projectRow,
  type MockRoute,
} from "./helpers.js";
import { NotFoundError } from "../src/errors.js";

function makeClient(routes: MockRoute[] = []) {
  const fetch = createMockFetch(routes);
  const client = new SheetbaseClient({
    baseUrl: BASE_URL,
    credential: CREDENTIAL,
    scopes: ["projects:read"],
    fetch,
  });
  return { client, fetch };
}

describe("ProjectsResource", () => {
  it("list returns typed projects", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({ status: 200, json: [projectRow] }),
      },
    ]);
    const projects = await client.projects.list();
    expect(projects).toHaveLength(1);
    expect(projects[0].key).toBe("lenti-purification");
    expect(projects[0].title).toBe("Lentivector Purification");
    expect(projects[0].status).toBe("active");
    client.close();
  });

  it("get returns project by id", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({ status: 200, json: [projectRow] }),
      },
    ]);
    const project = await client.projects.get(projectRow.id);
    expect(project.id).toBe(projectRow.id);
    expect(project.key).toBe("lenti-purification");
    client.close();
  });

  it("get throws NotFoundError when empty", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({ status: 200, json: [] }),
      },
    ]);
    await expect(client.projects.get("nonexistent")).rejects.toThrow(NotFoundError);
    client.close();
  });

  it("getByKey returns project by key", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => ({ status: 200, json: [projectRow] }),
      },
    ]);
    const project = await client.projects.getByKey("lenti-purification");
    expect(project.key).toBe("lenti-purification");
    client.close();
  });

  it("create returns typed project", async () => {
    const { client } = makeClient([
      {
        method: "POST",
        path: "/api/db/rpc/create_project",
        handler: () => ({ status: 200, json: [projectRow] }),
      },
    ]);
    const project = await client.projects.create("Lentivector Purification");
    expect(project.title).toBe("Lentivector Purification");
    client.close();
  });

  it("update patches project", async () => {
    const { client, fetch } = makeClient([
      {
        method: "PATCH",
        path: "/api/db/projects",
        handler: () => ({
          status: 200,
          json: [{ ...projectRow, title: "Updated Title" }],
        }),
      },
    ]);
    const result = await client.projects.update(projectRow.id, { title: "Updated Title" });
    expect(result[0].title).toBe("Updated Title");
    const patchCall = fetch.calls.find((c) => c.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(patchCall!.url).toContain(`id=eq.${projectRow.id}`);
    client.close();
  });

  it("iter paginates projects", async () => {
    const responses = [
      { status: 200, json: [projectRow, { ...projectRow, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", key: "second" }] },
      { status: 200, json: [] },
    ];
    let callIndex = 0;

    const { client } = makeClient([
      {
        method: "GET",
        path: "/api/db/projects",
        handler: () => responses[callIndex++],
      },
    ]);
    const projects = [];
    for await (const p of client.projects.iter({ pageSize: 2 })) {
      projects.push(p);
    }
    expect(projects).toHaveLength(2);
    expect(projects[0].key).toBe("lenti-purification");
    expect(projects[1].key).toBe("second");
    client.close();
  });
});
