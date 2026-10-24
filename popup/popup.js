/* popup.js — talks to the content script in the active Claude tab. */

const $ = (id) => document.getElementById(id);

function fmt(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(n);
}
function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m >= 60) return Math.floor(m / 60) + "h " + (m % 60) + "m";
  return m + "m";
}

async function activeClaudeTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab && /^https:\/\/claude\.ai\//.test(tab.url || "")) return tab;
  // fall back to any open Claude tab
  const all = await browser.tabs.query({ url: "https://claude.ai/*" });
  return all[0] || null;
}

async function send(tabId, msg) {
  try {
    return await browser.tabs.sendMessage(tabId, msg);
  } catch (_) {
    return null;
  }
}

function paint(state) {
  if (!state) {
    $("fk-msg").textContent = "Open a Claude tab to start tracking.";
    return;
  }
  $("fk-tokens").textContent = fmt(state.tokens);
  $("fk-budget").textContent = "/ " + fmt(state.budget);
  $("fk-pct").textContent = Math.round(state.pct) + "%";
  $("fk-reset").textContent = "resets in " + fmtDuration(state.resetMs);
  const fill = $("fk-fill");
  fill.style.width = Math.min(100, state.pct) + "%";
  fill.classList.toggle("warn", state.pct >= 75 && state.pct < 92);
  fill.classList.toggle("danger", state.pct >= 92);
  $("fk-msg").textContent = state.hasSnapshot
    ? "Snapshot ready — hand off anytime without losing context."
    : "Tracking live. A snapshot is saved automatically at 80%.";
}

let currentTab = null;

async function refresh() {
  currentTab = await activeClaudeTab();
  if (!currentTab) return paint(null);
  const state = await send(currentTab.id, { type: "getState" });
  paint(state);
}

document.addEventListener("DOMContentLoaded", async () => {
  // restore saved budget into the selector
  const { fk_settings } = await browser.storage.local.get("fk_settings");
  if (fk_settings && fk_settings.budget) {
    $("fk-plan").value = String(fk_settings.budget);
  }

  await refresh();

  $("fk-plan").addEventListener("change", async (e) => {
    const budget = parseInt(e.target.value, 10);
    await browser.storage.local.set({ fk_settings: { budget } });
    if (currentTab) await send(currentTab.id, { type: "setBudget", budget });
    refresh();
  });

  $("fk-reset-btn").addEventListener("click", async () => {
    if (currentTab) await send(currentTab.id, { type: "resetSession" });
    refresh();
  });

  $("fk-snapshot").addEventListener("click", async () => {
    if (!currentTab) return;
    const res = await send(currentTab.id, { type: "snapshotNow" });
    if (res && res.text) {
      try {
        await navigator.clipboard.writeText(res.text);
        $("fk-msg").textContent = "Snapshot copied to clipboard.";
      } catch (_) {
        $("fk-msg").textContent = "Snapshot saved.";
      }
    }
  });

  $("fk-handoff").addEventListener("click", async () => {
    const target = $("fk-target").value;
    if (currentTab) {
      const res = await send(currentTab.id, { type: "snapshotNow" });
      if (res && res.text) {
        try { await navigator.clipboard.writeText(res.text); } catch (_) {}
      }
    }
    browser.runtime.sendMessage({ type: "openHandoff", target });
    window.close();
  });
});
