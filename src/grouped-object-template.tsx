import * as React from "react";
import { Undo2 } from "lucide-react";
import {
  getSchemaType,
  getUiOptions,
  type ObjectFieldTemplateProps,
  type RJSFSchema,
  type UiSchema,
} from "@rjsf/utils";

import { Button } from "./ui/button";
import { cn } from "./ui/cn";

import { useEditorForm } from "./form-context";
import type { EditorGroup } from "./types";

/** rjsf ObjectFieldTemplate that renders declarative sections.
 *
 *  Reads `ui:groups` (see EditorGroup) off the object's own uiSchema. If the
 *  object declares no groups — every nested object, and any entity whose
 *  server side hasn't opted in — it falls back to the plain stacked layout,
 *  so this template is safe to install globally on the Form.
 *
 *  Fields not claimed by any group render in an implicit trailing section, so
 *  adding a column server-side degrades to "shown, ungrouped" instead of
 *  "silently missing". */
export function GroupedObjectFieldTemplate(props: ObjectFieldTemplateProps) {
  const { properties, uiSchema, schema, title, description, fieldPathId } = props;
  const groups = readGroups(uiSchema);
  // Маркеры изменения вешаем ТОЛЬКО на корневом объекте: набор dirty-полей
  // собран по верхнеуровневым ключам конверта, и вложенный объект с полем
  // такого же имени получил бы чужую пометку.
  const root = (fieldPathId?.path?.length ?? 0) === 0;

  const byName = new Map(properties.map((p) => [p.name, p]));
  // Hidden properties (ui:widget: hidden) must still be mounted — rjsf's own
  // template keeps them in a `hidden` container, and dropping them would take
  // their sub-tree (and any errors it owns) out of the render.
  const hidden = properties.filter((p) => p.hidden);

  if (groups.length === 0) {
    return (
      <>
        {title && <h3 className="text-base font-semibold">{title}</h3>}
        {description}
        <div className="flex flex-col gap-4">
          {properties.map((p) => (
            <FieldSlot key={p.name} name={p.name} root={root} className={p.hidden ? "hidden" : undefined}>
              {p.content}
            </FieldSlot>
          ))}
        </div>
      </>
    );
  }

  const claimed = new Set(groups.flatMap((g) => g.fields));
  const leftovers = properties.filter((p) => !p.hidden && !claimed.has(p.name));

  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => {
        const items = g.fields
          .map((f) => byName.get(f))
          .filter((p): p is PropertyItem => p !== undefined && !p.hidden);
        if (items.length === 0) return null;
        return (
          <Section
            key={g.id}
            group={g}
            schema={schema}
            body={<FieldGrid columns={g.columns} uiSchema={uiSchema} items={items} root={root} />}
          />
        );
      })}
      {leftovers.length > 0 && <FieldGrid columns={1} uiSchema={uiSchema} items={leftovers} root={root} />}
      <div className="hidden">
        {hidden.map((p) => (
          <div key={p.name}>{p.content}</div>
        ))}
      </div>
    </div>
  );
}

type PropertyItem = ObjectFieldTemplateProps["properties"][number];

function FieldGrid({
  columns,
  items,
  uiSchema,
  root,
}: {
  columns?: 1 | 2;
  items: PropertyItem[];
  uiSchema?: UiSchema;
  root: boolean;
}) {
  return (
    <div className={cn("grid gap-4", columns === 2 ? "sm:grid-cols-2" : "grid-cols-1")}>
      {items.map((p) => (
        <FieldSlot
          key={p.name}
          name={p.name}
          root={root}
          className={cn(columns === 2 && spansFullRow(uiSchema, p.name) && "sm:col-span-2")}
        >
          {p.content}
        </FieldSlot>
      ))}
    </div>
  );
}

