// vitest 4's `populateGlobal` doesn't include `localStorage` /
// `sessionStorage` in the list of jsdom keys it copies onto the global,
// and Node 22+ ships its own broken `localStorage` global that shadows
// jsdom's. Net effect: `localStorage.getItem(...)` is undefined at
// module load even with `environment: "jsdom"`. Reach into the JSDOM
// instance vitest stashes on `global.jsdom` and rebind so module-level
// reads (e.g. theme persistence) see a working Storage instance.
declare global {
  // eslint-disable-next-line no-var
  var jsdom: { window: { localStorage: Storage; sessionStorage: Storage } } | undefined;
}
const jsdomInstance = globalThis.jsdom;
if (jsdomInstance) {
  Object.defineProperty(globalThis, "localStorage", {
    value: jsdomInstance.window.localStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: jsdomInstance.window.sessionStorage,
    writable: true,
    configurable: true,
  });
}

// jsdom doesn't implement `matchMedia`. Modules that read theme
// preferences at import time (uiSlice) call it before any
// `vi.stubGlobal` in `beforeEach` runs, so stub a quiet default here.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => {
    const stub: MediaQueryList = {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
    return stub;
  };
}
