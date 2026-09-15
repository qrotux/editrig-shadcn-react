import { describe, it, expect, vi, beforeEach } from "vitest";

// Библиотека замокана целиком: она тянет CodeMirror и в jsdom не поднимается, а
// проверяется здесь НАША половина — условие «строить ли валидатор» и то, что в
// него уходит схема поля как есть. Что ajv делает со схемой дальше — забота
// самой библиотеки и browser-verify.
const createAjvValidator = vi.fn(() => "validator-instance");
vi.mock("vanilla-jsoneditor", () => ({
  createJSONEditor: vi.fn(),
  createAjvValidator: (...args: unknown[]) => createAjvValidator(...(args as [])),
}));

const { validatorFor } = await import("./json-editor");

describe("validatorFor", () => {
  beforeEach(() => createAjvValidator.mockClear());

  // Форма, которую реально отдаёт Go для notification_preferences: тип-объединение
  // с null (колонка nullable) и properties каналов.
  it("builds a validator from the schema the server sends for a constrained jsonb field", () => {
    const schema = {
      type: ["object", "null"],
      additionalProperties: false,
      properties: { email: { type: "object", properties: {}, additionalProperties: false } },
    };

    expect(validatorFor(schema as never)).toBe("validator-instance");
    expect(createAjvValidator).toHaveBeenCalledWith({ schema });
  });

  // home_location_coordinates: jsonb без типа — валидатор из одного title'а не
  // проверял бы ничего и только грузил бы ajv впустую.
  it("builds nothing for an untyped jsonb field (schema carries only a title)", () => {
    expect(validatorFor({ title: "Home location coordinates" } as never)).toBeUndefined();
    expect(createAjvValidator).not.toHaveBeenCalled();
  });

  it("builds nothing when the field has no schema at all", () => {
    expect(validatorFor(undefined)).toBeUndefined();
    expect(createAjvValidator).not.toHaveBeenCalled();
  });

  // Тип без properties — тоже ограничение, и терять его нельзя: условие смотрит
  // на ОБА признака, а не только на состав свойств.
  it("builds a validator when the schema declares a bare type", () => {
    expect(validatorFor({ type: "object" } as never)).toBe("validator-instance");
    expect(createAjvValidator).toHaveBeenCalledTimes(1);
  });
});
