import * as React from "react";
import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";
import type { IChangeEvent } from "@rjsf/core";
import {
  deepEquals,
  type RegistryFieldsType,
  type RegistryWidgetsType,
  type RJSFSchema,
  type UiSchema,
} from "@rjsf/utils";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "./ui/cn";

import { DEFAULT_EDITOR_BASE, readReadonlyFields, type Envelope } from "./types";
import { useEntity, useCreate, useUpdate, useDelete, invalidateEntity, type FetchLike } from "./use-editor";
import { toExtraErrors } from "./errors";
import { defaultEditorMessages, type EditorMessages } from "./messages";
import { EditorFormProvider } from "./form-context";
import { GroupedObjectFieldTemplate } from "./grouped-object-template";
import { EditorArrayFieldItemTemplate } from "./array-item-template";
import { EditorHeader } from "./editor-header";
import { EditorActions } from "./editor-actions";
import { EDITOR_FIELDS, EDITOR_WIDGETS } from "./widgets";

export type EditorPageProps = {
  name: string;
  id: string | null;
  basePath?: string;
  /** Transport for every request the page and its fields make. Defaults to the
   *  global `fetch`; pass a wrapper to add auth headers, a CSRF token or an
   *  absolute origin without forking the protocol. */
  fetch?: FetchLike;
  /** BCP-47 tag used for Intl formatting in the header. */
  locale?: string;
  /** Called AFTER a successful save; does not leave the form — Save keeps the
   *  admin on the record. The page uses it to put the server-issued id into the
   *  URL after a create. */
  onSaved?: (id: string) => void;
  onDeleted?: () => void;
  /** Handler for "Back to list" in the header — the form's only navigation out
   *  (the footer has none: it is Save/Reset/Delete). */
  onCancel?: () => void;
  /** Defaults to "record already exists" — pass false for read-mostly entities. */
  canDelete?: boolean;
  /** Reading-width constraint for the form column. */
  maxWidthClassName?: string;
  transformSchema?: (
    schema: RJSFSchema,
    uiSchema: UiSchema,
    formData: Record<string, unknown>,
  ) => { schema: RJSFSchema; uiSchema: UiSchema };
  /** Values the CREATE form is filled with (ignored on an existing record —
   *  there the baseline belongs to the server).
   *
   *  Read as a SNAPSHOT on mount: later values of the prop no longer rebuild the
   *  baseline. Changing the preset under a mounted form would leave some values
   *  looking edited and others not; a new form comes from a new `key` on the
   *  host page. */
  initialData?: Record<string, unknown>;
  messages?: Partial<EditorMessages>;
  /** Project renderers OVER the built-ins, keyed by `ui:field` / `ui:widget`.
   *
   *  They let an application replace a renderer without forking the library:
   *  `fields={{ media: MyMediaField }}` gives its component the same key the
   *  server declares, and the other fields stay the library's. Merged over, not
   *  instead of: the registry must stay complete, or one override would blank
   *  out json/keyed/relation. */
  fields?: RegistryFieldsType;
  widgets?: RegistryWidgetsType;
};

// Installed once, for every entity: sections/columns come from the server's
// `ui:groups`, and the template degrades to a plain stack when there are none.
const TEMPLATES = {
  ObjectFieldTemplate: GroupedObjectFieldTemplate,
  ArrayFieldItemTemplate: EditorArrayFieldItemTemplate,
};

/** Drop every top-level key the server declared read-only. */
function stripReadonly(uiSchema: UiSchema, formData: Record<string, unknown>): Record<string, unknown> {
  const readonly = readReadonlyFields(uiSchema);
  if (readonly.length === 0) return formData;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(formData)) {
    if (!readonly.includes(k)) out[k] = v;
  }
  return out;
}

