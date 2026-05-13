const API = (() => {
  if (window.SQR_API_OVERRIDE) return window.SQR_API_OVERRIDE;
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://127.0.0.1:5000";
  if (host.includes("github.io") || host.includes("netlify") || host.includes("vercel")) return "https://sqr-ba83.onrender.com";
  return location.origin || "https://sqr-ba83.onrender.com";
})();

const SQR = {
  pages: {
    home: "gp.html",
    specializations: "Specialization.html",
    specializationDetails: "specialization-details.html",
    courses: "Courses.html",
    courseDetails: "course-details.html",
    ats: "ATS.html",
    jobs: "jobs.html",
    recommendation: "recommendation.html",
    profile: "profile.html",
    admin: "admin.html",
    signin: "signin.html",
    signup: "signup.html"
  },
  publicPages: new Set(["", "index.html", "gp.html", "signin.html", "signup.html"]),
  state: {
    specializations: [],
    courses: [],
    jobs: [],
    quizzes: [],
    certifications: [],
    users: [],
    recommendationQuiz: []
  }
};

function pageName() {
  return location.pathname.split("/").pop() || "index.html";
}

function isPublicPage() {
  return SQR.publicPages.has(pageName());
}

function route(name, params = {}) {
  const base = SQR.pages[name] || name || "#";
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  });
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}

function go(url) {
  if (!url || url === "#") return;
  location.href = url;
}

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function id(name) {
  return document.getElementById(name);
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value) {
  return String(value ?? "").trim();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function objId(item) {
  if (!item) return null;
  return item.id ?? item.user_id ?? item.specialization_id ?? item.spec_id ?? item.course_id ?? item.job_id ?? item.quiz_id ?? item.certification_id ?? item.certificate_id ?? item.attempt_id ?? null;
}

function pick(obj, keys, fallback = "") {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return fallback;
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
    return value.split(/[\n,|]+/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function param(name) {
  return new URLSearchParams(location.search).get(name);
}

function getToken() {
  return localStorage.getItem("sqr_token") || localStorage.getItem("token") || "";
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("sqr_user") || localStorage.getItem("user") || "null");
  } catch (_) {
    return null;
  }
}

function setAuth(token, user) {
  if (token) localStorage.setItem("sqr_token", token);
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
  const token = getToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", ...authHeaders(), ...extra };
}

function hasFile(form) {
  return qsa("input[type='file']", form).some((input) => input.files && input.files.length > 0);
}

function values(form) {
  const fd = new FormData(form);
  const data = {};
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
      data[key] = el.checked;
    } else {
      data[key] = clean(el.value);
    }
  });
  return data;
}

function fill(form, data = {}) {
  if (!form || !data) return;
  qsa("input, textarea, select", form).forEach((el) => {
    const key = el.name || el.id;
    if (!key || data[key] === undefined || el.type === "file") return;
    if (el.type === "checkbox") el.checked = Boolean(data[key]);
    else el.value = data[key] ?? "";
  });
}

function showMessage(message, type = "info") {
  const box = id("message") || id("msg") || id("alert");
  if (!box) return;
  box.textContent = message || "";
  box.className = `message ${type}`;
  box.style.display = message ? "block" : "none";
  clearTimeout(showMessage.timer);
  if (message) showMessage.timer = setTimeout(() => (box.style.display = "none"), 4500);
}

function setLoading(btn, active, label = "Loading...") {
  if (!btn) return;
  if (active) {
    btn.dataset.oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${html(label)}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.oldText) btn.innerHTML = btn.dataset.oldText;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { message: text };
  }
}

function silenceUnauthorized(options = {}) {
  if (options.action) return false;
  if (options.silentUnauthorized === false) return false;
  if (options.silentUnauthorized === true) return true;
  return isPublicPage() || !getToken();
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData ? { ...authHeaders(), ...(options.headers || {}) } : jsonHeaders(options.headers || {});
  const res = await fetch(API + path, { ...options, headers });
  const data = await readJson(res);
  if (res.status === 401 || res.status === 403) {
    if (!silenceUnauthorized(options)) showMessage(data.error || data.message || "Unauthorized. Please sign in again.", "error");
    if (res.status === 401 && !isPublicPage() && options.redirectOnUnauthorized !== false) {
      clearAuth();
      setTimeout(() => go(route("signin")), 700);
    }
    throw Object.assign(new Error(data.error || data.message || "Unauthorized"), { status: res.status, data });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || "Request failed"), { status: res.status, data });
  return data;
}

async function apiAny(paths, options = {}) {
  const list = Array.isArray(paths) ? paths : [paths];
  let last = null;
  for (const path of list) {
    try {
      return await api(path, options);
    } catch (err) {
      last = err;
      if (![404, 405].includes(err.status)) break;
    }
  }
  throw last || new Error("Request failed");
}

function asset(value) {
  if (!value) return "";
  const v = String(value);
  if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("data:")) return v;
  if (v.startsWith("/")) return API + v;
  if (v.startsWith("uploads/") || v.startsWith("static/")) return API + "/" + v;
  return v;
}

function media(item, cls = "card-media") {
  const video = pick(item, ["video_url", "video", "video_path", "media_url"], "");
  const image = pick(item, ["image_url", "image", "image_path", "photo", "thumbnail", "picture", "cover"], "");
  const videoUrl = asset(video);
  const imageUrl = asset(image);
  if (videoUrl && /\.(mp4|webm|ogg)$/i.test(videoUrl)) return `<video class="${cls}" controls muted preload="metadata" src="${html(videoUrl)}"></video>`;
  if (imageUrl) return `<img class="${cls}" src="${html(imageUrl)}" alt="SQR media" loading="lazy">`;
  return `<div class="${cls} media-placeholder"><span>SQR</span></div>`;
}

function btn(label, cls = "btn btn-primary", attrs = "") {
  const hasType = /\btype\s*=/.test(attrs);
  return `<button ${hasType ? "" : "type=\"button\""} class="${cls}" ${attrs}>${label}</button>`;
}

function a(label, href, cls = "btn btn-primary", attrs = "") {
  return `<a class="${cls}" href="${html(href)}" ${attrs}>${label}</a>`;
}

function percent(value) {
  return Math.max(0, Math.min(100, Math.round(num(value))));
}

function progress(value, label = "Progress") {
  const p = percent(value);
  return `<div class="progress-block"><div class="progress-top"><span>${html(label)}</span><strong>${p}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${p}%"></div></div></div>`;
}

function circle(value, label = "Score") {
  const p = percent(value);
  return `<div class="score-circle" style="--score:${p}"><span>${p}%</span><small>${html(label)}</small></div>`;
}

function doneIcon(done) {
  return done ? `<span class="done-check" title="Completed">✓</span>` : ``;
}

function ensureBox(ids, fallbackParentSelector = ".container, main, body", className = "") {
  for (const name of ids) {
    const found = id(name);
    if (found) return found;
  }
  const box = document.createElement("div");
  box.id = ids[0];
  if (className) box.className = className;
  const parent = qs(fallbackParentSelector) || document.body;
  parent.appendChild(box);
  return box;
}

