import * as React from "react";
import { X } from "lucide-react";
import type { WidgetProps } from "@rjsf/utils";

import { Input } from "./ui/input";
import { cn } from "./ui/cn";
import { useEditorForm } from "./form-context";

/** Инпут с крестиком очистки у правого края.
 *
 *  Крестик лежит абсолютом ПОВЕРХ поля, а pr-9 на самом инпуте сдвигает внутрь
 *  нативный ::-webkit-calendar-picker-indicator (тот живёт в content-box), так
 *  что порядок читается как «значение — пикер — крестик».
 *
 *  type="button" обязателен: Save это submit-кнопка формы, и кнопка без явного
 *  типа отправила бы форму вместо очистки поля. */
export function ClearableInput({
  clearable,
  onClear,
  className,
  rawErrors,
  ...props
}: React.ComponentProps<"input"> & {
  clearable: boolean;
  onClear: () => void;
  /** Mirrors `@rjsf/shadcn`'s BaseInputTemplate: same prop, same destructive-border trigger. */
  rawErrors?: string[];
}) {
  const { messages } = useEditorForm();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const filled = props.value !== "" && props.value !== undefined && props.value !== null;
  // Кнопка присутствует у любого очищаемого поля (кроме disabled/readonly) и
  // лишь ВЫКЛЮЧАЕТСЯ на пустом значении — не исчезает: иначе inline-виджет
  // дёргается по ширине на каждой очистке (pr-9 то есть, то нет).
  const visible = clearable && !props.disabled && !props.readOnly;
  return (
    // Внешний p-0.5 повторяет обёртку темы (`@rjsf/shadcn` BaseInputTemplate и
    // SelectWidget): она резервирует 2px под focus-ring и потому смещает контрол
    // на 2px по обеим осям. Без неё свой виджет вставал на 2px выше и левее
    // соседнего по строке поля темы. Отступ ОТДЕЛЬНЫМ элементом, а не на
    // `relative`-обёртке: та задаёт систему координат крестику, и padding на ней
    // сдвинул бы его относительно края инпута.
    <div className="p-0.5">
      <div className="relative">
        <Input
          {...props}
          ref={inputRef}
          className={cn(
            (rawErrors?.length ?? 0) > 0 && "border-destructive focus-visible:ring-0",
            visible && "pr-9",
            className,
          )}
        />
        {visible && (
          <button
            type="button"
            disabled={!filled}
            aria-label={messages.clearValue}
            title={messages.clearValue}
            onClick={() => {
              onClear();
              // После очистки кнопка становится disabled и фокус на ней не
              // удерживается — без явного возврата он провалился бы на body, и
              // клавиатурный пользователь потерял бы место в форме.
              inputRef.current?.focus();
            }}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 focus-visible:ring-1 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Очищаемость поля: ui:emptyValue: null ставит ТОЛЬКО ui.Nullable() на
 *  Go-стороне, поэтому NOT NULL-колонка крестика не получает по построению —
 *  без второго списка признаков на фронте. */
export function isClearable(options: WidgetProps["options"] | undefined): boolean {
  return options?.emptyValue === null;
}
