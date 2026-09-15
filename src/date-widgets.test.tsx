import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import { EditorFormProvider } from "./form-context";
import { defaultEditorMessages } from "./messages";
import { EDITOR_FIELDS, EDITOR_WIDGETS } from "./widgets";

afterEach(cleanup);

const ctx = {
  messages: defaultEditorMessages,
  setFieldValues: () => {},
  disabled: false,
  dirtyFields: new Set<string>(),
  resetField: () => {},
  locale: "en-GB",
  contentKey: undefined,
  setContentKey: () => {},
  entity: "storetest",
  base: "/api/admin/entities",
  stagedFiles: new Map(),
  stageFiles: () => {},
  clearStaged: () => {},
  isNew: false,
  recordId: null,
};

function renderForm(schema: RJSFSchema, uiSchema: UiSchema, onChange = vi.fn(), formData?: unknown) {
  render(
    <EditorFormProvider value={ctx}>
      <Form
        schema={schema}
        uiSchema={uiSchema}
        formData={formData}
        validator={validator}
        fields={EDITOR_FIELDS}
        widgets={EDITOR_WIDGETS}
        onChange={(e) => onChange(e.formData)}
      />
    </EditorFormProvider>,
  );
  return onChange;
}

// Схема ровно та, что эмитит ui.Date().Nullable(): виджет резолвится ПО FORMAT,
// ui:widget здесь нет.
const dateSchema: RJSFSchema = {
  type: "object",
  properties: { startDate: { type: ["string", "null"], title: "Start date", format: "date" } },
};
const dateUi: UiSchema = { startDate: { "ui:emptyValue": null } };

describe("date widget", () => {
  it("renders a date input", () => {
    renderForm(dateSchema, dateUi);
    const input = screen.getByLabelText(/start date/i) as HTMLInputElement;
    expect(input.type).toBe("date");
  });

  it("emits the raw YYYY-MM-DD value", () => {
    const onChange = renderForm(dateSchema, dateUi);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-08-18" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-08-18" });
  });

  // Реальный гейт на day-shift: контейнер по умолчанию сидит в Europe/Berlin
  // (UTC+2), а `new Date("2026-08-18")` парсится как UTC-полночь — при
  // ПОЛОЖИТЕЛЬНОМ смещении локальная стрелка уходит на 02:00 того же дня, и
  // Date-конструкторная реализация прошла бы тест выше НЕЗАМЕЧЕННОЙ. При
  // ОТРИЦАТЕЛЬНОМ смещении та же UTC-полночь откатывается на предыдущий день —
  // именно поэтому тест переставляет TZ процесса на America/New_York
  // (Node перечитывает TZ у каждого Date-вызова, а не только при старте).
  it("round-trips the date unshifted at a negative-offset timezone", () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const onChange = renderForm(dateSchema, dateUi, vi.fn(), { startDate: "2026-08-18" });
      const input = screen.getByLabelText(/start date/i) as HTMLInputElement;
      expect(input.value).toBe("2026-08-18");
      // Значение меняется на другую дату: fireEvent.change с тем же value, что
      // уже стоит в поле, React не долетает до onChange (трекер значения видит
      // «без изменений»).
      fireEvent.change(input, { target: { value: "2026-08-19" } });
      expect(onChange).toHaveBeenCalledWith({ startDate: "2026-08-19" });
    } finally {
      process.env.TZ = originalTz;
    }
  });

  // Ядро задачи: core DateWidget отдаёт onChange(value || undefined), а
  // undefined выбрасывается JSON.stringify из PATCH-payload'а — Save читает
  // отсутствие ключа как «колонку не трогаем», и очистка молча откатывается.
  it("clears to null through the clear button, not undefined", () => {
    const onChange = renderForm(dateSchema, dateUi, vi.fn(), { startDate: "2026-08-18" });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("startDate");
    expect(last.startDate).toBeNull();
  });

  it("clears to null when the input itself is emptied", () => {
    const onChange = renderForm(dateSchema, dateUi, vi.fn(), { startDate: "2026-08-18" });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("startDate");
    expect(last.startDate).toBeNull();
  });
});

