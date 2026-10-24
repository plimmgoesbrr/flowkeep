/*
 * Minimal WebExtension polyfill.
 * Chromium browsers expose `chrome`; Firefox exposes `browser` (promise-based).
 * Modern Chrome (MV3) supports promises on most APIs, so a thin alias is enough
 * for the surface this extension uses (storage, notifications, alarms, runtime).
 * For anything that still only takes callbacks, wrap it here.
 */
(function () {
  if (typeof globalThis.browser === "undefined") {
    globalThis.browser = globalThis.chrome;
  }
})();