function navbar() {
  qs(".navbar")?.remove();
  const user = getUser();
  const logged = Boolean(getToken());
  const role = String(user?.role || "").toLowerCase();
  const mode = String(user?.current_mode || user?.mode || role || "student").toLowerCase();
  const adminMode = role === "admin" && mode !== "student";
  const links = adminMode
    ? [["Admin", route("admin")], ["Profile", route("profile")]]
    : [["Home", route("home")], ["Specializations", route("specializations")], ["Courses", route("courses")], ["ATS", route("ats")], ["Jobs", route("jobs")], ["Recommendation", route("recommendation")], ["Profile", route("profile")]];
  const current = pageName().toLowerCase();
  const nav = document.createElement("header");
  nav.className = "navbar";
  nav.innerHTML = `
    <div class="nav-inner">
      <a class="brand" href="${route("home")}"><span>SQR</span><small>Skill Quest Road</small></a>
      <button type="button" class="nav-toggle" aria-label="Menu">☰</button>
      <nav class="nav-links">
        ${links.map(([label, href]) => `<a class="${current === href.toLowerCase() ? "active" : ""}" href="${href}">${html(label)}</a>`).join("")}
      </nav>
      <div class="nav-actions">
        ${logged ? `<button type="button" class="btn btn-soft btn-small" onclick="logout()">Logout</button>` : `<a class="btn btn-soft btn-small" href="${route("signin")}">Sign In</a><a class="btn btn-primary btn-small" href="${route("signup")}">Sign Up</a>`}
      </div>
    </div>`;
  document.body.prepend(nav);
  qs(".nav-toggle", nav)?.addEventListener("click", () => nav.classList.toggle("open"));
}

function logout() {
  clearAuth();
  showMessage("Signed out successfully.", "success");
  setTimeout(() => go(route("signin")), 450);
}

function requireLogin() {
  if (getToken()) return true;
  showMessage("Please sign in first.", "error");
  setTimeout(() => go(route("signin")), 700);
  return false;
}

function requireAdmin() {
  if (!requireLogin()) return false;
  const user = getUser();
  if (String(user?.role || "").toLowerCase() !== "admin") {
    showMessage("Admin access only.", "error");
    setTimeout(() => go(route("home")), 700);
    return false;
  }
  return true;
}

function blockAdminFromStudentPages() {
  const user = getUser();
  if (!user) return;
  const role = String(user.role || "").toLowerCase();
  const mode = String(user.current_mode || user.mode || role || "").toLowerCase();
  if (role !== "admin" || mode === "student") return;
  const allowed = new Set(["admin.html", "profile.html", "signin.html", "signup.html"]);
  if (!allowed.has(pageName().toLowerCase())) go(route("admin"));
}

function setupSignup() {
  const form = id("signupForm") || qs("form[data-form='signup']");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = qs("button[type='submit']", form);
    const data = values(form);
    data.role = "student";
    delete data.confirm_password;
    delete data.confirmPassword;
    setLoading(submit, true, "Creating...");
    try {
      const result = await apiAny(["/api/signup", "/signup"], { method: "POST", body: JSON.stringify(data), action: true, redirectOnUnauthorized: false });
      const token = result.token || result.access_token;
      const user = result.user || result.profile || result;
      if (token) setAuth(token, user);
      showMessage("Account created successfully.", "success");
      setTimeout(() => go(route("profile")), 650);
    } catch (err) {
      showMessage(err.data?.error || err.message || "Signup failed.", "error");
    } finally {
      setLoading(submit, false);
    }
  });
}

function setupSignin() {
  const form = id("signinForm") || id("loginForm") || qs("form[data-form='signin']");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = qs("button[type='submit']", form);
    setLoading(submit, true, "Signing in...");
    try {
      const result = await apiAny(["/api/signin", "/api/login", "/signin", "/login"], { method: "POST", body: JSON.stringify(values(form)), action: true, redirectOnUnauthorized: false });
      const token = result.token || result.access_token;
      const user = result.user || result.profile || result;
      if (!token) throw new Error("No token returned from backend.");
      setAuth(token, user);
      showMessage("Signed in successfully.", "success");
      const role = String(user?.role || "").toLowerCase();
      const mode = String(user?.current_mode || user?.mode || role || "student").toLowerCase();
      setTimeout(() => go(role === "admin" && mode !== "student" ? route("admin") : route("profile")), 650);
    } catch (err) {
      showMessage(err.data?.error || err.message || "Signin failed.", "error");
    } finally {
      setLoading(submit, false);
    }
  });
}

async function loadProfile() {
  const box = id("profileBox") || id("profile");
  const form = id("profileForm");
  if (!box && !form) return;
  if (!requireLogin()) return;
  try {
    const result = await apiAny(["/api/profile", "/api/me"], { silentUnauthorized: false });
    const user = result.user || result.profile || result;
    setAuth(getToken(), { ...getUser(), ...user });
    if (box) {
      box.innerHTML = `
        <section class="profile-hero card glass-card">
          <div>
            <span class="eyebrow">My Dashboard</span>
            <h1>${html(user.name || "Student")}</h1>
            <p>${html(user.email || "")}</p>
            <div class="chip-row"><span class="chip">Role: ${html(user.role || "student")}</span><span class="chip">Mode: ${html(user.current_mode || user.mode || user.role || "student")}</span></div>
          </div>
          ${circle(user.overall_progress || user.progress || 0, "Progress")}
        </section>
        ${renderProfileProgress(result)}`;
    }
    fill(form, user);
  } catch (err) {
    showMessage(err.data?.error || err.message || "Could not load profile.", "error");
  }
  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submit = qs("button[type='submit']", form);
      setLoading(submit, true, "Saving...");
      try {
        const result = await apiAny(["/api/profile", "/api/me"], { method: "PUT", body: JSON.stringify(values(form)), action: true });
        const user = result.user || result.profile || result;
        setAuth(getToken(), { ...getUser(), ...user });
        showMessage("Profile updated.", "success");
        await loadProfile();
      } catch (err) {
        showMessage(err.data?.error || err.message || "Could not update profile.", "error");
      } finally {
        setLoading(submit, false);
      }
    });
  }
}

function renderProfileProgress(result) {
  const items = result.progress || result.specialization_progress || result.enrollments || [];
  if (!Array.isArray(items) || !items.length) return `<section class="card empty-card"><h2>No progress yet</h2><p>Open a course, watch the video or open its link, then finish quizzes to start tracking.</p></section>`;
  return `<section class="card"><h2>Progress by Specialization</h2><div class="stack-list">${items.map((x) => `<div class="stack-item"><h3>${html(pick(x, ["name", "title", "specialization_name"], "Specialization"))}</h3>${progress(pick(x, ["progress", "percentage", "completed_percent"], 0), "Completed")}</div>`).join("")}</div></section>`;
}

function setupModeSwitch() {
  const btnEl = id("modeSwitch") || id("switchModeBtn");
  if (!btnEl || btnEl.dataset.bound) return;
  btnEl.dataset.bound = "1";
  btnEl.addEventListener("click", async () => {
    if (!requireLogin()) return;
    try {
      const result = await apiAny(["/api/profile/switch-mode", "/api/switch-mode"], { method: "POST", body: "{}", action: true });
      const user = result.user || result.profile || result;
      setAuth(getToken(), { ...getUser(), ...user });
      showMessage("Mode switched.", "success");
      setTimeout(() => location.reload(), 650);
    } catch (err) {
      showMessage(err.data?.error || err.message || "Could not switch mode.", "error");
    }
  });
}

