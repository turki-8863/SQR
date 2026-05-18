(() => {
  "use strict";

  const SQR = {
    tokenKeys: ["sqr_token", "sqrToken", "token", "authToken"],
    userKeys: ["sqr_user", "sqrUser", "user"],
    lastResumeText: "",
    me: null,
    booted: false
  };

  const API_BASE = (() => {
    const configured = document.querySelector("meta[name='api-base']")?.content || window.SQR_API_BASE || "";
    return String(configured).replace(/\/$/, "");
  })();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const byId = id => document.getElementById(id);
  const text = value => value == null ? "" : String(value);
  const trim = value => text(value).trim();
  const lower = value => trim(value).toLowerCase();
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const esc = value => text(value).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[ch]));
  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
  const params = () => new URLSearchParams(window.location.search);
  const getParam = (...names) => {
    const p = params();
    for (const name of names) {
      const v = p.get(name);
      if (v !== null && v !== "") return v;
    }
    return "";
  };
  const pageName = () => {
    const raw = window.location.pathname.split("/").pop() || "gp.html";
    if (raw === "") return "gp.html";
    return raw;
  };
  const route = (page, id = "") => id ? `${page}?id=${encodeURIComponent(id)}` : page;
  const isFileValue = value => typeof File !== "undefined" && value instanceof File && value.size > 0;

  function getToken() {
    for (const key of SQR.tokenKeys) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return "";
  }

  function setToken(token) {
    if (!token) return;
    for (const key of SQR.tokenKeys) localStorage.setItem(key, token);
  }

  function clearToken() {
    for (const key of SQR.tokenKeys) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
    for (const key of SQR.userKeys) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
    SQR.me = null;
  }

  function getStoredUser() {
    if (SQR.me) return SQR.me;
    for (const key of SQR.userKeys) {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        SQR.me = JSON.parse(raw);
        return SQR.me;
      } catch (_) {}
    }
    return null;
  }

  function setStoredUser(user) {
    if (!user) return;
    SQR.me = user;
    const raw = JSON.stringify(user);
    for (const key of SQR.userKeys) localStorage.setItem(key, raw);
  }

  function authHeaders(extra = {}) {
    const headers = {...extra};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function messageBox() {
    let box = byId("message") || byId("msg") || byId("alertBox") || $(".message") || $(".alert");
    if (!box) {
      const host = $(".container") || $("main") || document.body;
      box = document.createElement("div");
      box.id = "message";
      host.prepend(box);
    }
    return box;
  }

  function showMessage(message, type = "info", timeout = 5000) {
    if (!message) return;
    const box = messageBox();
    box.className = `sqr-message ${type}`;
    box.innerHTML = esc(message);
    if (timeout) setTimeout(() => {
      if (box.innerHTML === esc(message)) box.innerHTML = "";
    }, timeout);
  }

  function setLoading(el, loading, label = "Loading...") {
    if (!el) return;
    if (loading) {
      el.dataset.oldHtml = el.innerHTML;
      el.disabled = true;
      el.innerHTML = `<span class="sqr-spinner"></span>${esc(label)}`;
    } else {
      el.disabled = false;
      if (el.dataset.oldHtml) el.innerHTML = el.dataset.oldHtml;
    }
  }

  async function api(path, options = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const opts = {...options};
    opts.headers = authHeaders(opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const contentType = res.headers.get("content-type") || "";
    let payload;
    if (contentType.includes("application/json")) {
      payload = await res.json().catch(() => ({}));
    } else {
      payload = await res.text().catch(() => "");
    }
    if (!res.ok) {
      const msg = typeof payload === "string" ? payload : (payload.error || payload.message || `Request failed (${res.status})`);
      const err = new Error(msg);
      err.status = res.status;
      err.payload = payload;
      if (res.status === 401 && getToken()) {
        clearToken();
      }
      throw err;
    }
    return payload;
  }

  const apiGet = path => api(path);
  const apiPost = (path, body = {}) => api(path, {method: "POST", body});
  const apiPut = (path, body = {}) => api(path, {method: "PUT", body});
  const apiDelete = path => api(path, {method: "DELETE"});
  const apiForm = (path, formData, method = "POST") => api(path, {method, body: formData});

  async function downloadApi(path, body, filename) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: authHeaders({"Content-Type": "application/json"}),
      body: JSON.stringify(body || {})
    });
    if (!res.ok) {
      let msg = "Export failed";
      try {
        const j = await res.json();
        msg = j.error || j.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  function currentUserRole() {
    return lower(getStoredUser()?.role || "student");
  }

  function currentUserMode() {
    return lower(getStoredUser()?.current_mode || getStoredUser()?.role || "student");
  }

  function loginPage() {
    return "signin.html";
  }

  function redirectToLogin() {
    const next = window.location.pathname + window.location.search;
    window.location.href = `${loginPage()}?next=${encodeURIComponent(next)}`;
  }

  async function refreshMe(silent = true) {
    if (!getToken()) return null;
    try {
      const data = await apiGet("/api/me");
      setStoredUser(data.user || data);
      return getStoredUser();
    } catch (err) {
      if (!silent) showMessage(err.message, "error");
      return null;
    }
  }

  function formToObject(form) {
    const out = {};
    if (!form) return out;
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (isFileValue(value)) continue;
      if (out[key] !== undefined) {
        if (!Array.isArray(out[key])) out[key] = [out[key]];
        out[key].push(value);
      } else {
        out[key] = value;
      }
    }
    $$("input, textarea, select", form).forEach(el => {
      if (!el.name && el.id && el.type !== "file") out[el.id] = el.value;
    });
    return out;
  }

  function formToData(form) {
    const fd = new FormData(form);
    $$("input, textarea, select", form).forEach(el => {
      if (!el.name && el.id && el.type !== "file") fd.set(el.id, el.value);
    });
    return fd;
  }

  function valueFrom(form, ...names) {
    for (const name of names) {
      const el = form?.elements?.[name] || byId(name) || form?.querySelector(`[name='${name}']`);
      if (el) return trim(el.value);
    }
    return "";
  }

  function itemId(item, ...extra) {
    for (const key of ["id", "specialization_id", "course_id", "quiz_id", "job_id", "certification_id", "user_id", ...extra]) {
      if (item && item[key] != null && item[key] !== "") return item[key];
    }
    return "";
  }

  function imageUrl(item) {
    const url = trim(item?.image_url || item?.image || item?.thumbnail || "");
    if (!url) return "";
    if (url.startsWith("http") || url.startsWith("/")) return url;
    return `/uploads/${url}`;
  }

  function videoUrl(item) {
    const url = trim(item?.video_url || item?.video || item?.media_url || "");
    if (!url) return "";
    if (url.startsWith("http") || url.startsWith("/")) return url;
    return `/uploads/${url}`;
  }

  function externalUrl(url) {
    url = trim(url);
    if (!url) return "";
    if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
    return `https://${url}`;
  }

  function hostContainer(ids, fallbackId) {
    for (const id of ids) {
      const el = byId(id);
      if (el) return el;
    }
    const host = $(".container") || $("main") || document.body;
    const el = document.createElement("div");
    el.id = fallbackId;
    el.className = "sqr-dynamic-block";
    host.appendChild(el);
    return el;
  }

  function emptyState(title, body = "") {
    return `<div class="sqr-empty"><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}</div>`;
  }

  function statCard(label, value) {
    return `<div class="sqr-stat-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function circle(value, label = "Score") {
    const v = clamp(value);
    return `<div class="sqr-circle" style="--value:${v}"><div><strong>${Math.round(v)}%</strong><span>${esc(label)}</span></div></div>`;
  }

  function tags(textOrArray) {
    let arr = Array.isArray(textOrArray) ? textOrArray : text(textOrArray).split(/[,;\n]/);
    arr = arr.map(trim).filter(Boolean).slice(0, 14);
    return arr.length ? `<div class="sqr-tags">${arr.map(t => `<span>${esc(t)}</span>`).join("")}</div>` : "";
  }

  function cardImage(item, label = "SQR") {
    const img = imageUrl(item);
    if (img) return `<div class="sqr-card-media"><img src="${esc(img)}" alt="${esc(item?.name || item?.title || label)}" loading="lazy"></div>`;
    return `<div class="sqr-card-media sqr-card-placeholder"><span>${esc((item?.name || item?.title || label || "SQR").slice(0, 2).toUpperCase())}</span></div>`;
  }


  function injectSqrCriticalStyles() {
    if (byId("sqrCriticalFixStyles")) return;
    const style = document.createElement("style");
    style.id = "sqrCriticalFixStyles";
    style.textContent = `
      :root { --sqr-nav-h: 82px; }
      body { padding-top: 0 !important; }
      #sqrNavbar.sqr-navbar {
        box-sizing: border-box !important;
        position: sticky !important;
        top: 12px !important;
        z-index: 9999 !important;
        width: calc(100% - 32px) !important;
        max-width: 1540px !important;
        min-height: 78px !important;
        margin: 12px auto 28px auto !important;
        padding: 0 !important;
        border-radius: 26px !important;
        border: 1px solid rgba(96, 165, 250, .24) !important;
        background: linear-gradient(135deg, rgba(2, 6, 23, .96), rgba(15, 23, 42, .95), rgba(24, 10, 48, .94)) !important;
        box-shadow: 0 18px 45px rgba(0, 0, 0, .28) !important;
        backdrop-filter: blur(18px) !important;
        overflow: visible !important;
      }
      #sqrNavbar .sqr-nav-inner {
        box-sizing: border-box !important;
        width: 100% !important;
        min-height: 78px !important;
        padding: 14px 20px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 16px !important;
        flex-wrap: nowrap !important;
      }
      #sqrNavbar .sqr-brand {
        flex: 0 0 auto !important;
        min-width: 128px !important;
        text-decoration: none !important;
        display: grid !important;
        line-height: 1 !important;
      }
      #sqrNavbar .sqr-brand span {
        font-weight: 900 !important;
        font-size: 1.45rem !important;
        letter-spacing: .09em !important;
        background: linear-gradient(90deg, #38bdf8, #a78bfa) !important;
        -webkit-background-clip: text !important;
        background-clip: text !important;
        color: transparent !important;
      }
      #sqrNavbar .sqr-brand small {
        color: rgba(226, 232, 240, .78) !important;
        font-weight: 700 !important;
        letter-spacing: .03em !important;
        margin-top: 6px !important;
      }
      #sqrNavbar .sqr-nav-toggle {
        display: none !important;
        width: 44px !important;
        height: 44px !important;
        border-radius: 16px !important;
        border: 1px solid rgba(148, 163, 184, .28) !important;
        background: rgba(15, 23, 42, .82) !important;
        color: #e5e7eb !important;
        font-size: 1.2rem !important;
        cursor: pointer !important;
      }
      #sqrNavbar .sqr-nav-links {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        flex-wrap: wrap !important;
      }
      #sqrNavbar .sqr-nav-links a {
        display: inline-flex !important;
        align-items: center !important;
        min-height: 38px !important;
        padding: 9px 14px !important;
        border-radius: 999px !important;
        color: rgba(226, 232, 240, .92) !important;
        text-decoration: none !important;
        font-size: .95rem !important;
        font-weight: 800 !important;
        letter-spacing: .01em !important;
        white-space: nowrap !important;
        border: 1px solid transparent !important;
        transition: .18s ease !important;
      }
      #sqrNavbar .sqr-nav-links a:hover,
      #sqrNavbar .sqr-nav-links a.active {
        color: #fff !important;
        background: rgba(59, 130, 246, .22) !important;
        border-color: rgba(96, 165, 250, .25) !important;
      }
      #sqrNavbar .sqr-nav-actions {
        flex: 0 0 auto !important;
        display: flex !important;
        align-items: center !important;
        justify-content: flex-end !important;
        gap: 10px !important;
        white-space: nowrap !important;
      }
      #sqrNavbar .sqr-profile-pill {
        color: #f8fafc !important;
        text-decoration: none !important;
        max-width: 150px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        font-weight: 800 !important;
      }
      #sqrNavbar .sqr-btn,
      #sqrNavbar button.sqr-btn {
        min-height: 40px !important;
        padding: 9px 16px !important;
        border-radius: 999px !important;
        font-weight: 900 !important;
        border: 1px solid rgba(148, 163, 184, .24) !important;
        cursor: pointer !important;
        text-decoration: none !important;
      }
      #sqrNavbar .sqr-btn.ghost { background: rgba(255,255,255,.92) !important; color: #020617 !important; }
      #sqrNavbar .sqr-btn.primary { background: linear-gradient(135deg, #2563eb, #7c3aed) !important; color: #fff !important; }
      .sqr-panel, .card, .glass-card { scroll-margin-top: 110px !important; }
      #sqrNavbar .sqr-nav-toggle { display: none !important; visibility: hidden !important; }
      #sqrNavbar .sqr-nav-links { display: flex !important; visibility: visible !important; }
      @media (min-width: 721px) {
        #sqrNavbar .sqr-nav-inner { flex-wrap: nowrap !important; }
        #sqrNavbar .sqr-nav-toggle { display: none !important; visibility: hidden !important; }
        #sqrNavbar .sqr-nav-links { display: flex !important; visibility: visible !important; flex-basis: auto !important; }
      }
      @media (max-width: 720px) {
        #sqrNavbar.sqr-navbar { width: calc(100% - 18px) !important; top: 8px !important; margin-bottom: 18px !important; }
        #sqrNavbar .sqr-nav-inner { flex-wrap: wrap !important; padding: 12px !important; }
        #sqrNavbar .sqr-nav-toggle { display: inline-flex !important; visibility: visible !important; align-items: center !important; justify-content: center !important; order: 2 !important; }
        #sqrNavbar .sqr-brand { order: 1 !important; }
        #sqrNavbar .sqr-nav-actions { order: 3 !important; margin-left: auto !important; }
        #sqrNavbar .sqr-nav-links { order: 4 !important; flex-basis: 100% !important; display: none !important; visibility: visible !important; justify-content: flex-start !important; padding-top: 8px !important; }
        #sqrNavbar.open .sqr-nav-links { display: flex !important; }
        #sqrNavbar .sqr-nav-links a { flex: 1 1 calc(50% - 8px) !important; justify-content: center !important; }
      }
      @media (max-width: 560px) {
        #sqrNavbar .sqr-profile-pill { max-width: 96px !important; }
        #sqrNavbar .sqr-nav-actions { width: 100% !important; justify-content: space-between !important; }
        #sqrNavbar .sqr-nav-links a { flex-basis: 100% !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function inferFieldValue(form, patterns) {
    const inputs = $$("input, textarea, select", form);
    for (const el of inputs) {
      if (el.type === "file") continue;
      const label = el.id ? (document.querySelector(`label[for='${CSS.escape(el.id)}']`)?.textContent || "") : "";
      const meta = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), label].filter(Boolean).join(" ").toLowerCase();
      if (patterns.some(p => p.test(meta)) && trim(el.value)) return trim(el.value);
    }
    return "";
  }

  function firstPayloadValue(payload, form, keys, patterns = []) {
    for (const key of keys) {
      if (trim(payload[key])) return trim(payload[key]);
      const v = valueFrom(form, key);
      if (v) return v;
    }
    return patterns.length ? inferFieldValue(form, patterns) : "";
  }

  function normalizeAtsGeneratePayload(payload, form) {
    payload.name = firstPayloadValue(payload, form, ["name", "full_name", "fullName", "fullname", "full-name"], [/full\s*name/, /^name$/]);
    payload.email = firstPayloadValue(payload, form, ["email", "email_address", "emailAddress"], [/email/]);
    payload.phone = firstPayloadValue(payload, form, ["phone", "phone_number", "phoneNumber", "mobile"], [/phone/, /mobile/]);
    payload.location = firstPayloadValue(payload, form, ["location", "city", "address"], [/location/, /city/, /address/]);
    payload.target_job = firstPayloadValue(payload, form, ["target_job", "targetJob", "target_role", "targetRole", "job_title", "jobTitle", "role", "position", "desired_role", "desiredRole"], [/target\s*(job|role)/, /job\s*title/, /desired\s*role/, /position/]);
    payload.skills = firstPayloadValue(payload, form, ["skills", "technical_skills", "technicalSkills", "tech_skills", "techSkills", "technical", "technologies", "tools", "programming_languages", "programmingLanguages"], [/technical\s*skills/, /\bskills\b/, /technolog/, /tools/, /programming/]);
    payload.soft_skills = firstPayloadValue(payload, form, ["soft_skills", "softSkills", "soft", "personal_skills"], [/soft\s*skills/, /personal\s*skills/]);
    payload.linkedin = firstPayloadValue(payload, form, ["linkedin", "linkedIn", "linkedin_url", "linkedinUrl", "portfolio", "website", "links", "linkedin_portfolio", "linkedinPortfolio"], [/linkedin/, /portfolio/, /github/, /website/, /links?/]);
    payload.summary = firstPayloadValue(payload, form, ["summary", "professional_summary", "professionalSummary", "profile", "about"], [/summary/, /profile/, /about/]);
    payload.education = firstPayloadValue(payload, form, ["education", "degree", "university", "college"], [/education/, /degree/, /university/, /college/]);
    payload.experience = firstPayloadValue(payload, form, ["experience", "work_experience", "workExperience", "employment", "internship"], [/experience/, /employment/, /internship/]);
    payload.projects = firstPayloadValue(payload, form, ["projects", "project", "portfolio_projects"], [/projects?/]);
    payload.certifications = firstPayloadValue(payload, form, ["certifications", "certificates", "certificate"], [/certif/, /certificate/]);
    payload.job_description = firstPayloadValue(payload, form, ["job_description", "jobDescription", "description", "target_description", "targetDescription"], [/job\s*description/, /target\s*description/]);
    return payload;
  }

  function navLink(page, label, aliases = []) {
    const current = lower(pageName());
    const active = [page, ...aliases].some(p => lower(p) === current) ? "active" : "";
    return `<a class="${active}" href="${esc(page)}">${esc(label)}</a>`;
  }

  function navbar() {
    injectSqrCriticalStyles();
    const run = () => {
      if (byId("sqrNavbar")) return;
      const user = getStoredUser();
      const logged = Boolean(getToken());
      const isAdmin = lower(user?.role) === "admin";
      const nav = document.createElement("nav");
      nav.id = "sqrNavbar";
      nav.className = "sqr-navbar";
      const studentLinks = [
        navLink("gp.html", "Home", ["", "home"]),
        navLink("Specialization.html", "Specializations", ["Sepecialization.html", "specializations"]),
        navLink("Courses.html", "Courses", ["courses.html", "courses"]),
        navLink("Quiz.html", "Quizzes", ["quizzes"]),
        navLink("jobs.html", "Jobs", ["jobs"]),
        navLink("recommendation.html", "Recommendation", ["recommendation"]),
        navLink("ATS.html", "ATS", ["ats.html", "ats"])
      ].join("");
      const adminLinks = `${navLink("admin.html", "Admin", ["admin"])}${navLink("profile.html", "Profile", ["profile"])}`;
      nav.innerHTML = `
        <div class="sqr-nav-inner">
          <a class="sqr-brand" href="${isAdmin ? "admin.html" : "gp.html"}"><span>SQR</span><small>Skill Quest Road</small></a>
          <button class="sqr-nav-toggle" type="button" aria-label="Open navigation">☰</button>
          <div class="sqr-nav-links">${isAdmin ? adminLinks : studentLinks}</div>
          <div class="sqr-nav-actions">
            ${logged ? `<a class="sqr-profile-pill" href="profile.html">${esc(user?.name || "Profile")}</a><button type="button" id="logoutBtn" class="sqr-btn ghost">Logout</button>` : `<a class="sqr-btn ghost" href="signin.html">Sign In</a><a class="sqr-btn primary" href="signup.html">Sign Up</a>`}
          </div>
        </div>`;
      document.body.prepend(nav);
      $(".sqr-nav-toggle", nav)?.addEventListener("click", () => nav.classList.toggle("open"));
      byId("logoutBtn")?.addEventListener("click", () => {
        clearToken();
        window.location.href = "signin.html";
      });
    };
    if (document.body) run(); else document.addEventListener("DOMContentLoaded", run, {once: true});
  }

  async function requireLogin() {
    if (!getToken()) {
      redirectToLogin();
      return false;
    }
    const user = await refreshMe(true);
    if (!user) {
      redirectToLogin();
      return false;
    }
    navbar();
    return true;
  }

  async function requireAdmin() {
    const ok = await requireLogin();
    if (!ok) return false;
    const user = getStoredUser();
    if (lower(user?.role) !== "admin") {
      showMessage("Admin access only.", "error");
      window.location.href = "profile.html";
      return false;
    }
    return true;
  }

  async function blockAdminFromStudentPages() {
    if (!getToken()) return;
    const current = lower(pageName());
    if (["admin.html", "profile.html", "signin.html", "signup.html"].includes(current)) return;
    const user = await refreshMe(true);
    if (lower(user?.role) === "admin") window.location.href = "admin.html";
  }

  function setupSignin() {
    const forms = [byId("signinForm"), byId("loginForm"), $("form[data-auth='signin']")].filter(Boolean);
    forms.forEach(form => {
      if (form.dataset.bound) return;
      form.dataset.bound = "1";
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = form.querySelector("button[type='submit']") || form.querySelector("button");
        setLoading(btn, true, "Signing in...");
        try {
          const payload = {email: valueFrom(form, "email"), password: valueFrom(form, "password")};
          const data = await apiPost("/api/signin", payload);
          setToken(data.token);
          setStoredUser(data.user);
          showMessage("Signed in successfully.", "success", 1000);
          const next = getParam("next") || (lower(data.user?.role) === "admin" ? "admin.html" : "gp.html");
          window.location.href = next;
        } catch (err) {
          showMessage(err.message, "error");
        } finally {
          setLoading(btn, false);
        }
      });
    });
  }

  function setupSignup() {
    const forms = [byId("signupForm"), byId("registerForm"), $("form[data-auth='signup']")].filter(Boolean);
    forms.forEach(form => {
      if (form.dataset.bound) return;
      form.dataset.bound = "1";
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = form.querySelector("button[type='submit']") || form.querySelector("button");
        setLoading(btn, true, "Creating account...");
        try {
          const payload = {
            name: valueFrom(form, "name", "full_name", "username"),
            email: valueFrom(form, "email"),
            password: valueFrom(form, "password")
          };
          const confirm = valueFrom(form, "confirm_password", "password_confirm", "confirmPassword");
          if (confirm && confirm !== payload.password) throw new Error("Passwords do not match");
          const data = await apiPost("/api/signup", payload);
          setToken(data.token);
          setStoredUser(data.user);
          showMessage("Account created successfully.", "success", 1000);
          window.location.href = "gp.html";
        } catch (err) {
          showMessage(err.message, "error");
        } finally {
          setLoading(btn, false);
        }
      });
    });
  }

  async function loadHome() {
    if (!["gp.html", "", "home"].includes(lower(pageName()))) return;
    const statsBox = byId("homeStats") || byId("statsBox");
    const specBox = hostContainer(["homeSpecializations", "featuredSpecializations"], "homeSpecializations");
    const courseBox = hostContainer(["homeCourses", "featuredCourses"], "homeCourses");
    const jobBox = hostContainer(["homeJobs", "featuredJobs"], "homeJobs");
    try {
      const [vm, specs, courses, jobs] = await Promise.all([
        apiGet("/api/view-model/home").catch(() => null),
        apiGet("/api/specializations"),
        apiGet("/api/courses"),
        apiGet("/api/jobs")
      ]);
      if (statsBox && vm?.counts) {
        statsBox.innerHTML = `<div class="sqr-stats-grid">${Object.entries(vm.counts).map(([k, v]) => statCard(k.replaceAll("_", " "), v)).join("")}</div>`;
      }
      specBox.innerHTML = `<div class="sqr-section-head"><h2>Specializations</h2><a href="Specialization.html">View all</a></div><div class="sqr-card-grid">${(specs.specializations || []).slice(0, 6).map(specializationCard).join("")}</div>`;
      courseBox.innerHTML = `<div class="sqr-section-head"><h2>Courses</h2><a href="Courses.html">View all</a></div><div class="sqr-card-grid">${(courses.courses || []).slice(0, 6).map(courseCard).join("")}</div>`;
      jobBox.innerHTML = `<div class="sqr-section-head"><h2>Jobs</h2><a href="jobs.html">View all</a></div><div class="sqr-card-grid">${(jobs.jobs || []).slice(0, 6).map(jobCard).join("")}</div>`;
      bindCardClicks();
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function specializationCard(item) {
    const id = itemId(item);
    return `<article class="sqr-card clickable" data-href="${route("Specialization.html", id)}">
      ${cardImage(item, "SP")}
      <div class="sqr-card-body">
        <h3>${esc(item.name || item.title || "Specialization")}</h3>
        <p>${esc(item.description || "Explore courses, jobs, certificates, and roadmap for this specialization.").slice(0, 180)}</p>
        ${tags(item.skills || item.job_titles || item.career_paths)}
        <div class="sqr-card-actions"><a class="sqr-btn primary" href="${route("Specialization.html", id)}">View Details</a></div>
      </div>
    </article>`;
  }

  function courseCard(item) {
    const id = itemId(item);
    const level = item.level || item.difficulty || "beginner";
    return `<article class="sqr-card clickable" data-href="${route("Courses.html", id)}">
      ${cardImage(item, "CO")}
      <div class="sqr-card-body">
        <div class="sqr-card-top"><span class="sqr-badge">${esc(level)}</span>${item.specialization_name ? `<span>${esc(item.specialization_name)}</span>` : ""}</div>
        <h3>${esc(item.title || item.name || "Course")}</h3>
        <p>${esc(item.description || item.content || "Open this course to track your progress automatically.").slice(0, 190)}</p>
        <div class="sqr-card-actions"><a class="sqr-btn primary" href="${route("Courses.html", id)}">Open Course</a></div>
      </div>
    </article>`;
  }

  function jobCard(item) {
    const id = itemId(item);
    return `<article class="sqr-card clickable" data-href="${route("jobs.html", id)}">
      <div class="sqr-card-body">
        <div class="sqr-card-top">${item.specialization ? `<span>${esc(item.specialization)}</span>` : ""}${item.salary ? `<span>${esc(item.salary)}</span>` : ""}</div>
        <h3>${esc(item.title || "Job")}</h3>
        <p>${esc(item.description || "Review job requirements and skills.").slice(0, 200)}</p>
        ${tags(item.required_skills || item.skills)}
        <div class="sqr-card-actions"><a class="sqr-btn primary" href="${route("jobs.html", id)}">View Job</a></div>
      </div>
    </article>`;
  }

  function quizCard(item) {
    const id = itemId(item);
    return `<article class="sqr-card clickable" data-href="${route("Quiz.html", id)}">
      <div class="sqr-card-body">
        <span class="sqr-badge">Quiz</span>
        <h3>${esc(item.title || item.name || "Quiz")}</h3>
        <p>${esc(item.description || "Take this quiz to update your course progress.")}</p>
        <div class="sqr-card-actions"><a class="sqr-btn primary" href="${route("Quiz.html", id)}">Start Quiz</a></div>
      </div>
    </article>`;
  }

  function certCard(item) {
    return `<article class="sqr-card">
      <div class="sqr-card-body">
        <span class="sqr-badge">Certificate</span>
        <h3>${esc(item.name || item.title || "Certification")}</h3>
        <p>${esc(item.description || "")}</p>
        ${item.price ? `<p><strong>Price:</strong> ${esc(item.price)}</p>` : ""}
        ${item.link ? `<a class="sqr-btn ghost" target="_blank" rel="noopener" href="${esc(externalUrl(item.link))}">Official Link</a>` : ""}
      </div>
    </article>`;
  }

  function bindCardClicks(root = document) {
    $$(".clickable[data-href]", root).forEach(card => {
      if (card.dataset.clickBound) return;
      card.dataset.clickBound = "1";
      card.addEventListener("click", e => {
        if (e.target.closest("a,button,input,textarea,select,label")) return;
        window.location.href = card.dataset.href;
      });
    });
  }

  async function loadSpecializations() {
    const current = lower(pageName());
    if (!current.includes("specialization") && !current.includes("sepecialization")) return;
    const id = getParam("id", "specialization_id", "spec_id");
    if (id) return loadSpecializationDetails(id);
    const box = hostContainer(["specializationsBox", "specializationsList", "specializationList"], "specializationsBox");
    box.innerHTML = emptyState("Loading specializations...");
    try {
      const data = await apiGet("/api/specializations");
      const items = data.specializations || [];
      box.innerHTML = items.length ? `<div class="sqr-card-grid">${items.map(specializationCard).join("")}</div>` : emptyState("No specializations found", "Add specializations from the admin page.");
      bindCardClicks(box);
    } catch (err) {
      box.innerHTML = emptyState("Could not load specializations", err.message);
    }
  }

  async function loadSpecializationDetails(id = getParam("id", "specialization_id", "spec_id")) {
    if (!id) return;
    const box = hostContainer(["specializationDetails", "detailsBox", "specializationDetailsBox"], "specializationDetails");
    box.innerHTML = emptyState("Loading specialization...");
    try {
      const data = await apiGet(`/api/specializations/${encodeURIComponent(id)}`);
      const s = data.specialization || {};
      const courses = data.courses || [];
      const jobs = data.jobs || [];
      const certs = data.certifications || data.certificates || [];
      box.innerHTML = `
        <section class="sqr-detail-hero">
          ${cardImage(s, "SP")}
          <div>
            <span class="sqr-badge">Specialization</span>
            <h1>${esc(s.name || s.title || "Specialization")}</h1>
            <p>${esc(s.description || "")}</p>
            ${tags(s.skills || s.job_titles || s.career_paths)}
            <div class="sqr-card-actions">
              <button id="enrollSpecBtn" class="sqr-btn primary" type="button">Enroll</button>
              <button id="unenrollSpecBtn" class="sqr-btn danger" type="button">Unenroll</button>
            </div>
          </div>
        </section>
        ${s.roadmap ? `<section class="sqr-panel"><h2>Roadmap</h2><p>${esc(s.roadmap)}</p></section>` : ""}
        <section class="sqr-panel"><div class="sqr-section-head"><h2>Courses</h2><a href="Courses.html?specialization_id=${esc(id)}">View all</a></div><div class="sqr-card-grid">${courses.length ? courses.map(courseCard).join("") : emptyState("No courses yet")}</div></section>
        <section class="sqr-panel"><div class="sqr-section-head"><h2>Jobs</h2><a href="jobs.html?specialization_id=${esc(id)}">View all</a></div><div class="sqr-card-grid">${jobs.length ? jobs.map(jobCard).join("") : emptyState("No jobs yet")}</div></section>
        <section class="sqr-panel"><h2>Certifications</h2><div class="sqr-card-grid">${certs.length ? certs.map(certCard).join("") : emptyState("No certifications yet")}</div></section>`;
      byId("enrollSpecBtn")?.addEventListener("click", async () => {
        try {
          if (!getToken()) return redirectToLogin();
          await apiPost(`/api/specializations/${encodeURIComponent(id)}/enroll`, {});
          showMessage("Enrolled successfully.", "success");
        } catch (err) {
          showMessage(err.message, "error");
        }
      });
      byId("unenrollSpecBtn")?.addEventListener("click", async () => {
        try {
          if (!getToken()) return redirectToLogin();
          await apiPost(`/api/specializations/${encodeURIComponent(id)}/unenroll`, {});
          showMessage("Unenrolled successfully.", "success");
        } catch (err) {
          showMessage(err.message, "error");
        }
      });
      bindCardClicks(box);
    } catch (err) {
      box.innerHTML = emptyState("Could not load specialization", err.message);
    }
  }

  async function loadCourses() {
    const current = lower(pageName());
    if (!current.includes("course")) return;
    const id = getParam("id", "course_id");
    if (id) return loadCourseDetails(id);
    const box = hostContainer(["coursesBox", "coursesList", "courseList"], "coursesBox");
    const search = byId("courseSearch") || $("input[name='courseSearch']") || $("input[data-search='courses']");
    const spec = getParam("specialization_id", "spec_id");
    const render = async () => {
      box.innerHTML = emptyState("Loading courses...");
      try {
        const q = new URLSearchParams();
        if (trim(search?.value)) q.set("search", trim(search.value));
        if (spec) q.set("specialization_id", spec);
        const data = await apiGet(`/api/courses${q.toString() ? `?${q}` : ""}`);
        const items = data.courses || [];
        box.innerHTML = items.length ? `<div class="sqr-card-grid">${items.map(courseCard).join("")}</div>` : emptyState("No courses found", "Add courses from the admin page.");
        bindCardClicks(box);
      } catch (err) {
        box.innerHTML = emptyState("Could not load courses", err.message);
      }
    };
    search?.addEventListener("input", debounce(render, 350));
    await render();
  }

  async function loadCourseDetails(id = getParam("id", "course_id")) {
    if (!id) return;
    const box = hostContainer(["courseDetails", "detailsBox", "courseDetailsBox"], "courseDetails");
    box.innerHTML = emptyState("Opening course...");
    if (!getToken()) {
      box.innerHTML = emptyState("Sign in required", "Sign in to open courses and track your progress.");
      setTimeout(redirectToLogin, 700);
      return;
    }
    try {
      await apiPost(`/api/courses/${encodeURIComponent(id)}/open`, {}).catch(() => null);
      const data = await apiGet(`/api/courses/${encodeURIComponent(id)}`);
      const c = data.course || {};
      const quizzes = data.quizzes || [];
      const vid = videoUrl(c);
      box.innerHTML = `
        <section class="sqr-detail-hero">
          ${cardImage(c, "CO")}
          <div>
            <span class="sqr-badge">${esc(c.level || c.difficulty || "Course")}</span>
            <h1>${esc(c.title || c.name || "Course")}</h1>
            <p>${esc(c.description || c.content || "")}</p>
            ${c.specialization_name ? `<p><strong>Specialization:</strong> ${esc(c.specialization_name)}</p>` : ""}
            <div class="sqr-card-actions">
              ${c.link ? `<a class="sqr-btn primary" target="_blank" rel="noopener" href="${esc(externalUrl(c.link))}">Open Link</a>` : ""}
              <button id="unenrollCourseBtn" class="sqr-btn danger" type="button">Unenroll</button>
            </div>
          </div>
        </section>
        ${vid ? `<section class="sqr-panel"><h2>Course Video</h2><video controls src="${esc(vid)}"></video></section>` : ""}
        ${c.content ? `<section class="sqr-panel"><h2>Course Content</h2><p>${esc(c.content)}</p></section>` : ""}
        <section class="sqr-panel"><h2>Quizzes</h2><div class="sqr-card-grid">${quizzes.length ? quizzes.map(quizCard).join("") : emptyState("No quizzes yet")}</div></section>`;
      byId("unenrollCourseBtn")?.addEventListener("click", async () => {
        try {
          await apiPost(`/api/courses/${encodeURIComponent(id)}/unenroll`, {});
          showMessage("Course unenrolled.", "success");
        } catch (err) {
          showMessage(err.message, "error");
        }
      });
      bindCardClicks(box);
    } catch (err) {
      box.innerHTML = emptyState("Could not open course", err.message);
    }
  }

  async function loadJobs() {
    const current = lower(pageName());
    if (!current.includes("job")) return;
    const id = getParam("id", "job_id");
    if (id) return loadJobDetails(id);
    const box = hostContainer(["jobsBox", "jobsList", "jobList"], "jobsBox");
    const search = byId("jobSearch") || $("input[name='jobSearch']") || $("input[data-search='jobs']");
    const spec = getParam("specialization_id", "spec_id");
    const render = async () => {
      box.innerHTML = emptyState("Loading jobs...");
      try {
        const q = new URLSearchParams();
        if (trim(search?.value)) q.set("search", trim(search.value));
        if (spec) q.set("specialization_id", spec);
        const data = await apiGet(`/api/jobs${q.toString() ? `?${q}` : ""}`);
        const items = data.jobs || [];
        box.innerHTML = items.length ? `<div class="sqr-card-grid">${items.map(jobCard).join("")}</div>` : emptyState("No jobs found");
        bindCardClicks(box);
      } catch (err) {
        box.innerHTML = emptyState("Could not load jobs", err.message);
      }
    };
    search?.addEventListener("input", debounce(render, 350));
    await render();
  }

  async function loadJobDetails(id = getParam("id", "job_id")) {
    const box = hostContainer(["jobDetails", "detailsBox", "jobDetailsBox"], "jobDetails");
    box.innerHTML = emptyState("Loading job...");
    try {
      const data = await apiGet(`/api/jobs/${encodeURIComponent(id)}`);
      const j = data.job || {};
      box.innerHTML = `<section class="sqr-detail-hero"><div class="sqr-card-placeholder big"><span>JOB</span></div><div><span class="sqr-badge">${esc(j.specialization || "Career")}</span><h1>${esc(j.title || "Job")}</h1><p>${esc(j.description || "")}</p>${tags(j.required_skills || j.skills)}${j.salary ? `<p><strong>Average salary:</strong> ${esc(j.salary)}</p>` : ""}${j.link ? `<a class="sqr-btn primary" href="${esc(externalUrl(j.link))}" target="_blank" rel="noopener">Open Job Link</a>` : ""}</div></section>`;
    } catch (err) {
      box.innerHTML = emptyState("Could not load job", err.message);
    }
  }

  async function loadQuizzes() {
    const current = lower(pageName());
    if (!current.includes("quiz")) return;
    const id = getParam("id", "quiz_id");
    if (id) return loadQuizDetails(id);
    const box = hostContainer(["quizzesBox", "quizList", "quizzesList"], "quizzesBox");
    try {
      const courseId = getParam("course_id");
      const data = await apiGet(courseId ? `/api/courses/${encodeURIComponent(courseId)}/quizzes` : "/api/quizzes");
      const items = data.quizzes || [];
      box.innerHTML = items.length ? `<div class="sqr-card-grid">${items.map(quizCard).join("")}</div>` : emptyState("No quizzes found");
      bindCardClicks(box);
    } catch (err) {
      box.innerHTML = emptyState("Could not load quizzes", err.message);
    }
  }

  async function loadQuizDetails(id = getParam("id", "quiz_id")) {
    const box = hostContainer(["quizDetails", "detailsBox", "quizDetailsBox"], "quizDetails");
    const resultBox = hostContainer(["quizResult", "resultBox"], "quizResult");
    box.innerHTML = emptyState("Loading quiz...");
    try {
      const data = await apiGet(`/api/quizzes/${encodeURIComponent(id)}`);
      const quiz = data.quiz || {};
      const questions = data.questions || [];
      box.innerHTML = `<form id="quizSubmitForm" class="sqr-panel"><h1>${esc(quiz.title || quiz.name || "Quiz")}</h1><p>${esc(quiz.description || "Answer all questions then submit.")}</p>${questions.map((q, index) => questionHtml(q, index)).join("")}<button type="submit" class="sqr-btn primary">Submit Quiz</button></form>`;
      byId("quizSubmitForm")?.addEventListener("submit", async e => {
        e.preventDefault();
        if (!getToken()) return redirectToLogin();
        const answers = {};
        questions.forEach(q => {
          const qid = itemId(q, "question_id");
          const checked = $(`input[name='q_${cssSafe(qid)}']:checked`, e.currentTarget);
          answers[String(qid)] = checked ? checked.value : "";
        });
        try {
          const res = await apiPost(`/api/quizzes/${encodeURIComponent(id)}/submit`, {answers});
          resultBox.innerHTML = `<section class="sqr-panel result-panel">${circle(res.score, "Quiz Score")}<div><h2>${res.passed ? "Passed" : "Try again"}</h2><p>${esc(res.correct)} correct out of ${esc(res.total)} questions.</p></div></section>`;
          showMessage("Quiz submitted.", "success");
        } catch (err) {
          showMessage(err.message, "error");
        }
      });
    } catch (err) {
      box.innerHTML = emptyState("Could not load quiz", err.message);
    }
  }

  function questionHtml(q, index) {
    const qid = itemId(q, "question_id") || index;
    const options = q.options || [q.option_a || q.option1, q.option_b || q.option2, q.option_c || q.option3, q.option_d || q.option4].filter(Boolean);
    const letters = ["A", "B", "C", "D"];
    return `<div class="sqr-question"><h3>${index + 1}. ${esc(q.question || q.question_text || "Question")}</h3><div class="sqr-options">${options.map((opt, i) => `<label><input type="radio" name="q_${esc(qid)}" value="${letters[i]}" required><span>${esc(letters[i])}. ${esc(opt)}</span></label>`).join("")}</div></div>`;
  }

  async function loadProfile() {
    const current = lower(pageName());
    if (!current.includes("profile")) return;
    if (!await requireLogin()) return;
    const box = hostContainer(["profileSummary", "profileBox", "profileDetails"], "profileSummary");
    const progressBox = hostContainer(["profileProgressBars", "progressBars", "progressBox"], "profileProgressBars");
    const quizBox = hostContainer(["profileQuizHistory", "quizHistory"], "profileQuizHistory");
    const atsBox = hostContainer(["profileAtsHistory", "atsHistory"], "profileAtsHistory");
    try {
      const data = await apiGet("/api/view-model/profile");
      const user = data.user || {};
      box.innerHTML = `<section class="sqr-profile-hero"><div>${circle(data.completeness || 0, "Profile")}</div><div><h1>${esc(user.name || "Student")}</h1><p>${esc(user.email || "")}</p><p>${esc(user.goal || "Add your career goal to improve recommendations.")}</p>${tags(user.skills)}</div></section>${profileEditForm(user)}`;
      bindProfileForm();
      const enrollments = data.activity?.course_enrollments || [];
      progressBox.innerHTML = `<section class="sqr-panel"><h2>Course Progress</h2>${enrollments.length ? enrollments.map(progressRow).join("") : emptyState("No course progress yet", "Open a course to start progress tracking.")}</section>`;
      const attempts = data.activity?.quiz_attempts || [];
      quizBox.innerHTML = `<section class="sqr-panel"><h2>Quiz History</h2>${attempts.length ? `<div class="sqr-table-wrap"><table><thead><tr><th>Quiz</th><th>Score</th><th>Status</th></tr></thead><tbody>${attempts.map(a => `<tr><td>${esc(a.quiz_id || "Quiz")}</td><td>${esc(a.score)}%</td><td>${Number(a.passed) ? "Passed" : "Not passed"}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No quiz attempts yet")}</section>`;
      const ats = data.activity?.ats_history || [];
      atsBox.innerHTML = `<section class="sqr-panel"><h2>ATS History</h2>${ats.length ? `<div class="sqr-card-grid compact">${ats.map(a => `<div class="sqr-mini-card"><strong>${esc(a.target_job || "Resume")}</strong><span>${esc(a.ats_score || 0)}%</span><p>${esc(a.grade || "")}</p></div>`).join("")}</div>` : emptyState("No ATS checks yet")}</section>`;
    } catch (err) {
      box.innerHTML = emptyState("Could not load profile", err.message);
    }
  }

  function profileEditForm(user) {
    return `<form id="profileEditForm" class="sqr-panel sqr-form"><h2>Edit Profile</h2><div class="sqr-form-grid"><label>Name<input name="name" value="${esc(user.name || "")}"></label><label>Skills<textarea name="skills">${esc(user.skills || "")}</textarea></label><label>Interests<textarea name="interests">${esc(user.interests || "")}</textarea></label><label>Career Goal<textarea name="goal">${esc(user.goal || "")}</textarea></label><label>Work Style<textarea name="work_style">${esc(user.work_style || "")}</textarea></label></div><button class="sqr-btn primary" type="submit">Save Profile</button></form>`;
  }

  function bindProfileForm() {
    const form = byId("profileEditForm");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const data = await apiPut("/api/profile", formToObject(form));
        setStoredUser(data.user);
        showMessage("Profile updated.", "success");
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  }

  function progressRow(row) {
    const value = clamp(row.progress_percentage || row.progress || 0);
    const title = row.course_title || row.title || `Course ${row.course_id || ""}`;
    return `<div class="sqr-progress-row"><div><strong>${esc(title)}</strong><span>${esc(row.status || "In Progress")}</span></div><div class="sqr-progress"><span style="width:${value}%"></span></div><b>${Math.round(value)}%</b></div>`;
  }

  function setupRecommendation() {
    const current = lower(pageName());
    if (!current.includes("recommendation")) return;
    const form = byId("recommendationForm") || byId("recForm") || $("form[data-feature='recommendation']");
    const resultBox = hostContainer(["recommendationResult", "recResult", "resultBox"], "recommendationResult");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!getToken()) return redirectToLogin();
      const btn = form.querySelector("button[type='submit']") || form.querySelector("button");
      setLoading(btn, true, "Generating...");
      resultBox.innerHTML = emptyState("Analyzing your answers...");
      try {
        const data = await apiPost("/api/recommendations", formToObject(form));
        resultBox.innerHTML = renderRecommendation(data);
        bindCardClicks(resultBox);
      } catch (err) {
        resultBox.innerHTML = emptyState("Recommendation failed", err.message);
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function renderRecommendation(data) {
    const specs = data.specializations || [];
    const jobs = data.jobs || data.top_jobs || [];
    return `<section class="sqr-panel"><h2>Your Recommendation</h2><p>${esc(data.summary || "Based on your answers, SQR separated specialization and job matches.")}</p></section><section class="sqr-panel"><h2>Specialization Matches</h2><div class="sqr-card-grid">${specs.length ? specs.map(s => `<article class="sqr-card clickable" data-href="${route("Specialization.html", s.id || s.specialization_id)}"><div class="sqr-card-body">${circle(s.match_score || s.score || 0, "Match")}<h3>${esc(s.name || s.title || "Specialization")}</h3><p>${esc(s.why || s.reason || "")}</p>${tags(s.next_steps || [])}</div></article>`).join("") : emptyState("No specialization match")}</div></section><section class="sqr-panel"><h2>Job Matches</h2><div class="sqr-card-grid">${jobs.length ? jobs.map(j => `<article class="sqr-card clickable" data-href="${route("jobs.html", j.id || j.job_id)}"><div class="sqr-card-body">${circle(j.match_score || j.score || 0, "Match")}<h3>${esc(j.title || "Job")}</h3><p>${esc(j.why || j.reason || "")}</p>${tags(j.skills_to_build || j.skills || [])}</div></article>`).join("") : emptyState("No job match")}</div></section>`;
  }

  function setupATS() {
    const current = lower(pageName());
    if (!current.includes("ats")) return;
    bindAtsCheck();
    bindAtsGenerate();
    bindAtsExports();
  }

  function bindAtsCheck() {
    const form = byId("atsCheckForm") || byId("atsCheckerForm") || $("form[data-feature='ats-check']");
    const resultBox = hostContainer(["atsResult", "atsCheckResult", "checkerResult"], "atsResult");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!getToken()) return redirectToLogin();
      const fd = formToData(form);
      const file = form.querySelector("input[type='file']")?.files?.[0];
      if (file && !fd.has("resume")) fd.set("resume", file);
      if (!fd.get("target_job")) {
        const tj = inferFieldValue(form, [/target\s*(job|role)/, /job\s*title/, /position/]);
        if (tj) fd.set("target_job", tj);
      }
      if (!fd.get("job_description")) {
        const jd = inferFieldValue(form, [/job\s*description/, /requirements?/, /description/]);
        if (jd) fd.set("job_description", jd);
      }
      const btn = form.querySelector("button[type='submit']") || form.querySelector("button");
      setLoading(btn, true, "Checking...");
      resultBox.innerHTML = emptyState("Analyzing resume...");
      try {
        const data = await apiForm("/api/ats/check", fd);
        resultBox.innerHTML = renderAtsAnalysis(data);
      } catch (err) {
        resultBox.innerHTML = emptyState("ATS check failed", err.message);
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function bindAtsGenerate() {
    const form = byId("atsGenerateForm") || byId("resumeGenerateForm") || $("form[data-feature='ats-generate']");
    const resultBox = hostContainer(["generatedResume", "atsGenerateResult", "resumeResult"], "generatedResume");
    const analysisBox = byId("atsGeneratorAnalysis") || byId("atsAnalysis") || byId("atsResult");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!getToken()) return redirectToLogin();
      const payload = normalizeAtsGeneratePayload(formToObject(form), form);
      const btn = form.querySelector("button[type='submit']") || form.querySelector("button");
      const missing = [];
      if (!payload.name) missing.push("Full Name");
      if (!payload.email) missing.push("Email");
      if (!payload.target_job) missing.push("Target Role");
      if (!payload.skills) missing.push("Technical Skills");
      if (missing.length) {
        resultBox.innerHTML = emptyState("Complete the required fields", `Missing: ${missing.join(", ")}.`);
        showMessage(`Missing required fields: ${missing.join(", ")}`, "error");
        return;
      }
      setLoading(btn, true, "Generating...");
      resultBox.innerHTML = emptyState("Generating ATS-friendly resume...");
      try {
        const data = await apiPost("/api/ats/generate", payload);
        SQR.lastResumeText = data.resume_text || data.generated_resume || "";
        resultBox.innerHTML = renderGeneratedResume(data);
        if (analysisBox) analysisBox.innerHTML = renderAtsAnalysis(data.ats_analysis || data);
        bindAtsExports();
      } catch (err) {
        resultBox.innerHTML = emptyState("Resume generation failed", err.message);
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function renderGeneratedResume(data) {
    const resume = data.resume_text || data.generated_resume || "";
    const summary = data.enhanced_summary || data.summary || "";
    return `<section class="sqr-panel"><div class="sqr-section-head"><h2>Generated Resume</h2><div><button type="button" class="sqr-btn ghost" id="copyResumeBtn">Copy</button><button type="button" class="sqr-btn primary" id="exportPdfBtn">PDF</button><button type="button" class="sqr-btn primary" id="exportDocxBtn">DOCX</button></div></div>${summary ? `<div class="sqr-highlight"><strong>Enhanced Summary</strong><p>${esc(summary)}</p></div>` : ""}<pre class="sqr-resume-output">${esc(resume)}</pre></section>`;
  }

  function renderAtsAnalysis(data) {
    if (!data) return emptyState("No ATS data");
    const breakdown = data.score_breakdown || {};
    const sections = data.section_scores || {};
    return `<section class="sqr-panel ats-analysis"><div class="sqr-analysis-head">${circle(data.ats_score || 0, data.grade || "ATS")}<div><h2>${esc(data.label || "ATS Analysis")}</h2><p>${esc(data.summary || "")}</p><span class="sqr-badge">${esc(data.engine || "sqr")}</span></div></div><div class="sqr-stats-grid">${Object.entries(breakdown).map(([k, v]) => statCard(k.replaceAll("_", " "), `${v}`)).join("")}</div><div class="sqr-two-col"><div><h3>Matched Keywords</h3>${tags(data.matched_keywords || [])}</div><div><h3>Missing Keywords</h3>${tags(data.missing_keywords || [])}</div></div><div class="sqr-two-col"><div><h3>Strengths</h3>${list(data.strengths)}</div><div><h3>Improvements</h3>${list(data.improvements || data.suggestions)}</div></div>${Object.keys(sections).length ? `<h3>Section Scores</h3>${Object.entries(sections).map(([k, v]) => progressRow({course_title: k.replaceAll("_", " "), progress_percentage: v, status: ""})).join("")}` : ""}</section>`;
  }

  function list(items) {
    if (typeof items === "string") {
      try { items = JSON.parse(items); } catch (_) { items = items.split(/\n|;/); }
    }
    if (!Array.isArray(items) || !items.length) return `<p class="muted">No items.</p>`;
    return `<ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
  }

  function bindAtsExports() {
    byId("copyResumeBtn")?.addEventListener("click", async () => {
      const textValue = SQR.lastResumeText || $(".sqr-resume-output")?.textContent || "";
      await navigator.clipboard.writeText(textValue);
      showMessage("Resume copied.", "success");
    }, {once: true});
    byId("exportPdfBtn")?.addEventListener("click", async () => {
      try {
        const resume_text = SQR.lastResumeText || $(".sqr-resume-output")?.textContent || "";
        await downloadApi("/api/ats/export/pdf", {resume_text}, "SQR_ATS_Resume.pdf");
      } catch (err) { showMessage(err.message, "error"); }
    }, {once: true});
    byId("exportDocxBtn")?.addEventListener("click", async () => {
      try {
        const resume_text = SQR.lastResumeText || $(".sqr-resume-output")?.textContent || "";
        await downloadApi("/api/ats/export/docx", {resume_text}, "SQR_ATS_Resume.docx");
      } catch (err) { showMessage(err.message, "error"); }
    }, {once: true});
  }

  async function loadAdmin() {
    const current = lower(pageName());
    if (!current.includes("admin")) return;
    if (!await requireAdmin()) return;
    const statsBox = hostContainer(["adminStatsBox", "adminStats", "statsBox"], "adminStatsBox");
    try {
      const [stats, specs, courses, jobs, quizzes, users, certs] = await Promise.all([
        apiGet("/api/admin/stats").catch(() => ({})),
        apiGet("/api/specializations"),
        apiGet("/api/courses"),
        apiGet("/api/jobs"),
        apiGet("/api/quizzes"),
        apiGet("/api/admin/users").catch(() => ({users: []})),
        apiGet("/api/certifications").catch(() => ({certifications: [], certificates: []}))
      ]);
      statsBox.innerHTML = `<div class="sqr-stats-grid">${Object.entries(stats).map(([k, v]) => statCard(k.replaceAll("_", " "), v)).join("")}</div>`;
      renderAdminLists(specs.specializations || [], courses.courses || [], jobs.jobs || [], quizzes.quizzes || [], users.users || [], certs.certifications || certs.certificates || []);
      populateAdminSelects(specs.specializations || [], courses.courses || []);
      bindAdminForms();
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function adminListItem(type, item) {
    const id = itemId(item);
    const title = item.name || item.title || item.email || `${type} ${id}`;
    const subtitle = item.description || item.specialization_name || item.role || item.skills || "";
    return `<div class="sqr-admin-row" data-type="${esc(type)}" data-id="${esc(id)}"><div><strong>${esc(title)}</strong><small>${esc(subtitle).slice(0, 160)}</small></div><div class="sqr-row-actions"><button type="button" class="sqr-btn ghost admin-edit-btn" data-type="${esc(type)}" data-id="${esc(id)}">Edit</button>${type !== "users" ? `<button type="button" class="sqr-btn danger admin-delete-btn" data-type="${esc(type)}" data-id="${esc(id)}">Delete</button>` : userButtons(item)}</div><script type="application/json" class="row-json">${esc(JSON.stringify(item))}</script></div>`;
  }

  function userButtons(user) {
    const id = itemId(user);
    const banned = Number(user.banned || user.is_banned || 0) === 1;
    return `${banned ? `<button type="button" class="sqr-btn primary admin-user-action" data-action="unban" data-id="${esc(id)}">Unban</button>` : `<button type="button" class="sqr-btn danger admin-user-action" data-action="ban" data-id="${esc(id)}">Ban</button>`}<button type="button" class="sqr-btn ghost admin-user-action" data-action="role" data-role="${lower(user.role) === "admin" ? "student" : "admin"}" data-id="${esc(id)}">Make ${lower(user.role) === "admin" ? "Student" : "Admin"}</button>`;
  }

  function renderAdminLists(specs, courses, jobs, quizzes, users, certs) {
    const lists = [
      ["adminSpecializationsList", "specializations", specs],
      ["adminCoursesList", "courses", courses],
      ["adminJobsList", "jobs", jobs],
      ["adminQuizzesList", "quizzes", quizzes],
      ["adminUsersList", "users", users],
      ["adminCertificatesList", "certificates", certs]
    ];
    lists.forEach(([id, type, items]) => {
      const box = byId(id);
      if (!box) return;
      box.innerHTML = items.length ? items.map(item => adminListItem(type, item)).join("") : emptyState(`No ${type} yet`);
    });
    bindAdminRowActions();
  }

  function populateAdminSelects(specs, courses) {
    const specOptions = `<option value="">Select specialization</option>${specs.map(s => `<option value="${esc(itemId(s))}">${esc(s.name || s.title)}</option>`).join("")}`;
    const courseOptions = `<option value="">Select course</option>${courses.map(c => `<option value="${esc(itemId(c))}">${esc(c.title || c.name)}</option>`).join("")}`;
    $$("select[name='specialization_id'], select[name='spec_id'], #specialization_id, #spec_id").forEach(sel => {
      if (!sel.dataset.keepOptions) sel.innerHTML = specOptions;
    });
    $$("select[name='course_id'], #course_id").forEach(sel => {
      if (!sel.dataset.keepOptions) sel.innerHTML = courseOptions;
    });
  }

  function bindAdminForms() {
    const configs = [
      {selector: "#adminSpecializationForm, #specializationForm, form[data-admin='specialization']", create: "/api/admin/specializations", update: id => `/api/admin/specializations/${id}`, type: "specializations", multipart: true},
      {selector: "#adminCourseForm, #courseForm, form[data-admin='course']", create: "/api/admin/courses", update: id => `/api/admin/courses/${id}`, type: "courses", multipart: true},
      {selector: "#adminJobForm, #jobForm, form[data-admin='job']", create: "/api/admin/jobs", update: id => `/api/admin/jobs/${id}`, type: "jobs", multipart: false},
      {selector: "#adminCertificateForm, #certificateForm, #certificationForm, form[data-admin='certificate']", create: "/api/admin/certifications", update: null, type: "certificates", multipart: false},
      {selector: "#adminQuizForm, #quizForm, form[data-admin='quiz']", create: "/api/admin/quizzes", update: null, type: "quizzes", multipart: false}
    ];
    configs.forEach(cfg => {
      $$(cfg.selector).forEach(form => {
        if (form.dataset.bound) return;
        form.dataset.bound = "1";
        form.addEventListener("submit", async e => {
          e.preventDefault();
          const btn = form.querySelector("button[type='submit']") || form.querySelector("button");
          setLoading(btn, true, "Saving...");
          try {
            const id = valueFrom(form, "id", `${cfg.type}_id`, cfg.type.slice(0, -1) + "_id");
            const body = cfg.multipart ? formToData(form) : normalizeAdminPayload(cfg.type, formToObject(form));
            if (id && cfg.update) await (cfg.multipart ? apiForm(cfg.update(id), body, "PUT") : apiPut(cfg.update(id), body));
            else await (cfg.multipart ? apiForm(cfg.create, body) : apiPost(cfg.create, body));
            showMessage("Saved successfully.", "success");
            form.reset();
            clearFormId(form);
            await loadAdmin();
          } catch (err) {
            showMessage(err.message, "error");
          } finally {
            setLoading(btn, false);
          }
        });
      });
    });
  }

  function normalizeAdminPayload(type, data) {
    const out = {...data};
    if (type === "quizzes") {
      if (out.questions_text && !out.questions) out.questions = parseQuestions(out.questions_text);
      if (typeof out.questions === "string") {
        try { out.questions = JSON.parse(out.questions); } catch (_) { out.questions = parseQuestions(out.questions); }
      }
    }
    return out;
  }

  function parseQuestions(raw) {
    raw = trim(raw);
    if (!raw) return [];
    return raw.split(/\n\s*\n/).map(block => {
      const lines = block.split("\n").map(trim).filter(Boolean);
      return {
        question: lines[0] || "",
        option_a: (lines.find(l => /^a[).:-]/i.test(l)) || "").replace(/^a[).:-]\s*/i, ""),
        option_b: (lines.find(l => /^b[).:-]/i.test(l)) || "").replace(/^b[).:-]\s*/i, ""),
        option_c: (lines.find(l => /^c[).:-]/i.test(l)) || "").replace(/^c[).:-]\s*/i, ""),
        option_d: (lines.find(l => /^d[).:-]/i.test(l)) || "").replace(/^d[).:-]\s*/i, ""),
        correct_answer: ((lines.find(l => /^answer\s*[:=-]/i.test(l)) || "A").split(/[:=-]/).pop() || "A").trim().slice(0, 1).toUpperCase()
      };
    }).filter(q => q.question);
  }

  function bindAdminRowActions() {
    $$(".admin-edit-btn").forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const row = btn.closest(".sqr-admin-row");
        const raw = row?.querySelector(".row-json")?.textContent || "{}";
        let item = {};
        try { item = JSON.parse(raw); } catch (_) {}
        fillAdminForm(btn.dataset.type, item);
      });
    });
    $$(".admin-delete-btn").forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this item?")) return;
        try {
          const endpoint = adminDeleteEndpoint(btn.dataset.type, btn.dataset.id);
          if (!endpoint) throw new Error("Delete is not available for this item.");
          await apiDelete(endpoint);
          showMessage("Deleted.", "success");
          await loadAdmin();
        } catch (err) {
          showMessage(err.message, "error");
        }
      });
    });
    $$(".admin-user-action").forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", async () => {
        try {
          const id = btn.dataset.id;
          if (btn.dataset.action === "role") await apiPost(`/api/admin/users/${id}/role`, {role: btn.dataset.role});
          else await apiPost(`/api/admin/users/${id}/${btn.dataset.action}`, {});
          showMessage("User updated.", "success");
          await loadAdmin();
        } catch (err) {
          showMessage(err.message, "error");
        }
      });
    });
  }

  function adminDeleteEndpoint(type, id) {
    const map = {specializations: `/api/admin/specializations/${id}`, courses: `/api/admin/courses/${id}`, jobs: `/api/admin/jobs/${id}`, quizzes: `/api/admin/quizzes/${id}`};
    return map[type] || "";
  }

  function fillAdminForm(type, item) {
    const map = {
      specializations: "#adminSpecializationForm, #specializationForm, form[data-admin='specialization']",
      courses: "#adminCourseForm, #courseForm, form[data-admin='course']",
      jobs: "#adminJobForm, #jobForm, form[data-admin='job']",
      quizzes: "#adminQuizForm, #quizForm, form[data-admin='quiz']",
      certificates: "#adminCertificateForm, #certificateForm, #certificationForm, form[data-admin='certificate']"
    };
    const form = $(map[type] || "");
    if (!form) return showMessage("Could not find the edit form on this page.", "error");
    ensureHiddenId(form).value = itemId(item);
    $$("input, textarea, select", form).forEach(el => {
      if (el.type === "file") return;
      const keys = [el.name, el.id].filter(Boolean);
      for (const key of keys) {
        if (item[key] != null) {
          el.value = item[key];
          return;
        }
      }
      if (el.name === "name" && (item.name || item.title)) el.value = item.name || item.title;
      if (el.name === "title" && (item.title || item.name)) el.value = item.title || item.name;
      if ((el.name === "specialization_id" || el.name === "spec_id") && item.specialization_id) el.value = item.specialization_id;
      if ((el.name === "course_id") && item.course_id) el.value = item.course_id;
    });
    form.scrollIntoView({behavior: "smooth", block: "center"});
    showMessage("Edit mode loaded. Change the form and click Save.", "info");
  }

  function ensureHiddenId(form) {
    let hidden = form.querySelector("input[name='id']");
    if (!hidden) {
      hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "id";
      form.prepend(hidden);
    }
    return hidden;
  }

  function clearFormId(form) {
    const hidden = form.querySelector("input[name='id']");
    if (hidden) hidden.value = "";
  }

  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function cssSafe(value) {
    if (window.CSS && CSS.escape) return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  async function boot() {
    if (SQR.booted) return;
    SQR.booted = true;
    navbar();
    setupSignin();
    setupSignup();
    if (getToken()) await refreshMe(true);
    await blockAdminFromStudentPages();
    await Promise.allSettled([
      loadHome(),
      loadProfile(),
      loadSpecializations(),
      loadCourses(),
      loadJobs(),
      loadQuizzes(),
      loadAdmin()
    ]);
    setupRecommendation();
    setupATS();
    bindCardClicks();
  }

  window.SQRApp = {api, apiGet, apiPost, apiPut, apiDelete, refreshMe, getToken, setToken, clearToken, showMessage, loadHome, loadProfile, loadSpecializations, loadSpecializationDetails, loadCourses, loadCourseDetails, loadJobs, loadJobDetails, loadQuizzes, loadQuizDetails, loadAdmin, setupRecommendation, setupATS};
  window.navbar = navbar;
  window.requireLogin = requireLogin;
  window.requireAdmin = requireAdmin;
  window.blockAdminFromStudentPages = blockAdminFromStudentPages;
  window.setupSignin = setupSignin;
  window.setupSignup = setupSignup;
  window.loadProfile = loadProfile;
  window.loadSpecializations = loadSpecializations;
  window.loadSpecializationDetails = loadSpecializationDetails;
  window.loadCourses = loadCourses;
  window.loadCourseDetails = loadCourseDetails;
  window.loadJobs = loadJobs;
  window.loadJobDetails = loadJobDetails;
  window.loadQuizzes = loadQuizzes;
  window.loadQuizDetails = loadQuizDetails;
  window.setupRecommendation = setupRecommendation;
  window.setupATS = setupATS;
  window.loadAdmin = loadAdmin;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
