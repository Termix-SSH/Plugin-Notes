import http from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import express, { type Router } from "express";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

export type Level = "connect" | "view" | "edit" | "manage";
const rank = { connect: 1, view: 2, edit: 3, manage: 4 } as const;

export interface FakeHost {
  id: number;
  folder: string | null;
  /** Level per user. A missing user has no access. */
  levels: Record<string, Level>;
}

export interface TestServer {
  mock: MockPluginContext;
  hosts: FakeHost[];
  request: (
    method: string,
    path: string,
    body?: unknown,
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any }>;
  as: (userId: string) => void;
  emit: (event: string, payload: unknown) => Promise<void>;
  close: () => Promise<void>;
}

/** The plugin on a real express app with a fake host list. */
export async function startServer(hosts: FakeHost[]): Promise<TestServer> {
  let router: Router | null = null;
  const db = await createTestDb(pluginDir);
  for (const user of ["user-1", "user-2"]) {
    db.sqlite.exec(
      `INSERT INTO users (id, username) VALUES ('${user}', '${user}')`,
    );
  }
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    actor: "user-1",
    router: () => (router = express.Router()),
    permissions: ["notes.use"],
  });

  const me = () => mock.ctx.currentActor() as string;
  Object.assign(mock.ctx.hosts, {
    list: async () =>
      hosts
        .filter((host) => host.levels[me()])
        .map((host) => ({ id: host.id, folder: host.folder })),
    checkAccess: async (id: number, need: Level = "connect") => {
      const level = hosts.find((host) => host.id === id)?.levels[me()];
      return {
        hasAccess: level !== undefined && rank[level] >= rank[need],
        isOwner: false,
        isShared: true,
        permissionLevel: level,
      };
    },
  });

  const handlers = new Map<string, Array<(payload: unknown) => unknown>>();
  Object.assign(mock.ctx.events, {
    on: (event: string, fn: (payload: unknown) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      return () => undefined;
    },
  });

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    mock,
    hosts,
    as: (userId) => mock.setActor(userId),
    async emit(event, payload) {
      for (const fn of handlers.get(event) ?? []) await fn(payload);
    },
    async request(method, path, body) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
