import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";
import { ErrorSchemaBuilder, type RJSFSchema, type UiSchema } from "@rjsf/utils";

import { EditorFormProvider } from "./form-context";
import { defaultEditorMessages } from "./messages";
import { EDITOR_FIELDS, EDITOR_WIDGETS } from "./widgets";

afterEach(cleanup);

// Схема ровно та, что отдаёт Go для bio: объект с одним свойством на ключ,
// ui:field "keyed" и внутреннее поле одной копией в ui:options.inner.
const schema: RJSFSchema = {
  type: "object",
  properties: {
    bio: {
      type: "object",
      title: "Bio",
      additionalProperties: false,
      properties: {
        en: { type: "string" },
        ru: { type: "string" },
      },
    },
  },
};

const uiSchema: UiSchema = {
  bio: {
    "ui:field": "keyed",
    "ui:options": {
      keys: [
        { value: "en", label: "English" },
        { value: "ru", label: "Russian" },
      ],
      default: "en",
      inner: { "ui:widget": "textarea" },
    },
  },
};

/** uiSchema с заданной раскладкой переключателя (её выбирает Go-сторона). */
function withLayout(layout: "chips" | "expanded"): UiSchema {
  const bio = uiSchema.bio as Record<string, unknown>;
  const opts = bio["ui:options"] as Record<string, unknown>;
  return { bio: { ...bio, "ui:options": { ...opts, layout } } };
}

function renderForm(data: Record<string, unknown>, onChange = vi.fn(), ui: UiSchema = uiSchema) {
  const ctx = {
    messages: defaultEditorMessages,
    setFieldValues: () => {},
    disabled: false,
    dirtyFields: new Set<string>(),
    resetField: () => {},
    locale: "en-GB",
    contentKey: undefined,
    setContentKey: () => {},
    entity: "users",
    base: "/api/admin/entities",
    stagedFiles: new Map(),
    stageFiles: () => {},
    clearStaged: () => {},
    isNew: false,
    recordId: null,
  };
  const view = render(
    <EditorFormProvider value={ctx}>
      <Form
        schema={schema}
        uiSchema={ui}
        formData={data}
        validator={validator}
        widgets={EDITOR_WIDGETS}
        fields={EDITOR_FIELDS}
        onChange={(e) => onChange(e.formData)}
      />
    </EditorFormProvider>,
  );
  return { view, onChange };
}

/** Открывает меню переключателя: Radix реагирует на Enter по триггеру, и это
 *  надёжнее эмуляции pointer-событий в jsdom. */
function openSwitcher() {
  const trigger = screen.getByRole("button", { name: /English|Russian/ });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

describe("KeyedField", () => {
  it("рисует переключатель ключей и редактирует только активный", async () => {
    renderForm({ bio: { en: "Hello", ru: "Привет" } });

    // Свёрнутое состояние — ссылка с подписью активного ключа, а не ряд чипсов:
    // ключей может быть много, а поле обязано выглядеть как обычное поле.
    const trigger = screen.getByRole("button", { name: /English/ });
    expect(trigger).toHaveAttribute("data-editor-keyed-trigger");
    expect(screen.queryByRole("menuitem")).toBeNull();

    // Внутреннее поле — textarea, то есть виджет из ui:options.inner, а не
    // выдуманный этим компонентом инпут. Проверяем ДО открытия меню: Radix
    // прячет остальную страницу от a11y-дерева, пока меню раскрыто.
    const input = screen.getByRole("textbox");
    expect(input.tagName).toBe("TEXTAREA");
    expect(input).toHaveValue("Hello");

    // Ровно один инпут: неактивные ключи не рисуются вовсе.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);

    // Подписи ключей приезжают с сервера (Go — SSOT копии), не выдумываются либой.
    openSwitcher();
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.replace(/[•!]/g, "").trim())).toEqual(["English", "Russian"]);
  });

  it("переключение ключа не теряет правку соседнего", async () => {
    const onChange = vi.fn();
    renderForm({ bio: { en: "Hello", ru: "Привет" } }, onChange);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello there" } });
    const afterEdit = onChange.mock.calls.at(-1)?.[0] as { bio: Record<string, string> };
    expect(afterEdit.bio).toEqual({ en: "Hello there", ru: "Привет" });

    // Смена ключа — состояние формы, а не данных: значение соседнего ключа на
    // месте, и запрос на сервер тут не уходит.
    openSwitcher();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Russian/ }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Привет"));
  });

  it("помечает заполненные ключи и ключи с ошибкой", async () => {
    const ctx = {
      messages: defaultEditorMessages,
      setFieldValues: () => {},
      disabled: false,
      dirtyFields: new Set<string>(),
      resetField: () => {},
      locale: "en-GB",
      contentKey: undefined,
      setContentKey: () => {},
      entity: "users",
      base: "/api/admin/entities",
      stagedFiles: new Map(),
      stageFiles: () => {},
      clearStaged: () => {},
      isNew: false,
      recordId: null,
    };
    render(
      <EditorFormProvider value={ctx}>
        <Form
          schema={schema}
          uiSchema={uiSchema}
          formData={{ bio: { en: "Hello", ru: "" } }}
          validator={validator}
          widgets={EDITOR_WIDGETS}
          fields={EDITOR_FIELDS}
          extraErrors={new ErrorSchemaBuilder().addErrors(["too long"], "bio.ru").ErrorSchema}
        />
      </EditorFormProvider>,
    );

    // Ошибка на СКРЫТОМ ключе видна НЕ РАСКРЫВАЯ меню: иначе отклонённый submit
    // выглядит как «ничего не произошло» — админ стоит на другой вкладке.
    const trigger = screen.getByRole("button", { name: /English/ });
    expect(trigger).toHaveAttribute("data-editor-keyed-error", "true");
    expect(trigger.textContent).toContain("(1)");

    openSwitcher();
    const ru = await screen.findByRole("menuitem", { name: /Russian/ });
    const en = await screen.findByRole("menuitem", { name: /English/ });
    expect(ru).toHaveAttribute("data-editor-keyed-error", "true");
    // Заполненность: пустой ключ не должен выглядеть как заполненный.
    expect(en).toHaveAttribute("data-editor-keyed-filled", "true");
    expect(ru).not.toHaveAttribute("data-editor-keyed-filled");
  });
});

describe("KeyedField layouts", () => {
  it("chips: все ключи кнопками, переключение работает", async () => {
    renderForm({ bio: { en: "Hello", ru: "Привет" } }, vi.fn(), withLayout("chips"));

    // Меню нет вовсе — ключи сразу на виду.
    expect(document.querySelector("[data-editor-keyed-trigger]")).toBeNull();
    const en = screen.getByRole("button", { name: /English/ });
    const ru = screen.getByRole("button", { name: /Russian/ });
    expect(en).toHaveAttribute("aria-pressed", "true");
    expect(ru).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(ru);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Привет"));
  });

  it("expanded: по инпуту на ключ, подписи — из ключей, переключателя нет", () => {
    renderForm({ bio: { en: "Hello", ru: "Привет" } }, vi.fn(), withLayout("expanded"));

    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => (i as HTMLTextAreaElement).value)).toEqual(["Hello", "Привет"]);

    // Заголовками свойств становятся подписи ключей: иначе rjsf подставил бы
    // имена свойств, и админ увидел бы «en»/«ru».
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText("Russian")).toBeInTheDocument();
    // Переключать нечего — ни меню, ни чипсов.
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(document.querySelector("[data-editor-keyed-trigger]")).toBeNull();
  });
});
