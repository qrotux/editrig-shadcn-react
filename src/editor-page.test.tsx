import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EditorPage, type EditorPageProps } from "./editor-page";
import { invalidateEntity } from "./use-editor";
import { defaultEditorMessages } from "./messages";
import type { Envelope } from "./types";
import rawFixture from "./__fixtures__/synthetic-entity.json";

// JSON import widens string-literal fields to `string` — cast through
// `unknown` to recover the narrowed Envelope/RJSFSchema shape (same
// pattern as the other component tests).
const fixture = rawFixture as unknown as Envelope;

const createdEnvelope: Envelope = {
  name: "synthetic",
  id: "1",
  schema: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string", title: "Title" },
      note: { type: "string", title: "Note" },
      status: { type: "string", title: "Status" },
    },
  },
  uiSchema: {},
  data: { title: "Hello", status: "draft" },
};

// Queue of canned responses for successive POST /entity calls (shifted one
// per call; empty queue → success). Lets a test script e.g. "422 then, after
// the user fixes the field and resubmits, success" — a single boolean flag
// can't express that sequence.
let postResponseQueue: Array<"success" | "422"> = [];
// Same idea for PATCH, so an edit-mode test can script a 422 then a success.
let patchResponseQueue: Array<"success" | "422"> = [];

/** Full (edit-mode) envelope exercising the declarative uiSchema contract:
 *  sections, header, nullable clearing and a toggle-all boolean group. */
const editEnvelope: Envelope = {
  name: "synthetic",
  id: "1",
  schema: {
    type: "object",
    required: ["title"],
    properties: {
      id: { type: "string", title: "ID" },
      title: { type: "string", title: "Title" },
      city: { type: ["string", "null"], title: "City" },
      flag_a: { type: "boolean", title: "Flag A" },
      flag_b: { type: "boolean", title: "Flag B" },
      created_at: { type: "string", title: "Created at" },
      loose: { type: "string", title: "Loose" },
      rating: { type: ["number", "null"], title: "Rating" },
      seen_at: { type: ["string", "null"], title: "Seen at" },
      prefs: { title: "Prefs" },
    },
  },
  uiSchema: {
    "ui:order": [
      "id",
      "title",
      "city",
      "flag_a",
      "flag_b",
      "created_at",
      "loose",
      "rating",
      "seen_at",
      "prefs",
    ],
    "ui:header": { titleField: "title", subtitleField: "city", metaFields: ["id", "created_at"] },
    "ui:groups": [
      { id: "main", title: "Main", fields: ["title", "city"] },
      { id: "flags", title: "Flags", columns: 2, toggleAll: true, fields: ["flag_a", "flag_b"] },
      { id: "metrics", title: "Metrics", fields: ["rating", "seen_at", "prefs"] },
    ],
    id: { "ui:widget": "hidden" },
    created_at: { "ui:widget": "hidden" },
    city: { "ui:emptyValue": null },
    rating: { "ui:readonly": true, "ui:widget": "readonlyDisplay" },
    seen_at: { "ui:readonly": true, "ui:widget": "readonlyDisplay" },
    prefs: { "ui:readonly": true, "ui:field": "json" },
  },
  data: {
    id: "1",
    title: "Hello",
    city: "Berlin",
    flag_a: false,
    flag_b: false,
    created_at: "2026-08-01T10:00:00Z",
    loose: "x",
    rating: 4.5,
    seen_at: "2026-08-01T10:00:00Z",
    prefs: { email: true },
  },
};

/** A second entity, same id, different name — for record-switch tests. */
const otherEnvelope: Envelope = {
  name: "other",
  id: "1",
  schema: { type: "object", required: ["title"], properties: { title: { type: "string", title: "Title" } } },
  uiSchema: {},
  data: { title: "Other title" },
};

