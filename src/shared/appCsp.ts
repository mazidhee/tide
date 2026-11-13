/**
 * The app's own Content Security Policy, set on the packaged window's page (electron.vite.config).
 * Dev needs inline scripts for React fast refresh, so it's build only. 'wasm-unsafe-eval' lets
 * compiled WebAssembly run (Ruff, the Python linter, in the code editor's worker); it does not
 * allow JavaScript eval or new Function. frame-src names YouTube's player and tide-visual:, the
 * scheme Claude's visuals are served from (shared/visuals): each in a sandboxed frame with a
 * policy of its own, which allows no network at all.
 */
export const APP_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' vault: data: https:; " +
  "font-src 'self' data:; connect-src 'self' vault:; frame-src https://www.youtube-nocookie.com https://www.youtube.com tide-visual:; " +
  "worker-src 'self' blob:; media-src 'self' vault: tide-anim: https:"
