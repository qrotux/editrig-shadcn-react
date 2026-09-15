import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import { EditorFormProvider } from "./form-context";
import { defaultEditorMessages } from "./messages";
import { EDITOR_FIELDS, EDITOR_WIDGETS } from "./widgets";

afterEach(cleanup);

// Литерал контекста скопирован из local-datetime.test.tsx: EditorFormProvider
// принимает один проп со всем содержимым.
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

// Схема — ровно та, что эмитит ui.TimeOfDay().Pattern(...).Nullable():
// без format, с паттерном канона HH:MM.
const hhmmPattern = "^([01]\\d|2[0-3]):[0-5]\\d$";
const timeSchema: RJSFSchema = {
  type: "object",
  properties: { departAt: { type: ["string", "null"], title: "Departure time", pattern: hhmmPattern } },
};
const timeUi: UiSchema = { departAt: { "ui:widget": "localTime", "ui:emptyValue": null } };

describe("TimeOfDayWidget", () => {
  it("renders a time input", () => {
    renderForm(timeSchema, timeUi);
    const input = screen.getByLabelText(/departure time/i) as HTMLInputElement;
    expect(input.type).toBe("time");
  });

  // Ядро задачи: штатный core TimeWidget дописывает ":00" на каждом изменении,
  // и значение уезжало бы из канона колонки.
  it("emits HH:MM without appending seconds", () => {
    const onChange = renderForm(timeSchema, timeUi);
    const input = screen.getByLabelText(/departure time/i);
    fireEvent.change(input, { target: { value: "10:30" } });
    expect(onChange).toHaveBeenCalledWith({ departAt: "10:30" });
  });

  // Вторая половина того же дефекта: хранимое HH:MM обязано проходить
  // валидацию НА ЗАГРУЗКЕ. С format: "time" ajv отвергал его до всякой правки.
  it("accepts a stored HH:MM value without a validation error", () => {
    renderForm(timeSchema, timeUi, vi.fn(), { departAt: "10:30" });
    const input = screen.getByLabelText(/departure time/i) as HTMLInputElement;
    expect(input.value).toBe("10:30");
    expect(screen.queryByText(/must match format/i)).toBeNull();
  });

  // Канал очистки nullable-поля: undefined выпал бы из JSON.stringify, и
  // очистка молча превратилась бы в «колонку не трогаем».
  it("sends the declared emptyValue (null) when cleared", () => {
    const onChange = renderForm(timeSchema, timeUi, vi.fn(), { departAt: "10:30" });
    const input = screen.getByLabelText(/departure time/i);
    fireEvent.change(input, { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("departAt");
    expect(last.departAt).toBeNull();
  });

  // Крестик — единственный способ вернуть nullable-время в NULL: нативный
  // <input type=time> кнопки очистки не даёт.
  it("clears the value to null through the clear button", () => {
    const onChange = renderForm(timeSchema, timeUi, vi.fn(), { departAt: "10:30" });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("departAt");
    expect(last.departAt).toBeNull();
  });

  it("shows no clear button for a non-nullable field", () => {
    const notNull: RJSFSchema = {
      type: "object",
      properties: { departAt: { type: "string", title: "Departure time", pattern: hhmmPattern } },
    };
    renderForm(notNull, { departAt: { "ui:widget": "localTime" } }, vi.fn(), { departAt: "10:30" });
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });

  it("shows the clear button disabled while the field is empty", () => {
    renderForm(timeSchema, timeUi, vi.fn(), {});
    const btn = screen.getByRole("button", { name: /clear/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