export function EditorPage({
  name,
  id,
  basePath = DEFAULT_EDITOR_BASE,
  fetch: fetchImpl,
  locale = "en-GB",
  onSaved,
  onDeleted,
  onCancel,
  canDelete,
  maxWidthClassName = "max-w-3xl",
  transformSchema,
  initialData,
  messages: messagesProp,
  fields,
  widgets,
}: EditorPageProps) {
  const messages = { ...defaultEditorMessages, ...messagesProp };
  const qc = useQueryClient();
  // Стоп загрузки после удаления: без него ещё смонтированный запрос записи
  // рефетчил бы только что удалённую строку (404) и рисовал бы её ошибку.
  const [deleted, setDeleted] = React.useState(false);
  const q = useEntity(name, id, basePath, fetchImpl, !deleted);
  // local envelope overlays the query result after a save (schema-swap):
  const [env, setEnv] = React.useState<Envelope | null>(null);
  const [curId, setCurId] = React.useState<string | null>(id);
  // Снапшот, а не зависимость эффекта: preset нужен один раз, а нестабильная
  // ссылка в deps гоняла бы эффект после каждого рендера — setEnv каждый раз
  // получает новый объект (спред), Object.is не бейлаутится, и форма уходит в
  // «Maximum update depth exceeded».
  const initialDataRef = React.useRef(initialData);
  // Подмешивается в САМ конверт, а не поверх formData: env.data — базовая линия
  // dirty-механики и цель Reset, и preset не должен ни числиться правкой
  // админа, ни исчезать по Reset. Только на создании: у существующей записи
  // базовая линия принадлежит серверу.
  // Базовая линия пересобирается только на ЗАГРУЗКЕ и СМЕНЕ записи, но не на
  // фоновом рефетче той же записи (refetchOnWindowFocus, инвалидация после
  // сохранения). Иначе конверт с изменённым сервером полем (updated_at, счётчик
  // воркера) затирал бы несохранённые правки. Это и есть инвариант «схема
  // перерисовывается только из load/save-ответа»: эхо сохранения приходит через
  // setEnv в onSubmit, а не сюда. Дискриминатор — идентичность записи по id;
  // смена id применяется всегда, чтобы грязная форма не заблокировала загрузку
  // следующей записи.
  React.useEffect(() => {
    const data = q.data;
    if (!data) return;
    setEnv((prevEnv) => {
      if (prevEnv && prevEnv.id === data.id) return prevEnv;
      // Stale create schema (id:null) arriving while we already hold a saved
      // record: the create query stays mounted after a create (the `id` prop is
      // still null until the host puts the new id in the URL), so a post-save
      // invalidation or a sibling page's delete refetches `/schema`. Adopting it
      // would blank the just-created record and make the next Save a duplicate
      // POST. The host leaves the create form by remounting on a new record key,
      // which nulls prevEnv first, so this never blocks a real create form.
      if (prevEnv && prevEnv.id != null && data.id == null) return prevEnv;
      const preset = initialDataRef.current;
      return data.id == null && preset ? { ...data, data: { ...data.data, ...preset } } : data;
    });
    // Same guard for curId, or it would drop to null under a saved record and
    // bring the create hint back on top of an existing row.
    setCurId((prevCurId) => (prevCurId != null && data.id == null ? prevCurId : data.id));
  }, [q.data]);
  const [formData, setFormData] = React.useState<Record<string, unknown>>({});
  React.useEffect(() => {
    if (env) setFormData(env.data);
  }, [env]);
  const [serverErr, setServerErr] = React.useState<{
    extra: ReturnType<typeof toExtraErrors>["extraErrors"];
    form: string[];
  }>({ extra: {}, form: [] });
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  // Файлы, выбранные для media-полей но ещё не отправленные (см.
  // form-context.tsx). EditorPage — их единственный владелец: submit читает
  // карту, чтобы решить JSON или multipart, и очищает её после успеха.
  const [stagedFiles, setStagedFiles] = React.useState<Map<string, File[]>>(new Map());
  const stageFiles = React.useCallback((field: string, files: File[] | null) => {
    setStagedFiles((prev) => {
      const next = new Map(prev);
      if (files && files.length > 0) next.set(field, files);
      else next.delete(field);
      return next;
    });
    // Стейдж/снятие файла — это правка: снимаем серверные ошибки, как onChange
    // формы и setFieldValues. Выбор файла идёт мимо rjsf-onChange, поэтому без
    // этого исправленный после 422 файл оставлял бы submit заблокированным
    // (extraErrorsBlockSubmit).
    setServerErr({ extra: {}, form: [] });
  }, []);
  const clearStaged = React.useCallback(() => setStagedFiles(new Map()), []);
  // Полный сброс, когда хост наводит ТОТ ЖЕ экземпляр на другую запись
  // (react-router меняет :id без размонтирования). Делается в фазе рендера, а
  // не в эффекте: иначе между сменой props и эффектом один кадр показывалась бы
  // прежняя запись под новым URL — и Delete на ней бил бы по старому curId.
  // Сброс env в null уводит на loading до прихода нового конверта, а
  // очищенный до нуля seenKey исключает цикл. basePath входит в ключ, чтобы
  // смена только базы (тот же name/id) тоже пересобирала форму.
  // JSON.stringify, not a delimited string: any separator char can occur in a
  // name or id, and this key is only ever compared with `!==`. (It also keeps
  // the file free of the NUL bytes a hand-picked separator once used, which
  // made grep classify the source as binary.)
  const recordKey = JSON.stringify([basePath, name, id]);
  const [seenKey, setSeenKey] = React.useState(recordKey);
  if (seenKey !== recordKey) {
    setSeenKey(recordKey);
    setEnv(null);
    setCurId(id);
    setFormData({});
    setServerErr({ extra: {}, form: [] });
    setSavedAt(null);
    setStagedFiles(new Map());
    setDeleted(false);
  }

  // Верхнеуровневые поля, разошедшиеся с базовой линией — последним конвертом,
  // приехавшим с сервера (загрузка или эхо сохранения). Застейдженный файл
  // значения поля не меняет (оно хранит id строки media, а файл ещё не уехал),
  // поэтому media-поле пришлось бы считать чистым — и Save на нём был бы
  // недоступен. Отсюда объединение с ключами stagedFiles.
  const dirtyFields = React.useMemo(() => {
    const base = env?.data ?? {};
    const out = new Set<string>();
    for (const k of new Set([...Object.keys(base), ...Object.keys(formData)])) {
      if (!deepEquals(base[k], formData[k])) out.add(k);
    }
    for (const k of stagedFiles.keys()) out.add(k);
    return out;
  }, [env, formData, stagedFiles]);
  const dirty = dirtyFields.size > 0;

  // Текущий ключ записи для сравнения ПОСЛЕ await в onSubmit: если хост за время
  // мутации увёл экземпляр на другую запись (react-router сменил :id без
  // размонтирования), поздний ответ относится к записи, которой уже нет на
  // экране, и применять его (setEnv/onSaved/serverErr) нельзя. Пишется в
  // эффекте, а не в теле рендера, чтобы не ловить react-compiler ref-правила.
  const recordKeyRef = React.useRef(recordKey);
  React.useEffect(() => {
    recordKeyRef.current = recordKey;
  }, [recordKey]);

  const onReset = React.useCallback(() => {
    setFormData(env?.data ?? {});
    clearStaged();
    setServerErr({ extra: {}, form: [] });
  }, [env, clearStaged]);

  const resetField = React.useCallback(
    (field: string) => {
      const base = env?.data ?? {};
      setFormData((prev) => {
        const next = { ...prev };
        // Ключа могло не быть в базовой линии вовсе (значение появилось на форме
        // создания) — тогда его надо УДАЛИТЬ, а не занулить: null сервер прочтёт
        // как осмысленную очистку поля.
        if (field in base) next[field] = base[field];
        else delete next[field];
        return next;
      });
      stageFiles(field, null);
      // Симметрично onChange формы: любая правка снимает серверные ошибки, иначе
      // rjsf остался бы заблокированным на них (см. extraErrorsBlockSubmit ниже).
      setServerErr({ extra: {}, form: [] });
    },
    [env, stageFiles],
  );

  const create = useCreate(name, basePath, fetchImpl);
  const update = useUpdate(name, curId ?? "", basePath, fetchImpl);
  const del = useDelete(name, curId ?? "", basePath, fetchImpl);

  const saving = create.isPending || update.isPending;
  const deleting = del.isPending;

  // Section-level controls (e.g. "select all" over a group of booleans) have
  // no rjsf-provided write path — publish one from the owner of formData.
  // Серверные ошибки снимаются здесь так же, как в onChange формы: этот путь
  // (toggle-all секции) мимо rjsf-onChange, а rjsf не зовёт onChange, когда
  // formData совпадает с его собственным состоянием, — иначе после 422 блок
  // extraErrorsBlockSubmit оставался бы поднятым до ручной правки поля.
  const setFieldValues = React.useCallback((patch: Record<string, unknown>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
    setServerErr({ extra: {}, form: [] });
  }, []);
  // Not memoized on purpose: `messages` is rebuilt from props on every render
  // anyway, so a useMemo here would never hit — and the only consumer is the
  // section toggle-all control, which re-renders with the page regardless.
  // Форм-широкая локаль keyed-полей: последний ключ, на который переключился
  // админ. Живёт здесь, а не в поле, чтобы переключение одного перевода
  // показывало остальные в том же языке.
  const [contentKey, setContentKey] = React.useState<string | undefined>(undefined);
  const formCtx = {
    messages,
    setFieldValues,
    disabled: saving || deleting,
    dirtyFields,
    resetField,
    locale,
    contentKey,
    setContentKey,
    entity: name,
    base: basePath,
    fetch: fetchImpl,
    stagedFiles,
    stageFiles,
    clearStaged,
    isNew: curId == null,
    recordId: curId,
    rootData: formData,
  };

  // После удаления запись показывать нечего — хост уходит по onDeleted, а до
  // тех пор рисуем пусто, а не ошибку рефетча удалённой строки.
  if (deleted) return null;
  // Ошибку показываем, только когда конверта ещё нет: провалившийся ФОНОВЫЙ
  // рефетч уже загруженной формы не должен подменять рабочую форму страницей
  // ошибки. Порядок с loading важен — без env сначала различаем ошибку и
  // загрузку, с env отдаём форму.
  if (q.error && !env)
    return (
      <div role="alert">
        {messages.loadFailed}: {q.error instanceof Error ? q.error.message : String(q.error)}
      </div>
    );
  if (!env) return <div>{messages.loading}</div>;

  const view = transformSchema
    ? transformSchema(env.schema, env.uiSchema, formData)
    : { schema: env.schema, uiSchema: env.uiSchema };

  async function onSubmit(e: IChangeEvent<Record<string, unknown>>) {
    // Запись, которую сохраняем: сверяем с ней ПОСЛЕ await, чтобы поздний ответ
    // не применился к записи, на которую хост уже переключился.
    const submittedKey = recordKey;
    setServerErr({ extra: {}, form: [] });
    // Read-only fields never travel back: they sit in formData (the header and
    // the read-only widgets render them) but the server owns their values.
    // The engine strips them again on its side — this is the cheap half of the
    // contract, not its enforcement.
    const payload = stripReadonly(view.uiSchema, e.formData ?? {});
    try {
      const next =
        curId == null
          ? await create.mutateAsync({ data: payload, files: stagedFiles })
          : await update.mutateAsync({ data: payload, files: stagedFiles });
      // Хост увёл экземпляр на другую запись за время сохранения: этот конверт —
      // от записи, которой уже нет на экране. Инвалидация её кэша всё же
      // корректна (запись сохранена), но UI не трогаем.
      if (recordKeyRef.current !== submittedKey) {
        void invalidateEntity(qc, name, next.id);
        return;
      }
      setEnv(next);
      setCurId(next.id);
      // Файлы уже уехали в теле сабмита и вернувшийся id их заменил — держать
      // их застейдженными дальше означало бы переслать их ещё раз на
      // следующем Save. Чистим СРАЗУ, до инвалидации: сабмит уже разблокировал
      // форму, и await на GET-инвалидации оставлял окно, в котором свежий выбор
      // файла попал бы под clearStaged после прихода ответа.
      clearStaged();
      setSavedAt(Date.now());
      void invalidateEntity(qc, name, next.id);
      if (next.id) onSaved?.(next.id);
    } catch (err) {
      // Ответ об ошибке той же записи, что уже сменилась, показывать нельзя:
      // он лёг бы на форму другой записи.
      if (recordKeyRef.current !== submittedKey) return;
      const body = (
        err as { body?: { fieldErrors?: { field: string; message: string }[]; formErrors?: string[] } }
      ).body;
      if (body?.fieldErrors) {
        const m = toExtraErrors(body.fieldErrors);
        setServerErr({ extra: m.extraErrors, form: [...(body.formErrors ?? []), ...m.formErrors] });
      } else {
        // Non-422 failure (network error, 500, ...): no fieldErrors to map —
        // surface a generic form-level alert instead of rethrowing from this
        // un-awaited async handler (an unhandled rejection gives the user no
        // feedback at all).
        const message = err instanceof Error ? err.message : messages.saveFailed;
        setServerErr({ extra: {}, form: [`${messages.saveFailed}: ${message}`] });
      }
    }
  }

  async function onDelete() {
    setServerErr({ extra: {}, form: [] });
    try {
      await del.mutateAsync();
      // Останавливаем запрос записи и выкидываем её из кэша, чтобы ещё
      // смонтированный observer не рефетчил только что удалённую строку (404).
      // Инвалидацию остальных записей сущности не ждём — навигация по onDeleted
      // не должна упираться в фоновый рефетч.
      setDeleted(true);
      qc.removeQueries({ queryKey: ["editor", name, curId] });
      void invalidateEntity(qc, name);
      onDeleted?.();
    } catch (err) {
      // Сервер может отказать осмысленно (409 с formErrors — например, запись
      // ещё используется) или сломаться (500). В первом случае показываем ЕГО
      // текст: он уже локализован каталогом сущности, и приписывать к нему
      // "Delete failed" значило бы дублировать смысл. Тело ответа приложено к
      // ошибке в use-editor.ts (fetchJSON кладёт { status, body }).
      const form = (err as { body?: { formErrors?: string[] } })?.body?.formErrors;
      if (form?.length) {
        setServerErr({ extra: {}, form });
        return;
      }
      // A hard DELETE can fail on FK references (500) — without this the
      // rejection was unhandled and the admin saw absolutely nothing happen.
      const message = err instanceof Error ? err.message : messages.deleteFailed;
      setServerErr({ extra: {}, form: [`${messages.deleteFailed}: ${message}`] });
    }
  }

  // rjsf treats ANY object passed to `extraErrors` as truthy, so an always-on
  // `extraErrors={serverErr.extra}` + `extraErrorsBlockSubmit` would block
  // every submit forever, even with no server errors (`{}` is still truthy).
  // Only wire the prop up once there is something to show.
  const hasServerFieldErrors = Object.keys(serverErr.extra).length > 0;
  // Флаг может только УБРАТЬ кнопку, но не показать её на форме создания: без
  // записи DELETE ушёл бы на `${base}/${name}/entity/` с пустым id.
  const deletable = canDelete !== false && curId != null;

  return (
    <div className={cn("mx-auto w-full", maxWidthClassName)}>
      <EditorHeader
        schema={view.schema}
        uiSchema={view.uiSchema}
        data={formData}
        messages={messages}
        locale={locale}
        onBack={onCancel}
      />
      {curId == null && (
        <p className="bg-muted/50 text-muted-foreground mb-6 rounded-md border px-3 py-2 text-sm">
          {messages.createHint}
        </p>
      )}
      {serverErr.form.length > 0 && (
        <div
          role="alert"
          className="border-destructive/50 text-destructive mb-4 rounded-md border px-3 py-2 text-sm"
        >
          {serverErr.form.join("; ")}
        </div>
      )}
      <EditorFormProvider value={formCtx}>
        <Form
          schema={view.schema}
          uiSchema={view.uiSchema}
          formData={formData}
          validator={validator}
          templates={TEMPLATES}
          widgets={{ ...EDITOR_WIDGETS, ...widgets }}
          fields={{ ...EDITOR_FIELDS, ...fields }}
          disabled={saving || deleting}
          extraErrors={hasServerFieldErrors ? serverErr.extra : undefined}
          extraErrorsBlockSubmit={hasServerFieldErrors}
          onChange={(e) => {
            setFormData(e.formData ?? {});
            // Any edit re-enables submit: rjsf only calls our onSubmit when
            // hasError is false, and hasError stays true forever once
            // serverErr.extra is non-empty (the ONLY place that clears it is
            // inside onSubmit, which is exactly what gets gated out). Clearing
            // eagerly on the next keystroke — not waiting for a resubmit —
            // means a corrected field lets the very next Save through, while
            // the error stays visible until the user actually touches the form.
            if (hasServerFieldErrors || serverErr.form.length > 0) setServerErr({ extra: {}, form: [] });
          }}
          onSubmit={onSubmit}
          // rjsf otherwise injects every schema `default` into a key absent from
          // the loaded record and pushes it through onChange, so a record whose
          // envelope omits a defaulted column reads as dirty on load (Save/Reset
          // enabled, revert markers on untouched fields). It also then SENDS that
          // default on the next save, overwriting a column the server left absent
          // ("absent" means "leave alone"). Suppressing injection fixes both: the
          // form stays exactly the envelope, and the payload carries only real
          // edits. The Go side owns defaults, including array-item shaping — the
          // trade-off is that rjsf's "Add item" yields an empty object rather than
          // one pre-filled with its sub-defaults, which this architecture accepts
          // (see the array-add test). Normalising the baseline through
          // getDefaultFormState was the alternative, but it keeps injecting and so
          // keeps overwriting absent columns on save.
          experimental_defaultFormStateBehavior={{ emptyObjectFields: "skipDefaults" }}
        >
          <EditorActions
            messages={messages}
            saving={saving}
            deleting={deleting}
            dirty={dirty}
            canDelete={deletable}
            onDelete={onDelete}
            onReset={onReset}
            savedAt={savedAt}
          />
        </Form>
      </EditorFormProvider>
    </div>
  );
}
