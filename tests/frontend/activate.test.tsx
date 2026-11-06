import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const host = { id: 1, name: "web", folder: "prod" };

const summary = {
  uid: "n1",
  scope: "host",
  hostId: 1,
  folder: null,
  title: "Nginx tips",
  excerpt: "reload with nginx -s reload",
  tags: ["web"],
  pinned: false,
  mine: true,
  canEdit: true,
  updatedAt: "2026-11-05T10:00:00.000Z",
};

function api(list: unknown[] = [summary]) {
  return {
    get: vi.fn(async (path: string) => {
      if (path === "/notes") return { data: list };
      if (path === "/search") return { data: list };
      if (path === "/notes/n1") {
        return {
          data: {
            ...summary,
            body: "Reload:\n\n```bash\nnginx -s reload\n```\n",
          },
        };
      }
      return { data: [] };
    }),
    post: vi.fn(async (_path: string, body: Record<string, unknown>) => ({
      data: { ...summary, uid: "n2", ...body, body: "" },
    })),
    put: vi.fn(async () => ({ data: summary })),
    delete: vi.fn(async () => ({ data: { ok: true } })),
  };
}

describe(`${manifest.id} activate`, () => {
  it("registers the tab and a panel beside the terminal", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["notes"]);
    expect(rendered.registered.actions()).toContain("notes.togglePanel");
    expect(rendered.registered.slot("tab.menu")).toEqual(["notes.togglePanel"]);
  });

  it("is on for hosts unless switched off", () => {
    expect(plugin.notesEnabled({ pluginSettings: {} })).toBe(true);
    expect(
      plugin.notesEnabled({
        pluginSettings: { notes: { enableNotes: false } },
      }),
    ).toBe(false);
    expect(
      plugin.notesPanelEnabled({
        pluginSettings: { notes: { showPanel: false } },
      }),
    ).toBe(false);
  });

  it("lists the host's notes", async () => {
    const mock = api();
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: mock as never,
    });
    rendered.renderTab("notes", { isVisible: true, host });
    expect(await screen.findByText("Nginx tips")).toBeTruthy();
    expect(mock.get).toHaveBeenCalledWith(
      "/notes",
      expect.objectContaining({
        params: expect.objectContaining({ scope: "host", hostId: 1 }),
      }),
    );
  });

  it("shows an empty state", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api([]) as never,
    });
    rendered.renderTab("notes", { isVisible: true, host });
    expect(await screen.findByText(locales.empty.title)).toBeTruthy();
  });

  it("opens a note and renders markdown with copy on code", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api() as never,
    });
    rendered.renderTab("notes", { isVisible: true, host });
    fireEvent.click(await screen.findByText("Nginx tips"));
    expect(await screen.findByLabelText(locales.code.copy)).toBeTruthy();
    expect(screen.getByText("nginx -s reload")).toBeTruthy();
  });

  it("makes a new note in the current scope", async () => {
    const mock = api([]);
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: mock as never,
    });
    rendered.renderTab("notes", { isVisible: true, host });
    await screen.findByText(locales.empty.title);
    fireEvent.click(screen.getByRole("button", { name: locales.new }));
    await waitFor(() => expect(mock.post).toHaveBeenCalled());
    expect(mock.post).toHaveBeenCalledWith(
      "/notes",
      expect.objectContaining({ scope: "host", hostId: 1 }),
    );
  });

  it("starts on global notes when no host is open", async () => {
    const mock = api([]);
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: mock as never,
    });
    rendered.renderTab("notes", { isVisible: true });
    await screen.findByText(locales.empty.title);
    expect(mock.get).toHaveBeenCalledWith(
      "/notes",
      expect.objectContaining({
        params: expect.objectContaining({ scope: "global" }),
      }),
    );
  });
});

describe("pinned card", () => {
  it("shows pinned global notes", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: ["notes.use"],
      api: {
        get: vi.fn(async () => ({
          data: [
            { uid: "a", title: "Wifi codes", excerpt: "abc", pinned: true },
            { uid: "b", title: "Scratch", excerpt: "x", pinned: false },
          ],
        })),
      } as never,
    });
    expect(rendered.registered.dashboardCards()).toEqual(["notes-pinned"]);
    rendered.renderDashboardCard("notes-pinned");
    expect(await screen.findByText("Wifi codes")).toBeTruthy();
    expect(screen.queryByText("Scratch")).toBeNull();
  });
});
