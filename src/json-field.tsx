import * as React from "react";
import type { FieldProps } from "@rjsf/utils";

/** Редактор грузится отдельным чанком: vanilla-jsoneditor тянет CodeMirror и
 *  занимает около мегабайта — держать его в главном бандле ради поля, которое
 *  есть у одной сущности из десяти, нельзя. Статического импорта здесь поэтому
 *  нет: он вернул бы библиотеку в общий граф. */
const JsonEditorImpl = React.lazy(() => import("./json-editor"));

export function JsonEditorField(props: FieldProps) {
  return (
    <React.Suspense
      fallback={
        <div className="border-input text-muted-foreground rounded-md border px-3 py-2 text-xs">…</div>
      }
    >
      <JsonEditorImpl {...props} />
    </React.Suspense>
  );
}
