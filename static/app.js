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
    if (byId("sqrNavbar")) return;
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
    const html = `
      <nav id="sqrNavbar" class="sqr-navbar">
        <a href="${admin ? route("admin") : route("home")}" class="sqr-brand" aria-label="SQR Home">
          <span>SQR</span><small>Skill Quest Road</small>
        </a>
        <button class="sqr-menu-btn" type="button" data-sqr-menu>☰</button>
        <div class="sqr-nav-links">
          ${links.map(([label, href]) => `<a href="${href}">${escapeHtml(label)}</a>`).join("")}
        </div>
        <div class="sqr-nav-actions">
          ${logged ? `<span class="sqr-nav-user">${escapeHtml(user.name || "User")}</span><button class="btn btn-danger" type="button" data-sqr-logout>Logout</button>` : `<a class="btn btn-soft" href="${route("signin")}">Sign In</a><a class="btn btn-primary" href="${route("signup")}">Sign Up</a>`}
        </div>
      </nav>`;
    if (document.body) document.body.insertAdjacentHTML("afterbegin", html);
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
      const response = await fetch(`${API}/api/ats/export/${format}`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ resume }) });
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
