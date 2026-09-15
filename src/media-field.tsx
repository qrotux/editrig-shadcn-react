import * as React from "react";
import { getUiOptions, type FieldProps } from "@rjsf/utils";
import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react";

import { cn } from "./ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";

import { useEditorForm } from "./form-context";
import { useRelationOptions } from "./use-editor";

type MediaOptions = {
  collection?: string;
  /** Подпись выбранного значения — это URL МИНИАТЮРЫ, а не человекочитаемый
   *  текст, как у обычной связи (см. ui.Media на Go-стороне: media переиспользует
   *  Relation() ui:options и подменяет только "ui:field"). */
  labels?: Record<string, string>;
  /** Массив id вместо одиночного — ui.MediaMulti на Go-стороне выставляет
   *  ui:options.multi. Схема поля тогда массивная (как у multi-relation). */
  multi?: boolean;
  /** Закрытый список у ui.MediaAspects на Go-стороне; неизвестное значение —
   *  дефолт "1:1", а не ошибка: опечатка в схеме не должна ронять форму. */
  aspect?: string;
  /** Per-field size ceiling in bytes, declared by the server. Absent ⇒
   *  DEFAULT_MAX_FILE_SIZE below. */
  maxBytes?: number;
  /** MIME allow-list of the field. Absent ⇒ the image-only default below. */
  accept?: string[];
};

const SEARCH_DEBOUNCE_MS = 250;

// Client-side rejection: HEIC/HEIF by extension, a MIME allow-list and a size
// ceiling. These are fast refusals before the network round trip, not the
// security boundary; the server checks again. Both the allow-list and the
// ceiling come from the field's ui:options, the constants below are fallbacks
// for fields declared without them.
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_ACCEPT = ["image/jpeg", "image/png", "image/webp"];

const ASPECT_CLASS: Record<string, string> = {
  "1:1": "aspect-square",
  "2:1": "aspect-[2/1]",
  "4:3": "aspect-[4/3]",
  "3:2": "aspect-[3/2]",
};

// Стабильная ссылка на пустую очередь: `stagedFiles.get(f) ?? []` с новым []
// каждый рендер гонял бы эффект превью в цикле (deps по ссылке).
const NO_FILES: File[] = [];

type Rejection = "heic" | "mime" | "size" | "count";

function validateFile(file: File, maxBytes: number, accept: string[]): Rejection | null {
  // Расширение, не mime: браузеры отдают HEIC/HEIF-mime непоследовательно, а
  // имя файла — надёжный сигнал (тот же порядок проверок, что в upstream
  // validateImageMimeType).
  if (/\.(heic|heif)$/i.test(file.name)) return "heic";
  if (!accept.includes(file.type)) return "mime";
  if (file.size > maxBytes) return "size";
  return null;
}

function rejectionText(
  rejection: Rejection | null,
  messages: ReturnType<typeof useEditorForm>["messages"],
): string | null {
  return rejection === "heic"
    ? messages.mediaRejectHeic
    : rejection === "mime"
      ? messages.mediaRejectMime
      : rejection === "size"
        ? messages.mediaRejectSize
        : rejection === "count"
          ? messages.mediaRejectCount
          : null;
}

/** Image field: on the wire an id of a media row (like RelationField), but it
 *  shows a THUMBNAIL rather than a text chip and can accept a file itself.
 *
 *  A FIELD, not a widget, for BOTH cardinalities: a multi field has an array
 *  schema, and rjsf routes widgets only for leaf schemas (the same reason as
 *  RelationField). Single and multi are separate components — the dropzone and
 *  the thumbnail-grid layouts do not overlap — split by cardinality. */