function renderHomeCards() {
  if (!["", "index.html", "gp.html"].includes(pageName().toLowerCase())) return;
  const box = ensureBox(["homeCards", "dashboardCards", "features"], ".home-shell, .container, main, body", "grid cards-4 home-panels");
  box.classList.add("grid", "cards-4", "home-panels");
  box.innerHTML = `
    <article class="feature-card clickable-card" data-link="${route("specializations")}" role="button" tabindex="0">
      <div class="panel-icon">▣</div><h2>Specializations</h2><p>Choose your CS path and follow a structured roadmap.</p><span>View Specializations</span>
    </article>
    <article class="feature-card clickable-card" data-link="${route("courses")}" role="button" tabindex="0">
      <div class="panel-icon">▶</div><h2>Courses</h2><p>Learn through courses connected to each specialization.</p><span>View Courses</span>
    </article>
    <article class="feature-card clickable-card" data-link="${route("ats")}" role="button" tabindex="0">
      <div class="panel-icon">◎</div><h2>ATS Resume</h2><p>Generate and check ATS-friendly resumes.</p><span>Open ATS</span>
    </article>
    <article class="feature-card clickable-card" data-link="${route("recommendation")}" role="button" tabindex="0">
      <div class="panel-icon">✦</div><h2>Recommendation</h2><p>Get specialization and job recommendations based on your quiz and profile.</p><span>Get Recommendation</span>
    </article>`;
}

async function getSpecializations() {
  const result = await apiAny(["/api/specializations", "/api/specialization"], { redirectOnUnauthorized: false, silentUnauthorized: true });
  return result.specializations || result.items || result.data || (Array.isArray(result) ? result : []);
}

async function getCourses(query = "") {
  const q = query ? "?" + query : "";
  const result = await apiAny([`/api/courses${q}`, `/api/course${q}`], { redirectOnUnauthorized: false, silentUnauthorized: true });
  return result.courses || result.items || result.data || (Array.isArray(result) ? result : []);
}

async function getJobs() {
  const result = await apiAny(["/api/jobs", "/api/job"], { redirectOnUnauthorized: false, silentUnauthorized: true });
  return result.jobs || result.items || result.data || (Array.isArray(result) ? result : []);
}

async function loadSpecializations() {
  const box = id("specializationsBox") || id("specializationBox") || id("specializationsList") || id("specializations");
  if (!box) return;
  try {
    box.innerHTML = `<div class="loading-card">Loading specializations...</div>`;
    const specs = await getSpecializations();
    SQR.state.specializations = specs;
    if (!specs.length) {
      box.innerHTML = `<div class="card empty-card">No specializations were added yet.</div>`;
      return;
    }
    box.classList.add("grid", "cards-3");
    box.innerHTML = specs.map(renderSpecializationCard).join("");
  } catch (_) {
    box.innerHTML = `<div class="card error-card">Could not load specializations.</div>`;
  }
}

function renderSpecializationCard(spec) {
  const sid = objId(spec);
  const title = pick(spec, ["name", "title", "specialization_name"], "Specialization");
  const desc = pick(spec, ["description", "overview", "details"], "View roadmap, skills, job titles, courses, and certificates.");
  const skills = asArray(pick(spec, ["skills", "skill_list"], []));
  const p = pick(spec, ["progress", "percentage", "completed_percent"], 0);
  return `<article class="card entity-card clickable-card" data-link="${route("specializationDetails", { id: sid })}" data-specialization-id="${html(sid || "")}" role="button" tabindex="0">
    ${media(spec)}
    <div class="card-body">
      <div class="card-title-row"><h2>${html(title)}</h2>${getToken() ? doneIcon(num(p) >= 100) : ""}</div>
      <p>${html(desc)}</p>
      ${getToken() ? progress(p, "Progress") : ""}
      ${skills.length ? `<div class="chip-row">${skills.slice(0, 8).map((s) => `<span class="chip">${html(s)}</span>`).join("")}</div>` : ""}
      <div class="card-actions">
        ${btn("View Details", "btn btn-primary", `data-no-card-click data-open-specialization=\"${html(sid || "")}\"`)}
        ${btn("Courses", "btn btn-soft", `data-no-card-click data-link=\"${route("courses", { specialization_id: sid })}\"`)}
      </div>
    </div>
  </article>`;
}

async function loadSpecializationDetails() {
  const sid = param("id") || param("specialization_id") || param("spec_id");
  const box = id("specializationDetails") || id("specializationDetail") || id("detailsBox");
  if (!box || !sid) return;
  try {
    box.innerHTML = `<div class="loading-card">Loading details...</div>`;
    const result = await apiAny([`/api/specializations/${sid}`, `/api/specialization/${sid}`], { redirectOnUnauthorized: false, silentUnauthorized: true });
    const spec = result.specialization || result.item || result;
    const courses = result.courses || await getCourses(`specialization_id=${encodeURIComponent(sid)}`);
    box.innerHTML = `<section class="detail-hero card glass-card">
      ${media(spec, "detail-media")}
      <div><span class="eyebrow">Specialization</span><h1>${html(pick(spec, ["name", "title"], "Specialization"))}</h1><p>${html(pick(spec, ["description", "overview"], ""))}</p>${getToken() ? progress(pick(spec, ["progress", "percentage"], 0), "Progress") : ""}</div>
    </section>${renderRoadmap(spec)}${renderSkills(spec)}${renderRelatedCourses(courses)}${renderMiniList("Job Titles", result.jobs || [], ["title", "name", "job_title"])}${renderMiniList("Certificates", result.certifications || result.certificates || [], ["title", "name", "certificate_name"])} `;
  } catch (_) {
    box.innerHTML = `<div class="card error-card">Could not load specialization details.</div>`;
  }
}

function renderRoadmap(spec) {
  const items = asArray(pick(spec, ["roadmap", "steps", "learning_path"], []));
  if (!items.length) return "";
  return `<section class="card"><h2>Roadmap</h2><div class="timeline">${items.map((x, i) => `<div class="timeline-item"><span>${i + 1}</span><p>${html(x)}</p></div>`).join("")}</div></section>`;
}

function renderSkills(spec) {
  const items = asArray(pick(spec, ["skills", "skill_list"], []));
  if (!items.length) return "";
  return `<section class="card"><h2>Skills</h2><div class="chip-row">${items.map((x) => `<span class="chip">${html(x)}</span>`).join("")}</div></section>`;
}

function renderMiniList(title, items, keys) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<section class="card"><h2>${html(title)}</h2><div class="grid cards-3">${items.map((x) => `<article class="mini-card"><h3>${html(pick(x, keys, "Item"))}</h3><p>${html(pick(x, ["description", "summary"], ""))}</p></article>`).join("")}</div></section>`;
}

function renderRelatedCourses(courses) {
  if (!Array.isArray(courses) || !courses.length) return "";
  return `<section class="card related-section"><div class="section-head"><h2>Courses</h2>${a("All Courses", route("courses"), "btn btn-soft")}</div><div class="grid cards-3">${courses.map(renderCourseCard).join("")}</div></section>`;
}