/** Every request the mock saw — lets a test assert the actual PATCH payload. */
let requests: Array<{ url: string; method: string; body: unknown }> = [];
let deleteStatus = 204;
// Body returned alongside a non-204 DELETE response — defaults to the plain
// "error" shape a 500 gives, but a test can swap in a 409 formErrors body.
let deleteBody: unknown = { error: "foreign key violation" };
// GET /entity/1 controls: a mutable envelope (so a background refetch can return
// a changed record) and a status (so a delete can make the row 404 afterwards).
let entityGetEnvelope: Envelope = editEnvelope;
let entityGetStatus = 200;
// GET /schema status, so a test can make the initial load fail.
let schemaGetStatus = 200;

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    const method = init?.method ?? "GET";
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/other/entity/1") && method === "GET") return json(otherEnvelope);
    if (url.endsWith("/schema") && method === "GET")
      return schemaGetStatus === 200 ? json(fixture) : json({ error: "boom" }, schemaGetStatus);
    if (url.endsWith("/entity/1") && method === "GET")
      return entityGetStatus === 200
        ? json(entityGetEnvelope)
        : json({ error: "not found" }, entityGetStatus);
    if (url.endsWith("/entity/1") && method === "PATCH") {
      const next = patchResponseQueue.shift() ?? "success";
      if (next === "422")
        return json({ fieldErrors: [{ field: "/title", message: "already taken" }], formErrors: [] }, 422);
      return json(editEnvelope);
    }
    if (url.endsWith("/entity/1") && method === "DELETE") {
      if (deleteStatus === 204) {
        entityGetStatus = 404;
        return new Response(null, { status: 204 });
      }
      return json(deleteBody, deleteStatus);
    }
    if (url.endsWith("/entity") && method === "POST") {
      const next = postResponseQueue.shift() ?? "success";
      if (next === "422") {
        return json({ fieldErrors: [{ field: "/title", message: "already taken" }], formErrors: [] }, 422);
      }
      return json(createdEnvelope);
    }
    return json({});
  });
}

function renderPage(props: Partial<EditorPageProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditorPage name="synthetic" id={null} {...props} />
    </QueryClientProvider>,
  );
}

