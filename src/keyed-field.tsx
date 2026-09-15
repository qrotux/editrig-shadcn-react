import * as React from "react";
import { getUiOptions, type FieldProps, type UiSchema } from "@rjsf/utils";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "./ui/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

import { useEditorForm } from "./form-context";

/** One switchable key of a keyed field. Value and label travel together, so
 *  a label can never orphan itself from a key that no longer exists. */
export type KeyedKey = { value: string; label?: string };

/** How the keys are offered. Chosen by the ENTITY AUTHOR on the Go side
 *  (`ui.Field.KeyedLayout`), because how many keys there are — and whether they
 *  are edited together — is domain knowledge, not a library preference. */
export type KeyedLayout = "popover" | "chips" | "expanded";

type KeyedOptions = {
  keys?: KeyedKey[];
  default?: string;
  layout?: KeyedLayout;
  /** uiSchema half of the INNER field, one copy for every key (the field is
   *  the same everywhere — different widgets per key would be different
   *  fields). */
  inner?: UiSchema;
};

/** A field that holds one value per key — text per locale, limit per tier.
 *
 *  Visually it is an ordinary field plus a key switcher in its label; the
 *  editing surface itself is whatever the server declared INSIDE
 *  (`ui.Keyed(ui.String().Widget("textarea"), …)`). That is why this component
 *  renders no input of its own: it narrows the object schema down to the
 *  active key and hands it to the registry's own ObjectField, so textarea
 *  today and a relation picker tomorrow work here without touching this file.
 *
 *  A FIELD, not a widget: rjsf routes `ui:widget` only for leaf schemas, and an
 *  object-typed schema goes straight to ObjectField (same reason as
 *  JsonDisplayField).
 *
 *  Writes stay path-based (ObjectField reports the changed property by path),
 *  so keys that are not currently rendered keep their values in formData — the
 *  server then treats an absent key as "don't touch this one". */
