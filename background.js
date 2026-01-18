const STORAGE_ENABLED = "voiceNavigatorEnabled";
const STORAGE_DICTATION = "voiceNavigatorDictation";
const STORAGE_STATUS = "voiceNavigatorStatus";
const STORAGE_TRANSCRIPT = "voiceNavigatorTranscript";
const LISTENER_URL = chrome.runtime.getURL("listener.html");

let listenerTabId = null;

async function setEnabled(enabled) {
  await chrome.storage.local.set({ [STORAGE_ENABLED]: enabled });
  await chrome.storage.local.set({ [STORAGE_STATUS]: enabled ? "listening" : "stopped" });

  if (enabled) {
    await ensureListenerTab();
    chrome.runtime.sendMessage({ type: "voice-start" });
  } else {
    chrome.runtime.sendMessage({ type: "voice-stop" });
    await closeListenerTab();
  }
}

async function setDictation(enabled) {
  await chrome.storage.local.set({ [STORAGE_DICTATION]: enabled });
}

async function ensureListenerTab() {
  if (listenerTabId) {
    return;
  }

  const existing = await findListenerTab();
  if (existing) {
    listenerTabId = existing.id;
    return;
  }

  const created = await chrome.tabs.create({
    url: LISTENER_URL,
    active: false,
    pinned: true
  });
  listenerTabId = created?.id || null;
}

async function closeListenerTab() {
  if (!listenerTabId) {
    const existing = await findListenerTab();
    if (existing) {
      listenerTabId = existing.id;
    }
  }

  if (listenerTabId) {
    try {
      await chrome.tabs.remove(listenerTabId);
    } catch (error) {
      // Ignore if already closed.
    }
  }
  listenerTabId = null;
}

function findListenerTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: LISTENER_URL }, (tabs) => {
      resolve(tabs && tabs.length ? tabs[0] : null);
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([STORAGE_ENABLED, STORAGE_DICTATION]);
  if (data[STORAGE_ENABLED]) {
    await ensureListenerTab();
    chrome.runtime.sendMessage({ type: "voice-start" });
  }
  if (typeof data[STORAGE_DICTATION] === "undefined") {
    await chrome.storage.local.set({ [STORAGE_DICTATION]: false });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get(STORAGE_ENABLED);
  if (data[STORAGE_ENABLED]) {
    await ensureListenerTab();
    chrome.runtime.sendMessage({ type: "voice-start" });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (listenerTabId && tabId === listenerTabId) {
    listenerTabId = null;
    const data = await chrome.storage.local.get(STORAGE_ENABLED);
    if (data[STORAGE_ENABLED]) {
      await ensureListenerTab();
      chrome.runtime.sendMessage({ type: "voice-start" });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "toggle-voice") {
    setEnabled(Boolean(message.enabled));
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "toggle-dictation") {
    setDictation(Boolean(message.enabled));
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "request-status") {
    chrome.storage.local.get(
      [STORAGE_ENABLED, STORAGE_DICTATION, STORAGE_TRANSCRIPT, STORAGE_STATUS],
      (data) => {
        sendResponse({
          enabled: Boolean(data[STORAGE_ENABLED]),
          dictation: Boolean(data[STORAGE_DICTATION]),
          transcript: data[STORAGE_TRANSCRIPT] || "",
          status: data[STORAGE_STATUS] || "stopped"
        });
      }
    );
    return true;
  }

  if (message.type === "voice-transcript") {
    chrome.storage.local.set({ [STORAGE_TRANSCRIPT]: message.transcript || "" });
    chrome.runtime.sendMessage({ type: "ui-transcript", transcript: message.transcript || "" });
  }

  if (message.type === "voice-status") {
    chrome.storage.local.set({ [STORAGE_STATUS]: message.status || "stopped" });
    chrome.runtime.sendMessage({ type: "ui-status", status: message.status || "stopped" });
  }

  if (message.type === "voice-command") {
    handleVoiceInput(message.command || "");
  }
});

async function handleVoiceInput(rawText) {
  const text = rawText.toLowerCase().trim();
  if (!text) {
    return;
  }

  const data = await chrome.storage.local.get(STORAGE_DICTATION);
  const dictationOn = Boolean(data[STORAGE_DICTATION]);

  if (dictationOn && !(await tryDictation(rawText))) {
    handleCommand(text, rawText);
    return;
  }

  if (!dictationOn) {
    handleCommand(text, rawText);
  }
}

async function tryDictation(rawText) {
  const result = await runInActiveTab(insertTextAtCursor, [rawText]);
  return Boolean(result);
}

function handleCommand(text, rawText) {
  if (text.includes("scroll to top")) {
    runInActiveTab(scrollToEdge, ["top"]);
    return;
  }

  if (text.includes("scroll to bottom")) {
    runInActiveTab(scrollToEdge, ["bottom"]);
    return;
  }

  const scrollMatch = text.match(/scroll\s+(down|up)(?:\s+(\d+))?/);
  if (scrollMatch) {
    const direction = scrollMatch[1];
    const amount = scrollMatch[2] ? Number(scrollMatch[2]) : null;
    runInActiveTab(scrollByAmount, [direction, amount]);
    return;
  }

  if (text.includes("page down")) {
    runInActiveTab(scrollByAmount, ["down", "page"]);
    return;
  }

  if (text.includes("page up")) {
    runInActiveTab(scrollByAmount, ["up", "page"]);
    return;
  }

  if (text.includes("show links")) {
    runInActiveTab(showLinkHints, []);
    return;
  }

  if (text.includes("hide links")) {
    runInActiveTab(hideLinkHints, []);
    return;
  }

  const clickMatch = text.match(/(click|open) link\s+(\d+)/);
  if (clickMatch) {
    runInActiveTab(clickLinkByIndex, [Number(clickMatch[2])]);
    return;
  }

  if (text.includes("next tab")) {
    switchTabByOffset(1);
    return;
  }

  if (text.includes("previous tab") || text.includes("prev tab")) {
    switchTabByOffset(-1);
    return;
  }

  const tabMatch = text.match(/(switch tab|tab)\s+(\d+)/);
  if (tabMatch) {
    switchToTabIndex(Number(tabMatch[2]) - 1);
    return;
  }

  if (text.includes("close tab")) {
    closeActiveTab();
    return;
  }

  if (text.includes("open new tab") || text.includes("new tab")) {
    chrome.tabs.create({ url: "chrome://newtab" });
    return;
  }

  if (text.includes("reload tab") || text === "reload") {
    reloadActiveTab();
    return;
  }

  const openMatch = text.match(/open\s+(.+)/);
  if (openMatch) {
    const query = openMatch[1].trim();
    openQuery(query);
  } else {
    chrome.runtime.sendMessage({ type: "ui-status", status: `unknown:${rawText}` });
  }
}

function openQuery(query) {
  if (!query) {
    return;
  }

  const normalized = query.replace(/^https?:\/\//, "");
  const looksLikeDomain = /\.[a-z]{2,}/i.test(normalized);
  const url = looksLikeDomain
    ? `https://${normalized}`
    : `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) {
      chrome.tabs.create({ url });
      return;
    }

    chrome.tabs.update(tabs[0].id, { url });
  });
}

function runInActiveTab(func, args) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) {
        resolve(false);
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          func,
          args
        },
        (results) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(results && results[0] ? results[0].result : false);
        }
      );
    });
  });
}

function switchTabByOffset(offset) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const currentIndex = tabs.findIndex((tab) => tab.active);
    if (currentIndex === -1) {
      return;
    }

    const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
    chrome.tabs.update(tabs[nextIndex].id, { active: true });
  });
}

function switchToTabIndex(index) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    if (index < 0 || index >= tabs.length) {
      return;
    }

    chrome.tabs.update(tabs[index].id, { active: true });
  });
}

function closeActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) {
      return;
    }

    chrome.tabs.remove(tabs[0].id);
  });
}

function reloadActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) {
      return;
    }

    chrome.tabs.reload(tabs[0].id);
  });
}

function scrollByAmount(direction, amount) {
  let delta = direction === "down" ? 1 : -1;
  if (amount === "page") {
    delta *= Math.round(window.innerHeight * 0.9);
  } else if (typeof amount === "number") {
    delta *= amount;
  } else {
    delta *= Math.round(window.innerHeight * 0.7);
  }
  window.scrollBy({ top: delta, left: 0, behavior: "smooth" });
}

function scrollToEdge(edge) {
  const top = edge === "top" ? 0 : document.body.scrollHeight;
  window.scrollTo({ top, behavior: "smooth" });
}

function showLinkHints() {
  if (window.__voiceNav?.overlay) {
    window.__voiceNav.overlay.remove();
  }

  const overlay = document.createElement("div");
  overlay.id = "voice-nav-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "2147483647";

  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const linkData = [];

  let index = 1;
  anchors.forEach((anchor) => {
    const rect = anchor.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      return;
    }

    if (rect.bottom < 0 || rect.top > viewportH || rect.right < 0 || rect.left > viewportW) {
      return;
    }

    const badge = document.createElement("div");
    badge.textContent = String(index);
    badge.style.position = "absolute";
    badge.style.top = `${Math.max(0, rect.top - 6)}px`;
    badge.style.left = `${Math.max(0, rect.left - 6)}px`;
    badge.style.padding = "2px 6px";
    badge.style.background = "#f97316";
    badge.style.color = "#140b02";
    badge.style.borderRadius = "999px";
    badge.style.fontSize = "12px";
    badge.style.fontWeight = "700";
    badge.style.boxShadow = "0 2px 6px rgba(0,0,0,0.35)";
    overlay.appendChild(badge);

    linkData.push({ index, element: anchor });
    index += 1;
  });

  document.body.appendChild(overlay);
  window.__voiceNav = { overlay, links: linkData, visible: true };
}

function hideLinkHints() {
  if (window.__voiceNav?.overlay) {
    window.__voiceNav.overlay.remove();
  }
  window.__voiceNav = { overlay: null, links: [], visible: false };
}

function clickLinkByIndex(index) {
  let target = null;
  const data = window.__voiceNav;

  if (data?.links?.length) {
    const found = data.links.find((item) => item.index === index);
    target = found?.element || null;
  }

  if (!target) {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    target = anchors[index - 1];
  }

  if (target) {
    target.focus();
    target.click();
    if (window.__voiceNav?.overlay) {
      window.__voiceNav.overlay.remove();
    }
    window.__voiceNav = { overlay: null, links: [], visible: false };
  }
}

function insertTextAtCursor(text) {
  const cleaned = text.trim();
  if (!cleaned) {
    return false;
  }

  let active = document.activeElement;
  if (active === document.body || !active) {
    active = document.querySelector(
      "input:focus, textarea:focus, [contenteditable=\"true\"]:focus, [contenteditable=\"\"]:focus"
    );
  }

  if (!active) {
    return false;
  }

  const tag = active.tagName ? active.tagName.toLowerCase() : "";
  const isEditable = active.isContentEditable;
  const isInput = tag === "input" || tag === "textarea";

  if (!isEditable && !isInput) {
    return false;
  }

  if (isInput) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    if (typeof active.setRangeText === "function") {
      active.setRangeText(`${cleaned} `, start, end, "end");
    } else {
      const before = active.value.slice(0, start);
      const after = active.value.slice(end);
      active.value = `${before}${cleaned} ${after}`;
      const cursor = (before + cleaned + " ").length;
      active.selectionStart = cursor;
      active.selectionEnd = cursor;
    }
    active.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  if (isEditable) {
    if (document.execCommand && document.execCommand("insertText", false, `${cleaned} `)) {
      return true;
    }

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
      return false;
    }
    selection.deleteFromDocument();
    selection.getRangeAt(0).insertNode(document.createTextNode(`${cleaned} `));
    selection.collapseToEnd();
    return true;
  }

  return false;
}