export function MediaField(props: FieldProps) {
  const options = getUiOptions(props.uiSchema) as MediaOptions;
  // Media is a TOP-LEVEL field only. Staged files, dirtyFields, resetField and
  // the multipart `file:<field>` part are all keyed by the bare field name, so
  // the same media field inside an array item or nested object (path length > 1)
  // would collide across rows and stage the wrong file onto the wrong record.
  // Rather than corrupt silently, degrade to a read-only view of the current
  // value and warn the developer. A top-level field has a path of length 1; the
  // root object is 0.
  const path = props.fieldPathId?.path ?? [];
  const pathKey = path.join("/");
  const nested = path.length !== 1;
  React.useEffect(() => {
    if (nested)
      console.warn(
        `editrig: media field "${pathKey}" is nested; media must be a top-level field. ` +
          `Staging and the multipart part key by the bare field name, so a nested one ` +
          `would attach the wrong file to the wrong row. Rendered read-only.`,
      );
  }, [nested, pathKey]);
  if (nested) {
    const raw = props.formData;
    const text =
      typeof raw === "string" && raw ? raw : Array.isArray(raw) ? (raw as string[]).join(", ") : "—";
    return (
      <div
        data-editor-media-nested={pathKey}
        className="border-input bg-muted/40 text-muted-foreground flex min-h-9 items-center rounded-md border px-3 py-1.5 text-sm"
      >
        {text}
      </div>
    );
  }
  return options.multi === true ? <MultiMediaField {...props} /> : <SingleMediaField {...props} />;
}

/** Одиночное media: одна дропзона, значение — id-строка (или null). */
function SingleMediaField(props: FieldProps) {
  const { schema, uiSchema, formData, onChange, fieldPathId, name, disabled, readonly } = props;
  const {
    messages,
    entity,
    base,
    fetch: fetchImpl,
    isNew,
    recordId,
    stagedFiles,
    stageFiles,
  } = useEditorForm();

  const options = getUiOptions(uiSchema) as MediaOptions;
  const labels = options.labels ?? {};
  const aspectClass = ASPECT_CLASS[options.aspect ?? ""] ?? ASPECT_CLASS["1:1"];
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_SIZE;
  const accept = options.accept ?? DEFAULT_ACCEPT;

  const fieldName = name || fieldPathId.$id.replace(/^root_/, "") || "";
  const locked = disabled || readonly;
  const value = typeof formData === "string" && formData !== "" ? formData : null;
  const path = fieldPathId?.path;

  const staged = stagedFiles.get(fieldName)?.[0] ?? null;
  const [rejection, setRejection] = React.useState<Rejection | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [search, setSearch] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term]);

  // Превью застейдженного файла — свой blob: URL, ЕГО ОБЯЗАТЕЛЬНО отзывать при
  // размонтировании/смене файла: без revokeObjectURL блоб живёт в памяти
  // вкладки до перезагрузки.
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!staged) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(staged);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [staged]);

  const q = useRelationOptions(entity, fieldName, search, open, base, recordId ?? undefined, fetchImpl);

  // Подпись (URL миниатюры) выбранного из библиотеки id: labels конверта Load
  // знает только про уже сохранённое значение, поэтому без захвата подписи
  // пикера свежевыбранный id рисовал бы пустую дропзону вместо миниатюры.
  const [pickedLabel, setPickedLabel] = React.useState<Record<string, string>>({});
  const thumb = previewUrl ?? (value ? (labels[value] ?? pickedLabel[value]) : undefined) ?? null;

  const pick = (file: File) => {
    const reason = validateFile(file, maxBytes, accept);
    setRejection(reason);
    if (reason) return;
    // Только стейджим — formData не трогаем и запросов не шлём: id придёт в
    // ответе сабмита.
    stageFiles(fieldName, [file]);
  };

  const clear = () => {
    setRejection(null);
    stageFiles(fieldName, null);
    // Only null the field when it actually holds a stored id. If the sole
    // content is a staged (never-uploaded) file, un-staging above is the whole
    // action: writing null would send an explicit clear for a column the admin
    // ended up not touching (an absent key means "leave alone", null means
    // "clear"). Mirrors MultiMediaField.removeStaged, which never touches value.
    if (value) onChange(null, path);
  };

  const rejectionMessage = rejectionText(rejection, messages);

  return (
    <div className="flex flex-col gap-2" data-editor-media={fieldName}>
      {schema.title && (
        <label className="text-sm leading-none font-medium" htmlFor={fieldPathId.$id}>
          {schema.title}
        </label>
      )}

      <div
        className={cn(
          "border-input bg-muted/40 relative w-full max-w-40 overflow-hidden rounded-md border border-dashed",
          aspectClass,
          !locked && "cursor-pointer",
          dragOver && "border-primary",
        )}
        data-editor-media-drop={fieldName}
        onClick={() => {
          if (!locked) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          if (locked) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (locked) return;
          const file = e.dataTransfer.files?.[0];
          if (file) pick(file);
        }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="h-full w-full object-cover"
            data-editor-media-preview={fieldName}
          />
        ) : (
          <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
            <ImagePlus className="size-6" aria-hidden />
            <span className="text-xs">{messages.mediaUploadHint}</span>
          </div>
        )}
        {(thumb || value) && !locked && (
          <button
            type="button"
            aria-label={messages.mediaRemove}
            data-editor-media-remove={fieldName}
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
          >
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        id={fieldPathId.$id}
        type="file"
        accept={accept.join(",")}
        disabled={locked}
        className="hidden"
        data-editor-media-input={fieldName}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pick(file);
          e.target.value = "";
        }}
      />

      {rejectionMessage && (
        <p role="alert" className="text-destructive text-xs" data-editor-media-reject={fieldName}>
          {rejectionMessage}
        </p>
      )}

      {/* Скрыта на создании (isNew): пикер фильтрует по владельцу через
          ?parent=<id>, а до первого Save владельца ещё нет. */}
      {!isNew && !locked && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-editor-media-choose={fieldName}
              className="border-input bg-background w-fit rounded-md border px-3 py-1 text-xs"
            >
              {messages.mediaChoose}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            {/* shouldFilter=false: фильтрует сервер, тот же приём, что в
                RelationField. */}
            <Command shouldFilter={false}>
              <CommandInput
                value={term}
                onValueChange={setTerm}
                placeholder={messages.relationSearch}
                data-editor-media-search={fieldName}
              />
              <CommandList>
                {!q.isFetching && (q.data ?? []).length === 0 && (
                  <CommandEmpty>{messages.relationEmpty}</CommandEmpty>
                )}
                <div className="grid grid-cols-3 gap-1 p-1">
                  {(q.data ?? []).map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => {
                        // Выбор из уже загруженных отменяет любой застейдженный
                        // файл этого поля — иначе следующий Save отправил бы
                        // никому уже не нужный файл поверх выбранного id.
                        stageFiles(fieldName, null);
                        setRejection(null);
                        setPickedLabel((m) => ({ ...m, [option.value]: option.label }));
                        onChange(option.value, path);
                        setOpen(false);
                      }}
                      data-editor-media-option={option.value}
                      className="aspect-square p-0"
                    >
                      <img src={option.label} alt="" className="h-full w-full rounded object-cover" />
                    </CommandItem>
                  ))}
                </div>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Мульти-media (галерея): значение — упорядоченный массив id, форма показывает
 *  сетку миниатюр с добавлением, удалением и перестановкой.
 *
 *  Два источника плиток: уже сохранённые id (миниатюра из labels, порядок
 *  значим — колонка "order" на сервере) и ещё НЕ отправленные файлы из
 *  stagedFiles (blob-превью). Сервер аппендит файлы в хвост массива при
 *  сабмите, поэтому переставлять можно только уже сохранённые id, а не
 *  застейдженные файлы.
 *
 *  ПУТЬ В onChange ОБЯЗАТЕЛЕН — см. relation-field.tsx:76-85: без него массив
 *  уезжает в корень формы и подменяет её целиком, молча. */