async function loadCourses() {
  const box = id("coursesBox") || id("coursesList") || id("courses");
  if (!box) return;
  const params = new URLSearchParams();
  const sid = param("specialization_id") || param("spec_id");
  if (sid) params.set("specialization_id", sid);
  try {
    box.innerHTML = `<div class="loading-card">Loading courses...</div>`;
    const courses = await getCourses(params.toString());
    SQR.state.courses = courses;
    if (!courses.length) {
      box.innerHTML = `<div class="card empty-card">No courses were added yet.</div>`;
      return;
    }
    box.classList.add("grid", "cards-3");
    box.innerHTML = courses.map(renderCourseCard).join("");
  } catch (_) {
    box.innerHTML = `<div class="card error-card">Could not load courses.</div>`;
  }
}

function renderCourseCard(course) {
  const cid = objId(course);
  const title = pick(course, ["title", "name", "course_name"], "Course");
  const desc = pick(course, ["description", "summary"], "Open the course to auto-enroll and track your progress.");
  const completed = Boolean(course.completed || course.is_completed || course.done || num(course.progress) >= 100);
  const enrolled = Boolean(course.enrolled || course.is_enrolled || course.enrollment_id);
  const p = pick(course, ["progress", "percentage", "completed_percent"], completed ? 100 : 0);
  return `<article class="card entity-card course-card clickable-card" data-link="${route("courseDetails", { id: cid })}" data-course-id="${html(cid || "")}" role="button" tabindex="0">
    ${media(course)}
    <div class="card-body">
      <div class="card-title-row"><h2>${html(title)}</h2>${getToken() ? doneIcon(completed) : ""}</div>
      <p>${html(desc)}</p>
      <div class="chip-row">${pick(course, ["difficulty", "level"], "") ? `<span class="chip level-chip">${html(pick(course, ["difficulty", "level"], ""))}</span>` : ""}${enrolled ? `<span class="chip success-chip">Enrolled</span>` : ""}</div>
      ${getToken() ? progress(p, "Progress") : ""}
      <div class="card-actions">
        ${btn("Open Course", "btn btn-primary", `data-no-card-click data-open-course=\"${html(cid || "")}\"`)}
        ${getToken() ? enrolled ? btn("Unenroll", "btn btn-danger", `data-no-card-click data-unenroll-course=\"${html(cid || "")}\"`) : btn("Enroll", "btn btn-soft", `data-no-card-click data-enroll-course=\"${html(cid || "")}\"`) : a("Sign in to enroll", route("signin"), "btn btn-soft", "data-no-card-click")}
      </div>
    </div>
  </article>`;
}

async function loadCourseDetails() {
  const cid = param("id") || param("course_id");
  const box = id("courseDetails") || id("courseDetail") || id("courseBox");
  if (!box || !cid) return;
  try {
    box.innerHTML = `<div class="loading-card">Loading course...</div>`;
    const result = await apiAny([`/api/courses/${cid}`, `/api/course/${cid}`], { redirectOnUnauthorized: false, silentUnauthorized: true });
    const course = result.course || result.item || result;
    if (!course || Object.keys(course).length === 0) {
      box.innerHTML = `<div class="card error-card">Course not found.</div>`;
      return;
    }
    if (getToken()) await autoEnrollCourse(cid);
    const link = pick(course, ["url", "link", "course_url", "external_url"], "");
    const video = pick(course, ["video_url", "video", "video_path"], "");
    box.innerHTML = `<section class="detail-hero card glass-card">
      ${media(course, "detail-media")}
      <div><span class="eyebrow">Course</span><h1>${html(pick(course, ["title", "name", "course_name"], "Course"))}</h1><p>${html(pick(course, ["description", "summary"], ""))}</p>${getToken() ? progress(pick(course, ["progress", "percentage"], 0), "Course Progress") : ""}<div class="card-actions">${link ? a("Open Link", asset(link), "btn btn-primary", `target=\"_blank\" rel=\"noopener\" data-track-course=\"${html(cid)}\"`) : ""}${getToken() ? btn("Unenroll", "btn btn-danger", `data-unenroll-course=\"${html(cid)}\"`) : a("Sign in to enroll", route("signin"), "btn btn-soft")}</div></div>
    </section>${video ? `<section class="card"><h2>Course Video</h2><video class="course-video" controls src="${html(asset(video))}" data-track-course="${html(cid)}"></video></section>` : ""}${renderQuizSection(result.quiz || result.quizzes || course.quiz || [], cid)}`;
    bindQuizForms();
  } catch (_) {
    box.innerHTML = `<div class="card error-card">Could not load course.</div>`;
  }
}

async function enrollCourse(courseId, silent = false) {
  if (!courseId || !requireLogin()) return false;
  try {
    await apiAny([`/api/courses/${courseId}/enroll`, `/api/enrollments/course/${courseId}`, `/api/enroll/${courseId}`], { method: "POST", body: JSON.stringify({ course_id: courseId }), action: !silent, silentUnauthorized: silent });
    if (!silent) showMessage("Enrolled successfully.", "success");
    if (!silent) await refreshCurrentData();
    return true;
  } catch (err) {
    if (!silent) showMessage(err.data?.error || err.message || "Could not enroll.", "error");
    return false;
  }
}

async function unenrollCourse(courseId) {
  if (!courseId || !requireLogin()) return;
  try {
    await apiAny([`/api/courses/${courseId}/enroll`, `/api/enrollments/course/${courseId}`, `/api/enroll/${courseId}`], { method: "DELETE", body: JSON.stringify({ course_id: courseId }), action: true });
    showMessage("Unenrolled successfully.", "success");
    await refreshCurrentData();
  } catch (err) {
    showMessage(err.data?.error || err.message || "Could not unenroll.", "error");
  }
}

async function trackCourseOpened(courseId, silent = true) {
  if (!courseId || !getToken()) return false;
  try {
    await apiAny([`/api/courses/${courseId}/open`, `/api/courses/${courseId}/track`, `/api/progress/course-opened`], { method: "POST", body: JSON.stringify({ course_id: courseId }), redirectOnUnauthorized: false, silentUnauthorized: silent });
    return true;
  } catch (_) {
    return false;
  }
}

async function autoEnrollCourse(courseId) {
  if (!courseId || !getToken()) return false;
  await enrollCourse(courseId, true);
  await trackCourseOpened(courseId, true);
  return true;
}

async function refreshCurrentData() {
  const p = pageName().toLowerCase();
  if (p.includes("course")) {
    await loadCourses();
    await loadCourseDetails();
  }
  if (p.includes("special")) {
    await loadSpecializations();
    await loadSpecializationDetails();
  }
  if (p.includes("profile")) await loadProfile();
}

function renderQuizSection(quizData, courseId) {
  const quizzes = Array.isArray(quizData) ? quizData : quizData ? [quizData] : [];
  if (!quizzes.length) return `<section class="card"><h2>Course Quiz</h2><p>No quizzes were added for this course yet.</p></section>`;
  return `<section class="card"><h2>Course Quiz</h2>${quizzes.map((q, i) => renderQuiz(q, courseId, i)).join("")}</section>`;
}

function renderQuiz(quiz, courseId, index) {
  const questions = quiz.questions || quiz.items || quiz.quiz_questions || [];
  const quizId = objId(quiz) || `local-${index}`;
  if (!Array.isArray(questions) || !questions.length) return `<div class="mini-card"><h3>${html(quiz.title || "Quiz")}</h3><p>No questions were added yet.</p></div>`;
  return `<form class="quiz-form" data-quiz-id="${html(quizId)}" data-course-id="${html(courseId)}"><h3>${html(quiz.title || quiz.name || "Quiz")}</h3>${questions.map((question, qi) => {
    const qid = objId(question) || qi;
    const options = question.options || [question.option_a, question.option_b, question.option_c, question.option_d, question.option1, question.option2, question.option3, question.option4].filter(Boolean);
    return `<div class="question-card" data-question-id="${html(qid)}"><strong>${qi + 1}. ${html(pick(question, ["question", "text", "title"], "Question"))}</strong>${options.map((op, oi) => `<label class="option-label"><input type="radio" name="q_${html(qid)}" value="${html(op)}" required><span>${html(op)}</span></label>`).join("")}</div>`;
  }).join("")}<button type="submit" class="btn btn-primary">Submit Quiz</button><div class="quiz-result"></div></form>`;
}

function bindQuizForms() {
  qsa(".quiz-form").forEach((form) => {
    if (form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireLogin()) return;
      const submit = qs("button[type='submit']", form);
      const resultBox = qs(".quiz-result", form);
      const quizId = form.dataset.quizId;
      const courseId = form.dataset.courseId;
      const answers = qsa(".question-card", form).map((card) => ({ question_id: card.dataset.questionId, answer: qs("input:checked", card)?.value || "" })).filter((x) => x.answer);
      setLoading(submit, true, "Submitting...");
      try {
        const result = await apiAny([`/api/quizzes/${quizId}/submit`, `/api/quiz/${quizId}/submit`, "/api/quiz-attempts"], { method: "POST", body: JSON.stringify({ quiz_id: quizId, course_id: courseId, answers }), action: true });
        const score = result.score ?? result.percentage ?? result.result ?? 0;
        resultBox.innerHTML = `<div class="result-card">${circle(score, "Quiz Score")}<div><h3>${html(result.message || "Quiz submitted")}</h3><p>${html(result.feedback || "Your quiz score was saved and added to progress.")}</p></div></div>`;
        showMessage("Quiz submitted.", "success");
        await trackCourseOpened(courseId, true);
      } catch (err) {
        showMessage(err.data?.error || err.message || "Could not submit quiz.", "error");
      } finally {
        setLoading(submit, false);
      }
    });
  });
}

async function loadJobs() {
  const box = id("jobsBox") || id("jobsList") || id("jobs");
  if (!box) return;
  try {
    box.innerHTML = `<div class="loading-card">Loading jobs...</div>`;
    const jobs = await getJobs();
    SQR.state.jobs = jobs;
    if (!jobs.length) {
      box.innerHTML = `<div class="card empty-card">No jobs were added yet.</div>`;
      return;
    }
    box.classList.add("grid", "cards-3");
    box.innerHTML = jobs.map((job) => `<article class="card entity-card"><span class="eyebrow">${html(pick(job, ["specialization_name", "specialization", "path"], "Career"))}</span><h2>${html(pick(job, ["title", "name", "job_title"], "Job"))}</h2><p>${html(pick(job, ["description", "summary"], ""))}</p><div class="chip-row">${asArray(pick(job, ["skills", "requirements"], [])).slice(0, 8).map((s) => `<span class="chip">${html(s)}</span>`).join("")}</div>${pick(job, ["link", "url"], "") ? a("Open Job Link", asset(pick(job, ["link", "url"], "")), "btn btn-soft", `target=\"_blank\" rel=\"noopener\"`) : ""}</article>`).join("");
  } catch (_) {
    box.innerHTML = `<div class="card error-card">Could not load jobs.</div>`;
  }
}

function setupRecommendation() {
  const form = id("recForm") || id("recommendationForm");
  const quizBox = id("recommendationQuiz");
  if (quizBox) loadRecommendationQuiz(quizBox);
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    const submit = qs("button[type='submit']", form);
    const box = id("recommendationResult") || id("recResult") || id("result");
    const data = values(form);
    const answers = qsa(".rec-question", form).map((card) => ({ question: qs("strong", card)?.textContent || "", answer: qs("input:checked", card)?.value || "" })).filter((x) => x.answer);
    if (answers.length) data.answers = answers;
    setLoading(submit, true, "Analyzing...");
    try {
      const result = await apiAny(["/api/recommendation", "/api/recommendation/submit", "/api/recommendations", "/api/recommend"], { method: "POST", body: JSON.stringify(data), action: true });
      renderRecommendationResult(result, box);
      showMessage("Recommendation generated.", "success");
    } catch (err) {
      showMessage(err.data?.error || err.message || "Recommendation failed.", "error");
    } finally {
      setLoading(submit, false);
    }
  });
}

async function loadRecommendationQuiz(quizBox) {
  if (!getToken()) return;
  try {
    const result = await apiAny(["/api/recommendation/quiz"], { silentUnauthorized: true, redirectOnUnauthorized: false });
    const questions = result.questions || [];
    SQR.state.recommendationQuiz = questions;
    quizBox.innerHTML = questions.map((q) => `<div class="rec-question question-card"><strong>${html(q.question)}</strong>${asArray(q.options).map((op) => `<label class="option-label"><input type="radio" name="rec_${html(q.id)}" value="${html(op)}"><span>${html(op)}</span></label>`).join("")}</div>`).join("");
  } catch (_) {}
}

function renderRecommendationResult(result, box) {
  if (!box) return;
  const recommendations = result.recommended_specializations || result.specializations || [];
  const spec = result.specialization || result.recommended_specialization || result.best_match || recommendations[0] || {};
  const jobs = result.jobs || result.job_recommendations || [];
  const score = result.score || result.match || result.percentage || spec.match_score || spec.match_percentage || 0;
  box.innerHTML = `<section class="card result-card">${circle(score, "Match")}<div><span class="eyebrow">Recommended Specialization</span><h2>${html(pick(spec, ["name", "title"], typeof spec === "string" ? spec : "Specialization"))}</h2><p>${html(result.reason || result.explanation || result.summary || pick(spec, ["description", "reason"], ""))}</p></div></section>${Array.isArray(recommendations) && recommendations.length ? `<section class="grid cards-3">${recommendations.map((r) => `<article class="card mini-card"><h3>${html(pick(r, ["name", "title"], "Specialization"))}</h3>${circle(r.match_score || r.match_percentage || 0, "Match")}<p>${html(pick(r, ["reason", "description"], ""))}</p></article>`).join("")}</section>` : ""}${Array.isArray(jobs) && jobs.length ? `<section class="card"><h2>Job Recommendations</h2><div class="grid cards-3">${jobs.map((j) => `<article class="mini-card"><h3>${html(pick(j, ["title", "name"], "Job"))}</h3><p>${html(pick(j, ["description", "reason"], ""))}</p></article>`).join("")}</div></section>` : ""}`;
}

function setupATS() {
  setupATSChecker();
  setupATSGenerator();
}

function setupATSChecker() {
  const form = id("atsCheckForm") || id("atsCheckerForm");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  const file = qs("input[type='file']", form);
  if (file) file.accept = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    const selected = file?.files?.[0];
    if (!selected) return showMessage("Please upload a PDF or DOCX resume.", "error");
    if (!/\.(pdf|docx)$/i.test(selected.name)) return showMessage("Only PDF or DOCX files are allowed.", "error");
    const submit = qs("button[type='submit']", form);
    const box = id("atsCheckResult") || id("atsResult") || id("checkerResult");
    setLoading(submit, true, "Checking...");
    try {
      const result = await apiAny(["/api/ats/check", "/api/ats/checker", "/api/ats/upload"], { method: "POST", body: new FormData(form), action: true });
      renderATSResult(result, box);
      showMessage("ATS check completed.", "success");
    } catch (err) {
      showMessage(err.data?.error || err.message || "ATS checker failed.", "error");
    } finally {
      setLoading(submit, false);
    }
  });
}

function setupATSGenerator() {
  const form = id("atsGenerateForm") || id("atsGeneratorForm");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  form.autocomplete = "off";
  qsa("[required]", form).forEach((el) => qs(`label[for='${el.id}']`)?.classList.add("required"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    const submit = qs("button[type='submit']", form);
    const box = id("atsGenerateResult") || id("generatorResult") || id("atsResult");
    setLoading(submit, true, "Generating...");
    try {
      const result = await apiAny(["/api/ats/generate", "/api/ats/resume"], { method: "POST", body: JSON.stringify(values(form)), action: true });
      renderATSGenerated(result, box);
      showMessage("Resume generated.", "success");
    } catch (err) {
      showMessage(err.data?.error || err.message || "ATS generator failed.", "error");
    } finally {
      setLoading(submit, false);
    }
  });
}

function renderATSResult(result, box) {
  if (!box) return;
  const missing = result.missing_keywords || result.missing || [];
  const found = result.found_keywords || result.found || result.skills || result.matched_keywords || [];
  box.innerHTML = `<section class="card result-card">${circle(result.score || result.ats_score || result.percentage || 0, "ATS Score")}<div><h2>${html(result.title || "ATS Result")}</h2><p>${html(result.summary || result.feedback || result.message || "Resume analysis completed.")}</p></div></section><section class="grid cards-2"><div class="card"><h3>Found Keywords</h3><div class="chip-row">${asArray(found).map((x) => `<span class="chip success-chip">${html(x)}</span>`).join("") || "<p>No keywords detected.</p>"}</div></div><div class="card"><h3>Missing Keywords</h3><div class="chip-row">${asArray(missing).map((x) => `<span class="chip danger-chip">${html(x)}</span>`).join("") || "<p>No major missing keywords.</p>"}</div></div></section>`;
}

function renderATSGenerated(result, box) {
  if (!box) return;
  const resume = result.resume || result.text || result.content || result.generated_resume || "";
  box.innerHTML = `<section class="card"><div class="section-head"><h2>Generated ATS Resume</h2><div class="card-actions">${result.download_url ? a("Download", asset(result.download_url), "btn btn-primary") : ""}${btn("Export PDF", "btn btn-soft", "data-export-pdf")}${btn("Export DOCX", "btn btn-soft", "data-export-docx")}</div></div><pre id="generatedResumeText" class="resume-output">${html(resume || JSON.stringify(result, null, 2))}</pre></section>`;
}

async function exportResume(format) {
  const resume = id("generatedResumeText")?.textContent || "";
  if (!resume) return showMessage("Generate the resume first.", "error");
  try {
    const res = await fetch(`${API}/api/ats/export/${format}`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ resume }) });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = format === "pdf" ? "SQR_Resume.pdf" : "SQR_Resume.docx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showMessage(err.message || "Export failed.", "error");
  }
}

async function loadAdmin() {
  const adminRoot = id("adminRoot") || id("adminBox") || qs(".admin-page") || qs("main");
  if (!adminRoot || !pageName().toLowerCase().includes("admin")) return;
  document.body.classList.add("admin-body");
  if (!requireAdmin()) return;
  fixAdminLayout();
  await Promise.allSettled([adminStats(), adminLoadLists()]);
  bindAdminForms();
  bindAdminActions();
}

function fixAdminLayout() {
  document.body.classList.add("admin-page-fixed");
  qsa("table").forEach((table) => {
    if (!table.parentElement.classList.contains("table-wrap")) {
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
  });
  qsa("form").forEach((form) => {
    if (!form.classList.contains("admin-form") && (form.closest(".admin-page") || pageName().toLowerCase().includes("admin"))) form.classList.add("admin-form");
  });
}

async function adminStats() {
  const box = id("adminStats") || id("statsBox") || id("dashboardStats");
  if (!box) return;
  try {
    const result = await apiAny(["/api/admin/stats", "/api/stats", "/api/admin/dashboard"], { action: true });
    const stats = result.stats || result;
    const cards = [["Users", stats.users ?? stats.user_count ?? 0], ["Specializations", stats.specializations ?? stats.specialization_count ?? 0], ["Courses", stats.courses ?? stats.course_count ?? 0], ["Jobs", stats.jobs ?? stats.job_count ?? 0], ["Quizzes", stats.quizzes ?? stats.quiz_count ?? 0], ["Certificates", stats.certifications ?? stats.certification_count ?? stats.certificates ?? 0]];
    box.classList.add("admin-stats");
    box.innerHTML = cards.map(([label, value]) => `<article><span>${html(label)}</span><strong>${html(value)}</strong></article>`).join("");
  } catch (_) {
    box.innerHTML = `<div class="card error-card">Could not load statistics.</div>`;
  }
}

async function adminLoadLists() {
  await Promise.allSettled([adminLoadSpecializations(), adminLoadCourses(), adminLoadJobs(), adminLoadUsers(), adminLoadQuizzes(), adminLoadCertifications()]);
  populateAdminSelects();
}

async function adminLoadSpecializations() {
  try {
    SQR.state.specializations = await getSpecializations();
    const box = id("adminSpecializations") || id("specializationsTable") || id("adminSpecializationsList");
    if (box) box.innerHTML = renderAdminTable(SQR.state.specializations, ["id", "specialization_id", "name", "title", "description"], "specialization");
  } catch (_) {}
}

async function adminLoadCourses() {
  try {
    SQR.state.courses = await getCourses();
    const box = id("adminCourses") || id("coursesTable") || id("adminCoursesList");
    if (box) box.innerHTML = renderAdminTable(SQR.state.courses, ["id", "course_id", "title", "name", "specialization_name", "level", "difficulty"], "course");
  } catch (_) {}
}

async function adminLoadJobs() {
  try {
    SQR.state.jobs = await getJobs();
    const box = id("adminJobs") || id("jobsTable") || id("adminJobsList");
    if (box) box.innerHTML = renderAdminTable(SQR.state.jobs, ["id", "job_id", "title", "name", "specialization_name", "specialization"], "job");
  } catch (_) {}
}

async function adminLoadUsers() {
  const box = id("adminUsers") || id("usersTable") || id("adminUsersList");
  if (!box) return;
  try {
    const result = await apiAny(["/api/admin/users", "/api/users"], { action: true });
    SQR.state.users = result.users || result.items || result.data || (Array.isArray(result) ? result : []);
    box.innerHTML = renderAdminTable(SQR.state.users, ["id", "user_id", "name", "email", "role", "banned"], "user");
  } catch (_) {
    box.innerHTML = `<div class="card error-card">Could not load users.</div>`;
  }
}

async function adminLoadQuizzes() {
  const box = id("adminQuizzes") || id("quizzesTable") || id("adminQuizzesList");
  try {
    const result = await apiAny(["/api/admin/quizzes", "/api/quizzes"], { action: true });
    SQR.state.quizzes = result.quizzes || result.items || result.data || (Array.isArray(result) ? result : []);
    if (box) box.innerHTML = renderAdminTable(SQR.state.quizzes, ["id", "quiz_id", "title", "name", "course_title", "course_id"], "quiz");
  } catch (_) {
    if (box) box.innerHTML = `<div class="card error-card">Could not load quizzes.</div>`;
  }
}

async function adminLoadCertifications() {
  const box = id("adminCertifications") || id("certificationsTable") || id("adminCertificatesList");
  try {
    const result = await apiAny(["/api/admin/certifications", "/api/certifications", "/api/certificates"], { action: true });
    SQR.state.certifications = result.certifications || result.certificates || result.items || result.data || (Array.isArray(result) ? result : []);
    if (box) box.innerHTML = renderAdminTable(SQR.state.certifications, ["id", "certificate_id", "certification_id", "title", "name", "specialization_name", "price"], "certification");
  } catch (_) {
    if (box) box.innerHTML = `<div class="card error-card">Could not load certifications.</div>`;
  }
}

function renderAdminTable(items, keys, type) {
  if (!Array.isArray(items) || !items.length) return `<div class="empty-card card">No ${html(type)} records yet.</div>`;
  const usableKeys = keys.filter((key) => items.some((item) => item[key] !== undefined));
  return `<div class="table-wrap"><table><thead><tr>${usableKeys.map((key) => `<th>${html(key.replaceAll("_", " "))}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${items.map((item) => `<tr>${usableKeys.map((key) => `<td>${html(item[key])}</td>`).join("")}<td>${renderAdminActions(item, type)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderAdminActions(item, type) {
  const oid = objId(item);
  if (!oid) return "";
  if (type === "user") {
    const banned = Boolean(item.banned || item.is_banned);
    return btn(banned ? "Unban" : "Ban", banned ? "btn btn-soft btn-mini" : "btn btn-danger btn-mini", `data-toggle-ban=\"${html(oid)}\" data-ban-value=\"${!banned}\"`);
  }
  return btn("Delete", "btn btn-danger btn-mini", `data-admin-delete=\"${html(type)}\" data-id=\"${html(oid)}\"`);
}

function populateAdminSelects() {
  const specOptions = `<option value="">Select specialization</option>` + SQR.state.specializations.map((s) => `<option value="${html(objId(s) || "")}">${html(pick(s, ["name", "title", "specialization_name"], "Specialization"))}</option>`).join("");
  const courseOptions = `<option value="">Select course</option>` + SQR.state.courses.map((c) => `<option value="${html(objId(c) || "")}">${html(pick(c, ["title", "name", "course_name"], "Course"))}</option>`).join("");
  qsa("select[name='specialization_id'], select[name='spec_id'], #specialization_id, #spec_id, #courseSpecialization, #jobSpecialization, #certificationSpecialization").forEach((select) => {
    const old = select.value;
    select.innerHTML = specOptions;
    if (old) select.value = old;
  });
  qsa("select[name='course_id'], #course_id, #quizCourse, #questionCourse").forEach((select) => {
    const old = select.value;
    select.innerHTML = courseOptions;
    if (old) select.value = old;
  });
}

function bindAdminForms() {
  bindAdminForm(["addSpecializationForm", "specializationForm"], ["/api/admin/specializations", "/api/specializations"], "Specialization saved.");
  bindAdminForm(["addCourseForm", "courseForm"], ["/api/admin/courses", "/api/courses"], "Course saved.");
  bindAdminForm(["addJobForm", "jobForm"], ["/api/admin/jobs", "/api/jobs"], "Job saved.");
  bindAdminForm(["addCertificationForm", "certificationForm", "certificateForm"], ["/api/admin/certifications", "/api/certifications", "/api/certificates"], "Certification saved.");
  bindAdminForm(["addQuizForm", "quizForm"], ["/api/admin/quizzes", "/api/quizzes"], "Quiz saved.", normalizeQuizForm);
  bindAdminForm(["addQuestionForm", "questionForm"], ["/api/admin/questions", "/api/questions"], "Question saved.");
}

function bindAdminForm(ids, paths, successText, normalizer = null) {
  const form = ids.map((x) => id(x)).find(Boolean);
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireAdmin()) return;
    const submit = qs("button[type='submit']", form);
    setLoading(submit, true, "Saving...");
    try {
      let body = hasFile(form) ? new FormData(form) : values(form);
      if (body instanceof FormData) normalizeFormDataAliases(body);
      if (!(body instanceof FormData)) normalizeAliases(body);
      if (normalizer) body = normalizer(body, form);
      const finalBody = body instanceof FormData ? body : JSON.stringify(body);
      await apiAny(paths, { method: "POST", body: finalBody, action: true });
      showMessage(successText, "success");
      form.reset();
      await Promise.allSettled([adminStats(), adminLoadLists()]);
    } catch (err) {
      showMessage(err.data?.error || err.message || "Admin save failed.", "error");
    } finally {
      setLoading(submit, false);
    }
  });
}

function normalizeAliases(data) {
  if (data.specialization_id && !data.spec_id) data.spec_id = data.specialization_id;
  if (data.spec_id && !data.specialization_id) data.specialization_id = data.spec_id;
  if (data.course_image && !data.image) data.image = data.course_image;
  if (data.course_video && !data.video) data.video = data.course_video;
  if (data.name && !data.title) data.title = data.name;
  if (data.title && !data.name) data.name = data.title;
  return data;
}

function normalizeFormDataAliases(fd) {
  if (fd.get("specialization_id") && !fd.get("spec_id")) fd.append("spec_id", fd.get("specialization_id"));
  if (fd.get("spec_id") && !fd.get("specialization_id")) fd.append("specialization_id", fd.get("spec_id"));
  if (fd.get("course_image") && !fd.get("image")) fd.append("image", fd.get("course_image"));
  if (fd.get("course_video") && !fd.get("video")) fd.append("video", fd.get("course_video"));
}

function normalizeQuizForm(data, form) {
  if (data instanceof FormData) {
    const questions = collectQuizQuestions(form);
    if (questions.length) data.append("questions", JSON.stringify(questions));
    return data;
  }
  const questions = collectQuizQuestions(form);
  if (questions.length) data.questions = questions;
  return data;
}

function collectQuizQuestions(form) {
  const questions = [];
  qsa(".quiz-question-row, .question-row", form).forEach((row) => {
    const question = clean(qs("[name='question'], [name='questions[]'], .question-text", row)?.value);
    const options = ["option_a", "option_b", "option_c", "option_d", "option1", "option2", "option3", "option4"].map((name) => clean(qs(`[name='${name}'], .${name}`, row)?.value)).filter(Boolean);
    if (!options.length) qsa("[name='options'], .option-input", row).forEach((x) => { if (clean(x.value)) options.push(clean(x.value)); });
    const answer = clean(qs("[name='answer'], .answer-input", row)?.value);
    if (question) questions.push({ question, options, answer, option_a: options[0] || "", option_b: options[1] || "", option_c: options[2] || "", option_d: options[3] || "" });
  });
  return questions;
}

function bindAdminActions() {
  const addQuestionBtn = id("addQuestionBtn") || id("addQuizQuestion");
  const holder = id("quizQuestions") || id("questionsHolder");
  if (addQuestionBtn && holder && !addQuestionBtn.dataset.bound) {
    addQuestionBtn.dataset.bound = "1";
    addQuestionBtn.addEventListener("click", () => addQuizQuestionRow(holder));
    if (!qsa(".quiz-question-row", holder).length) addQuizQuestionRow(holder);
  }
  qsa(".admin-tabs a, .admin-tabs button").forEach((tab) => {
    if (tab.dataset.bound) return;
    tab.dataset.bound = "1";
    tab.addEventListener("click", (e) => {
      const target = tab.getAttribute("href") || tab.dataset.target;
      if (!target || !target.startsWith("#")) return;
      e.preventDefault();
      qsa(".admin-section").forEach((sec) => sec.classList.remove("active"));
      qs(target)?.classList.add("active");
      qsa(".admin-tabs a, .admin-tabs button").forEach((x) => x.classList.remove("active"));
      tab.classList.add("active");
    });
  });
}

function addQuizQuestionRow(holder) {
  const index = qsa(".quiz-question-row", holder).length + 1;
  if (index > 20) return showMessage("Maximum 20 questions per quiz.", "error");
  const row = document.createElement("div");
  row.className = "quiz-question-row card compact";
  row.innerHTML = `<div class="section-head"><h4>Question ${index}</h4><button type="button" class="btn btn-danger btn-mini" data-remove-question>Remove</button></div><label>Question</label><textarea name="question" class="question-text" required></textarea><div class="form-grid"><div><label>Option A</label><input name="option_a" required></div><div><label>Option B</label><input name="option_b" required></div><div><label>Option C</label><input name="option_c"></div><div><label>Option D</label><input name="option_d"></div><div><label>Correct Answer</label><select name="answer" class="answer-input" required><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></div></div>`;
  holder.appendChild(row);
}

async function adminToggleBan(userId, banned) {
  if (!requireAdmin()) return;
  try {
    await apiAny([`/api/admin/users/${userId}/ban`, `/api/users/${userId}/ban`], { method: "POST", body: JSON.stringify({ banned }), action: true });
    showMessage(banned ? "User banned." : "User unbanned.", "success");
    await adminLoadUsers();
    await adminStats();
  } catch (err) {
    showMessage(err.data?.error || err.message || "Could not update user.", "error");
  }
}

async function adminDelete(type, oid) {
  if (!requireAdmin()) return;
  if (!confirm("Delete this item?")) return;
  const map = {
    specialization: [`/api/admin/specializations/${oid}`, `/api/specializations/${oid}`],
    course: [`/api/admin/courses/${oid}`, `/api/courses/${oid}`],
    job: [`/api/admin/jobs/${oid}`, `/api/jobs/${oid}`],
    quiz: [`/api/admin/quizzes/${oid}`, `/api/quizzes/${oid}`],
    certification: [`/api/admin/certifications/${oid}`, `/api/certifications/${oid}`, `/api/certificates/${oid}`]
  };
  try {
    await apiAny(map[type] || [], { method: "DELETE", action: true });
    showMessage("Deleted successfully.", "success");
    await Promise.allSettled([adminStats(), adminLoadLists()]);
  } catch (err) {
    showMessage(err.data?.error || err.message || "Could not delete item.", "error");
  }
}

function bindGlobalClickHandlers() {
  if (document.dataset.sqrGlobalClicks) return;
  document.dataset.sqrGlobalClicks = "1";
  document.addEventListener("click", async (e) => {
    const removeQuestion = e.target.closest("[data-remove-question]");
    if (removeQuestion) {
      e.preventDefault();
      removeQuestion.closest(".quiz-question-row")?.remove();
      return;
    }
    const pdfBtn = e.target.closest("[data-export-pdf]");
    if (pdfBtn) {
      e.preventDefault();
      await exportResume("pdf");
      return;
    }
    const docxBtn = e.target.closest("[data-export-docx]");
    if (docxBtn) {
      e.preventDefault();
      await exportResume("docx");
      return;
    }
    const enrollBtn = e.target.closest("[data-enroll-course]");
    if (enrollBtn) {
      e.preventDefault();
      await enrollCourse(enrollBtn.dataset.enrollCourse);
      return;
    }
    const unenrollBtn = e.target.closest("[data-unenroll-course]");
    if (unenrollBtn) {
      e.preventDefault();
      await unenrollCourse(unenrollBtn.dataset.unenrollCourse);
      return;
    }
    const openCourse = e.target.closest("[data-open-course]");
    if (openCourse) {
      e.preventDefault();
      go(route("courseDetails", { id: openCourse.dataset.openCourse }));
      return;
    }
    const openSpec = e.target.closest("[data-open-specialization]");
    if (openSpec) {
      e.preventDefault();
      go(route("specializationDetails", { id: openSpec.dataset.openSpecialization }));
      return;
    }
    const toggleBan = e.target.closest("[data-toggle-ban]");
    if (toggleBan) {
      e.preventDefault();
      await adminToggleBan(toggleBan.dataset.toggleBan, toggleBan.dataset.banValue === "true");
      return;
    }
    const deleteBtn = e.target.closest("[data-admin-delete]");
    if (deleteBtn) {
      e.preventDefault();
      await adminDelete(deleteBtn.dataset.adminDelete, deleteBtn.dataset.id);
      return;
    }
    const tracking = e.target.closest("[data-track-course]");
    if (tracking) await trackCourseOpened(tracking.dataset.trackCourse, true);
    const linkTarget = e.target.closest("[data-link]");
    if (linkTarget && linkTarget.matches("button, a")) {
      e.preventDefault();
      go(linkTarget.dataset.link || linkTarget.getAttribute("href"));
      return;
    }
    const card = e.target.closest(".clickable-card[data-link]");
    if (!card) return;
    if (e.target.closest("a, button, input, select, textarea, label, video, [data-no-card-click]")) return;
    e.preventDefault();
    go(card.dataset.link);
  });
  document.addEventListener("keydown", (e) => {
    const card = e.target.closest?.(".clickable-card[data-link]");
    if (!card) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go(card.dataset.link);
    }
  });
  document.addEventListener("play", (e) => {
    const mediaEl = e.target.closest?.("[data-track-course]");
    if (mediaEl) trackCourseOpened(mediaEl.dataset.trackCourse, true);
  }, true);
}

function initFoundation() {
  document.documentElement.classList.add("sqr-ready");
  document.body.classList.add("sqr-body");
  const p = pageName().toLowerCase();
  if (p.includes("admin")) document.body.classList.add("admin-body");
  qsa(".container, main, .page").forEach((el) => el.classList.add("sqr-container"));
  qsa("button:not([type])").forEach((button) => button.type = "button");
}

function init() {
  initFoundation();
  navbar();
  bindGlobalClickHandlers();
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
  loadJobs();
  setupRecommendation();
  setupATS();
  loadAdmin();
  bindQuizForms();
}

window.SQR_API = API;
window.SQR = SQR;
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
window.loadJobs = loadJobs;
window.setupRecommendation = setupRecommendation;
window.setupATS = setupATS;
window.loadAdmin = loadAdmin;
window.enrollCourse = enrollCourse;
window.unenrollCourse = unenrollCourse;
window.trackCourseOpened = trackCourseOpened;
window.adminToggleBan = adminToggleBan;
window.adminDelete = adminDelete;

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
