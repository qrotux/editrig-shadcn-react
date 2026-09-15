import * as React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";
import type { ErrorSchema, RJSFSchema, UiSchema } from "@rjsf/utils";

import { EditorFormProvider, type EditorFormContextValue } from "./form-context";
import { defaultEditorMessages } from "./messages";
import { EDITOR_FIELDS, EDITOR_WIDGETS } from "./widgets";

afterEach(cleanup);

// Схема ровно та, что отдаёт Go для ui.Media: строка (id media-строки),
// ui:field "media", ui:options{collection, labels, aspect} — то же самое
// ui:options.labels, что и у обычной связи, только подпись это URL миниатюры.
const schema: RJSFSchema = {
  type: "object",
  properties: {
    photo_id: { type: ["string", "null"], title: "Photo" },
  },
};

const uiSchema: UiSchema = {
  photo_id: {
    "ui:field": "media",
    "ui:options": {
      collection: "media",
      aspect: "1:1",
      labels: { "m-1": "https://cdn.example/m-1-thumb.jpg" },
    },
  },
};

const OPTIONS = [
  { value: "m-2", label: "https://cdn.example/m-2-thumb.jpg" },
  { value: "m-3", label: "https://cdn.example/m-3-thumb.jpg" },
];

// Мульти-режим ui.MediaMulti: массивная схема, ui:options.multi=true; подписи —
// URL миниатюр каждого сохранённого id, как у одиночного media.
const MULTI_SCHEMA: RJSFSchema = {
  type: "object",
  properties: {
    gallery: { type: "array", items: { type: "string" }, uniqueItems: true, title: "Gallery" },
  },
};
const MULTI_UI: UiSchema = {
  gallery: {
    "ui:field": "media",
    "ui:options": {
      collection: "trip_gallery",
      multi: true,
      aspect: "2:1",
      labels: { "id-1": "https://cdn/1.jpg", "id-2": "https://cdn/2.jpg" },
    },
  },
};
const MULTI = { schema: MULTI_SCHEMA, uiSchema: MULTI_UI };

// Тот же мульти-режим, но с потолком: ui.MediaMulti(...).MaxItems(2) на
// Go-стороне кладёт maxItems в СХЕМУ, а не в ui:options — там его читает и ajv
// формы, и виджет.
const CAPPED = {
  schema: {
    type: "object",
    properties: {
      gallery: { type: "array", items: { type: "string" }, uniqueItems: true, title: "Gallery", maxItems: 2 },
    },
  } as RJSFSchema,
  uiSchema: MULTI_UI,
};

let requests: string[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", (url: string) => {
    requests.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ options: OPTIONS }),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

function baseCtx(overrides: Partial<EditorFormContextValue> = {}): EditorFormContextValue {
  return {
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
    isNew: false,
    recordId: "u-1",
    ...overrides,
  };
}

function renderForm(
  data: Record<string, unknown>,
  ctxOverrides: Partial<EditorFormContextValue> = {},
  formProps: { extraErrors?: ErrorSchema } = {},
  schemas: { schema?: RJSFSchema; uiSchema?: UiSchema } = {},
) {
  const onChange = vi.fn();
  const ctx = baseCtx(ctxOverrides);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EditorFormProvider value={ctx}>
        <Form
          schema={schemas.schema ?? schema}
          uiSchema={schemas.uiSchema ?? uiSchema}
          formData={data}
          validator={validator}
          widgets={EDITOR_WIDGETS}
          fields={EDITOR_FIELDS}
          disabled={ctx.disabled}
          extraErrors={formProps.extraErrors}
          onChange={(e) => onChange(e.formData)}
        />
      </EditorFormProvider>
    </QueryClientProvider>,
  );
  return { onChange, ctx };
}

const input = (field: string) =>
  document.querySelector(`[data-editor-media-input="${field}"]`) as HTMLInputElement;

function makeFile(name: string, type: string, size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
}

