const $ = (id) => document.getElementById(id);

// ---------- 24h / AM-PM format ----------

let hour12 = false; // default: 24h

function updateFmtLabels() {
  $("fmt-24h").classList.toggle("active", !hour12);
  $("fmt-ampm").classList.toggle("active", hour12);
}

chrome.storage.sync.get({ hour12: false }).then((stored) => {
  hour12 = stored.hour12;
  $("hour12-toggle").checked = hour12;
  updateFmtLabels();
  convertEpoch();
});

$("hour12-toggle").addEventListener("change", (e) => {
  hour12 = e.target.checked;
  chrome.storage.sync.set({ hour12 });
  updateFmtLabels();
  convertEpoch();
});

// ---------- current-epoch ticker ----------

const ticker = $("now-ticker");

function updateTicker() {
  ticker.textContent = String(Math.floor(Date.now() / 1000));
}
updateTicker();
setInterval(updateTicker, 1000);

ticker.addEventListener("click", async () => {
  await navigator.clipboard.writeText(ticker.textContent);
  flash(ticker);
});

// ---------- epoch → date ----------

const UNITS = [
  { name: "seconds", factor: 1000, max: 1e11 },
  { name: "milliseconds", factor: 1, max: 1e14 },
  { name: "microseconds", factor: 1 / 1000, max: 1e17 },
  { name: "nanoseconds", factor: 1 / 1e6, max: Infinity },
];

function detectUnit(value) {
  const abs = Math.abs(value);
  return UNITS.find((u) => abs < u.max);
}

function formatRelative(ms) {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const steps = [
    [1000, "second", 60],
    [60000, "minute", 60],
    [3600000, "hour", 24],
    [86400000, "day", 30],
    [2592000000, "month", 12],
    [31536000000, "year", Infinity],
  ];
  for (const [unitMs, unit, span] of steps) {
    if (abs < unitMs * span) return rtf.format(Math.round(diff / unitMs), unit);
  }
}

function convertEpoch() {
  const raw = $("epoch-input").value.trim().replace(/[,\s_]/g, "");
  const error = $("epoch-error");
  const results = $("epoch-results");
  const hint = $("epoch-unit");

  error.classList.add("hidden");
  results.classList.add("hidden");
  hint.textContent = "";

  if (!raw) return;

  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    error.textContent = "Not a number.";
    error.classList.remove("hidden");
    return;
  }

  const value = Number(raw);
  const unit = detectUnit(value);
  const ms = value * unit.factor;
  const date = new Date(ms);

  if (isNaN(date.getTime())) {
    error.textContent = "Timestamp out of range.";
    error.classList.remove("hidden");
    return;
  }

  hint.textContent = `Interpreted as ${unit.name}`;
  $("res-local").textContent = date.toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "medium",
    hour12,
  });
  $("res-utc").textContent =
    date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "UTC",
      hour12,
    }) + " UTC";
  $("res-iso").textContent = date.toISOString();
  $("res-relative").textContent = formatRelative(ms);
  results.classList.remove("hidden");
}

$("epoch-input").addEventListener("input", convertEpoch);

$("epoch-now").addEventListener("click", () => {
  $("epoch-input").value = String(Math.floor(Date.now() / 1000));
  convertEpoch();
});

// ---------- date → epoch ----------

function pad(n) {
  return String(n).padStart(2, "0");
}

function initDateInput() {
  const d = new Date();
  $("date-input").value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function convertDate() {
  const raw = $("date-input").value;
  const asUtc = $("date-tz").value === "utc";
  const error = $("date-error");
  const results = $("date-results");

  error.classList.add("hidden");
  results.classList.add("hidden");

  if (!raw) return;

  const ms = asUtc ? Date.parse(raw + "Z") : new Date(raw).getTime();

  if (isNaN(ms)) {
    error.textContent = "Invalid date.";
    error.classList.remove("hidden");
    return;
  }

  $("res-sec").textContent = String(Math.floor(ms / 1000));
  $("res-ms").textContent = String(ms);
  results.classList.remove("hidden");
}

$("date-input").addEventListener("input", convertDate);
$("date-tz").addEventListener("change", convertDate);

// ---------- copy buttons ----------

function flash(el) {
  el.classList.add("copied");
  setTimeout(() => el.classList.remove("copied"), 800);
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy");
  if (!btn) return;
  await navigator.clipboard.writeText($(btn.dataset.copyTarget).textContent);
  flash(btn);
});

// ---------- marked domains ----------

const DOMAIN_RE = /^(\*\.)?[a-z0-9][a-z0-9.-]*$/;

function normalizeDomain(raw) {
  return raw.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "") // scheme
    .replace(/[/?#].*$/, "")     // path/query
    .replace(/:\d+$/, "");       // port (match patterns cover all ports)
}

async function renderDomains() {
  const { domains } = await chrome.storage.sync.get({ domains: ["localhost"] });
  $("domain-list").replaceChildren(
    ...domains.map((d) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = d;
      const del = document.createElement("button");
      del.className = "domain-del";
      del.title = "Remove";
      del.textContent = "✕";
      del.addEventListener("click", () => removeDomain(d));
      li.append(name, del);
      return li;
    })
  );
}

async function addDomainByName(d) {
  const err = $("domain-error");
  err.classList.add("hidden");
  if (!DOMAIN_RE.test(d)) {
    err.textContent = "Invalid domain.";
    err.classList.remove("hidden");
    return false;
  }
  const { domains } = await chrome.storage.sync.get({ domains: ["localhost"] });
  if (!domains.includes(d)) {
    domains.push(d);
    await chrome.storage.sync.set({ domains });
  }
  renderDomains();
  return true;
}

async function addDomain() {
  if (await addDomainByName(normalizeDomain($("domain-input").value))) {
    $("domain-input").value = "";
  }
}

// Quick-add for the tab the popup was opened on (activeTab exposes its URL).
async function initQuickAdd() {
  const btn = $("domain-current");
  let host = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const u = new URL(tab?.url ?? "");
    if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname.toLowerCase();
  } catch {
    return; // no readable URL (chrome:// page, web store, etc.)
  }
  if (!host || !DOMAIN_RE.test(host)) return;

  const refresh = async () => {
    const { domains } = await chrome.storage.sync.get({ domains: ["localhost"] });
    btn.classList.toggle("hidden", domains.includes(host));
  };
  btn.textContent = `+ add ${host} (this tab)`;
  btn.addEventListener("click", () => addDomainByName(host));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.domains) refresh();
  });
  refresh();
}
initQuickAdd();

async function removeDomain(d) {
  const { domains } = await chrome.storage.sync.get({ domains: ["localhost"] });
  await chrome.storage.sync.set({ domains: domains.filter((x) => x !== d) });
  renderDomains();
}

$("domain-add").addEventListener("click", addDomain);
$("domain-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addDomain();
});
renderDomains();

// ---------- page-highlight toggle ----------

const toggle = $("highlight-toggle");
chrome.storage.sync.get({ pageHighlight: true }).then(({ pageHighlight }) => {
  toggle.checked = pageHighlight;
});
toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ pageHighlight: toggle.checked });
});

// ---------- init ----------

chrome.action.setBadgeText({ text: "" }); // clear the first-run badge
initDateInput();
convertDate();
