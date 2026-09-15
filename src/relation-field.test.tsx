import * as React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import { EditorFormProvider, type EditorFormContextValue } from "./form-context";
import { defaultEditorMessages } from "./messages";
import { EDITOR_FIELDS, EDITOR_WIDGETS } from "./widgets";

afterEach(cleanup);

// Схема ровно та, что отдаёт Go: single — строка, multi — массив строк с
// uniqueItems, у обоих ui:field "relation".
const schema: RJSFSchema = {
  type: "object",
  properties: {
    country_id: { type: ["string", "null"], title: "Country" },
    interests: { type: "array", title: "Interests", items: { type: "string" }, uniqueItems: true },
    // Потолок числа значений: ui.Relation(..., true).MaxItems(2) на Go-стороне
    // кладёт его в СХЕМУ, а не в ui:options.
    capped: { type: "array", title: "Capped", items: { type: "string" }, uniqueItems: true, maxItems: 2 },
    owner_id: { type: "string", title: "Owner" },
    scoped: { type: ["string", "null"], title: "Scoped" },
  },
};

const uiSchema: UiSchema = {
  country_id: {
    "ui:field": "relation",
    "ui:options": { collection: "countries", multi: false, labels: { "c-1": "France" } },
  },
  interests: {
    "ui:field": "relation",
    "ui:options": { collection: "tags", multi: true, labels: { "t-1": "Beaches", "t-2": "Mountains" } },
  },
  capped: {
    "ui:field": "relation",
    "ui:options": { collection: "tags", multi: true, labels: { "g-1": "Alpha", "g-2": "Beta" } },
  },
  scoped: {
    "ui:field": "relation",
    "ui:options": { collection: "tags", multi: false, parentField: "owner_id" },
  },
};

const OPTIONS = [
  { value: "t-1", label: "Beaches" },
  { value: "t-2", label: "Mountains" },
  { value: "t-3", label: "Museums" },
];

let requests: string[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", (url: string) => {
    requests.push(url);
    const term = new URL(url, "http://x").searchParams.get("q") ?? "";
    const options = OPTIONS.filter((o) => o.label.toLowerCase().includes(term.toLowerCase()));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ options }) } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

function renderForm(
  data: Record<string, unknown>,
  onChange = vi.fn(),
  recordId: string | null = null,
  ctxExtra: Partial<EditorFormContextValue> = {},
) {
  const ctx = {
    messages: defaultEditorMessages,
    setFieldValues: () => {},
    disabled: false,
    dirtyFields: new Set<string>(),
    resetField: () => {},
    locale: "en-GB",
    entity: "users",
    base: "/api/admin/entities",
    stagedFiles: new Map(),
    stageFiles: () => {},
    clearStaged: () => {},
    isNew: recordId == null,
    recordId,
    rootData: data,
    ...ctxExtra,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EditorFormProvider value={ctx}>
        <Form
          schema={schema}
          uiSchema={uiSchema}
          formData={data}
          validator={validator}
          widgets={EDITOR_WIDGETS}
          fields={EDITOR_FIELDS}
          onChange={(e) => onChange(e.formData)}
        />
      </EditorFormProvider>
    </QueryClientProvider>,
  );
  return { onChange };
}

const chips = (field: string) =>
  Array.from(document.querySelectorAll(`[data-editor-relation="${field}"] [data-editor-relation-chip]`)).map(
    (el) => el.getAttribute("data-editor-relation-chip"),
  );

function openPicker(field: string) {
  fireEvent.click(document.querySelector(`[data-editor-relation-trigger="${field}"]`)!);
}