describe("EditorPage", () => {
  beforeEach(() => {
    postResponseQueue = [];
    patchResponseQueue = [];
    requests = [];
    deleteStatus = 204;
    deleteBody = { error: "foreign key violation" };
    entityGetEnvelope = editEnvelope;
    entityGetStatus = 200;
    schemaGetStatus = 200;
    vi.stubGlobal("fetch", mockFetch());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the short (create) schema fields", async () => {
    renderPage();
    // required "title" renders with a trailing "*" appended to the label text
    expect(await screen.findByLabelText(/^Title/)).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Status/)).toBeNull();
  });

  it("swaps to the full schema returned by the server after a successful create, and fires onSaved", async () => {
    const onSaved = vi.fn();
    renderPage({ onSaved });
    await screen.findByLabelText(/^Title/);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByLabelText(/^Status/)).toBeInTheDocument());
    expect(onSaved).toHaveBeenCalledWith("1");
  });

  it("surfaces a 422 fieldErrors response as rjsf extraErrors on the field", async () => {
    postResponseQueue = ["422"];
    renderPage();
    await screen.findByLabelText(/^Title/);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("already taken")).toBeInTheDocument();
  });

  it("recovers after a 422: editing the field clears the block and the next Save actually submits", async () => {
    // Regression test for the "permanently blocked after first 422" bug: once
    // serverErr.extra was set non-empty, rjsf's own hasError check stayed true
    // forever because the ONLY code path that cleared it lived inside the app
    // onSubmit — which is exactly what got gated out. An onChange edit must
    // clear the block so the corrected field's Save actually reaches the
    // mutation (not swallowed by rjsf's internal onError/console.error).
    const onSaved = vi.fn();
    postResponseQueue = ["422"]; // next call after this succeeds (queue empties → "success")
    renderPage({ onSaved });
    await screen.findByLabelText(/^Title/);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "taken-name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("already taken")).toBeInTheDocument();

    // user edits the offending field — this must clear the block...
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "free-name" } });
    expect(screen.queryByText("already taken")).toBeNull();

    // ...so the next Save is not swallowed and actually invokes the mutation:
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText(/^Status/)).toBeInTheDocument());
    expect(onSaved).toHaveBeenCalledWith("1");
  });

  it("renders a labeled Save button instead of rjsf's default Submit", async () => {
    renderPage();
    await screen.findByLabelText(/^Title/);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });

  it("shows a create-mode hint and no Delete until the record exists", async () => {
    renderPage();
    await screen.findByLabelText(/^Title/);
    expect(screen.getByText(defaultEditorMessages.createHint)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("reports success after a save (transient status region)", async () => {
    renderPage();
    await screen.findByLabelText(/^Title/);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(defaultEditorMessages.saved)).toBeInTheDocument();
  });

  describe("edit mode (declarative uiSchema)", () => {
    it("renders ui:groups as sections and keeps hidden fields out of the body", async () => {
      renderPage({ id: "1" });
      await screen.findByLabelText(/^Title/);
      expect(screen.getByRole("heading", { name: "Main" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Flags" })).toBeInTheDocument();
      // ungrouped field still rendered (implicit trailing section) …
      expect(screen.getByLabelText("Loose")).toBeInTheDocument();
      // … hidden ones are not exposed as labelled inputs
      expect(screen.queryByLabelText("Created at")).toBeNull();
    });

    it("promotes ui:header fields into a page header with a copy-ID control", async () => {
      renderPage({ id: "1" });
      expect(await screen.findByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: defaultEditorMessages.copyId })).toBeInTheDocument();
    });

    it("sends null (not a dropped key) when a nullable field is cleared", async () => {
      // Finding #1: rjsf's default emptyValue is `undefined`, which drops the
      // key from the payload — and the server's absent-key branch then carries
      // the old value over, so clearing silently reverted.
      renderPage({ id: "1" });
      const city = await screen.findByLabelText("City");
      fireEvent.change(city, { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
      const patch = requests.find((r) => r.method === "PATCH")!.body as { data: Record<string, unknown> };
      expect("city" in patch.data).toBe(true);
      expect(patch.data.city).toBeNull();
    });

    it("renders ui:readonly fields as display-only values, never as inputs", async () => {
      renderPage({ id: "1" });
      await screen.findByLabelText(/^Title/);
      // number → as-is, RFC3339 → Intl, jsonb → pretty-printed <pre>
      expect(screen.getByText("4.5")).toBeInTheDocument();
      // (the header's created_at renders the same instant — hence getAllByText)
      expect(screen.getAllByText(/1 Aug 2026/).length).toBeGreaterThan(0);
      expect(screen.getByText(/"email": true/)).toBeInTheDocument();
      // and no editable control carries their values
      const inputs = Array.from(document.querySelectorAll("input,textarea,select")) as HTMLInputElement[];
      expect(inputs.some((el) => el.value === "4.5")).toBe(false);
    });

    it("never sends read-only fields back on save", async () => {
      // Worker-owned values (counters, ratings, lifecycle timestamps) must not
      // be clobberable by a stale form. The Go engine strips them too — this
      // pins the client half of the contract.
      renderPage({ id: "1" });
      await screen.findByLabelText(/^Title/);
      // Save доступен только на изменённой форме, поэтому трогаем поле, которое
      // тест не проверяет — title обязан доехать своим, загруженным значением.
      fireEvent.change(screen.getByLabelText("Loose"), { target: { value: "y" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
      const patch = requests.find((r) => r.method === "PATCH")!.body as { data: Record<string, unknown> };
      expect("rating" in patch.data).toBe(false);
      expect("seen_at" in patch.data).toBe(false);
      expect("prefs" in patch.data).toBe(false);
      expect(patch.data.title).toBe("Hello");
    });

    it("toggles every boolean of a toggleAll section at once", async () => {
      renderPage({ id: "1" });
      await screen.findByLabelText(/^Title/);
      // shadcn/Radix renders checkboxes as role="checkbox" buttons, so state
      // lives in aria-checked rather than HTMLInputElement.checked.
      const flagA = () => screen.getByRole("checkbox", { name: /Flag A/ });
      const flagB = () => screen.getByRole("checkbox", { name: /Flag B/ });
      expect(flagA()).toHaveAttribute("aria-checked", "false");

      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.selectAll }));
      await waitFor(() => expect(flagA()).toHaveAttribute("aria-checked", "true"));
      expect(flagB()).toHaveAttribute("aria-checked", "true");

      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.selectNone }));
      await waitFor(() => expect(flagA()).toHaveAttribute("aria-checked", "false"));
      expect(flagB()).toHaveAttribute("aria-checked", "false");
    });

    it("includes a nullable boolean in select all/none and still renders the control", async () => {
      // A nullable column arrives as type ["boolean","null"]; without
      // getSchemaType the toggle would skip it, and a group of only nullable
      // booleans would render no Select all/none control at all.
      entityGetEnvelope = {
        name: "synthetic",
        id: "1",
        schema: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", title: "Title" },
            flag_n: { type: ["boolean", "null"], title: "Flag N" },
          },
        },
        uiSchema: {
          "ui:groups": [{ id: "flags", title: "Flags", toggleAll: true, fields: ["flag_n"] }],
        },
        data: { title: "Hello", flag_n: null },
      } as Envelope;
      renderPage({ id: "1" });
      await screen.findByLabelText(/^Title/);
      const flagN = () => screen.getByRole("checkbox", { name: /Flag N/ });
      expect(flagN()).toHaveAttribute("aria-checked", "false");
      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.selectAll }));
      await waitFor(() => expect(flagN()).toHaveAttribute("aria-checked", "true"));
    });

    it("keeps Save and Reset disabled until something actually changes", async () => {
      renderPage({ id: "1" });
      await screen.findByLabelText(/^Title/);
      const save = () => screen.getByRole("button", { name: defaultEditorMessages.save });
      const reset = () => screen.getByRole("button", { name: defaultEditorMessages.reset });
      expect(save()).toBeDisabled();
      expect(reset()).toBeDisabled();

      fireEvent.change(screen.getByLabelText("City"), { target: { value: "Praha" } });
      await waitFor(() => expect(save()).toBeEnabled());
      expect(reset()).toBeEnabled();
    });

    it("Reset restores the loaded values and goes pristine again, without touching the server", async () => {
      renderPage({ id: "1" });
      const city = () => screen.getByLabelText("City") as HTMLInputElement;
      await screen.findByLabelText(/^Title/);

      fireEvent.change(city(), { target: { value: "Praha" } });
      await waitFor(() => expect(city().value).toBe("Praha"));

      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.reset }));
      await waitFor(() => expect(city().value).toBe("Berlin"));
      expect(screen.getByRole("button", { name: defaultEditorMessages.save })).toBeDisabled();
      expect(requests.every((r) => r.method === "GET")).toBe(true);
    });

    it("marks changed fields and keeps the mark on the changed field only", async () => {
      // Маркер живёт на ячейке поля, а не рядом с подписью: подписи рисуют сами
      // поля и по-разному (см. FieldSlot), поэтому пин по data-атрибуту ячейки.
      const marked = () =>
        Array.from(document.querySelectorAll("[data-editor-dirty]")).map((el) =>
          el.textContent?.replace(/\s+/g, " ").trim(),
        );
      renderPage({ id: "1" });
      await screen.findByLabelText(/^Title/);
      expect(marked()).toHaveLength(0);

      fireEvent.change(screen.getByLabelText("City"), { target: { value: "Praha" } });
      await waitFor(() => expect(marked()).toHaveLength(1));
      expect(marked()[0]).toContain("City");

      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.reset }));
      await waitFor(() => expect(marked()).toHaveLength(0));
    });

    it("reverts a single field from its own marker, leaving the other changes alone", async () => {
      renderPage({ id: "1" });
      const city = () => screen.getByLabelText("City") as HTMLInputElement;
      const loose = () => screen.getByLabelText("Loose") as HTMLInputElement;
      await screen.findByLabelText(/^Title/);

      fireEvent.change(city(), { target: { value: "Praha" } });
      fireEvent.change(loose(), { target: { value: "y" } });
      await waitFor(() =>
        expect(screen.getAllByRole("button", { name: defaultEditorMessages.revertField })).toHaveLength(2),
      );

      // маркер стоит в ячейке своего поля — по ней и находим нужную кнопку
      const cityCell = city().closest("[data-editor-dirty]")!;
      fireEvent.click(
        within(cityCell as HTMLElement).getByRole("button", { name: defaultEditorMessages.revertField }),
      );

      await waitFor(() => expect(city().value).toBe("Berlin"));
      expect(loose().value).toBe("y");
      // форма всё ещё грязная из-за второго поля — Save остаётся доступным
      expect(screen.getByRole("button", { name: defaultEditorMessages.save })).toBeEnabled();
      expect(screen.getAllByRole("button", { name: defaultEditorMessages.revertField })).toHaveLength(1);
    });

    it("stays on the record after a save: the mark clears and Save disables again", async () => {
      // Save больше не уводит с формы — после успеха базовой линией становится
      // вернувшийся конверт, и форма снова считается нетронутой.
      const onSaved = vi.fn();
      renderPage({ id: "1", onSaved });
      await screen.findByLabelText(/^Title/);

      fireEvent.change(screen.getByLabelText("City"), { target: { value: "Praha" } });
      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));

      await waitFor(() => expect(onSaved).toHaveBeenCalledWith("1"));
      // поля на месте (форма не размонтирована), пометка снята, Save погас
      expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: defaultEditorMessages.save })).toBeDisabled(),
      );
      expect(document.querySelectorAll("[data-editor-dirty]")).toHaveLength(0);
    });

    it("asks for confirmation before deleting, and only then calls DELETE", async () => {
      const onDeleted = vi.fn();
      renderPage({ id: "1", onDeleted });
      await screen.findByLabelText(/^Title/);

      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.delete }));
      expect(requests.some((r) => r.method === "DELETE")).toBe(false);

      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: defaultEditorMessages.confirmDeleteConfirm }),
      );
      await waitFor(() => expect(onDeleted).toHaveBeenCalled());
      expect(requests.some((r) => r.method === "DELETE")).toBe(true);
    });

    it("surfaces a failed delete (e.g. FK violation) instead of failing silently", async () => {
      deleteStatus = 500;
      const onDeleted = vi.fn();
      renderPage({ id: "1", onDeleted });
      await screen.findByLabelText(/^Title/);
      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.delete }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: defaultEditorMessages.confirmDeleteConfirm }),
      );
      expect(await screen.findByText(new RegExp(defaultEditorMessages.deleteFailed))).toBeInTheDocument();
      expect(onDeleted).not.toHaveBeenCalled();
    });

    it("surfaces the server's own text for a 409 delete refusal, without the generic deleteFailed prefix", async () => {
      // A meaningful refusal (e.g. still-referenced record) carries its own
      // localized, self-sufficient message — prefixing "Delete failed" onto it
      // would just duplicate what it already says.
      deleteStatus = 409;
      deleteBody = { fieldErrors: [], formErrors: ["Нельзя удалить: поездки 51"] };
      const onDeleted = vi.fn();
      renderPage({ id: "1", onDeleted });
      await screen.findByLabelText(/^Title/);
      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.delete }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: defaultEditorMessages.confirmDeleteConfirm }),
      );
      expect(await screen.findByText("Нельзя удалить: поездки 51")).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(defaultEditorMessages.deleteFailed))).toBeNull();
      expect(onDeleted).not.toHaveBeenCalled();
    });
  });

  // Preset данных create-формы: страница-хозяин знает значение поля из
  // контекста (например, id родителя в master-detail) и подставляет его до
  // первого касания формы.
  it("merges initialData into the create baseline and the submitted payload", async () => {
    renderPage({ id: null, initialData: { note: "preset" } });
    // Ждём именно ЗНАЧЕНИЕ, а не появление поля: конверт и formData ставят два
    // разных эффекта, и на рендере, где поля уже нарисованы, formData ещё может
    // быть пустой.
    await waitFor(() => expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("preset"));

    // Подмешано в БАЗОВУЮ ЛИНИЮ, а не поверх неё: preset — не правка админа,
    // поэтому форма остаётся нетронутой и Save погашен.
    expect(screen.getByRole("button", { name: defaultEditorMessages.save })).toBeDisabled();
    expect(document.querySelectorAll("[data-editor-dirty]")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));

    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const post = requests.find((r) => r.method === "POST")!.body as { data: Record<string, unknown> };
    expect(post.data.note).toBe("preset");
  });

  // Preset читается снапшотом: новый объект на каждый рендер (обычный литерал у
  // страницы-хозяина) не пересобирает базовую линию — иначе setEnv со свежим
  // объектом гонял бы рендер по кругу и стирал набранное.
  it("survives a fresh initialData object on re-render", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = (
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id={null} initialData={{ note: "preset" }} />
      </QueryClientProvider>
    );
    const { rerender } = render(page);
    // Печатать можно только по готовой базовой линии: эффект, раскладывающий
    // конверт в formData, иначе затёр бы набранное сразу после ввода.
    await waitFor(() => expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("preset"));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "typed" } });

    // тот же элемент, но initialData внутри — новый литерал на каждый рендер
    rerender(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id={null} initialData={{ note: "preset" }} />
      </QueryClientProvider>,
    );

    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("typed");
  });

  it("restores the preset on Reset, not an empty field", async () => {
    // Reset откатывает к БАЗОВОЙ линии, а в неё preset подмешан — иначе он
    // исчезал бы вместе с правками, и форма создания теряла бы контекст
    // (например, id родителя в master-detail).
    renderPage({ id: null, initialData: { note: "preset" } });
    const note = () => screen.getByLabelText("Note") as HTMLInputElement;
    await waitFor(() => expect(note().value).toBe("preset"));

    fireEvent.change(note(), { target: { value: "typed" } });
    await waitFor(() => expect(note().value).toBe("typed"));

    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.reset }));
    await waitFor(() => expect(note().value).toBe("preset"));
    expect(screen.getByRole("button", { name: defaultEditorMessages.save })).toBeDisabled();
  });

  it("ignores initialData on an existing record", async () => {
    renderPage({ id: "1", initialData: { loose: "preset" } });
    await waitFor(() => expect((screen.getByLabelText("Loose") as HTMLInputElement).value).toBe("x"));
  });

  it("removes a field from the rendered form when transformSchema hides it", async () => {
    renderPage({
      transformSchema: (schema, uiSchema) => ({
        schema: {
          ...schema,
          properties: Object.fromEntries(
            Object.entries(schema.properties ?? {}).filter(([k]) => k !== "note"),
          ),
        },
        uiSchema,
      }),
    });
    await screen.findByLabelText(/^Title/);
    expect(screen.queryByLabelText("Note")).toBeNull();
  });

  // Расширяемость реестра: приложение подменяет рендерер по ключу, не форкая
  // библиотеку. Мерж ПОВЕРХ, а не вместо — иначе одно переопределение обнулило
  // бы json/keyed/relation/media, и остальные поля формы перестали бы
  // рисоваться.
  it("renders a project-supplied field renderer over the built-in registry", async () => {
    renderPage({
      transformSchema: (schema) => ({
        schema,
        uiSchema: { note: { "ui:field": "custom" } },
      }),
      fields: {
        custom: () => <div data-testid="project-field">project</div>,
      },
    });
    expect(await screen.findByTestId("project-field")).toBeInTheDocument();
    // Встроенные никуда не делись: title по-прежнему обычный инпут.
    expect(await screen.findByLabelText(/^Title/)).toBeInTheDocument();
  });
});