export function KeyedField(props: FieldProps) {
  const { schema, uiSchema, formData, errorSchema, registry, disabled, readonly } = props;
  const { contentKey, setContentKey } = useEditorForm();

  const options = getUiOptions(uiSchema) as KeyedOptions;
  const keys = options.keys ?? [];
  // Неизвестное значение сюда не доезжает: закрытый список стережёт ui.Lint на
  // Go-стороне, здесь остаётся дефолт для схем, где раскладку не объявляли.
  const layout: KeyedLayout = options.layout ?? "popover";
  // Own choice wins over the form-wide one; switching here also updates the
  // form-wide key, so untouched keyed fields follow along ("show me Russian
  // everywhere") while a field the admin pinned by hand stays where it was.
  const [pinned, setPinned] = React.useState<string | null>(null);

  const known = (k: string | undefined | null) => (k != null && keys.some((x) => x.value === k) ? k : null);
  const active = known(pinned) ?? known(contentKey) ?? known(options.default) ?? keys[0]?.value;

  if (keys.length === 0 || active === undefined) {
    // Nothing to switch and nothing to edit: the Go-side lint (ui.Lint) rejects
    // this shape, so it only happens if the envelope was hand-edited.
    return null;
  }

  const values = (formData ?? {}) as Record<string, unknown>;
  const errors = (errorSchema ?? {}) as Record<string, { __errors?: string[] } | undefined>;
  const activeKey = keys.find((k) => k.value === active);
  // Ошибки на НЕАКТИВНЫХ ключах: активный и так подсвечен самим rjsf под инпутом.
  const otherErrors = keys.filter(
    (k) => k.value !== active && (errors[k.value]?.__errors ?? []).length > 0,
  ).length;

  // The inner field renders through the registry's ObjectField, narrowed to the
  // active key: rjsf keeps ownership of ids, paths, errors and onChange.
  const ObjectField = registry.fields.ObjectField;
  const activeSchema = {
    ...schema,
    // Title/description belong to the keyed field as a whole and are rendered
    // above by us — leaving them here would print the label twice.
    title: undefined,
    description: undefined,
    properties: { [active]: (schema.properties ?? {})[active] },
  };
  const activeUiSchema: UiSchema = {
    ...(uiSchema ?? {}),
    "ui:field": undefined,
    // label:false гасит СВОЙ заголовок вложенного ObjectField: он берётся как
    // `uiOptions.title ?? schema.title ?? title ?? name` (@rjsf/core
    // ObjectField.js), то есть, обнулив title, мы получили бы имя свойства —
    // подпись «bio» второй раз, под нашим переключателем.
    "ui:options": { label: false },
    // The inner half carries the widget the entity declared (textarea, …).
    // label:false goes through ui:options, not the bare `ui:label` key: the
    // FieldTemplate reads it from uiOptions, so the bare key left the property
    // name ("bio") printed a second time under the switcher.
    [active]: {
      ...(options.inner ?? {}),
      "ui:options": { ...((options.inner ?? {})["ui:options"] ?? {}), label: false },
    },
  };

  const switchTo = (key: string) => {
    setPinned(key);
    setContentKey?.(key);
  };

  const marks = (key: KeyedKey) => ({
    hasError: (errors[key.value]?.__errors ?? []).length > 0,
    filled: typeof values[key.value] === "string" && values[key.value] !== "",
  });

  if (layout === "expanded") {
    // Все ключи сразу: переключателя нет, поэтому нет и активного ключа — а
    // значит форм-широкий contentKey эту ветку не касается (синхронизировать
    // нечего, а прокрутка/фокус от соседнего поля прыгали бы без причины).
    // Подписи ключей становятся заголовками свойств: иначе rjsf подставит имя
    // свойства и админ увидит «en»/«ru» вместо «English»/«Русский».
    const allSchema = {
      ...schema,
      title: undefined,
      description: undefined,
      properties: Object.fromEntries(
        keys.map((key) => [
          key.value,
          { ...((schema.properties ?? {})[key.value] as object), title: key.label || key.value },
        ]),
      ),
    };
    const allUiSchema: UiSchema = {
      ...(uiSchema ?? {}),
      "ui:field": undefined,
      "ui:options": { label: false },
      ...Object.fromEntries(keys.map((key) => [key.value, options.inner ?? {}])),
    };
    return (
      <div className="flex flex-col gap-2" data-editor-keyed-expanded>
        {schema.title && <label className="text-sm leading-none font-medium">{schema.title}</label>}
        <ObjectField {...props} schema={allSchema} uiSchema={allUiSchema} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-editor-keyed={active}>
      <div className="flex flex-wrap items-center gap-2">
        {schema.title && <label className="text-sm leading-none font-medium">{schema.title}</label>}
        {keys.length > 1 && layout === "chips" && (
          // Все ключи на виду. Годится, пока их немного: при десятке ряд кнопок
          // перевешивает сам инпут.
          <div className="flex flex-wrap gap-1" role="group" aria-label={schema.title}>
            {keys.map((key) => {
              const { hasError, filled } = marks(key);
              return (
                <button
                  key={key.value}
                  type="button"
                  disabled={disabled || readonly}
                  aria-pressed={key.value === active}
                  data-editor-keyed-option={key.value}
                  data-editor-keyed-error={hasError || undefined}
                  data-editor-keyed-filled={filled || undefined}
                  onClick={() => switchTo(key.value)}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                    key.value === active
                      ? "border-input bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 border-transparent",
                    hasError && "border-destructive/60 text-destructive",
                  )}
                >
                  {key.label || key.value}
                  {hasError ? <span aria-hidden>!</span> : filled && <span aria-hidden>•</span>}
                </button>
              );
            })}
          </div>
        )}
        {keys.length > 1 && layout === "popover" && (
          // Ссылка с меню, а не ряд чипсов: ключей может быть и пять, и
          // пятнадцать, а поле-карта обязано выглядеть как обычное поле — иначе
          // ряд кнопок перевешивает сам инпут и ломает двухколоночную секцию.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled || readonly}
                data-editor-keyed-trigger
                data-editor-keyed-error={otherErrors > 0 || undefined}
                className={cn(
                  "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline disabled:opacity-50",
                  otherErrors > 0 && "text-destructive",
                )}
              >
                {activeKey?.label || active}
                {/* Ошибки живут на ключах, которых админ сейчас не видит: без
                    счётчика отклонённый submit выглядит как «ничего не
                    произошло» — он стоит на другой вкладке. */}
                {otherErrors > 0 && <span aria-hidden>({otherErrors})</span>}
                <ChevronDown className="size-3" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              {keys.map((key) => {
                const { hasError, filled } = marks(key);
                return (
                  <DropdownMenuItem
                    key={key.value}
                    onSelect={() => switchTo(key.value)}
                    data-editor-keyed-option={key.value}
                    data-editor-keyed-error={hasError || undefined}
                    data-editor-keyed-filled={filled || undefined}
                    className={cn("gap-2 text-xs", hasError && "text-destructive")}
                  >
                    <Check
                      className={cn("size-3", key.value === active ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    <span className="flex-1">{key.label || key.value}</span>
                    {/* Пустой ключ не должен выглядеть как заполненный: иначе
                        непереведённые локали неотличимы от переведённых. */}
                    {hasError ? <span aria-hidden>!</span> : filled && <span aria-hidden>•</span>}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <ObjectField {...props} schema={activeSchema} uiSchema={activeUiSchema} />
    </div>
  );
}
