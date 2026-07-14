// Detects epoch timestamps in page text, marks them, and shows a conversion
// tooltip on hover. Runs only on user-allowed domains (storage: domains);
// toggleable from the popup (storage: pageHighlight).
//
// Guarded against double injection: the service worker injects this file into
// already-open tabs when their domain is added, and the script may already be
// resident (e.g. domain removed then re-added while the tab stayed open).
if (!window.__epochConverterLoaded) {
  window.__epochConverterLoaded = true;

  const SPAN_CLASS = "__epoch-hl__";
  // Exact runs of 10 (s), 13 (ms), 16 (µs) or 19 (ns) digits.
  const EPOCH_RE = /\b\d{10}(?:\d{3}){0,3}\b/g;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);

  let observer = null;
  let hour12 = false; // default 24h; synced with the popup's 24h/AM-PM slider
  let pageHighlight = true;
  let allowed = true;

  // Only accept values that land between 2000-01-01 and 2100-01-01 —
  // keeps phone numbers, IDs, etc. from lighting up.
  function epochToMs(digits) {
    const v = Number(digits);
    const ms =
      digits.length === 10 ? v * 1000 :
      digits.length === 13 ? v :
      digits.length === 16 ? v / 1000 :
      v / 1e6;
    return ms >= 946684800000 && ms < 4102444800000 ? ms : null;
  }

  // Does the current page's host match any allowed domain?
  // "example.com" matches exactly; "*.example.com" also matches subdomains.
  function hostAllowed(domains) {
    const host = location.hostname.toLowerCase();
    return domains.some((d) =>
      d.startsWith("*.")
        ? host === d.slice(2) || host.endsWith(d.slice(1))
        : host === d
    );
  }

  // ---------- scanning & wrapping ----------

  const DIGIT_RUN_RE = /\d{10}/;
  // Self-or-ancestor contexts we never scan inside. Checked once per scan root
  // (not per text node) — subtrees are rejected at the element level below.
  const ROOT_SKIP = `.${SPAN_CLASS}, [contenteditable], ` +
    [...SKIP_TAGS].map((t) => t.toLowerCase()).join(", ");

  // Nodes this script created — the MutationObserver must never rescan them.
  const ownNodes = new WeakSet();

  function processTextNode(node) {
    const text = node.nodeValue;
    EPOCH_RE.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = EPOCH_RE.exec(text))) {
      const ms = epochToMs(m[0]);
      if (ms === null) continue;
      frag ??= document.createDocumentFragment();
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement("span");
      span.className = SPAN_CLASS;
      span.dataset.ms = String(ms);
      span.textContent = m[0];
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (frag) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      for (const n of frag.childNodes) ownNodes.add(n);
      node.replaceWith(frag);
    }
  }

  // Collect candidate text nodes under root into out. Skip-list subtrees are
  // rejected wholesale at the element level, so text nodes need only a regex test.
  function collect(root, out) {
    if (root.nodeType === Node.TEXT_NODE) {
      const p = root.parentElement;
      if (p && !p.closest(ROOT_SKIP) && DIGIT_RUN_RE.test(root.nodeValue)) out.push(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(ROOT_SKIP)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.nodeType === Node.ELEMENT_NODE
          ? (SKIP_TAGS.has(n.tagName) || n.classList.contains(SPAN_CLASS) || n.hasAttribute("contenteditable")
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_SKIP)
          : (DIGIT_RUN_RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    while (walker.nextNode()) out.push(walker.currentNode);
  }

  // ---------- work queue (time-sliced so big pages never jank) ----------

  const pendingRoots = new Set();
  const workQueue = [];
  let drainScheduled = false;

  function queueScan(node) {
    if (ownNodes.has(node)) return;
    pendingRoots.add(node);
    scheduleDrain();
  }

  function scheduleDrain() {
    if (drainScheduled) return;
    drainScheduled = true;
    (window.requestIdleCallback || setTimeout)(drain, { timeout: 500 });
  }

  function drain() {
    drainScheduled = false;
    if (!observer) {
      pendingRoots.clear();
      workQueue.length = 0;
      return;
    }
    if (pendingRoots.size) {
      const roots = [...pendingRoots];
      pendingRoots.clear();
      for (const r of roots) if (r.isConnected) collect(r, workQueue);
    }
    // Wrap for at most ~10ms per slice, then yield back to the page.
    const start = performance.now();
    let i = 0;
    while (i < workQueue.length) {
      const n = workQueue[i++];
      if (n.isConnected) processTextNode(n);
      if (performance.now() - start > 10) break;
    }
    workQueue.splice(0, i);
    if (workQueue.length || pendingRoots.size) scheduleDrain();
  }

  // ---------- tooltip ----------

  let tipHost = null;
  let tipBox = null;
  let hideTimer = null;

  function ensureTip() {
    if (tipHost) return;
    tipHost = document.createElement("div");
    const shadow = tipHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .tip {
        position: fixed;
        z-index: 2147483647;
        max-width: 340px;
        background: #161b22;
        color: #e6edf3;
        border: 1px solid #30363d;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,.4);
        font: 12px/1.5 "Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, Menlo, monospace;
        padding: 9px 11px;
        display: none;
      }
      .row { display: flex; gap: 8px; padding: 1px 0; align-items: baseline; }
      .k { flex: 0 0 44px; color: #8b949e; font-size: 11px; }
      .k::after { content: ":"; }
      .v { cursor: pointer; word-break: break-all; }
      .v:hover { color: #58a6ff; }
      .note { margin-top: 6px; font-size: 10px; color: #8b949e; }
      .note::before { content: "# "; }
    `;
    tipBox = document.createElement("div");
    tipBox.className = "tip";
    tipBox.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    tipBox.addEventListener("mouseleave", scheduleHide);
    tipBox.addEventListener("click", (e) => {
      const v = e.target.closest(".v");
      if (!v) return;
      navigator.clipboard.writeText(v.textContent);
      v.style.opacity = "0.4";
      setTimeout(() => (v.style.opacity = ""), 300);
    });
    shadow.append(style, tipBox);
    document.documentElement.appendChild(tipHost);
  }

  function relative(ms) {
    const diff = ms - Date.now();
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const steps = [
      [1000, "second", 60], [60000, "minute", 60], [3600000, "hour", 24],
      [86400000, "day", 30], [2592000000, "month", 12], [31536000000, "year", Infinity],
    ];
    const [unitMs, unit] = steps.find(([u, , span]) => Math.abs(diff) < u * span);
    return rtf.format(Math.round(diff / unitMs), unit);
  }

  function showTip(span) {
    ensureTip();
    clearTimeout(hideTimer);
    const ms = Number(span.dataset.ms);
    const date = new Date(ms);
    const timeOpts = { dateStyle: "medium", timeStyle: "medium", hour12 };
    const rows = [
      ["local", date.toLocaleString(undefined, timeOpts)],
      ["utc", date.toLocaleString(undefined, { ...timeOpts, timeZone: "UTC" }) + " UTC"],
      ["iso", date.toISOString()],
      ["rel", relative(ms)],
    ];
    tipBox.replaceChildren(
      ...rows.map(([k, v]) => {
        const row = document.createElement("div");
        row.className = "row";
        const kEl = document.createElement("span");
        kEl.className = "k";
        kEl.textContent = k;
        const vEl = document.createElement("span");
        vEl.className = "v";
        vEl.title = "Click to copy";
        vEl.textContent = v;
        row.append(kEl, vEl);
        return row;
      })
    );
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = "Click a value to copy";
    tipBox.appendChild(note);

    tipBox.style.display = "block";
    const rect = span.getBoundingClientRect();
    const tw = tipBox.offsetWidth, th = tipBox.offsetHeight;
    let x = Math.min(Math.max(8, rect.left), innerWidth - tw - 8);
    let y = rect.bottom + 6;
    if (y + th > innerHeight - 8) y = Math.max(8, rect.top - th - 6);
    tipBox.style.left = `${x}px`;
    tipBox.style.top = `${y}px`;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (tipBox) tipBox.style.display = "none";
    }, 250);
  }

  // ---------- enable / disable ----------

  function onOver(e) {
    const span = e.target.closest?.(`.${SPAN_CLASS}`);
    if (span) showTip(span);
  }
  function onOut(e) {
    if (e.target.closest?.(`.${SPAN_CLASS}`)) scheduleHide();
  }

  function init() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) queueScan(n);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    queueScan(document.body);
    drain(); // run the first slice now so marks appear without waiting for idle
  }

  function teardown() {
    observer?.disconnect();
    observer = null;
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("mouseout", onOut, true);
    pendingRoots.clear();
    workQueue.length = 0;
    document.querySelectorAll(`.${SPAN_CLASS}`).forEach((s) =>
      s.replaceWith(document.createTextNode(s.textContent))
    );
    tipHost?.remove();
    tipHost = tipBox = null;
  }

  function apply() {
    pageHighlight && allowed ? init() : teardown();
  }

  chrome.storage.sync.get({ pageHighlight: true, hour12: false, domains: ["localhost"] }).then((stored) => {
    hour12 = stored.hour12;
    pageHighlight = stored.pageHighlight;
    allowed = hostAllowed(stored.domains);
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.hour12) hour12 = changes.hour12.newValue;
    if (changes.pageHighlight) pageHighlight = changes.pageHighlight.newValue;
    if (changes.domains) allowed = hostAllowed(changes.domains.newValue ?? []);
    if (changes.pageHighlight || changes.domains) apply();
  });
}
