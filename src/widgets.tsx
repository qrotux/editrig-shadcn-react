import * as React from "react";
import type { FieldProps, RegistryFieldsType, RegistryWidgetsType, WidgetProps } from "@rjsf/utils";
import { ariaDescribedByIds, localToUTC, utcToLocal } from "@rjsf/utils";

import { ClearableInput, isClearable } from "./clearable-input";
import { useEditorForm } from "./form-context";
import { KeyedField } from "./keyed-field";
import { RelationField } from "./relation-field";
import { MediaField } from "./media-field";
import { JsonEditorField } from "./json-field";

/** Language-neutral "no value" glyph; deliberately not an EditorMessages key. */
const EMPTY_DISPLAY = "—";

/** Read-only scalar display: a field the server marked read-only
 *  (`"ui:readonly": true` + `"ui:widget": "readonlyDisplay"`).
 *
 *  It renders TEXT, not a disabled input — a greyed-out input invites editing
 *  and, worse, keeps the value in the tab order. Timestamps (RFC3339, the only
 *  non-scalar shape the server puts here) go through Intl with the page
 *  locale; everything else is stringified as-is. */
export function ReadonlyDisplayWidget({ id, value, schema }: WidgetProps) {
  const { locale } = useEditorForm();
  const text = formatReadonly(value, locale);
  return (
    // p-0.5 — та же обёртка, что тема даёт своим контролам (см.
    // clearable-input.tsx): без неё поле встаёт на 2px выше и левее соседнего по
    // строке.
    <div className="p-0.5">
      <div
        id={id}
        data-editor-readonly={schema?.type === undefined ? "any" : String(schema.type)}
        className="text-foreground border-input bg-muted/40 flex min-h-9 items-center rounded-md border px-3 py-1.5 text-sm"
      >
        {text}
      </div>
    </div>
  );
}

/** Read-only JSON display for jsonb columns the admin must not write (a
 *  column some background process owns). Editable jsonb goes to
 *  JsonEditorField instead; which of the two renders is decided by the field's
 *  own `ui:readonly`.
 *
 *  A FIELD, not a widget: rjsf only routes `ui:widget` for leaf (string /
 *  number / boolean) schemas — an object- or type-less schema goes straight to
 *  ObjectField and ignores the widget. `ui:field` is honoured by SchemaField
 *  for every type, at the cost of rendering our own label (the FieldTemplate
 *  chrome is bypassed). */
export function JsonDisplayField({ fieldPathId, schema, formData }: FieldProps) {
  const id = fieldPathId.$id;
  const text = formData === null || formData === undefined ? EMPTY_DISPLAY : safeStringify(formData);
  return (
    <div className="flex flex-col gap-2">
      {schema?.title && (
        <label className="text-sm leading-none font-medium" htmlFor={id}>
          {schema.title}
        </label>
      )}
      {/* p-0.5 — обёртка темы, см. ReadonlyDisplayWidget выше. */}
      <div className="p-0.5">
        <pre
          id={id}
          data-editor-readonly="json"
          className="border-input bg-muted/40 text-muted-foreground max-h-64 overflow-auto rounded-md border px-3 py-2 font-mono text-xs"
        >
          {text}
        </pre>
      </div>
    </div>
  );
}

/** Календарная дата `YYYY-MM-DD`: ни времени, ни зоны.
 *
 *  Свой виджет, а не core DateWidget: тот при очистке отдаёт
 *  `onChange(value || undefined)`, а undefined выбрасывается JSON.stringify из
 *  PATCH-payload'а — Save читает отсутствие ключа как «колонку не трогаем», и
 *  очистка nullable-даты молча откатывается. Ключ реестра совпадает с format,
 *  которым rjsf резолвит виджет, поэтому перехват происходит без ui:widget.
 *
 *  Пара на Go-стороне — ui.Date(). */
