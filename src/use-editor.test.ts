import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useCreate, useUpdate, useDelete } from "./use-editor";

// .ts, not .tsx: the wrapper is built with createElement, not JSX.
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

let calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: "users", id: "u-1", schema: {}, uiSchema: {}, data: {} }),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

// Сабмит без файлов — прежний JSON-путь, байт в байт: тело
// JSON.stringify({data}), заголовок Content-Type руками выставлен.
describe("useCreate/useUpdate — JSON path (no staged files)", () => {
  it("useCreate posts a plain JSON body when files is empty", async () => {
    const { result } = renderHook(() => useCreate("users"), { wrapper });
    result.current.mutate({ data: { username: "u" }, files: new Map() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("/api/admin/entities/users/entity");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ data: { username: "u" } }));
  });

  it("useUpdate posts a plain JSON body when files is omitted entirely", async () => {
    const { result } = renderHook(() => useUpdate("users", "u-1"), { wrapper });
    result.current.mutate({ data: { username: "u" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const { url, init } = calls[0];
    expect(url).toBe("/api/admin/entities/users/entity/u-1");
    expect(init?.method).toBe("PATCH");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

// Сабмит со стейдж-файлом — multipart/form-data: часть "payload" несёт тот же
// JSON, что и раньше, плюс "file:<поле>" на файл; Content-Type НЕ выставлен
// руками (fetch/браузер сам добавит boundary).
describe("useCreate/useUpdate — multipart path (staged files present)", () => {
  it("useCreate builds a FormData body with payload + file:<field> parts", async () => {
    const { result } = renderHook(() => useCreate("users"), { wrapper });
    const file = new File([new Uint8Array(4)], "p.jpg", { type: "image/jpeg" });
    const files = new Map([["photo_id", [file]]]);
    result.current.mutate({ data: { username: "u" }, files });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const { url, init } = calls[0];
    expect(url).toBe("/api/admin/entities/users/entity");
    expect(init?.method).toBe("POST");
    // Content-Type не выставлен руками: у ручного заголовка нет boundary, и
    // сервер не смог бы разобрать части. С FormData-телом это делает сам fetch.
    expect((init?.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined();

    expect(init?.body).toBeInstanceOf(FormData);
    const fd = init?.body as FormData;
    expect(fd.get("payload")).toBe(JSON.stringify({ data: { username: "u" } }));
    expect(fd.get("file:photo_id")).toBe(file);
  });

  it("useUpdate sends one file:<field> part per staged field", async () => {
    const { result } = renderHook(() => useUpdate("users", "u-1"), { wrapper });
    const avatar = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    const cover = new File([new Uint8Array(4)], "c.png", { type: "image/png" });
    const files = new Map([
      ["avatar_id", [avatar]],
      ["cover_id", [cover]],
    ]);
    result.current.mutate({ data: {}, files });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const fd = calls[0].init?.body as FormData;
    expect(fd.get("file:avatar_id")).toBe(avatar);
    expect(fd.get("file:cover_id")).toBe(cover);
  });

  // Мульти-media: одно поле, несколько файлов — по части file:<поле> на каждый,
  // в порядке очереди (сервер аппендит их в хвост id-массива).
  it("useUpdate emits one file:<field> part per file of a multi field", async () => {
    const { result } = renderHook(() => useUpdate("trips", "t-1"), { wrapper });
    const a = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    const b = new File([new Uint8Array(4)], "b.png", { type: "image/png" });
    const files = new Map([["gallery", [a, b]]]);
    result.current.mutate({ data: {}, files });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const fd = calls[0].init?.body as FormData;
    expect(fd.getAll("file:gallery")).toEqual([a, b]);
  });
});

// A host that needs auth headers, a CSRF token or another origin wraps fetch
// itself and hands the wrapper in; the global fetch must then stay untouched.
describe("useCreate — custom fetch", () => {
  it("sends the request through the fetch passed in, not the global one", async () => {
    const seen: string[] = [];
    const customFetch: typeof fetch = (url) => {
      seen.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ name: "users", id: "u-1", schema: {}, uiSchema: {}, data: {} }),
      } as Response);
    };
    const { result } = renderHook(() => useCreate("users", "/api/admin/entities", customFetch), { wrapper });
    result.current.mutate({ data: { username: "u" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual(["/api/admin/entities/users/entity"]);
    expect(calls).toHaveLength(0);
  });
});

// Path segments are percent-encoded so a slug-style id ("2024/09") or one with
// a query/space cannot mis-route the request onto another record; query keys
// stay raw (invalidateEntity matches on them).
describe("URL encoding of name and id", () => {
  it("useUpdate encodes an id containing a slash", async () => {
    const { result } = renderHook(() => useUpdate("posts", "2024/09"), { wrapper });
    result.current.mutate({ data: {} });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].url).toBe("/api/admin/entities/posts/entity/2024%2F09");
  });

  it("useDelete encodes an id containing a query character and a space", async () => {
    const { result } = renderHook(() => useDelete("posts", "a?b c"), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].url).toBe("/api/admin/entities/posts/entity/a%3Fb%20c");
  });
});