describe("EditorPage — fetch prop", () => {
  beforeEach(() => {
    requests = [];
    vi.stubGlobal("fetch", mockFetch());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads and saves through the fetch passed in, leaving the global fetch untouched", async () => {
    const seen: Array<{ url: string; method: string }> = [];
    const inner = mockFetch();
    const custom: typeof fetch = (url, init) => {
      seen.push({ url: String(url), method: init?.method ?? "GET" });
      return inner(String(url), {
        ...init,
        headers: { ...(init?.headers as object), Authorization: "Bearer t" },
      });
    };
    renderPage({ fetch: custom });
    await screen.findByLabelText(/^Title/);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText(/^Status/)).toBeInTheDocument());

    expect(seen.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

describe("EditorPage — load, refetch and delete resilience", () => {
  beforeEach(() => {
    requests = [];
    postResponseQueue = [];
    patchResponseQueue = [];
    deleteStatus = 204;
    deleteBody = { error: "foreign key violation" };
    entityGetEnvelope = editEnvelope;
    entityGetStatus = 200;
    schemaGetStatus = 200;
    vi.stubGlobal("fetch", mockFetch());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows an error, not a perpetual loading state, when the initial load fails", async () => {
    schemaGetStatus = 500;
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(defaultEditorMessages.loading)).toBeNull();
  });

  it("keeps a loaded form on screen when a background refetch fails", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/^Title/);
    const before = requests.filter((r) => r.method === "GET" && r.url.endsWith("/entity/1")).length;

    // A failing background refetch must not replace the working form with an
    // error page — the error alert is for a first load with no envelope yet.
    entityGetStatus = 500;
    await qc.invalidateQueries({ queryKey: ["editor", "synthetic", "1"] });
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "GET" && r.url.endsWith("/entity/1")).length).toBe(
        before + 1,
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps unsaved edits when a background refetch returns a changed envelope", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" />
      </QueryClientProvider>,
    );
    const title = (await screen.findByLabelText(/^Title/)) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "my unsaved edit" } });

    // A byte-different envelope from the server (bumped timestamp) must not
    // clobber the field the admin is still typing in.
    entityGetEnvelope = {
      ...editEnvelope,
      data: { ...editEnvelope.data, created_at: "2099-01-01T00:00:00Z" },
    };
    const before = requests.filter((r) => r.method === "GET" && r.url.endsWith("/entity/1")).length;
    await qc.invalidateQueries({ queryKey: ["editor", "synthetic", "1"] });
    // Wait for the refetch to actually land, then let its state updates flush —
    // otherwise the assertion passes before any clobber could happen.
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "GET" && r.url.endsWith("/entity/1")).length).toBe(
        before + 1,
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("my unsaved edit");
  });

  it("does not refetch or error on the just-deleted record after a delete", async () => {
    const onDeleted = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" onDeleted={onDeleted} />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/^Title/);

    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.delete }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: defaultEditorMessages.confirmDeleteConfirm }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    // The disabled query must not have re-fetched the 404, so no error alert.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not share the envelope cache between two basePaths for one record", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" basePath="/api/a/entities" />
        <EditorPage name="synthetic" id="1" basePath="/api/b/entities" />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      const gets = requests.filter((r) => r.method === "GET" && r.url.endsWith("/entity/1"));
      expect(gets.length).toBe(2);
    });
    const urls = requests.filter((r) => r.url.endsWith("/entity/1")).map((r) => r.url);
    expect(urls).toContain("/api/a/entities/synthetic/entity/1");
    expect(urls).toContain("/api/b/entities/synthetic/entity/1");
  });

  it("lifts the 422 submit block when a section toggle-all fixes the form", async () => {
    patchResponseQueue = ["422"]; // first PATCH fails, the retry (queue empty) succeeds
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/^Title/);

    // Edit a field so Save is enabled, submit, and take the 422 block.
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "taken-name" } });
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));
    expect(await screen.findByText("already taken")).toBeInTheDocument();
    const patchesAfter422 = requests.filter((r) => r.method === "PATCH").length;

    // Fix the form through the section toggle-all (setFieldValues), which never
    // goes through rjsf's onChange — the path that used to leave the block up.
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.selectAll }));
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));

    await waitFor(() =>
      expect(requests.filter((r) => r.method === "PATCH").length).toBe(patchesAfter422 + 1),
    );
  });
});

