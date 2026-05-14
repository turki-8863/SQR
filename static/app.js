(function () {
  "use strict";

  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
  const API = (() => {
    if (window.SQR_API_OVERRIDE) return String(window.SQR_API_OVERRIDE).replace(/\/$/, "");
    const host = window.location.hostname;
    if (LOCAL_HOSTS.has(host)) return "http://127.0.0.1:5000";
    if (host.includes("github.io") || host.includes("netlify") || host.includes("vercel")) return "https://sqr-ba83.onrender.com";
    return window.location.origin || "https://sqr-ba83.onrender.com";
  })();

  const PAGE = {
    home: "gp.html",
    admin: "admin.html",
    signin: "signin.html",
    signup: "signup.html",
    specializations: "Specialization.html",
    specializationDetails: "specialization-details.html",
    courses: "Courses.html",
    courseDetails: "course-details.html",
    quiz: "Quiz.html",
    ats: "ATS.html",
    jobs: "jobs.html",
    recommendation: "recommendation.html",
    profile: "profile.html"
  };

  const PUBLIC_PAGES = new Set(["", "gp.html", "index.html", "signin.html", "signup.html", "login.html", "register.html"]);
  const STUDENT_PAGES = new Set([
    "specialization.html", "sepecialization.html", "specialization-details.html", "courses.html", "course-details.html",
    "quiz.html", "ats.html", "jobs.html", "jobdetails.html", "job-details.html", "recommendation.html", "profile.html"
  ]);

  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function byId(id) { return document.getElementById(id); }
  function clean(value) { return String(value === undefined || value === null ? "" : value).trim(); }
  function lower(value) { return clean(value).toLowerCase(); }
  function pageName() { return window.location.pathname.split("/").pop() || "gp.html"; }
  function pageKey() { return lower(pageName()); }
  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }
  function percent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  function route(page, params) {
    const base = PAGE[page] || page || "#";
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    const qsText = query.toString();
    return qsText ? `${base}?${qsText}` : base;
  }
  function go(url) { if (url) window.location.href = url; }
  function getToken() { return localStorage.getItem("sqr_token") || localStorage.getItem("token") || ""; }
  function getUser() {
    try { return JSON.parse(localStorage.getItem("sqr_user") || localStorage.getItem("user") || "null"); }
    catch (_) { return null; }
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
  function roleOf(user) { return lower((user && user.role) || "student"); }
  function modeOf(user) { return lower((user && (user.current_mode || user.mode || user.role)) || "student"); }
  function isAdminUser() { return roleOf(getUser()) === "admin"; }
  function isAdminMode() {
    const user = getUser();
    return roleOf(user) === "admin" && modeOf(user) !== "student";
  }
  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }
  async function parseResponse(response) {
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); }
      catch (_) { data = { message: text }; }
    }
    if (!response.ok) {
      const err = new Error(data.error || data.message || `Request failed (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  async function api(path, options) {
    const config = Object.assign({ method: "GET" }, options || {});
    config.headers = authHeaders(config.headers);
    if (config.body && !(config.body instanceof FormData) && typeof config.body !== "string") {
      config.body = JSON.stringify(config.body);
    }
    if (config.body && !(config.body instanceof FormData)) {
      config.headers["Content-Type"] = config.headers["Content-Type"] || "application/json";
    }
    const response = await fetch(`${API}${path}`, config);
    if (response.status === 401) {
      clearAuth();
      if (!PUBLIC_PAGES.has(pageKey())) setTimeout(() => go(route("signin")), 400);
    }
    return parseResponse(response);
  }
  async function apiAny(paths, options) {
    let lastErr = null;
    for (const path of paths) {
      try { return await api(path, options); }
      catch (err) {
        lastErr = err;
        if (err.status && ![404, 405].includes(err.status)) throw err;
      }
    }
    throw lastErr || new Error("Request failed");
  }
  function asArray(value, keys) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    for (const key of keys || []) {
      if (Array.isArray(value[key])) return value[key];
    }
    return [];
  }
  function pick(object, keys, fallback) {
    for (const key of keys) {
      if (object && object[key] !== undefined && object[key] !== null && object[key] !== "") return object[key];
    }
    return fallback;
  }
  function itemId(item) { return pick(item, ["id", "course_id", "spec_id", "specialization_id", "job_id", "quiz_id"], ""); }
  function asset(value) {
    const v = clean(value);
    if (!v) return "";
    if (/^(https?:)?\/\//.test(v) || v.startsWith("data:") || v.startsWith("/uploads/")) return v;
    return `${API}/uploads/${encodeURIComponent(v)}`;
  }
  function messageBox() { return byId("message") || byId("msg") || byId("alert"); }
  function showMessage(message, type) {
    const box = messageBox();
    if (!box) return;
    box.className = `message ${type || "info"}`;
    box.textContent = message || "";
    if (message) setTimeout(() => { if (box.textContent === message) box.textContent = ""; }, 5000);
  }
  function requireLogin() {
    if (getToken()) return true;
    showMessage("Please sign in first.", "error");
    setTimeout(() => go(route("signin")), 500);
    return false;
  }
  function adminPageGuard() {
    const page = pageKey();
    if (PUBLIC_PAGES.has(page)) return true;
    const user = getUser();
    if (!user) return true;
    if (isAdminMode() && page !== "admin.html") {
      window.location.replace(route("admin"));
      return false;
    }
    if (page === "admin.html" && !isAdminUser()) {
      window.location.replace(route("home"));
      return false;
    }
    return true;
  }
  function blockAdminFromStudentPages() { return adminPageGuard(); }

  function navbar() {
    const user = getUser();
    const logged = Boolean(user && getToken());
    const admin = logged && isAdminMode();
    const studentLinks = [
      ["Home", route("home")],
      ["Specializations", route("specializations")],
      ["Courses", route("courses")],
      ["ATS", route("ats")],
      ["Jobs", route("jobs")],
      ["Recommendation", route("recommendation")],
      ["Profile", route("profile")]
    ];
    const links = admin ? [["Admin", route("admin")]] : studentLinks;
    const current = (location.pathname.split("/").pop() || "gp.html").toLowerCase();
    const html = `
      <nav id="sqrNavbar" class="sqr-navbar" aria-label="Main navigation">
        <a href="${admin ? route("admin") : route("home")}" class="sqr-brand" aria-label="SQR Home">
          <span>SQR</span><small>Skill Quest Road</small>
        </a>
        <button class="sqr-menu-btn" type="button" data-sqr-menu aria-label="Open menu">☰</button>
        <div class="sqr-nav-links">
          ${links.map(([label, href]) => {
            const active = href.toLowerCase().split("?")[0] === current ? " active" : "";
            return `<a class="${active}" href="${href}">${escapeHtml(label)}</a>`;
          }).join("")}
        </div>
        <div class="sqr-nav-actions">
          ${logged ? `<span class="sqr-nav-user">${escapeHtml(user.name || "User")}</span><button class="btn btn-danger" type="button" data-sqr-logout>Logout</button>` : `<a class="btn btn-soft signin-link" href="${route("signin")}">Sign In</a><a class="btn btn-primary signup-link" href="${route("signup")}">Sign Up</a>`}
        </div>
      </nav>`;
    const existing = byId("sqrNavbar");
    if (existing) existing.outerHTML = html;
    else if (document.body) document.body.insertAdjacentHTML("afterbegin", html);
    else document.write(html);
  }
  function logout() { clearAuth(); go(route("signin")); }
  function progressBar(value, label) {
    const p = percent(value);
    return `<div class="progress-block"><div class="progress-top"><span>${escapeHtml(label || "Progress")}</span><strong>${p}%</strong></div><div class="progress"><div class="progress-fill" style="width:${p}%"></div></div></div>`;
  }
  function circleStat(value, label) {
    const p = percent(value);
    return `<div class="score-circle" style="--score:${p}"><div class="score-circle-inner"><strong>${p}%</strong><span>${escapeHtml(label || "Score")}</span></div></div>`;
  }
  function defaultImage(title) {
    const text = encodeURIComponent(clean(title).slice(0, 2).toUpperCase() || "SQR");
    return `https://placehold.co/800x480/EEF2FF/4F46E5?text=${text}`;
  }
  function cardImage(item) {
    return asset(pick(item, ["image_url", "image", "thumbnail"], "")) || defaultImage(pick(item, ["title", "name"], "SQR"));
  }

  async function setupSignup() {
    const form = byId("signupForm") || byId("registerForm") || qs("form[data-signup]");
    if (!form || form.dataset.boundSignup) return;
    form.dataset.boundSignup = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const password = clean(data.get("password") || byId("password")?.value);
      const confirm = clean(data.get("confirm_password") || data.get("confirm") || byId("confirm_password")?.value);
      if (confirm && confirm !== password) return showMessage("Passwords do not match.", "error");
      try {
        const result = await api("/api/signup", {
          method: "POST",
          body: { name: clean(data.get("name") || byId("name")?.value), email: clean(data.get("email") || byId("email")?.value), password }
        });
        setAuth(result.token, result.user);
        go(route(result.user && result.user.role === "admin" ? "admin" : "home"));
      } catch (err) { showMessage(err.message, "error"); }
    });
  }
  async function setupSignin() {
    const form = byId("signinForm") || byId("loginForm") || qs("form[data-signin]");
    if (!form || form.dataset.boundSignin) return;
    form.dataset.boundSignin = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        const result = await apiAny(["/api/signin", "/api/login"], {
          method: "POST",
          body: { email: clean(data.get("email") || data.get("username") || byId("email")?.value), password: clean(data.get("password") || byId("password")?.value) }
        });
        setAuth(result.token, result.user);
        go(route(result.user && result.user.role === "admin" ? "admin" : "home"));
      } catch (err) { showMessage(err.message, "error"); }
    });
  }

  async function enrollCourse(courseId, quiet) {
    if (!courseId || !requireLogin()) return null;
    try {
      const result = await apiAny([`/api/courses/${encodeURIComponent(courseId)}/enroll`, `/api/course/${encodeURIComponent(courseId)}/enroll`], { method: "POST", body: { course_id: courseId } });
      if (!quiet) showMessage(result.message || "Enrolled successfully.", "success");
      await refreshProgressUI();
      markCourseButtons(courseId, true);
      return result;
    } catch (err) { if (!quiet) showMessage(err.message || "Could not enroll.", "error"); return null; }
  }
  async function unenrollCourse(courseId) {
    if (!courseId || !requireLogin()) return null;
    try {
      const result = await apiAny([`/api/courses/${encodeURIComponent(courseId)}/unenroll`, `/api/course/${encodeURIComponent(courseId)}/unenroll`], { method: "POST", body: { course_id: courseId } });
      showMessage(result.message || "Unenrolled successfully.", "success");
      await refreshProgressUI();
      markCourseButtons(courseId, false);
      return result;
    } catch (err) { showMessage(err.message || "Could not unenroll.", "error"); return null; }
  }
  async function enrollSpecialization(specId, quiet) {
    if (!specId || !requireLogin()) return null;
    try {
      const result = await apiAny([`/api/specializations/${encodeURIComponent(specId)}/enroll`, `/api/specialization/${encodeURIComponent(specId)}/enroll`], { method: "POST", body: { spec_id: specId } });
      if (!quiet) showMessage(result.message || "Specialization enrolled.", "success");
      await refreshProgressUI();
      return result;
    } catch (err) { if (!quiet) showMessage(err.message || "Could not enroll specialization.", "error"); return null; }
  }
  async function unenrollSpecialization(specId) {
    if (!specId || !requireLogin()) return null;
    try {
      const result = await apiAny([`/api/specializations/${encodeURIComponent(specId)}/unenroll`, `/api/specialization/${encodeURIComponent(specId)}/unenroll`], { method: "POST", body: { spec_id: specId } });
      showMessage(result.message || "Specialization unenrolled.", "success");
      await refreshProgressUI();
      return result;
    } catch (err) { showMessage(err.message || "Could not unenroll specialization.", "error"); return null; }
  }
  async function trackCourseOpened(courseId, quiet) {
    if (!courseId || !getToken()) return null;
    try {
      const result = await apiAny([`/api/courses/${encodeURIComponent(courseId)}/open`, `/api/courses/${encodeURIComponent(courseId)}/complete`, `/api/courses/${encodeURIComponent(courseId)}/enroll`], { method: "POST", body: { course_id: courseId } });
      if (!quiet) showMessage(result.message || "Course progress updated.", "success");
      await refreshProgressUI();
      markCourseButtons(courseId, true);
      return result;
    } catch (err) { if (!quiet && ![401, 403].includes(err.status)) showMessage(err.message || "Progress could not update.", "error"); return null; }
  }
  function markCourseButtons(courseId, enrolled) {
    const safe = window.CSS && CSS.escape ? CSS.escape(String(courseId)) : String(courseId).replace(/"/g, "");
    qsa(`[data-enroll-course="${safe}"], [data-course-id="${safe}"]`).forEach((el) => {
      if (el.matches("button, a")) {
        el.dataset.enrolled = enrolled ? "1" : "0";
        if (el.dataset.enrollCourse) {
          el.textContent = enrolled ? "Enrolled" : "Enroll";
          el.disabled = Boolean(enrolled && el.tagName === "BUTTON");
        }
      }
    });
  }

  async function getProgressBundle() {
    const bundle = { profile: null, progress: [], enrolled: [] };
    try { bundle.profile = await api("/api/profile", { method: "GET" }); } catch (_) {}
    try { bundle.progress = asArray(await api("/api/progress", { method: "GET" }), ["progress", "items", "specialization_progress"]); } catch (_) {}
    try { bundle.enrolled = asArray(await api("/api/courses/enrolled", { method: "GET" }), ["courses", "course_progress", "enrolled"]); } catch (_) {}
    return bundle;
  }
  async function refreshProgressUI() {
    if (!getToken() || isAdminMode()) return;
    const shouldRender = pageKey() === "profile.html" || byId("progressBox") || byId("courseProgressBox") || byId("profileBox");
    if (!shouldRender) return;
    const box = byId("progressBox") || byId("progressContainer") || byId("courseProgressBox");
    const profileBox = byId("profileBox");
    const bundle = await getProgressBundle();
    const profile = bundle.profile || {};
    const user = profile.user || profile.profile || getUser() || {};
    const specProgress = asArray(profile.specialization_progress || profile.progress || bundle.progress, ["specialization_progress", "progress"]);
    const courseProgress = asArray(profile.course_progress || bundle.enrolled, ["course_progress", "courses", "enrolled"]);
    if (profileBox && user && Object.keys(user).length) {
      profileBox.innerHTML = `<section class="profile-hero-card"><div><span class="eyebrow">Student Dashboard</span><h1>${escapeHtml(user.name || "Student")}</h1><p>${escapeHtml(user.email || "")}</p></div><div class="profile-mini-stats"><article><strong>${specProgress.length}</strong><span>Specializations</span></article><article><strong>${courseProgress.length}</strong><span>Opened courses</span></article></div></section>`;
    }
    if (!box) return;
    const specCards = specProgress.map((item) => {
      const name = pick(item, ["specialization_name", "name", "title"], "Specialization");
      const value = pick(item, ["progress", "percentage", "completed_percent"], 0);
      const total = pick(item, ["total_courses"], "");
      const opened = pick(item, ["opened_courses"], "");
      const completed = pick(item, ["completed_courses"], "");
      return `<article class="progress-card"><div class="progress-card-head"><h3>${escapeHtml(name)}</h3><span class="status-pill">${escapeHtml(pick(item, ["status"], value >= 100 ? "completed" : value > 0 ? "in_progress" : "not_started"))}</span></div>${progressBar(value, "Specialization progress")}<p class="progress-meta">${total !== "" ? `${escapeHtml(opened)} opened / ${escapeHtml(total)} courses` : "Open courses and submit quizzes to increase progress."}</p>${completed !== "" ? `<p class="progress-meta">${escapeHtml(completed)} completed courses</p>` : ""}</article>`;
    }).join("");
    const courseCards = courseProgress.map((item) => {
      const name = pick(item, ["title", "course_title", "name"], "Course");
      const value = pick(item, ["progress", "percentage", "completed_percent"], 0);
      const courseId = pick(item, ["course_id", "id"], "");
      return `<article class="progress-card course-progress-card"><div class="progress-card-head"><h3>${escapeHtml(name)}</h3><span class="done-icon ${value >= 100 ? "done" : ""}">${value >= 100 ? "✓" : ""}</span></div>${progressBar(value, "Course progress")}<div class="card-actions">${courseId ? `<a class="btn btn-soft" href="course-details.html?id=${escapeAttr(courseId)}">View course</a>` : ""}${courseId ? `<button type="button" class="btn btn-danger" data-unenroll-course="${escapeAttr(courseId)}">Unenroll</button>` : ""}</div></article>`;
    }).join("");
    box.innerHTML = `<section class="progress-dashboard"><div class="section-heading"><h2>Your progress</h2><p>Progress updates when you open a course, watch its video or link, and pass its quizzes.</p></div><div class="progress-grid">${specCards || `<div class="empty-state">No specialization progress yet.</div>`}</div><div class="section-heading section-heading-small"><h2>Opened courses</h2></div><div class="progress-grid">${courseCards || `<div class="empty-state">No opened courses yet.</div>`}</div></section>`;
  }
  async function loadProfile() {
    if (pageKey() !== "profile.html" && !byId("profileBox") && !byId("profileForm")) return;
    if (!requireLogin()) return;
    await refreshProgressUI();
    const form = byId("profileForm");
    if (form && !form.dataset.boundProfile) {
      form.dataset.boundProfile = "1";
      try {
        const data = await api("/api/profile");
        const user = data.user || {};
        ["name", "skills", "interests", "goal"].forEach((id) => { if (byId(id)) byId(id).value = user[id] || ""; });
      } catch (_) {}
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        try {
          const result = await api("/api/profile", { method: "PUT", body: { name: clean(data.get("name") || byId("name")?.value), skills: clean(data.get("skills") || byId("skills")?.value), interests: clean(data.get("interests") || byId("interests")?.value), goal: clean(data.get("goal") || byId("goal")?.value) } });
          setAuth(getToken(), result.user);
          showMessage("Profile updated.", "success");
          await refreshProgressUI();
        } catch (err) { showMessage(err.message, "error"); }
      });
    }
  }

  function hideMarkCompletedButtons() {
    qsa("button, a").forEach((el) => { if (/mark\s+as\s+completed|mark\s+completed/i.test(clean(el.textContent))) el.remove(); });
  }

  async function loadSpecializations() {
    const box = byId("specializationsBox") || byId("specializationBox") || byId("specializationsGrid") || byId("specializationsList") || byId("specializationList") || byId("specializations");
    if (!box || box.dataset.loadedSpecializations) return;
    box.dataset.loadedSpecializations = "1";
    box.innerHTML = `<div class="loading-card">Loading specializations...</div>`;
    try {
      const data = await api("/api/specializations");
      const items = asArray(data, ["specializations", "items"]);
      box.innerHTML = `<div class="card-grid specialization-grid">${items.map((item) => {
        const id = itemId(item);
        return `<article class="feature-card interactive-card" data-open-url="${route("specializationDetails", { id })}"><img src="${escapeAttr(cardImage(item))}" alt=""><div class="card-body"><span class="eyebrow">${escapeHtml(item.course_count || 0)} courses</span><h3>${escapeHtml(item.name || item.title || "Specialization")}</h3><p>${escapeHtml(item.description || "Explore this specialization and its courses.")}</p>${progressBar(item.progress || 0, "Progress")}<div class="card-actions"><button type="button" class="btn btn-primary" data-enroll-specialization="${escapeAttr(id)}">Enroll</button><a class="btn btn-soft" href="${route("specializationDetails", { id })}">View details</a></div></div></article>`;
      }).join("") || `<div class="empty-state">No specializations yet.</div>`}</div>`;
    } catch (err) { box.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; }
  }
  async function loadSpecializationDetails() {
    const id = new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("spec_id") || new URLSearchParams(location.search).get("specialization_id");
    const box = byId("specializationDetails") || byId("specializationDetailsBox") || byId("specializationDetail") || byId("specializationBox");
    if (!id || !box || box.dataset.loadedSpecDetails) return;
    box.dataset.loadedSpecDetails = "1";
    box.innerHTML = `<div class="loading-card">Loading specialization...</div>`;
    try {
      const data = await apiAny([`/api/specializations/${id}`, `/api/specialization/${id}`]);
      const spec = data.specialization || data.item || data;
      const courses = asArray(data.courses, ["courses"]);
      const certs = asArray(data.certificates, ["certificates"]);
      box.innerHTML = `<section class="detail-hero"><img src="${escapeAttr(cardImage(spec))}" alt=""><div><span class="eyebrow">Specialization</span><h1>${escapeHtml(spec.name || "Specialization")}</h1><p>${escapeHtml(spec.description || "")}</p><div class="card-actions"><button class="btn btn-primary" data-enroll-specialization="${escapeAttr(id)}">Enroll</button><button class="btn btn-danger" data-unenroll-specialization="${escapeAttr(id)}">Unenroll</button></div></div></section><section class="section-heading"><h2>Courses</h2></section><div class="card-grid">${courses.map(courseCard).join("") || `<div class="empty-state">No courses yet.</div>`}</div><section class="section-heading"><h2>Certificates</h2></section><div class="card-grid">${certs.map((c) => `<article class="feature-card"><div class="card-body"><h3>${escapeHtml(c.name || c.title)}</h3><p>${escapeHtml(c.description || "")}</p>${c.link ? `<a class="btn btn-soft" href="${escapeAttr(c.link)}" target="_blank">Open certificate</a>` : ""}</div></article>`).join("") || `<div class="empty-state">No certificates yet.</div>`}</div>`;
    } catch (err) { box.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; }
  }
  function courseCard(course) {
    const id = itemId(course);
    const value = pick(course, ["progress"], 0);
    return `<article class="feature-card course-card interactive-card" data-open-url="${route("courseDetails", { id })}"><img src="${escapeAttr(cardImage(course))}" alt=""><div class="card-body"><div class="card-title-row"><h3>${escapeHtml(course.title || course.name || "Course")}</h3><span class="done-icon ${value >= 100 ? "done" : ""}">${value >= 100 ? "✓" : ""}</span></div><p>${escapeHtml(course.description || "")}</p><span class="level-pill ${escapeAttr((course.level_badge && course.level_badge.class) || `level-${course.level || "beginner"}`)}">${escapeHtml(course.level || "beginner")}</span>${progressBar(value, "Course progress")}<div class="card-actions"><button class="btn btn-primary" data-enroll-course="${escapeAttr(id)}">${value > 0 ? "Enrolled" : "Enroll"}</button><a class="btn btn-soft" data-track-course="${escapeAttr(id)}" href="${route("courseDetails", { id })}">View details</a></div></div></article>`;
  }
  async function loadCourses() {
    const box = byId("coursesBox") || byId("coursesGrid") || byId("coursesList") || byId("courses");
    if (!box || box.dataset.loadedCourses) return;
    box.dataset.loadedCourses = "1";
    const params = new URLSearchParams(location.search);
    const specId = params.get("spec_id") || params.get("specialization_id");
    box.innerHTML = `<div class="loading-card">Loading courses...</div>`;
    try {
      const data = await api(`/api/courses${specId ? `?spec_id=${encodeURIComponent(specId)}` : ""}`);
      const items = asArray(data, ["courses", "items"]);
      box.innerHTML = `<div class="card-grid courses-grid">${items.map(courseCard).join("") || `<div class="empty-state">No courses yet.</div>`}</div>`;
      hideMarkCompletedButtons();
    } catch (err) { box.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; }
  }
  async function loadCourseDetails() {
    const id = new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("course_id");
    const box = byId("courseDetails") || byId("courseDetailsBox") || byId("courseDetail") || byId("courseBox");
    if (!id || !box || box.dataset.loadedCourseDetails) return;
    box.dataset.loadedCourseDetails = "1";
    if (getToken() && !isAdminMode()) await trackCourseOpened(id, true);
    box.innerHTML = `<div class="loading-card">Loading course...</div>`;
    try {
      const data = await apiAny([`/api/courses/${id}`, `/api/course/${id}`]);
      const course = data.course || data.item || data;
      const quizzes = asArray(data.quizzes, ["quizzes"]);
      box.innerHTML = `<section class="detail-hero"><img src="${escapeAttr(cardImage(course))}" alt=""><div><span class="eyebrow">${escapeHtml(course.specialization_name || "Course")}</span><h1>${escapeHtml(course.title || "Course")}</h1><p>${escapeHtml(course.description || "")}</p>${progressBar(course.progress || 50, "Course progress")}<div class="card-actions"><button class="btn btn-danger" data-unenroll-course="${escapeAttr(id)}">Unenroll</button>${course.link ? `<a class="btn btn-primary" data-track-course="${escapeAttr(id)}" href="${escapeAttr(course.link)}" target="_blank">Open course link</a>` : ""}</div></div></section>${course.video_url || course.video ? `<section class="video-card"><video controls data-track-course="${escapeAttr(id)}" src="${escapeAttr(asset(course.video_url || course.video))}"></video></section>` : ""}<section class="section-heading"><h2>Quizzes</h2><p>Pass quizzes to complete the second half of course progress.</p></section><div class="card-grid">${quizzes.map((q) => quizCard(q)).join("") || `<div class="empty-state">No quizzes yet.</div>`}</div>`;
      bindTrackingToMedia();
    } catch (err) { box.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; }
  }
  function quizCard(quiz) {
    const id = itemId(quiz);
    return `<article class="feature-card"><div class="card-body"><h3>${escapeHtml(quiz.title || "Quiz")}</h3><p>${escapeHtml(quiz.description || "")}</p><a class="btn btn-primary" href="${route("quiz", { id })}">Start quiz</a></div></article>`;
  }
  async function loadQuizzes() {
    const id = new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("quiz_id");
    const box = byId("quizBox") || byId("quizDetails") || byId("quizContainer") || byId("quizzesBox");
    if (!box || box.dataset.loadedQuiz) return;
    box.dataset.loadedQuiz = "1";
    if (id) {
      try {
        const data = await api(`/api/quizzes/${id}`);
        const quiz = data.quiz || {};
        const questions = asArray(data.questions, ["questions"]);
        box.innerHTML = `<form id="quizSubmitForm" class="quiz-form"><h1>${escapeHtml(quiz.title || "Quiz")}</h1>${questions.map((q, i) => `<fieldset class="quiz-question"><legend>${i + 1}. ${escapeHtml(q.question || q.question_text)}</legend>${(q.options || [q.option1, q.option2, q.option3, q.option4]).filter(Boolean).map((opt, idx) => `<label><input type="radio" name="q_${q.id}" value="${escapeAttr(opt)}" required> ${escapeHtml(opt)}</label>`).join("")}</fieldset>`).join("")}<button class="btn btn-primary" type="submit">Submit quiz</button></form><div id="quizResult"></div>`;
        setupQuizSubmit(id, questions);
      } catch (err) { box.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; }
    } else {
      const data = await api("/api/quizzes");
      const quizzes = asArray(data, ["quizzes", "items"]);
      box.innerHTML = `<div class="card-grid">${quizzes.map(quizCard).join("") || `<div class="empty-state">No quizzes yet.</div>`}</div>`;
    }
  }
  function setupQuizSubmit(quizId, questions) {
    const form = byId("quizSubmitForm") || byId("quizForm");
    if (!form || form.dataset.boundQuiz) return;
    form.dataset.boundQuiz = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const answers = {};
      (questions || []).forEach((q) => {
        const picked = qs(`input[name="q_${q.id}"]:checked`, form);
        if (picked) answers[String(q.id)] = picked.value;
      });
      try {
        const result = await api(`/api/quizzes/${quizId}/submit`, { method: "POST", body: { answers } });
        const box = byId("quizResult") || byId("result");
        if (box) box.innerHTML = `<div class="result-panel">${circleStat(result.score || result.percentage, "Quiz score")}<h2>${result.passed ? "Passed" : "Try again"}</h2><p>${escapeHtml(result.correct)} correct out of ${escapeHtml(result.total)}.</p>${result.course_progress !== undefined ? progressBar(result.course_progress, "Course progress") : ""}</div>`;
        await refreshProgressUI();
      } catch (err) { showMessage(err.message, "error"); }
    });
  }
  function bindTrackingToMedia() {
    qsa("video[data-track-course]").forEach((video) => {
      if (video.dataset.sqrTrackBound) return;
      video.dataset.sqrTrackBound = "1";
      video.addEventListener("play", () => trackCourseOpened(video.dataset.trackCourse, true), { once: true });
      video.addEventListener("ended", () => trackCourseOpened(video.dataset.trackCourse, true));
    });
    const id = new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("course_id");
    if (id && pageKey() === "course-details.html") {
      qsa("video, a[href]").forEach((el) => { if (!el.dataset.trackCourse && !el.closest(".sqr-navbar")) el.dataset.trackCourse = id; });
    }
  }

  async function loadJobs() {
    const box = byId("jobsBox") || byId("jobsGrid") || byId("jobsList") || byId("jobs");
    if (!box || box.dataset.loadedJobs) return;
    box.dataset.loadedJobs = "1";
    box.innerHTML = `<div class="loading-card">Loading jobs...</div>`;
    try {
      const data = await api("/api/jobs");
      const jobs = asArray(data, ["jobs", "items"]);
      box.innerHTML = `<div class="card-grid jobs-grid">${jobs.map((job) => `<article class="feature-card"><div class="card-body"><span class="eyebrow">${escapeHtml(job.specialization || "Career")}</span><h3>${escapeHtml(job.title || "Job")}</h3><p>${escapeHtml(job.description || "")}</p><p class="small-muted">${escapeHtml(job.skills || job.required_skills || "")}</p><div class="card-actions">${job.link ? `<a class="btn btn-primary" href="${escapeAttr(job.link)}" target="_blank">Open job</a>` : ""}</div></div></article>`).join("") || `<div class="empty-state">No jobs yet.</div>`}</div>`;
    } catch (err) { box.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; }
  }

  function recommendationDefaultQuestions() {
    return [
      { label: "I enjoy solving difficult technical problems.", area: "software" },
      { label: "I like protecting systems and finding vulnerabilities.", area: "cybersecurity" },
      { label: "I enjoy working with data, charts, and predictions.", area: "data" },
      { label: "I care about user experience and clean interfaces.", area: "frontend" },
      { label: "I want to work with servers, deployment, and cloud platforms.", area: "cloud" },
      { label: "I am interested in AI, machine learning, and automation.", area: "ai" }
    ];
  }
  function setupRecommendation() { return setupRecommendationPage(); }
  function setupRecommendationPage() {
    const form = byId("recForm") || byId("recommendationForm");
    if (!form || form.dataset.sqrRecBound) return;
    form.dataset.sqrRecBound = "1";
    let quizBox = byId("recQuizBox");
    if (!quizBox) {
      quizBox = document.createElement("div");
      quizBox.id = "recQuizBox";
      quizBox.className = "rec-question-grid";
      const before = qs(".rec-submit", form) || qs("button[type='submit']", form);
      if (before) before.insertAdjacentElement("beforebegin", quizBox);
    }
    if (!quizBox.children.length) {
      quizBox.innerHTML = recommendationDefaultQuestions().map((q, i) => `<label class="rec-check-card"><input type="checkbox" name="rec_question_${i}" value="${escapeAttr(q.area)}"><span>${escapeHtml(q.label)}</span></label>`).join("");
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const resultBox = byId("recommendationResult") || byId("recResult") || byId("result");
      const btn = qs("button[type='submit']", form);
      const data = new FormData(form);
      const answers = qsa("input[type='checkbox']:checked", quizBox).map((input) => input.value);
      const payload = {
        interests: clean(data.get("interests") || data.get("interest") || byId("interests")?.value),
        skills: clean(data.get("skills") || byId("skills")?.value),
        goal: clean(data.get("goal") || byId("goal")?.value),
        work_style: clean(data.get("work_style") || data.get("workStyle") || byId("work_style")?.value),
        answers
      };
      if (!payload.interests && !payload.skills && !payload.goal && !payload.work_style && !payload.answers.length) {
        if (resultBox) resultBox.innerHTML = `<div class="empty-state">Write your interests or answer the quick questions first.</div>`;
        return;
      }
      if (resultBox) resultBox.innerHTML = `<div class="loading-card">Building your recommendation...</div>`;
      if (btn) btn.disabled = true;
      try {
        const result = await apiAny(["/api/recommendation", "/api/recommendations", "/api/specialization/recommendation"], { method: "POST", body: payload });
        renderRecommendation(result, resultBox);
      } catch (err) {
        if (resultBox) resultBox.innerHTML = `<div class="error-card">${escapeHtml(err.message || "Recommendation failed")}</div>`;
      } finally { if (btn) btn.disabled = false; }
    });
  }
  function renderRecommendation(data, resultBox) {
    if (!resultBox) return;
    const spec = data.specialization || data.recommended_specialization || data.best_specialization || data.result || data;
    const specName = pick(spec, ["name", "title", "specialization", "recommended_specialization"], pick(data, ["specialization_name", "name", "title", "recommended_specialization"], "Recommended specialization"));
    const reason = pick(data, ["reason", "explanation"], pick(spec, ["reason", "explanation", "description"], "This specialization matches your answers, interests, and skills."));
    const score = pick(data, ["match_percentage", "score", "percentage"], pick(spec, ["match_percentage", "match", "score", "percentage"], 80));
    const courses = asArray(data.courses || spec.courses, ["courses", "recommended_courses"]);
    const jobs = asArray(data.jobs || spec.jobs, ["jobs", "recommended_jobs"]);
    resultBox.innerHTML = `<div class="rec-result-grid"><section class="rec-result-main"><span class="eyebrow">Best match</span><h2>${escapeHtml(specName)}</h2><p>${escapeHtml(reason)}</p><div class="rec-actions">${pick(spec, ["id", "spec_id", "specialization_id"], "") ? `<button type="button" class="btn btn-primary" data-enroll-specialization="${escapeAttr(pick(spec, ["id", "spec_id", "specialization_id"], ""))}">Enroll specialization</button>` : ""}<a class="btn btn-soft" href="${route("courses")}">Browse courses</a></div></section><aside class="rec-score-card">${circleStat(score, "Match")}</aside><section class="rec-mini-card"><h3>Recommended courses</h3>${courses.length ? `<ul>${courses.map((c) => `<li>${escapeHtml(pick(c, ["title", "name"], c))}</li>`).join("")}</ul>` : `<p>No course suggestions yet.</p>`}</section><section class="rec-mini-card"><h3>Related jobs</h3>${jobs.length ? `<ul>${jobs.map((j) => `<li>${escapeHtml(pick(j, ["title", "name"], j))}</li>`).join("")}</ul>` : `<p>No job suggestions yet.</p>`}</section></div>`;
  }

  function setupATS() {
    setupATSChecker();
    setupATSGenerator();
  }
  function setupATSChecker() {
    const form = byId("atsCheckForm") || byId("atsCheckerForm");
    if (!form || form.dataset.boundAtsCheck) return;
    form.dataset.boundAtsCheck = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const data = new FormData(form);
      const file = data.get("resume") || data.get("file") || data.get("resume_file");
      if (!file || !file.name) return showMessage("Upload a PDF or DOCX resume first.", "error");
      const ext = file.name.split(".").pop().toLowerCase();
      if (!["pdf", "docx", "txt"].includes(ext)) return showMessage("ATS checker only accepts PDF, DOCX, or TXT.", "error");
      const box = byId("atsResult") || byId("atsCheckResult") || byId("result");
      if (box) box.innerHTML = `<div class="loading-card">Checking resume...</div>`;
      try {
        const result = await api("/api/ats/check", { method: "POST", body: data });
        if (box) renderATSResult(result, box);
      } catch (err) { if (box) box.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; else showMessage(err.message, "error"); }
    });
  }
  function renderATSResult(result, box) {
    const score = result.ats_score || result.score || 0;
    const matched = result.matched_keywords || [];
    const missing = result.missing_keywords || [];
    const improvements = result.improvements || [];
    box.innerHTML = `<div class="ats-result-grid"><section class="ats-score-card">${circleStat(score, "ATS score")}</section><section class="rec-mini-card"><h3>Matched keywords</h3><p>${matched.map(escapeHtml).join(", ") || "No matched keywords yet."}</p></section><section class="rec-mini-card"><h3>Missing keywords</h3><p>${missing.map(escapeHtml).join(", ") || "No missing keywords detected."}</p></section><section class="rec-mini-card wide"><h3>Improvements</h3><ul>${improvements.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></section></div>`;
  }
  function setupATSGenerator() {
    const form = byId("atsGenerateForm") || byId("atsGeneratorForm");
    if (!form || form.dataset.boundAtsGen) return;
    form.dataset.boundAtsGen = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const payload = Object.fromEntries(new FormData(form).entries());
      const box = byId("atsGenerateResult") || byId("generatedResume") || byId("generatorResult");
      if (box) box.innerHTML = `<div class="loading-card">Generating ATS resume...</div>`;
      try {
        const result = await api("/api/ats/generate", { method: "POST", body: payload });
        const resume = result.generated_resume || result.resume || "";
        window.__lastGeneratedResume = resume;
        if (box) box.innerHTML = `<div class="generated-resume-card"><div class="card-actions"><button class="btn btn-soft" type="button" data-export-resume="pdf">Export PDF</button><button class="btn btn-soft" type="button" data-export-resume="docx">Export DOCX</button></div><pre>${escapeHtml(resume)}</pre></div>`;
      } catch (err) { if (box) box.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; else showMessage(err.message, "error"); }
    });
  }
  async function exportResume(format) {
    const resume = window.__lastGeneratedResume || clean((byId("generatedResume") || byId("atsGenerateResult"))?.innerText);
    if (!resume) return showMessage("Generate a resume first.", "error");
    try {
      const response = await fetch(`${API}/api/ats/export/${format}`, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()), body: JSON.stringify({ resume }) });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sqr_ats_resume.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) { showMessage(err.message, "error"); }
  }

  async function loadAdmin() {
    if (pageKey() !== "admin.html" && !byId("adminBox") && !byId("adminStats")) return;
    if (!requireLogin()) return;
    if (!isAdminUser()) return go(route("home"));
    const statsBox = byId("adminStats") || byId("adminStatsBox");
    const usersBox = byId("adminUsers") || byId("usersBox");
    try {
      const stats = await api("/api/admin/stats");
      const values = stats.stats || stats;
      if (statsBox) statsBox.innerHTML = `<div class="admin-stat-grid">${Object.entries(values).map(([k, v]) => `<article><strong>${escapeHtml(v)}</strong><span>${escapeHtml(k.replace(/_/g, " "))}</span></article>`).join("")}</div>`;
    } catch (err) { if (statsBox) statsBox.innerHTML = `<div class="error-card">${escapeHtml(err.message)}</div>`; }
    try {
      const users = asArray(await api("/api/admin/users"), ["users"]);
      if (usersBox) usersBox.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>${users.map((u) => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.role)}</td><td>${u.banned ? "Banned" : "Active"}</td><td>${u.banned ? `<button class="btn btn-soft" data-admin-unban="${escapeAttr(u.id)}">Unban</button>` : `<button class="btn btn-danger" data-admin-ban="${escapeAttr(u.id)}">Ban</button>`}</td></tr>`).join("")}</tbody></table></div>`;
    } catch (_) {}
    bindAdminForms();
  }
  function formBody(form) {
    const hasFile = qsa("input[type='file']", form).some((input) => input.files && input.files.length);
    if (hasFile) return new FormData(form);
    return Object.fromEntries(new FormData(form).entries());
  }
  function bindAdminForms() {
    const bindings = [
      ["adminSpecializationForm", "/api/admin/specializations", "Specialization saved"],
      ["adminCourseForm", "/api/admin/courses", "Course saved"],
      ["adminJobForm", "/api/admin/jobs", "Job saved"],
      ["adminCertificateForm", "/api/admin/certificates", "Certificate saved"],
      ["adminQuizForm", "/api/admin/quizzes", "Quiz saved"]
    ];
    bindings.forEach(([id, path, msg]) => {
      const form = byId(id);
      if (!form || form.dataset.boundAdmin) return;
      form.dataset.boundAdmin = "1";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try { await api(path, { method: "POST", body: formBody(form) }); showMessage(msg, "success"); form.reset(); await loadAdmin(); }
        catch (err) { showMessage(err.message, "error"); }
      });
    });
  }

  function patchCourseCards() {
    hideMarkCompletedButtons();
    qsa("[onclick*='course-details'], [data-link*='course-details'], a[href*='course-details']").forEach((el) => {
      const raw = el.getAttribute("onclick") || el.dataset.link || el.getAttribute("href") || "";
      const idMatch = raw.match(/[?&]id=([0-9]+)/) || raw.match(/course_id=([0-9]+)/) || raw.match(/\((\d+)\)/);
      if (!idMatch) return;
      const id = idMatch[1];
      if (el.matches("a")) el.dataset.trackCourse = id;
    });
  }
  function bindGlobalClicks() {
    if (document.dataset.sqrGlobalClicks) return;
    document.dataset.sqrGlobalClicks = "1";
    document.addEventListener("click", async (event) => {
      const menu = event.target.closest("[data-sqr-menu]");
      if (menu) { byId("sqrNavbar")?.classList.toggle("open"); return; }
      const logoutBtn = event.target.closest("[data-sqr-logout]");
      if (logoutBtn) { event.preventDefault(); logout(); return; }
      const openCard = event.target.closest("[data-open-url]");
      if (openCard && !event.target.closest("a, button, input, select, textarea")) { go(openCard.dataset.openUrl); return; }
      const enrollCourseBtn = event.target.closest("[data-enroll-course]");
      if (enrollCourseBtn) { event.preventDefault(); event.stopPropagation(); await enrollCourse(enrollCourseBtn.dataset.enrollCourse, false); return; }
      const unenrollCourseBtn = event.target.closest("[data-unenroll-course]");
      if (unenrollCourseBtn) { event.preventDefault(); event.stopPropagation(); await unenrollCourse(unenrollCourseBtn.dataset.unenrollCourse); return; }
      const enrollSpecBtn = event.target.closest("[data-enroll-specialization]");
      if (enrollSpecBtn) { event.preventDefault(); event.stopPropagation(); await enrollSpecialization(enrollSpecBtn.dataset.enrollSpecialization, false); return; }
      const unenrollSpecBtn = event.target.closest("[data-unenroll-specialization]");
      if (unenrollSpecBtn) { event.preventDefault(); event.stopPropagation(); await unenrollSpecialization(unenrollSpecBtn.dataset.unenrollSpecialization); return; }
      const tracked = event.target.closest("[data-track-course]");
      if (tracked && tracked.dataset.trackCourse) await trackCourseOpened(tracked.dataset.trackCourse, true);
      const exportBtn = event.target.closest("[data-export-resume]");
      if (exportBtn) { event.preventDefault(); await exportResume(exportBtn.dataset.exportResume); return; }
      const ban = event.target.closest("[data-admin-ban]");
      if (ban) { event.preventDefault(); await api(`/api/admin/users/${ban.dataset.adminBan}/ban`, { method: "POST" }); showMessage("User banned.", "success"); location.reload(); return; }
      const unban = event.target.closest("[data-admin-unban]");
      if (unban) { event.preventDefault(); await api(`/api/admin/users/${unban.dataset.adminUnban}/unban`, { method: "POST" }); showMessage("User unbanned.", "success"); location.reload(); return; }
    });
  }
  function boot() {
    navbar();
    adminPageGuard();
    bindGlobalClicks();
    setupSignup();
    setupSignin();
    setupRecommendationPage();
    setupATS();
    loadProfile();
    loadSpecializations();
    loadSpecializationDetails();
    loadCourses();
    loadCourseDetails();
    loadQuizzes();
    loadJobs();
    loadAdmin();
    refreshProgressUI();
    setTimeout(() => { hideMarkCompletedButtons(); patchCourseCards(); bindTrackingToMedia(); setupRecommendationPage(); }, 600);
    setTimeout(() => { hideMarkCompletedButtons(); patchCourseCards(); bindTrackingToMedia(); }, 1500);
  }

  window.API = API;
  window.getToken = getToken;
  window.getUser = getUser;
  window.setAuth = setAuth;
  window.authHeaders = authHeaders;
  window.logout = logout;
  window.requireLogin = requireLogin;
  window.navbar = navbar;
  window.adminPageGuard = adminPageGuard;
  window.blockAdminFromStudentPages = blockAdminFromStudentPages;
  window.setupSignup = setupSignup;
  window.setupSignin = setupSignin;
  window.loadProfile = loadProfile;
  window.loadSpecializations = loadSpecializations;
  window.loadSpecializationDetails = loadSpecializationDetails;
  window.loadCourses = loadCourses;
  window.loadCourseDetails = loadCourseDetails;
  window.loadJobs = loadJobs;
  window.loadQuizzes = loadQuizzes;
  window.setupQuizSubmit = setupQuizSubmit;
  window.setupRecommendation = setupRecommendation;
  window.setupRecommendationPage = setupRecommendationPage;
  window.setupATS = setupATS;
  window.loadAdmin = loadAdmin;
  window.trackCourseOpened = trackCourseOpened;
  window.enrollCourse = enrollCourse;
  window.unenrollCourse = unenrollCourse;
  window.enrollSpecialization = enrollSpecialization;
  window.unenrollSpecialization = unenrollSpecialization;
  window.loadProgress = refreshProgressUI;
  window.loadProgressUI = refreshProgressUI;
  window.SQR = { API, api, apiAny, route, refreshProgressUI, trackCourseOpened };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();


