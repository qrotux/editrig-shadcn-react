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

// Схема, которую эмитит ui.Number().Nullable().Decimals(2): разрядность живёт в
// ui:options, тип nullable, виджет — number.
const priceSchema: RJSFSchema = {
  type: "object",
  properties: { price: { type: ["number", "null"], title: "Price" } },
};
const priceUi: UiSchema = {
  price: { "ui:widget": "number", "ui:options": { decimals: 2 }, "ui:emptyValue": null },
};

describe("number widget with decimals", () => {
  it("renders a right-aligned number input with step from decimals", () => {
    renderForm(priceSchema, priceUi);
    const input = screen.getByLabelText(/price/i) as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.classList.contains("text-right")).toBe(true);
    expect(input.step).toBe("0.01");
  });

  it("shows fixed decimals at rest", () => {
    renderForm(priceSchema, priceUi, vi.fn(), { price: 10 });
    const input = screen.getByLabelText(/price/i) as HTMLInputElement;
    expect(input.value).toBe("10.00");
  });

  it("rounds to the decimals on blur and stores the rounded number", () => {
    const onChange = renderForm(priceSchema, priceUi, vi.fn(), { price: 1 });
    const input = screen.getByLabelText(/price/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "10.567" } });
    fireEvent.blur(input);
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last.price).toBe(10.57);
    expect(input.value).toBe("10.57");
  });

  it("clears to null through the clear button, not undefined", () => {
    const onChange = renderForm(priceSchema, priceUi, vi.fn(), { price: 10 });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("price");
    expect(last.price).toBeNull();
  });

  it("clears to null when the input itself is emptied", () => {
    const onChange = renderForm(priceSchema, priceUi, vi.fn(), { price: 10 });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last).toHaveProperty("price");
    expect(last.price).toBeNull();
  });
});

// Схема ui.Integer(): виджет number, разрядности нет.
const orderSchema: RJSFSchema = {
  type: "object",
  properties: { order: { type: "integer", title: "Order" } },
};
const orderUi: UiSchema = { order: { "ui:widget": "number" } };

describe("number widget without decimals (integer)", () => {
  it("is right-aligned and does not force decimals", () => {
    renderForm(orderSchema, orderUi, vi.fn(), { order: 7 });
    const input = screen.getByLabelText(/order/i) as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.classList.contains("text-right")).toBe(true);
    expect(input.value).toBe("7");
  });

  it("emits a number on change", () => {
    const onChange = renderForm(orderSchema, orderUi);
    fireEvent.change(screen.getByLabelText(/order/i), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith({ order: 42 });
  });
});

// Схема ui.Number().Min(1).Max(12): границы в minimum/maximum.
const boundedSchema: RJSFSchema = {
  type: "object",
  properties: { month: { type: "number", title: "Month", minimum: 1, maximum: 12 } },
};
const boundedUi: UiSchema = { month: { "ui:widget": "number" } };

describe("number widget bounds", () => {
  it("forwards minimum/maximum as native min/max attributes", () => {
    renderForm(boundedSchema, boundedUi);
    const input = screen.getByLabelText(/month/i) as HTMLInputElement;
    expect(input.min).toBe("1");
    expect(input.max).toBe("12");
  });
});
