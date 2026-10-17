import { LANGS, DICT } from "./i18n.js";

const DEFAULT_BASE = "https://app.testiny.io/api/v1";
const STATUSES = ["PASSED", "FAILED", "BLOCKED", "SKIPPED"];
const TEXT_FIELDS = [
  ["precondition_text", "preconditions"],
  ["content_text", "steps"],
  ["steps_text", "steps"],
  ["expected_result_text", "expected"],
];
const MAX_PHOTO_PX = 1600;
const JPEG_QUALITY = 0.8;

const $view = document.getElementById("view");
const $title = document.getElementById("title");
const $back = document.getElementById("back");
const $settings = document.getElementById("settings");
const $lang = document.getElementById("lang");
const $langCode = document.getElementById("langCode");
const $toast = document.getElementById("toast");

function read(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }
function write(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} }

const cfg = {
  get key() { return read("tr.key"); },
  set key(v) { write("tr.key", v); },
  get base() { return read("tr.base") || DEFAULT_BASE; },
  set base(v) { write("tr.base", v); },
  get project() { return read("tr.project"); },
  set project(v) { write("tr.project", v); },
};

function detectLang() {
  const saved = read("tr.lang");
  if (DICT[saved]) return saved;
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const code = l.slice(0, 2).toLowerCase();
    if (DICT[code]) return code;
  }
  return "en";
}

let lang = detectLang();

