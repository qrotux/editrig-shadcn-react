import * as React from "react";
import { getUiOptions, type FieldProps } from "@rjsf/utils";
import { Check, ChevronDown, X } from "lucide-react";

import { cn } from "./ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";

import { useEditorForm } from "./form-context";
import { useRelationOptions } from "./use-editor";

type RelationOptions = {
  /** Собственно коллекция за полем — для ключа кэша и отладки; ЗАПРАШИВАЮТСЯ
   *  опции по имени ПОЛЯ (так устроен роут /options/{field}). */
  collection?: string;
  multi?: boolean;
  /** Подписи уже выбранных значений: приехали тем же конвертом, что и данные. */
  labels?: Record<string, string>;
  /** Имя ПОЛЯ ФОРМЫ, чьё значение идёт в `?parent` запроса опций (см.
   *  ui.Field.ParentField). Задан — источник скоупится соседним полем, а не
   *  владельцем строки, и список наполнен уже на форме создания. */
  parentField?: string;
};

/** Задержка поиска. 250 мс — компромисс: набор «мун» не шлёт трёх запросов, а
 *  пауза между буквами у обычной скорости печати её не превышает. */
const SEARCH_DEBOUNCE_MS = 250;

/** Поле-связь: значение это id (или упорядоченный список id), а видит админ
 *  подписи.
 *
 *  FIELD, а не widget, для ОБЕИХ кардинальностей: у multi схема массивная, и
 *  rjsf роутит widget только для листовых схем (та же причина, что у
 *  JsonEditorField). Один компонент на оба случая — потому что различие между
 *  ними в кардинальности, а не в поведении.
 *
 *  Подписи ВЫБРАННЫХ значений приходят в ui:options.labels вместе с Load, а не
 *  отдельным запросом на монтировании: конверт уже несёт и данные, и uiSchema.
 *  Список для выбора грузится только когда пикер открыли.
 *
 *  Порядок чипов ЗНАЧИМ (на сервере это колонка "order"), поэтому чипы можно
 *  перетаскивать. Штатный HTML5 drag&drop, без библиотеки: клавиатурный путь
 *  всё равно нужен отдельно (кнопки ←/→), а мышиный этим и покрывается. */