/** Ячейка одного поля: несёт маркер «значение разошлось с сохранённым», он же
 *  кнопка отката этого поля.
 *
 *  Маркер выводится ЗДЕСЬ, а не рядом с подписью, потому что подпись рисуют
 *  сами поля и рисуют по-разному: тема кладёт `<label>`, geopoint — `<span>`
 *  (у него два своих `<label>`, по одному на координату), а json-поле подписи
 *  не имеет вовсе. Общей точки крепления в разметке подписи поэтому нет.
 *
 *  Позиционирование абсолютное и в минус: маркер живёт в отступе страницы
 *  (`p-6` у шелла) и в зазоре двухколоночной секции (`gap-4`), так что его
 *  появление не двигает форму — иначе каждое первое нажатие клавиши сдвигало
 *  бы поле. Отсюда же его размер: 16px ровно укладываются в зазор в 16px, всё
 *  крупнее наехало бы на соседнюю колонку. */
function FieldSlot({
  name,
  root,
  className,
  children,
}: {
  name: string;
  root: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { dirtyFields, resetField, disabled, messages } = useEditorForm();
  const dirty = root && dirtyFields.has(name);
  return (
    <div className={cn("relative", className)} data-editor-dirty={dirty || undefined}>
      {dirty && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => resetField(name)}
          aria-label={messages.revertField}
          title={messages.revertField}
          className="text-muted-foreground hover:text-foreground absolute top-0 -left-4 flex size-4 items-center justify-center disabled:opacity-40"
        >
          <Undo2 className="size-3.5" aria-hidden />
        </button>
      )}
      {children}
    </div>
  );
}

function Section({
  group,
  schema,
  body,
}: {
  group: EditorGroup;
  schema: ObjectFieldTemplateProps["schema"];
  body: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={group.title ? `editor-group-${group.id}` : undefined}
      data-editor-group={group.id}
    >
      {(group.title || group.toggleAll) && (
        <div className="mb-3 flex items-end justify-between gap-4 border-b pb-2">
          <div>
            {group.title && (
              <h3 id={`editor-group-${group.id}`} className="text-sm font-semibold tracking-tight">
                {group.title}
              </h3>
            )}
            {group.description && <p className="text-muted-foreground mt-1 text-xs">{group.description}</p>}
          </div>
          {group.toggleAll && <ToggleAll group={group} schema={schema} />}
        </div>
      )}
      {body}
    </section>
  );
}

/** "Select all / none" over the section's boolean fields. Writes through the
 *  EditorPage-owned patch callback (rjsf gives object templates no
 *  whole-object onChange). */
function ToggleAll({ group, schema }: { group: EditorGroup; schema: ObjectFieldTemplateProps["schema"] }) {
  const { messages, setFieldValues, disabled } = useEditorForm();
  const props = (schema.properties ?? {}) as Record<string, RJSFSchema>;
  // getSchemaType, not a bare `type === "boolean"` check: a nullable column
  // comes down as `type: ["boolean", "null"]`, and getSchemaType normalises that
  // two-element `[t, "null"]` form to the underlying type. A raw check would
  // drop every nullable boolean from the toggle, and a section of only nullable
  // booleans would render no control at all.
  const booleans = group.fields.filter((f) => props[f] && getSchemaType(props[f]) === "boolean");
  if (booleans.length === 0) return null;
  const setAll = (v: boolean) => setFieldValues(Object.fromEntries(booleans.map((f) => [f, v])));
  return (
    <div className="flex shrink-0 gap-1">
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setAll(true)}>
        {messages.selectAll}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setAll(false)}>
        {messages.selectNone}
      </Button>
    </div>
  );
}

function readGroups(uiSchema?: UiSchema): EditorGroup[] {
  const raw = getUiOptions(uiSchema).groups;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (g): g is EditorGroup =>
      !!g &&
      typeof g === "object" &&
      typeof (g as EditorGroup).id === "string" &&
      Array.isArray((g as EditorGroup).fields),
  );
}

/** Per-field escape hatch inside a 2-column section:
 *  `"<field>": { "ui:options": { "colSpan": 2 } }`. */
function spansFullRow(uiSchema: UiSchema | undefined, name: string): boolean {
  return getUiOptions(uiSchema?.[name] as UiSchema | undefined).colSpan === 2;
}
