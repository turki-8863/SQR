(function () { "use strict"; const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]); const API = (() => { if (window.SQR_API_OVERRIDE) return String(window.SQR_API_OVERRIDE).replace(/\/$/, ""); const host = window.location.hostname; if (LOCAL_HOSTS.has(host)) return "http://127.0.0.1:5000"; if (host.includes("github.io") || host.includes("netlify") || host.includes("vercel")) { return "https://sqr-ba83.onrender.com"; } return window.location.origin || "https://sqr-ba83.onrender.com"; })(); const PAGES = { home: "gp.html", index: "gp.html", specializations: "Specialization.html", specialization: "Specialization.html", specializationDetails: "Specialization.html", courses: "Courses.html", course: "Courses.html", courseDetails: "Courses.html", quiz: "Quiz.html", quizzes: "Quiz.html", ats: "ATS.html", jobs: "jobs.html", jobDetails: "JobDetails.html", recommendation: "recommendation.html", profile: "profile.html", admin: "admin.html", signin: "signin.html", login: "signin.html", signup: "signup.html", register: "signup.html" }; const PUBLIC_PAGES = new Set([ "", "index.html", "gp.html", "signin.html", "signup.html" ]); const STATE = { specializations: [], courses: [], jobs: [], certificates: [], quizzes: [], users: [], stats: {}, recommendationQuiz: null, busy: false }; function pageName() { return window.location.pathname.split("/").pop() || "index.html"; } function pageKey() { return pageName().toLowerCase(); } function isPublicPage() { return PUBLIC_PAGES.has(pageKey()); } function route(name, params) { const base = PAGES[name] || name || "#"; const query = new URLSearchParams(); Object.entries(params || {}).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== "") query.set(key, value); }); const qs = query.toString(); return qs ? base + "?" + qs : base; } function go(url) { if (!url || url === "#") return; window.location.href = url; } function qs(selector, root) { return (root || document).querySelector(selector); } function qsa(selector, root) { return Array.from((root || document).querySelectorAll(selector)); } function byId(name) { return document.getElementById(name); } function firstElement(selectors, root) { for (const selector of selectors) { const found = qs(selector, root); if (found) return found; } return null; } function clean(value) { return String(value === undefined || value === null ? "" : value).trim(); } function lower(value) { return clean(value).toLowerCase(); } function number(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback || 0; } function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); } function percent(value) { return clamp(Math.round(number(value, 0)), 0, 100); } function escapeHtml(value) { return String(value === undefined || value === null ? "" : value) .replace(/&/g, "&amp;") .replace(/</g, "&lt;") .replace(/>/g, "&gt;") .replace(/\"/g, "&quot;") .replace(/'/g, "&#039;"); } function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#096;"); } function pick(object, keys, fallback) { for (const key of keys) { if (object && object[key] !== undefined && object[key] !== null && object[key] !== "") { return object[key]; }
    }
    return fallback === undefined ? "" : fallback;
  }
  function itemId(item) {
    return pick(item, [
      "id",
      "user_id",
      "specialization_id",
      "spec_id",
      "course_id",
      "job_id",
      "quiz_id",
      "certificate_id",
      "cert_id",
      "assessment_id",
      "attempt_id"
    ], "");
  }
  function asArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "object") return Object.values(value).filter(Boolean);
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
      return value
        .split(/[\n,|;]+/)
        .map((x) => clean(x))
        .filter(Boolean);
    }
    return [];
  }
  function params() {
    return new URLSearchParams(window.location.search);
  }
  function param(name) {
    return params().get(name);
  }
  function token() {
    return localStorage.getItem("sqr_token") || localStorage.getItem("token") || "";
  }
  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem("sqr_user") || localStorage.getItem("user") || "null");
    } catch (_) {
      return null;
    }
  }
  function setAuth(authToken, user) {
    if (authToken) localStorage.setItem("sqr_token", authToken);
    if (user) localStorage.setItem("sqr_user", JSON.stringify(user));
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }
  function clearAuth() {
    localStorage.removeItem("sqr_token");
    localStorage.removeItem("sqr_user");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }
  function authHeaders() {
    const t = token();
    return t ? { Authorization: "Bearer " + t } : {};
  }
  function jsonHeaders(extra) {
    return Object.assign({ "Content-Type": "application/json" }, authHeaders(), extra || {});
  }
  function hasFiles(form) {
    return qsa("input[type='file']", form).some((input) => input.files && input.files.length > 0);
  }
  function formDataObject(form) {
    const data = {};
    if (!form) return data;
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (value instanceof File) {
        if (value.name) data[key] = value;
      } else {
        data[key] = clean(value);
      }
    }
    qsa("input[id], textarea[id], select[id]", form).forEach((el) => {
      const key = el.name || el.id;
      if (!key || data[key] !== undefined) return;
      if (el.type === "file") {
        if (el.files && el.files[0]) data[key] = el.files[0];
      } else if (el.type === "checkbox") {
        data[key] = Boolean(el.checked);
      } else if (el.type === "radio") {
        if (el.checked) data[key] = clean(el.value);
      } else {
        data[key] = clean(el.value);
      }
    });
    return data;
  }
  function formPayload(form, extra) {
    const data = formDataObject(form);
    Object.assign(data, extra || {});
    return data;
  }
  function toFormData(data) {
    const fd = new FormData();
    Object.entries(data || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value) || (typeof value === "object" && !(value instanceof File))) {
        fd.append(key, JSON.stringify(value));
      } else {
        fd.append(key, value);
      }
    });
    return fd;
  }
  function fillForm(form, data) {
    if (!form || !data) return;
    qsa("input, textarea, select", form).forEach((el) => {
      const key = el.name || el.id;
      if (!key || data[key] === undefined || el.type === "file") return;
      if (el.type === "checkbox") el.checked = Boolean(data[key]);
      else if (el.type === "radio") el.checked = String(el.value) === String(data[key]);
      else el.value = data[key] == null ? "" : data[key];
    });
  }
  function resultArray(result, keys) {
    if (Array.isArray(result)) return result;
    for (const key of keys || []) {
      if (Array.isArray(result && result[key])) return result[key];
    }
    if (Array.isArray(result && result.data)) return result.data;
    if (Array.isArray(result && result.items)) return result.items;
    return [];
  }
  function showMessage(message, type) {
    const box = byId("message") || byId("msg") || byId("alert") || byId("formMessage");
    if (!box) return;
    box.textContent = message || "";
    box.className = "message " + (type || "info");
    box.style.display = message ? "block" : "none";
    clearTimeout(showMessage.timer);
    if (message) {
      showMessage.timer = setTimeout(() => {
        if (box.textContent === message) box.style.display = "none";
      }, 6000);
    }
  }
  function setLoading(button, active, text) {
    if (!button) return;
    if (active) {
      button.dataset.oldHtml = button.innerHTML;
      button.disabled = true;
      button.classList.add("is-loading");
      button.innerHTML = escapeHtml(text || "Loading...");
    } else {
      button.disabled = false;
      button.classList.remove("is-loading");
      if (button.dataset.oldHtml) button.innerHTML = button.dataset.oldHtml;
    }
  }
  async function parseResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      return { message: text };
    }
  }
  function shouldIgnoreUnauthorized(options) {
    if (options && options.action) return false;
    if (options && options.silentUnauthorized === true) return true;
    if (options && options.silentUnauthorized === false) return false;
    return isPublicPage() || !token();
  }
  async function api(path, options) {
    const opts = Object.assign({}, options || {});
    const url = /^https?:\/\//i.test(path) ? path : API + path;
    const isFD = opts.body instanceof FormData;
    const headers = isFD ? Object.assign({}, authHeaders(), opts.headers || {}) : jsonHeaders(opts.headers || {});
    const response = await fetch(url, Object.assign({}, opts, { headers }));
    const data = await parseResponse(response);
    if (response.status === 401 || response.status === 403) {
      if (!shouldIgnoreUnauthorized(opts)) {
        showMessage(data.error || data.message || "Unauthorized. Please sign in again.", "error");
      }
      if (response.status === 401 && !isPublicPage() && opts.redirectOnUnauthorized !== false) {
        clearAuth();
        setTimeout(() => go(route("signin")), 700);
      }
      const err = new Error(data.error || data.message || "Unauthorized");
      err.status = response.status;
      err.data = data;
      throw err;
    }
    if (!response.ok) {
      const err = new Error(data.error || data.message || "Request failed");
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  async function apiAny(paths, options) {
    const list = Array.isArray(paths) ? paths : [paths];
    let lastError = null;
    for (const path of list) {
      try {
        return await api(path, options || {});
      } catch (err) {
        lastError = err;
        if (![404, 405].includes(err.status)) break;
      }
    }
    throw lastError || new Error("Request failed");
  }
  function asset(value) {
    const v = clean(value);
    if (!v) return "";
    if (/^https?:\/\//i.test(v) || v.startsWith("data:")) return v;
    if (v.startsWith("/")) return API + v;
    if (v.startsWith("uploads/") || v.startsWith("static/")) return API + "/" + v;
    return v;
  }
  function button(label, cls, attrs) {
    const safeAttrs = attrs || "";
    const type = /\btype\s*=/.test(safeAttrs) ? "" : " type=\"button\"";
    return `<button${type} class="${escapeAttr(cls || "btn btn-primary")}" ${safeAttrs}>${escapeHtml(label)}</button>`;
  }
  function link(label, href, cls, attrs) {
    return `<a class="${escapeAttr(cls || "btn btn-primary")}" href="${escapeAttr(href || "#")}" ${attrs || ""}>${escapeHtml(label)}</a>`;
  }
  function badge(text, cls) {
    if (!text) return "";
    return `<span class="${escapeAttr(cls || "badge")}">${escapeHtml(text)}</span>`;
  }
  function media(item, cls) {
    const video = asset(pick(item, ["video_url", "video", "video_path", "media_url"], ""));
    const image = asset(pick(item, ["image_url", "image", "image_path", "photo", "picture", "thumbnail", "cover"], ""));
    if (video && /\.(mp4|webm|ogg)$/i.test(video)) {
      return `<video class="${escapeAttr(cls || "card-media")}" src="${escapeAttr(video)}" controls preload="metadata"></video>`;
    }
    if (image) {
      return `<img class="${escapeAttr(cls || "card-media")}" src="${escapeAttr(image)}" alt="SQR image" loading="lazy">`;
    }
    return `<div class="${escapeAttr(cls || "card-media")} media-placeholder"><span>SQR</span></div>`;
  }
  function progressBar(value, label) {
    const p = percent(value);
    return `
      <div class="progress-block">
        <div class="progress-top"><span>${escapeHtml(label || "Progress")}</span><strong>${p}%</strong></div>
        <div class="progress"><div class="progress-fill" style="width:${p}%"></div></div>
      </div>
    `;
  }
  function circleStat(value, label) {
    const p = percent(value);
    return `
      <div class="score-circle" style="--score:${p}">
        <div class="score-circle-inner"><strong>${p}%</strong><span>${escapeHtml(label || "Score")}</span></div>
      </div>
    `;
  }
  function completeIcon(done) {
    return done ? `<span class="done-icon" title="Completed">✓</span>` : `<span class="todo-icon" title="Not completed"></span>`;
  }
  function container(ids, parentSelector, className) {
    for (const name of ids) {
      const found = byId(name);
      if (found) return found;
    }
    const box = document.createElement("div");
    box.id = ids[0];
    if (className) box.className = className;
    const parent = qs(parentSelector || ".container, main, body") || document.body;
    parent.appendChild(box);
    return box;
  }
  function roleOf(user) {
    return lower(user && user.role || "student");
  }
  function modeOf(user) {
    return lower(user && (user.current_mode || user.mode || user.role) || "student");
  }
  function isAdminMode() {
    const user = currentUser();
    return roleOf(user) === "admin" && modeOf(user) !== "student";
  }
  function ensureNavbarFixStyles() {
    if (byId("sqr-navbar-fix-styles")) return;
    const style = document.createElement("style");
    style.id = "sqr-navbar-fix-styles";
    style.textContent = `
      .sqr-navbar{position:sticky!important;top:0!important;z-index:9999!important;display:grid!important;grid-template-columns:180px minmax(420px,1fr) 280px!important;align-items:center!important;gap:18px!important;width:100%!important;min-height:72px!important;padding:12px 30px!important;margin:0!important;background:rgba(4,10,28,.96)!important;border-bottom:1px solid rgba(148,163,184,.16)!important;box-shadow:0 12px 34px rgba(0,0,0,.22)!important;box-sizing:border-box!important}
      .sqr-navbar .brand{display:flex!important;align-items:center!important;justify-content:flex-start!important;width:auto!important;height:auto!important;min-height:0!important;padding:0!important;margin:0!important;text-decoration:none!important;font-size:28px!important;font-weight:900!important;letter-spacing:.08em!important;line-height:1!important;color:#f8fafc!important}
      .sqr-navbar .brand strong{display:block!important;font-size:28px!important;line-height:1!important;margin:0!important;color:#f8fafc!important}
      .sqr-navbar .brand span{display:none!important}
      .sqr-navbar .nav-links{display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;flex-wrap:wrap!important;margin:0!important;padding:0!important;width:auto!important}
      .sqr-navbar .nav-links a{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:42px!important;padding:10px 17px!important;border-radius:999px!important;text-decoration:none!important;font-size:15px!important;font-weight:800!important;line-height:1!important;color:#cbd5e1!important;white-space:nowrap!important}
      .sqr-navbar .nav-links a.active{background:rgba(148,163,184,.14)!important;color:#fff!important}
      .sqr-navbar .nav-actions{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:10px!important;margin:0!important;padding:0!important;width:auto!important}
      .sqr-navbar .nav-actions .btn,.sqr-navbar .nav-actions a.btn,.sqr-navbar .nav-actions button.btn{min-height:42px!important;padding:10px 18px!important;border-radius:999px!important;font-size:15px!important;font-weight:900!important;white-space:nowrap!important}
      .sqr-navbar .nav-user{max-width:110px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:#e5e7eb!important;font-weight:800!important}
      .sqr-navbar .nav-toggle{display:none!important}
      @media(max-width:980px){.sqr-navbar{grid-template-columns:1fr auto!important;padding:12px 18px!important}.sqr-navbar .nav-toggle{display:inline-flex!important}.sqr-navbar .nav-links,.sqr-navbar .nav-actions{grid-column:1/-1!important;display:none!important;justify-content:flex-start!important}.sqr-navbar.open .nav-links,.sqr-navbar.open .nav-actions{display:flex!important}.sqr-navbar .nav-links a{font-size:14px!important;padding:10px 14px!important}}
    `;
    document.head.appendChild(style);
  }

  function ensurePageFixStyles() {
    if (byId("sqr-page-fix-styles")) return;
    const style = document.createElement("style");
    style.id = "sqr-page-fix-styles";
    style.textContent = `
      .sqr-page-title{margin:36px auto 18px;max-width:1180px;padding:0 18px}.sqr-page-title h1{font-size:clamp(32px,4vw,56px);line-height:1.02;margin:0 0 10px;font-weight:950;color:#f8fafc}.sqr-page-title p{max-width:760px;color:#94a3b8;font-size:18px;line-height:1.7;margin:0}
      .sqr-shell{max-width:1180px;margin:0 auto 50px;padding:0 18px}.sqr-grid{display:grid;gap:22px}.sqr-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.sqr-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
      .ats-layout{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr);gap:24px;align-items:start}.ats-panel,.admin-panel,.job-detail-card{background:rgba(15,23,42,.88);border:1px solid rgba(148,163,184,.18);border-radius:26px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.22);backdrop-filter:blur(14px)}
      .ats-panel h2,.admin-panel h2{margin:0 0 10px;font-size:26px;color:#f8fafc}.ats-panel p,.admin-panel p{color:#94a3b8;line-height:1.65}.ats-panel form,.admin-panel form{display:grid;gap:14px}.ats-panel label,.admin-panel label{display:grid;gap:8px;color:#e5e7eb;font-weight:800}.ats-panel input,.ats-panel textarea,.admin-panel input,.admin-panel textarea,.admin-panel select{width:100%;box-sizing:border-box;border:1px solid rgba(148,163,184,.28);border-radius:16px;background:rgba(2,6,23,.82);color:#f8fafc;padding:13px 15px;outline:none}.ats-panel textarea,.admin-panel textarea{min-height:110px;resize:vertical}.ats-upload{border:1px dashed rgba(59,130,246,.55);border-radius:20px;padding:18px;background:rgba(37,99,235,.08)}
      .ats-result,.result-card{margin-top:20px}.result-header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.section-score-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.section-score{padding:13px;border-radius:16px;background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.14)}.resume-output{min-height:360px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap}.summary-box{padding:16px;border-radius:18px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);margin:14px 0}
      .admin-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.admin-tab-btn{border:1px solid rgba(148,163,184,.22);background:rgba(15,23,42,.75);color:#dbeafe;border-radius:999px;padding:11px 16px;font-weight:900;cursor:pointer}.admin-tab-btn.active{background:#2563eb;color:#fff;border-color:#2563eb}.admin-section{display:none}.admin-section.active{display:block}.admin-main-grid{display:grid;grid-template-columns:1fr;gap:22px}.admin-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.admin-form-grid .full{grid-column:1/-1}.stats-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.stat-card{padding:20px;border-radius:22px;background:linear-gradient(135deg,rgba(37,99,235,.18),rgba(16,185,129,.1));border:1px solid rgba(148,163,184,.18)}.stat-card strong{display:block;font-size:34px;color:#fff}.stat-card span{color:#94a3b8;font-weight:800}
      .job-card{cursor:pointer}.job-detail-hero{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:22px;align-items:start}.detail-list{display:grid;gap:14px}.detail-list article{padding:16px;border-radius:18px;background:rgba(15,23,42,.65);border:1px solid rgba(148,163,184,.16)}
      .course-video{width:100%;border-radius:22px;border:1px solid rgba(148,163,184,.2);background:#020617}.card-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.btn-danger{background:#ef4444!important;color:#fff!important;border-color:#ef4444!important}.btn-small{padding:8px 12px!important;font-size:13px!important}.error-card,.empty-state,.loading-card{grid-column:1/-1;padding:24px;border-radius:22px;background:rgba(15,23,42,.78);border:1px solid rgba(148,163,184,.16);color:#e5e7eb}.mini-card{padding:18px;border-radius:20px;background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.15)}
      @media(max-width:900px){.ats-layout,.sqr-grid.two,.sqr-grid.three,.admin-form-grid,.stats-grid,.job-detail-hero{grid-template-columns:1fr!important}.ats-panel,.admin-panel{padding:18px}.sqr-page-title{margin-top:24px}.section-score-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function navbar() {
    ensureNavbarFixStyles();
    const existing = qs(".navbar, .sqr-navbar");
    if (existing) existing.remove();
    const user = currentUser();
    const logged = Boolean(token());
    const adminMode = isAdminMode();
    const links = adminMode
      ? [["Admin", route("admin")]]
      : [
          ["Home", route("home")],
          ["Specializations", route("specializations")],
          ["Courses", route("courses")],
          ["ATS", route("ats")],
          ["Jobs", route("jobs")],
          ["Recommendation", route("recommendation")],
          ["Profile", route("profile")]
        ];
    const nav = document.createElement("header");
    nav.className = "navbar sqr-navbar";
    nav.innerHTML = `
      <a class="brand" href="${route("home")}"><strong>SQR</strong></a>
      <button type="button" class="nav-toggle" aria-label="Menu">☰</button>
      <nav class="nav-links">
        ${links.map(([label, href]) => `<a class="${pageKey() === href.toLowerCase() ? "active" : ""}" href="${escapeAttr(href)}">${escapeHtml(label)}</a>`).join("")}
      </nav>
      <div class="nav-actions">
        ${logged ? `<span class="nav-user">${escapeHtml(user && user.name || "User")}</span><button type="button" class="btn btn-soft" data-logout>Logout</button>` : `${link("Sign In", route("signin"), "btn btn-soft")} ${link("Sign Up", route("signup"), "btn btn-primary")}`}
      </div>
    `;
    document.body.prepend(nav);
    qs(".nav-toggle", nav).addEventListener("click", () => nav.classList.toggle("open"));
  }
  function logout() {
    clearAuth();
    showMessage("Signed out successfully.", "success");
    setTimeout(() => go(route("signin")), 400);
  }
  function requireLogin() {
    if (token()) return true;
    showMessage("Please sign in first.", "error");
    setTimeout(() => go(route("signin")), 650);
    return false;
  }
  function requireAdmin() {
    if (!requireLogin()) return false;
    const user = currentUser();
    if (roleOf(user) !== "admin") {
      showMessage("Admin access only.", "error");
      setTimeout(() => go(route("home")), 650);
      return false;
    }
    return true;
  }
  function blockAdminFromStudentPages() {
    const user = currentUser();
    if (!user) return;
    if (roleOf(user) !== "admin" || modeOf(user) === "student") return;
    const allowed = new Set(["admin.html", "signin.html", "signup.html"]);
    if (!allowed.has(pageKey())) go(route("admin"));
  }
  function passwordRules(password, confirmValue) {
    const pass = password || "";
    return {
      length: pass.length >= 8,
      upper: /[A-Z]/.test(pass),
      lower: /[a-z]/.test(pass),
      number: /\d/.test(pass),
      noSpace: !/\s/.test(pass),
      match: confirmValue === undefined || confirmValue === null || confirmValue === "" ? true : pass === confirmValue
    };
  }
  function passwordIsValid(password, confirmValue) {
    const rules = passwordRules(password, confirmValue);
    return rules.length && rules.upper && rules.lower && rules.number && rules.noSpace && rules.match;
  }
  function injectPasswordChecklist(form) {
    if (!form || form.dataset.passwordChecklistBound) return;
    const password = firstElement([
      "input[name='password']",
      "#password",
      "input[type='password']"
    ], form);
    if (!password) return;
    const confirmInput = firstElement([
      "input[name='confirm_password']",
      "input[name='confirmPassword']",
      "#confirm_password",
      "#confirmPassword"
    ], form);
    const box = document.createElement("div");
    box.className = "password-checklist";
    box.innerHTML = `
      <p>Password must include:</p>
      <ul>
        <li data-rule="length">At least 8 characters</li>
        <li data-rule="upper">One uppercase letter</li>
        <li data-rule="lower">One lowercase letter</li>
        <li data-rule="number">One number</li>
        <li data-rule="noSpace">No spaces</li>
        <li data-rule="match" class="optional-rule">Passwords match</li>
      </ul>
    `;
    password.insertAdjacentElement("afterend", box);
    const update = () => {
      const rules = passwordRules(password.value, confirmInput ? confirmInput.value : undefined);
      Object.entries(rules).forEach(([key, ok]) => {
        const li = qs(`[data-rule='${key}']`, box);
        if (!li) return;
        if (key === "match" && !confirmInput) {
          li.style.display = "none";
          return;
        }
        li.classList.toggle("valid", Boolean(ok));
        li.classList.toggle("invalid", !ok);
        li.textContent = (ok ? "✓ " : "• ") + li.textContent.replace(/^✓\s|^•\s/, "");
      });
    };
    password.addEventListener("input", update);
    if (confirmInput) confirmInput.addEventListener("input", update);
    update();
    form.dataset.passwordChecklistBound = "1";
  }
  function validateSignupForm(form) {
    const name = firstElement(["input[name='name']", "#name"], form);
    const email = firstElement(["input[name='email']", "#email"], form);
    const password = firstElement(["input[name='password']", "#password", "input[type='password']"], form);
    const confirmInput = firstElement(["input[name='confirm_password']", "input[name='confirmPassword']", "#confirm_password", "#confirmPassword"], form);
    if (name && !clean(name.value)) return "Name is required.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(email.value))) return "Enter a valid email address.";
    if (!password || !passwordIsValid(password.value, confirmInput ? confirmInput.value : undefined)) {
      return "Password must be 8+ characters and include uppercase, lowercase, number, no spaces, and matching confirmation if used.";
    }
    return "";
  }
  function setupSignup() {
    const form = byId("signupForm") || qs("form[data-form='signup']") || (pageKey() === "signup.html" ? qs("form") : null);
    if (!form || form.dataset.boundSignup) return;
    injectPasswordChecklist(form);
    form.dataset.boundSignup = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const problem = validateSignupForm(form);
      if (problem) {
        showMessage(problem, "error");
        return;
      }
      const submit = qs("button[type='submit'], button:not([type])", form);
      const data = formPayload(form, { role: "student" });
      delete data.confirm_password;
      delete data.confirmPassword;
      setLoading(submit, true, "Creating...");
      try {
        const result = await apiAny(["/api/signup", "/signup", "/api/register"], {
          method: "POST",
          body: JSON.stringify(data),
          action: true,
          redirectOnUnauthorized: false
        });
        const authToken = result.token || result.access_token || result.jwt;
        const user = result.user || result.profile || result.data || result;
        if (authToken) {
          setAuth(authToken, user);
          showMessage("Account created successfully.", "success");
          setTimeout(() => go(route("profile")), 600);
        } else {
          showMessage("Account created. Please sign in.", "success");
          setTimeout(() => go(route("signin")), 800);
        }
      } catch (err) {
        showMessage(err.data && err.data.error || err.message || "Signup failed.", "error");
      } finally {
        setLoading(submit, false);
      }
    });
  }
  function setupSignin() {
    const form = byId("signinForm") || byId("loginForm") || qs("form[data-form='signin']") || (pageKey() === "signin.html" ? qs("form") : null);
    if (!form || form.dataset.boundSignin) return;
    form.dataset.boundSignin = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = qs("button[type='submit'], button:not([type])", form);
      setLoading(submit, true, "Signing in...");
      try {
        const result = await apiAny(["/api/signin", "/api/login", "/signin", "/login"], {
          method: "POST",
          body: JSON.stringify(formPayload(form)),
          action: true,
          redirectOnUnauthorized: false
        });
        const authToken = result.token || result.access_token || result.jwt;
        const user = result.user || result.profile || result.data || result;
        if (!authToken) throw new Error("Backend did not return a token.");
        setAuth(authToken, user);
        showMessage("Signed in successfully.", "success");
        const destination = roleOf(user) === "admin" && modeOf(user) !== "student" ? route("admin") : route("profile");
        setTimeout(() => go(destination), 600);
      } catch (err) {
        showMessage(err.data && err.data.error || err.message || "Signin failed.", "error");
      } finally {
        setLoading(submit, false);
      }
    });
  }
  async function fetchProfile() {
    const result = await apiAny(["/api/profile", "/api/me", "/api/user/profile"], { silentUnauthorized: false });
    return result.user || result.profile || result.data || result;
  }
  function renderProfileProgress(result) {
    const list = result && (result.progress || result.specialization_progress || result.enrollments || result.courses) || [];
    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
      return `
        <div class="empty-state">
          <h3>No progress yet</h3>
          <p>Open a course, watch the video or open the course link, then submit quizzes to start tracking progress.</p>
        </div>
      `;
    }
    return `
      <section class="profile-progress">
        <h2>Progress</h2>
        ${items.map((item) => {
          const title = pick(item, ["name", "title", "course_title", "specialization_name"], "Learning item");
          const value = pick(item, ["progress", "percentage", "completed_percent", "score"], 0);
          return `<article class="mini-card"><h3>${escapeHtml(title)}</h3>${progressBar(value, "Completed")}</article>`;
        }).join("")}
      </section>
    `;
  }
  async function loadProfile() {
    if (pageKey() === "profile.html" && isAdminMode()) { go(route("admin")); return; }
    const box = byId("profileBox") || byId("profile") || byId("profileCard");
    const form = byId("profileForm") || qs("form[data-form='profile']");
    if (!box && !form) return;
    if (!requireLogin()) return;
    try {
      const profile = await fetchProfile();
      setAuth(token(), Object.assign({}, currentUser() || {}, profile));
      if (box) {
        box.innerHTML = `
          <section class="profile-hero card">
            <div>
              <span class="eyebrow">My Dashboard</span>
              <h1>${escapeHtml(profile.name || "Student")}</h1>
              <p>${escapeHtml(profile.email || "")}</p>
              <div class="chip-row">${badge("Role: " + (profile.role || "student"), "badge")} ${badge("Mode: " + (profile.current_mode || profile.mode || profile.role || "student"), "badge badge-soft")}</div>
            </div>
            ${circleStat(profile.overall_progress || profile.progress || 0, "Overall")}
          </section>
          ${renderProfileProgress(profile)}
        `;
      }
      fillForm(form, profile);
    } catch (err) {
      showMessage(err.data && err.data.error || err.message || "Could not load profile.", "error");
    }
    if (form && !form.dataset.boundProfile) {
      form.dataset.boundProfile = "1";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = qs("button[type='submit'], button:not([type])", form);
        setLoading(submit, true, "Saving...");
        try {
          const result = await apiAny(["/api/profile", "/api/me"], {
            method: "PUT",
            body: JSON.stringify(formPayload(form)),
            action: true
          });
          const user = result.user || result.profile || result.data || result;
          setAuth(token(), Object.assign({}, currentUser() || {}, user));
          showMessage("Profile updated.", "success");
          await loadProfile();
        } catch (err) {
          showMessage(err.data && err.data.error || err.message || "Could not update profile.", "error");
        } finally {
          setLoading(submit, false);
        }
      });
    }
  }
  function setupModeSwitch() {
    const btnEl = byId("modeSwitch") || byId("switchModeBtn") || qs("[data-switch-mode]");
    if (!btnEl || btnEl.dataset.boundModeSwitch) return;
    btnEl.dataset.boundModeSwitch = "1";
    btnEl.addEventListener("click", async () => {
      if (!requireLogin()) return;
      try {
        const result = await apiAny(["/api/profile/switch-mode", "/api/switch-mode", "/api/admin/switch-mode"], {
          method: "POST",
          body: "{}",
          action: true
        });
        const user = result.user || result.profile || result.data || result;
        setAuth(token(), Object.assign({}, currentUser() || {}, user));
        showMessage("Mode switched.", "success");
        setTimeout(() => window.location.reload(), 700);
      } catch (err) {
        showMessage(err.data && err.data.error || err.message || "Could not switch mode.", "error");
      }
    });
  }
  function renderHomeCards() {
    if (!["", "index.html", "gp.html"].includes(pageKey())) return;
    const box = container(["homeCards", "dashboardCards", "features"], ".home-shell, .container, main, body", "grid cards-4 home-panels");
    if (box.dataset.renderedHomeCards) return;
    box.dataset.renderedHomeCards = "1";
    box.classList.add("grid", "cards-4", "home-panels");
    box.innerHTML = `
      <article class="panel-card clickable" data-link="${route("specializations")}">
        <span class="panel-icon">▣</span>
        <h2>Specializations</h2>
        <p>Choose a CS path and follow a structured roadmap.</p>
      </article>
      <article class="panel-card clickable" data-link="${route("courses")}">
        <span class="panel-icon">▶</span>
        <h2>Courses</h2>
        <p>Open courses, auto-enroll, and track completion.</p>
      </article>
      <article class="panel-card clickable" data-link="${route("ats")}">
        <span class="panel-icon">◎</span>
        <h2>ATS Resume</h2>
        <p>Upload PDF or DOCX resumes and generate ATS-friendly output.</p>
      </article>
      <article class="panel-card clickable" data-link="${route("recommendation")}">
        <span class="panel-icon">✦</span>
        <h2>Recommendation</h2>
        <p>Take the test and get specialization suggestions.</p>
      </article>
    `;
  }

  function localUserKey(type) {
    const user = currentUser() || {};
    return "sqr_" + type + "_" + (user.id || user.user_id || user.email || "guest");
  }
  function localSet(type) {
    try { return new Set(JSON.parse(localStorage.getItem(localUserKey(type)) || "[]")); }
    catch (_) { return new Set(); }
  }
  function saveLocalSet(type, set) {
    localStorage.setItem(localUserKey(type), JSON.stringify(Array.from(set)));
  }
  function markLocal(type, id, value) {
    if (!id) return;
    const set = localSet(type);
    if (value) set.add(String(id)); else set.delete(String(id));
    saveLocalSet(type, set);
  }
  function hasLocal(type, id) {
    return id ? localSet(type).has(String(id)) : false;
  }

  async function getSpecializations() {
    const result = await apiAny(["/api/specializations", "/api/specialization", "/api/admin/specializations"], {
      redirectOnUnauthorized: false,
      silentUnauthorized: true
    });
    return resultArray(result, ["specializations", "specialization"]);
  }
  async function getCourses(queryString) {
    const q = queryString ? "?" + queryString : "";
    const result = await apiAny(["/api/courses" + q, "/api/course" + q, "/api/admin/courses" + q], {
      redirectOnUnauthorized: false,
      silentUnauthorized: true
    });
    return resultArray(result, ["courses", "course"]);
  }
  async function getJobs() {
    const result = await apiAny(["/api/jobs", "/api/job", "/api/admin/jobs"], {
      redirectOnUnauthorized: false,
      silentUnauthorized: true
    });
    return resultArray(result, ["jobs", "job"]);
  }
  async function getCertificates() {
    const result = await apiAny(["/api/certificates", "/api/certifications", "/api/admin/certificates"], {
      redirectOnUnauthorized: false,
      silentUnauthorized: true
    });
    return resultArray(result, ["certificates", "certifications", "certs"]);
  }
  async function getQuizzes(queryString) {
    const q = queryString ? "?" + queryString : "";
    const result = await apiAny(["/api/quizzes" + q, "/api/quiz" + q, "/api/admin/quizzes" + q], {
      redirectOnUnauthorized: false,
      silentUnauthorized: true
    });
    return resultArray(result, ["quizzes", "quiz"]);
  }
  function specializationCard(spec) {
    const sid = itemId(spec);
    const title = pick(spec, ["name", "title", "specialization_name"], "Specialization");
    const desc = pick(spec, ["description", "overview", "details"], "View roadmap, skills, courses, jobs, and certificates.");
    const p = pick(spec, ["progress", "percentage", "completed_percent"], 0);
    const skills = asArray(pick(spec, ["skills", "skill_list"], []));
    const enrolled = Boolean(spec.enrolled || spec.is_enrolled || spec.enrollment_id);
    return `
      <article class="card spec-card clickable" data-link="${route("specializations", { id: sid })}">
        ${media(spec)}
        <div class="card-body">
          <div class="card-title-row"><h2>${escapeHtml(title)}</h2>${token() ? completeIcon(percent(p) >= 100) : ""}</div>
          <p>${escapeHtml(desc)}</p>
          ${token() ? progressBar(p, "Progress") : ""}
          ${skills.length ? `<div class="chip-row">${skills.slice(0, 8).map((skill) => badge(skill, "badge badge-soft")).join("")}</div>` : ""}
          <div class="card-actions">
            ${button("View Details", "btn btn-primary", `data-no-card-click data-open-specialization="${escapeAttr(sid)}"`)}
            ${button("Courses", "btn btn-soft", `data-no-card-click data-link="${escapeAttr(route("courses", { specialization_id: sid }))}"`)}
            ${token() ? enrolled ? button("Unenroll", "btn btn-danger", `data-no-card-click data-unenroll-specialization="${escapeAttr(sid)}"`) : button("Enroll", "btn btn-soft", `data-no-card-click data-enroll-specialization="${escapeAttr(sid)}"`) : ""}
          </div>
        </div>
      </article>
    `;
  }
  async function loadSpecializations() {
    const selectedSid = param("id") || param("specialization_id") || param("spec_id");
    const hasDetailsBox = Boolean(byId("specializationDetails") || byId("specializationDetail") || byId("detailsBox"));
    const box = byId("specializationsBox") || byId("specializationBox") || byId("specializationsList") || byId("specializations");
    if (!box) return;
    if (selectedSid && !hasDetailsBox) {
      box.classList.remove("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading specialization details...</div>`;
      return;
    }
    try {
      box.classList.add("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading specializations...</div>`;
      const list = await getSpecializations();
      STATE.specializations = list;
      if (!list.length) {
        box.innerHTML = `<div class="empty-state"><h2>No specializations yet</h2><p>Add one from the admin page.</p></div>`;
        return;
      }
      box.innerHTML = list.map(specializationCard).join("");
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load specializations.</div>`;
    }
  }
  function roadmapHtml(spec) {
    const steps = asArray(pick(spec, ["roadmap", "steps", "learning_path"], []));
    if (!steps.length) return "";
    return `
      <section class="detail-section">
        <h2>Roadmap</h2>
        <div class="timeline">${steps.map((step, index) => `<div class="timeline-item"><span>${index + 1}</span><p>${escapeHtml(step)}</p></div>`).join("")}</div>
      </section>
    `;
  }
  function skillsHtml(item) {
    const skills = asArray(pick(item, ["skills", "skill_list", "required_skills"], []));
    if (!skills.length) return "";
    return `<section class="detail-section"><h2>Skills</h2><div class="chip-row">${skills.map((skill) => badge(skill, "badge badge-soft")).join("")}</div></section>`;
  }
  function miniCards(title, items, keyList) {
    if (!Array.isArray(items) || !items.length) return "";
    return `
      <section class="detail-section">
        <h2>${escapeHtml(title)}</h2>
        <div class="grid cards-3">
          ${items.map((item) => `<article class="mini-card"><h3>${escapeHtml(pick(item, keyList, "Item"))}</h3><p>${escapeHtml(pick(item, ["description", "summary"], ""))}</p></article>`).join("")}
        </div>
      </section>
    `;
  }
  async function loadSpecializationDetails() {
    const sid = param("id") || param("specialization_id") || param("spec_id");
    const fallbackBox = byId("specializationsBox") || byId("specializationBox") || byId("specializationsList") || byId("specializations");
    const box = byId("specializationDetails") || byId("specializationDetail") || byId("detailsBox") || fallbackBox;
    if (!box || !sid) return;
    try {
      box.classList.remove("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading details...</div>`;
      let result = {};
      let spec = null;
      try {
        result = await apiAny([`/api/specializations/${encodeURIComponent(sid)}`, `/api/specialization/${encodeURIComponent(sid)}`], {
          redirectOnUnauthorized: false,
          silentUnauthorized: true
        });
        spec = result.specialization || result.item || result.data || result;
      } catch (_) {
        result = {};
      }
      if (!spec || !itemId(spec)) {
        const allSpecs = STATE.specializations.length ? STATE.specializations : await getSpecializations();
        STATE.specializations = allSpecs;
        spec = allSpecs.find((item) => String(itemId(item)) === String(sid)) || null;
      }
      if (!spec) throw new Error("Specialization not found");
      const courses = result.courses || await getCourses("specialization_id=" + encodeURIComponent(sid));
      const jobs = result.jobs || [];
      const certs = result.certificates || result.certifications || [];
      box.innerHTML = `
        <section class="detail-hero card">
          ${media(spec, "detail-media")}
          <div class="detail-content">
            <span class="eyebrow">Specialization</span>
            <h1>${escapeHtml(pick(spec, ["name", "title"], "Specialization"))}</h1>
            <p>${escapeHtml(pick(spec, ["description", "overview"], ""))}</p>
            ${token() ? progressBar(pick(spec, ["progress", "percentage", "completed_percent"], 0), "Progress") : ""}
            <div class="card-actions">
              ${token() ? button("Enroll", "btn btn-primary", `data-enroll-specialization="${escapeAttr(sid)}"`) : link("Sign in to enroll", route("signin"), "btn btn-primary")}
              ${link("View Courses", route("courses", { specialization_id: sid }), "btn btn-soft")}
            </div>
          </div>
        </section>
        ${roadmapHtml(spec)}
        ${skillsHtml(spec)}
        ${miniCards("Related Courses", courses, ["title", "name", "course_name"])}
        ${miniCards("Job Titles", jobs, ["title", "name", "job_title"])}
        ${miniCards("Certificates", certs, ["name", "title", "certificate_name"])}
      `;
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load specialization details.</div>`;
    }
  }
  function courseCard(course) {
    const cid = itemId(course);
    const title = pick(course, ["title", "name", "course_name"], "Course");
    const desc = pick(course, ["description", "summary"], "Open this course to auto-enroll and track progress.");
    const level = pick(course, ["level", "difficulty"], "");
    const completed = Boolean(course.completed || course.is_completed || course.done || percent(course.progress) >= 100);
    const enrolled = Boolean(course.enrolled || course.is_enrolled || course.enrollment_id || hasLocal("course_enrollments", cid));
    const p = pick(course, ["progress", "percentage", "completed_percent"], completed ? 100 : 0);
    return `
      <article class="card course-card clickable" data-link="${route("courses", { id: cid })}">
        ${media(course)}
        <div class="card-body">
          <div class="card-title-row"><h2>${escapeHtml(title)}</h2>${token() ? completeIcon(completed) : ""}</div>
          <p>${escapeHtml(desc)}</p>
          <div class="chip-row">${level ? badge(level, "badge level-badge") : ""}${enrolled ? badge("Enrolled", "badge badge-success") : ""}</div>
          ${token() ? progressBar(p, "Progress") : ""}
          <div class="card-actions">
            ${button("Open Course", "btn btn-primary", `data-no-card-click data-open-course="${escapeAttr(cid)}"`)}
            ${token() ? enrolled ? button("Unenroll", "btn btn-danger", `data-no-card-click data-unenroll-course="${escapeAttr(cid)}"`) : button("Enroll", "btn btn-soft", `data-no-card-click data-enroll-course="${escapeAttr(cid)}"`) : link("Sign in to enroll", route("signin"), "btn btn-soft", "data-no-card-click")}
          </div>
        </div>
      </article>
    `;
  }
  async function loadCourses() {
    const selectedCid = param("id") || param("course_id");
    const hasDetailsBox = Boolean(byId("courseDetails") || byId("courseDetail") || byId("courseBox") || byId("selectedCourse"));
    const box = byId("coursesBox") || byId("coursesList") || byId("courses");
    if (!box) return;
    if (selectedCid && !hasDetailsBox) {
      box.classList.remove("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading course details...</div>`;
      return;
    }
    const query = new URLSearchParams();
    const sid = param("specialization_id") || param("spec_id");
    if (sid) query.set("specialization_id", sid);
    try {
      box.classList.add("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading courses...</div>`;
      const list = await getCourses(query.toString());
      STATE.courses = list;
      if (!list.length) {
        box.innerHTML = `<div class="empty-state"><h2>No courses yet</h2><p>Add courses from the admin page.</p></div>`;
        return;
      }
      box.innerHTML = list.map(courseCard).join("");
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load courses. ${escapeHtml(err.message || "")}</div>`;
    }
  }
  async function getCourseById(courseId) {
    let result = {};
    let course = null;
    try {
      result = await apiAny([
        `/api/courses/${encodeURIComponent(courseId)}`,
        `/api/course/${encodeURIComponent(courseId)}`,
        `/api/course-details/${encodeURIComponent(courseId)}`
      ], { redirectOnUnauthorized: false, silentUnauthorized: true });
      course = result.course || result.item || result.data || result;
    } catch (_) {
      result = {};
    }
    if (!course || !itemId(course)) {
      const allCourses = STATE.courses.length ? STATE.courses : await getCourses("");
      STATE.courses = allCourses;
      course = allCourses.find((item) => String(itemId(item)) === String(courseId)) || null;
    }
    return { result, course };
  }
  async function getCourseQuizzes(courseId, result, course) {
    let quizzes = result.quizzes || result.quiz || course.quizzes || course.quiz || [];
    if (Array.isArray(quizzes) && quizzes.length) return quizzes;
    try {
      quizzes = await getQuizzes("course_id=" + encodeURIComponent(courseId));
      return quizzes.filter((q) => !pick(q, ["course_id"], "") || String(pick(q, ["course_id"], "")) === String(courseId));
    } catch (_) {
      return [];
    }
  }
  async function loadCourseDetails() {
    const cid = param("id") || param("course_id");
    const fallbackBox = byId("coursesBox") || byId("coursesList") || byId("courses");
    const box = byId("courseDetails") || byId("courseDetail") || byId("courseBox") || byId("selectedCourse") || fallbackBox;
    if (!box || !cid) return;
    try {
      box.classList.remove("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading course...</div>`;
      const found = await getCourseById(cid);
      const result = found.result || {};
      const course = found.course;
      if (!course || !itemId(course)) {
        box.innerHTML = `<div class="empty-state">Course not found.</div>`;
        return;
      }
      if (token()) await autoEnrollCourse(cid);
      const linkUrl = asset(pick(course, ["link", "url", "course_url", "external_url", "course_link"], ""));
      const videoUrl = asset(pick(course, ["video", "video_url", "video_path"], ""));
      const quizzes = await getCourseQuizzes(cid, result, course);
      const enrolled = Boolean(course.enrolled || course.is_enrolled || course.enrollment_id || hasLocal("course_enrollments", cid));
      box.innerHTML = `
        <section class="detail-hero card">
          ${media(course, "detail-media")}
          <div class="detail-content">
            <span class="eyebrow">Course</span>
            <h1>${escapeHtml(pick(course, ["title", "name", "course_name"], "Course"))}</h1>
            <div class="chip-row">${badge(pick(course, ["level", "difficulty"], ""), "badge level-badge")} ${enrolled ? badge("Enrolled", "badge badge-success") : ""}</div>
            <p>${escapeHtml(pick(course, ["description", "summary"], ""))}</p>
            ${token() ? progressBar(pick(course, ["progress", "percentage", "completed_percent"], hasLocal("course_opened", cid) ? 50 : 0), "Course Progress") : ""}
            <div class="card-actions">
              ${linkUrl ? link("Open Link", linkUrl, "btn btn-primary", `target="_blank" rel="noopener" data-track-course="${escapeAttr(cid)}"`) : ""}
              ${!linkUrl && !videoUrl ? `<span class="badge badge-soft">No course media/link added yet</span>` : ""}
              ${token() ? enrolled ? button("Unenroll", "btn btn-danger", `data-unenroll-course="${escapeAttr(cid)}"`) : button("Enroll", "btn btn-primary", `data-enroll-course="${escapeAttr(cid)}"`) : link("Sign in to enroll", route("signin"), "btn btn-soft")}
              ${link("Back to Courses", route("courses"), "btn btn-soft")}
            </div>
          </div>
        </section>
        ${videoUrl ? `<section class="detail-section"><h2>Course Video</h2><video class="course-video" src="${escapeAttr(videoUrl)}" controls data-track-course="${escapeAttr(cid)}"></video></section>` : ""}
        ${renderQuizSection(quizzes, cid)}
      `;
      bindQuizForms();
      bindCourseMediaTracking();
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load course. ${escapeHtml(err.message || "")}</div>`;
    }
  }
  async function enrollCourse(courseId, silent) {
    if (!courseId || !requireLogin()) return false;
    try {
      await apiAny([
        `/api/courses/${encodeURIComponent(courseId)}/enroll`,
        `/api/course/${encodeURIComponent(courseId)}/enroll`,
        `/api/courses/${encodeURIComponent(courseId)}/enrollment`,
        `/api/course/${encodeURIComponent(courseId)}/enrollment`,
        `/api/enroll/course/${encodeURIComponent(courseId)}`,
        `/api/enrollments/course/${encodeURIComponent(courseId)}`,
        `/api/enroll/${encodeURIComponent(courseId)}`,
        "/api/course-enrollments",
        "/api/course_enrollments",
        "/api/enroll-course"
      ], {
        method: "POST",
        body: JSON.stringify({ course_id: courseId, id: courseId }),
        action: !silent,
        silentUnauthorized: Boolean(silent),
        redirectOnUnauthorized: !silent
      });
      markLocal("course_enrollments", courseId, true);
      if (!silent) showMessage("Enrolled successfully.", "success");
      if (!silent) await refreshCurrentPage();
      return true;
    } catch (err) {
      if (err && [404, 405].includes(err.status)) {
        markLocal("course_enrollments", courseId, true);
        if (!silent) {
          showMessage("Enrolled on this browser. Backend enrollment route was not found, so add the route in SQR.py for database saving.", "error");
          await refreshCurrentPage();
        }
        return true;
      }
      if (!silent) showMessage(err.data && err.data.error || err.message || "Could not enroll.", "error");
      return false;
    }
  }
  async function unenrollCourse(courseId) {
    if (!courseId || !requireLogin()) return;
    try {
      await apiAny([
        `/api/courses/${encodeURIComponent(courseId)}/enroll`,
        `/api/course/${encodeURIComponent(courseId)}/enroll`,
        `/api/courses/${encodeURIComponent(courseId)}/enrollment`,
        `/api/course/${encodeURIComponent(courseId)}/enrollment`,
        `/api/enroll/course/${encodeURIComponent(courseId)}`,
        `/api/enrollments/course/${encodeURIComponent(courseId)}`,
        `/api/enroll/${encodeURIComponent(courseId)}`,
        "/api/course-enrollments",
        "/api/course_enrollments",
        "/api/enroll-course"
      ], {
        method: "DELETE",
        body: JSON.stringify({ course_id: courseId, id: courseId }),
        action: true
      });
      markLocal("course_enrollments", courseId, false);
      showMessage("Unenrolled successfully.", "success");
      await refreshCurrentPage();
    } catch (err) {
      if (err && [404, 405].includes(err.status)) {
        markLocal("course_enrollments", courseId, false);
        showMessage("Unenrolled on this browser. Backend route was not found, so database may not update.", "error");
        await refreshCurrentPage();
        return;
      }
      showMessage(err.data && err.data.error || err.message || "Could not unenroll.", "error");
    }
  }
  async function enrollSpecialization(specId, silent) {
    if (!specId || !requireLogin()) return false;
    try {
      await apiAny([
        `/api/specializations/${encodeURIComponent(specId)}/enroll`,
        `/api/enrollments/specialization/${encodeURIComponent(specId)}`,
        "/api/specialization-enrollments"
      ], {
        method: "POST",
        body: JSON.stringify({ spec_id: specId, specialization_id: specId }),
        action: !silent,
        silentUnauthorized: Boolean(silent)
      });
      if (!silent) showMessage("Specialization enrolled successfully.", "success");
      if (!silent) await refreshCurrentPage();
      return true;
    } catch (err) {
      if (!silent) showMessage(err.data && err.data.error || err.message || "Could not enroll specialization.", "error");
      return false;
    }
  }
  async function unenrollSpecialization(specId) {
    if (!specId || !requireLogin()) return;
    try {
      await apiAny([
        `/api/specializations/${encodeURIComponent(specId)}/enroll`,
        `/api/enrollments/specialization/${encodeURIComponent(specId)}`,
        "/api/specialization-enrollments"
      ], {
        method: "DELETE",
        body: JSON.stringify({ spec_id: specId, specialization_id: specId }),
        action: true
      });
      showMessage("Specialization unenrolled successfully.", "success");
      await refreshCurrentPage();
    } catch (err) {
      showMessage(err.data && err.data.error || err.message || "Could not unenroll specialization.", "error");
    }
  }
  async function trackCourseOpened(courseId, silent) {
    if (!courseId || !token()) return false;
    markLocal("course_opened", courseId, true);
    markLocal("course_enrollments", courseId, true);
    try {
      await apiAny([
        `/api/courses/${encodeURIComponent(courseId)}/open`,
        `/api/courses/${encodeURIComponent(courseId)}/track`,
        "/api/progress/course-opened",
        "/api/progress/open-course"
      ], {
        method: "POST",
        body: JSON.stringify({ course_id: courseId }),
        redirectOnUnauthorized: false,
        silentUnauthorized: silent !== false
      });
      return true;
    } catch (_) {
      return false;
    }
  }
  async function autoEnrollCourse(courseId) {
    if (!courseId || !token()) return false;
    await enrollCourse(courseId, true);
    await trackCourseOpened(courseId, true);
    return true;
  }
  async function openCourse(courseId) {
    if (!courseId) return;
    if (token()) await autoEnrollCourse(courseId);
    go(route("courses", { id: courseId }));
  }
  async function refreshCurrentPage() {
    const p = pageKey();
    if (p.includes("course")) {
      await loadCourses();
      await loadCourseDetails();
    }
    if (p.includes("special")) {
      await loadSpecializations();
      await loadSpecializationDetails();
    }
    if (p.includes("profile")) await loadProfile();
    if (p.includes("admin")) await loadAdmin();
  }
  function normalizeQuizList(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    return [input];
  }
  function renderQuizSection(quizData, courseId) {
    const quizzes = normalizeQuizList(quizData);
    if (!quizzes.length) {
      return `
        <section class="detail-section">
          <h2>Course Quiz</h2>
          <div class="empty-state">No quizzes were added for this course yet.</div>
        </section>
      `;
    }
    return `
      <section class="detail-section quiz-section">
        <h2>Course Quiz</h2>
        ${quizzes.map((quiz, index) => renderQuiz(quiz, courseId, index)).join("")}
      </section>
    `;
  }
  function renderQuiz(quiz, courseId, index) {
    const questions = quiz.questions || quiz.items || quiz.quiz_questions || quiz.quizQuestions || [];
    const quizId = itemId(quiz) || "local-" + index;
    if (!Array.isArray(questions) || !questions.length) {
      return `<article class="quiz-card"><h3>${escapeHtml(quiz.title || quiz.name || "Quiz")}</h3><p>No questions were added yet.</p></article>`;
    }
    return `
      <form class="quiz-form card" data-quiz-id="${escapeAttr(quizId)}" data-course-id="${escapeAttr(courseId || pick(quiz, ["course_id"], ""))}">
        <h3>${escapeHtml(quiz.title || quiz.name || "Quiz")}</h3>
        ${questions.map((question, qi) => {
          const questionId = itemId(question) || qi;
          const options = question.options || [
            question.option1,
            question.option2,
            question.option3,
            question.option4,
            question.option_a,
            question.option_b,
            question.option_c,
            question.option_d
          ].filter(Boolean);
          return `
            <fieldset class="question-card" data-question-id="${escapeAttr(questionId)}">
              <legend>${qi + 1}. ${escapeHtml(pick(question, ["question", "text", "title"], "Question"))}</legend>
              ${options.map((option, oi) => `
                <label class="option-row">
                  <input type="radio" name="q_${escapeAttr(questionId)}" value="${escapeAttr(option)}" ${oi === 0 ? "required" : ""}>
                  <span>${escapeHtml(option)}</span>
                </label>
              `).join("")}
            </fieldset>
          `;
        }).join("")}
        <button type="submit" class="btn btn-primary">Submit Quiz</button>
        <div class="quiz-result"></div>
      </form>
    `;
  }
  function bindQuizForms() {
    qsa(".quiz-form").forEach((form) => {
      if (form.dataset.boundQuiz) return;
      form.dataset.boundQuiz = "1";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!requireLogin()) return;
        const submit = qs("button[type='submit']", form);
        const resultBox = qs(".quiz-result", form);
        const quizId = form.dataset.quizId;
        const courseId = form.dataset.courseId;
        const answers = qsa(".question-card", form).map((card) => ({
          question_id: card.dataset.questionId,
          answer: qs("input:checked", card) ? qs("input:checked", card).value : ""
        })).filter((x) => x.answer);
        setLoading(submit, true, "Submitting...");
        try {
          const result = await apiAny([
            `/api/quizzes/${encodeURIComponent(quizId)}/submit`,
            `/api/quiz/${encodeURIComponent(quizId)}/submit`,
            "/api/quiz-attempts",
            "/api/quizzes/submit"
          ], {
            method: "POST",
            body: JSON.stringify({ quiz_id: quizId, course_id: courseId, answers }),
            action: true
          });
          const score = result.score || result.percentage || result.result || result.match_percentage || 0;
          if (resultBox) {
            resultBox.innerHTML = `
              <div class="result-card success">
                ${circleStat(score, "Quiz Score")}
                <div><h3>${escapeHtml(result.message || "Quiz submitted")}</h3><p>${escapeHtml(result.feedback || "Your score was saved and progress was updated.")}</p></div>
              </div>
            `;
          }
          showMessage("Quiz submitted.", "success");
          await trackCourseOpened(courseId, true);
        } catch (err) {
          showMessage(err.data && err.data.error || err.message || "Could not submit quiz.", "error");
        } finally {
          setLoading(submit, false);
        }
      });
    });
  }
  async function loadQuizPage() {
    const box = byId("quizBox") || byId("quizzesBox") || byId("quizList") || byId("quizzes");
    if (!box) return;
    try {
      box.innerHTML = `<div class="loading-card">Loading quizzes...</div>`;
      const list = await getQuizzes("");
      STATE.quizzes = list;
      if (!list.length) {
        box.innerHTML = `<div class="empty-state">No quizzes were added yet.</div>`;
        return;
      }
      box.innerHTML = renderQuizSection(list, param("course_id") || "");
      bindQuizForms();
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load quizzes.</div>`;
    }
  }
  function jobCard(job) {
    const jid = itemId(job);
    const title = pick(job, ["title", "name", "job_title"], "Job");
    const desc = pick(job, ["description", "summary"], "");
    const salary = pick(job, ["salary", "average_salary"], "");
    const spec = pick(job, ["specialization", "specialization_name"], "");
    const linkUrl = pick(job, ["link", "url", "job_url"], "");
    return `
      <article class="card job-card clickable" data-link="${route("jobDetails", { id: jid })}">
        <div class="card-body">
          <div class="card-title-row"><h2>${escapeHtml(title)}</h2></div>
          <div class="chip-row">${spec ? badge(spec, "badge badge-soft") : ""}${salary ? badge(salary, "badge") : ""}</div>
          <p>${escapeHtml(desc)}</p>
          <div class="card-actions">
            ${button("View Details", "btn btn-primary", `data-no-card-click data-open-job="${escapeAttr(jid)}"`)}
            ${linkUrl ? link("Open Job", asset(linkUrl), "btn btn-soft", "target=\"_blank\" rel=\"noopener\" data-no-card-click") : ""}
          </div>
        </div>
      </article>
    `;
  }
  async function getJobById(jobId) {
    let result = {};
    let job = null;
    try {
      result = await apiAny([
        `/api/jobs/${encodeURIComponent(jobId)}`,
        `/api/job/${encodeURIComponent(jobId)}`,
        `/api/job-details/${encodeURIComponent(jobId)}`
      ], { redirectOnUnauthorized: false, silentUnauthorized: true });
      job = result.job || result.item || result.data || result;
    } catch (_) {
      result = {};
    }
    if (!job || !itemId(job)) {
      const allJobs = STATE.jobs.length ? STATE.jobs : await getJobs();
      STATE.jobs = allJobs;
      job = allJobs.find((item) => String(itemId(item)) === String(jobId)) || null;
    }
    return job;
  }
  async function loadJobs() {
    const selectedJid = param("id") || param("job_id");
    const detailsBox = byId("jobDetails") || byId("jobDetail") || byId("jobBox") || byId("selectedJob");
    const box = byId("jobsBox") || byId("jobsList") || byId("jobs");
    if (selectedJid && !detailsBox && box) {
      box.classList.remove("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading job details...</div>`;
      return;
    }
    if (!box) return;
    try {
      box.classList.add("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading jobs...</div>`;
      const list = await getJobs();
      STATE.jobs = list;
      if (!list.length) {
        box.innerHTML = `<div class="empty-state">No jobs were added yet.</div>`;
        return;
      }
      box.innerHTML = list.map(jobCard).join("");
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load jobs.</div>`;
    }
  }
  async function loadJobDetails() {
    const jid = param("id") || param("job_id");
    const fallbackBox = byId("jobsBox") || byId("jobsList") || byId("jobs");
    const box = byId("jobDetails") || byId("jobDetail") || byId("jobBox") || byId("selectedJob") || fallbackBox;
    if (!box || !jid) return;
    try {
      box.classList.remove("grid", "cards-3");
      box.innerHTML = `<div class="loading-card">Loading job...</div>`;
      const job = await getJobById(jid);
      if (!job || !itemId(job)) {
        box.innerHTML = `<div class="empty-state">Job not found.</div>`;
        return;
      }
      const title = pick(job, ["title", "name", "job_title"], "Job");
      const desc = pick(job, ["description", "summary"], "");
      const salary = pick(job, ["salary", "average_salary"], "");
      const spec = pick(job, ["specialization", "specialization_name"], "");
      const linkUrl = asset(pick(job, ["link", "url", "job_url"], ""));
      const skills = asArray(pick(job, ["skills", "required_skills", "skill_list"], []));
      box.innerHTML = `
        <section class="job-detail-card">
          <div class="job-detail-hero">
            <div>
              <span class="eyebrow">Job Details</span>
              <h1>${escapeHtml(title)}</h1>
              <div class="chip-row">${spec ? badge(spec, "badge badge-soft") : ""}${salary ? badge(salary, "badge") : ""}</div>
              <p>${escapeHtml(desc || "No description added yet.")}</p>
              <div class="card-actions">
                ${linkUrl ? link("Apply / Open Job", linkUrl, "btn btn-primary", "target=\"_blank\" rel=\"noopener\"") : ""}
                ${link("Back to Jobs", route("jobs"), "btn btn-soft")}
              </div>
            </div>
            <aside class="detail-list">
              <article><h3>Specialization</h3><p>${escapeHtml(spec || "Not linked yet")}</p></article>
              <article><h3>Average Salary</h3><p>${escapeHtml(salary || "Not specified")}</p></article>
            </aside>
          </div>
          ${skills.length ? `<section class="detail-section"><h2>Required Skills</h2><div class="chip-row">${skills.map((skill) => badge(skill, "badge badge-soft")).join("")}</div></section>` : ""}
        </section>
      `;
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load job details.</div>`;
    }
  }
  async function loadRecommendationQuiz() {
    const box = byId("recommendationQuiz") || byId("recQuiz") || byId("recommendationQuestions");
    if (!box) return;
    if (!requireLogin()) return;
    try {
      const result = await apiAny(["/api/recommendation/quiz", "/api/recommendations/quiz"], { silentUnauthorized: false });
      STATE.recommendationQuiz = result;
      const questions = result.questions || [];
      box.innerHTML = `
        <form id="recommendationQuizForm" class="card recommendation-form">
          <h2>${escapeHtml(result.title || "Recommendation Test")}</h2>
          <p>${escapeHtml(result.description || "Answer the questions to get a specialization recommendation.")}</p>
          ${questions.map((question, index) => `
            <fieldset class="question-card" data-question="${escapeAttr(question.question || question.text || "Question")}">
              <legend>${index + 1}. ${escapeHtml(question.question || question.text || "Question")}</legend>
              ${(question.options || []).map((option, oi) => `
                <label class="option-row"><input type="radio" name="rec_${index}" value="${escapeAttr(option)}" ${oi === 0 ? "required" : ""}><span>${escapeHtml(option)}</span></label>
              `).join("")}
            </fieldset>
          `).join("")}
          <label>Extra interests or work style</label>
          <textarea name="work_style" placeholder="Write anything you want the AI to consider..."></textarea>
          <button type="submit" class="btn btn-primary">Get Recommendation</button>
        </form>
      `;
      bindRecommendationForm();
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load recommendation test.</div>`;
    }
  }
  function setupRecommendation() {
    loadRecommendationQuiz();
    bindRecommendationForm();
    const form = byId("recForm") || byId("recommendationForm") || qs("form[data-form='recommendation']");
    if (!form || form.dataset.boundLegacyRec) return;
    form.dataset.boundLegacyRec = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      await submitRecommendation(formPayload(form));
    });
  }
  function bindRecommendationForm() {
    const form = byId("recommendationQuizForm");
    if (!form || form.dataset.boundRecQuiz) return;
    form.dataset.boundRecQuiz = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const answers = qsa(".question-card", form).map((card) => ({
        question: card.dataset.question || "Question",
        answer: qs("input:checked", card) ? qs("input:checked", card).value : ""
      })).filter((x) => x.answer);
      const workStyle = clean(qs("textarea[name='work_style']", form) && qs("textarea[name='work_style']", form).value);
      if (workStyle) answers.push({ question: "Extra interests or work style", answer: workStyle });
      await submitRecommendation({ answers });
    });
  }
  async function submitRecommendation(payload) {
    const box = byId("recommendationResult") || byId("recResult") || container(["recommendationResult"], ".container, main, body", "recommendation-result");
    const submit = qs("#recommendationQuizForm button[type='submit'], #recForm button[type='submit'], #recommendationForm button[type='submit']");
    setLoading(submit, true, "Analyzing...");
    try {
      const result = await apiAny(["/api/recommendation", "/api/recommendation/submit", "/api/recommendations", "/api/recommendations/analyze"], {
        method: "POST",
        body: JSON.stringify(payload),
        action: true
      });
      const recs = result.recommended_specializations || result.recommendations || result.items || [];
      box.innerHTML = `
        <section class="card result-card">
          <h2>${escapeHtml(result.best_match ? "Best Match: " + result.best_match : "Your Recommendation")}</h2>
          <p>${escapeHtml(result.summary || result.message || "Recommendation generated.")}</p>
          <div class="grid cards-3">
            ${recs.map((rec) => `
              <article class="mini-card">
                ${circleStat(rec.match_percentage || rec.match_score || rec.score || 0, "Match")}
                <h3>${escapeHtml(rec.name || rec.title || "Specialization")}</h3>
                <p>${escapeHtml(rec.reason || rec.explanation || "")}</p>
                <div class="chip-row">${asArray(rec.skills_to_learn || rec.skills).slice(0, 6).map((skill) => badge(skill, "badge badge-soft")).join("")}</div>
                ${rec.specialization_id || rec.id ? link("Open Specialization", route("specializations", { id: rec.specialization_id || rec.id }), "btn btn-primary") : ""}
              </article>
            `).join("")}
          </div>
        </section>
      `;
      showMessage("Recommendation generated.", "success");
    } catch (err) {
      showMessage(err.data && err.data.error || err.message || "Recommendation failed.", "error");
    } finally {
      setLoading(submit, false);
    }
  }
  function setupATS() {
    const checkerForm = byId("atsCheckForm") || byId("atsCheckerForm") || qs("form[data-form='ats-check']");
    const generatorForm = byId("atsGenerateForm") || byId("atsGeneratorForm") || qs("form[data-form='ats-generate']");
    if (checkerForm) setupATSChecker(checkerForm);
    if (generatorForm) setupATSGenerator(generatorForm);
    enforceATSUploadOnly();
  }
  function enforceATSUploadOnly() {
    const fileInputs = qsa("input[type='file'][name='resume'], input[type='file']#resume, input[type='file']#resumeFile");
    fileInputs.forEach((input) => {
      input.setAttribute("accept", ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    });
    qsa("textarea[name='resume_text'], #resume_text, #resumeText").forEach((field) => {
      if (field.closest("#atsCheckForm, #atsCheckerForm, [data-form='ats-check']")) {
        field.closest("label, div, .form-group")?.remove();
      }
    });
  }
  function setupATSChecker(form) {
    if (form.dataset.boundAtsChecker) return;
    form.dataset.boundAtsChecker = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const fileInput = firstElement(["input[type='file'][name='resume']", "#resume", "#resumeFile", "input[type='file']"], form);
      if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        showMessage("Upload a PDF or DOCX resume first.", "error");
        return;
      }
      const fileName = lower(fileInput.files[0].name);
      if (!fileName.endsWith(".pdf") && !fileName.endsWith(".docx")) {
        showMessage("Only PDF or DOCX files are allowed.", "error");
        return;
      }
      const submit = qs("button[type='submit'], button:not([type])", form);
      const output = byId("atsCheckResult") || byId("atsResult") || container(["atsCheckResult"], ".container, main, body", "ats-result");
      const fd = new FormData(form);
      setLoading(submit, true, "Checking...");
      try {
        const result = await apiAny(["/api/ats/check", "/api/ats/analyze", "/api/ats/upload", "/api/ats/resume-check"], {
          method: "POST",
          body: fd,
          action: true
        });
        renderATSResult(output, result);
        showMessage("ATS check completed.", "success");
      } catch (err) {
        showMessage(err.data && err.data.error || err.message || "ATS checker failed.", "error");
      } finally {
        setLoading(submit, false);
      }
    });
  }
  function setupATSGenerator(form) {
    if (form.dataset.boundAtsGenerator) return;
    form.dataset.boundAtsGenerator = "1";
    markRequiredFields(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const submit = qs("button[type='submit'], button:not([type])", form);
      const output = byId("atsGenerateResult") || byId("generatedResume") || byId("atsResult") || container(["atsGenerateResult"], ".container, main, body", "ats-result");
      setLoading(submit, true, "Generating...");
      try {
        const result = await apiAny(["/api/ats/generate"], {
          method: "POST",
          body: JSON.stringify(formPayload(form)),
          action: true
        });
        const resume = result.resume || result.generated_resume || result.text || "";
        output.innerHTML = `
          <section class="card result-card">
            <div class="result-header">
              <h2>Generated ATS Resume</h2>
              ${circleStat(result.ats_score || result.score || 0, "ATS")}
            </div>
            ${result.enhanced_summary ? `<section class="summary-box"><h3>Enhanced Summary</h3><p>${escapeHtml(result.enhanced_summary)}</p></section>` : ""}
            <textarea id="generatedResumeText" class="resume-output" readonly>${escapeHtml(resume)}</textarea>
            <div class="card-actions">
              ${button("Export PDF", "btn btn-primary", "data-export-resume=\"pdf\"")}
              ${button("Export DOCX", "btn btn-soft", "data-export-resume=\"docx\"")}
            </div>
          </section>
        `;
        showMessage("ATS resume generated.", "success");
      } catch (err) {
        showMessage(err.data && err.data.error || err.message || "ATS generator failed.", "error");
      } finally {
        setLoading(submit, false);
      }
    });
  }
  function markRequiredFields(root) {
    qsa("input[required], textarea[required], select[required]", root || document).forEach((field) => {
      const idValue = field.id;
      const label = idValue ? qs(`label[for='${CSS.escape(idValue)}']`) : field.closest("label");
      if (label && !label.querySelector(".required-star")) {
        const star = document.createElement("span");
        star.className = "required-star";
        star.textContent = " *";
        label.appendChild(star);
      }
    });
  }
  function renderATSResult(output, result) {
    const score = result.ats_score || result.score || result.percentage || 0;
    const matched = result.matched_keywords || result.matches || [];
    const missing = result.missing_keywords || result.missing || [];
    output.innerHTML = `
      <section class="card result-card">
        <div class="result-header">
          <h2>ATS Result</h2>
          ${circleStat(score, "ATS Score")}
        </div>
        <p>${escapeHtml(result.summary || result.message || "Resume analysis completed.")}</p>
        <div class="grid cards-2">
          <div class="mini-card"><h3>Matched Keywords</h3><div class="chip-row">${asArray(matched).map((x) => badge(x, "badge badge-success")).join("") || "None"}</div></div>
          <div class="mini-card"><h3>Missing Keywords</h3><div class="chip-row">${asArray(missing).slice(0, 20).map((x) => badge(x, "badge badge-danger")).join("") || "None"}</div></div>
        </div>
      </section>
    `;
  }
  async function exportResume(format) {
    if (!requireLogin()) return;
    const textArea = byId("generatedResumeText") || byId("resumeOutput") || qs("textarea.resume-output");
    const resume = clean(textArea && textArea.value);
    if (!resume) {
      showMessage("Generate a resume first.", "error");
      return;
    }
    try {
      const response = await fetch(API + `/api/ats/export/${format}`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ resume })
      });
      if (!response.ok) {
        const data = await parseResponse(response);
        throw new Error(data.error || "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = format === "docx" ? "SQR_Resume.docx" : "SQR_Resume.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showMessage("Resume exported.", "success");
    } catch (err) {
      showMessage(err.message || "Export failed.", "error");
    }
  }
  function selectOptions(items, selected) {
    return `<option value="">Select</option>` + (items || []).map((item) => {
      const value = itemId(item);
      const title = pick(item, ["name", "title", "course_name", "specialization_name"], "Item");
      return `<option value="${escapeAttr(value)}" ${String(value) === String(selected || "") ? "selected" : ""}>${escapeHtml(title)}</option>`;
    }).join("");
  }

  function setupAdminTabs() {
    const buttons = qsa("[data-admin-tab]");
    const sections = qsa(".admin-section[id]");
    if (!buttons.length || !sections.length) return;
    const activate = (name) => {
      buttons.forEach((btn) => btn.classList.toggle("active", btn.dataset.adminTab === name));
      sections.forEach((section) => section.classList.toggle("active", section.id === name));
      try { localStorage.setItem("sqr_admin_tab", name); } catch (_) {}
    };
    buttons.forEach((btn) => {
      if (btn.dataset.boundAdminTab) return;
      btn.dataset.boundAdminTab = "1";
      btn.addEventListener("click", () => activate(btn.dataset.adminTab));
    });
    const saved = localStorage.getItem("sqr_admin_tab");
    const first = buttons[0] && buttons[0].dataset.adminTab;
    activate(saved && byId(saved) ? saved : first);
  }

  async function loadAdmin() {
    const adminRoot = byId("adminApp") || byId("adminDashboard") || (pageKey() === "admin.html" ? qs("main, .container, body") : null);
    if (!adminRoot) return;
    if (!requireAdmin()) return;
    setupAdminTabs();
    try {
      await Promise.allSettled([
        loadAdminStats(),
        loadAdminCollections()
      ]);
      setupAdminForms();
      setupAdminTabs();
    } catch (_) {
      setupAdminForms();
      setupAdminTabs();
    }
  }
  async function loadAdminStats() {
    const box = byId("adminStats") || byId("statsBox") || byId("websiteStats");
    if (!box) return;
    try {
      const stats = await apiAny(["/api/admin/stats", "/api/stats"], { silentUnauthorized: false });
      STATE.stats = stats;
      const entries = [
        ["Users", stats.users || stats.total_users || 0],
        ["Specializations", stats.specializations || 0],
        ["Courses", stats.courses || 0],
        ["Quizzes", stats.quizzes || 0],
        ["Jobs", stats.jobs || 0],
        ["Certificates", stats.certificates || stats.certifications || 0]
      ];
      box.classList.add("grid", "cards-3", "stats-grid");
      box.innerHTML = entries.map(([label, value]) => `<article class="stat-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");
    } catch (err) {
      const entries = [
        ["Users", STATE.users.length || 0],
        ["Specializations", STATE.specializations.length || 0],
        ["Courses", STATE.courses.length || 0],
        ["Quizzes", STATE.quizzes.length || 0],
        ["Jobs", STATE.jobs.length || 0],
        ["Certificates", STATE.certificates.length || 0]
      ];
      box.classList.add("grid", "cards-3", "stats-grid");
      box.innerHTML = entries.map(([label, value]) => `<article class="stat-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");
    }
  }
  async function loadAdminCollections() {
    const [specs, courses, jobs, certs, quizzes] = await Promise.all([
      getSpecializations().catch(() => []),
      getCourses("").catch(() => []),
      getJobs().catch(() => []),
      getCertificates().catch(() => []),
      getQuizzes("").catch(() => [])
    ]);
    STATE.specializations = specs;
    STATE.courses = courses;
    STATE.jobs = jobs;
    STATE.certificates = certs;
    STATE.quizzes = quizzes;
    fillAdminSelects();
    renderAdminLists();
  }
  function fillAdminSelects() {
    qsa("select[name='spec_id'], select[name='specialization_id'], #spec_id, #specialization_id, #courseSpec, #jobSpec, #certSpec").forEach((select) => {
      select.innerHTML = selectOptions(STATE.specializations, select.value);
    });
    qsa("select[name='course_id'], #course_id, #quizCourse").forEach((select) => {
      select.innerHTML = selectOptions(STATE.courses, select.value);
    });
  }
  function renderAdminLists() {
    const usersBox = byId("usersBox") || byId("usersList");
    if (usersBox) loadUsers(usersBox);
    const coursesBox = byId("adminCoursesList");
    if (coursesBox) coursesBox.innerHTML = STATE.courses.map((c) => `<article class="mini-card"><h3>${escapeHtml(pick(c, ["title", "name"], "Course"))}</h3></article>`).join("");
    const specsBox = byId("adminSpecializationsList");
    if (specsBox) specsBox.innerHTML = STATE.specializations.map((s) => `<article class="mini-card"><h3>${escapeHtml(pick(s, ["name", "title"], "Specialization"))}</h3></article>`).join("");
  }
  async function loadUsers(box) {
    try {
      const result = await apiAny(["/api/admin/users", "/api/users"], { silentUnauthorized: false });
      const users = resultArray(result, ["users"]);
      STATE.users = users;
      if (!users.length) {
        box.innerHTML = `<div class="empty-state">No users found.</div>`;
        return;
      }
      box.innerHTML = `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              ${users.map((user) => `
                <tr>
                  <td>${escapeHtml(user.name || "")}</td>
                  <td>${escapeHtml(user.email || "")}</td>
                  <td>${escapeHtml(user.role || "student")}</td>
                  <td>${user.banned ? "Banned" : "Active"}</td>
                  <td>
                    ${button(user.banned ? "Unban" : "Ban", "btn btn-small btn-danger", `data-ban-user="${escapeAttr(itemId(user))}" data-ban-value="${user.banned ? "0" : "1"}"`)}
                    ${button(user.role === "admin" ? "Make Student" : "Make Admin", "btn btn-small btn-soft", `data-role-user="${escapeAttr(itemId(user))}" data-role-value="${user.role === "admin" ? "student" : "admin"}"`)}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      box.innerHTML = `<div class="error-card">Could not load users.</div>`;
    }
  }
  function setupAdminForms() {
    setupAdminSpecializationForm();
    setupAdminCourseForm();
    setupAdminQuizForm();
    setupAdminJobForm();
    setupAdminCertificateForm();
  }
  function bindAdminForm(form, paths, successMessage, transform) {
    if (!form || form.dataset.boundAdminForm) return;
    form.dataset.boundAdminForm = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireAdmin()) return;
      const submit = qs("button[type='submit'], button:not([type])", form);
      let data = formPayload(form);
      if (typeof transform === "function") data = transform(data, form);
      const body = hasFiles(form) ? toFormData(data) : JSON.stringify(data);
      setLoading(submit, true, "Saving...");
      try {
        await apiAny(paths, { method: "POST", body, action: true });
        showMessage(successMessage || "Saved successfully.", "success");
        form.reset();
        await loadAdminCollections();
        await loadAdminStats();
      } catch (err) {
        showMessage(err.data && err.data.error || err.message || "Could not save.", "error");
      } finally {
        setLoading(submit, false);
      }
    });
  }
  function setupAdminSpecializationForm() {
    const form = byId("specializationForm") || byId("specForm") || byId("addSpecializationForm") || qs("form[data-form='admin-specialization']");
    bindAdminForm(form, ["/api/admin/specializations", "/api/specializations", "/api/specialization"], "Specialization added.");
  }
  function setupAdminCourseForm() {
    const form = byId("courseForm") || byId("addCourseForm") || qs("form[data-form='admin-course']");
    bindAdminForm(form, ["/api/admin/courses", "/api/courses", "/api/course"], "Course added.", (data) => {
      data.spec_id = data.spec_id || data.specialization_id || data.courseSpec;
      data.specialization_id = data.specialization_id || data.spec_id;
      return data;
    });
  }
  function setupAdminQuizForm() {
    const form = byId("quizForm") || byId("addQuizForm") || qs("form[data-form='admin-quiz']");
    if (!form) return;
    ensureQuestionBuilder(form);
    bindAdminForm(form, ["/api/admin/quizzes", "/api/quizzes", "/api/quiz"], "Quiz added.", (data, activeForm) => {
      data.course_id = data.course_id || data.quizCourse;
      data.spec_id = data.spec_id || data.specialization_id || getSpecIdFromCourse(data.course_id);
      data.questions = collectAdminQuestions(activeForm);
      return data;
    });
  }
  function getSpecIdFromCourse(courseId) {
    const course = STATE.courses.find((c) => String(itemId(c)) === String(courseId));
    return course ? pick(course, ["spec_id", "specialization_id"], "") : "";
  }
  function ensureQuestionBuilder(form) {
    let box = byId("questionsBox") || byId("quizQuestions") || qs(".questions-box", form);
    if (!box) {
      box = document.createElement("div");
      box.id = "questionsBox";
      box.className = "questions-box";
      const submit = qs("button[type='submit'], button:not([type])", form);
      form.insertBefore(box, submit || null);
    }
    let add = byId("addQuestionBtn") || qs("[data-add-question]", form);
    if (!add) {
      add = document.createElement("button");
      add.type = "button";
      add.className = "btn btn-soft";
      add.id = "addQuestionBtn";
      add.textContent = "Add Question";
      box.insertAdjacentElement("beforebegin", add);
    }
    if (!box.children.length) addQuestionRow(box);
    if (!add.dataset.boundAddQuestion) {
      add.dataset.boundAddQuestion = "1";
      add.addEventListener("click", () => addQuestionRow(box));
    }
  }
  function addQuestionRow(box) {
    const index = box.children.length + 1;
    const row = document.createElement("div");
    row.className = "question-builder card soft-card";
    row.innerHTML = `
      <h4>Question ${index}</h4>
      <label>Question</label><textarea data-q="question" required></textarea>
      <div class="form-grid">
        <label>Option 1<input data-q="option1" required></label>
        <label>Option 2<input data-q="option2" required></label>
        <label>Option 3<input data-q="option3"></label>
        <label>Option 4<input data-q="option4"></label>
      </div>
      <label>Correct Answer<input data-q="answer" required placeholder="Write the exact correct option"></label>
      <button type="button" class="btn btn-danger btn-small" data-remove-question>Remove</button>
    `;
    row.querySelector("[data-remove-question]").addEventListener("click", () => row.remove());
    box.appendChild(row);
  }
  function collectAdminQuestions(form) {
    return qsa(".question-builder", form).map((row) => ({
      question: clean(qs("[data-q='question']", row) && qs("[data-q='question']", row).value),
      option1: clean(qs("[data-q='option1']", row) && qs("[data-q='option1']", row).value),
      option2: clean(qs("[data-q='option2']", row) && qs("[data-q='option2']", row).value),
      option3: clean(qs("[data-q='option3']", row) && qs("[data-q='option3']", row).value),
      option4: clean(qs("[data-q='option4']", row) && qs("[data-q='option4']", row).value),
      answer: clean(qs("[data-q='answer']", row) && qs("[data-q='answer']", row).value)
    })).filter((q) => q.question && q.option1 && q.option2 && q.answer);
  }
  function setupAdminJobForm() {
    const form = byId("jobForm") || byId("addJobForm") || qs("form[data-form='admin-job']");
    bindAdminForm(form, ["/api/admin/jobs", "/api/jobs", "/api/job"], "Job added.", (data) => {
      const spec = STATE.specializations.find((s) => String(itemId(s)) === String(data.spec_id || data.specialization_id));
      data.specialization = data.specialization || (spec ? pick(spec, ["name", "title"], "") : "");
      return data;
    });
  }
  function setupAdminCertificateForm() {
    const form = byId("certificateForm") || byId("certForm") || byId("addCertificateForm") || qs("form[data-form='admin-certificate']");
    bindAdminForm(form, ["/api/admin/certificates", "/api/certificates", "/api/certifications"], "Certificate added.", (data) => {
      data.spec_id = data.spec_id || data.specialization_id || data.certSpec;
      return data;
    });
  }
  async function banUser(userId, value) {
    if (!requireAdmin()) return;
    try {
      await apiAny([`/api/admin/users/${encodeURIComponent(userId)}/ban`, `/api/users/${encodeURIComponent(userId)}/ban`], {
        method: "PUT",
        body: JSON.stringify({ banned: Number(value) ? 1 : 0 }),
        action: true
      });
      showMessage("User updated.", "success");
      await loadAdminCollections();
    } catch (err) {
      showMessage(err.data && err.data.error || err.message || "Could not update user.", "error");
    }
  }
  async function changeUserRole(userId, role) {
    if (!requireAdmin()) return;
    try {
      await apiAny([`/api/admin/users/${encodeURIComponent(userId)}/role`, `/api/users/${encodeURIComponent(userId)}/role`], {
        method: "PUT",
        body: JSON.stringify({ role }),
        action: true
      });
      showMessage("User role updated.", "success");
      await loadAdminCollections();
    } catch (err) {
      showMessage(err.data && err.data.error || err.message || "Could not update role.", "error");
    }
  }
  function bindGlobalClicks() {
    if (document.body.dataset.boundSqrClicks) return;
    document.body.dataset.boundSqrClicks = "1";
    document.addEventListener("click", async (event) => {
      const logoutBtn = event.target.closest("[data-logout]");
      if (logoutBtn) {
        event.preventDefault();
        logout();
        return;
      }
      const linkBtn = event.target.closest("[data-link]");
      if (linkBtn) {
        event.preventDefault();
        go(linkBtn.dataset.link);
        return;
      }
      const openSpec = event.target.closest("[data-open-specialization]");
      if (openSpec) {
        event.preventDefault();
        go(route("specializations", { id: openSpec.dataset.openSpecialization }));
        return;
      }
      const openCourseBtn = event.target.closest("[data-open-course]");
      if (openCourseBtn) {
        event.preventDefault();
        await openCourse(openCourseBtn.dataset.openCourse);
        return;
      }
      const openJobBtn = event.target.closest("[data-open-job]");
      if (openJobBtn) {
        event.preventDefault();
        go(route("jobDetails", { id: openJobBtn.dataset.openJob }));
        return;
      }
      const enrollCourseBtn = event.target.closest("[data-enroll-course]");
      if (enrollCourseBtn) {
        event.preventDefault();
        await enrollCourse(enrollCourseBtn.dataset.enrollCourse, false);
        return;
      }
      const unenrollCourseBtn = event.target.closest("[data-unenroll-course]");
      if (unenrollCourseBtn) {
        event.preventDefault();
        await unenrollCourse(unenrollCourseBtn.dataset.unenrollCourse);
        return;
      }
      const enrollSpecBtn = event.target.closest("[data-enroll-specialization]");
      if (enrollSpecBtn) {
        event.preventDefault();
        await enrollSpecialization(enrollSpecBtn.dataset.enrollSpecialization, false);
        return;
      }
      const unenrollSpecBtn = event.target.closest("[data-unenroll-specialization]");
      if (unenrollSpecBtn) {
        event.preventDefault();
        await unenrollSpecialization(unenrollSpecBtn.dataset.unenrollSpecialization);
        return;
      }
      const banBtn = event.target.closest("[data-ban-user]");
      if (banBtn) {
        event.preventDefault();
        await banUser(banBtn.dataset.banUser, banBtn.dataset.banValue);
        return;
      }
      const roleBtn = event.target.closest("[data-role-user]");
      if (roleBtn) {
        event.preventDefault();
        await changeUserRole(roleBtn.dataset.roleUser, roleBtn.dataset.roleValue);
        return;
      }
      const exportBtn = event.target.closest("[data-export-resume]");
      if (exportBtn) {
        event.preventDefault();
        await exportResume(exportBtn.dataset.exportResume);
        return;
      }
      const tracked = event.target.closest("[data-track-course]");
      if (tracked) {
        await trackCourseOpened(tracked.dataset.trackCourse, true);
      }
      const card = event.target.closest(".clickable[data-link]");
      if (card && !event.target.closest("a, button, input, select, textarea, [data-no-card-click]")) {
        go(card.dataset.link);
      }
    });
  }
  function bindCourseMediaTracking() {
    qsa("video[data-track-course]").forEach((video) => {
      if (video.dataset.boundTrack) return;
      video.dataset.boundTrack = "1";
      video.addEventListener("play", () => trackCourseOpened(video.dataset.trackCourse, true), { once: true });
      video.addEventListener("ended", () => trackCourseOpened(video.dataset.trackCourse, true));
    });
  }
  function autoBootPage() {
    blockAdminFromStudentPages();
    setupSignup();
    setupSignin();
    setupModeSwitch();
    renderHomeCards();
    loadProfile();
    loadSpecializations();
    loadSpecializationDetails();
    loadCourses();
    loadCourseDetails();
    loadQuizPage();
    loadJobs();
    loadJobDetails();
    setupRecommendation();
    setupATS();
    loadAdmin();
    bindQuizForms();
    bindCourseMediaTracking();
    markRequiredFields(document);
  }
  function boot() {
    ensurePageFixStyles();
    bindGlobalClicks();
    if (!qs(".navbar, .sqr-navbar")) navbar();
    autoBootPage();
  }
  window.SQR = Object.assign(window.SQR || {}, {
    API,
    STATE,
    route,
    go,
    api,
    apiAny,
    showMessage,
    navbar,
    logout,
    requireLogin,
    requireAdmin,
    blockAdminFromStudentPages,
    setupSignup,
    setupSignin,
    loadProfile,
    loadSpecializations,
    loadSpecializationDetails,
    loadCourses,
    loadCourseDetails,
    loadQuizPage,
    loadJobs,
    loadJobDetails,
    setupRecommendation,
    setupATS,
    loadAdmin,
    passwordRules,
    passwordIsValid
  });
  window.navbar = navbar;
  window.logout = logout;
  window.requireLogin = requireLogin;
  window.requireAdmin = requireAdmin;
  window.blockAdminFromStudentPages = blockAdminFromStudentPages;
  window.setupSignup = setupSignup;
  window.setupSignin = setupSignin;
  window.loadProfile = loadProfile;
  window.loadSpecializations = loadSpecializations;
  window.loadSpecializationDetails = loadSpecializationDetails;
  window.loadCourses = loadCourses;
  window.loadCourseDetails = loadCourseDetails;
  window.loadQuizPage = loadQuizPage;
  window.loadJobs = loadJobs;
  window.loadJobDetails = loadJobDetails;
  window.setupRecommendation = setupRecommendation;
  window.setupATS = setupATS;
  window.loadAdmin = loadAdmin;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
