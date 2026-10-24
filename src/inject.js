/*
 * inject.js — runs in the PAGE context (not the content-script sandbox) so it
 * can monkey-patch window.fetch and XMLHttpRequest. Claude's web app talks to
 * its own internal API; some of those responses carry rate-limit / usage hints
 * (headers like anthropic-ratelimit-*, or JSON with usage fields). When we spot
 * them we forward them to the content script via window.postMessage.
 *
 * This is best-effort and defensive: Claude's internal endpoints are private and
 * can change without notice. If the shape changes we silently fall back to the
 * heuristic estimator. We never modify requests or responses — read-only.
 */
(function () {
  const TAG = "FLOWKEEP_USAGE";

  function emit(payload) {
    try {
      window.postMessage({ source: TAG, payload }, window.location.origin);
    } catch (_) {
      /* ignore */
    }
  }

  function scanHeaders(headers) {
    const out = {};
    try {
      headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (k.includes("ratelimit") || k.includes("rate-limit") || k.includes("reset")) {
          out[k] = value;
        }
      });
    } catch (_) {}
    return Object.keys(out).length ? out : null;
  }

  function scanBody(obj) {
    if (!obj || typeof obj !== "object") return null;
    const found = {};
    // common shapes: { usage: {...} }, { rate_limit: {...} }, resetsAt, remaining
    for (const key of ["usage", "rate_limit", "rateLimit", "limits", "remaining", "resetsAt", "resets_at"]) {
      if (key in obj) found[key] = obj[key];
    }
    return Object.keys(found).length ? found : null;
  }

  // --- patch fetch ---
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    return origFetch.apply(this, args).then((res) => {
      try {
        const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        if (url.includes("/api/")) {
          const headerHits = scanHeaders(res.headers);
          if (headerHits) emit({ type: "headers", url, data: headerHits });
          // peek at JSON without consuming the original stream
          const clone = res.clone();
          clone
            .json()
            .then((body) => {
              const hit = scanBody(body);
              if (hit) emit({ type: "body", url, data: hit });
            })
            .catch(() => {});
        }
      } catch (_) {}
      return res;
    });
  };

  // --- patch XHR (Claude uses fetch mostly, but cover both) ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__fk_url = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      try {
        if (this.__fk_url && String(this.__fk_url).includes("/api/")) {
          const body = JSON.parse(this.responseText);
          const hit = scanBody(body);
          if (hit) emit({ type: "body", url: this.__fk_url, data: hit });
        }
      } catch (_) {}
    });
    return origSend.apply(this, arguments);
  };

  // signal that capture is live (useful for debugging in the console)
  emit({ type: "ready" });
})();