// Схема ui.Timestamp().Nullable().Widget("datetime"): timestamptz, на проводе
// RFC3339 с зоной.
const dtSchema: RJSFSchema = {
  type: "object",
  properties: { bannedAt: { type: ["string", "null"], title: "Banned at", format: "date-time" } },
};
const dtUi: UiSchema = { bannedAt: { "ui:widget": "datetime", "ui:emptyValue": null } };

describe("datetime widget", () => {
  // utcToLocal отдаёт "…T10:00:05.123", а дефолтный step у datetime-local —
  // 60 s: браузер отказался бы отправить ВСЮ форму из-за stepMismatch в поле,
  // которого админ не трогал.
  it("renders seconds without milliseconds and declares step=1", () => {
    const stored = new Date(2026, 7, 18, 10, 0, 5, 123).toISOString();
    renderForm(dtSchema, dtUi, vi.fn(), { bannedAt: stored });
    const input = screen.getByLabelText(/banned at/i) as HTMLInputElement;
    expect(input.type).toBe("datetime-local");
    expect(input.step).toBe("1");
    // ".000", а не голые секунды: геттер value у datetime-local всегда
    // дописывает миллисекунды, когда секунды ненулевые (jsdom
    // helpers/dates-and-times.js serializeTime — та же ловушка описана в
    // local-datetime.test.tsx). Важно, что хвост НЕ ".123": исходные
    // миллисекунды срезаны, иначе был бы stepMismatch.
    expect(input.value).toBe("2026-08-18T10:00:05.000");
    expect(input.validity.stepMismatch).toBe(false);
  });

  it("converts the entered local value back to UTC", () => {
    const onChange = renderForm(dtSchema, dtUi);
    fireEvent.change(screen.getByLabelText(/banned at/i), { target: { value: "2026-08-18T10:00:05" } });
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last.bannedAt).toBe(new Date(2026, 7, 18, 10, 0, 5).toISOString());
  });

  it("clears to null through the clear button, not undefined", () => {
    const stored = new Date(2026, 7, 18, 10, 0, 5).toISOString();
    const onChange = renderForm(dtSchema, dtUi, vi.fn(), { bannedAt: stored });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("bannedAt");
    expect(last.bannedAt).toBeNull();
  });

  it("clears to null when the input itself is emptied", () => {
    const stored = new Date(2026, 7, 18, 10, 0, 5).toISOString();
    const onChange = renderForm(dtSchema, dtUi, vi.fn(), { bannedAt: stored });
    fireEvent.change(screen.getByLabelText(/banned at/i), { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("bannedAt");
    expect(last.bannedAt).toBeNull();
  });
});

// Схема ui.Timestamp().Nullable() БЕЗ .Widget("datetime") — ровно то, что
// эмитит ui.Timestamp() без явного вызова .Widget(): format:"date-time",
// ui:widget нет вовсе. rjsf резолвит такое поле по имени формата ("date-time"),
// а не по ключу "datetime" — красное здесь означает, что поле незаметно
// провалилось в core DateTimeWidget (нет ×, нет step=1, undefined на очистке).
const dtNoOverrideSchema: RJSFSchema = {
  type: "object",
  properties: { bannedAt: { type: ["string", "null"], title: "Banned at", format: "date-time" } },
};
const dtNoOverrideUi: UiSchema = { bannedAt: { "ui:emptyValue": null } };

describe("datetime widget resolved by format (no ui:widget)", () => {
  it("still renders our widget: step=1 and clears to null, not undefined", () => {
    const stored = new Date(2026, 7, 18, 10, 0, 5).toISOString();
    const onChange = renderForm(dtNoOverrideSchema, dtNoOverrideUi, vi.fn(), { bannedAt: stored });
    const input = screen.getByLabelText(/banned at/i) as HTMLInputElement;
    expect(input.step).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("bannedAt");
    expect(last.bannedAt).toBeNull();
  });
});