export function DateWidget({
  id,
  name,
  htmlName,
  value,
  required,
  disabled,
  readonly,
  autofocus,
  options,
  rawErrors,
  onChange,
  onBlur,
  onFocus,
}: WidgetProps) {
  return (
    <ClearableInput
      id={id}
      name={htmlName || name}
      type="date"
      // Значение уходит СЫРЫМ: конструктор Date сдвинул бы сутки поясом процесса.
      value={typeof value === "string" ? value : ""}
      required={required}
      disabled={disabled}
      readOnly={readonly}
      autoFocus={autofocus}
      rawErrors={rawErrors}
      aria-describedby={ariaDescribedByIds(id)}
      clearable={isClearable(options)}
      onClear={() => onChange(options?.emptyValue)}
      onChange={(e) => onChange(e.target.value === "" ? options?.emptyValue : e.target.value)}
      onBlur={(e) => onBlur?.(id, e.target.value)}
      onFocus={(e) => onFocus?.(id, e.target.value)}
    />
  );
}

/** timestamptz: на проводе RFC3339, в поле — местное время админа.
 *
 *  Свой виджет по той же причине, что DateWidget: core DateTimeWidget при
 *  очистке отдаёт localToUTC("") === undefined, и ключ выпадает из payload'а.
 *  Конвертация зоны — теми же utcToLocal/localToUTC, что у core.
 *
 *  Пара на Go-стороне — ui.Timestamp().Widget("datetime"). */
export function DateTimeWidget({
  id,
  name,
  htmlName,
  value,
  required,
  disabled,
  readonly,
  autofocus,
  options,
  rawErrors,
  onChange,
  onBlur,
  onFocus,
}: WidgetProps) {
  // utcToLocal отдаёт значение с миллисекундами, а step=1 их не допускает —
  // хвост режется, иначе браузер отказал бы отправить ВСЮ форму из-за
  // stepMismatch в поле, которого админ не трогал.
  const local = utcToLocal(typeof value === "string" ? value : "").slice(0, 19);
  return (
    <ClearableInput
      id={id}
      name={htmlName || name}
      type="datetime-local"
      // Дефолтный step у datetime-local — 60 s, а хранимый момент бывает с
      // секундами.
      step={1}
      value={local}
      required={required}
      disabled={disabled}
      readOnly={readonly}
      autoFocus={autofocus}
      rawErrors={rawErrors}
      aria-describedby={ariaDescribedByIds(id)}
      clearable={isClearable(options)}
      onClear={() => onChange(options?.emptyValue)}
      onChange={(e) => onChange(e.target.value === "" ? options?.emptyValue : localToUTC(e.target.value))}
      onBlur={(e) => onBlur?.(id, e.target.value)}
      onFocus={(e) => onFocus?.(id, e.target.value)}
    />
  );
}

/** Wall-clock ввод: `timestamp without time zone` — значение БЕЗ зоны, и ни
 *  одна сторона его не конвертирует.
 *
 *  Свой виджет, а не штатный `datetime`: тот резолвится в core DateTimeWidget,
 *  который делает utcToLocal на отрисовке и localToUTC на изменении. Для
 *  timestamptz это ровно то, что нужно, а для wall-clock — сдвиг на смещение
 *  пояса, видимый только глазами и только не в UTC.
 *
 *  Пара на Go-стороне — ui.LocalTimestamp() + jetpg.TimeLocal. */
export function LocalDateTimeWidget({
  id,
  name,
  htmlName,
  value,
  required,
  disabled,
  readonly,
  autofocus,
  options,
  rawErrors,
  onChange,
  onBlur,
  onFocus,
}: WidgetProps) {
  return (
    <ClearableInput
      id={id}
      name={htmlName || name}
      type="datetime-local"
      // step=1 обязателен: jetpg.TimeLocal.decode всегда отдаёт канон с
      // секундами, а дефолтный step у datetime-local — 60 s, то есть строка
      // вида "…T10:00:05" даёт stepMismatch. rjsf рендерит форму с включённой
      // нативной валидацией, а Save — submit-кнопка, поэтому браузер отказал
      // бы отправить ВСЮ форму из-за поля, которого админ не трогал.
      step={1}
      value={typeof value === "string" ? value : ""}
      required={required}
      disabled={disabled}
      readOnly={readonly}
      autoFocus={autofocus}
      rawErrors={rawErrors}
      aria-describedby={ariaDescribedByIds(id)}
      // Значение уходит СЫРЫМ: ни Date, ни toISOString — любой из них
      // пересчитал бы его в зону процесса.
      //
      // Пустой ввод отдаётся как options.emptyValue (его ставит ui.Nullable()
      // как ui:emptyValue: null) — ровно так же, как это делает штатный
      // BaseInputTemplate. Отдать undefined было нельзя: JSON.stringify
      // выбрасывает такой ключ из payload'а, и очистка nullable-поля молча
      // превращалась в «не трогаем колонку».
      onChange={(e) => onChange(e.target.value === "" ? options?.emptyValue : e.target.value)}
      onBlur={(e) => onBlur?.(id, e.target.value)}
      onFocus={(e) => onFocus?.(id, e.target.value)}
      clearable={isClearable(options)}
      onClear={() => onChange(options?.emptyValue)}
    />
  );
}

