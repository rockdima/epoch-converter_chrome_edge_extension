// The content script is registered dynamically for the user's allowed
// domains (storage: domains). localhost is allowed out of the box via
// install-time host_permissions; other domains are granted at runtime.
const SCRIPT_ID = "epoch-marker";

async function syncContentScripts() {
  const { domains } = await chrome.storage.sync.get({ domains: ["localhost"] });
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!domains.length) return;
  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID,
    matches: domains.flatMap((d) => [`http://${d}/*`, `https://${d}/*`]),
    js: ["content/content.js"],
    css: ["content/content.css"],
    runAt: "document_idle",
    allFrames: true,
  }]);
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "epoch-convert",
      title: "Convert timestamp ⇄ date",
      contexts: ["selection"],
    });
  });
  syncContentScripts();
  if (details.reason === "install") {
    // First run: explain that marking needs allowed domains.
    chrome.tabs.create({ url: "welcome/welcome.html" });
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#d29922" });
  }
});

// When a domain is added, mark already-open tabs right away instead of
// waiting for a refresh. (Removal is handled by the resident content script
// itself — it watches the domains list and tears its marks down.)
async function injectIntoOpenTabs(domain) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: [`http://${domain}/*`, `https://${domain}/*`] });
  } catch {
    return; // invalid pattern — nothing to do
  }
  for (const tab of tabs) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id, allFrames: true },
        files: ["content/content.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content/content.js"], // guarded against double injection
      });
    } catch {
      // Tab can't be scripted (discarded, error page) — it'll pick the
      // registered script up on its next load.
    }
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync" || !changes.domains) return;
  await syncContentScripts();
  const before = changes.domains.oldValue ?? ["localhost"];
  const after = changes.domains.newValue ?? [];
  for (const d of after.filter((d) => !before.includes(d))) {
    injectIntoOpenTabs(d);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "epoch-convert" || !tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      func: showConversion,
      args: [info.selectionText ?? ""],
    });
  } catch (e) {
    // Restricted page (chrome://, Web Store, etc.) — nothing we can do.
    console.warn("Epoch Converter: cannot inject here:", e.message);
  }
});

// Injected into the page. Must be self-contained: no outer-scope references.
function showConversion(text) {
  const HOST_ID = "__epoch-converter-tip__";
  document.getElementById(HOST_ID)?.remove();

  // --- parse the selection: epoch number or date string ---
  const rows = [];
  let title = "";
  const numeric = text.trim().replace(/[,\s_]/g, "");

  if (/^-?\d+(\.\d+)?$/.test(numeric)) {
    const value = Number(numeric);
    const units = [
      ["seconds", 1000, 1e11],
      ["milliseconds", 1, 1e14],
      ["microseconds", 1 / 1000, 1e17],
      ["nanoseconds", 1 / 1e6, Infinity],
    ];
    const [unit, factor] = units.find(([, , max]) => Math.abs(value) < max);
    const date = new Date(value * factor);
    if (isNaN(date.getTime())) {
      title = "Timestamp out of range";
    } else {
      title = `Epoch ${unit}`;
      const ms = value * factor;
      const diff = ms - Date.now();
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
      const steps = [
        [1000, "second", 60], [60000, "minute", 60], [3600000, "hour", 24],
        [86400000, "day", 30], [2592000000, "month", 12], [31536000000, "year", Infinity],
      ];
      const [unitMs, relUnit] = steps.find(([u, , span]) => Math.abs(diff) < u * span);
      rows.push(
        ["Local", date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })],
        ["UTC", date.toUTCString()],
        ["ISO", date.toISOString()],
        ["Relative", rtf.format(Math.round(diff / unitMs), relUnit)],
      );
    }
  } else {
    const ms = Date.parse(text.trim());
    if (isNaN(ms)) {
      title = "Couldn't parse as timestamp or date";
    } else {
      title = "Date → Epoch";
      rows.push(
        ["Seconds", String(Math.floor(ms / 1000))],
        ["Millis", String(ms)],
        ["ISO", new Date(ms).toISOString()],
      );
    }
  }

  // --- build tooltip in a shadow root so page CSS can't interfere ---
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .tip {
      position: fixed;
      z-index: 2147483647;
      max-width: 320px;
      background: #fff;
      color: #1c2330;
      border: 1px solid #d5dae2;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.18);
      font: 12px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      padding: 10px 12px;
    }
    @media (prefers-color-scheme: dark) {
      .tip { background: #1d232d; color: #e8ecf2; border-color: #38414f; }
      .k { color: #94a0b3 !important; }
      .close { color: #94a0b3 !important; }
    }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
    .title { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .close { border: none; background: none; cursor: pointer; font-size: 14px; color: #667085; padding: 0 2px; }
    .row { display: flex; gap: 8px; padding: 2px 0; align-items: baseline; }
    .k { flex: 0 0 56px; color: #667085; font-size: 11px; }
    .v { font-family: ui-monospace, Consolas, monospace; cursor: pointer; word-break: break-all; }
    .v:hover { text-decoration: underline; }
    .note { margin-top: 6px; font-size: 10px; color: #98a2b3; }
  `;
  shadow.appendChild(style);

  const tip = document.createElement("div");
  tip.className = "tip";

  const head = document.createElement("div");
  head.className = "head";
  const titleEl = document.createElement("span");
  titleEl.className = "title";
  titleEl.textContent = title;
  const close = document.createElement("button");
  close.className = "close";
  close.textContent = "✕";
  close.addEventListener("click", () => host.remove());
  head.append(titleEl, close);
  tip.appendChild(head);

  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.className = "row";
    const kEl = document.createElement("span");
    kEl.className = "k";
    kEl.textContent = k;
    const vEl = document.createElement("span");
    vEl.className = "v";
    vEl.textContent = v;
    vEl.title = "Click to copy";
    vEl.addEventListener("click", () => {
      navigator.clipboard.writeText(v);
      vEl.style.opacity = "0.5";
      setTimeout(() => (vEl.style.opacity = ""), 300);
    });
    row.append(kEl, vEl);
    tip.appendChild(row);
  }

  if (rows.length) {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = "Click a value to copy · Esc to close";
    tip.appendChild(note);
  }

  shadow.appendChild(tip);
  document.documentElement.appendChild(host);

  // --- position next to the selection, clamped to the viewport ---
  const sel = window.getSelection();
  let rect = null;
  if (sel && sel.rangeCount) rect = sel.getRangeAt(0).getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = rect ? rect.left : (innerWidth - tw) / 2;
  let y = rect ? rect.bottom + 8 : (innerHeight - th) / 2;
  if (y + th > innerHeight - 8) y = Math.max(8, (rect ? rect.top : innerHeight) - th - 8);
  x = Math.min(Math.max(8, x), innerWidth - tw - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;

  // --- dismiss on Esc or outside click ---
  const onKey = (e) => { if (e.key === "Escape") cleanup(); };
  const onDown = (e) => { if (e.target !== host) cleanup(); };
  function cleanup() {
    host.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
  }
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onDown, true);
}
