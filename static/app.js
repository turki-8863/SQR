(() => {
  "use strict";

  const API_BASE = (window.SQR_API_BASE || "").replace(/\/$/, "");
  const TOKEN_KEYS = ["sqr_token", "token", "authToken", "jwt"];
  const USER_KEYS = ["sqr_user", "user", "currentUser"];
  const pageName = (location.pathname.split("/").pop() || "gp.html").toLowerCase();

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function first(...selectors) {
    for (const selector of selectors) {
      const found = $(selector);
      if (found) return found;
    }
    return null;
  }

  function valueOf(...names) {
    for (const name of names) {
      const el = document.querySelector(`[name="${name}"], #${name}`);
      if (el && String(el.value || "").trim() !== "") return String(el.value || "").trim();
    }
    return "";
  }

  function getToken() {
    for (const key of TOKEN_KEYS) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return "";
  }

  function setToken(token) {
    if (!token) return;
    TOKEN_KEYS.forEach((key) => localStorage.setItem(key, token));
  }

  function getUser() {
    for (const key of USER_KEYS) {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        return JSON.parse(raw);
      } catch {
        continue;
      }
    }
    return null;
  }

  function setUser(user) {
    if (!user) return;
    USER_KEYS.forEach((key) => localStorage.setItem(key, JSON.stringify(user)));
  }

  function clearSession() {
    TOKEN_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    USER_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }

  function isLoggedIn() {
    return Boolean(getToken());
  }

  function isAdmin() {
    const user = getUser();
    return String(user?.role || "").toLowerCase() === "admin";
  }

  function isStudentMode() {
    const user = getUser();
    if (!user) return true;
    return String(user.current_mode || user.role || "student").toLowerCase() === "student";
  }

  function redirectTo(url) {
    location.href = url;
  }

  function getParam(...names) {
    const params = new URLSearchParams(location.search);
    for (const name of names) {
      const value = params.get(name);
      if (value) return value;
    }
    return "";
  }

  function idOf(item, ...extra) {
    if (!item) return "";
    const keys = ["id", ...extra, "specialization_id", "course_id", "quiz_id", "job_id", "certification_id", "certificate_id"];
    for (const key of keys) {
      if (item[key] !== undefined && item[key] !== null && item[key] !== "") return item[key];
    }
    return "";
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function asArray(value, ...keys) {
    if (Array.isArray(value)) return value;
    for (const key of keys) {
      if (Array.isArray(value?.[key])) return value[key];
    }
    return [];
  }

  function pct(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function joinText(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join(", ");
    if (value && typeof value === "object") return Object.values(value).filter(Boolean).join(", ");
    return String(value || "");
  }

  function absoluteMedia(url) {
    if (!url) return "";
    const value = String(url);
    if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) return value;
    return `/uploads/${value}`;
  }

  function message(text, type = "info", target) {
    const box = target || first("#message", "#msg", ".message", ".alert-box");
    if (!box) {
      if (type === "error") console.error(text);
      return;
    }
    box.innerHTML = `<div class="sqr-alert sqr-alert-${escapeHTML(type)}">${escapeHTML(text)}</div>`;
    setTimeout(() => {
      const alert = box.querySelector(".sqr-alert");
      if (alert) alert.remove();
    }, 7000);
  }


  function revealBox(box) {
    if (!box) return;
    box.classList.remove("hidden");
    box.hidden = false;
    box.style.display = "";
  }

  function setLoading(container, text = "Loading...") {
    if (container) container.innerHTML = `<div class="card sqr-card"><p>${escapeHTML(text)}</p></div>`;
  }


  function isAdminPage() {
    return pageName.includes("admin");
  }

  function ensureMainShell() {
    let shell = first(".container", ".page-shell", ".sqr-shell", "main");
    if (!shell) {
      shell = document.createElement("main");
      shell.className = "container sqr-shell";
      document.body.appendChild(shell);
    }
    return shell;
  }

  function ensurePageMounts() {
    const shell = ensureMainShell();
    const hasSpecDetailId = getParam("id", "specialization_id", "spec_id");
    const hasCourseDetailId = getParam("id", "course_id");

    if (pageName.includes("specialization") && !hasSpecDetailId) {
      if (!first("#specializationsBox", "#specializationGrid", "#specializationsList", "#specializationList", "#specializationsContainer", "#specializationsGrid", "[data-specializations]")) {
        const section = document.createElement("section");
        section.className = "sqr-section";
        section.innerHTML = `
          <div class="section-head">
            <div>
              <span class="eyebrow">SQR paths</span>
              <h2>Available Specializations</h2>
              <p class="muted">Choose a path to see related courses, jobs, roadmap, and enrollment.</p>
            </div>
          </div>
          <div id="specializationsGrid" class="sqr-grid" data-specializations></div>
        `;
        shell.appendChild(section);
      }
    }

    if (pageName.includes("specialization") && hasSpecDetailId) {
      if (!first("#specializationDetails", "#specializationDetail", "#details", "[data-specialization-details]")) {
        const section = document.createElement("section");
        section.className = "sqr-section";
        section.innerHTML = `<div id="specializationDetails" data-specialization-details></div>`;
        shell.appendChild(section);
      }
    }

    if (pageName.includes("course") && !hasCourseDetailId) {
      if (!first("#coursesBox", "#coursesList", "#courseList", "#coursesContainer", "#coursesGrid", "[data-courses]")) {
        const section = document.createElement("section");
        section.className = "sqr-section";
        section.innerHTML = `
          <div class="section-head">
            <div>
              <span class="eyebrow">Course library</span>
              <h2>Courses</h2>
              <p class="muted">Open courses, enroll manually, and take linked quiz modules.</p>
            </div>
          </div>
          <div id="coursesGrid" class="sqr-grid" data-courses></div>
        `;
        shell.appendChild(section);
      }
    }

    if (pageName.includes("course") && hasCourseDetailId) {
      if (!first("#courseDetails", "#courseDetail", "#details", "[data-course-details]")) {
        const section = document.createElement("section");
        section.className = "sqr-section";
        section.innerHTML = `<div id="courseDetails" data-course-details></div>`;
        shell.appendChild(section);
      }
    }
  }

  function publicSpecializationSelects() {
    if (isAdminPage()) return [];
    return $all([
      "#courseSpecializationFilter",
      "#courseSpecFilter",
      "#specializationFilter",
      "#specialization_id",
      "#spec_id",
      "select[name='specialization_id']",
      "select[name='spec_id']",
      "select[data-specialization-filter]"
    ].join(",")).filter((select) => select && select.tagName === "SELECT");
  }

  function publicDifficultySelects() {
    if (isAdminPage()) return [];
    return $all([
      "#difficultyFilter",
      "#courseDifficultyFilter",
      "#levelFilter",
      "select[name='difficulty']",
      "select[name='level']",
      "select[data-difficulty-filter]"
    ].join(",")).filter((select) => select && select.tagName === "SELECT");
  }

  function selectedDifficulty() {
    const select = first(
      "#difficultyFilter",
      "#courseDifficultyFilter",
      "#levelFilter",
      "select[name='difficulty']",
      "select[name='level']",
      "select[data-difficulty-filter]"
    );
    const value = String(select?.value || "").trim().toLowerCase();
    return value === "all" || value === "all levels" ? "" : value;
  }

  async function populatePublicSpecializationFilters() {
    const selects = publicSpecializationSelects();
    if (!selects.length) return [];
    try {
      const data = await apiFetch("/api/specializations");
      const specs = asArray(data, "specializations");
      selects.forEach((select) => {
        const current = select.value;
        const firstText = String(select.options?.[0]?.textContent || "All specializations").trim();
        const blankLabel = /choose|select/i.test(firstText) ? "Choose specialization" : "All specializations";
        select.innerHTML = `<option value="">${escapeHTML(blankLabel)}</option>` + specs.map((spec) => {
          const id = idOf(spec, "specialization_id");
          return `<option value="${escapeHTML(id)}">${escapeHTML(spec.name || `Specialization ${id}`)}</option>`;
        }).join("");
        if (current) select.value = current;
      });
      return specs;
    } catch (err) {
      console.error("Specialization filter failed:", err);
      selects.forEach((select) => {
        select.innerHTML = `<option value="">Could not load specializations</option>`;
      });
      return [];
    }
  }

  function bindFilterReloads() {
    const selects = [...publicSpecializationSelects(), ...publicDifficultySelects()];
    selects.forEach((select) => {
      if (select.dataset.sqrFilterBound) return;
      select.dataset.sqrFilterBound = "1";
      select.addEventListener("change", () => {
        if (pageName.includes("course")) loadCourses();
        else if (pageName.includes("job")) loadJobs();
        else if (pageName.includes("specialization")) loadSpecializations();
      });
    });
  }

  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getToken();

    if (token) headers.set("Authorization", `Bearer ${token}`);

    const isForm = options.body instanceof FormData;
    if (!isForm && options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body: !isForm && options.body !== undefined && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body,
    });

    let data = {};
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => ({}));
    } else {
      data = { text: await response.text().catch(() => "") };
    }

    if (!response.ok) {
      if (response.status === 401) clearSession();
      const err = new Error(data.error || data.message || `Request failed (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  function authHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function refreshMe() {
    if (!getToken()) return null;
    try {
      const user = await apiFetch("/api/me");
      setUser(user.user || user);
      return user.user || user;
    } catch (err) {
      if (err.status === 401) clearSession();
      return null;
    }
  }

  function navbar() {
    if ($(".sqr-navbar")) return;

    const user = getUser();
    const logged = isLoggedIn();
    const admin = String(user?.role || "").toLowerCase() === "admin";
    const adminOnly = admin && String(user?.current_mode || "admin").toLowerCase() === "admin";

    const studentLinks = [
      ["gp.html", "Home"],
      ["Specialization.html", "Specializations"],
      ["courses.html", "Courses"],
      ["jobs.html", "Jobs"],
      ["recommendation.html", "Recommendation"],
      ["ATS.html", "ATS"],
      ["profile.html", "Profile"],
    ];

    const links = adminOnly
      ? [["admin.html", "Admin"], ["profile.html", "Profile"]]
      : [...studentLinks, ...(admin ? [["admin.html", "Admin"]] : [])];

    const nav = document.createElement("header");
    nav.className = "sqr-navbar";
    nav.innerHTML = `
      <a class="sqr-brand" href="gp.html">
        <span class="sqr-logo-text">SQR</span>
        <small>Skill Quest Road</small>
      </a>
      <nav class="sqr-nav-links">
        ${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join("")}
      </nav>
      <div class="sqr-auth-links">
        ${
          logged
            ? `<button type="button" class="btn btn-small" id="sqrLogoutBtn">Sign Out</button>`
            : `<a class="btn btn-small" href="signin.html">Sign In</a><a class="btn btn-small btn-primary" href="signup.html">Sign Up</a>`
        }
      </div>
    `;
    document.body.prepend(nav);

    $("#sqrLogoutBtn")?.addEventListener("click", () => {
      clearSession();
      redirectTo("signin.html");
    });
  }

  function requireLogin() {
    if (!isLoggedIn()) redirectTo("signin.html");
  }

  function requireAdmin() {
    if (!isLoggedIn()) redirectTo("signin.html");
    const user = getUser();
    if (String(user?.role || "").toLowerCase() !== "admin") redirectTo("profile.html");
  }

  function blockAdminFromStudentPages() {
    const user = getUser();
    if (!user) return;
    const admin = String(user.role || "").toLowerCase() === "admin";
    const mode = String(user.current_mode || "admin").toLowerCase();
    const adminPage = pageName.includes("admin");
    const profilePage = pageName.includes("profile");
    const authPage = pageName.includes("signin") || pageName.includes("signup");
    if (admin && mode === "admin" && !adminPage && !profilePage && !authPage) {
      redirectTo("admin.html");
    }
  }

  function setupSignup() {
    const form = first("#signupForm", "#signUpForm", "#registerForm", "form[data-auth='signup']");
    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data.name = data.name || data.fullname || data.full_name;
      data.email = data.email;
      data.password = data.password;
      try {
        const result = await apiFetch("/api/signup", { method: "POST", body: data });
        setToken(result.token);
        setUser(result.user);
        message("Account created successfully.", "success");
        setTimeout(() => redirectTo("profile.html"), 500);
      } catch (err) {
        message(err.message, "error");
      }
    });
  }

  function setupSignin() {
    const form = first("#signinForm", "#signInForm", "#loginForm", "form[data-auth='signin']");
    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const result = await apiFetch("/api/signin", { method: "POST", body: data });
        setToken(result.token);
        setUser(result.user);
        message("Signed in successfully.", "success");
        const user = result.user || {};
        setTimeout(() => {
          if (String(user.role || "").toLowerCase() === "admin") redirectTo("admin.html");
          else redirectTo("profile.html");
        }, 400);
      } catch (err) {
        message(err.message, "error");
      }
    });
  }

  function cardImage(item) {
    const img = absoluteMedia(item.image_url || item.image || item.thumbnail);
    return img ? `<img class="sqr-card-img" src="${escapeHTML(img)}" alt="">` : `<div class="sqr-card-img sqr-card-img-empty">SQR</div>`;
  }

  function difficultyClass(value) {
    const text = String(value || "beginner").toLowerCase();
    if (text.includes("advanced") || text.includes("hard")) return "difficulty-advanced";
    if (text.includes("intermediate") || text.includes("medium")) return "difficulty-intermediate";
    return "difficulty-beginner";
  }

  function specCard(spec) {
    const id = idOf(spec, "specialization_id");
    return `
      <article class="card sqr-card sqr-click-card" data-href="Specialization.html?id=${escapeHTML(id)}">
        ${cardImage(spec)}
        <div class="sqr-card-body">
          <h3>${escapeHTML(spec.name || "Specialization")}</h3>
          <p>${escapeHTML(spec.description || "")}</p>
          <div class="sqr-card-actions">
            <a class="btn btn-primary" href="Specialization.html?id=${escapeHTML(id)}">View Details</a>
          </div>
        </div>
      </article>
    `;
  }

  function courseCard(course) {
    const id = idOf(course, "course_id");
    const level = course.level || course.difficulty || "Beginner";
    return `
      <article class="card sqr-card sqr-click-card" data-href="courses.html?id=${escapeHTML(id)}">
        ${cardImage(course)}
        <div class="sqr-card-body">
          <div class="sqr-card-top">
            <span class="badge difficulty-badge ${difficultyClass(level)}">${escapeHTML(level)}</span>
            ${course.specialization_name ? `<span class="badge badge-soft">${escapeHTML(course.specialization_name)}</span>` : ""}
          </div>
          <h3>${escapeHTML(course.title || "Course")}</h3>
          <p>${escapeHTML(course.description || "")}</p>
          <div class="sqr-card-actions">
            <a class="btn btn-primary" href="courses.html?id=${escapeHTML(id)}">Open Course</a>
          </div>
        </div>
      </article>
    `;
  }

  function jobCard(job) {
    const id = idOf(job, "job_id");
    return `
      <article class="card sqr-card">
        <div class="sqr-card-body">
          <div class="sqr-card-top">
            ${job.specialization_name || job.specialization ? `<span class="badge">${escapeHTML(job.specialization_name || job.specialization)}</span>` : ""}
            ${job.average_salary || job.salary ? `<span class="badge badge-soft">${escapeHTML(job.average_salary || job.salary)}</span>` : ""}
          </div>
          <h3>${escapeHTML(job.title || "Job")}</h3>
          <p>${escapeHTML(job.description || "")}</p>
          <p class="muted">${escapeHTML(job.required_skills || job.skills || "")}</p>
          <div class="sqr-card-actions">
            ${job.job_link || job.link ? `<a class="btn btn-primary" target="_blank" rel="noopener" href="${escapeHTML(job.job_link || job.link)}">Open Job</a>` : ""}
            <a class="btn" href="jobs.html?id=${escapeHTML(id)}">Details</a>
          </div>
        </div>
      </article>
    `;
  }

  function enableClickCards(root = document) {
    $all(".sqr-click-card[data-href]", root).forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button, input, select, textarea")) return;
        location.href = card.dataset.href;
      });
    });
  }

  async function loadSpecializations() {
    const detailId = getParam("id", "specialization_id", "spec_id");
    if (detailId && (pageName.includes("specialization") || $("#specializationDetails"))) {
      await loadSpecializationDetails(detailId);
      return;
    }

    const box = first("#specializationsBox", "#specializationGrid", "#specializationsList", "#specializationList", "#specializationsContainer", "#specializationsGrid", "[data-specializations]");
    if (!box) return;
    setLoading(box);
    try {
      const search = valueOf("search", "specializationSearch");
      const data = await apiFetch(`/api/specializations${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      const specs = asArray(data, "specializations");
      box.innerHTML = specs.length
        ? specs.map(specCard).join("")
        : `<div class="card sqr-card">No specializations found.</div>`;
      enableClickCards(box);
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function getSpecializationStatus(specId) {
    if (!getToken()) return { enrolled: false, progress: 0 };
    try {
      return await apiFetch(`/api/specializations/${specId}/enrollment-status`);
    } catch {
      return { enrolled: false, progress: 0 };
    }
  }

  async function loadSpecializationDetails(forcedId) {
    const specId = forcedId || getParam("id", "specialization_id", "spec_id");
    const box = first("#specializationDetails", "#specializationDetail", "#details", "[data-specialization-details]");
    if (!box || !specId) return;
    setLoading(box);

    try {
      const data = await apiFetch(`/api/specializations/${specId}`);
      const spec = data.specialization || data;
      const courses = asArray(data, "courses");
      const jobs = asArray(data, "jobs");
      const status = await getSpecializationStatus(specId);
      const progress = pct(status.progress_percentage ?? status.progress ?? 0);

      box.innerHTML = `
        <section class="card sqr-hero-card">
          ${cardImage(spec)}
          <div class="sqr-card-body">
            <h1>${escapeHTML(spec.name || "Specialization")}</h1>
            <p>${escapeHTML(spec.description || "")}</p>
            <div class="sqr-progress-line">
              <div><strong>${progress}%</strong> progress</div>
              <div class="progress"><span style="width:${progress}%"></span></div>
            </div>
            <div class="sqr-card-actions" id="specializationEnrollArea">
              ${
                status.enrolled
                  ? `<button class="btn btn-danger" id="unenrollSpecBtn">Unenroll</button>`
                  : `<button class="btn btn-primary" id="enrollSpecBtn">Enroll</button>`
              }
            </div>
          </div>
        </section>

        ${spec.roadmap ? `<section class="card sqr-card"><h2>Roadmap</h2><p>${escapeHTML(spec.roadmap)}</p></section>` : ""}

        <section class="sqr-section">
          <h2>Courses</h2>
          ${courses.length ? `<div class="sqr-grid">${courses.map(courseCard).join("")}</div>` : `<div class="card sqr-card">No courses yet.</div>`}
        </section>

        <section class="sqr-section">
          <h2>Related Jobs</h2>
          ${jobs.length ? `<div class="sqr-grid">${jobs.map(jobCard).join("")}</div>` : `<div class="card sqr-card">No jobs yet.</div>`}
        </section>
      `;

      $("#enrollSpecBtn")?.addEventListener("click", async () => {
        try {
          await apiFetch(`/api/specializations/${specId}/enroll`, { method: "POST", body: {} });
          message("Enrolled successfully.", "success");
          await loadSpecializationDetails(specId);
        } catch (err) {
          message(err.message, "error");
        }
      });

      $("#unenrollSpecBtn")?.addEventListener("click", async () => {
        if (!confirm("Unenroll from this specialization? Course enrollment for this specialization will also be removed.")) return;
        try {
          await apiFetch(`/api/specializations/${specId}/unenroll`, { method: "DELETE" });
          message("Unenrolled successfully.", "success");
          await loadSpecializationDetails(specId);
        } catch (err) {
          message(err.message, "error");
        }
      });

      enableClickCards(box);
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function loadCourses() {
    const detailId = getParam("id", "course_id");
    if (detailId && (pageName.includes("courses") || $("#courseDetails"))) {
      await loadCourseDetails(detailId);
      return;
    }

    const box = first("#coursesBox", "#coursesList", "#courseList", "#coursesContainer", "#coursesGrid", "[data-courses]");
    if (!box) return;
    setLoading(box);

    try {
      const params = new URLSearchParams();
      const search = valueOf("search", "courseSearch");
      const specId = getParam("specialization_id", "spec_id") || valueOf("specialization_id", "spec_id");
      if (search) params.set("search", search);
      if (specId) params.set("specialization_id", specId);
      const data = await apiFetch(`/api/courses${params.toString() ? `?${params}` : ""}`);
      let courses = asArray(data, "courses");
      const difficulty = selectedDifficulty();
      if (difficulty) {
        courses = courses.filter((course) => String(course.level || course.difficulty || "").toLowerCase() === difficulty);
      }
      box.innerHTML = courses.length
        ? courses.map(courseCard).join("")
        : `<div class="card sqr-card">No courses found.</div>`;
      enableClickCards(box);
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function getCourseStatus(courseId) {
    if (!getToken()) return { enrolled: false, progress: 0, specialization_enrolled: false };
    try {
      return await apiFetch(`/api/courses/${courseId}/enrollment-status`);
    } catch {
      return { enrolled: false, progress: 0, specialization_enrolled: false };
    }
  }

  function quizListHTML(quizzes) {
    if (!quizzes.length) return `<div class="card sqr-card">No quiz modules for this course yet.</div>`;
    return quizzes.map((quiz) => {
      const id = idOf(quiz, "quiz_id");
      return `
        <article class="card sqr-card sqr-module-card">
          <div>
            <h3>${escapeHTML(quiz.title || quiz.name || "Quiz Module")}</h3>
            <p>${escapeHTML(quiz.description || "")}</p>
          </div>
          <button class="btn btn-primary" data-start-quiz="${escapeHTML(id)}">Start Quiz</button>
        </article>
      `;
    }).join("");
  }

  async function loadCourseDetails(forcedId) {
    const courseId = forcedId || getParam("id", "course_id");
    const box = first("#courseDetails", "#courseDetail", "#details", "[data-course-details]");
    if (!box || !courseId) return;
    setLoading(box);

    try {
      const data = await apiFetch(`/api/courses/${courseId}`);
      const course = data.course || data;
      const quizzes = asArray(data, "quizzes");
      const status = await getCourseStatus(courseId);
      const progress = pct(status.progress_percentage ?? status.progress ?? 0);
      const video = absoluteMedia(course.video_url || course.video);
      const link = course.course_link || course.link;

      box.innerHTML = `
        <section class="card sqr-hero-card">
          ${cardImage(course)}
          <div class="sqr-card-body">
            <div class="sqr-card-top">
              <span class="badge difficulty-badge ${difficultyClass(course.level || course.difficulty || "Beginner")}">${escapeHTML(course.level || course.difficulty || "Beginner")}</span>
              ${course.specialization_name ? `<span class="badge badge-soft">${escapeHTML(course.specialization_name)}</span>` : ""}
            </div>
            <h1>${escapeHTML(course.title || "Course")}</h1>
            <p>${escapeHTML(course.description || "")}</p>

            <div class="sqr-progress-line">
              <div><strong>${progress}%</strong> course progress</div>
              <div class="progress"><span style="width:${progress}%"></span></div>
            </div>

            <div class="sqr-card-actions" id="courseEnrollArea">
              ${
                status.enrolled
                  ? `<button class="btn btn-danger" id="unenrollCourseBtn">Unenroll Course</button>`
                  : `<button class="btn btn-primary" id="enrollCourseBtn">Enroll Course</button>`
              }
              ${link ? `<a class="btn" target="_blank" rel="noopener" id="courseExternalLink" href="${escapeHTML(link)}">Open Link</a>` : ""}
            </div>
          </div>
        </section>

        ${
          video
            ? `<section class="card sqr-card">
                <h2>Course Video</h2>
                <video id="courseVideo" controls preload="metadata" src="${escapeHTML(video)}"></video>
              </section>`
            : ""
        }

        <section class="sqr-section">
          <h2>Course Modules & Quizzes</h2>
          <div id="courseQuizModules">${quizListHTML(quizzes)}</div>
          <div id="quizRuntime"></div>
        </section>
      `;

      $("#enrollCourseBtn")?.addEventListener("click", async () => {
        try {
          await apiFetch(`/api/courses/${courseId}/enroll`, { method: "POST", body: {} });
          message("Course enrolled successfully.", "success");
          await loadCourseDetails(courseId);
        } catch (err) {
          if (err.status === 409 && err.data?.specialization_id) {
            message("Enroll in the specialization first, then open or enroll in the course.", "error");
          } else {
            message(err.message, "error");
          }
        }
      });

      $("#unenrollCourseBtn")?.addEventListener("click", async () => {
        if (!confirm("Unenroll from this course?")) return;
        try {
          await apiFetch(`/api/courses/${courseId}/unenroll`, { method: "DELETE" });
          message("Course unenrolled successfully.", "success");
          await loadCourseDetails(courseId);
        } catch (err) {
          message(err.message, "error");
        }
      });

      $("#courseExternalLink")?.addEventListener("click", () => {
        trackCourseOpened(courseId, false);
      });

      const videoEl = $("#courseVideo");
      if (videoEl) {
        videoEl.addEventListener("play", () => trackCourseOpened(courseId, false), { once: true });
        videoEl.addEventListener("ended", () => trackCourseOpened(courseId, true));
      }

      $all("[data-start-quiz]", box).forEach((btn) => {
        btn.addEventListener("click", () => loadQuizRuntime(btn.dataset.startQuiz));
      });
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function trackCourseOpened(courseId, completed = false) {
    if (!getToken() || !courseId) return;
    try {
      await apiFetch(`/api/courses/${courseId}/open`, {
        method: "POST",
        body: { completed: Boolean(completed) },
      });
    } catch (err) {
      console.warn("Course tracking failed:", err.message);
    }
  }

  async function loadQuizRuntime(quizId) {
    const box = first("#quizRuntime", "#quizContainer", "#quizDetails");
    if (!box || !quizId) return;
    setLoading(box, "Loading quiz...");

    try {
      const data = await apiFetch(`/api/quizzes/${quizId}`);
      const quiz = data.quiz || {};
      const questions = asArray(data, "questions");

      box.innerHTML = `
        <form id="runtimeQuizForm" class="card sqr-card">
          <h2>${escapeHTML(quiz.title || "Quiz")}</h2>
          ${questions.map((q, index) => {
            const qid = idOf(q, "question_id");
            const options = q.options || [q.option_a || q.option1, q.option_b || q.option2, q.option_c || q.option3, q.option_d || q.option4];
            return `
              <fieldset class="sqr-question">
                <legend>${index + 1}. ${escapeHTML(q.question || q.question_text || "")}</legend>
                ${options.map((option, i) => {
                  const letter = ["A", "B", "C", "D"][i];
                  return option ? `
                    <label>
                      <input type="radio" name="q_${escapeHTML(qid)}" value="${letter}" required>
                      <span>${escapeHTML(option)}</span>
                    </label>
                  ` : "";
                }).join("")}
              </fieldset>
            `;
          }).join("")}
          <button class="btn btn-primary" type="submit">Submit Quiz</button>
          <div id="quizResult"></div>
        </form>
      `;

      $("#runtimeQuizForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const answers = {};
        questions.forEach((q) => {
          const qid = String(idOf(q, "question_id"));
          const checked = $(`[name="q_${CSS.escape(qid)}"]:checked`);
          answers[qid] = checked?.value || "";
        });

        try {
          const result = await apiFetch(`/api/quizzes/${quizId}/submit`, {
            method: "POST",
            body: { answers },
          });
          const score = pct(result.score_percentage);
          $("#quizResult").innerHTML = `
            <div class="sqr-score-ring" style="--score:${score}">
              <strong>${score}%</strong>
              <span>${result.passed ? "Passed" : "Try again"}</span>
            </div>
            ${
              result.course_progress_tracked
                ? `<p class="success">Course progress updated.</p>`
                : `<p class="muted">Quiz saved, but course progress was not changed because you are not enrolled in the course.</p>`
            }
          `;
          loadCourseDetails(getParam("id", "course_id"));
        } catch (err) {
          message(err.message, "error", $("#quizResult"));
        }
      });
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function loadJobs() {
    const box = first("#jobsList", "#jobList", "#jobsContainer", "#jobsGrid", "[data-jobs]");
    if (!box) return;
    setLoading(box);
    try {
      const params = new URLSearchParams();
      const search = valueOf("search", "jobSearch");
      const specId = getParam("specialization_id", "spec_id") || valueOf("specialization_id", "spec_id");
      if (search) params.set("search", search);
      if (specId) params.set("specialization_id", specId);
      const data = await apiFetch(`/api/jobs${params.toString() ? `?${params}` : ""}`);
      const jobs = asArray(data, "jobs");
      box.innerHTML = jobs.length ? `<div class="sqr-grid">${jobs.map(jobCard).join("")}</div>` : `<div class="card sqr-card">No jobs found.</div>`;
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function loadProfile() {
    const box = first("#profileBox", "#profileContainer", "#profileDetails", "[data-profile]");
    const progressBox = first("#profileProgress", "#progressList", "#progressContainer", "[data-progress]");
    if (!box && !progressBox) return;
    if (!getToken()) return;

    if (box) setLoading(box, "Loading profile...");
    if (progressBox) setLoading(progressBox, "Loading progress...");

    try {
      const profile = await apiFetch("/api/profile");
      const user = profile.user || profile;
      setUser(user);

      if (box) {
        const quizHistory = asArray(profile, "quiz_history");
        const atsHistory = asArray(profile, "ats_history");
        box.innerHTML = `
          <section class="card sqr-card">
            <h1>${escapeHTML(user.name || "Profile")}</h1>
            <p>${escapeHTML(user.email || "")}</p>
            <p><strong>Role:</strong> ${escapeHTML(user.role || "student")}</p>
            ${user.skills ? `<p><strong>Skills:</strong> ${escapeHTML(user.skills)}</p>` : ""}
            ${user.interests ? `<p><strong>Interests:</strong> ${escapeHTML(user.interests)}</p>` : ""}
          </section>
          ${
            quizHistory.length
              ? `<section class="card sqr-card"><h2>Quiz History</h2>${quizHistory.slice(0, 8).map((q) => `<p>${escapeHTML(q.quiz_title || "Quiz")} — <strong>${pct(q.score_percentage || q.score)}%</strong></p>`).join("")}</section>`
              : ""
          }
          ${
            atsHistory.length
              ? `<section class="card sqr-card"><h2>ATS History</h2>${atsHistory.slice(0, 5).map((a) => `<p>${escapeHTML(a.target_job || "Resume")} — <strong>${pct(a.ats_score || a.score)}%</strong></p>`).join("")}</section>`
              : ""
          }
        `;
      }

      if (progressBox) await loadProfileProgress(progressBox);
    } catch (err) {
      if (box) box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
      if (progressBox) progressBox.innerHTML = "";
    }
  }

  async function loadProfileProgress(targetBox) {
    const box = targetBox || first("#profileProgress", "#progressList", "#progressContainer", "[data-progress]");
    if (!box) return;
    try {
      const data = await apiFetch("/api/profile/progress");
      const rows = asArray(data, "progress");
      box.innerHTML = rows.length
        ? rows.map((row) => {
            const progress = pct(row.progress ?? row.percentage);
            return `
              <article class="card sqr-card sqr-progress-card">
                <div class="sqr-progress-title">
                  <h3>${escapeHTML(row.specialization_name || row.name || "Specialization")}</h3>
                  <strong>${progress}%</strong>
                </div>
                <div class="progress"><span style="width:${progress}%"></span></div>
                <p class="muted">
                  ${escapeHTML(row.opened_courses || 0)} opened /
                  ${escapeHTML(row.completed_courses || 0)} completed /
                  ${escapeHTML(row.total_courses || 0)} total courses
                </p>
              </article>
            `;
          }).join("")
        : `<div class="card sqr-card">No enrolled specializations yet. Enroll first to start tracking progress.</div>`;
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  function setupATS() {
    const generateForm = first("#atsGenerateForm", "#atsGeneratorForm", "form[data-ats='generate']");
    const checkForm = first("#atsCheckForm", "#atsCheckerForm", "form[data-ats='check']");
    const output = first("#atsOutput", "#atsResult", "#resumeResult", "#generatedResume", "[data-ats-output]");

    if (generateForm) {
      generateForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (output) { revealBox(output); output.innerHTML = `<div class="card sqr-card">Generating with AI...</div>`; }
        try {
          const formData = new FormData(generateForm);
          const result = await apiFetch("/api/ats/generate", { method: "POST", body: formData });
          renderATSGenerate(result, output);
        } catch (err) {
          message(err.message, "error", output);
        }
      });
    }

    if (checkForm) {
      checkForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (output) { revealBox(output); output.innerHTML = `<div class="card sqr-card">Checking resume...</div>`; }
        try {
          const formData = new FormData(checkForm);
          const result = await apiFetch("/api/ats/check", { method: "POST", body: formData });
          renderATSCheck(result, output);
        } catch (err) {
          message(err.message, "error", output);
        }
      });
    }

    $all("[data-export]").forEach((btn) => {
      btn.addEventListener("click", () => exportResume(btn.dataset.export));
    });
  }

  function safeLink(value) {
    const link = String(value || "").trim();
    if (!link) return "";
    if (/^https?:\/\//i.test(link)) return link;
    if (/^(www\.)?(linkedin\.com|github\.com)\//i.test(link)) return `https://${link}`;
    return link;
  }

  function linkHTML(value, label) {
    const link = safeLink(value);
    if (!link) return `<span class="muted">Not provided</span>`;
    return `<a class="sqr-link" href="${escapeHTML(link)}" target="_blank" rel="noopener">${escapeHTML(label || link)}</a>`;
  }

  function renderATSGenerate(result, output) {
    const box = output || first("#atsOutput", "#atsResult", "#resumeResult", "#generatedResume", "[data-ats-output]");
    if (!box) return;
    revealBox(box);
    const fullResume = result.full_resume || result.resume || "";
    const technicalSkills = joinText(result.technical_skills) || "Not provided";
    const softSkills = joinText(result.soft_skills) || "Not provided";
    const linkedin = result.linkedin || result.linkedin_url || "";
    const github = result.github || result.github_url || "";
    const providerLabel = result.ai_powered
      ? `AI Generated: ${escapeHTML(result.ai_provider || "grok")}`
      : "Dynamic fallback";

    box.innerHTML = `
      <section class="card sqr-card ats-pro-result">
        <div class="sqr-card-top ats-pro-header">
          <div>
            <span class="badge ${result.ai_powered ? "badge-ai" : "badge-warning"}">${providerLabel}</span>
            ${result.target_role || result.headline ? `<span class="badge badge-soft">${escapeHTML(result.target_role || result.headline)}</span>` : ""}
          </div>
        </div>

        <div class="ats-summary-card">
          <span class="panel-kicker">Enhanced Summary</span>
          <p>${escapeHTML(result.enhanced_summary || result.summary || "")}</p>
        </div>

        <div class="ats-pro-grid">
          <article>
            <h3>Technical Skills</h3>
            <p>${escapeHTML(technicalSkills)}</p>
          </article>
          <article>
            <h3>Soft Skills</h3>
            <p>${escapeHTML(softSkills)}</p>
          </article>
          <article>
            <h3>LinkedIn</h3>
            <p>${linkHTML(linkedin, "Open LinkedIn")}</p>
          </article>
          <article>
            <h3>GitHub</h3>
            <p>${linkHTML(github, "Open GitHub")}</p>
          </article>
        </div>

        <div class="ats-resume-preview">
          <div class="ats-resume-preview-head">
            <div>
              <span class="panel-kicker">Professional CV Layout</span>
              <h2>Full ATS Resume</h2>
            </div>
            <span class="badge badge-soft">Editable before export</span>
          </div>
          <textarea id="finalResumeText" class="sqr-resume-textarea" spellcheck="true">${escapeHTML(fullResume)}</textarea>
        </div>

        <div class="ats-improvements">
          <h2>Improvements</h2>
          <ul>${asArray(result.improvements || []).map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>
        </div>

        <div class="sqr-card-actions ats-action-row">
          <button class="btn btn-secondary ats-action-btn" type="button" data-copy-resume>Copy Resume</button>
          <button class="btn btn-primary ats-action-btn" type="button" data-export="pdf">Export PDF</button>
          <button class="btn btn-primary ats-action-btn" type="button" data-export="docx">Export DOCX</button>
        </div>
      </section>
    `;
    $("[data-copy-resume]", box)?.addEventListener("click", async () => {
      await navigator.clipboard.writeText($("#finalResumeText")?.value || fullResume);
      message("Resume copied.", "success");
    });
    $all("[data-export]", box).forEach((btn) => btn.addEventListener("click", () => exportResume(btn.dataset.export)));
  }

  function renderATSCheck(result, output) {
    const box = output || first("#atsOutput", "#atsResult", "[data-ats-output]");
    if (!box) return;
    revealBox(box);
    const score = pct(result.ats_score || result.score);
    box.innerHTML = `
      <section class="card sqr-card">
        <div class="sqr-score-ring" style="--score:${score}">
          <strong>${score}%</strong>
          <span>ATS Score</span>
        </div>
        <h2>Summary</h2>
        <p>${escapeHTML(result.summary || "")}</p>

        <h2>Matched Keywords</h2>
        <p>${escapeHTML(joinText(result.matched_keywords))}</p>

        <h2>Missing Keywords</h2>
        <p>${escapeHTML(joinText(result.missing_keywords))}</p>

        <h2>Improvements</h2>
        <ul>${asArray(result.improvements || result.suggestions || []).map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>
      </section>
    `;
  }

  async function exportResume(type) {
    const text = $("#finalResumeText")?.value || first("[data-resume-text]")?.textContent || "";
    if (!text.trim()) {
      message("Generate a resume first.", "error");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/ats/export/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ resume: text, text }),
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "docx" ? "sqr_resume.docx" : "sqr_resume.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      message(err.message, "error");
    }
  }

  function setupRecommendation() {
    const form = first("#recommendationForm", "#recommendForm", "form[data-recommendation]");
    const box = first("#recommendationResult", "#recommendationOutput", "#recommendResult", "[data-recommendation-output]");
    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (box) { revealBox(box); box.innerHTML = `<div class="card sqr-card">Analyzing your answers...</div>`; }

      const formData = Object.fromEntries(new FormData(form).entries());
      const answers = [];
      $all("[data-question-id]", form).forEach((el) => {
        answers.push({
          id: el.dataset.questionId,
          value: el.value,
        });
      });
      if (answers.length) formData.answers = answers;

      try {
        const result = await apiFetch("/api/recommendations", { method: "POST", body: formData });
        renderRecommendation(result, box);
      } catch (err) {
        if (box) box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
        else message(err.message, "error");
      }
    });
  }

  function renderRecommendation(result, box) {
    const target = box || first("#recommendationResult", "#recommendationOutput", "#recommendResult", "[data-recommendation-output]");
    if (!target) return;
    revealBox(target);

    const specs = asArray(result, "recommended_specializations", "specializations");
    const jobs = asArray(result, "recommended_jobs", "jobs");
    const roadmap = asArray(result, "roadmap");

    target.innerHTML = `
      <section class="sqr-section">
        <div class="sqr-card-top"><span class="badge">${result.ai_powered ? `AI assisted: ${escapeHTML(result.ai_provider || "AI")}` : "Dynamic matching"}</span></div>
        <h2>Recommended Specializations</h2>
        ${
          specs.length
            ? `<div class="sqr-grid">${specs.slice(0, 6).map((spec) => `
                <article class="card sqr-card">
                  <div class="sqr-card-body">
                    <div class="sqr-score-ring small" style="--score:${pct(spec.match_percentage || spec.score)}">
                      <strong>${pct(spec.match_percentage || spec.score)}%</strong>
                    </div>
                    <h3>${escapeHTML(spec.name || "Specialization")}</h3>
                    <p>${escapeHTML(spec.reason || spec.description || "")}</p>
                    <a class="btn btn-primary" href="Specialization.html?id=${escapeHTML(spec.specialization_id || spec.id)}">View</a>
                  </div>
                </article>
              `).join("")}</div>`
            : `<div class="card sqr-card">No recommendations yet.</div>`
        }
      </section>

      <section class="sqr-section">
        <h2>Recommended Jobs</h2>
        ${jobs.length ? `<div class="sqr-grid">${jobs.slice(0, 6).map(jobCard).join("")}</div>` : `<div class="card sqr-card">No job recommendations yet.</div>`}
      </section>

      ${
        roadmap.length
          ? `<section class="card sqr-card"><h2>Roadmap</h2><ol>${roadmap.map((step) => `<li>${escapeHTML(step)}</li>`).join("")}</ol></section>`
          : ""
      }
    `;
  }

  async function populateAdminSelects() {
    try {
      const [specData, courseData] = await Promise.all([
        apiFetch("/api/specializations"),
        apiFetch("/api/courses"),
      ]);
      const specs = asArray(specData, "specializations");
      const courses = asArray(courseData, "courses");

      $all("select[name='specialization_id'], select[name='spec_id'], #specializationSelect, #courseSpecialization").forEach((select) => {
        const current = select.value;
        select.innerHTML = `<option value="">Select specialization</option>` + specs.map((s) => `<option value="${escapeHTML(idOf(s, "specialization_id"))}">${escapeHTML(s.name)}</option>`).join("");
        if (current) select.value = current;
      });

      $all("select[name='course_id'], #quizCourseSelect").forEach((select) => {
        const current = select.value;
        select.innerHTML = `<option value="">Select course</option>` + courses.map((c) => `<option value="${escapeHTML(idOf(c, "course_id"))}">${escapeHTML(c.title)}</option>`).join("");
        if (current) select.value = current;
      });
    } catch (err) {
      console.warn("Admin selects failed:", err.message);
    }
  }

  function setupAdminForm(selector, endpoint, options = {}) {
    const form = first(selector);
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const hasFile = Boolean($("input[type='file']", form));
        const body = hasFile ? new FormData(form) : Object.fromEntries(new FormData(form).entries());

        if (options.questions) {
          const questions = collectQuizQuestions(form);
          if (hasFile) body.append("questions_json", JSON.stringify(questions));
          else body.questions = questions;
        }

        const result = await apiFetch(endpoint, { method: "POST", body });
        message(result.message || "Saved successfully.", "success");
        form.reset();
        await populateAdminSelects();
        await renderAdminLists();
      } catch (err) {
        message(err.message, "error");
      }
    });
  }

  function collectQuizQuestions(form) {
    const rows = $all("[data-question-row]", form);
    if (rows.length) {
      return rows.map((row) => ({
        question: $("[name='question'], [data-field='question']", row)?.value || "",
        option1: $("[name='option1'], [data-field='option1']", row)?.value || "",
        option2: $("[name='option2'], [data-field='option2']", row)?.value || "",
        option3: $("[name='option3'], [data-field='option3']", row)?.value || "",
        option4: $("[name='option4'], [data-field='option4']", row)?.value || "",
        answer: $("[name='answer'], [data-field='answer']", row)?.value || "A",
      }));
    }

    const question = valueOf("question", "question_text");
    if (!question) return [];
    return [{
      question,
      option1: valueOf("option1", "option_a"),
      option2: valueOf("option2", "option_b"),
      option3: valueOf("option3", "option_c"),
      option4: valueOf("option4", "option_d"),
      answer: valueOf("answer", "correct_answer") || "A",
    }];
  }

  async function loadAdmin() {
    if (!pageName.includes("admin") && !$("#adminDashboard")) return;
    requireAdmin();
    await populateAdminSelects();
    setupAdminForm("#addSpecializationForm", "/api/specializations");
    setupAdminForm("#specializationForm", "/api/specializations");
    setupAdminForm("#addCourseForm", "/api/courses");
    setupAdminForm("#courseForm", "/api/courses");
    setupAdminForm("#addJobForm", "/api/jobs");
    setupAdminForm("#jobForm", "/api/jobs");
    setupAdminForm("#addCertificateForm", "/api/certificates");
    setupAdminForm("#certificateForm", "/api/certificates");
    setupAdminForm("#addQuizForm", "/api/quizzes", { questions: true });
    setupAdminForm("#quizForm", "/api/quizzes", { questions: true });

    $all("form[data-api]").forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = "1";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const endpoint = form.dataset.api;
        const method = form.dataset.method || "POST";
        const hasFile = Boolean($("input[type='file']", form));
        const body = hasFile ? new FormData(form) : Object.fromEntries(new FormData(form).entries());
        try {
          const result = await apiFetch(endpoint, { method, body });
          message(result.message || "Saved successfully.", "success");
          form.reset();
          await populateAdminSelects();
          await renderAdminLists();
        } catch (err) {
          message(err.message, "error");
        }
      });
    });

    await renderAdminStats();
    await renderAdminLists();
  }

  async function renderAdminStats() {
    const box = first("#adminStats", "#stats", "[data-admin-stats]");
    if (!box) return;
    try {
      const data = await apiFetch("/api/admin/stats");
      const entries = Object.entries(data).filter(([, value]) => typeof value === "number");
      box.innerHTML = `<div class="sqr-stats-grid">${entries.map(([key, value]) => `
        <article class="card sqr-stat-card">
          <strong>${escapeHTML(value)}</strong>
          <span>${escapeHTML(key.replaceAll("_", " "))}</span>
        </article>
      `).join("")}</div>`;
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function renderAdminLists() {
    const box = first("#adminLists", "#adminData", "[data-admin-lists]");
    if (!box) return;
    try {
      const [specData, courseData, jobData] = await Promise.all([
        apiFetch("/api/specializations"),
        apiFetch("/api/courses"),
        apiFetch("/api/jobs"),
      ]);
      const specs = asArray(specData, "specializations").slice(0, 8);
      const courses = asArray(courseData, "courses").slice(0, 8);
      const jobs = asArray(jobData, "jobs").slice(0, 8);

      box.innerHTML = `
        <section class="card sqr-card">
          <h2>Latest Specializations</h2>
          ${adminRows(specs, "specializations", "specialization_id", "name")}
        </section>
        <section class="card sqr-card">
          <h2>Latest Courses</h2>
          ${adminRows(courses, "courses", "course_id", "title")}
        </section>
        <section class="card sqr-card">
          <h2>Latest Jobs</h2>
          ${adminRows(jobs, "jobs", "job_id", "title")}
        </section>
      `;
      $all("[data-delete-admin]", box).forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this item?")) return;
          try {
            await apiFetch(btn.dataset.deleteAdmin, { method: "DELETE" });
            message("Deleted.", "success");
            await renderAdminLists();
          } catch (err) {
            message(err.message, "error");
          }
        });
      });
    } catch (err) {
      box.innerHTML = `<div class="card sqr-card error">${escapeHTML(err.message)}</div>`;
    }
  }

  function adminRows(items, endpoint, idKey, labelKey) {
    if (!items.length) return `<p class="muted">No data yet.</p>`;
    return `<div class="sqr-admin-rows">${items.map((item) => {
      const id = idOf(item, idKey);
      return `
        <div class="sqr-admin-row">
          <span>${escapeHTML(item[labelKey] || item.name || item.title || id)}</span>
          <button class="btn btn-small btn-danger" type="button" data-delete-admin="/api/${endpoint}/${escapeHTML(id)}">Delete</button>
        </div>
      `;
    }).join("")}</div>`;
  }

  function bindSearchReloads() {
    $all("input[type='search'], #search, #courseSearch, #specializationSearch, #jobSearch").forEach((input) => {
      if (input.dataset.sqrSearchBound) return;
      input.dataset.sqrSearchBound = "1";
      let timer;
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (pageName.includes("course")) loadCourses();
          else if (pageName.includes("job")) loadJobs();
          else loadSpecializations();
        }, 350);
      });
    });
  }

  async function loadHomeDashboard() {
    const specCount = first("#homeSpecCount", "[data-home-spec-count]");
    const courseCount = first("#homeCourseCount", "[data-home-course-count]");
    const jobCount = first("#homeJobCount", "[data-home-job-count]");
    if (!specCount && !courseCount && !jobCount) return;

    try {
      const data = await apiFetch("/api/home/dashboard");
      const stats = data.stats || data || {};
      if (specCount) specCount.textContent = stats.specializations ?? stats.specs ?? 0;
      if (courseCount) courseCount.textContent = stats.courses ?? 0;
      if (jobCount) jobCount.textContent = stats.jobs ?? 0;
    } catch (err) {
      console.error("Home dashboard failed:", err);
    }
  }

  async function boot() {
    navbar();
    ensurePageMounts();
    await populatePublicSpecializationFilters();
    bindSearchReloads();
    bindFilterReloads();

    if (isLoggedIn()) {
      refreshMe().then(() => {
        navbar();
        blockAdminFromStudentPages();
      });
    }

    setupSignup();
    setupSignin();

    if (pageName.includes("profile")) requireLogin();
    if (pageName.includes("admin")) requireAdmin();
    if (pageName.includes("ats") || pageName.includes("recommendation")) {
      if (!isLoggedIn()) requireLogin();
    }

    await Promise.allSettled([
      loadHomeDashboard(),
      loadSpecializations(),
      loadCourses(),
      loadJobs(),
      loadProfile(),
    ]);

    setupRecommendation();
    setupATS();
    await loadAdmin();
  }

  window.sqr = {
    apiFetch,
    navbar,
    requireLogin,
    requireAdmin,
    blockAdminFromStudentPages,
    setupSignup,
    setupSignin,
    loadProfile,
    loadProfileProgress,
    loadSpecializations,
    loadSpecializationDetails,
    loadCourses,
    loadCourseDetails,
    loadJobs,
    setupRecommendation,
    setupATS,
    loadAdmin,
    loadHomeDashboard,
    trackCourseOpened,
    populatePublicSpecializationFilters,
  };
  const adminState = {
    specializations: [],
    courses: [],
    quizzes: [],
    jobs: [],
    certificates: [],
    users: [],
  };

  function adminPlural(type) {
    const map = {
      specialization: "specializations",
      course: "courses",
      quiz: "quizzes",
      job: "jobs",
      certificate: "certificates",
      user: "users",
    };
    return map[type] || type;
  }

  function adminEndpoint(type, id = "") {
    const plural = adminPlural(type);
    if (plural === "users") return id ? `/api/admin/users/${id}` : "/api/admin/users";
    return id ? `/api/admin/${plural}/${encodeURIComponent(id)}` : `/api/admin/${plural}`;
  }

  async function adminRequest(url, options = {}) {
    return apiFetch(url, options);
  }

  function showAdminMessage(text, type = "success") {
    message(text, type === "error" ? "error" : "success");
  }

  function getList(data, keys) {
    for (const key of keys) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  function adminItemId(item) {
    return idOf(item, "specialization_id", "course_id", "quiz_id", "job_id", "certificate_id", "certification_id", "user_id");
  }

  function adminItemTitle(item, type) {
    return item?.title || item?.name || item?.full_name || item?.email || `${type} #${adminItemId(item)}`;
  }

  function adminItemSubtitle(item) {
    return item?.description || item?.specialization_name || item?.course_title || item?.role || item?.level || item?.difficulty || item?.email || "";
  }

  function setupAdminTabs() {
    $all("[data-admin-tab]").forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const tab = btn.dataset.adminTab;
        $all("[data-admin-tab]").forEach((b) => b.classList.remove("active"));
        $all(".admin-section").forEach((section) => section.classList.remove("active"));
        btn.classList.add("active");
        $(`#admin-${tab}`)?.classList.add("active");
      });
    });
  }

  function fillSpecSelect(id, specializations) {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Select specialization</option>` + specializations.map((spec) => {
      const value = adminItemId(spec);
      return `<option value="${escapeHTML(value)}">${escapeHTML(spec.name || spec.title || "Specialization")}</option>`;
    }).join("");
    if (current) select.value = current;
  }

  function fillCourseSelect(id, courses) {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Select course</option>` + courses.map((course) => {
      const value = adminItemId(course);
      return `<option value="${escapeHTML(value)}">${escapeHTML(course.title || course.name || "Course")}</option>`;
    }).join("");
    if (current) select.value = current;
  }

  function updateAdminStats(type, count) {
    const box = document.getElementById("adminStatsBox");
    if (!box) return;
    const current = box.dataset.stats ? JSON.parse(box.dataset.stats) : {};
    current[type] = count;
    box.dataset.stats = JSON.stringify(current);
    const labels = {
      specializations: "Specializations",
      courses: "Courses",
      quizzes: "Quizzes",
      jobs: "Jobs",
      certificates: "Certificates",
      users: "Users",
    };
    box.innerHTML = Object.entries(labels).map(([key, label]) => `
      <article class="card stat-card admin-stat-tile">
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(current[key] ?? 0)}</strong>
      </article>
    `).join("");
  }

  function renderAdminList(id, items, type) {
    const box = document.getElementById(id);
    if (!box) return;
    if (!items.length) {
      box.innerHTML = `
        <article class="admin-row">
          <div>
            <strong>No ${escapeHTML(type)}s yet</strong>
            <span>Add one using the form above.</span>
          </div>
        </article>
      `;
      return;
    }

    box.innerHTML = items.map((item) => {
      const itemId = adminItemId(item);
      const title = adminItemTitle(item, type);
      const subtitle = adminItemSubtitle(item);
      return `
        <article class="admin-row">
          <div>
            <strong>${escapeHTML(title)}</strong>
            <span>${escapeHTML(subtitle)}</span>
          </div>
          <div class="row-actions">
            ${type !== "user" ? `<button type="button" class="btn btn-mini btn-secondary" data-admin-edit="${escapeHTML(type)}" data-admin-id="${escapeHTML(itemId)}">Edit</button>` : userButtons(item)}
            ${type !== "user" ? `<button type="button" class="btn btn-mini btn-danger" data-admin-delete="${escapeHTML(type)}" data-admin-id="${escapeHTML(itemId)}">Delete</button>` : ""}
          </div>
        </article>
      `;
    }).join("");

    $all("[data-admin-edit]", box).forEach((btn) => {
      btn.addEventListener("click", () => openAdminEditModal(btn.dataset.adminEdit, btn.dataset.adminId));
    });
    $all("[data-admin-delete]", box).forEach((btn) => {
      btn.addEventListener("click", () => deleteAdminItem(btn.dataset.adminDelete, btn.dataset.adminId));
    });
    $all("[data-admin-user-action]", box).forEach((btn) => {
      btn.addEventListener("click", () => adminUserAction(btn.dataset.adminUserAction, btn.dataset.adminId));
    });
  }

  function userButtons(user) {
    const id = adminItemId(user) || user.id;
    const banned = Number(user?.banned || user?.is_banned || 0) === 1;
    const role = String(user?.role || "student").toLowerCase();
    return `
      <button type="button" class="btn btn-mini btn-secondary" data-admin-user-action="${banned ? "unban" : "ban"}" data-admin-id="${escapeHTML(id)}">${banned ? "Unban" : "Ban"}</button>
      <button type="button" class="btn btn-mini btn-secondary" data-admin-user-action="${role === "admin" ? "student" : "admin"}" data-admin-id="${escapeHTML(id)}">Make ${role === "admin" ? "Student" : "Admin"}</button>
    `;
  }

  async function adminUserAction(action, userId) {
    try {
      if (!userId) return;
      if (action === "ban" || action === "unban") {
        await adminRequest(`/api/admin/users/${userId}/${action}`, { method: "POST", body: {} });
      } else {
        await adminRequest(`/api/admin/users/${userId}/role`, { method: "POST", body: { role: action } });
      }
      showAdminMessage("User updated successfully.");
      await loadAdminUsers();
    } catch (err) {
      showAdminMessage(err.message, "error");
    }
  }

  function adminFormPayload(form, type) {
    const hasFile = Boolean($("input[type='file']", form));
    if (hasFile) {
      const fd = new FormData(form);
      if (fd.get("spec_id") && !fd.get("specialization_id")) fd.append("specialization_id", fd.get("spec_id"));
      return fd;
    }
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    if (data.spec_id && !data.specialization_id) data.specialization_id = data.spec_id;
    if (type === "job") {
      data.required_skills = data.required_skills || data.skills || "";
      data.average_salary = data.average_salary || data.salary || "";
      data.job_link = data.job_link || data.link || "";
    }
    if (type === "certificate") {
      data.official_link = data.official_link || data.link || "";
    }
    if (type === "quiz") {
      const raw = String(data.questions_json || "").trim();
      if (raw) {
        data.questions = JSON.parse(raw);
      }
    }
    return data;
  }

  function setupOneAdminForm(formId, type) {
    const form = document.getElementById(formId);
    if (!form || form.dataset.adminCrudBound === "1") return;
    form.dataset.adminCrudBound = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = adminFormPayload(form, type);
        const result = await adminRequest(adminEndpoint(type), { method: "POST", body: payload });
        form.reset();
        showAdminMessage(result.message || "Saved successfully.");
        await loadAdminData();
      } catch (err) {
        showAdminMessage(err.message || "Save failed.", "error");
      }
    });
  }

  function setupAdminForms() {
    setupOneAdminForm("adminSpecializationForm", "specialization");
    setupOneAdminForm("adminCourseForm", "course");
    setupOneAdminForm("adminQuizForm", "quiz");
    setupOneAdminForm("adminJobForm", "job");
    setupOneAdminForm("adminCertificateForm", "certificate");
  }

  async function loadAdminData() {
    await Promise.allSettled([
      loadAdminSpecializations(),
      loadAdminCourses(),
      loadAdminJobs(),
      loadAdminCertificates(),
      loadAdminQuizzes(),
      loadAdminUsers(),
    ]);
  }

  async function loadAdminSpecializations() {
    try {
      const data = await adminRequest("/api/admin/specializations");
      const specializations = getList(data, ["specializations"]);
      adminState.specializations = specializations;
      fillSpecSelect("adminCourseSpecSelect", specializations);
      fillSpecSelect("adminJobSpecSelect", specializations);
      fillSpecSelect("adminCertificateSpecSelect", specializations);
      renderAdminList("adminSpecializationsList", specializations, "specialization");
      updateAdminStats("specializations", specializations.length);
    } catch (err) {
      renderAdminList("adminSpecializationsList", [], "specialization");
      showAdminMessage(err.message, "error");
    }
  }

  async function loadAdminCourses() {
    try {
      const data = await adminRequest("/api/admin/courses");
      const courses = getList(data, ["courses"]);
      adminState.courses = courses;
      fillCourseSelect("adminQuizCourseSelect", courses);
      renderAdminList("adminCoursesList", courses, "course");
      updateAdminStats("courses", courses.length);
    } catch (err) {
      renderAdminList("adminCoursesList", [], "course");
      showAdminMessage(err.message, "error");
    }
  }

  async function loadAdminJobs() {
    try {
      const data = await adminRequest("/api/admin/jobs");
      const jobs = getList(data, ["jobs"]);
      adminState.jobs = jobs;
      renderAdminList("adminJobsList", jobs, "job");
      updateAdminStats("jobs", jobs.length);
    } catch (err) {
      renderAdminList("adminJobsList", [], "job");
    }
  }

  async function loadAdminCertificates() {
    try {
      const data = await adminRequest("/api/admin/certificates");
      const certificates = getList(data, ["certificates", "certifications"]);
      adminState.certificates = certificates;
      renderAdminList("adminCertificatesList", certificates, "certificate");
      updateAdminStats("certificates", certificates.length);
    } catch (err) {
      renderAdminList("adminCertificatesList", [], "certificate");
    }
  }

  async function loadAdminQuizzes() {
    try {
      const data = await adminRequest("/api/admin/quizzes");
      const quizzes = getList(data, ["quizzes"]);
      adminState.quizzes = quizzes;
      renderAdminList("adminQuizzesList", quizzes, "quiz");
      updateAdminStats("quizzes", quizzes.length);
    } catch (err) {
      renderAdminList("adminQuizzesList", [], "quiz");
    }
  }

  async function loadAdminUsers() {
    try {
      const data = await adminRequest("/api/admin/users");
      const users = getList(data, ["users"]);
      adminState.users = users;
      renderAdminList("adminUsersList", users, "user");
      updateAdminStats("users", users.length);
    } catch (err) {
      renderAdminList("adminUsersList", [], "user");
    }
  }

  function findAdminItem(type, id) {
    const list = adminState[adminPlural(type)] || [];
    return list.find((item) => String(adminItemId(item)) === String(id)) || null;
  }

  function editFieldHTML(field, item, type) {
    const name = field.name;
    const value = field.value ?? item?.[name] ?? item?.[field.alt] ?? "";
    if (field.kind === "textarea") {
      return `<label>${escapeHTML(field.label)}<textarea name="${escapeHTML(name)}">${escapeHTML(value)}</textarea></label>`;
    }
    if (field.kind === "select" && field.source === "specializations") {
      const current = value || item?.spec_id || item?.specialization_id;
      return `<label>${escapeHTML(field.label)}<select name="${escapeHTML(name)}"><option value="">Select specialization</option>${adminState.specializations.map((spec) => {
        const id = adminItemId(spec);
        return `<option value="${escapeHTML(id)}" ${String(id) === String(current) ? "selected" : ""}>${escapeHTML(spec.name || spec.title || "Specialization")}</option>`;
      }).join("")}</select></label>`;
    }
    if (field.kind === "select" && field.source === "courses") {
      const current = value || item?.course_id;
      return `<label>${escapeHTML(field.label)}<select name="${escapeHTML(name)}"><option value="">Select course</option>${adminState.courses.map((course) => {
        const id = adminItemId(course);
        return `<option value="${escapeHTML(id)}" ${String(id) === String(current) ? "selected" : ""}>${escapeHTML(course.title || course.name || "Course")}</option>`;
      }).join("")}</select></label>`;
    }
    if (field.kind === "select") {
      return `<label>${escapeHTML(field.label)}<select name="${escapeHTML(name)}">${field.options.map((option) => `<option value="${escapeHTML(option.value)}" ${String(option.value).toLowerCase() === String(value).toLowerCase() ? "selected" : ""}>${escapeHTML(option.label)}</option>`).join("")}</select></label>`;
    }
    if (field.kind === "file") {
      return `<label>${escapeHTML(field.label)}<input type="file" name="${escapeHTML(name)}" accept="${escapeHTML(field.accept || "*")}"></label>`;
    }
    return `<label>${escapeHTML(field.label)}<input name="${escapeHTML(name)}" value="${escapeHTML(value)}"></label>`;
  }

  function editFields(type, item) {
    const commonText = (name, label, alt = "") => ({ name, label, alt, kind: "textarea" });
    const commonInput = (name, label, alt = "") => ({ name, label, alt, kind: "input" });
    const specSelect = { name: "specialization_id", label: "Specialization", source: "specializations", kind: "select" };
    const courseSelect = { name: "course_id", label: "Course", source: "courses", kind: "select" };
    const levelSelect = { name: "level", label: "Level", kind: "select", options: [
      { value: "beginner", label: "Beginner" },
      { value: "intermediate", label: "Intermediate" },
      { value: "advanced", label: "Advanced" },
    ] };
    const typeSelect = { name: "type", label: "Type", kind: "select", options: [
      { value: "both", label: "Both" },
      { value: "practical", label: "Practical" },
      { value: "theoretical", label: "Theoretical" },
    ] };

    const map = {
      specialization: [
        commonInput("name", "Name"),
        commonText("description", "Description"),
        commonText("skills", "Skills"),
        commonText("roadmap", "Roadmap"),
        commonText("career_paths", "Career paths"),
        { name: "image", label: "Replace image", kind: "file", accept: "image/*" },
      ],
      course: [
        commonInput("title", "Course title", "name"),
        specSelect,
        commonText("description", "Description"),
        levelSelect,
        commonInput("link", "Course link", "course_link"),
        { name: "image", label: "Replace image", kind: "file", accept: "image/*" },
        { name: "video", label: "Replace video", kind: "file", accept: "video/*" },
      ],
      quiz: [
        commonInput("title", "Quiz title", "name"),
        courseSelect,
        commonText("description", "Description"),
        commonText("questions_json", "Questions JSON"),
      ],
      job: [
        commonInput("title", "Job title"),
        specSelect,
        commonText("description", "Description"),
        commonText("skills", "Required skills", "required_skills"),
        commonInput("salary", "Average salary", "average_salary"),
        commonInput("link", "Job link", "job_link"),
      ],
      certificate: [
        commonInput("name", "Certificate name"),
        specSelect,
        commonText("description", "Description"),
        commonInput("link", "Certificate link", "official_link"),
        commonInput("price", "Price"),
        typeSelect,
      ],
    };

    return (map[type] || []).map((field) => editFieldHTML(field, item, type)).join("");
  }

  function ensureAdminModal() {
    let modal = document.getElementById("adminEditModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "adminEditModal";
    modal.className = "admin-modal hidden";
    modal.innerHTML = `
      <div class="admin-modal-backdrop" data-close-admin-modal></div>
      <div class="admin-modal-panel color-card">
        <button type="button" class="admin-modal-close" data-close-admin-modal>&times;</button>
        <h2 id="adminEditTitle">Edit</h2>
        <form id="adminEditForm" class="stack-form"></form>
      </div>
    `;
    document.body.appendChild(modal);
    $all("[data-close-admin-modal]", modal).forEach((el) => el.addEventListener("click", closeAdminEditModal));
    return modal;
  }

  function openAdminEditModal(type, id) {
    const item = findAdminItem(type, id);
    if (!item) {
      showAdminMessage(`Could not find ${type} #${id} in the loaded admin list.`, "error");
      return;
    }
    const modal = ensureAdminModal();
    const form = document.getElementById("adminEditForm");
    document.getElementById("adminEditTitle").textContent = `Edit ${type}`;
    form.innerHTML = editFields(type, item) + `
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-close-admin-modal>Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    `;
    form.dataset.type = type;
    form.dataset.id = id;
    $("[data-close-admin-modal]", form)?.addEventListener("click", closeAdminEditModal);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const payload = adminFormPayload(form, type);
        const result = await adminRequest(adminEndpoint(type, id), { method: "PUT", body: payload });
        closeAdminEditModal();
        showAdminMessage(result.message || "Updated successfully.");
        await loadAdminData();
      } catch (err) {
        showAdminMessage(err.message || "Update failed.", "error");
      }
    };
    modal.classList.remove("hidden");
  }

  function closeAdminEditModal() {
    const modal = document.getElementById("adminEditModal");
    if (modal) modal.classList.add("hidden");
  }

  async function deleteAdminItem(type, id) {
    if (!id) {
      showAdminMessage("Missing item ID.", "error");
      return;
    }
    if (!confirm(`Delete this ${type}?`)) return;
    try {
      const result = await adminRequest(adminEndpoint(type, id), { method: "DELETE" });
      showAdminMessage(result.message || "Deleted successfully.");
      await loadAdminData();
    } catch (err) {
      showAdminMessage(err.message || "Delete failed.", "error");
    }
  }

  async function initAdminPage() {
    if (document.body.dataset.page !== "admin" && !pageName.includes("admin")) return;
    requireAdmin();
    setupAdminTabs();
    setupAdminForms();
    await loadAdminData();
  }

  document.addEventListener("DOMContentLoaded", initAdminPage);

  window.initAdminPage = initAdminPage;
  window.openAdminEditModal = openAdminEditModal;
  window.closeAdminEditModal = closeAdminEditModal;
  window.deleteAdminItem = deleteAdminItem;
  window.navbar = navbar;
  window.requireLogin = requireLogin;
  window.requireAdmin = requireAdmin;
  window.blockAdminFromStudentPages = blockAdminFromStudentPages;
  window.setupSignup = setupSignup;
  window.setupSignin = setupSignin;
  window.loadProfile = loadProfile;
  window.loadProfileProgress = loadProfileProgress;
  window.loadSpecializations = loadSpecializations;
  window.loadSpecializationDetails = loadSpecializationDetails;
  window.loadCourses = loadCourses;
  window.loadCourseDetails = loadCourseDetails;
  window.loadJobs = loadJobs;
  window.setupRecommendation = setupRecommendation;
  window.setupATS = setupATS;
  window.loadAdmin = loadAdmin;
  window.loadHomeDashboard = loadHomeDashboard;
  window.trackCourseOpened = trackCourseOpened;
  window.populatePublicSpecializationFilters = populatePublicSpecializationFilters;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
