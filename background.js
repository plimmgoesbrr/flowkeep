/*
 * background.js — service worker.
 * Handles the things a content script can't: firing OS notifications and
 * opening the handoff tab. Kept deliberately thin.
 */
import "./lib/browser-polyfill.js";

const HANDOFF_TARGETS = {
  gemini: "https://gemini.google.com/app",
  groq: "https://groq.com/",
  chatgpt: "https://chat.openai.com/",
};

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === "notify") {
    browser.notifications.create("flowkeep-" + Date.now(), {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon128.png"),
      title: msg.title || "FlowKeep",
      message: msg.message || "",
      priority: 2,
    });
  }

  if (msg.type === "openHandoff") {
    const url = HANDOFF_TARGETS[msg.target] || HANDOFF_TARGETS.gemini;
    browser.tabs.create({ url });
    browser.notifications.create("flowkeep-handoff-" + Date.now(), {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon128.png"),
      title: "FlowKeep — context copied",
      message: "Your session snapshot is on the clipboard. Paste it into the new chat to continue.",
      priority: 2,
    });
  }
});

browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.get("fk_settings").then(({ fk_settings }) => {
    if (!fk_settings) {
      browser.storage.local.set({ fk_settings: { budget: 190000 } });
    }
  });
});
