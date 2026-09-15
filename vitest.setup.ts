// Registers jest-dom matchers on vitest's expect at runtime. Types for tsc
// come from src/vitest-env.d.ts.
import "@testing-library/jest-dom/vitest";

// jsdom ships no ResizeObserver; Radix primitives construct one on mount.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom implements no pointer capture; Radix's menu and tooltip call these on
// the trigger while deciding whether a press became a drag.
for (const m of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
  if (!(m in Element.prototype)) {
    Element.prototype[m] = (() => false) as never;
  }
}
// Radix scrolls the highlighted menu item into view on open.
if (!("scrollIntoView" in Element.prototype)) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}
