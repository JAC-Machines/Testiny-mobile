const DEFAULT_BASE = "https://app.testiny.io/api/v1";
const STATUSES = ["PASSED", "FAILED", "BLOCKED", "SKIPPED"];
const STATUS_LABEL = { PASSED: "Passed", FAILED: "Failed", BLOCKED: "Blocked", SKIPPED: "Skipped", NOTRUN: "Not run" };
const MAX_PHOTO_PX = 1600;
const JPEG_QUALITY = 0.8;

const $view = document.getElementById("view");
const $title = document.getElementById("title");
const $back = document.getElementById("back");
const $toast = document.getElementById("toast");

const cfg = {
  get key() { return read("tr.key"); },
  set key(v) { write("tr.key", v); },
  get base() { return read("tr.base") || DEFAULT_BASE; },
  set base(v) { write("tr.base", v); },
  get project() { return read("tr.project"); },
  set project(v) { write("tr.project", v); },
};

function read(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }
function write(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} }

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
    throw new ApiError(0, "Couldn’t reach Testiny. This is usually a CORS block or no network.");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.message || msg; } catch {}
    throw new ApiError(res.status, msg || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const T = {
  projects: () => api("/project"),
  runs: (projectId) => api("/testrun/find", {
    json: { filter: { project_id: +projectId }, order: [{ column: "id", order: "desc" }], pagination: { limit: 200 } },
  }),
  run: (id) => api(`/testrun/${id}`),
  runCases: (projectId, runId) => api("/testcase/find", {
    json: {
      filter: { project_id: +projectId },
      map: [{ entities: ["testcase", "testrun"], filter: { testrun_id: +runId } }],
      pagination: { limit: 1000 },
    },
  }),
  caseInRun: (projectId, runId, caseId) => api("/testcase/find", {
    json: {
      filter: { project_id: +projectId },
      id: +caseId,
      omitLargeValues: false,
      map: [{ entities: ["testcase", "testrun"], filter: { testrun_id: +runId } }],
    },
  }),
  setStatus: (runId, caseId, status) => api("/testrun/mapping/bulk/testcase:testrun?op=update", {
    json: [{ ids: { testcase_id: +caseId, testrun_id: +runId }, mapped: { result_status: status } }],
  }),
  addComment: async (projectId, runId, caseId, text) => {
    const created = await api("/comment/bulk", { json: [{ project_id: +projectId, type: "TEXT", text }] });
    const commentId = created?.[0]?.id;
    if (!commentId) throw new ApiError(0, "Comment created but no id returned.");
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

function resultOf(tc) { return tc.testrun_testcase_values?.result_status || "NOTRUN"; }

function errorBox(e) {
  const hint = e.status === 401 || e.status === 403
    ? "Check that the API key is valid and has at least Editor permissions."
    : e.status === 0 ? "If this happens on every request, the API probably blocks browser requests. See the README for the proxy setup." : "";
  return `<div class="notice error"><strong>${esc(e.message)}</strong>${hint ? `<br><span class="muted">${esc(hint)}</span>` : ""}</div>`;
}

function loading() { $view.innerHTML = `<p class="empty">Loading…</p>`; }

async function viewSettings() {
  setHeader("Settings", cfg.key && cfg.project ? "#/runs" : null);
  $view.className = "";
  $view.innerHTML = `
    <h2>Connect to Testiny</h2>
    <p class="muted">Your API key stays on this device.</p>
    <div id="msg"></div>
    <label class="field"><span>API key</span>
      <input type="password" id="key" autocomplete="off" value="${esc(cfg.key)}">
      <small>Create one in Testiny under account settings. It needs at least Editor permissions.</small>
    </label>
    <label class="field"><span>API address</span>
      <input type="url" id="base" value="${esc(cfg.base)}">
      <small>Change only if you use a proxy.</small>
    </label>
    <button class="btn block" id="connect">Load projects</button>
    <div id="projects" style="margin-top:20px"></div>`;

  const $msg = $view.querySelector("#msg");
  const $projects = $view.querySelector("#projects");

  async function loadProjects() {
    cfg.key = $view.querySelector("#key").value.trim();
    cfg.base = $view.querySelector("#base").value.trim().replace(/\/+$/, "") || DEFAULT_BASE;
    if (!cfg.key) { $msg.innerHTML = `<div class="notice error">Enter your API key first.</div>`; return; }
    $msg.innerHTML = "";
    $projects.innerHTML = `<p class="muted">Loading projects…</p>`;
    try {
      const res = await T.projects();
      const projects = res.data || [];
      if (!projects.length) { $projects.innerHTML = `<p class="muted">No projects visible with this key.</p>`; return; }
      $projects.innerHTML = `
        <label class="field"><span>Project</span>
          <select id="project">${projects.map((p) => `<option value="${p.id}" ${String(p.id) === cfg.project ? "selected" : ""}>${esc(p.name || p.title || `Project ${p.id}`)}</option>`).join("")}</select>
        </label>
        <button class="btn primary block" id="save">Save and open test runs</button>`;
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
  setHeader("Test runs", null);
  $view.className = "";
  loading();
  try {
    const res = await T.runs(cfg.project);
    const runs = res.data || [];
    const showClosed = read("tr.showClosed") === "1";
    const isClosed = (r) => r.is_closed === true || !!r.closed_at;
    const visible = runs.filter((r) => showClosed || !isClosed(r));
    $view.innerHTML = `
      <label class="toggle"><input type="checkbox" id="closed" ${showClosed ? "checked" : ""}> Show closed runs</label>
      ${visible.length ? `<ul class="list">${visible.map((r) => `
        <li><a href="#/run/${r.id}">
          <span class="grow">
            <span class="name">${esc(r.title)}</span>
            <span class="meta">Run ${r.id}${isClosed(r) ? " (closed)" : ""}</span>
          </span>
        </a></li>`).join("")}</ul>`
        : `<p class="empty">No open test runs in this project. Runs are created in Testiny.</p>`}`;
    $view.querySelector("#closed").onchange = (e) => { write("tr.showClosed", e.target.checked ? "1" : ""); viewRuns(); };
  } catch (e) {
    $view.innerHTML = errorBox(e);
  }
}

async function viewRun(runId) {
  setHeader(`Run ${runId}`, "#/runs");
  $view.className = "";
  loading();
  try {
    const [run, res] = await Promise.all([T.run(runId), T.runCases(cfg.project, runId)]);
    const cases = res.data || [];
    cache.runCases.set(String(runId), cases.map((c) => String(c.id)));
    setHeader(run.title || `Run ${runId}`, "#/runs");

    const counts = cases.reduce((a, c) => { const s = resultOf(c); a[s] = (a[s] || 0) + 1; return a; }, {});
    const done = cases.length - (counts.NOTRUN || 0);
    const bar = STATUSES.map((s) => counts[s] ? `<span class="${s}" style="width:${(counts[s] / cases.length) * 100}%"></span>` : "").join("");

    $view.innerHTML = cases.length ? `
      <p class="muted">${done} of ${cases.length} executed</p>
      <div class="progress" aria-hidden="true">${bar}</div>
      <ul class="list">${cases.map((c) => {
        const s = resultOf(c);
        return `<li><a href="#/case/${runId}/${c.id}">
          <span class="strip ${s}"></span>
          <span class="grow">
            <span class="name">${esc(c.title)}</span>
            <span class="meta">${STATUS_LABEL[s] || s}${c.testrun_testcase_values?.$assignee_name ? `, ${esc(c.testrun_testcase_values.$assignee_name)}` : ""}</span>
          </span>
        </a></li>`;
      }).join("")}</ul>`
      : `<p class="empty">This run has no test cases.</p>`;
  } catch (e) {
    $view.innerHTML = errorBox(e);
  }
}

async function viewCase(runId, caseId) {
  setHeader("Test case", `#/run/${runId}`);
  $view.className = "has-bar";
  loading();
  let tc;
  try {
    const res = await T.caseInRun(cfg.project, runId, caseId);
    tc = res.data?.[0];
    if (!tc) throw new ApiError(404, "Test case not found in this run.");
  } catch (e) {
    $view.className = "";
    $view.innerHTML = errorBox(e);
    return;
  }

  const initial = resultOf(tc);
  const state = { status: initial === "NOTRUN" ? null : initial, photos: [], saving: false };
  const sections = [
    ["Preconditions", richText(tc.precondition_text)],
    ["Steps", richText(tc.steps_text)],
    ["Expected result", richText(tc.expected_result_text)],
  ].filter(([, t]) => t);

  const commentCount = tc.testrun_testcase_values?.$comment_count;

  $view.innerHTML = `
    <h2>${esc(tc.title)}</h2>
    <p class="muted">Case ${tc.id}, currently ${esc(STATUS_LABEL[initial] || initial)}${commentCount ? `, ${commentCount} comment${commentCount > 1 ? "s" : ""}` : ""}</p>
    ${sections.length ? sections.map(([h, t]) => `<div class="section"><h3>${h}</h3><div class="text">${esc(t)}</div></div>`).join("")
      : `<p class="muted">No steps written for this test case.</p>`}
    <div class="section">
      <h3>Comment</h3>
      <textarea id="comment" placeholder="What did you observe?"></textarea>
    </div>
    <div class="section">
      <h3>Photos</h3>
      <div class="photos" id="photos"></div>
      <input type="file" id="file" accept="image/*" multiple hidden>
    </div>
    <div class="bar"><div class="bar-inner">
      <div class="statuses" role="group" aria-label="Result">
        ${STATUSES.map((s) => `<button class="status ${s}" data-s="${s}" aria-pressed="${state.status === s}">${STATUS_LABEL[s]}</button>`).join("")}
      </div>
      <div class="actions">
        <button class="btn" id="save">Save</button>
        <button class="btn primary" id="next">Save and next</button>
      </div>
    </div></div>`;

  const $photos = $view.querySelector("#photos");
  const $file = $view.querySelector("#file");
  const $comment = $view.querySelector("#comment");

  function renderPhotos() {
    $photos.innerHTML = state.photos.map((p, i) => `
      <div class="photo"><img src="${p.url}" alt="Photo ${i + 1}"><button data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("")
      + `<button class="add-photo" id="add">Add photo</button>`;
    $photos.querySelector("#add").onclick = () => $file.click();
    $photos.querySelectorAll(".photo button").forEach((b) => b.onclick = () => {
      const [p] = state.photos.splice(+b.dataset.i, 1);
      URL.revokeObjectURL(p.url);
      renderPhotos();
    });
  }
  renderPhotos();

  $file.onchange = async () => {
    for (const f of $file.files) {
      try {
        const blob = await downscale(f);
        state.photos.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        toast("Couldn’t read one of the images.");
      }
    }
    $file.value = "";
    renderPhotos();
  };

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
      toast("Nothing to save. Pick a result, write a comment or add a photo.");
      return;
    }
    state.saving = true;
    $save.disabled = $next.disabled = true;
    try {
      if (statusChanged) { toast("Saving result…", 10000); await T.setStatus(runId, caseId, state.status); }
      if (comment) { toast("Saving comment…", 10000); await T.addComment(cfg.project, runId, caseId, comment); }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      for (let i = 0; i < state.photos.length; i++) {
        toast(`Uploading photo ${i + 1} of ${state.photos.length}…`, 30000);
        await T.upload(runId, caseId, state.photos[i].blob, `photo-${stamp}-${i + 1}.jpg`);
      }
      state.photos.forEach((p) => URL.revokeObjectURL(p.url));
      toast("Saved");
      if (goNext) gotoNext(runId, caseId);
      else location.hash = `#/run/${runId}`;
    } catch (e) {
      toast(`Save failed: ${e.message}`, 6000);
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
  const next = ids[ids.indexOf(String(caseId)) + 1];
  location.hash = next ? `#/case/${runId}/${next}` : `#/run/${runId}`;
  if (!next) toast("That was the last test case in this run.");
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

document.getElementById("settings").onclick = () => { location.hash = "#/settings"; };
window.addEventListener("hashchange", route);
route();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