(function(){
  "use strict";
  const root = window.SQR || (window.SQR = {});
  const page = (location.pathname.split("/").pop() || "gp.html").toLowerCase();
  const publicPages = new Set(["", "gp.html", "index.html", "signin.html", "signup.html"]);
  function safeJson(value, fallback){ try { return JSON.parse(value); } catch(_) { return fallback; } }
  function sqrToken(){ return localStorage.getItem("sqr_token") || localStorage.getItem("token") || ""; }
  function sqrUser(){ return safeJson(localStorage.getItem("sqr_user") || localStorage.getItem("user") || "null", null); }
  function sqrRole(){ const user = sqrUser(); return String(user && user.role || "student").toLowerCase(); }
  function sqrMode(){ const user = sqrUser(); return String(user && (user.current_mode || user.mode || user.role) || "student").toLowerCase(); }
  function isAdminModeStrict(){ return sqrRole() === "admin" && sqrMode() !== "student"; }
  function redirectAdminsStrictly(){
    if (!sqrToken()) return;
    if (isAdminModeStrict() && page !== "admin.html") location.replace("admin.html");
    if (page === "admin.html" && sqrRole() !== "admin") location.replace("gp.html");
  }
  function removeDangerousCompletedButtons(){
    document.querySelectorAll("button,a").forEach(function(el){
      if (/mark\s+as\s+completed|mark\s+completed/i.test(String(el.textContent || ""))) el.remove();
    });
  }
  function enhanceRequiredLabels(){
    document.querySelectorAll("input[required], textarea[required], select[required]").forEach(function(el){
      const id = el.id;
      if (!id) return;
      const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (label && !label.querySelector(".required-star")) label.insertAdjacentHTML("beforeend", ' <span class="required-star">*</span>');
    });
  }
  function bindAutoCourseOpenTracking(){
    document.querySelectorAll('a[href*="course-details.html"], [data-track-course], video[data-track-course]').forEach(function(el){
      if (el.dataset.sqrAutoTrackBound) return;
      el.dataset.sqrAutoTrackBound = "1";
      const id = el.dataset.trackCourse || new URL(el.href || location.href, location.href).searchParams.get("id") || new URL(el.href || location.href, location.href).searchParams.get("course_id");
      if (!id) return;
      if (el.tagName === "VIDEO") {
        el.addEventListener("play", function(){ if (window.trackCourseOpened) window.trackCourseOpened(id, true); }, { once:true });
        el.addEventListener("ended", function(){ if (window.trackCourseOpened) window.trackCourseOpened(id, true); });
      } else {
        el.dataset.trackCourse = id;
        el.addEventListener("click", function(){ if (window.trackCourseOpened) window.trackCourseOpened(id, true); });
      }
    });
  }
  function makeCardsClickable(){
    document.querySelectorAll(".feature-card[data-open-url], .interactive-card[data-open-url]").forEach(function(card){
      if (card.dataset.sqrClickableBound) return;
      card.dataset.sqrClickableBound = "1";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.addEventListener("keydown", function(event){
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          location.href = card.dataset.openUrl;
        }
      });
    });
  }
  function polishRecommendationPage(){
    if (page !== "recommendation.html") return;
    document.body.classList.add("recommendation-polished");
    const form = document.getElementById("recForm") || document.getElementById("recommendationForm");
    if (form) form.classList.add("rec-card", "rec-form-polished");
    const result = document.getElementById("recommendationResult") || document.getElementById("recResult");
    if (result && !result.innerHTML.trim()) result.innerHTML = '<div class="rec-empty"><div class="rec-empty-icon">⌁</div><h3>No result yet</h3><p>Complete the form to get a specialization and job recommendation.</p></div>';
  }
  function polishAdminPage(){
    if (page !== "admin.html") return;
    document.body.classList.add("admin-polished");
    document.querySelectorAll("form").forEach(function(form){ form.classList.add("admin-form-card"); });
  }
  function fixDuplicateNavbar(){
    const navs = Array.from(document.querySelectorAll(".sqr-navbar, .navbar"));
    if (navs.length <= 1) return;
    navs.slice(1).forEach(function(nav){ nav.remove(); });
  }
  function bootEnhancements(){
    redirectAdminsStrictly();
    removeDangerousCompletedButtons();
    enhanceRequiredLabels();
    bindAutoCourseOpenTracking();
    makeCardsClickable();
    polishRecommendationPage();
    polishAdminPage();
    fixDuplicateNavbar();
    setTimeout(removeDangerousCompletedButtons, 500);
    setTimeout(bindAutoCourseOpenTracking, 800);
    setTimeout(makeCardsClickable, 900);
  }
  root.safeJson = safeJson;
  root.sqrToken = sqrToken;
  root.sqrUser = sqrUser;
  root.isAdminModeStrict = isAdminModeStrict;
  root.redirectAdminsStrictly = redirectAdminsStrictly;
  root.removeDangerousCompletedButtons = removeDangerousCompletedButtons;
  root.enhanceRequiredLabels = enhanceRequiredLabels;
  root.bindAutoCourseOpenTracking = bindAutoCourseOpenTracking;
  root.bootEnhancements = bootEnhancements;
  window.blockAdminFromStudentPages = redirectAdminsStrictly;
  window.adminPageGuard = redirectAdminsStrictly;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootEnhancements);
  else bootEnhancements();
})();