describe("EditorPage — delete gating and saved note", () => {
  beforeEach(() => {
    requests = [];
    postResponseQueue = [];
    patchResponseQueue = [];
    deleteStatus = 204;
    deleteBody = { error: "foreign key violation" };
    entityGetEnvelope = editEnvelope;
    entityGetStatus = 200;
    schemaGetStatus = 200;
    vi.stubGlobal("fetch", mockFetch());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("never shows Delete on the create form, even when canDelete is true", async () => {
    renderPage({ id: null, canDelete: true });
    await screen.findByLabelText(/^Title/);
    expect(screen.queryByRole("button", { name: defaultEditorMessages.delete })).toBeNull();
  });

  it("hides the Saved note once the record identity changes after a create", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id={null} />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/^Title/);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));
    expect(await screen.findByText(defaultEditorMessages.saved)).toBeInTheDocument();

    // The host moves the freshly assigned id into the URL: same instance, id
    // flips null → "1". The stale "Saved" must not linger onto the next record.
    rerender(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByText(defaultEditorMessages.saved)).toBeNull());
  });
});

describe("EditorPage — record switch on the same instance", () => {
  beforeEach(() => {
    requests = [];
    postResponseQueue = [];
    patchResponseQueue = [];
    deleteStatus = 204;
    entityGetEnvelope = editEnvelope;
    entityGetStatus = 200;
    schemaGetStatus = 200;
    vi.stubGlobal("fetch", mockFetch());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads the new entity when name changes with the same id", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" />
      </QueryClientProvider>,
    );
    expect((await screen.findByLabelText(/^Title/)).getAttribute("value") ?? "").toBe("Hello");

    rerender(
      <QueryClientProvider client={qc}>
        <EditorPage name="other" id="1" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Other title"),
    );
  });
});