export function RelationField(props: FieldProps) {
  const { schema, uiSchema, formData, onChange, fieldPathId, name, disabled, readonly } = props;
  const { messages, entity, base, fetch: fetchImpl, recordId, rootData } = useEditorForm();

  const options = getUiOptions(uiSchema) as RelationOptions;
  const multi = options.multi === true;
  const labels = options.labels ?? {};

  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [dragging, setDragging] = React.useState<number | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term]);

  // Поле формы — id-шники; подписи только показываются. Отсюда и правка
  // значения, и отправка на сервер работают с одним и тем же массивом.
  const selected: string[] = multi
    ? Array.isArray(formData)
      ? (formData as string[])
      : []
    : typeof formData === "string" && formData !== ""
      ? [formData as string]
      : [];

  const fieldName = name || fieldPathId.$id.replace(/^root_/, "") || "";
  // Relation is a TOP-LEVEL field only: options are requested by the bare field
  // name (`/options/{field}`), so a relation inside an array item or nested
  // object resolves to a name the server does not know and the picker shows an
  // empty list. That fails visibly rather than corrupting anything, so unlike
  // media this still renders — it just warns the developer.
  const pathKey = (fieldPathId?.path ?? []).join("/");
  const nested = (fieldPathId?.path?.length ?? 0) !== 1;
  React.useEffect(() => {
    if (nested)
      console.warn(
        `editrig: relation field "${pathKey}" is nested; relation must be a top-level field. ` +
          `Options are requested by field name, so the picker will show an empty list.`,
      );
  }, [nested, pathKey]);
  const parent = options.parentField
    ? (rootData?.[options.parentField] as string | undefined) || undefined
    : (recordId ?? undefined);
  const q = useRelationOptions(entity, fieldName, search, open, base, parent, fetchImpl);
  const locked = disabled || readonly;

  // Потолок числа значений — из схемы (ui.Field.MaxItems на Go-стороне), а не
  // из ui:options: это ключевое слово JSON Schema, и ajv формы бракует по нему
  // сам. Виджет читает то же самое, чтобы отказ приходил В МОМЕНТ выбора, а не
  // на сабмите — иначе пикер разрешает набрать лишнее и обвиняет в этом админа.
  const maxItems = multi && typeof schema.maxItems === "number" ? schema.maxItems : null;
  const full = maxItems !== null && selected.length >= maxItems;

  // Подпись неизвестного значения — сам id: пустой чип неотличим от сломанного,
  // а id опознаваем и его можно найти в БД.
  const labelOf = (id: string) => labels[id] ?? q.data?.find((o) => o.value === id)?.label ?? id;

  const commit = (next: string[]) => {
    // ПУТЬ ОБЯЗАТЕЛЕН: в rjsf v6 сигнатура onChange — (value, path, …), и по
    // path родительский ObjectField решает, КУДА положить значение. Без него
    // значение поля уезжает в корень и подменяет собой всю форму — молча, без
    // единой ошибки (json-editor.tsx хранит path по той же причине).
    const path = fieldPathId?.path;
    // Одиночная связь: пусто это null, а не "" — колонка nullable, и пустая
    // строка полагалась бы на снисходительность uuid-каста (см. jetpg.UUID).
    onChange(multi ? next : (next[0] ?? null), path);
  };

  const toggle = (id: string) => {
    if (!multi) {
      commit([id]);
      setOpen(false);
      return;
    }
    if (selected.includes(id)) {
      commit(selected.filter((x) => x !== id));
      return;
    }
    // Снятие выбора на полном поле остаётся доступным — заперты только ДОБАВЛЕНИЯ
    // (опции пикера при этом ещё и disabled, но клавиатурный путь cmdk идёт
    // мимо них не всегда).
    if (!full) commit([...selected, id]);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= selected.length || from === to) return;
    const next = [...selected];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  return (
    <div className="flex flex-col gap-2" data-editor-relation={fieldName}>
      {(schema.title || maxItems !== null) && (
        <div className="flex items-center justify-between gap-2">
          {schema.title && (
            <label className="text-sm leading-none font-medium" htmlFor={fieldPathId.$id}>
              {schema.title}
            </label>
          )}
          {/* Счётчик — только цифры: он объясняет, почему опции пикера погасли,
              и переводить в нём нечего. */}
          {maxItems !== null && (
            <span
              data-editor-relation-count={fieldName}
              className={cn("text-xs tabular-nums", full ? "text-destructive" : "text-muted-foreground")}
            >
              {selected.length} / {maxItems}
            </span>
          )}
        </div>
      )}

      {/* Чипы — только у multi: у одиночной связи выбранное значение и так
          написано на самой кнопке, и вторая его копия читалась бы как второе
          значение. */}
      {multi && selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id, i) => (
            <span
              key={id}
              draggable={multi && !locked}
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null) move(dragging, i);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
              data-editor-relation-chip={id}
              className={cn(
                "border-input bg-muted/40 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                multi && !locked && "cursor-grab",
                dragging === i && "opacity-50",
              )}
            >
              {/* Клавиатурный путь перестановки: HTML5 drag мышиный, и без
                  этих двух кнопок порядок правился бы только мышью. */}
              {multi && !locked && selected.length > 1 && (
                <button
                  type="button"
                  aria-label={messages.relationMoveLeft}
                  data-editor-relation-left={id}
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  ‹
                </button>
              )}
              <span>{labelOf(id)}</span>
              {multi && !locked && selected.length > 1 && (
                <button
                  type="button"
                  aria-label={messages.relationMoveRight}
                  data-editor-relation-right={id}
                  onClick={() => move(i, i + 1)}
                  disabled={i === selected.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  ›
                </button>
              )}
              {!locked && (
                <button
                  type="button"
                  aria-label={messages.relationRemove}
                  data-editor-relation-remove={id}
                  onClick={() => commit(selected.filter((x) => x !== id))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* p-0.5 — та же обёртка, что тема даёт своим контролам (см.
          clearable-input.tsx): без неё поле встаёт на 2px выше и левее соседнего
          по строке select'а. */}
      <div className="flex items-center gap-1 p-0.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={fieldPathId.$id}
              disabled={locked}
              data-editor-relation-trigger={fieldName}
              className={cn(
                "border-input bg-background flex h-9 w-full items-center justify-between rounded-md border px-3 py-1 text-sm",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span className={cn(selected.length === 0 && "text-muted-foreground")}>
                {multi || selected.length === 0 ? messages.relationSelect : labelOf(selected[0])}
              </span>
              <ChevronDown className="size-4 opacity-50" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64">
            {/* shouldFilter=false: фильтрует СЕРВЕР (коллекция может не помещаться
                в ответ целиком), а cmdk отфильтровал бы уже отфильтрованное — по
                своему алгоритму и по другой строке. */}
            <Command shouldFilter={false}>
              <CommandInput
                value={term}
                onValueChange={setTerm}
                placeholder={messages.relationSearch}
                data-editor-relation-search={fieldName}
              />
              <CommandList>
                {!q.isFetching && (q.data ?? []).length === 0 && (
                  <CommandEmpty>{messages.relationEmpty}</CommandEmpty>
                )}
                {(q.data ?? []).map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    disabled={full && !selected.includes(option.value)}
                    onSelect={() => toggle(option.value)}
                    data-editor-relation-option={option.value}
                  >
                    <Check
                      className={cn("size-3", selected.includes(option.value) ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    <span className="flex-1">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {/* Очистка одиночной связи: чипа у неё нет, поэтому крестик живёт
            рядом с кнопкой. Поле nullable — «не выбрано» законное состояние. */}
        {!multi && !locked && selected.length > 0 && (
          <button
            type="button"
            aria-label={messages.relationRemove}
            data-editor-relation-remove={selected[0]}
            onClick={() => commit([])}
            className="text-muted-foreground hover:text-destructive shrink-0 p-1"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