/** Время суток `HH:MM` — канон колонки и публичного API.
 *
 *  Свой виджет, а не штатный `time`: core TimeWidget дописывает `:00` на каждом
 *  изменении (@rjsf/core TimeWidget), то есть отдаёт `HH:MM:SS` — значение вне
 *  канона. По той же причине поле не объявляет format: "time" — ajv трактует
 *  его как RFC3339 и отвергает `10:30` уже НА ЗАГРУЗКЕ, до всякой правки.
 *
 *  Пара на Go-стороне — ui.TimeOfDay(). */
export function TimeOfDayWidget({
  id,
  name,
  htmlName,
  value,
  required,
  disabled,
  readonly,
  autofocus,
  options,
  rawErrors,
  onChange,
  onBlur,
  onFocus,
}: WidgetProps) {
  return (
    <ClearableInput
      id={id}
      name={htmlName || name}
      type="time"
      // Дефолтный step у time — 60 s, что и нужно: канон без секунд, и селектор
      // секунд браузер не показывает.
      value={typeof value === "string" ? value : ""}
      required={required}
      disabled={disabled}
      readOnly={readonly}
      autoFocus={autofocus}
      rawErrors={rawErrors}
      aria-describedby={ariaDescribedByIds(id)}
      // Значение уходит сырым `HH:MM`. Пустой ввод — options.emptyValue (его
      // ставит ui.Nullable()), а не undefined: тот выпал бы из payload'а, и
      // очистка поля молча превратилась бы в «не трогаем колонку».
      onChange={(e) => onChange(e.target.value === "" ? options?.emptyValue : e.target.value)}
      onBlur={(e) => onBlur?.(id, e.target.value)}
      onFocus={(e) => onFocus?.(id, e.target.value)}
      clearable={isClearable(options)}
      onClear={() => onChange(options?.emptyValue)}
    />
  );
}

/** Числовое поле (int/numeric): правое выравнивание и, при заданном
 *  ui:options.decimals, форматирование до N знаков после запятой.
 *
 *  В покое дробное показывается с фиксированным числом знаков (10 → 10.00), под
 *  фокусом — сырым: переформатирование на каждый набранный символ сбивало бы
 *  каретку. onChange уходит СТРОКОЙ, как в штатном BaseInputTemplate, — иначе
 *  rjsf'ный NumberField (@rjsf/core) не удержал бы промежуточный ввод вроде
 *  "10." (он хранит его строкой, пока значение не станет валидным числом).
 *
 *  Пара на Go-стороне — ui.Number()/ui.Integer() (ui:widget "number") и
 *  модификатор .Decimals(n). */
