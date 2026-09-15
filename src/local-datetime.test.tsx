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

// ВАЖНО: часовой пояс задаётся ПЕРЕМЕННОЙ ОКРУЖЕНИЯ при запуске
// (`TZ=Asia/Almaty npx vitest run …`), а не из теста. `process.env.TZ = …`
// внутри beforeAll не подействует: Node читает зону при старте процесса, и
// тест «прошёл бы» в UTC — то есть ровно там, где баг конверсии невидим.
// Прогон под не-UTC зоной — часть критерия приёмки, см. Step 4.

// EditorFormProvider принимает ОДИН проп `value` с полным контекстом — не
// россыпь locale/messages. Литерал скопирован из keyed-field.test.tsx:51-68.
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

const wallClockSchema: RJSFSchema = {
  type: "object",
  properties: { localAt: { type: "string", title: "Local at" } },
};
const wallClockUi: UiSchema = { localAt: { "ui:widget": "localDatetime" } };

const nullableSchema: RJSFSchema = {
  type: "object",
  properties: { localAt: { type: ["string", "null"], title: "Local at" } },
};
const nullableUi: UiSchema = {
  localAt: { "ui:widget": "localDatetime", "ui:emptyValue": null },
};

describe("LocalDateTimeWidget", () => {
  it("renders a datetime-local input", () => {
    renderForm(wallClockSchema, wallClockUi);
    const input = screen.getByLabelText(/local at/i) as HTMLInputElement;
    expect(input.type).toBe("datetime-local");
  });

  // Ядро задачи: штатный rjsf datetime сделал бы utcToLocal/localToUTC и сдвинул
  // бы значение на смещение пояса. Здесь значение обязано пройти насквозь.
  it("passes the typed value through without any zone conversion", () => {
    const onChange = renderForm(wallClockSchema, wallClockUi);
    const input = screen.getByLabelText(/local at/i);
    fireEvent.change(input, { target: { value: "2026-08-05T10:00" } });
    expect(onChange).toHaveBeenCalledWith({ localAt: "2026-08-05T10:00" });
  });

  it("shows the server value with no zone shift", () => {
    // Seconds deliberately non-zero: input[type=datetime-local]'s value
    // getter always drops trailing ":00" seconds per the HTML value
    // serialization algorithm (jsdom helpers/dates-and-times.js
    // serializeTime — omits second/millisecond when both are 0), regardless
    // of any `step` attribute. That's a real browser quirk unrelated to the
    // zone-conversion bug this widget guards against, so the fixture avoids
    // it rather than asserting something no datetime-local input can do. Once
    // seconds are non-zero the same algorithm always appends milliseconds
    // too, hence the ".000" in the expectation.
    renderForm(wallClockSchema, wallClockUi, vi.fn(), { localAt: "2026-08-05T10:00:05" });
    const input = screen.getByLabelText(/local at/i) as HTMLInputElement;
    expect(input.value).toBe("2026-08-05T10:00:05.000");
  });

  it("clears to empty rather than to an invalid date", () => {
    const onChange = renderForm(wallClockSchema, wallClockUi, vi.fn(), { localAt: "2026-08-05T10:00:00" });
    const input = screen.getByLabelText(/local at/i);
    fireEvent.change(input, { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last.localAt ?? "").toBe("");
  });

  // Гейт на канал очистки nullable-поля. `?? ""` в тесте выше одинаково зелен
  // для undefined/null/"" — а разница решает всё: undefined выпадает из
  // JSON.stringify в use-editor.ts, payload приезжает без ключа, и
  // Table.Assignments трактует это как «колонку не трогаем». Здесь ассерт
  // строгий, и ui:emptyValue — тот самый, что ставит ui.Nullable() на Go-стороне.
  it("sends the declared emptyValue (null) when a nullable field is cleared", () => {
    const onChange = renderForm(nullableSchema, nullableUi, vi.fn(), { localAt: "2026-08-05T10:00:00" });
    const input = screen.getByLabelText(/local at/i);
    fireEvent.change(input, { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("localAt");
    expect(last.localAt).toBeNull();
  });

  it("clears the value to null through the clear button", () => {
    const onChange = renderForm(nullableSchema, nullableUi, vi.fn(), { localAt: "2026-08-05T10:00:00" });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("localAt");
    expect(last.localAt).toBeNull();
  });

  // wallClockUi не объявляет ui:emptyValue — это NOT NULL-колонка, очищать её нечем.
  it("shows no clear button for a non-nullable field", () => {
    renderForm(wallClockSchema, wallClockUi, vi.fn(), { localAt: "2026-08-05T10:00:00" });
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });

  it("shows the clear button disabled while the field is empty", () => {
    renderForm(nullableSchema, nullableUi, vi.fn(), {});
    const btn = screen.getByRole("button", { name: /clear/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // Серверный канон всегда с секундами (jetpg.TimeLocal.decode), а дефолтный
  // step у datetime-local — 60 s. Без step=1 значение, которого админ не
  // касался, даёт stepMismatch и блокирует submit ВСЕЙ формы.
  it("accepts a value with non-zero seconds (step=1, no stepMismatch)", () => {
    renderForm(wallClockSchema, wallClockUi, vi.fn(), { localAt: "2026-08-05T10:00:05" });
    const input = screen.getByLabelText(/local at/i) as HTMLInputElement;
    expect(input.step).toBe("1");
    expect(input.validity.stepMismatch).toBe(false);
    expect(input.checkValidity()).toBe(true);
  });
});

// Расхождение read-only массива со скалярными полями принято сознательно:
// rjsf роутит ui:widget только для листовых типов, поэтому readonlyDisplay на
// массив не встаёт. Тест держит ФАКТИЧЕСКОЕ поведение темы — кнопки остаются в
// DOM выключенными, а не исчезают.
describe("read-only list", () => {
  it("keeps add/remove buttons in the DOM but disabled", () => {
    render(
      <EditorFormProvider value={ctx}>
        <Form
          schema={{
            type: "object",
            properties: { tags: { type: "array", title: "Tags", items: { type: "string" } } },
          }}
          uiSchema={{ tags: { "ui:readonly": true } }}
          formData={{ tags: ["a"] }}
          validator={validator}
          fields={EDITOR_FIELDS}
          widgets={EDITOR_WIDGETS}
        />
      </EditorFormProvider>,
    );
    // Кнопку Submit исключаем: <Form> без children рендерит её сам
    // (@rjsf/core Form.js:908 — `children || <SubmitButton …>`), и она НЕ
    // disabled, потому что readonly объявлен у поля, а не у формы. Без фильтра
    // тест был бы красным по причине, к массиву отношения не имеющей.
    const buttons = screen.getAllByRole("button").filter((b) => (b as HTMLButtonElement).type !== "submit");
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b).toBeDisabled();
    }
  });
});