function t(key, vars = {}) {
  const s = DICT[lang][key] ?? DICT.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function applyChrome() {
  document.documentElement.lang = lang;
  $langCode.textContent = lang.toUpperCase();
  $lang.value = lang;
  $lang.setAttribute("aria-label", t("language"));
  $back.setAttribute("aria-label", t("back"));
  $settings.setAttribute("aria-label", t("settings"));
}

$lang.innerHTML = Object.entries(LANGS).map(([c, n]) => `<option value="${c}">${n}</option>`).join("");
$lang.onchange = () => {
  lang = $lang.value;
  write("tr.lang", lang);
  applyChrome();
  route();
};

const cache = { runCases: new Map() };

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(path, { method, json, blob, contentType } = {}) {
  const headers = { "X-Api-Key": cfg.key };
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (blob) { headers["Content-Type"] = contentType || blob.type; body = blob; }
  let res;
  try {
    res = await fetch(cfg.base + path, { method: method || (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError(0, t("errUnreachable"));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.message || msg; } catch {}
    throw new ApiError(res.status, msg || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const runMap = (runId) => [{ entities: ["testcase", "testrun"], filter: { testrun_id: +runId } }];

const T = {
  projects: () => api("/project"),
  runs: (projectId) => api("/testrun/find", {
    json: { filter: { project_id: +projectId }, order: [{ column: "id", order: "desc" }], pagination: { limit: 200 } },
  }),
  run: (id) => api(`/testrun/${id}`),
  runCases: (projectId, runId) => api("/testcase/find", {
    json: { filter: { project_id: +projectId }, map: runMap(runId), pagination: { limit: 1000 } },
  }),
  caseInRun: (projectId, runId, caseId) => api("/testcase/find", {
    json: { filter: { project_id: +projectId }, id: +caseId, omitLargeValues: false, map: runMap(runId) },
  }),
  setStatus: (runId, caseId, status) => api("/testrun/mapping/bulk/testcase:testrun?op=update", {
    json: [{ ids: { testcase_id: +caseId, testrun_id: +runId }, mapped: { result_status: status } }],
  }),
  addComment: async (projectId, runId, caseId, text) => {
    const created = await api("/comment/bulk", { json: [{ project_id: +projectId, type: "TEXT", text }] });
    const commentId = created?.[0]?.id;
    if (!commentId) throw new ApiError(0, t("errNoCommentId"));
    await api("/comment/mapping/bulk/comment:testcase:testrun?op=add", {
      json: [{ ids: { comment_id: commentId, testcase_id: +caseId, testrun_id: +runId } }],
    });
  },
  upload: (runId, caseId, blob, filename) => {
    const q = new URLSearchParams({ title: filename, filename, mime_type: blob.type });
    return api(`/testrun/upload-attachment/${runId}/${caseId}?${q}`, { blob });
  },
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg, ms = 2500) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove("show"), ms);
}

function setHeader(title, backHash) {
  $title.textContent = title;
  $back.hidden = !backHash;
  $back.onclick = backHash ? () => { location.hash = backHash; } : null;
}

function richText(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try { return walk(JSON.parse(s)).replace(/\n{3,}/g, "\n\n").trim(); } catch {}
    }
    return s.replace(/^<!--\s*markdown\s*-->\s*/i, "");
  }
  return walk(v).trim();
}

function walk(n) {
  if (n == null) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(walk).join("");
  if (typeof n.text === "string") return n.text;
  const kids = n.content ?? n.children ?? n.nodes;
  if (!kids) return Object.values(n).filter((x) => typeof x === "object").map(walk).join("\n");
  const block = /paragraph|heading|list|item|step|row|block/i.test(n.type || "");
  return walk(kids) + (block ? "\n" : "");
}

function caseSections(tc) {
  const seen = new Set();
  const out = [];
  for (const [k, label] of TEXT_FIELDS) {
    seen.add(k);
    const txt = richText(tc[k]);
    if (txt) out.push([t(label), txt]);
  }
  for (const [k, v] of Object.entries(tc)) {
    if (seen.has(k) || k.startsWith("$") || k.startsWith("_") || !v) continue;
    if (/(_text|scenarios|steps)$/i.test(k)) {
      const txt = richText(v);
      if (txt) out.push([k, txt]);
    }
  }
  return out;
}

function resultOf(tc) { return tc.testrun_testcase_values?.result_status || "NOTRUN"; }

function errorBox(e) {
  const hint = e.status === 401 || e.status === 403 ? t("hintAuth") : e.status === 0 ? t("hintNetwork") : "";
  return `<div class="notice error"><strong>${esc(e.message)}</strong>${hint ? `<br><span class="muted">${esc(hint)}</span>` : ""}</div>`;
}

function loading() { $view.innerHTML = `<p class="empty">${t("loading")}</p>`; }

async function viewSettings() {
  setHeader(t("settings"), cfg.key && cfg.project ? "#/runs" : null);
  $view.className = "";
  $view.innerHTML = `
    <h2>${t("connectTitle")}</h2>
    <p class="muted">${t("keyStays")}</p>
    <div id="msg"></div>
    <label class="field"><span>${t("apiKey")}</span>
      <input type="password" id="key" autocomplete="off" value="${esc(cfg.key)}">
      <small>${t("apiKeyHelp")}</small>
    </label>
    <label class="field"><span>${t("apiAddress")}</span>
      <input type="url" id="base" value="${esc(cfg.base)}">
      <small>${t("apiAddressHelp")}</small>
    </label>
    <button class="btn block" id="connect">${t("loadProjects")}</button>
    <div id="projects" style="margin-top:20px"></div>`;

  const $msg = $view.querySelector("#msg");
  const $projects = $view.querySelector("#projects");

  async function loadProjects() {
    cfg.key = $view.querySelector("#key").value.trim();
    cfg.base = $view.querySelector("#base").value.trim().replace(/\/+$/, "") || DEFAULT_BASE;
    if (!cfg.key) { $msg.innerHTML = `<div class="notice error">${t("enterKeyFirst")}</div>`; return; }
    $msg.innerHTML = "";
    $projects.innerHTML = `<p class="muted">${t("loadingProjects")}</p>`;
    try {
      const projects = (await T.projects()).data || [];
      if (!projects.length) { $projects.innerHTML = `<p class="muted">${t("noProjects")}</p>`; return; }
      $projects.innerHTML = `
        <label class="field"><span>${t("project")}</span>
          <select id="project">${projects.map((p) => `<option value="${p.id}" ${String(p.id) === cfg.project ? "selected" : ""}>${esc(p.name || p.title || t("projectN", { id: p.id }))}</option>`).join("")}</select>
        </label>
        <button class="btn primary block" id="save">${t("saveOpenRuns")}</button>`;
      $projects.querySelector("#save").onclick = () => {
        cfg.project = $projects.querySelector("#project").value;
        location.hash = "#/runs";
      };
    } catch (e) {
      $projects.innerHTML = "";
      $msg.innerHTML = errorBox(e);
    }
  }

  $view.querySelector("#connect").onclick = loadProjects;
  if (cfg.key) loadProjects();
}

async function viewRuns() {
  setHeader(t("runsTitle"), null);
  $view.className = "";
  loading();
  try {
    const runs = (await T.runs(cfg.project)).data || [];
    const showClosed = read("tr.showClosed") === "1";
    const isClosed = (r) => r.is_closed === true || !!r.closed_at;
    const visible = runs.filter((r) => showClosed || !isClosed(r));
    $view.innerHTML = `
      <label class="toggle"><input type="checkbox" id="closed" ${showClosed ? "checked" : ""}> ${t("showClosed")}</label>
      ${visible.length ? `<ul class="list">${visible.map((r) => `
        <li><a href="#/run/${r.id}">
          <span class="grow">
            <span class="name">${esc(r.title)}</span>
            <span class="meta">${t("runN", { id: r.id })}${isClosed(r) ? ` (${t("closed")})` : ""}</span>
          </span>
        </a></li>`).join("")}</ul>`
        : `<p class="empty">${t("noRuns")}</p>`}`;
    $view.querySelector("#closed").onchange = (e) => { write("tr.showClosed", e.target.checked ? "1" : ""); viewRuns(); };
  } catch (e) {
    $view.innerHTML = errorBox(e);
  }
}

async function viewRun(runId) {
  setHeader(t("runN", { id: runId }), "#/runs");
  $view.className = "";
  loading();
  let run, cases;
  try {
    const [r, res] = await Promise.all([T.run(runId), T.runCases(cfg.project, runId)]);
    run = r;
    cases = res.data || [];
  } catch (e) {
    $view.innerHTML = errorBox(e);
    return;
  }
  setHeader(run.title || t("runN", { id: runId }), "#/runs");

  if (!cases.length) {
    cache.runCases.set(String(runId), []);
    $view.innerHTML = `<p class="empty">${t("noCases")}</p>`;
    return;
  }

  const assigneeOf = (c) => c.testrun_testcase_values?.$assignee_name || "";
  const counts = cases.reduce((a, c) => { const s = resultOf(c); a[s] = (a[s] || 0) + 1; return a; }, {});
  const done = cases.length - (counts.NOTRUN || 0);
  const bar = STATUSES.map((s) => counts[s] ? `<span class="${s}" style="width:${(counts[s] / cases.length) * 100}%"></span>` : "").join("");
  const assignees = [...new Set(cases.map(assigneeOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  let fStatus = read("tr.fStatus") || "ALL";
  let fAssignee = read("tr.fAssignee");
  if (fStatus !== "ALL" && !counts[fStatus]) fStatus = "ALL";
  if (fAssignee && fAssignee !== "__none" && !assignees.includes(fAssignee)) fAssignee = "";

  $view.innerHTML = `
    <p class="muted">${t("executed", { done, total: cases.length })}</p>
    <div class="progress" aria-hidden="true">${bar}</div>
    <div class="chips" id="chips" role="group" aria-label="${esc(t("filterStatus"))}"></div>
    ${assignees.length ? `
      <label class="assignee"><span>${t("assignedTo")}</span>
        <select id="assignee">
          <option value="">${t("everyone")}</option>
          ${assignees.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}
          <option value="__none">${t("unassigned")}</option>
        </select>
      </label>` : ""}
    <div id="cases"></div>`;

  const $chips = $view.querySelector("#chips");
  const $cases = $view.querySelector("#cases");
  const $assignee = $view.querySelector("#assignee");
  if ($assignee) $assignee.value = fAssignee;

  function render() {
    const byAssignee = cases.filter((c) => !fAssignee || (fAssignee === "__none" ? !assigneeOf(c) : assigneeOf(c) === fAssignee));
    const sub = byAssignee.reduce((a, c) => { const s = resultOf(c); a[s] = (a[s] || 0) + 1; return a; }, {});
    const visible = byAssignee.filter((c) => fStatus === "ALL" || resultOf(c) === fStatus);
    cache.runCases.set(String(runId), visible.map((c) => String(c.id)));

    $chips.innerHTML = ["ALL", "NOTRUN", "FAILED", "BLOCKED", "SKIPPED", "PASSED"]
      .filter((s) => s === "ALL" || sub[s] || s === fStatus)
      .map((s) => `<button class="chip" data-s="${s}" aria-pressed="${s === fStatus}">
        ${s === "ALL" ? "" : `<span class="dot ${s}"></span>`}${s === "ALL" ? t("all") : t(s)}
        <span class="n">${s === "ALL" ? byAssignee.length : sub[s] || 0}</span></button>`).join("");
    $chips.querySelectorAll(".chip").forEach((b) => b.onclick = () => {
      fStatus = b.dataset.s;
      write("tr.fStatus", fStatus === "ALL" ? "" : fStatus);
      render();
    });

    $cases.innerHTML = visible.length ? `<ul class="list">${visible.map((c) => {
      const s = resultOf(c);
      const who = assigneeOf(c);
      return `<li><a href="#/case/${runId}/${c.id}">
        <span class="strip ${s}"></span>
        <span class="grow">
          <span class="name">${esc(c.title)}</span>
          <span class="meta">${t(s)}${who ? `, ${esc(who)}` : ""}</span>
        </span>
      </a></li>`;
    }).join("")}</ul>` : `<p class="empty">${t("noMatch")}</p>`;
  }

  if ($assignee) $assignee.onchange = () => {
    fAssignee = $assignee.value;
    write("tr.fAssignee", fAssignee);
    render();
  };
  render();
}

async function viewCase(runId, caseId) {
  setHeader(t("caseTitle"), `#/run/${runId}`);
  $view.className = "has-bar";
  loading();
  let tc;
  try {
    tc = (await T.caseInRun(cfg.project, runId, caseId)).data?.[0];
    if (!tc) throw new ApiError(404, t("caseNotFound"));
  } catch (e) {
    $view.className = "";
    $view.innerHTML = errorBox(e);
    return;
  }

  const initial = resultOf(tc);
  const state = { status: initial === "NOTRUN" ? null : initial, photos: [], saving: false };
  const sections = caseSections(tc);
  const nComments = tc.testrun_testcase_values?.$comment_count;
  const commentsInfo = nComments ? `, ${t(nComments > 1 ? "commentMany" : "commentOne", { n: nComments })}` : "";

  $view.innerHTML = `
    <h2>${esc(tc.title)}</h2>
    <p class="muted">${t("caseMeta", { id: tc.id, status: t(initial) })}${commentsInfo}</p>
    ${sections.length ? sections.map(([h, txt]) => `<div class="section"><h3>${esc(h)}</h3><div class="text">${esc(txt)}</div></div>`).join("")
      : `<p class="muted">${t("noSteps")}</p>`}
    <details class="raw"><summary>${t("rawData")}</summary><pre>${esc(JSON.stringify(tc, null, 2))}</pre></details>
    <div class="section">
      <h3>${t("comment")}</h3>
      <textarea id="comment" placeholder="${esc(t("commentPlaceholder"))}"></textarea>
    </div>
    <div class="section">
      <h3>${t("photos")}</h3>
      <div class="photo-actions">
        <button class="btn" id="cam">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          ${t("takePhoto")}
        </button>
        <button class="btn" id="gal">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16l5-5 5 5 3-3 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          ${t("fromGallery")}
        </button>
      </div>
      <div class="photos" id="photos"></div>
      <input type="file" id="camInput" accept="image/*" capture="environment" hidden>
      <input type="file" id="galInput" accept="image/*" multiple hidden>
    </div>
    <div class="bar"><div class="bar-inner">
      <div class="statuses" role="group" aria-label="${esc(t("result"))}">
        ${STATUSES.map((s) => `<button class="status ${s}" data-s="${s}" aria-pressed="${state.status === s}">${t(s)}</button>`).join("")}
      </div>
      <div class="actions">
        <button class="btn" id="save">${t("validate")}</button>
        <button class="btn primary" id="next">${t("validateNext")}</button>
      </div>
    </div></div>`;

  const $photos = $view.querySelector("#photos");
  const $camInput = $view.querySelector("#camInput");
  const $galInput = $view.querySelector("#galInput");
  const $comment = $view.querySelector("#comment");

  function renderPhotos() {
    $photos.innerHTML = state.photos.map((p, i) => `
      <div class="photo"><img src="${p.url}" alt="Photo ${i + 1}"><button data-i="${i}" aria-label="${esc(t("removePhoto", { n: i + 1 }))}">×</button></div>`).join("");
    $photos.querySelectorAll(".photo button").forEach((b) => b.onclick = () => {
      const [p] = state.photos.splice(+b.dataset.i, 1);
      URL.revokeObjectURL(p.url);
      renderPhotos();
    });
  }
  renderPhotos();

  async function addFiles(input) {
    for (const f of input.files) {
      try {
        const blob = await downscale(f);
        state.photos.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        toast(t("imgReadError"));
      }
    }
    input.value = "";
    renderPhotos();
  }

  $view.querySelector("#cam").onclick = () => $camInput.click();
  $view.querySelector("#gal").onclick = () => $galInput.click();
  $camInput.onchange = () => addFiles($camInput);
  $galInput.onchange = () => addFiles($galInput);

  $view.querySelectorAll(".status").forEach((b) => b.onclick = () => {
    state.status = state.status === b.dataset.s ? null : b.dataset.s;
    $view.querySelectorAll(".status").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.s === state.status)));
  });

  const $save = $view.querySelector("#save");
  const $next = $view.querySelector("#next");

  async function save(goNext) {
    if (state.saving) return;
    const comment = $comment.value.trim();
    const statusChanged = state.status && state.status !== initial;
    if (!statusChanged && !comment && !state.photos.length) {
      if (goNext) return gotoNext(runId, caseId);
      toast(t("nothingToSave"));
      return;
    }
    state.saving = true;
    $save.disabled = $next.disabled = true;
    try {
      if (statusChanged) { toast(t("savingResult"), 10000); await T.setStatus(runId, caseId, state.status); }
      if (comment) { toast(t("savingComment"), 10000); await T.addComment(cfg.project, runId, caseId, comment); }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      for (let i = 0; i < state.photos.length; i++) {
        toast(t("uploadingPhoto", { i: i + 1, n: state.photos.length }), 30000);
        await T.upload(runId, caseId, state.photos[i].blob, `photo-${stamp}-${i + 1}.jpg`);
      }
      state.photos.forEach((p) => URL.revokeObjectURL(p.url));
      toast(t("saved"));
      if (goNext) gotoNext(runId, caseId);
      else location.hash = `#/run/${runId}`;
    } catch (e) {
      toast(t("saveFailed", { msg: e.message }), 6000);
      state.saving = false;
      $save.disabled = $next.disabled = false;
    }
  }

  $save.onclick = () => save(false);
  $next.onclick = () => save(true);
}

async function gotoNext(runId, caseId) {
  let ids = cache.runCases.get(String(runId));
  if (!ids) {
    try { ids = ((await T.runCases(cfg.project, runId)).data || []).map((c) => String(c.id)); } catch { ids = []; }
  }
  const idx = ids.indexOf(String(caseId));
  const next = idx >= 0 ? ids[idx + 1] : undefined;
  location.hash = next ? `#/case/${runId}/${next}` : `#/run/${runId}`;
  if (!next) toast(t("lastCase"));
}

async function downscale(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_PHOTO_PX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("encode")), "image/jpeg", JPEG_QUALITY));
}

function route() {
  window.scrollTo(0, 0);
  if (!cfg.key || !cfg.project) return viewSettings();
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  switch (parts[0]) {
    case "settings": return viewSettings();
    case "run": return viewRun(parts[1]);
    case "case": return viewCase(parts[1], parts[2]);
    default: return viewRuns();
  }
}

$settings.onclick = () => { location.hash = "#/settings"; };
window.addEventListener("hashchange", route);
applyChrome();
route();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