export function NumberWidget({
  id,
  name,
  htmlName,
  value,
  schema,
  required,
  disabled,
  readonly,
  autofocus,
  options,
  rawErrors,
  onChange,
  onBlur,
  onFocus,
}: WidgetProps) {
  const [focused, setFocused] = React.useState(false);
  const decimals = typeof options?.decimals === "number" ? options.decimals : undefined;
  const step = decimals !== undefined ? 10 ** -decimals : undefined;
  // Границы из .Min()/.Max() (schema.minimum/maximum): штатный BaseInputTemplate
  // тянет их через getInputProps, а свой виджет обязан пробросить их сам — иначе
  // теряются нативный кламп спиннера и rangeUnderflow/Overflow. Валидацию границ
  // это не заменяет (её делает ajv по схеме), а дополняет на стороне браузера.
  const min = typeof schema?.minimum === "number" ? schema.minimum : undefined;
  const max = typeof schema?.maximum === "number" ? schema.maximum : undefined;

  // Число может прийти строкой: NumberField держит ввод строкой, пока идёт набор.
  const asString = value === null || value === undefined ? "" : String(value);
  const num = Number(asString);
  const formatted =
    decimals !== undefined && asString !== "" && !Number.isNaN(num) ? num.toFixed(decimals) : asString;
  const shown = focused ? asString : formatted;

  return (
    <ClearableInput
      id={id}
      name={htmlName || name}
      type="number"
      step={step}
      min={min}
      max={max}
      className="text-right"
      value={shown}
      required={required}
      disabled={disabled}
      readOnly={readonly}
      autoFocus={autofocus}
      rawErrors={rawErrors}
      aria-describedby={ariaDescribedByIds(id)}
      clearable={isClearable(options)}
      // Пустой ввод — options.emptyValue (его ставит ui.Nullable()), а не
      // undefined: тот выпал бы из PATCH-payload'а, и очистка молча стала бы
      // «не трогаем колонку».
      onClear={() => onChange(options?.emptyValue)}
      onChange={(e) => onChange(e.target.value === "" ? options?.emptyValue : e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(id, e.target.value);
      }}
      onBlur={(e) => {
        setFocused(false);
        // Приводим хранимое значение к каноничным N знакам, только если
        // округление реально его меняет: показанное "10.57" и хранимое 10.567 не
        // должны расходиться, но лишний onChange (10 → 10) не нужен.
        if (decimals !== undefined && asString !== "" && !Number.isNaN(num)) {
          const rounded = Number(num.toFixed(decimals));
          if (rounded !== num) onChange(rounded);
        }
        onBlur?.(id, e.target.value);
      }}
    />
  );
}

/** Installed once on the library's Form, for every entity.
 *
 *  `date` и `date-time` перекрывают core-виджеты, резолвящиеся ПО FORMAT:
 *  StringField резолвит поле без ui:widget в имя формата (`format: "date"` →
 *  `date`, `format: "date-time"` → `date-time` — см. @rjsf/utils getWidget),
 *  а `datetime` — тот же виджет под именем, которое резолвит явный
 *  `"ui:widget": "datetime"`. Оба ключа нужны, иначе поле без ui:widget уходит
 *  в core DateWidget/DateTimeWidget, а те при очистке отдают undefined,
 *  выпадающий из PATCH-payload'а (см. DateWidget/DateTimeWidget выше).
 *  `localDatetime` и `localTime` зеркалят ui.LocalTimestamp() и ui.TimeOfDay():
 *  имена НЕ совпадают с core'ными `datetime`/`time`, потому что семантика
 *  значения другая — wall-clock без зоны и HH:MM без секунд. */
export const EDITOR_WIDGETS: RegistryWidgetsType = {
  readonlyDisplay: ReadonlyDisplayWidget,
  number: NumberWidget,
  date: DateWidget,
  datetime: DateTimeWidget,
  "date-time": DateTimeWidget,
  localDatetime: LocalDateTimeWidget,
  localTime: TimeOfDayWidget,
};

/** jsonb-поле: read-only рисуется текстом, редактируемое — структурным
 *  редактором. Развилка ЗДЕСЬ, а не двумя ключами ui:field, потому что признак
 *  один и тот же — ui:readonly, из которого движок выводит и strip payload'а. */
function JsonField(props: FieldProps) {
  const readonly = (props.uiSchema as Record<string, unknown> | undefined)?.["ui:readonly"] === true;
  return readonly ? <JsonDisplayField {...props} /> : <JsonEditorField {...props} />;
}

export const EDITOR_FIELDS: RegistryFieldsType = {
  json: JsonField,
  // Ключ зеркалит ui.KeyedFieldKey на Go-стороне (editor/ui/field.go).
  keyed: KeyedField,
  // Так же зеркалит ui.RelationFieldKey (editor/ui/relation.go).
  relation: RelationField,
  // Так же зеркалит ui.MediaFieldKey (editor/ui/media.go): поле-связь с
  // другим рендерером — превью вместо текстового чипа.
  media: MediaField,
};

function formatReadonly(value: unknown, locale: string): string {
  if (value === null || value === undefined || value === "") return EMPTY_DISPLAY;
  if (typeof value === "boolean") return value ? "✓" : "✕";
  if (typeof value === "object") return safeStringify(value);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
    }
  }
  return s;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? EMPTY_DISPLAY;
  } catch {
    return String(value);
  }
}
