// Vitest global setup — referenced by vitest.config.ts setupFiles.
// Adds @testing-library/jest-dom custom matchers (toBeInTheDocument,
// toHaveTextContent, etc.) to expect() for the component tests in later plans.
import '@testing-library/jest-dom/vitest'

// jsdom does not implement window.scrollTo; TanStack Router's scroll restoration
// calls it on navigation. Stub it so router-driven component tests stay quiet.
window.scrollTo = () => {}

// react-flow (@xyflow/react) needs ResizeObserver + measurable element sizing to
// render under jsdom (neither exists there). The standard RF+vitest shim: a noop
// ResizeObserver plus fixed offset/bounding-rect sizes so RF believes its
// container has dimensions and lays nodes out instead of bailing.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver)

if (!('DOMMatrixReadOnly' in globalThis)) {
  class DOMMatrixReadOnlyStub {
    m22 = 1
    constructor() {}
  }
  // RF reads transform matrices during zoom math.
  ;(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly =
    DOMMatrixReadOnlyStub
}

Object.defineProperties(globalThis.HTMLElement.prototype, {
  offsetWidth: { configurable: true, get: () => 800 },
  offsetHeight: { configurable: true, get: () => 320 },
})

globalThis.HTMLElement.prototype.getBoundingClientRect = function () {
  return {
    x: 0,
    y: 0,
    width: 800,
    height: 320,
    top: 0,
    left: 0,
    right: 800,
    bottom: 320,
    toJSON: () => {},
  } as DOMRect
}
