/*
 * content.js — the brain on the page.
 *
 * Responsibilities:
 *   1. Inject inject.js (page context) and listen for any real usage data it
 *      captures from Claude's own network calls.
 *   2. Estimate session token usage from the conversation DOM as the always-on
 *      fallback (and primary signal until/unless real data arrives).
 *   3. Render the floating gauge badge and keep it live.
 *   4. Run a pre-flight check on the composer before the user sends.
 *   5. Auto-snapshot the conversation when usage crosses the warning line.
 *   6. Hand off to a free model in one click, carrying the snapshot.
 *
 * Honesty note: token counts are heuristic estimates (see tokenizer.js) unless
 * Claude's API happens to return real limit data, which inject.js will surface.
 */

const FK = {
  est: (self.FlowKeepTokenizer || { estimateTokens: () => 0 }).estimateTokens,
  state: {
    sessionTokens: 0,
    budget: 190000, // user-configurable estimate of session token allowance
    sessionStart: Date.now(),
    sessionWindowMs: 5 * 60 * 60 * 1000, // Claude session ≈ 5h rolling
    counted: new Set(), // hashes of messages already tallied
    realData: null,
    warned: false,
    snapshot: null,
  },
};

/* ---------- tiny helpers ---------- */
function hashText(t) {
  let h = 0;
  for (let i = 0; i < t.length; i++) {
    h = (h << 5) - h + t.charCodeAt(i);
    h |= 0;
  }
  return h + ":" + t.length;
}

function fmt(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(n);
}

function pct() {
  return Math.min(100, (FK.state.sessionTokens / FK.state.budget) * 100);
}

function msUntilReset() {
  const elapsed = Date.now() - FK.state.sessionStart;
  return Math.max(0, FK.state.sessionWindowMs - elapsed);
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m >= 60) return Math.floor(m / 60) + "h " + (m % 60) + "m";
  return m + "m";
}