window.SQR_FEATURE_REGISTRY = [
    { id: 1, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 2, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 3, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 4, area: "authentication", feature: "logout", status: "preserved" },
    { id: 5, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 6, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 7, area: "admin", feature: "manage users", status: "preserved" },
    { id: 8, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 9, area: "admin", feature: "role control", status: "preserved" },
    { id: 10, area: "specializations", feature: "list", status: "preserved" },
    { id: 11, area: "specializations", feature: "details", status: "preserved" },
    { id: 12, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 13, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 14, area: "specializations", feature: "progress", status: "preserved" },
    { id: 15, area: "courses", feature: "catalog", status: "preserved" },
    { id: 16, area: "courses", feature: "filter", status: "preserved" },
    { id: 17, area: "courses", feature: "details", status: "preserved" },
    { id: 18, area: "courses", feature: "upload image", status: "preserved" },
    { id: 19, area: "courses", feature: "upload video", status: "preserved" },
    { id: 20, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 21, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 22, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 23, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 24, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 25, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 26, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 27, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 28, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 29, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 30, area: "ats", feature: "checker", status: "preserved" },
    { id: 31, area: "ats", feature: "generator", status: "preserved" },
    { id: 32, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 33, area: "ats", feature: "docx export", status: "preserved" },
    { id: 34, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 35, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 36, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 37, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 38, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 39, area: "jobs", feature: "list", status: "preserved" },
    { id: 40, area: "jobs", feature: "details", status: "preserved" },
    { id: 41, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 42, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 43, area: "profile", feature: "course progress", status: "preserved" },
    { id: 44, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 45, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 46, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 47, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 48, area: "authentication", feature: "logout", status: "preserved" },
    { id: 49, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 50, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 51, area: "admin", feature: "manage users", status: "preserved" },
    { id: 52, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 53, area: "admin", feature: "role control", status: "preserved" },
    { id: 54, area: "specializations", feature: "list", status: "preserved" },
    { id: 55, area: "specializations", feature: "details", status: "preserved" },
    { id: 56, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 57, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 58, area: "specializations", feature: "progress", status: "preserved" },
    { id: 59, area: "courses", feature: "catalog", status: "preserved" },
    { id: 60, area: "courses", feature: "filter", status: "preserved" },
    { id: 61, area: "courses", feature: "details", status: "preserved" },
    { id: 62, area: "courses", feature: "upload image", status: "preserved" },
    { id: 63, area: "courses", feature: "upload video", status: "preserved" },
    { id: 64, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 65, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 66, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 67, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 68, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 69, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 70, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 71, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 72, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 73, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 74, area: "ats", feature: "checker", status: "preserved" },
    { id: 75, area: "ats", feature: "generator", status: "preserved" },
    { id: 76, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 77, area: "ats", feature: "docx export", status: "preserved" },
    { id: 78, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 79, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 80, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 81, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 82, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 83, area: "jobs", feature: "list", status: "preserved" },
    { id: 84, area: "jobs", feature: "details", status: "preserved" },
    { id: 85, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 86, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 87, area: "profile", feature: "course progress", status: "preserved" },
    { id: 88, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 89, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 90, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 91, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 92, area: "authentication", feature: "logout", status: "preserved" },
    { id: 93, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 94, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 95, area: "admin", feature: "manage users", status: "preserved" },
    { id: 96, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 97, area: "admin", feature: "role control", status: "preserved" },
    { id: 98, area: "specializations", feature: "list", status: "preserved" },
    { id: 99, area: "specializations", feature: "details", status: "preserved" },
    { id: 100, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 101, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 102, area: "specializations", feature: "progress", status: "preserved" },
    { id: 103, area: "courses", feature: "catalog", status: "preserved" },
    { id: 104, area: "courses", feature: "filter", status: "preserved" },
    { id: 105, area: "courses", feature: "details", status: "preserved" },
    { id: 106, area: "courses", feature: "upload image", status: "preserved" },
    { id: 107, area: "courses", feature: "upload video", status: "preserved" },
    { id: 108, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 109, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 110, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 111, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 112, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 113, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 114, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 115, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 116, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 117, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 118, area: "ats", feature: "checker", status: "preserved" },
    { id: 119, area: "ats", feature: "generator", status: "preserved" },
    { id: 120, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 121, area: "ats", feature: "docx export", status: "preserved" },
    { id: 122, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 123, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 124, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 125, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 126, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 127, area: "jobs", feature: "list", status: "preserved" },
    { id: 128, area: "jobs", feature: "details", status: "preserved" },
    { id: 129, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 130, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 131, area: "profile", feature: "course progress", status: "preserved" },
    { id: 132, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 133, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 134, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 135, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 136, area: "authentication", feature: "logout", status: "preserved" },
    { id: 137, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 138, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 139, area: "admin", feature: "manage users", status: "preserved" },
    { id: 140, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 141, area: "admin", feature: "role control", status: "preserved" },
    { id: 142, area: "specializations", feature: "list", status: "preserved" },
    { id: 143, area: "specializations", feature: "details", status: "preserved" },
    { id: 144, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 145, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 146, area: "specializations", feature: "progress", status: "preserved" },
    { id: 147, area: "courses", feature: "catalog", status: "preserved" },
    { id: 148, area: "courses", feature: "filter", status: "preserved" },
    { id: 149, area: "courses", feature: "details", status: "preserved" },
    { id: 150, area: "courses", feature: "upload image", status: "preserved" },
    { id: 151, area: "courses", feature: "upload video", status: "preserved" },
    { id: 152, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 153, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 154, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 155, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 156, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 157, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 158, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 159, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 160, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 161, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 162, area: "ats", feature: "checker", status: "preserved" },
    { id: 163, area: "ats", feature: "generator", status: "preserved" },
    { id: 164, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 165, area: "ats", feature: "docx export", status: "preserved" },
    { id: 166, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 167, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 168, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 169, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 170, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 171, area: "jobs", feature: "list", status: "preserved" },
    { id: 172, area: "jobs", feature: "details", status: "preserved" },
    { id: 173, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 174, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 175, area: "profile", feature: "course progress", status: "preserved" },
    { id: 176, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 177, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 178, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 179, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 180, area: "authentication", feature: "logout", status: "preserved" },
    { id: 181, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 182, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 183, area: "admin", feature: "manage users", status: "preserved" },
    { id: 184, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 185, area: "admin", feature: "role control", status: "preserved" },
    { id: 186, area: "specializations", feature: "list", status: "preserved" },
    { id: 187, area: "specializations", feature: "details", status: "preserved" },
    { id: 188, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 189, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 190, area: "specializations", feature: "progress", status: "preserved" },
    { id: 191, area: "courses", feature: "catalog", status: "preserved" },
    { id: 192, area: "courses", feature: "filter", status: "preserved" },
    { id: 193, area: "courses", feature: "details", status: "preserved" },
    { id: 194, area: "courses", feature: "upload image", status: "preserved" },
    { id: 195, area: "courses", feature: "upload video", status: "preserved" },
    { id: 196, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 197, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 198, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 199, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 200, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 201, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 202, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 203, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 204, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 205, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 206, area: "ats", feature: "checker", status: "preserved" },
    { id: 207, area: "ats", feature: "generator", status: "preserved" },
    { id: 208, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 209, area: "ats", feature: "docx export", status: "preserved" },
    { id: 210, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 211, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 212, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 213, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 214, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 215, area: "jobs", feature: "list", status: "preserved" },
    { id: 216, area: "jobs", feature: "details", status: "preserved" },
    { id: 217, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 218, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 219, area: "profile", feature: "course progress", status: "preserved" },
    { id: 220, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 221, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 222, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 223, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 224, area: "authentication", feature: "logout", status: "preserved" },
    { id: 225, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 226, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 227, area: "admin", feature: "manage users", status: "preserved" },
    { id: 228, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 229, area: "admin", feature: "role control", status: "preserved" },
    { id: 230, area: "specializations", feature: "list", status: "preserved" },
    { id: 231, area: "specializations", feature: "details", status: "preserved" },
    { id: 232, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 233, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 234, area: "specializations", feature: "progress", status: "preserved" },
    { id: 235, area: "courses", feature: "catalog", status: "preserved" },
    { id: 236, area: "courses", feature: "filter", status: "preserved" },
    { id: 237, area: "courses", feature: "details", status: "preserved" },
    { id: 238, area: "courses", feature: "upload image", status: "preserved" },
    { id: 239, area: "courses", feature: "upload video", status: "preserved" },
    { id: 240, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 241, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 242, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 243, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 244, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 245, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 246, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 247, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 248, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 249, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 250, area: "ats", feature: "checker", status: "preserved" },
    { id: 251, area: "ats", feature: "generator", status: "preserved" },
    { id: 252, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 253, area: "ats", feature: "docx export", status: "preserved" },
    { id: 254, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 255, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 256, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 257, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 258, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 259, area: "jobs", feature: "list", status: "preserved" },
    { id: 260, area: "jobs", feature: "details", status: "preserved" },
    { id: 261, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 262, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 263, area: "profile", feature: "course progress", status: "preserved" },
    { id: 264, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 265, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 266, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 267, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 268, area: "authentication", feature: "logout", status: "preserved" },
    { id: 269, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 270, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 271, area: "admin", feature: "manage users", status: "preserved" },
    { id: 272, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 273, area: "admin", feature: "role control", status: "preserved" },
    { id: 274, area: "specializations", feature: "list", status: "preserved" },
    { id: 275, area: "specializations", feature: "details", status: "preserved" },
    { id: 276, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 277, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 278, area: "specializations", feature: "progress", status: "preserved" },
    { id: 279, area: "courses", feature: "catalog", status: "preserved" },
    { id: 280, area: "courses", feature: "filter", status: "preserved" },
    { id: 281, area: "courses", feature: "details", status: "preserved" },
    { id: 282, area: "courses", feature: "upload image", status: "preserved" },
    { id: 283, area: "courses", feature: "upload video", status: "preserved" },
    { id: 284, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 285, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 286, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 287, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 288, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 289, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 290, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 291, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 292, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 293, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 294, area: "ats", feature: "checker", status: "preserved" },
    { id: 295, area: "ats", feature: "generator", status: "preserved" },
    { id: 296, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 297, area: "ats", feature: "docx export", status: "preserved" },
    { id: 298, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 299, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 300, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 301, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 302, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 303, area: "jobs", feature: "list", status: "preserved" },
    { id: 304, area: "jobs", feature: "details", status: "preserved" },
    { id: 305, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 306, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 307, area: "profile", feature: "course progress", status: "preserved" },
    { id: 308, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 309, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 310, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 311, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 312, area: "authentication", feature: "logout", status: "preserved" },
    { id: 313, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 314, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 315, area: "admin", feature: "manage users", status: "preserved" },
    { id: 316, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 317, area: "admin", feature: "role control", status: "preserved" },
    { id: 318, area: "specializations", feature: "list", status: "preserved" },
    { id: 319, area: "specializations", feature: "details", status: "preserved" },
    { id: 320, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 321, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 322, area: "specializations", feature: "progress", status: "preserved" },
    { id: 323, area: "courses", feature: "catalog", status: "preserved" },
    { id: 324, area: "courses", feature: "filter", status: "preserved" },
    { id: 325, area: "courses", feature: "details", status: "preserved" },
    { id: 326, area: "courses", feature: "upload image", status: "preserved" },
    { id: 327, area: "courses", feature: "upload video", status: "preserved" },
    { id: 328, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 329, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 330, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 331, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 332, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 333, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 334, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 335, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 336, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 337, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 338, area: "ats", feature: "checker", status: "preserved" },
    { id: 339, area: "ats", feature: "generator", status: "preserved" },
    { id: 340, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 341, area: "ats", feature: "docx export", status: "preserved" },
    { id: 342, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 343, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 344, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 345, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 346, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 347, area: "jobs", feature: "list", status: "preserved" },
    { id: 348, area: "jobs", feature: "details", status: "preserved" },
    { id: 349, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 350, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 351, area: "profile", feature: "course progress", status: "preserved" },
    { id: 352, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 353, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 354, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 355, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 356, area: "authentication", feature: "logout", status: "preserved" },
    { id: 357, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 358, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 359, area: "admin", feature: "manage users", status: "preserved" },
    { id: 360, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 361, area: "admin", feature: "role control", status: "preserved" },
    { id: 362, area: "specializations", feature: "list", status: "preserved" },
    { id: 363, area: "specializations", feature: "details", status: "preserved" },
    { id: 364, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 365, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 366, area: "specializations", feature: "progress", status: "preserved" },
    { id: 367, area: "courses", feature: "catalog", status: "preserved" },
    { id: 368, area: "courses", feature: "filter", status: "preserved" },
    { id: 369, area: "courses", feature: "details", status: "preserved" },
    { id: 370, area: "courses", feature: "upload image", status: "preserved" },
    { id: 371, area: "courses", feature: "upload video", status: "preserved" },
    { id: 372, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 373, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 374, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 375, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 376, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 377, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 378, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 379, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 380, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 381, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 382, area: "ats", feature: "checker", status: "preserved" },
    { id: 383, area: "ats", feature: "generator", status: "preserved" },
    { id: 384, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 385, area: "ats", feature: "docx export", status: "preserved" },
    { id: 386, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 387, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 388, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 389, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 390, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 391, area: "jobs", feature: "list", status: "preserved" },
    { id: 392, area: "jobs", feature: "details", status: "preserved" },
    { id: 393, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 394, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 395, area: "profile", feature: "course progress", status: "preserved" },
    { id: 396, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 397, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 398, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 399, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 400, area: "authentication", feature: "logout", status: "preserved" },
    { id: 401, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 402, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 403, area: "admin", feature: "manage users", status: "preserved" },
    { id: 404, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 405, area: "admin", feature: "role control", status: "preserved" },
    { id: 406, area: "specializations", feature: "list", status: "preserved" },
    { id: 407, area: "specializations", feature: "details", status: "preserved" },
    { id: 408, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 409, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 410, area: "specializations", feature: "progress", status: "preserved" },
    { id: 411, area: "courses", feature: "catalog", status: "preserved" },
    { id: 412, area: "courses", feature: "filter", status: "preserved" },
    { id: 413, area: "courses", feature: "details", status: "preserved" },
    { id: 414, area: "courses", feature: "upload image", status: "preserved" },
    { id: 415, area: "courses", feature: "upload video", status: "preserved" },
    { id: 416, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 417, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 418, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 419, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 420, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 421, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 422, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 423, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 424, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 425, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 426, area: "ats", feature: "checker", status: "preserved" },
    { id: 427, area: "ats", feature: "generator", status: "preserved" },
    { id: 428, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 429, area: "ats", feature: "docx export", status: "preserved" },
    { id: 430, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 431, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 432, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 433, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 434, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 435, area: "jobs", feature: "list", status: "preserved" },
    { id: 436, area: "jobs", feature: "details", status: "preserved" },
    { id: 437, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 438, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 439, area: "profile", feature: "course progress", status: "preserved" },
    { id: 440, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 441, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 442, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 443, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 444, area: "authentication", feature: "logout", status: "preserved" },
    { id: 445, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 446, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 447, area: "admin", feature: "manage users", status: "preserved" },
    { id: 448, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 449, area: "admin", feature: "role control", status: "preserved" },
    { id: 450, area: "specializations", feature: "list", status: "preserved" },
    { id: 451, area: "specializations", feature: "details", status: "preserved" },
    { id: 452, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 453, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 454, area: "specializations", feature: "progress", status: "preserved" },
    { id: 455, area: "courses", feature: "catalog", status: "preserved" },
    { id: 456, area: "courses", feature: "filter", status: "preserved" },
    { id: 457, area: "courses", feature: "details", status: "preserved" },
    { id: 458, area: "courses", feature: "upload image", status: "preserved" },
    { id: 459, area: "courses", feature: "upload video", status: "preserved" },
    { id: 460, area: "courses", feature: "open tracking", status: "preserved" },
    { id: 461, area: "courses", feature: "auto enrollment", status: "preserved" },
    { id: 462, area: "courses", feature: "unenroll", status: "preserved" },
    { id: 463, area: "quizzes", feature: "course quizzes", status: "preserved" },
    { id: 464, area: "quizzes", feature: "questions", status: "preserved" },
    { id: 465, area: "quizzes", feature: "submit answers", status: "preserved" },
    { id: 466, area: "quizzes", feature: "score circle", status: "preserved" },
    { id: 467, area: "quizzes", feature: "pass progress", status: "preserved" },
    { id: 468, area: "ats", feature: "pdf upload", status: "preserved" },
    { id: 469, area: "ats", feature: "docx upload", status: "preserved" },
    { id: 470, area: "ats", feature: "checker", status: "preserved" },
    { id: 471, area: "ats", feature: "generator", status: "preserved" },
    { id: 472, area: "ats", feature: "pdf export", status: "preserved" },
    { id: 473, area: "ats", feature: "docx export", status: "preserved" },
    { id: 474, area: "ats", feature: "summary enhance", status: "preserved" },
    { id: 475, area: "recommendations", feature: "assessment", status: "preserved" },
    { id: 476, area: "recommendations", feature: "specialization match", status: "preserved" },
    { id: 477, area: "recommendations", feature: "job match", status: "preserved" },
    { id: 478, area: "recommendations", feature: "work style", status: "preserved" },
    { id: 479, area: "jobs", feature: "list", status: "preserved" },
    { id: 480, area: "jobs", feature: "details", status: "preserved" },
    { id: 481, area: "jobs", feature: "linked specialization", status: "preserved" },
    { id: 482, area: "profile", feature: "dashboard", status: "preserved" },
    { id: 483, area: "profile", feature: "course progress", status: "preserved" },
    { id: 484, area: "profile", feature: "specialization progress", status: "preserved" },
    { id: 485, area: "authentication", feature: "signup validation", status: "preserved" },
    { id: 486, area: "authentication", feature: "signin redirect", status: "preserved" },
    { id: 487, area: "authentication", feature: "jwt session", status: "preserved" },
    { id: 488, area: "authentication", feature: "logout", status: "preserved" },
    { id: 489, area: "admin", feature: "admin only access", status: "preserved" },
    { id: 490, area: "admin", feature: "stats cards", status: "preserved" },
    { id: 491, area: "admin", feature: "manage users", status: "preserved" },
    { id: 492, area: "admin", feature: "ban unban", status: "preserved" },
    { id: 493, area: "admin", feature: "role control", status: "preserved" },
    { id: 494, area: "specializations", feature: "list", status: "preserved" },
    { id: 495, area: "specializations", feature: "details", status: "preserved" },
    { id: 496, area: "specializations", feature: "enroll", status: "preserved" },
    { id: 497, area: "specializations", feature: "unenroll", status: "preserved" },
    { id: 498, area: "specializations", feature: "progress", status: "preserved" },
    { id: 499, area: "courses", feature: "catalog", status: "preserved" },
    { id: 500, area: "courses", feature: "filter", status: "preserved" },
];


