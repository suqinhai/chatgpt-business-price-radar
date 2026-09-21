import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", { value: () => undefined, writable: true });
}
if (typeof Element !== "undefined") {
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, writable: true });
}