describe("EditorPage — staging a file after a 422 lifts the block", () => {
  const mediaEnvelope: Envelope = {
    name: "gadgets",
    id: "1",
    schema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", title: "Title" },
        photo_id: { type: ["string", "null"], title: "Photo" },
      },
    },
    uiSchema: { photo_id: { "ui:field": "media", "ui:options": { collection: "media" } } },
    data: { title: "Hello", photo_id: null },
  };
  let patchCount = 0;

  beforeEach(() => {
    patchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const json = (v: unknown, status = 200) =>
          new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
        if (url.endsWith("/gadgets/entity/1") && method === "GET") return json(mediaEnvelope);
        if (url.endsWith("/gadgets/entity/1") && method === "PATCH") {
          patchCount += 1;
          if (patchCount === 1)
            return json({ fieldErrors: [{ field: "/photo_id", message: "bad image" }], formErrors: [] }, 422);
          return json(mediaEnvelope);
        }
        return json({ options: [] });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clears the server error block when a media file is staged", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="gadgets" id="1" />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/^Title/);

    // Dirty the form, submit, take the 422 block on the media field.
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello 2" } });
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));
    expect(await screen.findByText("bad image")).toBeInTheDocument();

    // Staging a corrected file never goes through rjsf onChange; it must still
    // clear the block so the next Save actually submits.
    const input = document.querySelector('[data-editor-media-input="photo_id"]') as HTMLInputElement;
    const file = new File([new Uint8Array(8)], "ok.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));

    await waitFor(() => expect(patchCount).toBe(2));
  });
});

