import { afterEach, describe, expect, it } from "vitest";
import { startServer, type FakeHost, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const HOSTS: FakeHost[] = [
  // user-1 edits host 1, user-2 only connects.
  { id: 1, folder: "prod", levels: { "user-1": "edit", "user-2": "connect" } },
  { id: 2, folder: "prod", levels: { "user-1": "edit" } },
  { id: 3, folder: "lab", levels: { "user-2": "edit" } },
];

async function start(): Promise<TestServer> {
  return (server = await startServer(structuredClone(HOSTS)));
}

const hostNote = (extra: Record<string, unknown> = {}) => ({
  scope: "host",
  hostId: 1,
  title: "Nginx",
  body: "run `nginx -t`",
  tags: ["Web", "web", " nginx "],
  ...extra,
});

describe("host notes", () => {
  it("creates, reads, updates and deletes a note", async () => {
    const s = await start();
    const made = await s.request("POST", "/notes", hostNote());
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({
      title: "Nginx",
      scope: "host",
      hostId: 1,
      canEdit: true,
      mine: true,
      tags: ["web", "nginx"],
    });

    const read = await s.request("GET", `/notes/${made.body.uid}`);
    expect(read.body.body).toBe("run `nginx -t`");

    const put = await s.request("PUT", `/notes/${made.body.uid}`, {
      body: "changed",
      pinned: true,
    });
    expect(put.body).toMatchObject({
      body: "changed",
      pinned: true,
      title: "Nginx",
    });

    const del = await s.request("DELETE", `/notes/${made.body.uid}`);
    expect(del.status).toBe(200);
    expect((await s.request("GET", `/notes/${made.body.uid}`)).status).toBe(
      404,
    );
  });

  it("lists pinned first and cuts bodies to an excerpt", async () => {
    const s = await start();
    await s.request("POST", "/notes", hostNote({ title: "a" }));
    await s.request(
      "POST",
      "/notes",
      hostNote({ title: "b", pinned: true, body: "x".repeat(500) }),
    );
    const list = await s.request("GET", "/notes?scope=host&hostId=1");
    expect(list.body.map((n: { title: string }) => n.title)).toEqual([
      "b",
      "a",
    ]);
    expect(list.body[0].excerpt).toHaveLength(160);
    expect(list.body[0].body).toBeUndefined();
  });

  it("lets a connect user read but not write", async () => {
    const s = await start();
    const made = await s.request("POST", "/notes", hostNote());
    s.as("user-2");
    const list = await s.request("GET", "/notes?scope=host&hostId=1");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].canEdit).toBe(false);
    expect((await s.request("POST", "/notes", hostNote())).status).toBe(403);
    expect(
      (await s.request("PUT", `/notes/${made.body.uid}`, { body: "x" })).status,
    ).toBe(403);
    expect((await s.request("DELETE", `/notes/${made.body.uid}`)).status).toBe(
      403,
    );
  });

  it("hides a host the user cannot open", async () => {
    const s = await start();
    const made = await s.request("POST", "/notes", hostNote({ hostId: 2 }));
    s.as("user-2");
    expect((await s.request("GET", "/notes?scope=host&hostId=2")).status).toBe(
      404,
    );
    expect((await s.request("GET", `/notes/${made.body.uid}`)).status).toBe(
      404,
    );
  });

  it("removes a host's notes when the host is deleted", async () => {
    const s = await start();
    await s.request("POST", "/notes", hostNote());
    await s.emit("host.deleted", { hostId: 1 });
    const list = await s.request("GET", "/notes?scope=host&hostId=1");
    expect(list.body).toEqual([]);
  });
});

describe("folder and global notes", () => {
  it("shares a folder note with users who see a host in it", async () => {
    const s = await start();
    const made = await s.request("POST", "/notes", {
      scope: "folder",
      folder: "prod",
      title: "Runbook",
      body: "steps",
    });
    expect(made.status).toBe(200);
    s.as("user-2");
    const list = await s.request("GET", "/notes?scope=folder&folder=prod");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].canEdit).toBe(false);
    s.as("user-2");
    const lab = await s.request("GET", "/notes?scope=folder&folder=lab");
    expect(lab.body).toEqual([]);
  });

  it("refuses a folder the user has no host in", async () => {
    const s = await start();
    const res = await s.request("GET", "/notes?scope=folder&folder=lab");
    expect(res.status).toBe(404);
  });

  it("keeps global notes private", async () => {
    const s = await start();
    const made = await s.request("POST", "/notes", {
      scope: "global",
      title: "Mine",
      body: "secret",
    });
    s.as("user-2");
    expect((await s.request("GET", `/notes/${made.body.uid}`)).status).toBe(
      404,
    );
    const list = await s.request("GET", "/notes?scope=global");
    expect(list.body).toEqual([]);
  });

  it("deletes global notes when the user's data is wiped", async () => {
    const s = await start();
    await s.request("POST", "/notes", {
      scope: "global",
      title: "Mine",
      body: "x",
    });
    await s.emit("user.data_wiped", { userId: "user-1" });
    expect((await s.request("GET", "/notes?scope=global")).body).toEqual([]);
  });
});

describe("search", () => {
  it("finds notes by title, body and tag across scopes", async () => {
    const s = await start();
    await s.request("POST", "/notes", hostNote({ title: "Web", body: "x" }));
    await s.request("POST", "/notes", {
      scope: "global",
      title: "Other",
      body: "restart nginx",
    });
    await s.request("POST", "/notes", hostNote({ hostId: 2, tags: ["db"] }));

    const byBody = await s.request("GET", "/search?q=restart");
    expect(byBody.body).toHaveLength(1);
    const byTag = await s.request("GET", "/search?q=db");
    expect(byTag.body).toHaveLength(1);
    const all = await s.request("GET", "/search");
    expect(all.body).toHaveLength(3);
  });

  it("only returns what the user can open", async () => {
    const s = await start();
    await s.request("POST", "/notes", hostNote({ hostId: 2 }));
    s.as("user-2");
    expect((await s.request("GET", "/search")).body).toEqual([]);
  });

  it("lists the folders the user can open", async () => {
    const s = await start();
    expect((await s.request("GET", "/folders")).body).toEqual(["prod"]);
  });
});

describe("validation", () => {
  it("rejects bad input with 400", async () => {
    const s = await start();
    expect(
      (await s.request("POST", "/notes", { scope: "nope", body: "" })).status,
    ).toBe(400);
    expect(
      (await s.request("POST", "/notes", hostNote({ hostId: "abc" }))).status,
    ).toBe(400);
    expect(
      (
        await s.request(
          "POST",
          "/notes",
          hostNote({ body: "x".repeat(200_001) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await s.request("POST", "/notes", hostNote({ tags: "web" }))).status,
    ).toBe(400);
    expect(
      (await s.request("POST", "/notes", { scope: "folder", folder: " " }))
        .status,
    ).toBe(400);
  });

  it("names an empty title Untitled", async () => {
    const s = await start();
    const made = await s.request("POST", "/notes", hostNote({ title: "  " }));
    expect(made.body.title).toBe("Untitled");
  });
});
