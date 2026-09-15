import * as React from "react";
import {
  createAjvValidator,
  createJSONEditor,
  type Content,
  type JSONEditorPropsOptional,
  type OnChangeStatus,
  type Validator,
} from "vanilla-jsoneditor";
import { deepEquals, type FieldProps } from "@rjsf/utils";

import { useEditorForm } from "./form-context";

/** Разбор текстового режима. Невалидный JSON наружу не отдаём — редактор сам
 *  показывает свою ошибку, а форма не должна получать полуразобранный документ
 *  на каждом нажатии клавиши. */
function parseText(text: string, status: OnChangeStatus): unknown {
  if (status.contentErrors) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Валидатор из схемы поля, если она что-то ограничивает. Схема приезжает
 *  СХЕМНОЙ половиной поля (Go: ui.Field.Prop), поэтому здесь её не собирают и не
 *  дублируют: тот же документ судит и rjsf на Submit, и структурная валидация на
 *  сервере — расхождение между «редактор молчит» и «сервер вернул 422»
 *  невыразимо.
 *
 *  Схемы может не быть: read-only jsonb-колонка бывает объявлена без типа, и
 *  валидатор из одного title'а ничего бы не проверял.
 *
 *  Экспортируется РАДИ ТЕСТА: сам редактор грузится лениво и в jsdom не
 *  поднимается, поэтому разъезд этого условия с формой схемы (Go отдаёт
 *  type+properties) не покраснел бы нигде, кроме ручной проверки в браузере. */
export function validatorFor(schema: FieldProps["schema"] | undefined): Validator | undefined {
  if (!schema || (schema.type === undefined && schema.properties === undefined)) return undefined;
  return createAjvValidator({ schema: schema as never });
}

/** Императивная обёртка над vanilla-jsoneditor. Загружается ЛЕНИВО (см.
 *  json-field.tsx): библиотека тянет CodeMirror и весит около мегабайта, а
 *  jsonb-поле есть далеко не у каждой сущности — в главный бандл ей нельзя.
 *
 *  Structural editor for a jsonb column the admin edits as a whole document.
 *
 *  A FIELD, not a widget: rjsf routes `ui:widget` only for leaf schemas, and a
 *  jsonb column declares no type at all, so it goes to ObjectField and ignores
 *  widgets entirely (same reason as the keyed field).
 *
 *  Why a library and not a generated form: a large, sparsely-typed jsonb
 *  document (a settings map of many composite keys) would explode into hundreds
 *  of generated inputs. A document editor also shows keys no form knows about,
 *  which is what an admin needs when the taxonomy moves ahead of the editor.
 *
 *  The editor is imperative (Svelte under the hood): mounted into a ref'd div
 *  and destroyed on unmount. It owns its DOM; React only feeds it content and
 *  receives changes. */
export default function JsonEditorImpl({
  schema,
  formData,
  onChange,
  fieldPathId,
  disabled,
  readonly,
}: FieldProps) {
  const { disabled: formDisabled } = useEditorForm();
  const host = React.useRef<HTMLDivElement | null>(null);
  const editor = React.useRef<ReturnType<typeof createJSONEditor> | null>(null);
  // Последнее значение, которое ОТДАЛ редактор: по нему отличается «правка
  // изнутри» от внешней подмены (перезагрузка записи после Save). Без этого
  // каждый onChange возвращался бы в редактор через props и сбивал курсор.
  const own = React.useRef<unknown>(undefined);
  const emit = React.useRef(onChange);
  emit.current = onChange;
  // Путь поля в форме: rjsf v6 применяет правку ПО ПУТИ, а не заменой всего
  // объекта, поэтому соседние поля не трогаются (та же механика, что у
  // вложенных ObjectField).
  const path = React.useRef(fieldPathId.path);
  path.current = fieldPathId.path;

  const locked = Boolean(disabled || readonly || formDisabled);

  React.useEffect(() => {
    if (!host.current) return;
    const props: JSONEditorPropsOptional = {
      content: { json: (formData ?? {}) as never },
      mode: "tree" as never,
      // Панель нужна: в ней переключение tree/text, поиск и undo. Навигационная
      // строка (хлебные крошки пути) — нет: поле живёт внутри формы, а не на
      // весь экран.
      mainMenuBar: true,
      navigationBar: false,
      // Схема известна на монтировании и не меняется в течение жизни формы:
      // её отдаёт декларация сущности, а не данные записи.
      validator: validatorFor(schema),
      onChange: (content: Content, _previous: Content, status: OnChangeStatus) => {
        // В режиме tree редактор отдаёт разобранный документ, в режиме text —
        // СЫРОЙ ТЕКСТ. Без разбора второй ветки правки в текстовом режиме молча
        // не доезжали до формы: Save отправлял прежнее значение (поймано
        // browser-verify, юнит-тесты этого не видят).
        const next = "json" in content ? content.json : parseText(content.text, status);
        if (next === undefined) return;
        own.current = next;
        emit.current(next, path.current);
      },
    };
    const instance = createJSONEditor({ target: host.current, props });
    editor.current = instance;
    return () => {
      editor.current = null;
      void instance.destroy();
    };
    // Монтируем ОДИН раз: редактор владеет своим DOM, и пересоздание на каждое
    // изменение стоило бы фокуса и раскрытых узлов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Внешняя подмена данных (Save вернул новую запись, «Отмена» откатила форму).
  // Сравнение ПО ЗНАЧЕНИЮ, а не по ссылке: rjsf v6 на каждом изменении
  // пересобирает объекты формы, поэтому собственная правка редактора
  // возвращается сюда новой ссылкой — идентичность приняла бы её за внешнюю
  // подмену и звала бы set() на каждый символ, сбивая курсор и раскрытые узлы.
  React.useEffect(() => {
    if (!editor.current || deepEquals(formData, own.current)) return;
    // set, а не update: update мержит патчем, а внешняя подмена — это ЗАМЕНА
    // документа (перезагрузка записи после Save).
    editor.current.set({ json: (formData ?? {}) as never });
    // own.current теперь = показанному значению. Иначе, после внешней подмены
    // (Reset, эхо Save) он держал бы прежнюю правку, и повторный приход того же
    // значения снаружи guard принял бы за «свою правку» и не применил.
    own.current = formData;
  }, [formData]);

  React.useEffect(() => {
    void editor.current?.updateProps({ readOnly: locked });
  }, [locked]);

  // Save может вернуть НОВУЮ схему того же поля (например, другой maxLength):
  // валидатор, собранный один раз на монтировании, судил бы по прежней. Ключ по
  // ЗНАЧЕНИЮ схемы, а не по ссылке — rjsf пересобирает объект схемы на каждый
  // рендер, прямая зависимость гоняла бы эффект впустую.
  const schemaKey = JSON.stringify(schema ?? null);
  React.useEffect(() => {
    void editor.current?.updateProps({ validator: validatorFor(schema) });
    // schema покрыта schemaKey; прямая зависимость нестабильна по ссылке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaKey]);

  return (
    <div className="flex flex-col gap-2">
      {schema?.title && (
        <label className="text-sm leading-none font-medium" htmlFor={fieldPathId.$id}>
          {schema.title}
        </label>
      )}
      <div
        id={fieldPathId.$id}
        ref={host}
        data-editor-json={locked ? "readonly" : "editable"}
        className="border-input overflow-hidden rounded-md border text-sm"
      />
    </div>
  );
}