/* ---------- inject page-context capture ---------- */
function injectCapture() {
  try {
    const s = document.createElement("script");
    s.src = browser.runtime.getURL("src/inject.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    /* non-fatal: we still have the estimator */
  }
}

window.addEventListener("message", (ev) => {
  if (ev.origin !== window.location.origin) return;
  const d = ev.data;
  if (!d || d.source !== "FLOWKEEP_USAGE") return;
  if (d.payload && d.payload.type !== "ready") {
    FK.state.realData = d.payload;
    // If Claude exposed a reset timestamp, prefer it.
    const data = d.payload.data || {};
    const resetRaw = data.resetsAt || data.resets_at || data["anthropic-ratelimit-tokens-reset"];
    if (resetRaw) {
      const t = Date.parse(resetRaw);
      if (!isNaN(t)) {
        FK.state.sessionStart = t - FK.state.sessionWindowMs;
      }
    }
    renderBadge();
  }
});

/* ---------- conversation scanning ---------- */
function findMessages() {
  // Defensive selectors — Claude's DOM changes; try several, dedupe by node.
  const sels = [
    '[data-testid*="message"]',
    '[data-testid="user-message"]',
    'div[class*="font-claude-message"]',
    'div[class*="message"]',
  ];
  const nodes = new Set();
  for (const sel of sels) {
    document.querySelectorAll(sel).forEach((n) => nodes.add(n));
  }
  return [...nodes];
}

function rescan() {
  const msgs = findMessages();
  let added = 0;
  for (const node of msgs) {
    const text = (node.innerText || "").trim();
    if (text.length < 2) continue;
    const h = hashText(text);
    if (FK.state.counted.has(h)) continue;
    FK.state.counted.add(h);
    FK.state.sessionTokens += FK.est(text);
    added++;
  }
  if (added) {
    persist();
    checkThresholds();
    renderBadge();
  }
}

/* ---------- snapshot ---------- */
function buildSnapshot() {
  const msgs = findMessages()
    .map((n) => (n.innerText || "").trim())
    .filter((t) => t.length > 1);
  // Compress: keep the first message (usually the goal) + the last few turns.
  const head = msgs.slice(0, 1);
  const tail = msgs.slice(-6);
  const lines = [];
  lines.push("# FlowKeep session snapshot");
  lines.push("Source: Claude — " + new Date().toLocaleString());
  lines.push("Estimated tokens used this session: ~" + FK.state.sessionTokens);
  lines.push("");
  lines.push("## Where this session started");
  lines.push(head.join("\n") || "(not captured)");
  lines.push("");
  lines.push("## Most recent context");
  lines.push(tail.join("\n\n---\n\n"));
  lines.push("");
  lines.push("## How to resume");
  lines.push(
    "You are picking up an in-progress session that hit a usage limit. " +
      "Continue the task above from where it left off. Keep the same goal, tone, and any constraints already established."
  );
  const snap = lines.join("\n");
  FK.state.snapshot = snap;
  browser.storage.local.set({ fk_lastSnapshot: { text: snap, at: Date.now() } });
  return snap;
}

/* ---------- thresholds + notifications ---------- */
function checkThresholds() {
  const p = pct();
  if (p >= 80 && !FK.state.warned) {
    FK.state.warned = true;
    buildSnapshot();
    browser.runtime.sendMessage({
      type: "notify",
      title: "FlowKeep — approaching your limit",
      message:
        "About " + Math.round(p) + "% of your estimated session used. Snapshot saved so you can hand off cleanly.",
    });
  }
  if (p < 60) FK.state.warned = false; // re-arm after reset
}

/* ---------- badge UI ---------- */
let badgeEl = null;
function renderBadge() {
  if (!badgeEl) {
    badgeEl = document.createElement("div");
    badgeEl.id = "flowkeep-badge";
    badgeEl.innerHTML = `
      <div class="fk-row">
        <span class="fk-label">Session usage</span>
        <span class="fk-count" id="fk-count"></span>
      </div>
      <div class="fk-track"><div class="fk-fill" id="fk-fill"></div></div>
      <div class="fk-foot">
        <span class="fk-reset" id="fk-reset"></span>
        <button class="fk-handoff" id="fk-handoff" title="Save context and continue on a free model">Hand off ↗</button>
      </div>`;
    document.body.appendChild(badgeEl);
    makeDraggable(badgeEl);
    badgeEl.querySelector("#fk-handoff").addEventListener("click", (e) => {
      e.stopPropagation();
      doHandoff();
    });
  }
  const p = pct();
  badgeEl.classList.toggle("fk-warn", p >= 75 && p < 92);
  badgeEl.classList.toggle("fk-danger", p >= 92);
  badgeEl.querySelector("#fk-fill").style.width = p + "%";
  badgeEl.querySelector("#fk-count").textContent =
    fmt(FK.state.sessionTokens) + " / " + fmt(FK.state.budget);
  badgeEl.querySelector("#fk-reset").textContent = "resets in " + fmtDuration(msUntilReset());
}

function makeDraggable(el) {
  let sx, sy, ox, oy, dragging = false;
  el.addEventListener("mousedown", (e) => {
    if (e.target.closest("#fk-handoff")) return;
    dragging = true;
    el.classList.add("fk-dragging");
    sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect();
    ox = r.left; oy = r.top;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    el.style.left = ox + (e.clientX - sx) + "px";
    el.style.top = oy + (e.clientY - sy) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    el.classList.remove("fk-dragging");
  });
}

/* ---------- pre-flight ---------- */
let pfEl = null;
function ensurePreflight() {
  if (pfEl) return pfEl;
  pfEl = document.createElement("div");
  pfEl.id = "flowkeep-preflight";
  pfEl.innerHTML = `<span class="fk-pf-dot"></span><span id="fk-pf-text"></span>`;
  document.body.appendChild(pfEl);
  return pfEl;
}

function findComposer() {
  return (
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea")
  );
}

function runPreflight() {
  const composer = findComposer();
  if (!composer) return;
  const text = composer.innerText || composer.value || "";
  const promptTokens = FK.est(text);
  // crude expected-response budget: responses often run 1-3x the prompt for
  // substantive asks, with a floor for short prompts that trigger long answers.
  const expectedResponse = Math.max(600, promptTokens * 2);
  const projected = FK.state.sessionTokens + promptTokens + expectedResponse;
  const el = ensurePreflight();
  if (projected > FK.state.budget && text.trim().length > 0) {
    const over = projected - FK.state.budget;
    el.querySelector("#fk-pf-text").textContent =
      "This prompt may get cut off — projected to exceed your session by ~" +
      fmt(over) +
      " tokens. Consider trimming, or hand off after sending.";
    el.classList.add("fk-show");
  } else {
    el.classList.remove("fk-show");
  }
}

/* ---------- handoff ---------- */
async function doHandoff() {
  const snap = FK.state.snapshot || buildSnapshot();
  try {
    await navigator.clipboard.writeText(snap);
  } catch (_) {
    /* clipboard may be blocked; the snapshot is still saved in storage */
  }
  browser.runtime.sendMessage({ type: "openHandoff", target: "gemini" });
}

/* ---------- persistence ---------- */
function persist() {
  browser.storage.local.set({
    fk_session: {
      tokens: FK.state.sessionTokens,
      start: FK.state.sessionStart,
      budget: FK.state.budget,
    },
  });
}

async function restore() {
  try {
    const { fk_session, fk_settings } = await browser.storage.local.get([
      "fk_session",
      "fk_settings",
    ]);
    if (fk_settings && fk_settings.budget) FK.state.budget = fk_settings.budget;
    if (fk_session) {
      // only restore if still inside the session window
      if (Date.now() - fk_session.start < FK.state.sessionWindowMs) {
        FK.state.sessionTokens = fk_session.tokens || 0;
        FK.state.sessionStart = fk_session.start;
        FK.state.budget = fk_session.budget || FK.state.budget;
      } else {
        FK.state.sessionStart = Date.now();
        FK.state.sessionTokens = 0;
      }
    }
  } catch (_) {}
}

/* respond to popup queries / settings changes */
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "getState") {
    sendResponse({
      tokens: FK.state.sessionTokens,
      budget: FK.state.budget,
      pct: pct(),
      resetMs: msUntilReset(),
      hasSnapshot: !!FK.state.snapshot,
    });
    return true;
  }
  if (msg.type === "setBudget") {
    FK.state.budget = msg.budget;
    browser.storage.local.set({ fk_settings: { budget: msg.budget } });
    persist();
    renderBadge();
  }
  if (msg.type === "resetSession") {
    FK.state.sessionTokens = 0;
    FK.state.sessionStart = Date.now();
    FK.state.counted.clear();
    FK.state.warned = false;
    persist();
    renderBadge();
  }
  if (msg.type === "snapshotNow") {
    sendResponse({ text: buildSnapshot() });
    return true;
  }
});

/* ---------- boot ---------- */
async function boot() {
  injectCapture();
  renderBadge(); // paint immediately with defaults…
  await restore(); // …then update once saved settings load
  renderBadge();

  const obs = new MutationObserver(() => {
    clearTimeout(boot._t);
    boot._t = setTimeout(rescan, 400);
  });
  obs.observe(document.body, { childList: true, subtree: true });
  rescan();

  document.addEventListener("input", (e) => {
    if (e.target.closest && (e.target.isContentEditable || e.target.tagName === "TEXTAREA")) {
      clearTimeout(runPreflight._t);
      runPreflight._t = setTimeout(runPreflight, 250);
    }
  });

  setInterval(renderBadge, 30000); // keep reset countdown fresh
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
