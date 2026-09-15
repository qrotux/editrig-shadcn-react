import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { ClearableInput, isClearable } from "./clearable-input";

afterEach(cleanup);

describe("ClearableInput", () => {
  it("shows a clear button when the field is clearable and filled", () => {
    const onClear = vi.fn();
    render(<ClearableInput clearable value="2026-08-18" onChange={() => {}} onClear={onClear} />);
    const btn = screen.getByRole("button", { name: /clear/i });
    // type="button" обязателен: Save — submit-кнопка формы.
    expect(btn.getAttribute("type")).toBe("button");
    fireEvent.click(btn);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not clearable", { clearable: false, value: "2026-08-18" }],
    ["disabled", { clearable: true, value: "2026-08-18", disabled: true }],
    ["readonly", { clearable: true, value: "2026-08-18", readOnly: true }],
  ])("hides the clear button when %s", (_name, props) => {
    render(<ClearableInput {...props} onChange={() => {}} onClear={() => {}} />);
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });

  // Пустое значение НЕ прячет кнопку, а лишь выключает: ширина поля не дёргается
  // от очистки к очистке.
  it("shows the clear button disabled when the field is empty", () => {
    render(<ClearableInput clearable value="" onChange={() => {}} onClear={() => {}} />);
    const btn = screen.getByRole("button", { name: /clear/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // После очистки кнопка становится disabled и фокус на ней не удерживается —
  // без явного возврата он провалился бы на body, и клавиатурный пользователь
  // потерял бы место в форме.
  it("returns focus to the input after clearing", () => {
    render(<ClearableInput clearable value="2026-08-18" onChange={() => {}} onClear={() => {}} id="f" />);
    const btn = screen.getByRole("button", { name: /clear/i });
    btn.focus();
    fireEvent.click(btn);
    expect(document.activeElement).toBe(document.getElementById("f"));
  });

  it("applies the theme's destructive border when rawErrors is non-empty", () => {
    const { rerender } = render(
      <ClearableInput clearable={false} value="2026-08-18" onChange={() => {}} onClear={() => {}} id="f" />,
    );
    expect(document.getElementById("f")?.className).not.toMatch(/border-destructive/);
    rerender(
      <ClearableInput
        clearable={false}
        value="2026-08-18"
        onChange={() => {}}
        onClear={() => {}}
        id="f"
        rawErrors={["required"]}
      />,
    );
    expect(document.getElementById("f")?.className).toMatch(/border-destructive/);
  });

  // aria-describedby — обычный HTML-атрибут: он долетает до <Input> тем же
  // {...props}, которым долетают value/onChange, поэтому тест фиксирует, что
  // спред не срезает его где-то по пути.
  it("forwards aria-describedby to the input", () => {
    render(
      <ClearableInput
        clearable={false}
        value="2026-08-18"
        onChange={() => {}}
        onClear={() => {}}
        id="f"
        aria-describedby="f__error"
      />,
    );
    expect(document.getElementById("f")?.getAttribute("aria-describedby")).toBe("f__error");
  });
});

// Очищаемость выводится из ui:emptyValue: null — его ставит только
// ui.Nullable() на Go-стороне, поэтому NOT NULL-колонка крестика не получает.
describe("isClearable", () => {
  it("is true only for a declared null emptyValue", () => {
    expect(isClearable({ emptyValue: null })).toBe(true);
    expect(isClearable({})).toBe(false);
    expect(isClearable({ emptyValue: "" })).toBe(false);
    expect(isClearable(undefined)).toBe(false);
  });
});