// Подписи приезжают вместе с данными (ui:options.labels), поэтому чипы
// подписаны СРАЗУ — без запроса на монтировании.
describe("RelationField", () => {
  it("renders selected values by their server-provided labels and asks for nothing on mount", () => {
    renderForm({ country_id: "c-1", interests: ["t-2", "t-1"] });

    expect(screen.getByText("France")).toBeInTheDocument();
    expect(chips("interests")).toEqual(["t-2", "t-1"]);
    expect(screen.getByText("Mountains")).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  // Значение, которого нет в карте подписей, показывается своим id: пустой чип
  // неотличим от сломанного.
  it("falls back to the raw id for an unlabelled value", () => {
    renderForm({ interests: ["t-9"] });
    expect(screen.getByText("t-9")).toBeInTheDocument();
  });

  it("loads options only when the picker opens, and searches on the server", async () => {
    renderForm({ interests: [] });
    expect(requests).toEqual([]);

    openPicker("interests");
    await waitFor(() => expect(screen.getByText("Museums")).toBeInTheDocument());
    expect(requests[0]).toContain("/api/admin/entities/users/options/interests");

    fireEvent.change(document.querySelector(`[data-editor-relation-search="interests"]`)!, {
      target: { value: "mus" },
    });
    await waitFor(() => expect(requests.some((r) => r.includes("q=mus"))).toBe(true), { timeout: 2000 });
  });

  // Коллекция за полем может зависеть от самой записи (например, точки только
  // этого маршрута), поэтому пикер сообщает серверу владельца.
  it("passes recordId as parent to the options request", async () => {
    renderForm({ interests: [] }, vi.fn(), "rec-1");

    openPicker("interests");
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests.some((u) => u.includes("parent=rec-1"))).toBe(true);
  });

  it("omits parent on create", async () => {
    renderForm({ interests: [] }, vi.fn(), null);

    openPicker("interests");
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests.every((u) => !u.includes("parent="))).toBe(true);
  });

  // parentField снимает зависимость от id записи: источник скоупится СОСЕДНИМ
  // полем, поэтому список наполнен уже на форме создания.
  it("sends the value of parentField as parent, even on create", async () => {
    renderForm({ owner_id: "trip-7", scoped: null }, vi.fn(), null);

    openPicker("scoped");
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests.some((u) => u.includes("parent=trip-7"))).toBe(true);
  });

  it("omits parent when the parentField is empty", async () => {
    renderForm({ scoped: null }, vi.fn(), "rec-1");

    openPicker("scoped");
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests.every((u) => !u.includes("parent="))).toBe(true);
  });

  it("appends a picked value to a multi relation and keeps the previous ones", async () => {
    const { onChange } = renderForm({ interests: ["t-1"] });

    openPicker("interests");
    await waitFor(() => expect(screen.getByText("Museums")).toBeInTheDocument());
    fireEvent.click(document.querySelector(`[data-editor-relation-option="t-3"]`)!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].interests).toEqual(["t-1", "t-3"]);
  });

  it("replaces the value of a single relation and clears it to null", async () => {
    const { onChange } = renderForm({ country_id: "c-1" });

    fireEvent.click(document.querySelector(`[data-editor-relation-remove="c-1"]`)!);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // null, а не "": колонка nullable, и пустая строка полагалась бы на
    // случайную снисходительность uuid-каста.
    expect(onChange.mock.lastCall?.[0].country_id).toBeNull();
  });

  it("removes one chip of a multi relation without touching the others", async () => {
    const { onChange } = renderForm({ interests: ["t-1", "t-2"] });

    fireEvent.click(document.querySelector(`[data-editor-relation-remove="t-2"]`)!);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].interests).toEqual(["t-1"]);
  });

  // Порядок чипов = колонка "order" на сервере, поэтому перетаскивание обязано
  // менять ЗНАЧЕНИЕ поля, а не только вид.
  it("reorders chips by drag and drop", async () => {
    const { onChange } = renderForm({ interests: ["t-1", "t-2"] });

    const [first, second] = document.querySelectorAll(`[data-editor-relation-chip]`);
    fireEvent.dragStart(second);
    fireEvent.dragOver(first);
    fireEvent.drop(first);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].interests).toEqual(["t-2", "t-1"]);
  });

  // Клавиатурный путь того же действия: drag&drop мышиный, и без кнопок
  // порядок был бы недоступен с клавиатуры вовсе.
  it("reorders chips with the move buttons", async () => {
    const { onChange } = renderForm({ interests: ["t-1", "t-2"] });

    fireEvent.click(document.querySelector(`[data-editor-relation-right="t-1"]`)!);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].interests).toEqual(["t-2", "t-1"]);
  });

  // Потолок (schema.maxItems) обязан бить В МОМЕНТ выбора, а не на сабмите:
  // иначе пикер разрешает набрать лишнее, а ajv потом обвиняет в этом админа.
  it("locks the picker options once maxItems is reached", async () => {
    const { onChange } = renderForm({ capped: ["g-1", "g-2"] });

    expect(document.querySelector('[data-editor-relation-count="capped"]')?.textContent).toBe("2 / 2");

    openPicker("capped");
    await waitFor(() => expect(document.querySelector('[data-editor-relation-option="t-3"]')).not.toBeNull());
    const option = document.querySelector('[data-editor-relation-option="t-3"]')!;
    expect(option.getAttribute("data-disabled")).toBe("true");

    fireEvent.click(option);
    expect(onChange.mock.calls.some((c) => (c[0].capped as string[])?.includes("t-3"))).toBe(false);
  });

  // Заперты только ДОБАВЛЕНИЯ: полное поле, из которого нечем убрать значение,
  // не редактируется вовсе.
  it("still removes values at the ceiling", async () => {
    const { onChange } = renderForm({ capped: ["g-1", "g-2"] });

    fireEvent.click(document.querySelector('[data-editor-relation-remove="g-2"]')!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].capped).toEqual(["g-1"]);
  });

  it("hides the editing affordances when the form is disabled", () => {
    renderForm({ interests: ["t-1", "t-2"] });
    expect(document.querySelector(`[data-editor-relation-remove="t-1"]`)).not.toBeNull();

    cleanup();
    const ctx = {
      messages: defaultEditorMessages,
      setFieldValues: () => {},
      disabled: true,
      dirtyFields: new Set<string>(),
      resetField: () => {},
      locale: "en-GB",
      entity: "users",
      base: "/api/admin/entities",
      stagedFiles: new Map(),
      stageFiles: () => {},
      clearStaged: () => {},
      isNew: false,
      recordId: null,
      rootData: { interests: ["t-1", "t-2"] },
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorFormProvider value={ctx}>
          <Form
            schema={schema}
            uiSchema={uiSchema}
            formData={{ interests: ["t-1", "t-2"] }}
            validator={validator}
            widgets={EDITOR_WIDGETS}
            fields={EDITOR_FIELDS}
            disabled
          />
        </EditorFormProvider>
      </QueryClientProvider>,
    );
    expect(document.querySelector(`[data-editor-relation-remove="t-1"]`)).toBeNull();
  });
});

// The picker talks to the server on its own, so it must honour the same fetch
// override EditorPage was given — otherwise auth headers would be lost exactly
// on the requests that happen after mount.
describe("RelationField — fetch from the form context", () => {
  it("requests options through the context fetch, not the global one", async () => {
    const seen: string[] = [];
    const customFetch: typeof fetch = (url) => {
      seen.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ options: OPTIONS }),
      } as Response);
    };
    renderForm({ interests: [] }, vi.fn(), null, { fetch: customFetch });
    openPicker("interests");

    await screen.findByText("Museums");
    expect(seen).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });
});

describe("RelationField — accessibility", () => {
  it("associates the field label with its control", () => {
    renderForm({ country_id: null });
    expect(screen.getByLabelText("Country")).toBeInTheDocument();
  });
});
