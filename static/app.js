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

  const PAGES = {
    home: "gp.html",
    index: "gp.html",
    specializations: "Specialization.html",
    specialization: "Specialization.html",
    courses: "Courses.html",
    course: "Courses.html",
    quiz: "Quiz.html",
    quizzes: "Quiz.html",
    ats: "ATS.html",
    jobs: "jobs.html",
    jobDetails: "JobDetails.html",
    recommendation: "recommendation.html",
    profile: "profile.html",
    admin: "admin.html",
    signin: "signin.html",
    signup: "signup.html"
  };

  const PUBLIC_PAGES = new Set(["", "index.html", "gp.html", "signin.html", "signup.html"]);
  const STATE = {
    specializations: [],
    courses: [],
    jobs: [],
    certificates: [],
    quizzes: [],
    users: [],
    lastResume: "",
    loading: false
  };

  function pageName() {
    return window.location.pathname.split("/").pop() || "gp.html";
  }

  function pageKey() {
    return pageName().toLowerCase();
  }

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value === undefined || value === null ? "" : value).trim();
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function number(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback || 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function percent(value) {
    return clamp(Math.round(number(value, 0)), 0, 100);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function pick(object, keys, fallback) {
    for (const key of keys) {
      if (object && object[key] !== undefined && object[key] !== null && object[key] !== "") return object[key];
    }
    return fallback === undefined ? "" : fallback;
  }

  function itemId(item) {
    return pick(item, ["id", "user_id", "specialization_id", "spec_id", "course_id", "job_id", "quiz_id", "certificate_id", "attempt_id"], "");
  }

  function asArray(result, keys) {
    if (Array.isArray(result)) return result;
    if (!result || typeof result !== "object") return [];
    for (const key of keys || []) {
      if (Array.isArray(result[key])) return result[key];
    }
    if (Array.isArray(result.data)) return result.data;
    if (Array.isArray(result.items)) return result.items;
    return [];
  }

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function param(name) {
    return params().get(name);
  }

  function route(name, data) {
    const base = PAGES[name] || name || "#";
    const query = new URLSearchParams();
    Object.entries(data || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  }

  function go(url) {
    if (!url || url === "#") return;
    window.location.href = url;
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

  function roleOf(user) {
    return lower((user && user.role) || "student");
  }

  function modeOf(user) {
    return lower((user && (user.current_mode || user.mode || user.role)) || "student");
  }

  function isAdminUser() {
    return roleOf(getUser()) === "admin";
  }

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
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { message: text };
      }
    }
    if (!response.ok) {
      const err = new Error(data.error || data.message || `Request failed (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function isPublicPage() {
    return PUBLIC_PAGES.has(pageKey());
  }

  async function api(path, options) {
    const config = Object.assign({ method: "GET" }, options || {});
    const isForm = config.body instanceof FormData;
    config.headers = authHeaders(config.headers);
    if (config.body && !isForm && typeof config.body !== "string") {
      config.body = JSON.stringify(config.body);
    }
    if (config.body && !isForm) {
      config.headers["Content-Type"] = config.headers["Content-Type"] || "application/json";
    }
    const response = await fetch(/^https?:\/\//i.test(path) ? path : `${API}${path}`, config);
    if (response.status === 401) {
      if (!isPublicPage()) {
        clearAuth();
        setTimeout(() => go(route("signin")), 450);
      }
    }
    return parseResponse(response);
  }

  async function apiAny(paths, options) {
    let lastError = null;
    for (const path of paths) {
      try {
        return await api(path, options || {});
      } catch (err) {
        lastError = err;
        if (![404, 405].includes(err.status)) throw err;
      }
    }
    throw lastError || new Error("Request failed");
  }

  function asset(value) {
    const v = clean(value);
    if (!v) return "";
    if (/^https?:\/\//i.test(v) || v.startsWith("data:")) return v;
    if (v.startsWith("/")) return API + v;
    if (v.startsWith("uploads/") || v.startsWith("static/")) return `${API}/${v}`;
    return `${API}/uploads/${encodeURIComponent(v)}`;
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

  function toFormData(data) {
    const fd = new FormData();
    Object.entries(data || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      if (Array.isArray(value) || (typeof value === "object" && !(value instanceof File))) {
        fd.append(key, JSON.stringify(value));
      } else {
        fd.append(key, value);
      }
    });
    return fd;
  }

  function hasFiles(form) {
    return qsa("input[type='file']", form).some((input) => input.files && input.files.length > 0);
  }

  function showMessage(message, type) {
    const box = byId("message") || byId("msg") || byId("alert") || byId("formMessage");
    if (!box) return;
    box.textContent = message || "";
    box.className = `message ${type || "info"}`;
    box.style.display = message ? "block" : "none";
    clearTimeout(showMessage.timer);
    if (message) {
      showMessage.timer = setTimeout(() => {
        if (box.textContent === message) box.style.display = "none";
      }, 6500);
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

  function requireLogin() {
    if (getToken()) return true;
    showMessage("Please sign in first.", "error");
    setTimeout(() => go(route("signin")), 600);
    return false;
  }

  function adminGuard() {
    const protectedType = document.body.dataset.protected || "";
    const user = getUser();
    if (protectedType === "student" && !getToken()) {
      setTimeout(() => go(route("signin")), 50);
      return false;
    }
    if (protectedType === "admin" && (!user || roleOf(user) !== "admin")) {
      go(route("home"));
      return false;
    }
    if (user && isAdminMode() && protectedType === "student") {
      go(route("admin"));
      return false;
    }
    return true;
  }

  function navbar() {
    if (byId("sqrNavbar")) return;
    const user = getUser();
    const logged = Boolean(user && getToken());
    const admin = logged && isAdminMode();
    const links = admin
      ? [["Admin", route("admin")]]
      : [
          ["Home", route("home")],
          ["Specializations", route("specializations")],
          ["Courses", route("courses")],
          ["ATS", route("ats")],
          ["Jobs", route("jobs")],
          ["Recommendation", route("recommendation")],
          ...(logged ? [["Profile", route("profile")]] : [])
        ];
    const current = pageKey();
    const html = `
      <header id="sqrNavbar" class="sqr-navbar">
        <a href="${escapeAttr(admin ? route("admin") : route("home"))}" class="brand" aria-label="SQR Home">
          <strong>SQR</strong><span>${admin ? "Admin Panel" : "Skill Quest Road"}</span>
        </a>
        <button class="menu-toggle" type="button" data-menu-toggle aria-label="Open menu">☰</button>
        <nav class="nav-links">
          ${links.map(([label, href]) => `<a href="${escapeAttr(href)}" class="${current === href.toLowerCase() ? "active" : ""}">${escapeHtml(label)}</a>`).join("")}
        </nav>
        <div class="nav-actions">
          ${logged ? `
            <span class="nav-user">${escapeHtml(user.name || "User")}</span>
            ${roleOf(user) === "admin" ? `<button class="btn btn-mini btn-secondary" data-switch-mode="${admin ? "student" : "admin"}">${admin ? "Student Mode" : "Admin Mode"}</button>` : ""}
            <button class="btn btn-mini btn-danger" data-logout>Logout</button>
          ` : `
            <a class="btn btn-mini btn-glass" href="${route("signin")}">Sign In</a>
            <a class="btn btn-mini btn-primary" href="${route("signup")}">Sign Up</a>
          `}
        </div>
      </header>`;
    document.body.insertAdjacentHTML("afterbegin", html);
  }

  function badge(text, cls) {
    if (!text) return "";
    return `<span class="${escapeAttr(cls || "badge")}">${escapeHtml(text)}</span>`;
  }

  function button(label, cls, attrs) {
    return `<button type="button" class="${escapeAttr(cls || "btn btn-primary")}" ${attrs || ""}>${escapeHtml(label)}</button>`;
  }

  function link(label, href, cls, attrs) {
    return `<a class="${escapeAttr(cls || "btn btn-primary")}" href="${escapeAttr(href || "#")}" ${attrs || ""}>${escapeHtml(label)}</a>`;
  }

  function media(item, cls) {
    const video = asset(pick(item, ["video_url", "video", "media_url"], ""));
    const image = asset(pick(item, ["image_url", "image", "photo", "thumbnail", "cover"], ""));
    if (video && /\.(mp4|webm|ogg)$/i.test(video)) {
      return `<video class="${escapeAttr(cls || "card-media")}" src="${escapeAttr(video)}" controls preload="metadata" data-track-course="${escapeAttr(itemId(item))}"></video>`;
    }
    if (image) {
      return `<img class="${escapeAttr(cls || "card-media")}" src="${escapeAttr(image)}" alt="${escapeAttr(pick(item, ["title", "name"], "SQR image"))}" loading="lazy">`;
    }
    return `<div class="${escapeAttr(cls || "card-media")} media-placeholder"><span>SQR</span></div>`;
  }

  function progressBar(value, label) {
    const p = percent(value);
    return `
      <div class="progress-block">
        <div class="progress-top"><span>${escapeHtml(label || "Progress")}</span><strong>${p}%</strong></div>
        <div class="progress"><div class="progress-fill" style="width:${p}%"></div></div>
      </div>`;
  }

  function circleStat(value, label) {
    const p = percent(value);
    return `
      <div class="score-circle" style="--score:${p}">
        <div class="score-circle-inner"><strong>${p}%</strong><span>${escapeHtml(label || "Score")}</span></div>
      </div>`;
  }

  function emptyState(title, text, href, label) {
    return `
      <div class="empty-state">
        <div class="empty-icon">✦</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
        ${href ? link(label || "Open", href, "btn btn-primary") : ""}
      </div>`;
  }

  function cardSpecialization(item, options) {
    const id = itemId(item);
    const name = pick(item, ["name", "title"], "Specialization");
    const desc = pick(item, ["description"], "Open this specialization to view courses, jobs, and certificates.");
    return `
      <article class="data-card spec-card clickable" data-link="${escapeAttr(route("specialization", { id }))}">
        ${media(item)}
        <div class="card-body">
          ${badge("Specialization", "badge badge-cyan")}
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(desc)}</p>
          <div class="card-actions">
            ${link("View Details", route("specialization", { id }), "btn btn-secondary")}
            ${options && options.admin ? button("Delete", "btn btn-danger", `data-delete-specialization="${escapeAttr(id)}"`) : ""}
          </div>
        </div>
      </article>`;
  }

  function cardCourse(item, options) {
    const id = itemId(item);
    const title = pick(item, ["title", "name"], "Course");
    const desc = pick(item, ["description"], "Open course content to track progress automatically.");
    const level = pick(item, ["level"], "beginner");
    return `
      <article class="data-card course-card clickable" data-link="${escapeAttr(route("course", { id }))}">
        ${media(item)}
        <div class="card-body">
          <div class="card-tags">${badge(level, `badge level-${escapeAttr(level)}`)}${pick(item, ["specialization_name"], "") ? badge(pick(item, ["specialization_name"], ""), "badge badge-purple") : ""}</div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(desc)}</p>
          <div class="card-actions">
            ${link("Open Course", route("course", { id }), "btn btn-secondary", `data-track-course="${escapeAttr(id)}"`)}
            ${options && options.admin ? button("Delete", "btn btn-danger", `data-delete-course="${escapeAttr(id)}"`) : ""}
          </div>
        </div>
      </article>`;
  }

  function cardJob(item, options) {
    const id = itemId(item);
    const title = pick(item, ["title", "name"], "Job");
    const desc = pick(item, ["description"], "Open this job to review skills and application details.");
    return `
      <article class="data-card job-card clickable" data-link="${escapeAttr(route("jobDetails", { id }))}">
        <div class="job-icon">⌁</div>
        <div class="card-body">
          <div class="card-tags">${badge(pick(item, ["specialization"], "Role"), "badge badge-orange")}${pick(item, ["salary"], "") ? badge(pick(item, ["salary"], ""), "badge badge-green") : ""}</div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(desc)}</p>
          <div class="skill-line">${escapeHtml(pick(item, ["skills", "required_skills"], ""))}</div>
          <div class="card-actions">
            ${link("View Job", route("jobDetails", { id }), "btn btn-secondary")}
            ${options && options.admin ? button("Delete", "btn btn-danger", `data-delete-job="${escapeAttr(id)}"`) : ""}
          </div>
        </div>
      </article>`;
  }

  function cardQuiz(item, options) {
    const id = itemId(item);
    const title = pick(item, ["title", "name"], "Quiz");
    return `
      <article class="data-card quiz-card clickable" data-link="${escapeAttr(route("quiz", { id }))}">
        <div class="quiz-icon">?</div>
        <div class="card-body">
          ${badge(pick(item, ["course_title"], "Course Quiz"), "badge badge-red")}
          <h3>${escapeHtml(title)}</h3>
          <p>Open this quiz and submit answers to update your profile progress.</p>
          <div class="card-actions">
            ${link("Take Quiz", route("quiz", { id }), "btn btn-secondary")}
            ${options && options.admin ? button("Delete", "btn btn-danger", `data-delete-quiz="${escapeAttr(id)}"`) : ""}
          </div>
        </div>
      </article>`;
  }

  async function fetchSpecializations() {
    const result = await api("/api/specializations", { silentUnauthorized: true });
    STATE.specializations = asArray(result, ["specializations"]);
    return STATE.specializations;
  }

  async function fetchCourses(query) {
    const suffix = query ? `?${new URLSearchParams(query)}` : "";
    const result = await api(`/api/courses${suffix}`, { silentUnauthorized: true });
    STATE.courses = asArray(result, ["courses"]);
    return STATE.courses;
  }

  async function fetchJobs(query) {
    const suffix = query ? `?${new URLSearchParams(query)}` : "";
    const result = await api(`/api/jobs${suffix}`, { silentUnauthorized: true });
    STATE.jobs = asArray(result, ["jobs"]);
    return STATE.jobs;
  }

  async function fetchQuizzes(query) {
    const suffix = query ? `?${new URLSearchParams(query)}` : "";
    const result = await api(`/api/quizzes${suffix}`, { silentUnauthorized: true });
    STATE.quizzes = asArray(result, ["quizzes"]);
    return STATE.quizzes;
  }

  async function loadHome() {
    if (!byId("homeSpecializations") && !byId("homeCourses") && !byId("homeJobs")) return;
    try {
      const [specs, courses, jobs] = await Promise.all([fetchSpecializations(), fetchCourses(), fetchJobs()]);
      const specCount = byId("homeSpecCount");
      const courseCount = byId("homeCourseCount");
      const jobCount = byId("homeJobCount");
      if (specCount) specCount.textContent = specs.length;
      if (courseCount) courseCount.textContent = courses.length;
      if (jobCount) jobCount.textContent = jobs.length;
      const specBox = byId("homeSpecializations");
      const courseBox = byId("homeCourses");
      const jobBox = byId("homeJobs");
      if (specBox) specBox.innerHTML = specs.length ? specs.slice(0, 6).map((x) => cardSpecialization(x)).join("") : emptyState("No specializations yet", "When the admin adds specializations, they appear here automatically.", route("admin"), "Open Admin");
      if (courseBox) courseBox.innerHTML = courses.length ? courses.slice(0, 6).map((x) => cardCourse(x)).join("") : emptyState("No courses yet", "Courses added by the admin will appear here.", route("courses"), "Courses");
      if (jobBox) jobBox.innerHTML = jobs.length ? jobs.slice(0, 6).map((x) => cardJob(x)).join("") : emptyState("No jobs yet", "Jobs added by the admin will appear here.", route("jobs"), "Jobs");
    } catch (err) {
      const specBox = byId("homeSpecializations");
      if (specBox) specBox.innerHTML = emptyState("Backend connection problem", err.message || "Could not load database content.");
    }
  }

  async function loadProfile() {
    if (!byId("profileSummary") && !byId("profileProgressBars")) return;
    if (!requireLogin()) return;
    try {
      const result = await api("/api/profile");
      const user = result.user || result || {};
      const summary = byId("profileSummary");
      if (summary) {
        summary.innerHTML = `
          <div class="profile-avatar">${escapeHtml((user.name || "S").slice(0, 1).toUpperCase())}</div>
          <div>
            <h2>${escapeHtml(user.name || "Student")}</h2>
            <p>${escapeHtml(user.email || "")}</p>
            <div class="card-tags">${badge(user.role || "student", "badge badge-cyan")}${badge(user.current_mode || user.role || "student", "badge badge-purple")}</div>
          </div>`;
      }
      const nameInput = byId("profileName");
      const skillsInput = byId("profileSkills");
      const interestsInput = byId("profileInterests");
      const goalInput = byId("profileGoal");
      if (nameInput) nameInput.value = user.name || "";
      if (skillsInput) skillsInput.value = user.skills || "";
      if (interestsInput) interestsInput.value = user.interests || "";
      if (goalInput) goalInput.value = user.goal || "";
      renderProfileHistory(result);
      await loadProfileProgress();
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function renderProfileHistory(result) {
    const quizBox = byId("profileQuizHistory");
    const atsBox = byId("profileAtsHistory");
    const quizzes = asArray(result, ["quiz_history", "quizHistory", "quizzes"]);
    const ats = asArray(result, ["ats_history", "atsHistory", "ats_results"]);
    if (quizBox) {
      quizBox.innerHTML = quizzes.length ? quizzes.map((q) => `
        <article class="history-item">
          ${circleStat(pick(q, ["score_percentage", "score"], 0), "Quiz")}
          <div><h3>${escapeHtml(pick(q, ["quiz_title", "title", "name"], "Quiz"))}</h3><p>${escapeHtml(pick(q, ["course_title"], "Course"))}</p><span>${escapeHtml(pick(q, ["created_at"], ""))}</span></div>
        </article>`).join("") : emptyState("No quiz attempts yet", "Take a quiz from a course to show results here.", route("quiz"), "Open Quizzes");
    }
    if (atsBox) {
      atsBox.innerHTML = ats.length ? ats.map((a) => `
        <article class="history-item">
          ${circleStat(pick(a, ["score", "ats_score"], 0), "ATS")}
          <div><h3>${escapeHtml(pick(a, ["target_job", "role"], "ATS Result"))}</h3><p>${escapeHtml(pick(a, ["summary", "feedback"], ""))}</p><span>${escapeHtml(pick(a, ["created_at"], ""))}</span></div>
        </article>`).join("") : emptyState("No ATS results yet", "Upload a resume in the ATS page to save your first result.", route("ats"), "Open ATS");
    }
  }

  async function loadProfileProgress() {
    const box = byId("profileProgressBars");
    if (!box) return;
    try {
      const result = await api("/api/profile/progress");
      const progress = asArray(result, ["progress"]);
      if (!progress.length) {
        box.innerHTML = emptyState("No progress yet", "Open course content and complete quizzes to create real progress.", route("courses"), "Browse Courses");
        return;
      }
      box.innerHTML = progress.map((item) => {
        const p = percent(pick(item, ["progress", "percentage"], 0));
        return `
          <article class="profile-progress-item">
            <div class="progress-head">
              <div><h3>${escapeHtml(pick(item, ["specialization_name", "name"], "Specialization"))}</h3><p>${number(item.opened_courses)} opened courses / ${number(item.total_courses)} total courses</p></div>
              <strong>${p}%</strong>
            </div>
            ${progressBar(p, "Real progress")}
            <div class="progress-meta"><span>Completed quizzes: ${number(item.completed_quizzes)}</span><span>Average quiz score: ${percent(item.average_quiz_score)}%</span></div>
          </article>`;
      }).join("");
    } catch (err) {
      box.innerHTML = emptyState("Progress could not load", err.message || "Check the backend route /api/profile/progress.");
    }
  }

  function setupProfileForm() {
    const form = byId("profileForm");
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = form.querySelector("button[type='submit']");
      try {
        setLoading(btn, true, "Saving...");
        const data = formDataObject(form);
        const result = await api("/api/profile", { method: "PUT", body: data });
        if (result.user) setAuth(getToken(), result.user);
        showMessage("Profile updated", "success");
        await loadProfile();
      } catch (err) {
        showMessage(err.message, "error");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  async function loadSpecializations() {
    const box = byId("specializationsBox");
    if (!box) return;
    try {
      const specs = await fetchSpecializations();
      box.innerHTML = specs.length ? specs.map((x) => cardSpecialization(x)).join("") : emptyState("No specializations", "Admin-added specializations will appear here.");
    } catch (err) {
      box.innerHTML = emptyState("Could not load specializations", err.message);
    }
  }

async function loadSpecializationDetails() {
  const box = byId("specializationDetails");
  const id = param("id") || param("specialization_id") || param("spec_id");

  if (!box || !id) return;

  try {
    const result = await api(`/api/specializations/${encodeURIComponent(id)}`);

    const spec = result.specialization || result;
    const courses = asArray(result, ["courses"]);
    const jobs = asArray(result, ["jobs"]);
    const certificates = asArray(result, ["certificates", "certifications"]);

    const sid =
      itemId(spec) ||
      spec.specialization_id ||
      spec.id ||
      id;

    const isLoggedIn = Boolean(
      (typeof token === "function" && token()) ||
      (typeof getToken === "function" && getToken()) ||
      localStorage.getItem("sqr_token") ||
      localStorage.getItem("token")
    );

    box.innerHTML = `
      <article class="details-card gradient-card">
        ${media(spec, "details-media")}

        <div class="details-content">
          ${badge("Specialization", "badge badge-cyan")}

          <h2>${escapeHtml(pick(spec, ["name", "title"], "Specialization"))}</h2>

          <p>${escapeHtml(pick(spec, ["description", "overview"], ""))}</p>

          ${
            pick(spec, ["skills"], "")
              ? `<div class="skill-line">${escapeHtml(pick(spec, ["skills"], ""))}</div>`
              : ""
          }

          ${
            pick(spec, ["roadmap"], "")
              ? `
                <div class="skill-line">
                  <strong>Roadmap:</strong>
                  ${escapeHtml(pick(spec, ["roadmap"], ""))}
                </div>
              `
              : ""
          }

          <div class="details-actions">
            ${
              isLoggedIn
                ? `
                  <button type="button" class="btn btn-primary" data-enroll-specialization="${escapeAttr(sid)}">
                    Enroll Specialization
                  </button>

                  <button type="button" class="btn btn-danger" data-unenroll-specialization="${escapeAttr(sid)}">
                    Unenroll
                  </button>
                `
                : `<a class="btn btn-primary" href="signin.html">Sign In to Enroll</a>`
            }

            <a class="btn btn-secondary" href="Courses.html?specialization_id=${escapeAttr(sid)}">
              View Courses
            </a>

            <a class="btn btn-secondary" href="jobs.html?specialization_id=${escapeAttr(sid)}">
              View Jobs
            </a>
          </div>
        </div>
      </article>

      <div class="details-split">
        <section>
          <h2>Linked courses</h2>
          <div class="grid cards-2">
            ${
              courses.length
                ? courses.map((x) => cardCourse(x)).join("")
                : emptyState("No courses", "Courses for this specialization will appear here.")
            }
          </div>
        </section>

        <section>
          <h2>Certificates</h2>
          <div class="mini-list colored-list">
            ${
              certificates.length
                ? certificates.map((c) => `
                    <article>
                      <strong>${escapeHtml(c.name || c.title || "Certificate")}</strong>
                      <p>${escapeHtml(c.description || "")}</p>
                      ${
                        c.link || c.url
                          ? link("Open", c.link || c.url, "btn btn-mini btn-secondary", 'target="_blank" rel="noopener"')
                          : ""
                      }
                    </article>
                  `).join("")
                : `<p class="muted">No certificates yet.</p>`
            }
          </div>
        </section>

        <section>
          <h2>Related jobs</h2>
          <div class="grid cards-2">
            ${
              jobs.length
                ? jobs.map((x) => cardJob(x)).join("")
                : emptyState("No jobs", "Jobs for this specialization will appear here.")
            }
          </div>
        </section>
      </div>
    `;
  } catch (err) {
    box.innerHTML = emptyState("Specialization not found", err.message);
  }
}

  async function loadCourses() {
    const box = byId("coursesBox");
    if (!box) return;
    try {
      const query = {};
      if (param("spec_id")) query.spec_id = param("spec_id");
      if (param("specialization_id")) query.specialization_id = param("specialization_id");
      const courses = await fetchCourses(query);
      box.innerHTML = courses.length ? courses.map((x) => cardCourse(x)).join("") : emptyState("No courses", "Courses added by the admin will appear here.");
    } catch (err) {
      box.innerHTML = emptyState("Could not load courses", err.message);
    }
  }

  async function loadCourseDetails() {
    const box = byId("courseDetails");
    const id = param("id") || param("course_id");
    if (!box || !id) return;
    try {
      if (getToken()) await trackCourseOpened(id, false);
      const result = await api(`/api/courses/${encodeURIComponent(id)}`);
      const course = result.course || result;
      const quizzes = asArray(result, ["quizzes"]);
      const linkUrl = pick(course, ["link", "course_link"], "");
      box.innerHTML = `
        <article class="details-card gradient-card course-detail-card">
          ${media(course, "details-media")}
          <div class="details-content">
            <div class="card-tags">${badge(pick(course, ["level"], "beginner"), `badge level-${escapeAttr(pick(course, ["level"], "beginner"))}`)}${badge(pick(course, ["specialization_name"], "Course"), "badge badge-purple")}</div>
            <h2>${escapeHtml(pick(course, ["title", "name"], "Course"))}</h2>
            <p>${escapeHtml(pick(course, ["description"], ""))}</p>
            <div class="details-actions">
              ${linkUrl ? link("Open Learning Link", linkUrl, "btn btn-primary", `target="_blank" rel="noopener" data-track-course="${escapeAttr(itemId(course))}"`) : ""}
              ${quizzes.length ? link("Take Quiz", route("quiz", { id: itemId(quizzes[0]) }), "btn btn-secondary") : ""}
            </div>
          </div>
        </article>
        <section class="section-block"><h2>Course quizzes</h2><div class="grid cards-3">${quizzes.length ? quizzes.map((q) => cardQuiz(q)).join("") : emptyState("No quizzes yet", "The admin can add quizzes for this course.")}</div></section>`;
      bindCourseMediaTracking();
    } catch (err) {
      box.innerHTML = emptyState("Course not found", err.message);
    }
  }

  async function trackCourseOpened(courseId, show) {
    if (!courseId || !getToken()) return;
    try {
      await api(`/api/courses/${encodeURIComponent(courseId)}/open`, { method: "POST", body: { opened: true }, redirectOnUnauthorized: false });
      if (show) showMessage("Course progress saved", "success");
    } catch (err) {
      if (show) showMessage(err.message, "error");
    }
  }

  function bindCourseMediaTracking() {
    qsa("video[data-track-course]").forEach((video) => {
      if (video.dataset.boundTrack) return;
      video.dataset.boundTrack = "1";
      video.addEventListener("play", () => trackCourseOpened(video.dataset.trackCourse, true), { once: true });
      video.addEventListener("ended", () => trackCourseOpened(video.dataset.trackCourse, true));
    });
  }

  async function loadQuizPage() {
    const listBox = byId("quizzesBox");
    const detailsBox = byId("quizDetails");
    const id = param("id") || param("quiz_id");
    if (detailsBox && id) {
      await loadQuizDetails(id);
      return;
    }
    if (!listBox) return;
    try {
      const query = {};
      if (param("course_id")) query.course_id = param("course_id");
      const quizzes = await fetchQuizzes(query);
      listBox.innerHTML = quizzes.length ? quizzes.map((x) => cardQuiz(x)).join("") : emptyState("No quizzes", "Quizzes added by the admin will appear here.");
    } catch (err) {
      listBox.innerHTML = emptyState("Could not load quizzes", err.message);
    }
  }

  async function loadQuizDetails(id) {
    const box = byId("quizDetails");
    if (!box) return;
    try {
      const result = await api(`/api/quizzes/${encodeURIComponent(id)}`);
      const quiz = result.quiz || {};
      const questions = asArray(result, ["questions"]);
      box.innerHTML = `
        <form id="quizSubmitForm" class="card quiz-form" data-quiz-id="${escapeAttr(itemId(quiz))}">
          <div class="section-heading left-heading compact-heading">
            <span>Quiz</span><h2>${escapeHtml(pick(quiz, ["title", "name"], "Quiz"))}</h2><p>${escapeHtml(pick(quiz, ["course_title"], ""))}</p>
          </div>
          ${questions.length ? questions.map((question, index) => {
            const qid = itemId(question);
            const options = Array.isArray(question.options) ? question.options : [question.option1, question.option2, question.option3, question.option4];
            return `
              <fieldset class="question-card">
                <legend>${index + 1}. ${escapeHtml(pick(question, ["question", "question_text"], "Question"))}</legend>
                ${options.map((opt, optIndex) => opt ? `<label class="option-row"><input type="radio" name="q_${escapeAttr(qid)}" value="${escapeAttr(String.fromCharCode(65 + optIndex))}" required><span>${escapeHtml(opt)}</span></label>` : "").join("")}
              </fieldset>`;
          }).join("") : `<p class="muted">No questions were added to this quiz.</p>`}
          ${questions.length ? `<button class="btn btn-primary" type="submit">Submit Quiz</button>` : ""}
        </form>
        <section id="quizResult" class="result-area hidden"></section>`;
    } catch (err) {
      box.innerHTML = emptyState("Quiz not found", err.message);
    }
  }

  function bindQuizForms() {
    document.addEventListener("submit", async (event) => {
      const form = event.target.closest("#quizSubmitForm");
      if (!form) return;
      event.preventDefault();
      if (!requireLogin()) return;
      const quizId = form.dataset.quizId;
      const answers = {};
      qsa("input[type='radio']:checked", form).forEach((input) => {
        const qid = input.name.replace(/^q_/, "");
        answers[qid] = input.value;
      });
      const buttonEl = form.querySelector("button[type='submit']");
      try {
        setLoading(buttonEl, true, "Submitting...");
        const result = await api(`/api/quizzes/${encodeURIComponent(quizId)}/submit`, { method: "POST", body: { answers } });
        const box = byId("quizResult");
        if (box) {
          box.classList.remove("hidden");
          box.innerHTML = `<article class="card colorful-card result-card">${circleStat(result.score_percentage || result.score || 0, "Quiz Score")}<div><h2>Quiz submitted</h2><p>You scored ${escapeHtml(result.score || 0)} out of ${escapeHtml(result.total || 0)}.</p><a class="btn btn-secondary" href="profile.html">Open Profile Progress</a></div></article>`;
        }
        showMessage("Quiz submitted successfully", "success");
      } catch (err) {
        showMessage(err.message, "error");
      } finally {
        setLoading(buttonEl, false);
      }
    });
  }

  async function loadJobs() {
    const box = byId("jobsBox");
    if (!box) return;
    try {
      const query = {};
      if (param("specialization_id")) query.specialization_id = param("specialization_id");
      const jobs = await fetchJobs(query);
      box.innerHTML = jobs.length ? jobs.map((x) => cardJob(x)).join("") : emptyState("No jobs", "Jobs added by the admin will appear here.");
    } catch (err) {
      box.innerHTML = emptyState("Could not load jobs", err.message);
    }
  }

  async function loadJobDetails() {
    const box = byId("jobDetails");
    const id = param("id") || param("job_id");
    if (!box || !id) return;
    try {
      const result = await api(`/api/jobs/${encodeURIComponent(id)}`);
      const job = result.job || result;
      box.innerHTML = `
        <article class="details-card gradient-card">
          <div class="job-detail-icon">⌁</div>
          <div class="details-content">
            <div class="card-tags">${badge(pick(job, ["specialization"], "Job"), "badge badge-orange")}${pick(job, ["salary"], "") ? badge(pick(job, ["salary"], ""), "badge badge-green") : ""}</div>
            <h2>${escapeHtml(pick(job, ["title"], "Job"))}</h2>
            <p>${escapeHtml(pick(job, ["description"], ""))}</p>
            <h3>Required skills</h3><p class="skill-line strong-line">${escapeHtml(pick(job, ["skills", "required_skills"], ""))}</p>
            <div class="details-actions">${pick(job, ["link", "job_link"], "") ? link("Open Application", pick(job, ["link", "job_link"], "#"), "btn btn-primary", 'target="_blank" rel="noopener"') : ""}${link("Run Recommendation", route("recommendation"), "btn btn-secondary")}</div>
          </div>
        </article>`;
    } catch (err) {
      box.innerHTML = emptyState("Job not found", err.message);
    }
  }

  function setupSignin() {
    const form = byId("signinForm");
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = form.querySelector("button[type='submit']");
      try {
        setLoading(btn, true, "Signing in...");
        const result = await api("/api/signin", { method: "POST", body: formDataObject(form) });
        setAuth(result.token, result.user);
        showMessage("Signed in successfully", "success");
        setTimeout(() => go(result.user && result.user.role === "admin" && result.user.current_mode !== "student" ? route("admin") : route("profile")), 400);
      } catch (err) {
        showMessage(err.message, "error");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function setupSignup() {
    const form = byId("signupForm");
    const password = byId("password");
    if (password) {
      password.addEventListener("input", () => updatePasswordRules(password.value));
      updatePasswordRules(password.value);
    }
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = form.querySelector("button[type='submit']");
      try {
        setLoading(btn, true, "Creating...");
        const data = formDataObject(form);
        const result = await api("/api/signup", { method: "POST", body: data });
        setAuth(result.token, result.user);
        showMessage("Account created", "success");
        setTimeout(() => go(route("profile")), 450);
      } catch (err) {
        showMessage(err.message, "error");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function updatePasswordRules(password) {
    const rules = {
      lengthCheck: password.length >= 8,
      upperCheck: /[A-Z]/.test(password),
      lowerCheck: /[a-z]/.test(password),
      numberCheck: /[0-9]/.test(password),
      specialCheck: /[^A-Za-z0-9]/.test(password)
    };
    Object.entries(rules).forEach(([id, ok]) => {
      const el = byId(id);
      if (!el) return;
      el.classList.toggle("valid", ok);
    });
  }

  function setupATS() {
    setupAtsChecker();
    setupAtsGenerator();
  }

  function setupAtsChecker() {
    const form = byId("atsCheckForm");
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const btn = form.querySelector("button[type='submit']");
      const resultBox = byId("atsResult");
      try {
        setLoading(btn, true, "Checking...");
        if (resultBox) {
          resultBox.classList.remove("hidden");
          resultBox.innerHTML = `<article class="card colorful-card"><h2>Checking resume...</h2><p>SQR is reading your uploaded resume file.</p></article>`;
        }
        const result = await api("/api/ats/check", { method: "POST", body: new FormData(form) });
        renderAtsResult(result);
        showMessage("ATS check completed", "success");
      } catch (err) {
        showMessage(err.message, "error");
        if (resultBox) resultBox.innerHTML = "";
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function renderAtsResult(result) {
    const box = byId("atsResult");
    if (!box) return;
    const score = percent(pick(result, ["ats_score", "score"], 0));
    const matched = asArray(result.matched_keywords || [], []);
    const missing = asArray(result.missing_keywords || [], []);
    const strengths = asArray(result.strengths || [], []);
    const weaknesses = asArray(result.weaknesses || [], []);
    const improvements = asArray(result.improvements || [], []);
    box.classList.remove("hidden");
    box.innerHTML = `
      <article class="card colorful-card ats-result-card">
        ${circleStat(score, "ATS Score")}
        <div>
          <h2>ATS Analysis</h2>
          <p>${escapeHtml(result.summary || result.feedback || "ATS analysis completed.")}</p>
          <div class="keyword-columns">
            <section><h3>Matched keywords</h3><p>${matched.length ? matched.map(escapeHtml).join(", ") : "No matched keywords found."}</p></section>
            <section><h3>Missing keywords</h3><p>${missing.length ? missing.map(escapeHtml).join(", ") : "No missing keywords found."}</p></section>
          </div>
          <div class="result-list"><h3>Strengths</h3><ul>${strengths.length ? strengths.map((x) => `<li>${escapeHtml(x)}</li>`).join("") : "<li>Resume file was readable.</li>"}</ul></div>
          <div class="result-list"><h3>Weaknesses</h3><ul>${weaknesses.length ? weaknesses.map((x) => `<li>${escapeHtml(x)}</li>`).join("") : "<li>No major weaknesses returned.</li>"}</ul></div>
          <div class="result-list"><h3>Improvements</h3><ul>${improvements.length ? improvements.map((x) => `<li>${escapeHtml(x)}</li>`).join("") : "<li>Add measurable achievements and role keywords.</li>"}</ul></div>
        </div>
      </article>`;
  }

  function setupAtsGenerator() {
    const form = byId("atsGenerateForm");
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const btn = form.querySelector("button[type='submit']");
      try {
        setLoading(btn, true, "Generating...");
        const result = await api("/api/ats/generate", { method: "POST", body: formDataObject(form) });
        STATE.lastResume = result.resume || "";
        renderGeneratedResume(result);
        showMessage("ATS resume generated", "success");
      } catch (err) {
        showMessage(err.message, "error");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function renderGeneratedResume(result) {
    const box = byId("generatedResume");
    if (!box) return;
    box.classList.remove("hidden");
    const resume = result.resume || "No resume returned from backend.";
    box.innerHTML = `
      <article class="card colorful-card resume-preview">
        <div class="resume-head"><h2>Generated ATS Resume</h2>${circleStat(result.ats_score || 0, "ATS")}</div>
        ${result.enhanced_summary ? `<h3>Enhanced Summary</h3><p>${escapeHtml(result.enhanced_summary)}</p>` : ""}
        <pre class="resume-text">${escapeHtml(resume)}</pre>
        <div class="details-actions"><button type="button" class="btn btn-secondary" data-copy-resume>Copy</button><button type="button" class="btn btn-primary" data-export-pdf>Export PDF</button><button type="button" class="btn btn-primary" data-export-docx>Export DOCX</button></div>
      </article>`;
  }

  async function exportResume(kind) {
    const resume = STATE.lastResume || clean(qs(".resume-text") && qs(".resume-text").textContent);
    if (!resume) {
      showMessage("Generate a resume first", "error");
      return;
    }
    try {
      const response = await fetch(`${API}/api/ats/export/${kind}`, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
        body: JSON.stringify({ resume })
      });
      if (!response.ok) {
        const err = await parseResponse(response);
        throw new Error(err.error || "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "pdf" ? "sqr_resume.pdf" : "sqr_resume.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function setupRecommendation() {
    const form = byId("recommendationForm");
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const btn = form.querySelector("button[type='submit']");
      const box = byId("recommendationResult");
      try {
        setLoading(btn, true, "Analyzing...");
        if (box) {
          box.classList.remove("hidden");
          box.innerHTML = `<article class="card colorful-card"><h2>Analyzing your answers...</h2><p>SQR is comparing your answers with database specializations and jobs.</p></article>`;
        }
        const result = await api("/api/recommendations", { method: "POST", body: formDataObject(form) });
        renderRecommendation(result);
      } catch (err) {
        showMessage(err.message, "error");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function renderRecommendation(result) {
    const box = byId("recommendationResult");
    if (!box) return;
    const specs = asArray(result, ["recommended_specializations", "specializations"]);
    const jobs = asArray(result, ["recommended_jobs", "jobs"]);
    const roadmap = asArray(result.roadmap || [], []);
    box.classList.remove("hidden");
    box.innerHTML = `
      <article class="card colorful-card recommendation-card">
        <h2>Recommendation Result</h2>
        <p>${escapeHtml(result.summary || result.reason || "SQR created recommendations from your answers and the database.")}</p>
      </article>
      <section class="section-block"><h2>Recommended Specializations</h2><div class="grid cards-3">${specs.length ? specs.map((s) => `<article class="mini-match-card"><h3>${escapeHtml(s.name || s.title || "Specialization")}</h3>${circleStat(s.match_percentage || s.score || 0, "Match")}<p>${escapeHtml(s.reason || "Matched your answers.")}</p>${s.id ? link("Open", route("specialization", { id: s.id }), "btn btn-secondary") : ""}</article>`).join("") : emptyState("No specialization matches", "Add more specializations or write more detail.")}</div></section>
      <section class="section-block"><h2>Recommended Jobs</h2><div class="grid cards-3">${jobs.length ? jobs.map((j) => `<article class="mini-match-card"><h3>${escapeHtml(j.title || j.name || "Job")}</h3>${circleStat(j.match_percentage || j.score || 0, "Match")}<p>${escapeHtml(j.reason || "Matched your skills.")}</p>${j.id ? link("Open", route("jobDetails", { id: j.id }), "btn btn-secondary") : ""}</article>`).join("") : emptyState("No job matches", "Add jobs in admin or write more skills.")}</div></section>
      <section class="card colorful-card"><h2>Roadmap</h2><ol class="roadmap-list">${roadmap.length ? roadmap.map((x) => `<li>${escapeHtml(x)}</li>`).join("") : "<li>Choose a specialization.</li><li>Complete linked courses.</li><li>Take quizzes.</li><li>Use ATS tools.</li>"}</ol></section>`;
  }

  async function loadAdmin() {
    if (!document.body.classList.contains("admin-body")) return;
    if (!isAdminUser()) return;
    await Promise.allSettled([loadAdminStats(), loadAdminData(), loadAdminUsers()]);
    setupAdminForms();
    setupAdminTabs();
  }

  async function loadAdminStats() {
    const box = byId("adminStatsBox");
    if (!box) return;
    try {
      const stats = await api("/api/admin/stats");
      box.innerHTML = [
        ["Users", stats.users, "cyan"],
        ["Specializations", stats.specializations, "purple"],
        ["Courses", stats.courses, "green"],
        ["Jobs", stats.jobs, "orange"],
        ["Quizzes", stats.quizzes, "red"],
        ["Certificates", stats.certificates, "blue"]
      ].map(([label, value, color]) => `<article class="stat-card stat-${color}"><span>${escapeHtml(label)}</span><strong>${number(value)}</strong></article>`).join("");
    } catch (err) {
      box.innerHTML = emptyState("Stats failed", err.message);
    }
  }

  async function loadAdminData() {
    const [specs, courses, jobs, quizzes, certResult] = await Promise.all([
      fetchSpecializations().catch(() => []),
      fetchCourses().catch(() => []),
      fetchJobs().catch(() => []),
      fetchQuizzes().catch(() => []),
      api("/api/certificates").catch(() => ({ certificates: [] }))
    ]);
    STATE.certificates = asArray(certResult, ["certificates"]);
    fillAdminSelects(specs, courses);
    renderAdminLists(specs, courses, jobs, quizzes, STATE.certificates);
  }

  function fillAdminSelects(specs, courses) {
    ["adminCourseSpecSelect", "adminJobSpecSelect", "adminCertificateSpecSelect"].forEach((id) => {
      const select = byId(id);
      if (!select) return;
      const nullable = id !== "adminCourseSpecSelect";
      select.innerHTML = `${nullable ? `<option value="">No specialization</option>` : `<option value="">Select specialization</option>`}${specs.map((s) => `<option value="${escapeAttr(itemId(s))}">${escapeHtml(s.name || "Specialization")}</option>`).join("")}`;
    });
    const courseSelect = byId("adminQuizCourseSelect");
    if (courseSelect) courseSelect.innerHTML = `<option value="">Select course</option>${courses.map((c) => `<option value="${escapeAttr(itemId(c))}">${escapeHtml(c.title || "Course")}</option>`).join("")}`;
  }

  function renderAdminLists(specs, courses, jobs, quizzes, certificates) {
    const specBox = byId("adminSpecializationsList");
    const courseBox = byId("adminCoursesList");
    const jobBox = byId("adminJobsList");
    const quizBox = byId("adminQuizzesList");
    const certBox = byId("adminCertificatesList");
    if (specBox) specBox.innerHTML = specs.length ? specs.map((s) => adminRow(s.name, s.description, "specialization", itemId(s))).join("") : emptyState("No specializations", "Add the first specialization using the form.");
    if (courseBox) courseBox.innerHTML = courses.length ? courses.map((c) => adminRow(c.title, `${c.specialization_name || ""} • ${c.level || ""}`, "course", itemId(c))).join("") : emptyState("No courses", "Add courses using the form.");
    if (jobBox) jobBox.innerHTML = jobs.length ? jobs.map((j) => adminRow(j.title, `${j.specialization || ""} • ${j.salary || ""}`, "job", itemId(j))).join("") : emptyState("No jobs", "Add jobs using the form.");
    if (quizBox) quizBox.innerHTML = quizzes.length ? quizzes.map((q) => adminRow(q.title, q.course_title || "Course quiz", "quiz", itemId(q))).join("") : emptyState("No quizzes", "Add a quiz using the form.");
    if (certBox) certBox.innerHTML = certificates.length ? certificates.map((c) => adminRow(c.name, c.specialization_name || c.description || "Certificate", "certificate", itemId(c))).join("") : emptyState("No certificates", "Add certificates using the form.");
  }

  function adminRow(title, subtitle, type, id) {
    return `
      <article class="admin-row">
        <div><strong>${escapeHtml(title || type)}</strong><span>${escapeHtml(subtitle || "")}</span></div>
        <div>${button("Delete", "btn btn-mini btn-danger", `data-delete-${escapeAttr(type)}="${escapeAttr(id)}"`)}</div>
      </article>`;
  }

  async function loadAdminUsers() {
    const box = byId("adminUsersList");
    if (!box) return;
    try {
      const result = await api("/api/admin/users");
      const users = asArray(result, ["users"]);
      box.innerHTML = users.length ? users.map((u) => `
        <article class="admin-row user-row">
          <div><strong>${escapeHtml(u.name || "User")}</strong><span>${escapeHtml(u.email || "")} • ${escapeHtml(u.role || "student")} • ${u.banned ? "Banned" : "Active"}</span></div>
          <div class="row-actions">
            ${button(u.role === "admin" ? "Make Student" : "Make Admin", "btn btn-mini btn-secondary", `data-role-user="${escapeAttr(itemId(u))}" data-role-value="${u.role === "admin" ? "student" : "admin"}"`)}
            ${button(u.banned ? "Unban" : "Ban", u.banned ? "btn btn-mini btn-secondary" : "btn btn-mini btn-danger", `data-ban-user="${escapeAttr(itemId(u))}" data-ban-value="${u.banned ? "0" : "1"}"`)}
          </div>
        </article>`).join("") : emptyState("No users", "User accounts will appear here.");
    } catch (err) {
      box.innerHTML = emptyState("Could not load users", err.message);
    }
  }

  function setupAdminTabs() {
    qsa("[data-admin-tab]").forEach((buttonEl) => {
      if (buttonEl.dataset.ready) return;
      buttonEl.dataset.ready = "1";
      buttonEl.addEventListener("click", () => {
        const tab = buttonEl.dataset.adminTab;
        qsa("[data-admin-tab]").forEach((b) => b.classList.remove("active"));
        buttonEl.classList.add("active");
        qsa(".admin-section").forEach((section) => section.classList.remove("active"));
        byId(`admin-${tab}`)?.classList.add("active");
      });
    });
  }

  function setupAdminForms() {
    bindAdminForm("adminSpecializationForm", "/api/specializations");
    bindAdminForm("adminCourseForm", "/api/courses");
    bindAdminForm("adminJobForm", "/api/jobs");
    bindAdminForm("adminCertificateForm", "/api/certificates");
    bindAdminForm("adminQuizForm", "/api/quizzes", (form) => {
      const data = formDataObject(form);
      if (data.questions_json) {
        try {
          data.questions = JSON.parse(data.questions_json);
        } catch (_) {
          data.questions = [];
        }
      }
      return data;
    });
  }

  function bindAdminForm(id, endpoint, transform) {
    const form = byId(id);
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = form.querySelector("button[type='submit']");
      try {
        setLoading(btn, true, "Saving...");
        let body;
        if (hasFiles(form)) body = new FormData(form);
        else body = transform ? transform(form) : formDataObject(form);
        await api(endpoint, { method: "POST", body });
        form.reset();
        showMessage("Saved successfully", "success");
        await Promise.allSettled([loadAdminStats(), loadAdminData(), loadAdminUsers()]);
      } catch (err) {
        showMessage(err.message, "error");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  async function deleteResource(type, id) {
    const endpoints = {
      specialization: `/api/specializations/${id}`,
      course: `/api/courses/${id}`,
      job: `/api/jobs/${id}`,
      quiz: `/api/quizzes/${id}`,
      certificate: `/api/certificates/${id}`
    };
    if (!endpoints[type]) return;
    if (!confirm(`Delete this ${type}?`)) return;
    try {
      await api(endpoints[type], { method: "DELETE" });
      showMessage("Deleted successfully", "success");
      await Promise.allSettled([loadAdminStats(), loadAdminData()]);
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  async function updateUserRole(id, role) {
    try {
      await api(`/api/admin/users/${id}/role`, { method: "PUT", body: { role } });
      showMessage("Role updated", "success");
      await loadAdminUsers();
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  async function updateUserBan(id, value) {
    try {
      await api(`/api/admin/users/${id}/${value === "1" ? "ban" : "unban"}`, { method: "PUT" });
      showMessage(value === "1" ? "User banned" : "User unbanned", "success");
      await loadAdminUsers();
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  async function switchMode(mode) {
    try {
      const result = await api("/api/mode", { method: "PUT", body: { mode } });
      setAuth(result.token, result.user);
      go(mode === "admin" ? route("admin") : route("profile"));
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function bindGlobalClicks() {
    document.addEventListener("click", async (event) => {
      const logout = event.target.closest("[data-logout]");
      if (logout) {
        clearAuth();
        go(route("signin"));
        return;
      }
      const mode = event.target.closest("[data-switch-mode]");
      if (mode) {
        await switchMode(mode.dataset.switchMode);
        return;
      }
      const tracked = event.target.closest("[data-track-course]");
      if (tracked) {
        await trackCourseOpened(tracked.dataset.trackCourse, true);
      }
      const copy = event.target.closest("[data-copy-resume]");
      if (copy) {
        const text = STATE.lastResume || clean(qs(".resume-text") && qs(".resume-text").textContent);
        await navigator.clipboard.writeText(text);
        showMessage("Resume copied", "success");
        return;
      }
      if (event.target.closest("[data-export-pdf]")) {
        await exportResume("pdf");
        return;
      }
      if (event.target.closest("[data-export-docx]")) {
        await exportResume("docx");
        return;
      }
      const roleBtn = event.target.closest("[data-role-user]");
      if (roleBtn) {
        await updateUserRole(roleBtn.dataset.roleUser, roleBtn.dataset.roleValue);
        return;
      }
      const banBtn = event.target.closest("[data-ban-user]");
      if (banBtn) {
        await updateUserBan(banBtn.dataset.banUser, banBtn.dataset.banValue);
        return;
      }
      for (const type of ["specialization", "course", "job", "quiz", "certificate"]) {
        const btn = event.target.closest(`[data-delete-${type}]`);
        if (btn) {
          await deleteResource(type, btn.dataset[`delete${type.charAt(0).toUpperCase()}${type.slice(1)}`]);
          return;
        }
      }
      const card = event.target.closest(".clickable[data-link]");
      if (card && !event.target.closest("a, button, input, select, textarea, video, [data-no-card-click]")) {
        go(card.dataset.link);
      }
    });
  }

  function markRequiredFields() {
    qsa("label.required").forEach((label) => {
      if (!label.querySelector(".required-star")) label.insertAdjacentHTML("beforeend", ` <span class="required-star">*</span>`);
    });
  }

  function boot() {
    navbar();
    if (!adminGuard()) return;
    bindGlobalClicks();
    setupSignin();
    setupSignup();
    setupProfileForm();
    setupATS();
    setupRecommendation();
    bindQuizForms();
    loadHome();
    loadProfile();
    loadSpecializations();
    loadSpecializationDetails();
    loadCourses();
    loadCourseDetails();
    loadQuizPage();
    loadJobs();
    loadJobDetails();
    loadAdmin();
    bindCourseMediaTracking();
    markRequiredFields();
  }

  window.SQR = Object.assign(window.SQR || {}, {
    API,
    STATE,
    route,
    go,
    api,
    getToken,
    getUser,
    setAuth,
    clearAuth,
    showMessage,
    loadProfile,
    loadProfileProgress,
    loadHome,
    loadSpecializations,
    loadCourses,
    loadJobs,
    loadAdmin
  });

  window.navbar = navbar;
  window.requireLogin = requireLogin;
  window.logout = function () { clearAuth(); go(route("signin")); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();


(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function clean(value) {
    return String(value === undefined || value === null ? "" : value).trim();
  }

  function currentPage() {
    return (location.pathname.split("/").pop() || "gp.html").toLowerCase();
  }

  function isProfilePage() {
    return currentPage() === "profile.html";
  }

  function removeBottomDuplicateNavigation() {
    qsa("footer, .footer-links, .bottom-nav, .mobile-bottom-nav").forEach(function (el) {
      if (el.closest(".sqr-navbar") || el.closest(".navbar")) return;
      el.setAttribute("data-sqr-hidden-footer", "1");
    });
  }

  function protectProgressOutsideProfile() {
    if (isProfilePage()) return;
    qsa(".only-profile-progress, .profile-progress-list, .profile-progress").forEach(function (el) {
      el.remove();
    });
    qsa(".dashboard-track, .fake-progress, [data-fake-progress]").forEach(function (el) {
      el.remove();
    });
  }

  function enhanceClickableCards() {
    qsa(".clickable[data-link], .interactive-card[data-open-url]").forEach(function (card) {
      if (card.dataset.sqrClickableReady) return;
      card.dataset.sqrClickableReady = "1";
      card.tabIndex = 0;
      card.setAttribute("role", "link");
      card.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("a, button, input, textarea, select")) return;
        event.preventDefault();
        location.href = card.dataset.link || card.dataset.openUrl;
      });
    });
  }

  function addPageAccent() {
    const page = currentPage().replace(".html", "") || "home";
    document.documentElement.dataset.sqrPage = page;
    document.body.dataset.sqrPage = page;
  }

  function createSearchForDynamicGrids() {
    qsa(".dynamic-grid").forEach(function (grid, index) {
      if (grid.dataset.sqrSearchReady) return;
      const section = grid.closest(".section-block, section");
      if (!section) return;
      const heading = qs(".section-heading", section);
      if (!heading) return;
      const wrapper = document.createElement("div");
      wrapper.className = "sqr-grid-tools";
      wrapper.innerHTML = '<input type="search" class="sqr-grid-search" placeholder="Search this section..." aria-label="Search section">';
      heading.appendChild(wrapper);
      const input = qs("input", wrapper);
      input.addEventListener("input", function () {
        const term = clean(input.value).toLowerCase();
        qsa("article, .data-card, .card", grid).forEach(function (card) {
          if (card.classList.contains("skeleton-card")) return;
          const text = clean(card.textContent).toLowerCase();
          card.style.display = !term || text.includes(term) ? "" : "none";
        });
      });
      grid.dataset.sqrSearchReady = String(index + 1);
    });
  }

  function markRequiredInputs() {
    qsa("input[required], textarea[required], select[required]").forEach(function (input) {
      const id = input.id;
      const label = id ? qs('label[for="' + CSS.escape(id) + '"]') : input.closest("label");
      if (!label || label.dataset.requiredStarReady) return;
      label.dataset.requiredStarReady = "1";
      if (!label.querySelector(".required-star")) {
        const star = document.createElement("span");
        star.className = "required-star";
        star.textContent = " *";
        label.appendChild(star);
      }
    });
  }

  function improveEmptyStates() {
    qsa(".empty-state").forEach(function (state) {
      if (state.dataset.sqrEmptyReady) return;
      state.dataset.sqrEmptyReady = "1";
      const icon = document.createElement("div");
      icon.className = "empty-state-icon";
      icon.textContent = "◇";
      state.prepend(icon);
    });
  }

  function syncHomeCountsFromCards() {
    if (currentPage() !== "gp.html" && currentPage() !== "index.html" && currentPage() !== "") return;
    const pairs = [
      ["homeSpecCount", "homeSpecializations"],
      ["homeCourseCount", "homeCourses"],
      ["homeJobCount", "homeJobs"]
    ];
    pairs.forEach(function (pair) {
      const numberEl = document.getElementById(pair[0]);
      const box = document.getElementById(pair[1]);
      if (!numberEl || !box) return;
      const update = function () {
        const count = qsa("article.data-card, article.card, .data-card", box).filter(function (x) {
          return !x.classList.contains("skeleton-card") && !x.classList.contains("empty-state");
        }).length;
        if (count > 0 && numberEl.textContent !== String(count)) numberEl.textContent = String(count);
      };
      update();
      new MutationObserver(update).observe(box, { childList: true, subtree: true });
    });
  }

  function addSoftPageLoader() {
    if (document.body.dataset.sqrLoaderReady) return;
    document.body.dataset.sqrLoaderReady = "1";
    const loader = document.createElement("div");
    loader.className = "sqr-page-loader";
    loader.innerHTML = '<span></span><strong>SQR</strong>';
    document.body.appendChild(loader);
    setTimeout(function () {
      loader.classList.add("hide");
      setTimeout(function () { loader.remove(); }, 500);
    }, 450);
  }

  function addColorfulCardIndex() {
    qsa(".data-card, .card, .panel-card, .mini-card").forEach(function (card, index) {
      if (card.dataset.sqrColorIndex) return;
      card.dataset.sqrColorIndex = String((index % 6) + 1);
    });
  }

  function watchDynamicEnhancements() {
    const root = document.body;
    if (!root || root.dataset.sqrEnhanceWatch) return;
    root.dataset.sqrEnhanceWatch = "1";
    const run = function () {
      removeBottomDuplicateNavigation();
      protectProgressOutsideProfile();
      enhanceClickableCards();
      createSearchForDynamicGrids();
      markRequiredInputs();
      improveEmptyStates();
      addColorfulCardIndex();
    };
    run();
    new MutationObserver(function () {
      clearTimeout(watchDynamicEnhancements.timer);
      watchDynamicEnhancements.timer = setTimeout(run, 80);
    }).observe(root, { childList: true, subtree: true });
  }

  ready(function () {
    addPageAccent();
    addSoftPageLoader();
    watchDynamicEnhancements();
    syncHomeCountsFromCards();
  });
})();


/* SQR long non-destructive dynamic enhancement layer */
(function () {
  "use strict";

  const SQRX = window.SQRX || (window.SQRX = {});
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function pageName() {
    return (location.pathname.split("/").pop() || "gp.html").toLowerCase();
  }

  function getApiBase() {
    if (window.SQR && window.SQR.API) return window.SQR.API;
    if (window.SQR_API_OVERRIDE) return String(window.SQR_API_OVERRIDE).replace(/\/$/, "");
    if (LOCAL_HOSTS.has(location.hostname)) return "http://127.0.0.1:5000";
    if (location.hostname.includes("github.io") || location.hostname.includes("netlify") || location.hostname.includes("vercel")) return "https://sqr-ba83.onrender.com";
    return location.origin || "https://sqr-ba83.onrender.com";
  }

  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function byId(id) { return document.getElementById(id); }
  function clean(value) { return String(value === undefined || value === null ? "" : value).trim(); }
  function toNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function percent(value) { return clamp(Math.round(toNumber(value)), 0, 100); }
  function html(value) { return clean(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function token() { return localStorage.getItem("sqr_token") || localStorage.getItem("token") || ""; }
  function authHeaders() { return token() ? { Authorization: "Bearer " + token() } : {}; }

  async function getJson(path, options) {
    const base = getApiBase();
    const response = await fetch(/^https?:\/\//i.test(path) ? path : base + path, Object.assign({ headers: authHeaders() }, options || {}));
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }
    if (!response.ok) throw new Error(data.error || data.message || "Request failed");
    return data;
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function asset(value) {
    const v = clean(value);
    if (!v) return "";
    if (/^https?:\/\//i.test(v) || v.startsWith("data:")) return v;
    if (v.startsWith("/")) return getApiBase() + v;
    if (v.startsWith("uploads/") || v.startsWith("static/")) return getApiBase() + "/" + v;
    return v;
  }

  function pick(item, keys, fallback) {
    for (const key of keys) {
      if (item && item[key] !== undefined && item[key] !== null && item[key] !== "") return item[key];
    }
    return fallback || "";
  }

  function idOf(item) {
    return pick(item, ["id", "specialization_id", "spec_id", "course_id", "job_id", "quiz_id"], "");
  }

  function emptyCard(title, text) {
    return '<article class="card empty-state"><h3>' + html(title) + '</h3><p>' + html(text) + '</p></article>';
  }

  function miniCard(title, text, href, item) {
    const img = asset(pick(item || {}, ["image_url", "image", "thumbnail", "cover"], ""));
    return '<article class="card colorful-card clickable" data-link="' + html(href || "#") + '">' +
      (img ? '<img class="card-media" src="' + html(img) + '" alt="' + html(title) + '" loading="lazy">' : '<div class="card-media media-placeholder"><span>SQR</span></div>') +
      '<h3>' + html(title) + '</h3><p>' + html(text) + '</p>' +
      (href ? '<a class="btn btn-secondary" href="' + html(href) + '">Open</a>' : '') +
      '</article>';
  }

  function routeFor(type, item) {
    const id = idOf(item);
    if (type === "specialization") return "Specialization.html" + (id ? "?id=" + encodeURIComponent(id) : "");
    if (type === "course") return "Courses.html" + (id ? "?id=" + encodeURIComponent(id) : "");
    if (type === "job") return "JobDetails.html" + (id ? "?id=" + encodeURIComponent(id) : "");
    if (type === "quiz") return "Quiz.html" + (id ? "?id=" + encodeURIComponent(id) : "");
    return "#";
  }

  function renderList(box, items, type) {
    if (!box) return;
    if (!Array.isArray(items) || !items.length) {
      box.innerHTML = emptyCard(box.dataset.empty || "No data yet", "Add content from the admin dashboard and refresh this page.");
      return;
    }
    box.innerHTML = items.map(function (item) {
      if (type === "specialization") return miniCard(item.name || item.title || "Specialization", item.description || item.skills || "Open this path to view linked courses.", routeFor(type, item), item);
      if (type === "course") return miniCard(item.title || item.name || "Course", (item.description || "Open this course to start progress.") + (item.level ? " • " + item.level : ""), routeFor(type, item), item);
      if (type === "job") return miniCard(item.title || item.name || "Job", item.description || item.skills || item.specialization || "Open job details.", routeFor(type, item), item);
      if (type === "quiz") return miniCard(item.title || item.name || "Quiz", item.description || item.course_title || "Open this quiz.", routeFor(type, item), item);
      return miniCard(item.title || item.name || "Item", item.description || "Open details.", "#", item);
    }).join("");
    installClickableCards(box);
  }

  function arrayFrom(data, keys) {
    if (Array.isArray(data)) return data;
    for (const key of keys) if (Array.isArray(data && data[key])) return data[key];
    return [];
  }

  async function hydratePublicBootstrap() {
    if (!["gp.html", "index.html", ""].includes(pageName())) return;
    try {
      const data = await getJson("/api/public/bootstrap");
      const stats = data.stats || {};
      setText("homeSpecCount", stats.specializations || arrayFrom(data, ["specializations"]).length || 0);
      setText("homeCourseCount", stats.courses || arrayFrom(data, ["courses"]).length || 0);
      setText("homeJobCount", stats.jobs || arrayFrom(data, ["jobs"]).length || 0);
      renderList(byId("homeSpecializations"), arrayFrom(data, ["specializations"]).slice(0, 6), "specialization");
      renderList(byId("homeCourses"), arrayFrom(data, ["courses"]).slice(0, 6), "course");
      renderList(byId("homeJobs"), arrayFrom(data, ["jobs"]).slice(0, 6), "job");
      const status = byId("homeBackendStatus");
      if (status) {
        status.innerHTML = '<span class="panel-kicker">Live platform</span><h2>Connected to database</h2><p>Loaded ' +
          html(stats.specializations || 0) + ' specializations, ' + html(stats.courses || 0) + ' courses, and ' + html(stats.jobs || 0) + ' jobs.</p>' +
          '<div class="status-pill success">Backend connected</div>';
      }
    } catch (err) {
      const status = byId("homeBackendStatus");
      if (status) {
        status.innerHTML = '<span class="panel-kicker">Backend status</span><h2>Database not loading</h2><p>' + html(err.message) + '</p><div class="status-pill danger">Check Render/Railway DB variables</div>';
      }
    }
  }

  async function hydrateQuestionBank() {
    const box = byId("recommendationQuestionBank");
    if (!box) return;
    try {
      const data = await getJson("/api/recommendation/questions");
      const questions = arrayFrom(data, ["questions"]).slice(0, 6);
      box.innerHTML = questions.map(function (q, index) {
        return '<article class="mini-question"><strong>' + (index + 1) + '</strong><span>' + html(q.question || q.text || "Question") + '</span></article>';
      }).join("");
    } catch (_) {
      box.innerHTML = '<p class="muted">Write your interests and skills. SQR will still recommend from your answer.</p>';
    }
  }

  function removeFooterNavigation() {
    qsa("footer .footer-links, .footer-links, .bottom-nav, .mobile-bottom-nav").forEach(function (el) {
      el.remove();
    });
    qsa("footer").forEach(function (footer) {
      if (clean(footer.textContent).split(/\s+/).length < 20) footer.remove();
    });
  }

  function protectProgressOnlyProfile() {
    if (pageName() === "profile.html") return;
    qsa(".dashboard-track, .fake-progress, [data-fake-progress]").forEach(function (el) { el.remove(); });
    qsa(".progress-block").forEach(function (el) {
      if (!el.closest("#profileProgressBars") && !el.closest("#profileSummary") && !el.closest(".score-circle")) el.classList.add("hidden-outside-profile");
    });
  }

  function setupPageSearch() {
    qsa(".page-search[data-filter-target]").forEach(function (input) {
      if (input.dataset.sqrxReady) return;
      input.dataset.sqrxReady = "1";
      input.addEventListener("input", function () {
        const target = byId(input.dataset.filterTarget);
        const term = clean(input.value).toLowerCase();
        if (!target) return;
        qsa("article, .card", target).forEach(function (card) {
          if (card.classList.contains("skeleton-card")) return;
          const text = clean(card.textContent).toLowerCase();
          card.style.display = !term || text.includes(term) ? "" : "none";
        });
      });
    });
  }

  function installClickableCards(root) {
    qsa(".clickable[data-link], .interactive-card[data-open-url]", root || document).forEach(function (card) {
      if (card.dataset.sqrxClickReady) return;
      card.dataset.sqrxClickReady = "1";
      card.tabIndex = 0;
      card.setAttribute("role", "link");
      card.addEventListener("click", function (event) {
        if (event.target.closest("a, button, input, select, textarea, video")) return;
        const href = card.dataset.link || card.dataset.openUrl;
        if (href) location.href = href;
      });
      card.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("a, button, input, select, textarea")) return;
        event.preventDefault();
        const href = card.dataset.link || card.dataset.openUrl;
        if (href) location.href = href;
      });
    });
  }

  function addRequiredStars() {
    qsa("input[required], textarea[required], select[required]").forEach(function (input) {
      const id = input.id;
      let label = id ? qs('label[for="' + CSS.escape(id) + '"]') : input.closest("label");
      if (!label) label = input.parentElement && input.parentElement.tagName === "LABEL" ? input.parentElement : null;
      if (!label || label.dataset.sqrxStar) return;
      label.dataset.sqrxStar = "1";
      if (!label.querySelector(".required-star")) label.insertAdjacentHTML("beforeend", ' <span class="required-star">*</span>');
    });
  }

  function decorateForms() {
    qsa("form").forEach(function (form) {
      form.classList.add("sqr-enhanced-form");
      qsa("input, textarea, select", form).forEach(function (field) {
        field.addEventListener("focus", function () { field.closest("label, .field")?.classList.add("field-focus"); });
        field.addEventListener("blur", function () { field.closest("label, .field")?.classList.remove("field-focus"); });
      });
    });
  }

  function addBreadcrumbs() {
    const main = qs("main.page-shell");
    if (!main || byId("sqrBreadcrumbs")) return;
    const name = pageName().replace(".html", "") || "home";
    const map = { gp: "Home", index: "Home", specializations: "Specializations", specialization: "Specializations", courses: "Courses", quiz: "Quizzes", ats: "ATS", jobs: "Jobs", jobdetails: "Job Details", recommendation: "Recommendation", profile: "Profile", admin: "Admin", signin: "Sign In", signup: "Sign Up" };
    const label = map[name.toLowerCase()] || name.replace(/[-_]/g, " ");
    const nav = document.createElement("nav");
    nav.id = "sqrBreadcrumbs";
    nav.className = "sqr-breadcrumbs";
    nav.innerHTML = '<a href="gp.html">SQR</a><span>/</span><strong>' + html(label) + '</strong>';
    main.prepend(nav);
  }

  function animateMetricCards() {
    qsa(".metric-card strong, .stat-card strong").forEach(function (el) {
      const value = toNumber(el.textContent);
      if (!value || el.dataset.sqrxAnimated) return;
      el.dataset.sqrxAnimated = "1";
      let current = 0;
      const steps = 18;
      const inc = Math.max(1, Math.ceil(value / steps));
      const timer = setInterval(function () {
        current = Math.min(value, current + inc);
        el.textContent = current;
        if (current >= value) clearInterval(timer);
      }, 28);
    });
  }

  function fixImageFallbacks() {
    qsa("img").forEach(function (img) {
      if (img.dataset.sqrxImageReady) return;
      img.dataset.sqrxImageReady = "1";
      img.addEventListener("error", function () {
        const placeholder = document.createElement("div");
        placeholder.className = img.className + " media-placeholder";
        placeholder.innerHTML = "<span>SQR</span>";
        img.replaceWith(placeholder);
      });
    });
  }

  function applyColorfulPageClass() {
    document.documentElement.classList.add("sqr-colorful-root");
    document.body.classList.add("sqr-colorful-ready");
    document.body.dataset.pageName = pageName().replace(".html", "") || "home";
  }

  function observeDynamicContent() {
    const observer = new MutationObserver(function () {
      setupPageSearch();
      installClickableCards();
      addRequiredStars();
      fixImageFallbacks();
      animateMetricCards();
      protectProgressOnlyProfile();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function runAll() {
    applyColorfulPageClass();
    removeFooterNavigation();
    protectProgressOnlyProfile();
    setupPageSearch();
    installClickableCards();
    addRequiredStars();
    decorateForms();
    addBreadcrumbs();
    fixImageFallbacks();
    hydratePublicBootstrap();
    hydrateQuestionBank();
    animateMetricCards();
    observeDynamicContent();
  }

  SQRX.runAll = runAll;
  SQRX.getApiBase = getApiBase;
  SQRX.getJson = getJson;
  SQRX.renderList = renderList;
  SQRX.protectProgressOnlyProfile = protectProgressOnlyProfile;
  ready(runAll);
})();