describe("EditorPage — late Save response after a record switch", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("ignores a Save response for a record the host already switched away from", async () => {
    let resolvePatch: (() => void) | undefined;
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (url.endsWith("/synthetic/entity/1") && method === "GET")
          return Promise.resolve(json(editEnvelope));
        if (url.includes("/other/entity/1") && method === "GET") return Promise.resolve(json(otherEnvelope));
        if (url.endsWith("/synthetic/entity/1") && method === "PATCH")
          return new Promise<Response>((r) => {
            resolvePatch = () => r(json(editEnvelope));
          });
        return Promise.resolve(json({}));
      }),
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/^Title/);

    // Start a PATCH of the synthetic record, then switch to the other record
    // before it resolves.
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello X" } });
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));
    await waitFor(() => expect(resolvePatch).toBeDefined());

    rerender(
      <QueryClientProvider client={qc}>
        <EditorPage name="other" id="1" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Other title"),
    );

    // The late PATCH echo of the synthetic record must not replace the other
    // record now on screen.
    await act(async () => {
      resolvePatch!();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Other title");
  });

  // A record whose envelope omits a key that the schema gives a `default` must
  // not read as dirty on load: rjsf would otherwise inject the default through
  // onChange and light up Save/Reset and the revert markers on a form nobody
  // touched. Suppression keeps formData equal to the envelope the server sent.
  describe("schema defaults do not dirty a freshly loaded record", () => {
    const defaultsEnv: Envelope = {
      name: "synthetic",
      id: "1",
      schema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", title: "Title" },
          status: { type: "string", title: "Status", default: "draft" },
          active: { type: "boolean", title: "Active", default: false },
        },
      },
      uiSchema: {},
      data: { title: "Hello" }, // status/active absent on purpose
    };

    function renderWithDefaults() {
      const seen: Array<{ url: string; method: string; body: unknown }> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const method = init?.method ?? "GET";
          seen.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
          const res = (v: unknown) =>
            new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
          if (url.endsWith("/entity/1")) return res(defaultsEnv);
          return res({});
        }),
      );
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <EditorPage name="synthetic" id="1" />
        </QueryClientProvider>,
      );
      return seen;
    }

    it("leaves Save disabled on load", async () => {
      renderWithDefaults();
      await screen.findByLabelText(/^Title/);
      expect(screen.getByRole("button", { name: defaultEditorMessages.save })).toBeDisabled();
    });

    it("does not send the absent defaulted key on the next save", async () => {
      const seen = renderWithDefaults();
      await screen.findByLabelText(/^Title/);
      // Touch title so Save is enabled, then submit.
      fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello!" } });
      fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));
      await waitFor(() => expect(seen.some((r) => r.method === "PATCH")).toBe(true));
      const patch = seen.find((r) => r.method === "PATCH")!;
      const sent = (patch.body as { data: Record<string, unknown> }).data;
      // The server reads an absent key as "leave this column alone"; injecting
      // the schema default here would overwrite it.
      expect("status" in sent).toBe(false);
      expect("active" in sent).toBe(false);
    });
  });

  // After a create the create query (`id: null` → GET /schema) stays mounted
  // until the host puts the new id in the URL. A host invalidation of the whole
  // entity refetches /schema; adopting that id:null envelope over the saved
  // record used to blank it and turn the next Save into a duplicate POST.
  it("keeps the saved record when a host invalidation refetches the create schema", async () => {
    const createSchema = (extra: boolean): Envelope => ({
      name: "synthetic",
      id: null,
      schema: {
        type: "object",
        required: ["title"],
        // Second fetch differs so react-query cannot preserve the reference by
        // structural sharing — the same trigger the field-add-on-server case hits.
        properties: extra
          ? { title: { type: "string", title: "Title" }, extra: { type: "string", title: "Extra" } }
          : { title: { type: "string", title: "Title" } },
      },
      uiSchema: {},
      data: {},
    });
    const saved: Envelope = {
      name: "synthetic",
      id: "7",
      schema: {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string", title: "Title" } },
      },
      uiSchema: {},
      data: { id: "7", title: "Hello" },
    };
    let schemaCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const res = (v: unknown) =>
          new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.endsWith("/schema") && method === "GET") return res(createSchema(schemaCalls++ > 0));
        if (url.endsWith("/entity") && method === "POST") return res(saved);
        return res({});
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id={null} />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/^Title/);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: defaultEditorMessages.save }));
    // Saved: the create hint is gone and Delete (a record now exists) is shown.
    await waitFor(() => expect(screen.queryByText(defaultEditorMessages.createHint)).toBeNull());
    expect(screen.getByRole("button", { name: defaultEditorMessages.delete })).toBeInTheDocument();

    // Host invalidates the whole entity; the stale create schema refetches.
    await act(async () => {
      await invalidateEntity(qc, "synthetic");
      await new Promise((r) => setTimeout(r, 20));
    });

    // The saved record must still be on screen, not blanked back to the create form.
    expect(screen.queryByText(defaultEditorMessages.createHint)).toBeNull();
    expect(screen.getByRole("button", { name: defaultEditorMessages.delete })).toBeInTheDocument();
  });

  // `skipDefaults` (the fix for the dirty-on-load bug above) also stops rjsf
  // pre-filling a newly added array item with its sub-defaults. Adding an item
  // must still work — it just yields an empty item the admin fills — so this
  // pins that the array of objects stays editable, a documented trade-off.
  it("still adds an editable item to an array of objects under skipDefaults", async () => {
    const arrayEnv: Envelope = {
      name: "synthetic",
      id: "1",
      schema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", title: "Title" },
          days: {
            type: "array",
            title: "Days",
            items: {
              type: "object",
              properties: {
                day: { type: "integer", title: "Day", default: 1 },
                note: { type: "string", title: "Note", default: "—" },
              },
            },
          },
        },
      },
      uiSchema: {},
      data: { title: "Hello", days: [] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(JSON.stringify(url.endsWith("/entity/1") ? arrayEnv : {}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="synthetic" id="1" />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/^Title/);
    expect(screen.queryByLabelText("Day")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    // The new item's sub-fields render (empty, not pre-filled) and are editable.
    const dayInput = await screen.findByLabelText("Day");
    expect((dayInput as HTMLInputElement).value).toBe("");
  });
});
