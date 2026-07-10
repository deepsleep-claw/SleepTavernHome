export function getHostDocument(): Document {
  return window.parent?.document ?? document;
}

export function getHostWindow(): Window & typeof globalThis {
  return (getHostDocument().defaultView ?? window) as Window & typeof globalThis;
}