describe("MediaField", () => {
  it("stages a picked file without touching formData or hitting the network", async () => {
    const staged = new Map<string, File[]>();
    const stageFiles = vi.fn((field: string, files: File[] | null) => {
      if (files) staged.set(field, files);
      else staged.delete(field);
    });
    const { onChange } = renderForm({ photo_id: null }, { stageFiles });

    const file = makeFile("cat.jpg", "image/jpeg");
    fireEvent.change(input("photo_id"), { target: { files: [file] } });

    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith("photo_id", [file]));
    expect(onChange).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  // 422 на /photo_id — то же extraErrors-русло, что у любого другого поля
  // (errors.ts toExtraErrors); rjsf показывает ошибку сам через FieldTemplate
  // — тот оборачивает ЛЮБОЕ поле, включая ui:field, тем же путём, что и у
  // RelationField, так что media-полю не нужен свой рендер ошибки.
  it("shows a server-side field error mapped from a /photo_id pointer", () => {
    const extraErrors = { photo_id: { __errors: ["already used elsewhere"] } } as unknown as ErrorSchema;
    renderForm({ photo_id: null }, {}, { extraErrors });
    expect(screen.getByText("already used elsewhere")).toBeInTheDocument();
  });

  it("clears the value on Remove without leaving a staged file behind", async () => {
    const stageFiles = vi.fn();
    const { onChange } = renderForm({ photo_id: "m-1" }, { stageFiles });

    fireEvent.click(document.querySelector('[data-editor-media-remove="photo_id"]')!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].photo_id).toBeNull();
    expect(stageFiles).toHaveBeenCalledWith("photo_id", null);
  });

  it("cancels a staged-only file on Remove without sending an explicit null", async () => {
    // jsdom has no object-URL API; the staged preview needs one to render.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:preview";
    URL.revokeObjectURL = () => {};
    try {
      const file = makeFile("cat.jpg", "image/jpeg");
      const stageFiles = vi.fn();
      // Create form: no stored id, only a staged (never-uploaded) file.
      const { onChange } = renderForm(
        { photo_id: null },
        { stageFiles, stagedFiles: new Map([["photo_id", [file]]]) },
      );
      const remove = await waitFor(() => document.querySelector('[data-editor-media-remove="photo_id"]')!);
      fireEvent.click(remove);
      expect(stageFiles).toHaveBeenCalledWith("photo_id", null);
      // value was null, so Remove must not write a deliberate clear.
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it('hides the "choose from uploaded" trigger on the create form (isNew)', () => {
    renderForm({ photo_id: null }, { isNew: true, recordId: null });
    expect(document.querySelector('[data-editor-media-choose="photo_id"]')).toBeNull();
  });

  it('shows the "choose from uploaded" trigger on the edit form and scopes options by parent', async () => {
    renderForm({ photo_id: null }, { isNew: false, recordId: "u-1" });
    const trigger = document.querySelector('[data-editor-media-choose="photo_id"]');
    expect(trigger).not.toBeNull();

    fireEvent.click(trigger!);
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests[0]).toContain("/api/admin/entities/users/options/photo_id");
    expect(requests[0]).toContain("parent=u-1");
  });

  it("picking an uploaded option sets the id and drops any staged file", async () => {
    const stageFiles = vi.fn();
    const { onChange } = renderForm({ photo_id: null }, { stageFiles, recordId: "u-1" });

    fireEvent.click(document.querySelector('[data-editor-media-choose="photo_id"]')!);
    await waitFor(() => expect(document.querySelector('[data-editor-media-option="m-2"]')).not.toBeNull());

    fireEvent.click(document.querySelector('[data-editor-media-option="m-2"]')!);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].photo_id).toBe("m-2");
    expect(stageFiles).toHaveBeenCalledWith("photo_id", null);
  });

  // Подпись выбранной из библиотеки опции — URL миниатюры — обязана осесть в
  // превью: labels из конверта Load знает только про уже сохранённое значение,
  // и без захвата подписи пикера свежевыбранный id рисовал бы пустую дропзону.
  it("shows the thumbnail of a freshly picked uploaded image", async () => {
    renderForm({ photo_id: null }, { recordId: "u-1" });

    fireEvent.click(document.querySelector('[data-editor-media-choose="photo_id"]')!);
    await waitFor(() => expect(document.querySelector('[data-editor-media-option="m-2"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-editor-media-option="m-2"]')!);

    await waitFor(() => {
      const preview = document.querySelector(
        '[data-editor-media-preview="photo_id"]',
      ) as HTMLImageElement | null;
      expect(preview?.src).toContain("m-2-thumb.jpg");
    });
  });

  it("rejects a .heic file by extension before staging it", async () => {
    const stageFiles = vi.fn();
    renderForm({ photo_id: null }, { stageFiles });

    fireEvent.change(input("photo_id"), { target: { files: [makeFile("photo.heic", "image/heic")] } });

    await waitFor(() => expect(screen.getByText(defaultEditorMessages.mediaRejectHeic)).toBeInTheDocument());
    expect(stageFiles).not.toHaveBeenCalled();
  });

  it("rejects a file whose mime type is not on the allow-list", async () => {
    const stageFiles = vi.fn();
    renderForm({ photo_id: null }, { stageFiles });

    fireEvent.change(input("photo_id"), { target: { files: [makeFile("doc.pdf", "application/pdf")] } });

    await waitFor(() => expect(screen.getByText(defaultEditorMessages.mediaRejectMime)).toBeInTheDocument());
    expect(stageFiles).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit", async () => {
    const stageFiles = vi.fn();
    renderForm({ photo_id: null }, { stageFiles });

    fireEvent.change(input("photo_id"), {
      target: { files: [makeFile("huge.jpg", "image/jpeg", 11 * 1024 * 1024)] },
    });

    await waitFor(() => expect(screen.getByText(defaultEditorMessages.mediaRejectSize)).toBeInTheDocument());
    expect(stageFiles).not.toHaveBeenCalled();
  });

  // ui:options.maxBytes — per-field потолок с Go-стороны (ui.Media(...).
  // MaxBytes, см. internal/admin/editors/users.go), а не плоский
  // DEFAULT_MAX_FILE_SIZE: аватар лимитирован сервером в 5 MiB, и 6-9 МиБ
  // файл обязан отбиться ЗДЕСЬ же, а не после multipart round trip'а с
  // upload_size.
  it("honours a per-field ui:options.maxBytes smaller than the module default", async () => {
    const stageFiles = vi.fn();
    const tightSchema: UiSchema = {
      photo_id: {
        "ui:field": "media",
        "ui:options": { collection: "media", aspect: "1:1", maxBytes: 5 * 1024 * 1024 },
      },
    };
    const onChange = vi.fn();
    const ctx = baseCtx({ stageFiles });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorFormProvider value={ctx}>
          <Form
            schema={schema}
            uiSchema={tightSchema}
            formData={{ photo_id: null }}
            validator={validator}
            widgets={EDITOR_WIDGETS}
            fields={EDITOR_FIELDS}
            onChange={(e) => onChange(e.formData)}
          />
        </EditorFormProvider>
      </QueryClientProvider>,
    );

    fireEvent.change(input("photo_id"), {
      target: { files: [makeFile("avatar.jpg", "image/jpeg", 6 * 1024 * 1024)] },
    });

    await waitFor(() => expect(screen.getByText(defaultEditorMessages.mediaRejectSize)).toBeInTheDocument());
    expect(stageFiles).not.toHaveBeenCalled();
  });

  it("renders the server-labelled thumbnail of an already-selected value", () => {
    renderForm({ photo_id: "m-1" });
    const img = screen.getByAltText("") as HTMLImageElement;
    expect(img.src).toContain("m-1-thumb.jpg");
  });

  // Мульти-режим: каждое сохранённое значение рисуется миниатюрой из labels, в
  // порядке массива.
  it("renders a thumbnail per selected id", () => {
    renderForm({ gallery: ["id-1", "id-2"] }, {}, {}, MULTI);

    const imgs = screen.getAllByAltText("");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["https://cdn/1.jpg", "https://cdn/2.jpg"]);
  });

  // Выбор двух файлов стейджит оба: одноместный стейджинг терял бы второй молча.
  it("stages every picked file", async () => {
    const stageFiles = vi.fn();
    renderForm({ gallery: ["id-1"] }, { stageFiles }, {}, MULTI);

    fireEvent.change(input("gallery"), {
      target: { files: [makeFile("a.png", "image/png"), makeFile("b.png", "image/png")] },
    });

    await waitFor(() =>
      expect(stageFiles).toHaveBeenCalledWith("gallery", [expect.any(File), expect.any(File)]),
    );
    expect(stageFiles.mock.calls.at(-1)?.[1]).toHaveLength(2);
  });

  // Удаление элемента не трогает порядок остальных. Значение уезжает в formData
  // только если onChange несёт path — иначе массив подменил бы форму целиком, и
  // .gallery оказался бы undefined (та же готча, что в relation-field).
  it("removes one item and keeps the rest in order", async () => {
    const { onChange } = renderForm({ gallery: ["id-1", "id-2"] }, {}, {}, MULTI);

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].gallery).toEqual(["id-2"]);
  });

  // Перестановка идёт через onChange С ПУТЁМ: значение должно осесть в .gallery,
  // а не в корне формы.
  it("moves an item and keeps the value under its field path", async () => {
    const { onChange } = renderForm({ gallery: ["id-1", "id-2"] }, {}, {}, MULTI);

    fireEvent.click(screen.getAllByRole("button", { name: /left/i })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].gallery).toEqual(["id-2", "id-1"]);
  });

  // Выбор из библиотеки аппендит id в хвост И рисует его миниатюру по подписи
  // пикера: labels конверта Load про свежевыбранный id не знает, и без захвата
  // подписи плитка получала бы src="{id}" (сломанная картинка).
  it("renders the picked library image by its thumbnail, not its raw id", async () => {
    renderForm({ gallery: ["id-1"] }, { recordId: "u-1" }, {}, MULTI);

    fireEvent.click(document.querySelector('[data-editor-media-choose="gallery"]')!);
    await waitFor(() => expect(document.querySelector('[data-editor-media-option="m-2"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-editor-media-option="m-2"]')!);

    await waitFor(() => {
      const item = document.querySelector('[data-editor-media-item="m-2"] img') as HTMLImageElement | null;
      expect(item).not.toBeNull();
      expect(item?.getAttribute("src")).toBe("https://cdn.example/m-2-thumb.jpg");
    });
  });

  // Отбраковка одного файла пачки не мешает годным: HEIC отбивается, PNG
  // стейджится, и показана причина отказа.
  it("stages the good files of a batch even when one is rejected", async () => {
    const stageFiles = vi.fn();
    renderForm({ gallery: [] }, { stageFiles }, {}, MULTI);

    fireEvent.change(input("gallery"), {
      target: { files: [makeFile("ok.png", "image/png"), makeFile("bad.heic", "image/heic")] },
    });

    await waitFor(() => expect(stageFiles).toHaveBeenCalled());
    expect(stageFiles.mock.lastCall?.[1]).toHaveLength(1);
    expect(screen.getByText(defaultEditorMessages.mediaRejectHeic)).toBeInTheDocument();
  });

  // Потолок (schema.maxItems) обязан бить В МОМЕНТ выбора: без обрезки пачки
  // все 60 файлов уехали бы на сервер и умерли структурной валидацией уже после
  // загрузки.
  it("cuts a batch to the room left under maxItems and says why", async () => {
    const stageFiles = vi.fn();
    renderForm({ gallery: ["id-1"] }, { stageFiles }, {}, CAPPED);

    fireEvent.change(input("gallery"), {
      target: {
        files: [
          makeFile("a.png", "image/png"),
          makeFile("b.png", "image/png"),
          makeFile("c.png", "image/png"),
        ],
      },
    });

    await waitFor(() => expect(stageFiles).toHaveBeenCalled());
    expect(stageFiles.mock.lastCall?.[1]).toHaveLength(1);
    expect(screen.getByText(defaultEditorMessages.mediaRejectCount)).toBeInTheDocument();
  });

  it("drops the add tile and locks library options once the ceiling is reached", async () => {
    const { onChange } = renderForm({ gallery: ["id-1", "id-2"] }, { recordId: "u-1" }, {}, CAPPED);

    expect(document.querySelector('[data-editor-media-count="gallery"]')?.textContent).toBe("2 / 2");
    expect(document.querySelector('[data-editor-media-drop="gallery"]')).toBeNull();

    fireEvent.click(document.querySelector('[data-editor-media-choose="gallery"]')!);
    await waitFor(() => expect(document.querySelector('[data-editor-media-option="m-2"]')).not.toBeNull());
    const option = document.querySelector('[data-editor-media-option="m-2"]')!;
    expect(option.getAttribute("data-disabled")).toBe("true");

    fireEvent.click(option);
    expect(onChange.mock.calls.some((c) => (c[0].gallery as string[])?.includes("m-2"))).toBe(false);
  });

  // Очередь файлов считается вместе с сохранёнными id: она уедет в тот же
  // массив при сабмите, и потолок, посчитанный по одним id, пропустил бы
  // перебор ровно на её длину.
  it("counts staged files towards the ceiling", () => {
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    // jsdom не реализует ни ту, ни другую — а превью застейдженного файла зовёт
    // обе (см. useEffect с blob-URL в MultiMediaField).
    URL.createObjectURL = () => "blob:preview";
    URL.revokeObjectURL = () => {};
    try {
      const stagedFiles = new Map([["gallery", [makeFile("a.png", "image/png")]]]);
      renderForm({ gallery: ["id-1"] }, { stagedFiles }, {}, CAPPED);

      expect(document.querySelector('[data-editor-media-count="gallery"]')?.textContent).toBe("2 / 2");
      expect(document.querySelector('[data-editor-media-drop="gallery"]')).toBeNull();
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it("reuses staged object URLs across renders instead of re-decoding all tiles", () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    let n = 0;
    const created: File[] = [];
    URL.createObjectURL = ((f: File) => {
      created.push(f);
      return `blob:${n++}`;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => {};
    try {
      const f1 = makeFile("a.png", "image/png");
      const f2 = makeFile("b.png", "image/png");
      const f3 = makeFile("c.png", "image/png");
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const ui = (files: File[]) => (
        <QueryClientProvider client={qc}>
          <EditorFormProvider value={baseCtx({ stagedFiles: new Map([["gallery", files]]) })}>
            <Form
              schema={MULTI.schema}
              uiSchema={MULTI.uiSchema}
              formData={{ gallery: [] }}
              validator={validator}
              widgets={EDITOR_WIDGETS}
              fields={EDITOR_FIELDS}
              onChange={() => {}}
            />
          </EditorFormProvider>
        </QueryClientProvider>
      );
      const { rerender } = render(ui([f1, f2]));
      expect(created).toEqual([f1, f2]);
      // Adding one file mints a URL only for the newcomer; f1/f2 keep theirs, so
      // their tiles are not re-keyed and re-decoded.
      rerender(ui([f1, f2, f3]));
      expect(created).toEqual([f1, f2, f3]);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it("degrades a nested media field to a read-only notice instead of corrupting staging", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const nestedSchema: RJSFSchema = {
        type: "object",
        properties: {
          wrap: {
            type: "object",
            properties: { photo_id: { type: ["string", "null"], title: "Photo" } },
          },
        },
      };
      const nestedUi: UiSchema = {
        wrap: { photo_id: { "ui:field": "media", "ui:options": { collection: "media" } } },
      };
      renderForm({ wrap: { photo_id: "m-9" } }, {}, {}, { schema: nestedSchema, uiSchema: nestedUi });
      // The notice shows the raw value; there is no editable drop zone.
      expect(document.querySelector('[data-editor-media-nested="wrap/photo_id"]')?.textContent).toBe("m-9");
      expect(document.querySelector('[data-editor-media-drop="photo_id"]')).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // Одиночный режим не изменился: одна миниатюра, значение — строка, чистится в
  // null.
  it("keeps single-media behaviour intact", async () => {
    const { onChange } = renderForm({ photo_id: "m-1" });

    expect(screen.getAllByAltText("")).toHaveLength(1);
    fireEvent.click(document.querySelector('[data-editor-media-remove="photo_id"]')!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0].photo_id).toBeNull();
  });
});

// The allow-list is the server's to declare: a field whose column stores PDFs
// ships `ui:options.accept`, and the client gate (plus the input's `accept`
// attribute) follows it instead of the image-only default.
describe("MediaField — ui:options.accept", () => {
  const PDF_UI: UiSchema = {
    photo_id: { "ui:field": "media", "ui:options": { collection: "media", accept: ["application/pdf"] } },
  };

  it("stages a file whose type is on the declared allow-list", async () => {
    const stageFiles = vi.fn();
    renderForm({ photo_id: null }, { stageFiles }, {}, { uiSchema: PDF_UI });

    expect(input("photo_id").getAttribute("accept")).toBe("application/pdf");
    fireEvent.change(input("photo_id"), { target: { files: [makeFile("doc.pdf", "application/pdf")] } });

    await waitFor(() => expect(stageFiles).toHaveBeenCalled());
    expect(screen.queryByText(defaultEditorMessages.mediaRejectMime)).toBeNull();
  });

  it("rejects a type outside the declared allow-list", async () => {
    const stageFiles = vi.fn();
    renderForm({ photo_id: null }, { stageFiles }, {}, { uiSchema: PDF_UI });

    fireEvent.change(input("photo_id"), { target: { files: [makeFile("p.jpg", "image/jpeg")] } });

    await waitFor(() => expect(screen.getByText(defaultEditorMessages.mediaRejectMime)).toBeInTheDocument());
    expect(stageFiles).not.toHaveBeenCalled();
  });
});

describe("MediaField — accessibility and unknown ids", () => {
  it("associates the field label with its file input", () => {
    renderForm({ photo_id: null });
    expect(screen.getByLabelText("Photo")).toBeInTheDocument();
  });

  it("keeps a clearable remove control when the value is an id with no known label", () => {
    // A preset id (initialData) or a deleted media row has no thumbnail label,
    // so the dropzone shows its placeholder — but the value is still sent on
    // Save, so there must be a way to clear it.
    renderForm({ photo_id: "m-unknown" });
    expect(document.querySelector('[data-editor-media-remove="photo_id"]')).not.toBeNull();
  });
});