function MultiMediaField(props: FieldProps) {
  const { schema, uiSchema, formData, onChange, fieldPathId, name, disabled, readonly } = props;
  const {
    messages,
    entity,
    base,
    fetch: fetchImpl,
    isNew,
    recordId,
    stagedFiles,
    stageFiles,
  } = useEditorForm();

  const options = getUiOptions(uiSchema) as MediaOptions;
  const labels = options.labels ?? {};
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_SIZE;
  const accept = options.accept ?? DEFAULT_ACCEPT;

  // Плитки галереи — фиксированный квадрат 100×100, а не aspect поля: сетку
  // миниатюр держат ровной, картинку любой пропорции кропит object-cover.
  const tileClass = "h-[100px] w-[100px]";

  const fieldName = name || fieldPathId.$id.replace(/^root_/, "") || "";
  const locked = disabled || readonly;
  const path = fieldPathId?.path;
  const selected: string[] = Array.isArray(formData) ? (formData as string[]) : [];
  const staged = stagedFiles.get(fieldName) ?? NO_FILES;

  // Потолок числа картинок — из схемы (ui.Field.MaxItems на Go-стороне), как и
  // у RelationField. Ёмкость считается по ОБОИМ источникам плиток: файлы из
  // очереди уедут в тот же массив при сабмите (upload.go аппендит их в хвост),
  // поэтому счёт по одним только сохранённым id пропустил бы перебор ровно на
  // длину очереди.
  const maxItems = typeof schema.maxItems === "number" ? schema.maxItems : null;
  const used = selected.length + staged.length;
  const full = maxItems !== null && used >= maxItems;

  const [rejection, setRejection] = React.useState<Rejection | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [search, setSearch] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term]);

  // One blob: URL per staged File, cached by File identity so adding or removing
  // one file does not revoke and re-mint URLs for the files that stayed — the
  // tiles are keyed by URL, so re-minting would unmount and re-decode every
  // thumbnail on each edit (visible flicker with a gallery of large photos).
  // The reconcile effect revokes only URLs whose File left the queue; the
  // mount-only effect revokes whatever remains on unmount.
  const urlByFile = React.useRef<Map<File, string>>(new Map());
  const [previewUrls, setPreviewUrls] = React.useState<string[]>([]);
  React.useEffect(() => {
    const cache = urlByFile.current;
    const live = new Set(staged);
    for (const [file, url] of [...cache]) {
      if (!live.has(file)) {
        URL.revokeObjectURL(url);
        cache.delete(file);
      }
    }
    setPreviewUrls(
      staged.map((f) => {
        let url = cache.get(f);
        if (!url) {
          url = URL.createObjectURL(f);
          cache.set(f, url);
        }
        return url;
      }),
    );
  }, [staged]);
  React.useEffect(() => {
    const cache = urlByFile.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  const q = useRelationOptions(entity, fieldName, search, open, base, recordId ?? undefined, fetchImpl);

  // Подписи (URL миниатюр) выбранных из библиотеки id: labels конверта Load
  // знает только про уже сохранённые значения, поэтому свежевыбранный id без
  // захвата подписи пикера рисовал бы плитку с src="{id}" — сломанной картинкой.
  const [pickedLabels, setPickedLabels] = React.useState<Record<string, string>>({});
  const thumbOf = (id: string) => labels[id] ?? pickedLabels[id] ?? id;

  const commit = (next: string[]) => onChange(next, path);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= selected.length || from === to) return;
    const next = [...selected];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  const pickMany = (incoming: File[]) => {
    // Остаток до потолка режет пачку ДО проверки файлов: иначе выбор 60 картинок
    // на поле с потолком 50 прошёл бы клиентские гейты целиком и умер на сабмите
    // структурной валидацией — то есть после загрузки всех 60 на сервер.
    const room = maxItems === null ? incoming.length : Math.max(maxItems - used, 0);
    const accepted: File[] = [];
    let reason: Rejection | null = null;
    for (const file of incoming.slice(0, room)) {
      const r = validateFile(file, maxBytes, accept);
      if (r) {
        reason = r;
        continue;
      }
      accepted.push(file);
    }
    // Отбраковка одного файла не мешает остальным той же пачки: годные
    // стейджатся, а сообщение показывает причину последнего забракованного.
    // Перебор по счёту старше причин отдельных файлов: он объясняет, почему
    // часть пачки исчезла без следа, а не почему не взяли конкретный файл.
    setRejection(incoming.length > room ? "count" : reason);
    if (accepted.length > 0) stageFiles(fieldName, [...staged, ...accepted]);
  };

  const removeStaged = (i: number) => {
    const next = staged.filter((_, k) => k !== i);
    stageFiles(fieldName, next.length > 0 ? next : null);
  };

  const rejectionMessage = rejectionText(rejection, messages);
  const canReorder = !locked && selected.length > 1;

  return (
    <div className="flex flex-col gap-2" data-editor-media={fieldName}>
      {(schema.title || maxItems !== null) && (
        <div className="flex items-center justify-between gap-2">
          {schema.title && <span className="text-sm leading-none font-medium">{schema.title}</span>}
          {/* Счётчик — только цифры: он объясняет, почему пропала плитка
              добавления, и переводить в нём нечего. Считает вместе с очередью
              файлов — она уедет в то же поле. */}
          {maxItems !== null && (
            <span
              data-editor-media-count={fieldName}
              className={cn("text-xs tabular-nums", full ? "text-destructive" : "text-muted-foreground")}
            >
              {used} / {maxItems}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {selected.map((id, i) => (
          <div
            key={id}
            className={cn("border-input bg-muted/40 relative overflow-hidden rounded-md border", tileClass)}
            data-editor-media-item={id}
          >
            <img src={thumbOf(id)} alt="" className="h-full w-full object-cover" />
            {/* Клавиатурная перестановка: кнопки живут только там, где ход
                возможен (не первый / не последний), иначе крайние плитки несли
                бы мёртвую кнопку. */}
            {canReorder && i > 0 && (
              <button
                type="button"
                aria-label={messages.mediaMoveLeft}
                data-editor-media-left={id}
                onClick={() => move(i, i - 1)}
                className="absolute bottom-1 left-1 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
              >
                <ChevronLeft className="size-3" aria-hidden />
              </button>
            )}
            {canReorder && i < selected.length - 1 && (
              <button
                type="button"
                aria-label={messages.mediaMoveRight}
                data-editor-media-right={id}
                onClick={() => move(i, i + 1)}
                className="absolute right-1 bottom-1 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
              >
                <ChevronRight className="size-3" aria-hidden />
              </button>
            )}
            {!locked && (
              <button
                type="button"
                aria-label={messages.mediaRemove}
                data-editor-media-remove={id}
                onClick={() => commit(selected.filter((x) => x !== id))}
                className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </div>
        ))}

        {previewUrls.map((url, i) => (
          <div
            key={url}
            className={cn("border-input bg-muted/40 relative overflow-hidden rounded-md border", tileClass)}
            data-editor-media-staged={i}
          >
            <img src={url} alt="" className="h-full w-full object-cover" />
            {!locked && (
              <button
                type="button"
                aria-label={messages.mediaRemove}
                data-editor-media-remove-staged={i}
                onClick={() => removeStaged(i)}
                className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </div>
        ))}

        {/* На полном поле плитки нет вовсе, а не disabled: она И дропзона, и
            кнопка выбора файлов, и «выключенная» дропзона всё равно принимала бы
            drop'ы — их обрабатывает не она, а её onDrop. */}
        {!locked && !full && (
          <div
            className={cn(
              "border-input bg-muted/40 relative cursor-pointer overflow-hidden rounded-md border border-dashed",
              tileClass,
              dragOver && "border-primary",
            )}
            data-editor-media-drop={fieldName}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const files = Array.from(e.dataTransfer.files ?? []);
              if (files.length > 0) pickMany(files);
            }}
          >
            <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
              <ImagePlus className="size-6" aria-hidden />
              <span className="text-xs">{messages.mediaAddMore}</span>
            </div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        id={fieldPathId.$id}
        type="file"
        accept={accept.join(",")}
        multiple
        disabled={locked}
        className="hidden"
        data-editor-media-input={fieldName}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) pickMany(files);
          e.target.value = "";
        }}
      />

      {rejectionMessage && (
        <p role="alert" className="text-destructive text-xs" data-editor-media-reject={fieldName}>
          {rejectionMessage}
        </p>
      )}

      {/* Скрыта на создании (isNew): пикер фильтрует по владельцу через
          ?parent=<id>, а до первого Save владельца ещё нет. */}
      {!isNew && !locked && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-editor-media-choose={fieldName}
              className="border-input bg-background w-fit rounded-md border px-3 py-1 text-xs"
            >
              {messages.mediaChoose}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <Command shouldFilter={false}>
              <CommandInput
                value={term}
                onValueChange={setTerm}
                placeholder={messages.relationSearch}
                data-editor-media-search={fieldName}
              />
              <CommandList>
                {!q.isFetching && (q.data ?? []).length === 0 && (
                  <CommandEmpty>{messages.relationEmpty}</CommandEmpty>
                )}
                <div className="grid grid-cols-3 gap-1 p-1">
                  {(q.data ?? []).map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      disabled={full && !selected.includes(option.value)}
                      onSelect={() => {
                        // Аппенд в хвост, popover НЕ закрывается: галерею
                        // набирают пачкой, а не по одному id за открытие.
                        setRejection(null);
                        if (!full && !selected.includes(option.value)) {
                          setPickedLabels((m) => ({ ...m, [option.value]: option.label }));
                          commit([...selected, option.value]);
                        }
                      }}
                      data-editor-media-option={option.value}
                      className="aspect-square p-0"
                    >
                      <img src={option.label} alt="" className="h-full w-full rounded object-cover" />
                    </CommandItem>
                  ))}
                </div>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
