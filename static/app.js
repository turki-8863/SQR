(() => {
  "use strict";

  const API_BASE = (window.SQR_API_BASE || "").replace(/\/$/, "");
  const TOKEN_KEY = "sqr_token";
  const USER_KEY = "sqr_user";

  const page = () => (location.pathname.split("/").pop() || "gp.html").toLowerCase();
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const byId = (...ids) => ids.map((id) => document.getElementById(id)).find(Boolean) || null;
  const getParam = (name) => new URLSearchParams(location.search).get(name);
  const getIdParam = () => getParam("id") || getParam("specialization_id") || getParam("spec_id") || getParam("course_id") || getParam("job_id");
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const number = (value) => Number(value || 0);
  const clamp = (value) => Math.max(0, Math.min(100, Math.round(number(value))));

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function saveSession(data) {
    if (data?.token) localStorage.setItem(TOKEN_KEY, data.token);
    if (data?.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function redirectTo(path) {
    if (location.pathname.toLowerCase().endsWith(path.toLowerCase())) return;
    location.href = path;
  }

  function message(text, type = "info", target) {
    const box = target || byId("message", "msg", "alert", "formMessage", "statusMessage") || qs(".message") || qs(".alert");
    const cls = type === "error" ? "error" : type === "success" ? "success" : "info";
    if (box) {
      box.innerHTML = `<div class="sqr-message ${cls}">${escapeHTML(text)}</div>`;
    } else if (text) {
      console[type === "error" ? "error" : "log"](text);
    }
  }

  async function api(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const headers = new Headers(options.headers || {});
    const authToken = token();
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body === "object") {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }

    const response = await fetch(url, { ...options, headers, body });
    const contentType = response.headers.get("content-type") || "";
    let data;
    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => ({}));
    } else {
      data = await response.text().catch(() => "");
    }

    if (!response.ok) {
      const errorText = typeof data === "string" ? data : data.error || data.message || `Request failed (${response.status})`;
      if (response.status === 401) {
        clearSession();
      }
      throw new Error(errorText);
    }
    return data;
  }

  function formDataOrJson(form) {
    if (!form) return {};
    const hasFile = qsa("input[type='file']", form).some((input) => input.files && input.files.length);
    if (hasFile) return new FormData(form);
    const data = Object.fromEntries(new FormData(form).entries());
    qsa("input[type='checkbox']", form).forEach((input) => {
      if (input.name) data[input.name] = input.checked ? input.value || "true" : "";
    });
    return data;
  }

  function setLoading(el, loading, text = "Loading...") {
    if (!el) return;
    if (loading) {
      el.dataset.oldText = el.textContent;
      el.disabled = true;
      el.textContent = text;
    } else {
      el.disabled = false;
      if (el.dataset.oldText) el.textContent = el.dataset.oldText;
    }
  }

  function imgTag(url, alt = "") {
    if (!url) return `<div class="sqr-card-image placeholder">SQR</div>`;
    return `<img class="sqr-card-image" src="${escapeHTML(url)}" alt="${escapeHTML(alt)}" loading="lazy">`;
  }

  function progressBar(percent, label = "Progress") {
    const value = clamp(percent);
    return `
      <div class="sqr-progress-wrap" aria-label="${escapeHTML(label)} ${value}%">
        <div class="sqr-progress-top"><span>${escapeHTML(label)}</span><strong>${value}%</strong></div>
        <div class="sqr-progress"><span style="width:${value}%"></span></div>
      </div>`;
  }

  function circle(percent, label = "Score") {
    const value = clamp(percent);
    return `<div class="sqr-circle" style="--p:${value}"><span>${value}%</span><small>${escapeHTML(label)}</small></div>`;
  }

  function objectList(items) {
    if (!items || !items.length) return "";
    return `<ul class="sqr-clean-list">${items.map((x) => `<li>${escapeHTML(x)}</li>`).join("")}</ul>`;
  }

  function navbar() {
    if (qs(".sqr-navbar")) return;
    const user = currentUser();
    const isAdmin = user?.role === "admin";
    const logged = Boolean(token());
    const links = isAdmin
      ? [
          ["Admin", "admin.html"],
          ["Profile", "profile.html"],
        ]
      : [
          ["Home", "gp.html"],
          ["Specializations", "Specialization.html"],
          ["Courses", "courses.html"],
          ["Jobs", "jobs.html"],
          ["Recommendation", "recommendation.html"],
          ["ATS", "ats.html"],
          ["Profile", "profile.html"],
        ];
    const auth = logged
      ? `<button class="sqr-nav-btn" data-action="logout">Logout</button>`
      : `<a class="sqr-nav-btn" href="signin.html">Sign In</a><a class="sqr-nav-btn primary" href="signup.html">Sign Up</a>`;
    const html = `
      <nav class="sqr-navbar">
        <a class="sqr-brand" href="gp.html"><b>SQR</b><span>Skill Quest Road</span></a>
        <div class="sqr-nav-links">${links.map(([name, href]) => `<a href="${href}">${name}</a>`).join("")}</div>
        <div class="sqr-nav-auth">${auth}</div>
      </nav>`;
    document.body.insertAdjacentHTML("afterbegin", html);
  }

  function requireLogin() {
    const publicPages = new Set(["signin.html", "signup.html", "gp.html", "", "index.html"]);
    if (!token() && !publicPages.has(page())) redirectTo("signin.html");
  }

  function requireAdmin() {
    const user = currentUser();
    if (!token()) return redirectTo("signin.html");
    if (!user || user.role !== "admin") return redirectTo("profile.html");
  }

  function blockAdminFromStudentPages() {
    const user = currentUser();
    const adminAllowed = new Set(["admin.html", "profile.html", "signin.html", "signup.html"]);
    if (user?.role === "admin" && !adminAllowed.has(page())) redirectTo("admin.html");
  }

  function setupAuth() {
    const signupForm = byId("signupForm", "signUpForm", "registerForm") || qs("form[data-auth='signup']");
    if (signupForm) {
      signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const btn = qs("button[type='submit']", signupForm);
        setLoading(btn, true, "Creating...");
        try {
          const data = await api("/api/auth/signup", { method: "POST", body: formDataOrJson(signupForm) });
          saveSession(data);
          message(data.message || "Account created.", "success");
          redirectTo(data.user?.role === "admin" ? "admin.html" : "profile.html");
        } catch (err) {
          message(err.message, "error");
        } finally {
          setLoading(btn, false);
        }
      });
    }

    const signinForm = byId("signinForm", "signInForm", "loginForm") || qs("form[data-auth='signin']");
    if (signinForm) {
      signinForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const btn = qs("button[type='submit']", signinForm);
        setLoading(btn, true, "Signing in...");
        try {
          const data = await api("/api/auth/signin", { method: "POST", body: formDataOrJson(signinForm) });
          saveSession(data);
          message(data.message || "Signed in.", "success");
          redirectTo(data.user?.role === "admin" ? "admin.html" : "profile.html");
        } catch (err) {
          message(err.message, "error");
        } finally {
          setLoading(btn, false);
        }
      });
    }
  }

  async function refreshUser() {
    if (!token()) return null;
    try {
      const data = await api("/api/profile");
      if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data.user || null;
    } catch (_) {
      return null;
    }
  }

  async function loadProfile() {
    const box = byId("profileBox", "profileContent", "profileInfo", "dashboardContent");
    const progressBox = byId("progressList", "profileProgress", "progressContainer", "userProgress");
    if (!box && !progressBox && !page().includes("profile")) return;
    if (!token()) return;
    try {
      const data = await api("/api/profile");
      if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      const user = data.user || {};
      if (box) {
        box.innerHTML = `
          <div class="sqr-dashboard-card">
            <h2>${escapeHTML(user.name || "Student")}</h2>
            <p>${escapeHTML(user.email || "")}</p>
            <div class="sqr-chip-row"><span class="sqr-chip">${escapeHTML(user.role || "student")}</span></div>
          </div>`;
      }
      renderProfileProgress(data.progress || {}, progressBox);
    } catch (err) {
      message(err.message, "error");
    }
  }

  function renderProfileProgress(progress, target) {
    const box = target || byId("progressList", "profileProgress", "progressContainer", "userProgress");
    if (!box) return;
    const specs = progress.specializations || [];
    const courses = progress.courses || [];
    if (!specs.length && !courses.length) {
      box.innerHTML = `<div class="sqr-empty">No progress yet. Enroll in a specialization first, then open courses and complete modules.</div>`;
      return;
    }
    const specCards = specs.map((spec) => `
      <article class="sqr-card compact">
        <h3>${escapeHTML(spec.name)}</h3>
        ${progressBar(spec.percentage || spec.progress?.percentage || 0, "Specialization progress")}
        <a class="sqr-link" href="specialization-details.html?id=${spec.id}">View specialization</a>
      </article>`).join("");
    const courseCards = courses.map((course) => `
      <article class="sqr-card compact">
        <h3>${escapeHTML(course.title)}</h3>
        ${progressBar(course.progress?.percentage || 0, "Course progress")}
        <a class="sqr-link" href="course-details.html?id=${course.id}">Open course</a>
      </article>`).join("");
    box.innerHTML = `<div class="sqr-grid">${specCards}${courseCards}</div>`;
  }

  async function loadSpecializations() {
    const box = byId("specializationsList", "specializationList", "specializationsContainer", "specializationContainer", "specializationGrid");
    if (!box && !["specialization.html", "specialization.html", "specializations.html"].some((x) => page().includes(x.replace(".html", "")))) return;
    if (!box) return;
    box.innerHTML = `<div class="sqr-loading">Loading specializations...</div>`;
    try {
      const data = await api("/api/specializations");
      renderSpecializations(data.specializations || data.items || [], box);
    } catch (err) {
      box.innerHTML = `<div class="sqr-empty error">${escapeHTML(err.message)}</div>`;
    }
  }

  function renderSpecializations(items, box) {
    if (!items.length) {
      box.innerHTML = `<div class="sqr-empty">No specializations found.</div>`;
      return;
    }
    box.innerHTML = `<div class="sqr-grid">${items.map((spec) => specializationCard(spec)).join("")}</div>`;
  }

  function specializationCard(spec) {
    const enrolled = Boolean(spec.enrolled);
    const action = enrolled ? "unenroll-specialization" : "enroll-specialization";
    const buttonText = enrolled ? "Unenroll" : "Enroll";
    return `
      <article class="sqr-card specialization-card" data-spec-id="${spec.id}">
        ${imgTag(spec.image_url, spec.name)}
        <div class="sqr-card-body">
          <div class="sqr-card-head">
            <h3>${escapeHTML(spec.name)}</h3>
            ${enrolled ? `<span class="sqr-chip success">Enrolled</span>` : `<span class="sqr-chip">Not enrolled</span>`}
          </div>
          <p>${escapeHTML(spec.description || "")}</p>
          ${spec.skills ? `<div class="sqr-small"><b>Skills:</b> ${escapeHTML(spec.skills)}</div>` : ""}
          <div class="sqr-actions">
            <a class="sqr-btn ghost" href="specialization-details.html?id=${spec.id}">View details</a>
            ${token() && currentUser()?.role !== "admin" ? `<button class="sqr-btn ${enrolled ? "danger" : "primary"}" data-action="${action}" data-id="${spec.id}">${buttonText}</button>` : ""}
          </div>
        </div>
      </article>`;
  }

  async function toggleSpecialization(id, shouldEnroll, btn) {
    if (!token()) return redirectTo("signin.html");
    setLoading(btn, true, shouldEnroll ? "Enrolling..." : "Unenrolling...");
    try {
      const path = `/api/specializations/${id}/${shouldEnroll ? "enroll" : "unenroll"}`;
      const data = await api(path, { method: "POST" });
      message(data.message || "Updated.", "success");
      await loadSpecializations();
      await loadSpecializationDetails();
      await loadProfile();
    } catch (err) {
      message(err.message, "error");
    } finally {
      setLoading(btn, false);
    }
  }

  async function loadSpecializationDetails() {
    const box = byId("specializationDetails", "specializationDetail", "detailsBox", "specializationContent");
    if (!box && !page().includes("specialization-details")) return;
    if (!box) return;
    const id = getIdParam();
    if (!id) {
      box.innerHTML = `<div class="sqr-empty">Missing specialization id.</div>`;
      return;
    }
    box.innerHTML = `<div class="sqr-loading">Loading specialization...</div>`;
    try {
      const data = await api(`/api/specializations/${id}`);
      const spec = data.specialization || {};
      const progress = data.progress || {};
      const enrolled = Boolean(spec.enrolled || progress.enrolled);
      box.innerHTML = `
        <section class="sqr-hero-card">
          ${imgTag(spec.image_url, spec.name)}
          <div>
            <h1>${escapeHTML(spec.name)}</h1>
            <p>${escapeHTML(spec.description || "")}</p>
            ${progressBar(progress.percentage || 0, "Specialization progress")}
            <div class="sqr-actions">
              ${token() && currentUser()?.role !== "admin" ? `<button class="sqr-btn ${enrolled ? "danger" : "primary"}" data-action="${enrolled ? "unenroll-specialization" : "enroll-specialization"}" data-id="${spec.id}">${enrolled ? "Unenroll" : "Enroll"}</button>` : ""}
            </div>
          </div>
        </section>
        <h2>Courses</h2><div class="sqr-grid">${(data.courses || []).map(courseCard).join("") || `<div class="sqr-empty">No courses yet.</div>`}</div>
        <h2>Jobs</h2><div class="sqr-grid">${(data.jobs || []).map(jobCard).join("") || `<div class="sqr-empty">No jobs yet.</div>`}</div>
        <h2>Certifications</h2><div class="sqr-grid">${(data.certifications || []).map(certCard).join("") || `<div class="sqr-empty">No certifications yet.</div>`}</div>`;
    } catch (err) {
      box.innerHTML = `<div class="sqr-empty error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function loadCourses() {
    const box = byId("coursesList", "courseList", "coursesContainer", "courseContainer", "coursesGrid");
    if (!box && !page().includes("courses")) return;
    if (!box) return;
    box.innerHTML = `<div class="sqr-loading">Loading courses...</div>`;
    const specId = getParam("specialization_id") || getParam("spec_id");
    try {
      const data = await api(`/api/courses${specId ? `?specialization_id=${encodeURIComponent(specId)}` : ""}`);
      const items = data.courses || data.items || [];
      box.innerHTML = items.length ? `<div class="sqr-grid">${items.map(courseCard).join("")}</div>` : `<div class="sqr-empty">No courses found.</div>`;
    } catch (err) {
      box.innerHTML = `<div class="sqr-empty error">${escapeHTML(err.message)}</div>`;
    }
  }

  function courseCard(course) {
    const completed = course.completed || course.progress?.completed;
    const enrolled = Boolean(course.enrolled);
    return `
      <article class="sqr-card course-card" data-course-id="${course.id}">
        ${imgTag(course.image_url, course.title)}
        <div class="sqr-card-body">
          <div class="sqr-card-head">
            <h3>${escapeHTML(course.title)}</h3>
            ${completed ? `<span class="sqr-check" title="Completed">✓</span>` : `<span class="sqr-chip ${course.level_badge?.class || ""}">${escapeHTML(course.level_badge?.label || course.level || "Beginner")}</span>`}
          </div>
          <p>${escapeHTML(course.description || "")}</p>
          ${course.specialization_name ? `<div class="sqr-small">${escapeHTML(course.specialization_name)}</div>` : ""}
          ${course.progress ? progressBar(course.progress.percentage || 0, "Course progress") : ""}
          <div class="sqr-actions">
            <a class="sqr-btn primary" href="course-details.html?id=${course.id}">Open course</a>
            ${token() && currentUser()?.role !== "admin" ? `<button class="sqr-btn ${enrolled ? "danger" : "ghost"}" data-action="${enrolled ? "unenroll-course" : "enroll-course"}" data-id="${course.id}">${enrolled ? "Unenroll course" : "Enroll course"}</button>` : ""}
          </div>
        </div>
      </article>`;
  }

  async function toggleCourse(id, shouldEnroll, btn) {
    if (!token()) return redirectTo("signin.html");
    setLoading(btn, true, shouldEnroll ? "Enrolling..." : "Unenrolling...");
    try {
      const path = `/api/courses/${id}/${shouldEnroll ? "enroll" : "unenroll"}`;
      const data = await api(path, { method: "POST" });
      message(data.message || "Updated.", "success");
      await loadCourses();
      await loadCourseDetails();
      await loadProfile();
    } catch (err) {
      message(err.message, "error");
    } finally {
      setLoading(btn, false);
    }
  }

  async function loadCourseDetails() {
    const box = byId("courseDetails", "courseDetail", "courseContent", "courseDetailsBox");
    if (!box && !page().includes("course-details")) return;
    if (!box) return;
    const id = getIdParam();
    if (!id) {
      box.innerHTML = `<div class="sqr-empty">Missing course id.</div>`;
      return;
    }
    box.innerHTML = `<div class="sqr-loading">Loading course...</div>`;
    try {
      const data = await api(`/api/courses/${id}`);
      const course = data.course || {};
      const progress = data.progress || {};
      if (token() && currentUser()?.role !== "admin") {
        api(`/api/courses/${id}/open`, { method: "POST" }).catch(() => null);
      }
      const enrolled = Boolean(course.enrolled);
      const media = course.video_url
        ? `<video class="sqr-video" src="${escapeHTML(course.video_url)}" controls data-course-media="${course.id}"></video>`
        : "";
      const link = course.link
        ? `<a class="sqr-btn primary" target="_blank" rel="noopener" data-action="course-link" data-id="${course.id}" href="${escapeHTML(course.link)}">Open course material</a>`
        : "";
      box.innerHTML = `
        <section class="sqr-hero-card">
          ${imgTag(course.image_url, course.title)}
          <div>
            <h1>${escapeHTML(course.title)}</h1>
            <p>${escapeHTML(course.description || "")}</p>
            <div class="sqr-chip-row">
              <span class="sqr-chip">${escapeHTML(course.level_badge?.label || course.level || "Beginner")}</span>
              ${course.specialization_name ? `<span class="sqr-chip">${escapeHTML(course.specialization_name)}</span>` : ""}
            </div>
            ${progressBar(progress.percentage || 0, "Course progress")}
            <div class="sqr-actions">
              ${token() && currentUser()?.role !== "admin" ? `<button class="sqr-btn ${enrolled ? "danger" : "ghost"}" data-action="${enrolled ? "unenroll-course" : "enroll-course"}" data-id="${course.id}">${enrolled ? "Unenroll course" : "Enroll course"}</button>` : ""}
              ${link}
            </div>
          </div>
        </section>
        ${media}
        <section class="sqr-section"><h2>Course modules and quizzes</h2><div id="courseQuizzes">${renderQuizzes(data.quizzes || [])}</div></section>`;
      bindQuizForms(box);
      bindMediaTracking(box);
    } catch (err) {
      box.innerHTML = `<div class="sqr-empty error">${escapeHTML(err.message)}</div>`;
    }
  }

  function renderQuizzes(quizzes) {
    if (!quizzes.length) return `<div class="sqr-empty">No quiz modules for this course yet.</div>`;
    return quizzes.map((quiz, index) => `
      <article class="sqr-card quiz-card">
        <h3>${escapeHTML(quiz.module_title || quiz.title || `Module ${index + 1}`)}</h3>
        <p>${escapeHTML(quiz.description || "")}</p>
        <form class="quiz-submit-form" data-quiz-id="${quiz.id}">
          ${(quiz.questions || []).map((question, qIndex) => `
            <fieldset class="sqr-question">
              <legend>${qIndex + 1}. ${escapeHTML(question.question)}</legend>
              ${(question.options || []).filter(Boolean).map((option, optionIndex) => {
                const value = ["a", "b", "c", "d"][optionIndex];
                return `<label><input type="radio" name="q${question.id}" value="${value}" required> ${escapeHTML(option)}</label>`;
              }).join("")}
            </fieldset>`).join("")}
          ${quiz.questions?.length ? `<button class="sqr-btn primary" type="submit">Submit quiz</button>` : `<div class="sqr-empty">No questions yet.</div>`}
          <div class="quiz-result"></div>
        </form>
      </article>`).join("");
  }

  function bindQuizForms(root = document) {
    qsa(".quiz-submit-form", root).forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = "1";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!token()) return redirectTo("signin.html");
        const quizId = form.dataset.quizId;
        const answers = {};
        qsa("input[type='radio']:checked", form).forEach((input) => {
          answers[input.name.replace(/^q/, "")] = input.value;
        });
        const resultBox = qs(".quiz-result", form);
        try {
          const data = await api(`/api/quizzes/${quizId}/submit`, { method: "POST", body: { answers } });
          resultBox.innerHTML = `<div class="sqr-result">${circle(data.percentage || 0, "Quiz score")}<p>${escapeHTML(data.score)} / ${escapeHTML(data.total)}</p></div>`;
          await loadProfile();
        } catch (err) {
          resultBox.innerHTML = `<div class="sqr-message error">${escapeHTML(err.message)}</div>`;
        }
      });
    });
  }

  function bindMediaTracking(root = document) {
    qsa("video[data-course-media]", root).forEach((video) => {
      if (video.dataset.bound) return;
      video.dataset.bound = "1";
      video.addEventListener("play", () => {
        const id = video.dataset.courseMedia;
        if (token()) api(`/api/courses/${id}/activity`, { method: "POST", body: { action: "video" } }).catch(() => null);
      }, { once: true });
    });
  }

  async function trackCourseMaterial(id) {
    if (!token()) return;
    try {
      await api(`/api/courses/${id}/activity`, { method: "POST", body: { action: "link" } });
      await loadProfile();
    } catch (_) {
      // no visible error because link opens in a new tab
    }
  }

  function jobCard(job) {
    return `
      <article class="sqr-card job-card">
        <h3>${escapeHTML(job.title)}</h3>
        <p>${escapeHTML(job.description || "")}</p>
        ${job.required_skills ? `<div class="sqr-small"><b>Skills:</b> ${escapeHTML(job.required_skills)}</div>` : ""}
        ${job.average_salary ? `<div class="sqr-chip-row"><span class="sqr-chip">${escapeHTML(job.average_salary)}</span></div>` : ""}
        <div class="sqr-actions">
          <a class="sqr-btn ghost" href="JobDetails.html?id=${job.id}">Details</a>
          ${job.job_link ? `<a class="sqr-btn primary" href="${escapeHTML(job.job_link)}" target="_blank" rel="noopener">Apply</a>` : ""}
        </div>
      </article>`;
  }

  function certCard(cert) {
    return `
      <article class="sqr-card cert-card">
        <h3>${escapeHTML(cert.title)}</h3>
        ${cert.issuer ? `<div class="sqr-small">${escapeHTML(cert.issuer)}</div>` : ""}
        <p>${escapeHTML(cert.description || "")}</p>
        ${cert.link ? `<a class="sqr-btn ghost" target="_blank" rel="noopener" href="${escapeHTML(cert.link)}">Open certificate</a>` : ""}
      </article>`;
  }

  async function loadJobs() {
    const box = byId("jobsList", "jobList", "jobsContainer", "jobContainer", "jobsGrid");
    if (!box && !page().includes("jobs") && !page().includes("jobdetails")) return;
    if (page().includes("jobdetails")) return loadJobDetails();
    if (!box) return;
    box.innerHTML = `<div class="sqr-loading">Loading jobs...</div>`;
    try {
      const data = await api("/api/jobs");
      const items = data.jobs || data.items || [];
      box.innerHTML = items.length ? `<div class="sqr-grid">${items.map(jobCard).join("")}</div>` : `<div class="sqr-empty">No jobs found.</div>`;
    } catch (err) {
      box.innerHTML = `<div class="sqr-empty error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function loadJobDetails() {
    const box = byId("jobDetails", "jobDetail", "jobContent");
    if (!box) return;
    const id = getIdParam();
    if (!id) return;
    try {
      const data = await api(`/api/jobs/${id}`);
      const job = data.job || {};
      box.innerHTML = `
        <section class="sqr-hero-card simple">
          <div>
            <h1>${escapeHTML(job.title)}</h1>
            <p>${escapeHTML(job.description || "")}</p>
            ${job.required_skills ? `<h3>Required skills</h3><p>${escapeHTML(job.required_skills)}</p>` : ""}
            ${job.average_salary ? `<p><b>Average salary:</b> ${escapeHTML(job.average_salary)}</p>` : ""}
            ${job.job_link ? `<a class="sqr-btn primary" href="${escapeHTML(job.job_link)}" target="_blank" rel="noopener">Open job link</a>` : ""}
          </div>
        </section>`;
    } catch (err) {
      box.innerHTML = `<div class="sqr-empty error">${escapeHTML(err.message)}</div>`;
    }
  }

  function setupRecommendation() {
    const form = byId("recommendationForm", "recommendForm", "careerQuizForm") || qs("form[data-feature='recommendation']");
    const box = byId("recommendationResult", "recommendationResults", "recommendResult", "resultBox");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!token()) return redirectTo("signin.html");
      const btn = qs("button[type='submit']", form);
      setLoading(btn, true, "Analyzing...");
      try {
        const data = await api("/api/recommendations/quiz", { method: "POST", body: formDataOrJson(form) });
        renderRecommendation(data, box || form.nextElementSibling);
      } catch (err) {
        message(err.message, "error", box);
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function renderRecommendation(data, box) {
    if (!box) return;
    const spec = data.recommended_specialization;
    const jobs = data.recommended_jobs || [];
    box.innerHTML = `
      <div class="sqr-result-panel">
        <h2>Recommended specialization</h2>
        ${spec ? specializationCard(spec) : `<div class="sqr-empty">No recommendation yet.</div>`}
        <p>${escapeHTML(data.reason || "")}</p>
        <h2>Recommended jobs</h2>
        <div class="sqr-grid">${jobs.map((item) => jobCard(item.job || item)).join("") || `<div class="sqr-empty">No job matches yet.</div>`}</div>
      </div>`;
  }

  function setupATS() {
    const checker = byId("atsCheckForm", "atsCheckerForm", "resumeCheckForm") || qs("form[data-ats='check']");
    const generator = byId("atsGenerateForm", "atsGeneratorForm", "resumeGenerateForm") || qs("form[data-ats='generate']");
    if (checker) {
      checker.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!token()) return redirectTo("signin.html");
        const btn = qs("button[type='submit']", checker);
        setLoading(btn, true, "Checking...");
        try {
          const data = await api("/api/ats/check", { method: "POST", body: formDataOrJson(checker) });
          renderATSCheck(data);
        } catch (err) {
          message(err.message, "error", byId("atsCheckResult", "atsResult", "checkerResult"));
        } finally {
          setLoading(btn, false);
        }
      });
    }
    if (generator) {
      generator.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!token()) return redirectTo("signin.html");
        const btn = qs("button[type='submit']", generator);
        setLoading(btn, true, "Generating...");
        try {
          const data = await api("/api/ats/generate", { method: "POST", body: formDataOrJson(generator) });
          renderATSGenerate(data);
        } catch (err) {
          message(err.message, "error", byId("atsGenerateResult", "generatorResult", "atsResult"));
        } finally {
          setLoading(btn, false);
        }
      });
    }
  }

  function renderATSCheck(data) {
    const box = byId("atsCheckResult", "checkerResult", "atsResult", "atsScoreBox");
    if (!box) return;
    box.innerHTML = `
      <div class="sqr-result-panel">
        ${circle(data.score || 0, "ATS score")}
        <h3>Technical skills</h3>${objectList(data.technical_skills || []) || `<p>No technical skills detected.</p>`}
        <h3>Soft skills</h3>${objectList(data.soft_skills || []) || `<p>No soft skills detected.</p>`}
        <h3>Missing keywords</h3>${objectList(data.missing_keywords || []) || `<p>No major missing keywords detected.</p>`}
        <h3>Recommendations</h3>${objectList(data.recommendations || [])}
      </div>`;
  }

  function renderATSGenerate(data) {
    const box = byId("atsGenerateResult", "generatorResult", "atsResult", "generatedResume", "resumeOutput");
    if (!box) return;
    const summaryTarget = byId("summarySection", "enhancedSummary", "generatedSummary");
    const summaryHtml = `<div class="sqr-summary"><h3>Enhanced summary</h3><p>${escapeHTML(data.summary || "")}</p></div>`;
    if (summaryTarget) summaryTarget.innerHTML = summaryHtml;
    box.innerHTML = `
      <div class="sqr-result-panel">
        ${summaryHtml}
        <h3>ATS-friendly resume</h3>
        <textarea id="resumeTextOutput" class="sqr-output" rows="18">${escapeHTML(data.resume_text || "")}</textarea>
        <div class="sqr-actions">
          <button class="sqr-btn ghost" data-action="copy-resume">Copy</button>
          <button class="sqr-btn primary" data-action="export-pdf">Export PDF</button>
          <button class="sqr-btn ghost" data-action="export-docx">Export DOCX</button>
        </div>
      </div>`;
  }

  async function exportResume(format) {
    const text = byId("resumeTextOutput")?.value || byId("generatedResume")?.textContent || "";
    if (!text.trim()) return message("No generated resume to export.", "error");
    try {
      const response = await fetch(`${API_BASE}/api/ats/export/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ resume_text: text }),
      });
      if (!response.ok) throw new Error("Export failed.");
      const blob = await response.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = format === "pdf" ? "SQR_ATS_Resume.pdf" : "SQR_ATS_Resume.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      message(err.message, "error");
    }
  }

  async function loadAdmin() {
    if (!page().includes("admin")) return;
    requireAdmin();
    await fillAdminSelects();
    await loadAdminStats();
    bindAdminForms();
  }

  async function loadAdminStats() {
    const box = byId("adminStats", "statsBox", "dashboardStats");
    if (!box) return;
    try {
      const data = await api("/api/admin/stats");
      const stats = data.stats || {};
      box.innerHTML = `<div class="sqr-stat-grid">${Object.entries(stats).map(([key, value]) => `
        <div class="sqr-stat"><strong>${escapeHTML(value)}</strong><span>${escapeHTML(key.replaceAll("_", " "))}</span></div>`).join("")}</div>`;
    } catch (err) {
      box.innerHTML = `<div class="sqr-empty error">${escapeHTML(err.message)}</div>`;
    }
  }

  async function fillAdminSelects() {
    try {
      const [specsData, coursesData] = await Promise.all([api("/api/specializations"), api("/api/courses")]);
      const specs = specsData.specializations || [];
      const courses = coursesData.courses || [];
      qsa("select[name='specialization_id'], select[name='spec_id'], #specializationSelect, #courseSpecialization").forEach((select) => {
        if (!select) return;
        const old = select.value;
        select.innerHTML = `<option value="">Select specialization</option>` + specs.map((s) => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join("");
        if (old) select.value = old;
      });
      qsa("select[name='course_id'], #courseSelect, #quizCourse").forEach((select) => {
        if (!select) return;
        const old = select.value;
        select.innerHTML = `<option value="">Select course</option>` + courses.map((c) => `<option value="${c.id}">${escapeHTML(c.title)}</option>`).join("");
        if (old) select.value = old;
      });
    } catch (_) {
      // admin selects are optional
    }
  }

  function bindAdminForms() {
    const forms = [
      [byId("adminSpecializationForm", "specializationForm", "addSpecializationForm"), "/api/admin/specializations", "Specialization saved."],
      [byId("adminCourseForm", "courseForm", "addCourseForm"), "/api/admin/courses", "Course saved."],
      [byId("adminJobForm", "jobForm", "addJobForm"), "/api/admin/jobs", "Job saved."],
      [byId("adminCertificationForm", "certificationForm", "addCertificationForm"), "/api/admin/certifications", "Certification saved."],
      [byId("adminQuizForm", "quizForm", "addQuizForm"), "/api/admin/quizzes", "Quiz module saved."],
    ];
    forms.forEach(([form, endpoint, success]) => {
      if (!form || form.dataset.bound) return;
      form.dataset.bound = "1";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const btn = qs("button[type='submit']", form);
        setLoading(btn, true, "Saving...");
        try {
          const data = formDataOrJson(form);
          await api(endpoint, { method: "POST", body: data });
          message(success, "success");
          form.reset();
          await fillAdminSelects();
          await loadAdminStats();
        } catch (err) {
          message(err.message, "error");
        } finally {
          setLoading(btn, false);
        }
      });
    });

    const questionForm = byId("adminQuestionForm", "questionForm", "addQuestionForm");
    if (questionForm && !questionForm.dataset.bound) {
      questionForm.dataset.bound = "1";
      questionForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = formDataOrJson(questionForm);
        const quizId = data.quiz_id || getParam("quiz_id");
        if (!quizId) return message("Choose a quiz first.", "error");
        try {
          await api(`/api/admin/quizzes/${quizId}/questions`, { method: "POST", body: data });
          message("Question added.", "success");
          questionForm.reset();
        } catch (err) {
          message(err.message, "error");
        }
      });
    }
  }

  async function copyResume() {
    const text = byId("resumeTextOutput")?.value || "";
    if (!text) return;
    await navigator.clipboard.writeText(text).catch(() => null);
    message("Resume copied.", "success");
  }

  function globalClicks() {
    document.addEventListener("click", async (event) => {
      const el = event.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;
      const id = el.dataset.id;
      if (action === "logout") {
        clearSession();
        redirectTo("signin.html");
      }
      if (action === "enroll-specialization") {
        event.preventDefault();
        await toggleSpecialization(id, true, el);
      }
      if (action === "unenroll-specialization") {
        event.preventDefault();
        await toggleSpecialization(id, false, el);
      }
      if (action === "enroll-course") {
        event.preventDefault();
        await toggleCourse(id, true, el);
      }
      if (action === "unenroll-course") {
        event.preventDefault();
        await toggleCourse(id, false, el);
      }
      if (action === "course-link") {
        await trackCourseMaterial(id);
      }
      if (action === "copy-resume") {
        event.preventDefault();
        await copyResume();
      }
      if (action === "export-pdf") {
        event.preventDefault();
        await exportResume("pdf");
      }
      if (action === "export-docx") {
        event.preventDefault();
        await exportResume("docx");
      }
    });
  }

  function expose() {
    window.SQR = {
      api,
      navbar,
      requireLogin,
      requireAdmin,
      blockAdminFromStudentPages,
      loadProfile,
      loadSpecializations,
      loadSpecializationDetails,
      loadCourses,
      loadCourseDetails,
      loadJobs,
      setupRecommendation,
      setupATS,
      loadAdmin,
      toggleSpecialization,
      toggleCourse,
    };
    window.navbar = navbar;
    window.requireLogin = requireLogin;
    window.requireAdmin = requireAdmin;
    window.blockAdminFromStudentPages = blockAdminFromStudentPages;
    window.loadProfile = loadProfile;
    window.loadSpecializations = loadSpecializations;
    window.loadSpecializationDetails = loadSpecializationDetails;
    window.loadCourses = loadCourses;
    window.loadCourseDetails = loadCourseDetails;
    window.loadJobs = loadJobs;
    window.setupRecommendation = setupRecommendation;
    window.setupATS = setupATS;
    window.loadAdmin = loadAdmin;
  }

  async function boot() {
    expose();
    navbar();
    setupAuth();
    globalClicks();
    if (token()) await refreshUser();
    blockAdminFromStudentPages();
    if (!["signin.html", "signup.html", "gp.html", "index.html", ""].includes(page())) requireLogin();
    await Promise.allSettled([
      loadProfile(),
      loadSpecializations(),
      loadSpecializationDetails(),
      loadCourses(),
      loadCourseDetails(),
      loadJobs(),
    ]);
    setupRecommendation();
    setupATS();
    await loadAdmin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
