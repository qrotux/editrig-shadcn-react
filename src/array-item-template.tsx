import { getTemplate, getUiOptions, type ArrayFieldItemTemplateProps } from "@rjsf/utils";

/** Элемент массива: поля во всю ширину, панель «вверх/вниз/удалить» — в правом
 *  верхнем углу, на строке заголовка элемента.
 *
 *  Свой шаблон, а не тема: та кладёт панель в flex-строку с `items-center` и
 *  добивает инлайновым `margin-top: 22px`. Для одного скалярного поля это
 *  попадает в его строку, но элемент нашего массива — объект из нескольких
 *  полей (день маршрута: номер дня плюс переводимый текст), и панель повисает в
 *  вертикальном центре справа, оторванно от того, чем управляет. */
export function EditorArrayFieldItemTemplate(props: ArrayFieldItemTemplateProps) {
  const { children, buttonsProps, hasToolbar, uiSchema, registry } = props;
  const ItemButtons = getTemplate<"ArrayFieldItemButtonsTemplate">(
    "ArrayFieldItemButtonsTemplate",
    registry,
    getUiOptions(uiSchema),
  );
  return (
    <div className="mb-4 flex flex-row items-start gap-2">
      {/* min-w-0 обязателен: без него длинный текст внутри элемента распирает
          flex-колонку сверх ширины формы, и панель уезжает за край. */}
      <div className="min-w-0 grow">{children}</div>
      {hasToolbar && (
        <div className="flex shrink-0 gap-2 p-0.5">
          <ItemButtons {...buttonsProps} />
        </div>
      )}
    </div>
  );
}