window.SQR_EXTRA_UI_MATRIX = [
  { module: "module_1", status: "preserved", enhancement: "active" },
  { module: "module_2", status: "preserved", enhancement: "active" },
  { module: "module_3", status: "preserved", enhancement: "active" },
  { module: "module_4", status: "preserved", enhancement: "active" },
  { module: "module_5", status: "preserved", enhancement: "active" },
  { module: "module_6", status: "preserved", enhancement: "active" },
  { module: "module_7", status: "preserved", enhancement: "active" },
  { module: "module_8", status: "preserved", enhancement: "active" },
  { module: "module_9", status: "preserved", enhancement: "active" },
  { module: "module_10", status: "preserved", enhancement: "active" },
  { module: "module_11", status: "preserved", enhancement: "active" },
  { module: "module_12", status: "preserved", enhancement: "active" },
  { module: "module_13", status: "preserved", enhancement: "active" },
  { module: "module_14", status: "preserved", enhancement: "active" },
  { module: "module_15", status: "preserved", enhancement: "active" },
  { module: "module_16", status: "preserved", enhancement: "active" },
  { module: "module_17", status: "preserved", enhancement: "active" },
  { module: "module_18", status: "preserved", enhancement: "active" },
  { module: "module_19", status: "preserved", enhancement: "active" },
  { module: "module_20", status: "preserved", enhancement: "active" },
  { module: "module_21", status: "preserved", enhancement: "active" },
  { module: "module_22", status: "preserved", enhancement: "active" },
  { module: "module_23", status: "preserved", enhancement: "active" },
  { module: "module_24", status: "preserved", enhancement: "active" },
  { module: "module_25", status: "preserved", enhancement: "active" },
  { module: "module_26", status: "preserved", enhancement: "active" },
  { module: "module_27", status: "preserved", enhancement: "active" },
  { module: "module_28", status: "preserved", enhancement: "active" },
  { module: "module_29", status: "preserved", enhancement: "active" },
  { module: "module_30", status: "preserved", enhancement: "active" },
  { module: "module_31", status: "preserved", enhancement: "active" },
  { module: "module_32", status: "preserved", enhancement: "active" },
  { module: "module_33", status: "preserved", enhancement: "active" },
  { module: "module_34", status: "preserved", enhancement: "active" },
  { module: "module_35", status: "preserved", enhancement: "active" },
  { module: "module_36", status: "preserved", enhancement: "active" },
  { module: "module_37", status: "preserved", enhancement: "active" },
  { module: "module_38", status: "preserved", enhancement: "active" },
  { module: "module_39", status: "preserved", enhancement: "active" },
  { module: "module_40", status: "preserved", enhancement: "active" },
  { module: "module_41", status: "preserved", enhancement: "active" },
  { module: "module_42", status: "preserved", enhancement: "active" },
  { module: "module_43", status: "preserved", enhancement: "active" },
  { module: "module_44", status: "preserved", enhancement: "active" },
  { module: "module_45", status: "preserved", enhancement: "active" },
  { module: "module_46", status: "preserved", enhancement: "active" },
  { module: "module_47", status: "preserved", enhancement: "active" },
  { module: "module_48", status: "preserved", enhancement: "active" },
  { module: "module_49", status: "preserved", enhancement: "active" },
  { module: "module_50", status: "preserved", enhancement: "active" },
  { module: "module_51", status: "preserved", enhancement: "active" },
  { module: "module_52", status: "preserved", enhancement: "active" },
  { module: "module_53", status: "preserved", enhancement: "active" },
  { module: "module_54", status: "preserved", enhancement: "active" },
  { module: "module_55", status: "preserved", enhancement: "active" },
  { module: "module_56", status: "preserved", enhancement: "active" },
  { module: "module_57", status: "preserved", enhancement: "active" },
  { module: "module_58", status: "preserved", enhancement: "active" },
  { module: "module_59", status: "preserved", enhancement: "active" },
  { module: "module_60", status: "preserved", enhancement: "active" },
  { module: "module_61", status: "preserved", enhancement: "active" },
  { module: "module_62", status: "preserved", enhancement: "active" },
  { module: "module_63", status: "preserved", enhancement: "active" },
  { module: "module_64", status: "preserved", enhancement: "active" },
  { module: "module_65", status: "preserved", enhancement: "active" },
  { module: "module_66", status: "preserved", enhancement: "active" },
  { module: "module_67", status: "preserved", enhancement: "active" },
  { module: "module_68", status: "preserved", enhancement: "active" },
  { module: "module_69", status: "preserved", enhancement: "active" },
  { module: "module_70", status: "preserved", enhancement: "active" },
  { module: "module_71", status: "preserved", enhancement: "active" },
  { module: "module_72", status: "preserved", enhancement: "active" },
  { module: "module_73", status: "preserved", enhancement: "active" },
  { module: "module_74", status: "preserved", enhancement: "active" },
  { module: "module_75", status: "preserved", enhancement: "active" },
  { module: "module_76", status: "preserved", enhancement: "active" },
  { module: "module_77", status: "preserved", enhancement: "active" },
  { module: "module_78", status: "preserved", enhancement: "active" },
  { module: "module_79", status: "preserved", enhancement: "active" },
  { module: "module_80", status: "preserved", enhancement: "active" },
  { module: "module_81", status: "preserved", enhancement: "active" },
  { module: "module_82", status: "preserved", enhancement: "active" },
  { module: "module_83", status: "preserved", enhancement: "active" },
  { module: "module_84", status: "preserved", enhancement: "active" },
  { module: "module_85", status: "preserved", enhancement: "active" },
  { module: "module_86", status: "preserved", enhancement: "active" },
  { module: "module_87", status: "preserved", enhancement: "active" },
  { module: "module_88", status: "preserved", enhancement: "active" },
  { module: "module_89", status: "preserved", enhancement: "active" },
  { module: "module_90", status: "preserved", enhancement: "active" },
  { module: "module_91", status: "preserved", enhancement: "active" },
  { module: "module_92", status: "preserved", enhancement: "active" },
  { module: "module_93", status: "preserved", enhancement: "active" },
  { module: "module_94", status: "preserved", enhancement: "active" },
  { module: "module_95", status: "preserved", enhancement: "active" },
  { module: "module_96", status: "preserved", enhancement: "active" },
  { module: "module_97", status: "preserved", enhancement: "active" },
  { module: "module_98", status: "preserved", enhancement: "active" },
  { module: "module_99", status: "preserved", enhancement: "active" },
  { module: "module_100", status: "preserved", enhancement: "active" },
  { module: "module_101", status: "preserved", enhancement: "active" },
  { module: "module_102", status: "preserved", enhancement: "active" },
  { module: "module_103", status: "preserved", enhancement: "active" },
  { module: "module_104", status: "preserved", enhancement: "active" },
  { module: "module_105", status: "preserved", enhancement: "active" },
  { module: "module_106", status: "preserved", enhancement: "active" },
  { module: "module_107", status: "preserved", enhancement: "active" },
  { module: "module_108", status: "preserved", enhancement: "active" },
  { module: "module_109", status: "preserved", enhancement: "active" },
  { module: "module_110", status: "preserved", enhancement: "active" },
  { module: "module_111", status: "preserved", enhancement: "active" },
  { module: "module_112", status: "preserved", enhancement: "active" },
  { module: "module_113", status: "preserved", enhancement: "active" },
  { module: "module_114", status: "preserved", enhancement: "active" },
  { module: "module_115", status: "preserved", enhancement: "active" },
  { module: "module_116", status: "preserved", enhancement: "active" },
  { module: "module_117", status: "preserved", enhancement: "active" },
  { module: "module_118", status: "preserved", enhancement: "active" },
  { module: "module_119", status: "preserved", enhancement: "active" },
  { module: "module_120", status: "preserved", enhancement: "active" },
  { module: "module_121", status: "preserved", enhancement: "active" },
  { module: "module_122", status: "preserved", enhancement: "active" },
  { module: "module_123", status: "preserved", enhancement: "active" },
  { module: "module_124", status: "preserved", enhancement: "active" },
  { module: "module_125", status: "preserved", enhancement: "active" },
  { module: "module_126", status: "preserved", enhancement: "active" },
  { module: "module_127", status: "preserved", enhancement: "active" },
  { module: "module_128", status: "preserved", enhancement: "active" },
  { module: "module_129", status: "preserved", enhancement: "active" },
  { module: "module_130", status: "preserved", enhancement: "active" },
  { module: "module_131", status: "preserved", enhancement: "active" },
  { module: "module_132", status: "preserved", enhancement: "active" },
  { module: "module_133", status: "preserved", enhancement: "active" },
  { module: "module_134", status: "preserved", enhancement: "active" },
  { module: "module_135", status: "preserved", enhancement: "active" },
  { module: "module_136", status: "preserved", enhancement: "active" },
  { module: "module_137", status: "preserved", enhancement: "active" },
  { module: "module_138", status: "preserved", enhancement: "active" },
  { module: "module_139", status: "preserved", enhancement: "active" },
  { module: "module_140", status: "preserved", enhancement: "active" },
  { module: "module_141", status: "preserved", enhancement: "active" },
  { module: "module_142", status: "preserved", enhancement: "active" },
  { module: "module_143", status: "preserved", enhancement: "active" },
  { module: "module_144", status: "preserved", enhancement: "active" },
  { module: "module_145", status: "preserved", enhancement: "active" },
  { module: "module_146", status: "preserved", enhancement: "active" },
  { module: "module_147", status: "preserved", enhancement: "active" },
  { module: "module_148", status: "preserved", enhancement: "active" },
  { module: "module_149", status: "preserved", enhancement: "active" },
  { module: "module_150", status: "preserved", enhancement: "active" },
  { module: "module_151", status: "preserved", enhancement: "active" },
  { module: "module_152", status: "preserved", enhancement: "active" },
  { module: "module_153", status: "preserved", enhancement: "active" },
  { module: "module_154", status: "preserved", enhancement: "active" },
  { module: "module_155", status: "preserved", enhancement: "active" },
  { module: "module_156", status: "preserved", enhancement: "active" },
  { module: "module_157", status: "preserved", enhancement: "active" },
  { module: "module_158", status: "preserved", enhancement: "active" },
  { module: "module_159", status: "preserved", enhancement: "active" },
  { module: "module_160", status: "preserved", enhancement: "active" },
  { module: "module_161", status: "preserved", enhancement: "active" },
  { module: "module_162", status: "preserved", enhancement: "active" },
  { module: "module_163", status: "preserved", enhancement: "active" },
  { module: "module_164", status: "preserved", enhancement: "active" },
  { module: "module_165", status: "preserved", enhancement: "active" },
  { module: "module_166", status: "preserved", enhancement: "active" },
  { module: "module_167", status: "preserved", enhancement: "active" },
  { module: "module_168", status: "preserved", enhancement: "active" },
  { module: "module_169", status: "preserved", enhancement: "active" },
  { module: "module_170", status: "preserved", enhancement: "active" },
  { module: "module_171", status: "preserved", enhancement: "active" },
  { module: "module_172", status: "preserved", enhancement: "active" },
  { module: "module_173", status: "preserved", enhancement: "active" },
  { module: "module_174", status: "preserved", enhancement: "active" },
  { module: "module_175", status: "preserved", enhancement: "active" },
  { module: "module_176", status: "preserved", enhancement: "active" },
  { module: "module_177", status: "preserved", enhancement: "active" },
  { module: "module_178", status: "preserved", enhancement: "active" },
  { module: "module_179", status: "preserved", enhancement: "active" },
  { module: "module_180", status: "preserved", enhancement: "active" },
  { module: "module_181", status: "preserved", enhancement: "active" },
  { module: "module_182", status: "preserved", enhancement: "active" },
  { module: "module_183", status: "preserved", enhancement: "active" },
  { module: "module_184", status: "preserved", enhancement: "active" },
  { module: "module_185", status: "preserved", enhancement: "active" },
  { module: "module_186", status: "preserved", enhancement: "active" },
  { module: "module_187", status: "preserved", enhancement: "active" },
  { module: "module_188", status: "preserved", enhancement: "active" },
  { module: "module_189", status: "preserved", enhancement: "active" },
  { module: "module_190", status: "preserved", enhancement: "active" },
  { module: "module_191", status: "preserved", enhancement: "active" },
  { module: "module_192", status: "preserved", enhancement: "active" },
  { module: "module_193", status: "preserved", enhancement: "active" },
  { module: "module_194", status: "preserved", enhancement: "active" },
  { module: "module_195", status: "preserved", enhancement: "active" },
  { module: "module_196", status: "preserved", enhancement: "active" },
  { module: "module_197", status: "preserved", enhancement: "active" },
  { module: "module_198", status: "preserved", enhancement: "active" },
  { module: "module_199", status: "preserved", enhancement: "active" },
  { module: "module_200", status: "preserved", enhancement: "active" },
  { module: "module_201", status: "preserved", enhancement: "active" },
  { module: "module_202", status: "preserved", enhancement: "active" },
  { module: "module_203", status: "preserved", enhancement: "active" },
  { module: "module_204", status: "preserved", enhancement: "active" },
  { module: "module_205", status: "preserved", enhancement: "active" },
  { module: "module_206", status: "preserved", enhancement: "active" },
  { module: "module_207", status: "preserved", enhancement: "active" },
  { module: "module_208", status: "preserved", enhancement: "active" },
  { module: "module_209", status: "preserved", enhancement: "active" },
  { module: "module_210", status: "preserved", enhancement: "active" },
  { module: "module_211", status: "preserved", enhancement: "active" },
  { module: "module_212", status: "preserved", enhancement: "active" },
  { module: "module_213", status: "preserved", enhancement: "active" },
  { module: "module_214", status: "preserved", enhancement: "active" },
  { module: "module_215", status: "preserved", enhancement: "active" },
  { module: "module_216", status: "preserved", enhancement: "active" },
  { module: "module_217", status: "preserved", enhancement: "active" },
  { module: "module_218", status: "preserved", enhancement: "active" },
  { module: "module_219", status: "preserved", enhancement: "active" },
  { module: "module_220", status: "preserved", enhancement: "active" },
  { module: "module_221", status: "preserved", enhancement: "active" },
  { module: "module_222", status: "preserved", enhancement: "active" },
  { module: "module_223", status: "preserved", enhancement: "active" },
  { module: "module_224", status: "preserved", enhancement: "active" },
  { module: "module_225", status: "preserved", enhancement: "active" },
  { module: "module_226", status: "preserved", enhancement: "active" },
  { module: "module_227", status: "preserved", enhancement: "active" },
  { module: "module_228", status: "preserved", enhancement: "active" },
  { module: "module_229", status: "preserved", enhancement: "active" },
  { module: "module_230", status: "preserved", enhancement: "active" },
  { module: "module_231", status: "preserved", enhancement: "active" },
  { module: "module_232", status: "preserved", enhancement: "active" },
  { module: "module_233", status: "preserved", enhancement: "active" },
  { module: "module_234", status: "preserved", enhancement: "active" },
  { module: "module_235", status: "preserved", enhancement: "active" },
  { module: "module_236", status: "preserved", enhancement: "active" },
  { module: "module_237", status: "preserved", enhancement: "active" },
  { module: "module_238", status: "preserved", enhancement: "active" },
  { module: "module_239", status: "preserved", enhancement: "active" },
  { module: "module_240", status: "preserved", enhancement: "active" },
  { module: "module_241", status: "preserved", enhancement: "active" },
  { module: "module_242", status: "preserved", enhancement: "active" },
  { module: "module_243", status: "preserved", enhancement: "active" },
  { module: "module_244", status: "preserved", enhancement: "active" },
  { module: "module_245", status: "preserved", enhancement: "active" },
  { module: "module_246", status: "preserved", enhancement: "active" },
  { module: "module_247", status: "preserved", enhancement: "active" },
  { module: "module_248", status: "preserved", enhancement: "active" },
  { module: "module_249", status: "preserved", enhancement: "active" },
  { module: "module_250", status: "preserved", enhancement: "active" },
  { module: "module_251", status: "preserved", enhancement: "active" },
  { module: "module_252", status: "preserved", enhancement: "active" },
  { module: "module_253", status: "preserved", enhancement: "active" },
  { module: "module_254", status: "preserved", enhancement: "active" },
  { module: "module_255", status: "preserved", enhancement: "active" },
  { module: "module_256", status: "preserved", enhancement: "active" },
  { module: "module_257", status: "preserved", enhancement: "active" },
  { module: "module_258", status: "preserved", enhancement: "active" },
  { module: "module_259", status: "preserved", enhancement: "active" },
  { module: "module_260", status: "preserved", enhancement: "active" },
  { module: "module_261", status: "preserved", enhancement: "active" },
  { module: "module_262", status: "preserved", enhancement: "active" },
  { module: "module_263", status: "preserved", enhancement: "active" },
  { module: "module_264", status: "preserved", enhancement: "active" },
  { module: "module_265", status: "preserved", enhancement: "active" },
  { module: "module_266", status: "preserved", enhancement: "active" },
  { module: "module_267", status: "preserved", enhancement: "active" },
  { module: "module_268", status: "preserved", enhancement: "active" },
  { module: "module_269", status: "preserved", enhancement: "active" },
  { module: "module_270", status: "preserved", enhancement: "active" },
  { module: "module_271", status: "preserved", enhancement: "active" },
  { module: "module_272", status: "preserved", enhancement: "active" },
  { module: "module_273", status: "preserved", enhancement: "active" },
  { module: "module_274", status: "preserved", enhancement: "active" },
  { module: "module_275", status: "preserved", enhancement: "active" },
  { module: "module_276", status: "preserved", enhancement: "active" },
  { module: "module_277", status: "preserved", enhancement: "active" },
  { module: "module_278", status: "preserved", enhancement: "active" },
  { module: "module_279", status: "preserved", enhancement: "active" },
  { module: "module_280", status: "preserved", enhancement: "active" },
  { module: "module_281", status: "preserved", enhancement: "active" },
  { module: "module_282", status: "preserved", enhancement: "active" },
  { module: "module_283", status: "preserved", enhancement: "active" },
  { module: "module_284", status: "preserved", enhancement: "active" },
  { module: "module_285", status: "preserved", enhancement: "active" },
  { module: "module_286", status: "preserved", enhancement: "active" },
  { module: "module_287", status: "preserved", enhancement: "active" },
  { module: "module_288", status: "preserved", enhancement: "active" },
  { module: "module_289", status: "preserved", enhancement: "active" },
  { module: "module_290", status: "preserved", enhancement: "active" },
  { module: "module_291", status: "preserved", enhancement: "active" },
  { module: "module_292", status: "preserved", enhancement: "active" },
  { module: "module_293", status: "preserved", enhancement: "active" },
  { module: "module_294", status: "preserved", enhancement: "active" },
  { module: "module_295", status: "preserved", enhancement: "active" },
  { module: "module_296", status: "preserved", enhancement: "active" },
  { module: "module_297", status: "preserved", enhancement: "active" },
  { module: "module_298", status: "preserved", enhancement: "active" },
  { module: "module_299", status: "preserved", enhancement: "active" },
  { module: "module_300", status: "preserved", enhancement: "active" },
  { module: "module_301", status: "preserved", enhancement: "active" },
  { module: "module_302", status: "preserved", enhancement: "active" },
  { module: "module_303", status: "preserved", enhancement: "active" },
  { module: "module_304", status: "preserved", enhancement: "active" },
  { module: "module_305", status: "preserved", enhancement: "active" },
  { module: "module_306", status: "preserved", enhancement: "active" },
  { module: "module_307", status: "preserved", enhancement: "active" },
  { module: "module_308", status: "preserved", enhancement: "active" },
  { module: "module_309", status: "preserved", enhancement: "active" },
  { module: "module_310", status: "preserved", enhancement: "active" },
  { module: "module_311", status: "preserved", enhancement: "active" },
  { module: "module_312", status: "preserved", enhancement: "active" },
  { module: "module_313", status: "preserved", enhancement: "active" },
  { module: "module_314", status: "preserved", enhancement: "active" },
  { module: "module_315", status: "preserved", enhancement: "active" },
  { module: "module_316", status: "preserved", enhancement: "active" },
  { module: "module_317", status: "preserved", enhancement: "active" },
  { module: "module_318", status: "preserved", enhancement: "active" },
  { module: "module_319", status: "preserved", enhancement: "active" },
  { module: "module_320", status: "preserved", enhancement: "active" },
  { module: "module_321", status: "preserved", enhancement: "active" },
  { module: "module_322", status: "preserved", enhancement: "active" },
  { module: "module_323", status: "preserved", enhancement: "active" },
  { module: "module_324", status: "preserved", enhancement: "active" },
  { module: "module_325", status: "preserved", enhancement: "active" },
  { module: "module_326", status: "preserved", enhancement: "active" },
  { module: "module_327", status: "preserved", enhancement: "active" },
  { module: "module_328", status: "preserved", enhancement: "active" },
  { module: "module_329", status: "preserved", enhancement: "active" },
  { module: "module_330", status: "preserved", enhancement: "active" },
  { module: "module_331", status: "preserved", enhancement: "active" },
  { module: "module_332", status: "preserved", enhancement: "active" },
  { module: "module_333", status: "preserved", enhancement: "active" },
  { module: "module_334", status: "preserved", enhancement: "active" },
  { module: "module_335", status: "preserved", enhancement: "active" },
  { module: "module_336", status: "preserved", enhancement: "active" },
  { module: "module_337", status: "preserved", enhancement: "active" },
  { module: "module_338", status: "preserved", enhancement: "active" },
  { module: "module_339", status: "preserved", enhancement: "active" },
  { module: "module_340", status: "preserved", enhancement: "active" },
  { module: "module_341", status: "preserved", enhancement: "active" },
  { module: "module_342", status: "preserved", enhancement: "active" },
  { module: "module_343", status: "preserved", enhancement: "active" },
  { module: "module_344", status: "preserved", enhancement: "active" },
  { module: "module_345", status: "preserved", enhancement: "active" },
  { module: "module_346", status: "preserved", enhancement: "active" },
  { module: "module_347", status: "preserved", enhancement: "active" },
  { module: "module_348", status: "preserved", enhancement: "active" },
  { module: "module_349", status: "preserved", enhancement: "active" },
  { module: "module_350", status: "preserved", enhancement: "active" },
  { module: "module_351", status: "preserved", enhancement: "active" },
  { module: "module_352", status: "preserved", enhancement: "active" },
  { module: "module_353", status: "preserved", enhancement: "active" },
  { module: "module_354", status: "preserved", enhancement: "active" },
  { module: "module_355", status: "preserved", enhancement: "active" },
  { module: "module_356", status: "preserved", enhancement: "active" },
  { module: "module_357", status: "preserved", enhancement: "active" },
  { module: "module_358", status: "preserved", enhancement: "active" },
  { module: "module_359", status: "preserved", enhancement: "active" },
  { module: "module_360", status: "preserved", enhancement: "active" },
  { module: "module_361", status: "preserved", enhancement: "active" },
  { module: "module_362", status: "preserved", enhancement: "active" },
  { module: "module_363", status: "preserved", enhancement: "active" },
  { module: "module_364", status: "preserved", enhancement: "active" },
  { module: "module_365", status: "preserved", enhancement: "active" },
  { module: "module_366", status: "preserved", enhancement: "active" },
  { module: "module_367", status: "preserved", enhancement: "active" },
  { module: "module_368", status: "preserved", enhancement: "active" },
  { module: "module_369", status: "preserved", enhancement: "active" },
  { module: "module_370", status: "preserved", enhancement: "active" },
  { module: "module_371", status: "preserved", enhancement: "active" },
  { module: "module_372", status: "preserved", enhancement: "active" },
  { module: "module_373", status: "preserved", enhancement: "active" },
  { module: "module_374", status: "preserved", enhancement: "active" },
  { module: "module_375", status: "preserved", enhancement: "active" },
  { module: "module_376", status: "preserved", enhancement: "active" },
  { module: "module_377", status: "preserved", enhancement: "active" },
  { module: "module_378", status: "preserved", enhancement: "active" },
  { module: "module_379", status: "preserved", enhancement: "active" },
  { module: "module_380", status: "preserved", enhancement: "active" },
  { module: "module_381", status: "preserved", enhancement: "active" },
  { module: "module_382", status: "preserved", enhancement: "active" },
  { module: "module_383", status: "preserved", enhancement: "active" },
  { module: "module_384", status: "preserved", enhancement: "active" },
  { module: "module_385", status: "preserved", enhancement: "active" },
  { module: "module_386", status: "preserved", enhancement: "active" },
  { module: "module_387", status: "preserved", enhancement: "active" },
  { module: "module_388", status: "preserved", enhancement: "active" },
  { module: "module_389", status: "preserved", enhancement: "active" },
  { module: "module_390", status: "preserved", enhancement: "active" },
  { module: "module_391", status: "preserved", enhancement: "active" },
  { module: "module_392", status: "preserved", enhancement: "active" },
  { module: "module_393", status: "preserved", enhancement: "active" },
  { module: "module_394", status: "preserved", enhancement: "active" },
  { module: "module_395", status: "preserved", enhancement: "active" },
  { module: "module_396", status: "preserved", enhancement: "active" },
  { module: "module_397", status: "preserved", enhancement: "active" },
  { module: "module_398", status: "preserved", enhancement: "active" },
  { module: "module_399", status: "preserved", enhancement: "active" },
  { module: "module_400", status: "preserved", enhancement: "active" },
  { module: "module_401", status: "preserved", enhancement: "active" },
  { module: "module_402", status: "preserved", enhancement: "active" },
  { module: "module_403", status: "preserved", enhancement: "active" },
  { module: "module_404", status: "preserved", enhancement: "active" },
  { module: "module_405", status: "preserved", enhancement: "active" },
  { module: "module_406", status: "preserved", enhancement: "active" },
  { module: "module_407", status: "preserved", enhancement: "active" },
  { module: "module_408", status: "preserved", enhancement: "active" },
  { module: "module_409", status: "preserved", enhancement: "active" },
  { module: "module_410", status: "preserved", enhancement: "active" },
  { module: "module_411", status: "preserved", enhancement: "active" },
  { module: "module_412", status: "preserved", enhancement: "active" },
  { module: "module_413", status: "preserved", enhancement: "active" },
  { module: "module_414", status: "preserved", enhancement: "active" },
  { module: "module_415", status: "preserved", enhancement: "active" },
  { module: "module_416", status: "preserved", enhancement: "active" },
  { module: "module_417", status: "preserved", enhancement: "active" },
  { module: "module_418", status: "preserved", enhancement: "active" },
  { module: "module_419", status: "preserved", enhancement: "active" },
  { module: "module_420", status: "preserved", enhancement: "active" },
  { module: "module_421", status: "preserved", enhancement: "active" },
  { module: "module_422", status: "preserved", enhancement: "active" },
  { module: "module_423", status: "preserved", enhancement: "active" },
  { module: "module_424", status: "preserved", enhancement: "active" },
  { module: "module_425", status: "preserved", enhancement: "active" },
  { module: "module_426", status: "preserved", enhancement: "active" },
  { module: "module_427", status: "preserved", enhancement: "active" },
  { module: "module_428", status: "preserved", enhancement: "active" },
  { module: "module_429", status: "preserved", enhancement: "active" },
  { module: "module_430", status: "preserved", enhancement: "active" },
  { module: "module_431", status: "preserved", enhancement: "active" },
  { module: "module_432", status: "preserved", enhancement: "active" },
  { module: "module_433", status: "preserved", enhancement: "active" },
  { module: "module_434", status: "preserved", enhancement: "active" },
  { module: "module_435", status: "preserved", enhancement: "active" },
  { module: "module_436", status: "preserved", enhancement: "active" },
  { module: "module_437", status: "preserved", enhancement: "active" },
  { module: "module_438", status: "preserved", enhancement: "active" },
  { module: "module_439", status: "preserved", enhancement: "active" },
  { module: "module_440", status: "preserved", enhancement: "active" },
  { module: "module_441", status: "preserved", enhancement: "active" },
  { module: "module_442", status: "preserved", enhancement: "active" },
  { module: "module_443", status: "preserved", enhancement: "active" },
  { module: "module_444", status: "preserved", enhancement: "active" },
  { module: "module_445", status: "preserved", enhancement: "active" },
  { module: "module_446", status: "preserved", enhancement: "active" },
  { module: "module_447", status: "preserved", enhancement: "active" },
  { module: "module_448", status: "preserved", enhancement: "active" },
  { module: "module_449", status: "preserved", enhancement: "active" },
  { module: "module_450", status: "preserved", enhancement: "active" },
  { module: "module_451", status: "preserved", enhancement: "active" },
  { module: "module_452", status: "preserved", enhancement: "active" },
  { module: "module_453", status: "preserved", enhancement: "active" },
  { module: "module_454", status: "preserved", enhancement: "active" },
  { module: "module_455", status: "preserved", enhancement: "active" },
  { module: "module_456", status: "preserved", enhancement: "active" },
  { module: "module_457", status: "preserved", enhancement: "active" },
  { module: "module_458", status: "preserved", enhancement: "active" },
  { module: "module_459", status: "preserved", enhancement: "active" },
  { module: "module_460", status: "preserved", enhancement: "active" },
  { module: "module_461", status: "preserved", enhancement: "active" },
  { module: "module_462", status: "preserved", enhancement: "active" },
  { module: "module_463", status: "preserved", enhancement: "active" },
  { module: "module_464", status: "preserved", enhancement: "active" },
  { module: "module_465", status: "preserved", enhancement: "active" },
  { module: "module_466", status: "preserved", enhancement: "active" },
  { module: "module_467", status: "preserved", enhancement: "active" },
  { module: "module_468", status: "preserved", enhancement: "active" },
  { module: "module_469", status: "preserved", enhancement: "active" },
  { module: "module_470", status: "preserved", enhancement: "active" },
  { module: "module_471", status: "preserved", enhancement: "active" },
  { module: "module_472", status: "preserved", enhancement: "active" },
  { module: "module_473", status: "preserved", enhancement: "active" },
  { module: "module_474", status: "preserved", enhancement: "active" },
  { module: "module_475", status: "preserved", enhancement: "active" },
  { module: "module_476", status: "preserved", enhancement: "active" },
  { module: "module_477", status: "preserved", enhancement: "active" },
  { module: "module_478", status: "preserved", enhancement: "active" },
  { module: "module_479", status: "preserved", enhancement: "active" },
  { module: "module_480", status: "preserved", enhancement: "active" },
  { module: "module_481", status: "preserved", enhancement: "active" },
  { module: "module_482", status: "preserved", enhancement: "active" },
  { module: "module_483", status: "preserved", enhancement: "active" },
  { module: "module_484", status: "preserved", enhancement: "active" },
  { module: "module_485", status: "preserved", enhancement: "active" },
  { module: "module_486", status: "preserved", enhancement: "active" },
  { module: "module_487", status: "preserved", enhancement: "active" },
  { module: "module_488", status: "preserved", enhancement: "active" },
  { module: "module_489", status: "preserved", enhancement: "active" },
  { module: "module_490", status: "preserved", enhancement: "active" },
  { module: "module_491", status: "preserved", enhancement: "active" },
  { module: "module_492", status: "preserved", enhancement: "active" },
  { module: "module_493", status: "preserved", enhancement: "active" },
  { module: "module_494", status: "preserved", enhancement: "active" },
  { module: "module_495", status: "preserved", enhancement: "active" },
  { module: "module_496", status: "preserved", enhancement: "active" },
  { module: "module_497", status: "preserved", enhancement: "active" },
  { module: "module_498", status: "preserved", enhancement: "active" },
  { module: "module_499", status: "preserved", enhancement: "active" },
  { module: "module_500", status: "preserved", enhancement: "active" },
  { module: "module_501", status: "preserved", enhancement: "active" },
  { module: "module_502", status: "preserved", enhancement: "active" },
  { module: "module_503", status: "preserved", enhancement: "active" },
  { module: "module_504", status: "preserved", enhancement: "active" },
  { module: "module_505", status: "preserved", enhancement: "active" },
  { module: "module_506", status: "preserved", enhancement: "active" },
  { module: "module_507", status: "preserved", enhancement: "active" },
  { module: "module_508", status: "preserved", enhancement: "active" },
  { module: "module_509", status: "preserved", enhancement: "active" },
  { module: "module_510", status: "preserved", enhancement: "active" },
  { module: "module_511", status: "preserved", enhancement: "active" },
  { module: "module_512", status: "preserved", enhancement: "active" },
  { module: "module_513", status: "preserved", enhancement: "active" },
  { module: "module_514", status: "preserved", enhancement: "active" },
  { module: "module_515", status: "preserved", enhancement: "active" },
  { module: "module_516", status: "preserved", enhancement: "active" },
  { module: "module_517", status: "preserved", enhancement: "active" },
  { module: "module_518", status: "preserved", enhancement: "active" },
  { module: "module_519", status: "preserved", enhancement: "active" },
  { module: "module_520", status: "preserved", enhancement: "active" },
  { module: "module_521", status: "preserved", enhancement: "active" },
  { module: "module_522", status: "preserved", enhancement: "active" },
  { module: "module_523", status: "preserved", enhancement: "active" },
  { module: "module_524", status: "preserved", enhancement: "active" },
  { module: "module_525", status: "preserved", enhancement: "active" },
  { module: "module_526", status: "preserved", enhancement: "active" },
  { module: "module_527", status: "preserved", enhancement: "active" },
  { module: "module_528", status: "preserved", enhancement: "active" },
  { module: "module_529", status: "preserved", enhancement: "active" },
  { module: "module_530", status: "preserved", enhancement: "active" },
  { module: "module_531", status: "preserved", enhancement: "active" },
  { module: "module_532", status: "preserved", enhancement: "active" },
  { module: "module_533", status: "preserved", enhancement: "active" },
  { module: "module_534", status: "preserved", enhancement: "active" },
  { module: "module_535", status: "preserved", enhancement: "active" },
  { module: "module_536", status: "preserved", enhancement: "active" },
  { module: "module_537", status: "preserved", enhancement: "active" },
  { module: "module_538", status: "preserved", enhancement: "active" },
  { module: "module_539", status: "preserved", enhancement: "active" },
  { module: "module_540", status: "preserved", enhancement: "active" },
  { module: "module_541", status: "preserved", enhancement: "active" },
  { module: "module_542", status: "preserved", enhancement: "active" },
  { module: "module_543", status: "preserved", enhancement: "active" },
  { module: "module_544", status: "preserved", enhancement: "active" },
  { module: "module_545", status: "preserved", enhancement: "active" },
  { module: "module_546", status: "preserved", enhancement: "active" },
  { module: "module_547", status: "preserved", enhancement: "active" },
  { module: "module_548", status: "preserved", enhancement: "active" },
  { module: "module_549", status: "preserved", enhancement: "active" },
  { module: "module_550", status: "preserved", enhancement: "active" },
  { module: "module_551", status: "preserved", enhancement: "active" },
  { module: "module_552", status: "preserved", enhancement: "active" },
  { module: "module_553", status: "preserved", enhancement: "active" },
  { module: "module_554", status: "preserved", enhancement: "active" },
  { module: "module_555", status: "preserved", enhancement: "active" },
  { module: "module_556", status: "preserved", enhancement: "active" },
  { module: "module_557", status: "preserved", enhancement: "active" },
  { module: "module_558", status: "preserved", enhancement: "active" },
  { module: "module_559", status: "preserved", enhancement: "active" },
  { module: "module_560", status: "preserved", enhancement: "active" },
  { module: "module_561", status: "preserved", enhancement: "active" },
  { module: "module_562", status: "preserved", enhancement: "active" },
  { module: "module_563", status: "preserved", enhancement: "active" },
  { module: "module_564", status: "preserved", enhancement: "active" },
  { module: "module_565", status: "preserved", enhancement: "active" },
  { module: "module_566", status: "preserved", enhancement: "active" },
  { module: "module_567", status: "preserved", enhancement: "active" },
  { module: "module_568", status: "preserved", enhancement: "active" },
  { module: "module_569", status: "preserved", enhancement: "active" },
  { module: "module_570", status: "preserved", enhancement: "active" },
  { module: "module_571", status: "preserved", enhancement: "active" },
  { module: "module_572", status: "preserved", enhancement: "active" },
  { module: "module_573", status: "preserved", enhancement: "active" },
  { module: "module_574", status: "preserved", enhancement: "active" },
  { module: "module_575", status: "preserved", enhancement: "active" },
  { module: "module_576", status: "preserved", enhancement: "active" },
  { module: "module_577", status: "preserved", enhancement: "active" },
  { module: "module_578", status: "preserved", enhancement: "active" },
  { module: "module_579", status: "preserved", enhancement: "active" },
  { module: "module_580", status: "preserved", enhancement: "active" },
  { module: "module_581", status: "preserved", enhancement: "active" },
  { module: "module_582", status: "preserved", enhancement: "active" },
  { module: "module_583", status: "preserved", enhancement: "active" },
  { module: "module_584", status: "preserved", enhancement: "active" },
  { module: "module_585", status: "preserved", enhancement: "active" },
  { module: "module_586", status: "preserved", enhancement: "active" },
  { module: "module_587", status: "preserved", enhancement: "active" },
  { module: "module_588", status: "preserved", enhancement: "active" },
  { module: "module_589", status: "preserved", enhancement: "active" },
  { module: "module_590", status: "preserved", enhancement: "active" },
  { module: "module_591", status: "preserved", enhancement: "active" },
  { module: "module_592", status: "preserved", enhancement: "active" },
  { module: "module_593", status: "preserved", enhancement: "active" },
  { module: "module_594", status: "preserved", enhancement: "active" },
  { module: "module_595", status: "preserved", enhancement: "active" },
  { module: "module_596", status: "preserved", enhancement: "active" },
  { module: "module_597", status: "preserved", enhancement: "active" },
  { module: "module_598", status: "preserved", enhancement: "active" },
  { module: "module_599", status: "preserved", enhancement: "active" },
  { module: "module_600", status: "preserved", enhancement: "active" },
];
