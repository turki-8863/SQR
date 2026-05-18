(() => {
  "use strict";

  const API_BASE = (window.SQR_API_BASE || "").replace(/\/$/, "");
  const TOKEN_KEYS = ["sqr_token", "token", "authToken"];
  const USER_KEYS = ["sqr_user", "user", "currentUser"];
  const pageName = (location.pathname.split("/").pop() || "gp.html").toLowerCase();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function asArray(value, key) {
    if (Array.isArray(value)) return value;
    if (value && key && Array.isArray(value[key])) return value[key];
    if (value && typeof value === "object") {
      for (const candidate of ["items", "rows", "data", "results", "specializations", "courses", "jobs", "quizzes", "questions", "users", "certificates"]) {
        if (Array.isArray(value[candidate])) return value[candidate];
      }
    }
    return [];
  }

  function first(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  }

  function getId(item, ...keys) {
    if (!item) return "";
    const candidates = keys.length ? keys : ["id", "specialization_id", "course_id", "quiz_id", "job_id", "certification_id", "admin_id", "user_id"];
    return first(...candidates.map((key) => item[key]));
  }

  function slug(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function pct(value) {
    const n = Number(value || 0);
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function token() {
    for (const key of TOKEN_KEYS) {
      const value = localStorage.getItem(key);
      if (value) return value;
    }
    return "";
  }

  function user() {
    for (const key of USER_KEYS) {
      const value = localStorage.getItem(key);
      if (!value) continue;
      try {
        return JSON.parse(value);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function saveAuth(payload) {
    const t = payload?.token || payload?.access_token || "";
    const u = payload?.user || payload?.data?.user || payload;
    if (t) TOKEN_KEYS.forEach((key) => localStorage.setItem(key, t));
    if (u && typeof u === "object") USER_KEYS.forEach((key) => localStorage.setItem(key, JSON.stringify(u)));
  }

  function clearAuth() {
    TOKEN_KEYS.forEach((key) => localStorage.removeItem(key));
    USER_KEYS.forEach((key) => localStorage.removeItem(key));
  }

  function isAdmin() {
    const u = user();
    return String(u?.role || "").toLowerCase() === "admin";
  }

  function currentMode() {
    const u = user();
    return String(u?.current_mode || u?.role || "student").toLowerCase();
  }

  function isLoggedIn() {
    return Boolean(token());
  }

  function pageIsAuth() {
    return pageName.includes("signin") || pageName.includes("signup");
  }

  function pageIsAdminAllowed() {
    return pageName.includes("admin") || pageName.includes("profile") || pageIsAuth();
  }

  function redirect(path) {
    if (!path) return;
    window.location.href = path;
  }

  function imageUrl(value) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("/")) return v;
    return `/uploads/${v}`;
  }

  function showMessage(text, type = "info", target = null) {
    const box = target || $("#message") || $(".message") || $("#msg");
    if (!box) {
      if (type === "error") console.error(text);
      return;
    }
    box.innerHTML = `<div class="sqr-alert sqr-alert-${esc(type)}">${esc(text)}</div>`;
    if (type !== "error") {
      setTimeout(() => {
        if (box.textContent.includes(String(text))) box.innerHTML = "";
      }, 4200);
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const body = options.body;
    const isForm = body instanceof FormData;
    if (!isForm && body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const t = token();
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body: isForm ? body : body && typeof body !== "string" ? JSON.stringify(body) : body,
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();

    if (!response.ok) {
      const msg = typeof data === "string" ? data : data.error || data.message || `Request failed (${response.status})`;
      if (response.status === 401) {
        clearAuth();
        if (!pageIsAuth()) setTimeout(() => redirect("signin.html"), 800);
      }
      throw new Error(msg);
    }
    return data;
  }

  function formDataToObject(form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
      if (value instanceof File) return;
      data[key] = value;
    });
    return data;
  }

  function bindOnce(el, event, handler, key = event) {
    if (!el || el.dataset[`bound${key}`]) return;
    el.dataset[`bound${key}`] = "1";
    el.addEventListener(event, handler);
  }

  function cardImage(src, alt = "") {
    const url = imageUrl(src);
    if (!url) return `<div class="card-media card-media-empty"><span>${esc((alt || "SQR").slice(0, 2).toUpperCase())}</span></div>`;
    return `<img class="card-media" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`;
  }

  function levelBadge(level) {
    const clean = String(level || "beginner").toLowerCase();
    return `<span class="pill level-${esc(clean)}">${esc(clean.charAt(0).toUpperCase() + clean.slice(1))}</span>`;
  }

  function ring(score, label = "Score") {
    const value = pct(score);
    return `
      <div class="stat-ring" style="--value:${value}">
        <div class="stat-ring-inner">
          <strong>${value}%</strong>
          <span>${esc(label)}</span>
        </div>
      </div>
    `;
  }

  function emptyCard(text) {
    return `<div class="card empty-card"><h3>No data yet</h3><p>${esc(text)}</p></div>`;
  }


  function installNavbarStyles() {
    if (document.getElementById("sqrNavbarFixStyles")) return;
    const style = document.createElement("style");
    style.id = "sqrNavbarFixStyles";
    style.textContent = `
      #sqrNavbar,
      #sqrNavbar * {
        box-sizing: border-box;
      }

      #sqrNavbar.sqr-navbar {
        width: min(96%, 1320px);
        margin: 18px auto 26px;
        min-height: 78px;
        padding: 14px 22px;
        display: flex;
        align-items: center;
        gap: 18px;
        position: sticky;
        top: 14px;
        z-index: 1000;
        border: 1px solid rgba(125, 211, 252, .22);
        border-radius: 28px;
        background: linear-gradient(135deg, rgba(7, 18, 39, .96), rgba(24, 17, 54, .94));
        box-shadow: 0 20px 55px rgba(0, 0, 0, .28);
        backdrop-filter: blur(16px);
      }

      #sqrNavbar .nav-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 250px;
        flex: 0 0 auto;
        color: #f8fafc;
        text-decoration: none;
        cursor: pointer;
        line-height: 1.05;
      }

      #sqrNavbar .brand-mark {
        width: 52px;
        height: 52px;
        display: grid;
        place-items: center;
        border-radius: 18px;
        font-weight: 900;
        letter-spacing: .5px;
        color: #e0f2fe;
        background: linear-gradient(135deg, rgba(14, 165, 233, .22), rgba(168, 85, 247, .18));
        border: 1px solid rgba(255, 255, 255, .12);
        flex: 0 0 auto;
      }

      #sqrNavbar .nav-brand strong {
        display: block;
        font-size: 1.02rem;
        font-weight: 900;
        white-space: nowrap;
      }

      #sqrNavbar .nav-brand span {
        display: block;
        margin-top: 5px;
        color: #cbd5e1;
        font-size: .86rem;
        white-space: nowrap;
      }

      #sqrNavbar .nav-links {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        flex: 1 1 auto;
        min-width: 0;
      }

      #sqrNavbar .nav-links a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        padding: 0 14px;
        border-radius: 14px;
        color: #dbeafe;
        text-decoration: none;
        font-weight: 800;
        font-size: .95rem;
        white-space: nowrap;
        transition: background .2s ease, transform .2s ease, color .2s ease;
      }

      #sqrNavbar .nav-links a:hover,
      #sqrNavbar .nav-links a.active {
        color: #ffffff;
        background: rgba(255, 255, 255, .10);
        transform: translateY(-1px);
      }

      #sqrNavbar .nav-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex: 0 0 auto;
        margin-left: auto;
      }

      #sqrNavbar .nav-btn,
      #sqrNavbar .nav-actions a,
      #sqrNavbar .nav-actions button {
        width: auto !important;
        min-width: auto !important;
        height: 42px !important;
        min-height: 42px !important;
        padding: 0 16px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 14px !important;
        border: 1px solid rgba(255, 255, 255, .14) !important;
        text-decoration: none !important;
        font-weight: 900 !important;
        font-size: .94rem !important;
        line-height: 1 !important;
        cursor: pointer !important;
        flex: 0 0 auto !important;
      }

      #sqrNavbar .nav-btn.ghost {
        color: #f8fafc !important;
        background: rgba(255, 255, 255, .06) !important;
      }

      #sqrNavbar .nav-btn.primary {
        color: #06121f !important;
        background: linear-gradient(135deg, #67e8f9, #a78bfa) !important;
        border-color: transparent !important;
      }

      #sqrNavbar .nav-toggle {
        display: none !important;
        width: 42px !important;
        height: 42px !important;
        min-width: 42px !important;
        max-width: 42px !important;
        padding: 0 !important;
        margin: 0 !important;
        border-radius: 14px !important;
        border: 1px solid rgba(255, 255, 255, .14) !important;
        background: rgba(255, 255, 255, .08) !important;
        color: #f8fafc !important;
        font-size: 1.35rem !important;
        line-height: 1 !important;
        cursor: pointer !important;
        flex: 0 0 42px !important;
      }

      @media (max-width: 980px) {
        #sqrNavbar.sqr-navbar {
          flex-wrap: wrap;
          padding: 14px;
          border-radius: 24px;
        }

        #sqrNavbar .nav-brand {
          min-width: 0;
          flex: 1 1 auto;
        }

        #sqrNavbar .nav-toggle {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
        }

        #sqrNavbar .nav-links {
          order: 3;
          flex: 1 0 100%;
          display: none;
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          padding-top: 10px;
        }

        #sqrNavbar .nav-links.open {
          display: flex;
        }

        #sqrNavbar .nav-links a {
          justify-content: flex-start;
          width: 100%;
        }

        #sqrNavbar .nav-actions {
          order: 4;
          width: 100%;
          justify-content: flex-start;
          margin-left: 0;
          padding-top: 4px;
        }
      }

      @media (max-width: 560px) {
        #sqrNavbar.sqr-navbar {
          width: calc(100% - 20px);
          margin-top: 10px;
        }

        #sqrNavbar .brand-mark {
          width: 44px;
          height: 44px;
          border-radius: 15px;
        }

        #sqrNavbar .nav-brand strong {
          font-size: .96rem;
        }

        #sqrNavbar .nav-brand span {
          font-size: .78rem;
        }
      }
    `;
    document.head.appendChild(style);
  }


  function navbar() {
    installNavbarStyles();
    if ($("#sqrNavbar")) return;
    const logged = isLoggedIn();
    const admin = isAdmin();
    const adminMode = admin && currentMode() !== "student";
    const studentLinks = [
      ["gp.html", "Home"],
      ["Specialization.html", "Specializations"],
      ["Courses.html", "Courses"],
      ["Quiz.html", "Quizzes"],
      ["ATS.html", "ATS"],
      ["jobs.html", "Jobs"],
      ["recommendation.html", "Recommendation"],
      ["profile.html", "Profile"],
    ];
    const adminLinks = [
      ["admin.html", "Admin"],
      ["profile.html", "Profile"],
    ];
    const links = logged ? (adminMode ? adminLinks : studentLinks) : [["gp.html", "Home"], ["Specialization.html", "Specializations"], ["Courses.html", "Courses"], ["ATS.html", "ATS"]];
    const auth = logged
      ? `<button class="nav-btn ghost" id="logoutBtn" type="button">Sign out</button>`
      : `<a class="nav-btn ghost" href="signin.html">Sign In</a><a class="nav-btn primary" href="signup.html">Sign Up</a>`;

    const nav = document.createElement("header");
    nav.id = "sqrNavbar";
    nav.className = "sqr-navbar";
    nav.innerHTML = `
      <div class="nav-brand" onclick="location.href='gp.html'">
        <div class="brand-mark">SQR</div>
        <div><strong>Skill Quest Road</strong><span>CS career guidance</span></div>
      </div>
      <button class="nav-toggle" id="navToggle" type="button" aria-label="Toggle navigation">☰</button>
      <nav class="nav-links" id="navLinks">
        ${links.map(([href, label]) => `<a href="${href}" class="${pageName === href.toLowerCase() ? "active" : ""}">${label}</a>`).join("")}
      </nav>
      <div class="nav-actions">${auth}</div>
    `;
    document.body.prepend(nav);
    bindOnce($("#logoutBtn"), "click", () => {
      clearAuth();
      redirect("signin.html");
    }, "logout");
    bindOnce($("#navToggle"), "click", () => $("#navLinks")?.classList.toggle("open"), "navtoggle");
  }

  function requireLogin() {
    if (!isLoggedIn()) redirect("signin.html");
  }

  async function requireAdmin() {
    if (!isLoggedIn()) return redirect("signin.html");
    const u = user();
    if (u?.role === "admin") return true;
    try {
      const me = await api("/api/me");
      saveAuth({ user: me, token: token() });
      if (me.role !== "admin") redirect("profile.html");
      return me.role === "admin";
    } catch (e) {
      showMessage(e.message, "error");
      return false;
    }
  }

  function blockAdminFromStudentPages() {
    if (isAdmin() && currentMode() !== "student" && !pageIsAdminAllowed()) {
      showMessage("Admins can access Admin and Profile only unless switched to student mode.", "error");
      setTimeout(() => redirect("admin.html"), 700);
      return false;
    }
    return true;
  }

  function setupSignup() {
    const form = $("#signupForm") || $("form[data-auth='signup']") || $("form.signup-form");
    bindOnce(form, "submit", async (e) => {
      e.preventDefault();
      const payload = formDataToObject(form);
      try {
        const data = await api("/api/signup", { method: "POST", body: payload });
        saveAuth(data);
        showMessage("Account created successfully", "success");
        redirect("profile.html");
      } catch (err) {
        showMessage(err.message, "error");
      }
    }, "signup");
  }

  function setupSignin() {
    const form = $("#signinForm") || $("form[data-auth='signin']") || $("form.login-form");
    bindOnce(form, "submit", async (e) => {
      e.preventDefault();
      const payload = formDataToObject(form);
      try {
        const data = await api("/api/signin", { method: "POST", body: payload });
        saveAuth(data);
        showMessage("Signed in successfully", "success");
        const u = data.user || user();
        redirect(u?.role === "admin" ? "admin.html" : "profile.html");
      } catch (err) {
        showMessage(err.message, "error");
      }
    }, "signin");
  }

  async function refreshMe() {
    if (!isLoggedIn()) return null;
    try {
      const me = await api("/api/me");
      saveAuth({ token: token(), user: me });
      return me;
    } catch (_) {
      return null;
    }
  }

  async function loadHome() {
    const boxes = [$("#homeSpecializations"), $("#homeCourses"), $("#homeJobs")];
    if (!boxes.some(Boolean)) return;
    try {
      const data = await api("/api/home/dashboard");
      if ($("#homeSpecializations")) renderSpecializationCards($("#homeSpecializations"), data.latest_specializations || data.specializations || [], true);
      if ($("#homeCourses")) renderCourseCards($("#homeCourses"), data.latest_courses || data.courses || [], true);
      if ($("#homeJobs")) renderJobCards($("#homeJobs"), data.latest_jobs || data.jobs || [], true);
      renderStats(data.stats || data.counts || {});
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function renderStats(stats) {
    const box = $("#statsBox") || $("#homeStats") || $(".stats-grid");
    if (!box || !stats) return;
    const items = [
      ["Users", stats.users],
      ["Specializations", stats.specializations],
      ["Courses", stats.courses],
      ["Quizzes", stats.quizzes],
      ["Jobs", stats.jobs],
    ];
    box.innerHTML = items.map(([label, value]) => `<div class="stat-card"><strong>${esc(value ?? 0)}</strong><span>${esc(label)}</span></div>`).join("");
  }

  function renderSpecializationCards(box, rows, compact = false) {
    if (!box) return;
    const data = asArray(rows, "specializations");
    if (!data.length) {
      box.innerHTML = emptyCard("No specializations were found. Add them from the admin page.");
      return;
    }
    box.innerHTML = data.map((spec) => {
      const id = getId(spec, "specialization_id", "id");
      return `
        <article class="card interactive-card specialization-card" data-id="${esc(id)}">
          ${cardImage(first(spec.image_url, spec.image), spec.name)}
          <div class="card-body">
            <div class="card-top"><span class="pill">Specialization</span><span>#${esc(id)}</span></div>
            <h3>${esc(spec.name)}</h3>
            <p>${esc(first(spec.description, "Explore courses, quizzes, certifications, and jobs for this path.")).slice(0, compact ? 130 : 240)}</p>
            <div class="card-actions">
              <button type="button" class="btn primary view-specialization" data-id="${esc(id)}">View Details</button>
              ${isLoggedIn() && !isAdmin() ? `<button type="button" class="btn ghost enroll-specialization" data-id="${esc(id)}">Enroll</button>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");
    $$(".view-specialization", box).forEach((btn) => bindOnce(btn, "click", () => redirect(`Specialization.html?id=${encodeURIComponent(btn.dataset.id)}`), "viewspec"));
    $$(".specialization-card", box).forEach((card) => bindOnce(card, "click", (e) => {
      if (e.target.closest("button,a")) return;
      redirect(`Specialization.html?id=${encodeURIComponent(card.dataset.id)}`);
    }, "cardopen"));
    $$(".enroll-specialization", box).forEach((btn) => bindOnce(btn, "click", async (e) => {
      e.stopPropagation();
      await enrollSpecialization(btn.dataset.id, btn);
    }, "enrollspec"));
  }

  async function loadSpecializations() {
    const box = $("#specializationsBox") || $("#specializationBox") || $("#specializationsList") || $("#specializationList");
    const id = new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("specialization_id") || new URLSearchParams(location.search).get("spec_id");
    if (id) await loadSpecializationDetails(id);
    if (!box) return;
    try {
      const data = await api("/api/specializations");
      renderSpecializationCards(box, data.specializations || data);
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  async function loadSpecializationDetails(id = null) {
    const specId = id || new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("specialization_id") || new URLSearchParams(location.search).get("spec_id");
    const box = $("#specializationDetails") || $("#specializationDetail") || $("#detailsBox");
    if (!specId || !box) return;
    try {
      const data = await api(`/api/specializations/${encodeURIComponent(specId)}`);
      const spec = data.specialization || data;
      const courses = data.courses || [];
      const jobs = data.jobs || [];
      const status = isLoggedIn() && !isAdmin() ? await api(`/api/specializations/${encodeURIComponent(specId)}/enrollment-status`).catch(() => null) : null;
      const enrolled = Boolean(status?.enrolled);
      box.innerHTML = `
        <section class="hero-detail card">
          ${cardImage(first(spec.image_url, spec.image), spec.name)}
          <div>
            <span class="pill">Specialization</span>
            <h1>${esc(spec.name)}</h1>
            <p>${esc(spec.description || "No description yet.")}</p>
            ${spec.skills ? `<p><strong>Skills:</strong> ${esc(spec.skills)}</p>` : ""}
            ${spec.roadmap ? `<p><strong>Roadmap:</strong> ${esc(spec.roadmap)}</p>` : ""}
            <div class="card-actions">
              ${isLoggedIn() && !isAdmin() ? `<button class="btn ${enrolled ? "danger" : "primary"}" id="specEnrollBtn" type="button">${enrolled ? "Unenroll" : "Enroll"}</button>` : ""}
              <a class="btn ghost" href="Courses.html?specialization_id=${esc(specId)}">View Courses</a>
              <a class="btn ghost" href="jobs.html?specialization_id=${esc(specId)}">View Jobs</a>
            </div>
            ${status ? `<div class="mini-progress"><span>Progress</span><div><i style="width:${pct(status.progress)}%"></i></div><b>${pct(status.progress)}%</b></div>` : ""}
          </div>
        </section>
        <h2>Courses in this path</h2>
        <div id="specCourses" class="grid"></div>
        <h2>Jobs connected to this path</h2>
        <div id="specJobs" class="grid"></div>
      `;
      renderCourseCards($("#specCourses"), courses, true);
      renderJobCards($("#specJobs"), jobs, true);
      bindOnce($("#specEnrollBtn"), "click", async () => {
        if (enrolled) await unenrollSpecialization(specId);
        else await enrollSpecialization(specId);
        await loadSpecializationDetails(specId);
      }, "specdetailenroll");
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  async function enrollSpecialization(id, btn = null) {
    if (!isLoggedIn()) return redirect("signin.html");
    try {
      if (btn) btn.disabled = true;
      await api(`/api/specializations/${encodeURIComponent(id)}/enroll`, { method: "POST", body: {} });
      showMessage("Enrolled successfully", "success");
      if (btn) {
        btn.textContent = "Enrolled";
        btn.classList.remove("ghost");
        btn.classList.add("primary");
      }
    } catch (err) {
      showMessage(err.message, "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function unenrollSpecialization(id) {
    try {
      await api(`/api/specializations/${encodeURIComponent(id)}/unenroll`, { method: "POST", body: {} });
      showMessage("Unenrolled successfully", "success");
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function renderCourseCards(box, rows, compact = false) {
    if (!box) return;
    const data = asArray(rows, "courses");
    if (!data.length) {
      box.innerHTML = emptyCard("No courses were found.");
      return;
    }
    box.innerHTML = data.map((course) => {
      const id = getId(course, "course_id", "id");
      return `
        <article class="card interactive-card course-card" data-id="${esc(id)}">
          ${cardImage(first(course.image_url, course.image, course.thumbnail), course.title)}
          <div class="card-body">
            <div class="card-top">${levelBadge(course.level)}<span>${esc(first(course.specialization_name, "Course"))}</span></div>
            <h3>${esc(course.title)}</h3>
            <p>${esc(course.description || "Open the course to track progress and take linked quizzes.").slice(0, compact ? 130 : 240)}</p>
            <div class="card-actions">
              <button type="button" class="btn primary view-course" data-id="${esc(id)}">Open Course</button>
              ${course.video_url || course.video ? `<span class="pill">Video</span>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");
    $$(".view-course", box).forEach((btn) => bindOnce(btn, "click", () => redirect(`Courses.html?id=${encodeURIComponent(btn.dataset.id)}`), "viewcourse"));
    $$(".course-card", box).forEach((card) => bindOnce(card, "click", (e) => {
      if (e.target.closest("button,a")) return;
      redirect(`Courses.html?id=${encodeURIComponent(card.dataset.id)}`);
    }, "coursecard"));
  }

  async function loadCourses() {
    const box = $("#coursesBox") || $("#coursesList") || $("#courseList");
    const params = new URLSearchParams(location.search);
    const id = params.get("id") || params.get("course_id");
    if (id) await loadCourseDetails(id);
    if (!box) return;
    try {
      const spec = params.get("specialization_id") || params.get("spec_id");
      const url = spec ? `/api/courses?specialization_id=${encodeURIComponent(spec)}` : "/api/courses";
      const data = await api(url);
      renderCourseCards(box, data.courses || data);
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  async function trackCourseOpened(courseId, completed = false) {
    if (!isLoggedIn() || isAdmin()) return;
    try {
      await api(`/api/courses/${encodeURIComponent(courseId)}/open`, { method: "POST", body: { completed } });
    } catch (_) {}
  }

  async function loadCourseDetails(id = null) {
    const courseId = id || new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("course_id");
    const box = $("#courseDetails") || $("#courseDetail") || $("#detailsBox");
    if (!courseId || !box) return;
    try {
      const data = await api(`/api/courses/${encodeURIComponent(courseId)}`);
      const course = data.course || data;
      const quizzes = data.quizzes || [];
      await trackCourseOpened(courseId, false);
      const link = first(course.video_url, course.video, course.course_link, course.link);
      box.innerHTML = `
        <section class="hero-detail card">
          ${cardImage(first(course.image_url, course.image), course.title)}
          <div>
            <span class="pill">${esc(first(course.specialization_name, "Course"))}</span>
            <h1>${esc(course.title)}</h1>
            <div class="card-top">${levelBadge(course.level)}</div>
            <p>${esc(course.description || "No description yet.")}</p>
            <div class="card-actions">
              ${link ? `<a class="btn primary course-open-link" href="${esc(imageUrl(link))}" target="_blank" rel="noopener">Open Video / Link</a>` : ""}
              ${course.specialization_id ? `<a class="btn ghost" href="Specialization.html?id=${esc(course.specialization_id)}">Back to Specialization</a>` : ""}
            </div>
          </div>
        </section>
        <h2>Course quizzes</h2>
        <div id="courseQuizzes" class="grid"></div>
      `;
      bindOnce($(".course-open-link", box), "click", () => trackCourseOpened(courseId, false), "linktrack");
      const quizBox = $("#courseQuizzes");
      if (!quizzes.length) quizBox.innerHTML = emptyCard("No quizzes for this course yet.");
      else quizBox.innerHTML = quizzes.map((quiz) => {
        const qid = getId(quiz, "quiz_id", "id");
        return `<article class="card"><span class="pill">Quiz</span><h3>${esc(quiz.title)}</h3><p>${esc(quiz.description || "Test your understanding.")}</p><a class="btn primary" href="Quiz.html?id=${esc(qid)}">Take Quiz</a></article>`;
      }).join("");
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  function renderJobCards(box, rows, compact = false) {
    if (!box) return;
    const data = asArray(rows, "jobs");
    if (!data.length) {
      box.innerHTML = emptyCard("No jobs were found.");
      return;
    }
    box.innerHTML = data.map((job) => {
      const id = getId(job, "job_id", "id");
      return `
        <article class="card interactive-card job-card" data-id="${esc(id)}">
          <div class="card-body">
            <div class="card-top"><span class="pill">${esc(first(job.specialization, job.specialization_name, "Job"))}</span><span>${esc(job.salary || job.average_salary || "")}</span></div>
            <h3>${esc(job.title)}</h3>
            <p>${esc(job.description || "No description yet.").slice(0, compact ? 120 : 220)}</p>
            ${job.required_skills || job.skills ? `<p class="muted"><strong>Skills:</strong> ${esc(first(job.required_skills, job.skills)).slice(0, 140)}</p>` : ""}
            <div class="card-actions"><button type="button" class="btn primary view-job" data-id="${esc(id)}">View Details</button></div>
          </div>
        </article>
      `;
    }).join("");
    $$(".view-job", box).forEach((btn) => bindOnce(btn, "click", () => redirect(`jobs.html?id=${encodeURIComponent(btn.dataset.id)}`), "viewjob"));
    $$(".job-card", box).forEach((card) => bindOnce(card, "click", (e) => {
      if (e.target.closest("button,a")) return;
      redirect(`jobs.html?id=${encodeURIComponent(card.dataset.id)}`);
    }, "jobcard"));
  }

  async function loadJobs() {
    const box = $("#jobsBox") || $("#jobsList") || $("#jobList");
    const params = new URLSearchParams(location.search);
    const id = params.get("id") || params.get("job_id");
    if (id) await loadJobDetails(id);
    if (!box) return;
    try {
      const spec = params.get("specialization_id") || params.get("spec_id");
      const url = spec ? `/api/jobs?specialization_id=${encodeURIComponent(spec)}` : "/api/jobs";
      const data = await api(url);
      renderJobCards(box, data.jobs || data);
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  async function loadJobDetails(id = null) {
    const jobId = id || new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("job_id");
    const box = $("#jobDetails") || $("#jobDetail") || $("#detailsBox");
    if (!jobId || !box) return;
    try {
      const data = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      const job = data.job || data;
      box.innerHTML = `
        <section class="card hero-detail text-only">
          <div>
            <span class="pill">${esc(first(job.specialization, job.specialization_name, "Job"))}</span>
            <h1>${esc(job.title)}</h1>
            <p>${esc(job.description || "No description yet.")}</p>
            ${job.required_skills || job.skills ? `<p><strong>Required skills:</strong> ${esc(first(job.required_skills, job.skills))}</p>` : ""}
            ${job.average_salary || job.salary ? `<p><strong>Average salary:</strong> ${esc(first(job.average_salary, job.salary))}</p>` : ""}
            <div class="card-actions">
              ${job.job_link || job.link ? `<a class="btn primary" target="_blank" rel="noopener" href="${esc(first(job.job_link, job.link))}">Open Job Link</a>` : ""}
              <a class="btn ghost" href="recommendation.html">Get Recommendation</a>
            </div>
          </div>
        </section>
      `;
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  async function loadQuizzes() {
    const box = $("#quizzesBox") || $("#quizList") || $("#quizzesList");
    const id = new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("quiz_id");
    if (id) await loadQuizDetails(id);
    if (!box) return;
    try {
      const course = new URLSearchParams(location.search).get("course_id");
      const url = course ? `/api/quizzes?course_id=${encodeURIComponent(course)}` : "/api/quizzes";
      const data = await api(url);
      const rows = data.quizzes || [];
      if (!rows.length) box.innerHTML = emptyCard("No quizzes were found.");
      else box.innerHTML = rows.map((quiz) => {
        const id = getId(quiz, "quiz_id", "id");
        return `<article class="card interactive-card"><span class="pill">${esc(quiz.course_title || "Quiz")}</span><h3>${esc(quiz.title)}</h3><p>${esc(quiz.description || "Answer the quiz to improve your progress.")}</p><a class="btn primary" href="Quiz.html?id=${esc(id)}">Take Quiz</a></article>`;
      }).join("");
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  async function loadQuizDetails(id = null) {
    const quizId = id || new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("quiz_id");
    const box = $("#quizDetails") || $("#quizDetail") || $("#detailsBox");
    if (!quizId || !box) return;
    try {
      const data = await api(`/api/quizzes/${encodeURIComponent(quizId)}`);
      const quiz = data.quiz || data;
      const questions = data.questions || [];
      if (!questions.length) {
        box.innerHTML = emptyCard("This quiz has no questions yet.");
        return;
      }
      box.innerHTML = `
        <form id="takeQuizForm" class="card quiz-form">
          <span class="pill">${esc(quiz.course_title || "Quiz")}</span>
          <h1>${esc(quiz.title)}</h1>
          <p>${esc(quiz.description || "Choose the best answer for each question.")}</p>
          ${questions.map((q, index) => {
            const qid = getId(q, "question_id", "id");
            const opts = q.options || [q.option_a, q.option_b, q.option_c, q.option_d].filter(Boolean);
            return `
              <fieldset class="question-card">
                <legend>${index + 1}. ${esc(q.question || q.question_text)}</legend>
                ${opts.map((opt, i) => {
                  const letter = ["A", "B", "C", "D"][i];
                  return `<label><input type="radio" name="q_${esc(qid)}" value="${letter}" required> <span>${letter}. ${esc(opt)}</span></label>`;
                }).join("")}
              </fieldset>
            `;
          }).join("")}
          <button class="btn primary" type="submit">Submit Quiz</button>
        </form>
      `;
      bindOnce($("#takeQuizForm"), "submit", async (e) => {
        e.preventDefault();
        if (!isLoggedIn()) return redirect("signin.html");
        const answers = {};
        new FormData(e.currentTarget).forEach((value, key) => {
          answers[key.replace(/^q_/, "")] = value;
        });
        try {
          const result = await api(`/api/quizzes/${encodeURIComponent(quizId)}/submit`, { method: "POST", body: { answers } });
          renderQuizResult(result);
        } catch (err) {
          showMessage(err.message, "error");
        }
      }, "quizsubmit");
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  function renderQuizResult(result) {
    const box = $("#quizResult") || document.createElement("div");
    if (!box.id) {
      box.id = "quizResult";
      ($("#quizDetails") || document.body).after(box);
    }
    const score = pct(first(result.score_percentage, result.percentage, result.score));
    box.innerHTML = `
      <section class="card result-card">
        ${ring(score, "Quiz")}
        <div>
          <h2>${score >= 60 ? "Passed" : "Keep practicing"}</h2>
          <p>You scored ${esc(first(result.score, score))} out of ${esc(first(result.total, 100))}.</p>
          <p>Your profile progress is updated automatically after quiz submission.</p>
        </div>
      </section>
    `;
  }

  async function loadProfile() {
    const box = $("#profileBox") || $("#profileSummary");
    const progressBox = $("#profileProgressBars") || $("#progressBox");
    const quizBox = $("#profileQuizHistory");
    const atsBox = $("#profileAtsHistory");
    if (!box && !progressBox && !quizBox && !atsBox) return;
    if (!isLoggedIn()) return redirect("signin.html");
    try {
      const data = await api("/api/profile");
      const u = data.user || data;
      saveAuth({ token: token(), user: u });
      if (box) {
        box.innerHTML = `
          <section class="card profile-card">
            <div class="avatar">${esc(String(u.name || "U").slice(0, 2).toUpperCase())}</div>
            <div>
              <h1>${esc(u.name || "User")}</h1>
              <p>${esc(u.email || "")}</p>
              <span class="pill">${esc(u.role || "student")}</span>
            </div>
          </section>
        `;
      }
      setupProfileForm(u);
      await loadProfileProgress(progressBox);
      if (quizBox) renderHistory(quizBox, data.quiz_history || [], "quiz");
      if (atsBox) renderHistory(atsBox, data.ats_history || [], "ats");
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function setupProfileForm(u = null) {
    const form = $("#profileForm");
    if (!form) return;
    if (u) {
      ["name", "skills", "interests", "goal"].forEach((key) => {
        const field = form.elements[key] || $(`#${key}`, form);
        if (field && !field.value) field.value = u[key] || "";
      });
    }
    bindOnce(form, "submit", async (e) => {
      e.preventDefault();
      try {
        const data = await api("/api/profile", { method: "PUT", body: formDataToObject(form) });
        saveAuth({ token: token(), user: data.user });
        showMessage("Profile updated", "success");
        await loadProfile();
      } catch (err) {
        showMessage(err.message, "error");
      }
    }, "profileupdate");
  }

  async function loadProfileProgress(box = null) {
    const target = box || $("#profileProgressBars") || $("#progressBox");
    if (!target || !isLoggedIn()) return;
    try {
      const data = await api("/api/profile/progress");
      const rows = data.progress || [];
      if (!rows.length) {
        target.innerHTML = emptyCard("Open courses and complete quizzes to build progress.");
        return;
      }
      target.innerHTML = rows.map((row) => {
        const value = pct(first(row.progress, row.percentage));
        return `
          <article class="card progress-card">
            <div class="progress-head"><h3>${esc(row.name || row.specialization_name)}</h3><strong>${value}%</strong></div>
            <div class="progress-track"><span style="width:${value}%"></span></div>
            <p>${esc(row.opened_courses || 0)} opened courses • ${esc(row.completed_quizzes || 0)} completed quizzes • Average quiz ${esc(row.average_quiz_score || 0)}%</p>
          </article>
        `;
      }).join("");
    } catch (err) {
      target.innerHTML = emptyCard(err.message);
    }
  }

  function renderHistory(box, rows, type) {
    if (!rows.length) {
      box.innerHTML = emptyCard(type === "quiz" ? "No quiz attempts yet." : "No ATS results yet.");
      return;
    }
    box.innerHTML = rows.map((row) => `
      <article class="history-row">
        <div><strong>${esc(row.quiz_title || row.target_job || "Result")}</strong><span>${esc(row.course_title || row.created_at || "")}</span></div>
        <b>${esc(first(row.score_percentage, row.ats_score, row.score, 0))}%</b>
      </article>
    `).join("");
  }

  async function setupRecommendation() {
    const form = $("#recommendationForm") || $("form[data-form='recommendation']");
    const questionBox = $("#recommendationQuestionBank") || $("#recommendationQuestions");
    if (!form && !questionBox) return;
    if (!isLoggedIn()) return;
    try {
      const data = await api("/api/recommendation/questions");
      const questions = data.questions || [];
      if (questionBox && questions.length) {
        questionBox.innerHTML = questions.map((q) => `
          <fieldset class="question-card recommendation-question">
            <legend>${esc(q.question)}</legend>
            <div class="rating-row">
              ${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rec_${esc(q.id)}" value="${n}" ${n === 3 ? "checked" : ""}> <span>${n}</span></label>`).join("")}
            </div>
          </fieldset>
        `).join("");
      }
    } catch (_) {}
    if (!form) return;
    bindOnce(form, "submit", async (e) => {
      e.preventDefault();
      if (!isLoggedIn()) return redirect("signin.html");
      const raw = new FormData(form);
      const payload = {};
      const answers = {};
      raw.forEach((value, key) => {
        if (key.startsWith("rec_")) answers[key.replace(/^rec_/, "")] = value;
        else payload[key] = value;
      });
      $$("#recommendationQuestionBank input:checked, #recommendationQuestions input:checked").forEach((input) => {
        if (input.name.startsWith("rec_")) answers[input.name.replace(/^rec_/, "")] = input.value;
      });
      payload.answers = answers;
      try {
        const result = await api("/api/recommendations", { method: "POST", body: payload });
        renderRecommendation(result);
      } catch (err) {
        showMessage(err.message, "error");
      }
    }, "recommendation");
  }

  function renderRecommendation(result) {
    const box = $("#recommendationResult") || $("#recommendationOutput") || document.createElement("div");
    if (!box.id) {
      box.id = "recommendationResult";
      ($("#recommendationForm") || document.body).after(box);
    }
    const specs = result.recommended_specializations || [];
    const jobs = result.recommended_jobs || [];
    box.innerHTML = `
      <section class="card result-card recommendation-summary">
        <div>
          <span class="pill">${esc(result.recommendation_basis || "quiz")}</span>
          <h2>Your AI recommendation</h2>
          <p>${esc(result.summary || "Specializations and jobs were ranked separately based on your answers.")}</p>
        </div>
      </section>
      <h2>Recommended Specializations</h2>
      <div class="grid recommendation-grid">
        ${specs.length ? specs.map((spec) => `
          <article class="card recommendation-card">
            ${ring(first(spec.match_percentage, spec.score), "Match")}
            <div>
              <h3>${esc(spec.name)}</h3>
              <p>${esc(spec.reason || spec.description || "Matched from your quiz and profile.")}</p>
              ${spec.matched_skills?.length ? `<p class="muted">Matched: ${esc(spec.matched_skills.join(", "))}</p>` : ""}
              <a class="btn primary" href="Specialization.html?id=${esc(spec.specialization_id || spec.id)}">View Specialization</a>
            </div>
          </article>
        `).join("") : emptyCard("No specialization matches yet. Add specializations or answer more questions.")}
      </div>
      <h2>Recommended Jobs</h2>
      <div class="grid recommendation-grid">
        ${jobs.length ? jobs.map((job) => `
          <article class="card recommendation-card">
            ${ring(first(job.match_percentage, job.score), "Job")}
            <div>
              <h3>${esc(job.title)}</h3>
              <p>${esc(job.reason || job.description || "Matched from job skills.")}</p>
              ${job.matched_skills?.length ? `<p class="muted">Matched: ${esc(job.matched_skills.join(", "))}</p>` : ""}
              <a class="btn primary" href="jobs.html?id=${esc(job.job_id || job.id)}">View Job</a>
            </div>
          </article>
        `).join("") : emptyCard("No job matches yet. Add jobs from admin or add more skills.")}
      </div>
      ${result.roadmap?.length ? `<h2>Roadmap</h2><div class="card"><ol>${result.roadmap.map((item) => `<li>${esc(item)}</li>`).join("")}</ol></div>` : ""}
    `;
  }

  function setupATS() {
    const checkForm = $("#atsCheckForm") || $("form[data-form='ats-check']");
    const genForm = $("#atsGenerateForm") || $("form[data-form='ats-generate']");
    if (checkForm) {
      bindOnce(checkForm, "submit", async (e) => {
        e.preventDefault();
        if (!isLoggedIn()) return redirect("signin.html");
        const fd = new FormData(checkForm);
        const resumeField = checkForm.querySelector("input[type='file']");
        if (resumeField?.files?.[0] && !fd.get("resume_file")) fd.set("resume_file", resumeField.files[0]);
        try {
          const result = await api("/api/ats/check", { method: "POST", body: fd });
          renderATSCheck(result);
        } catch (err) {
          showMessage(err.message, "error");
        }
      }, "atscheck");
    }
    if (genForm) {
      bindOnce(genForm, "submit", async (e) => {
        e.preventDefault();
        if (!isLoggedIn()) return redirect("signin.html");
        const fd = new FormData(genForm);
        const resumeField = genForm.querySelector("input[type='file']");
        if (resumeField?.files?.[0] && !fd.get("resume")) fd.set("resume", resumeField.files[0]);
        try {
          const result = await api("/api/ats/generate", { method: "POST", body: fd });
          renderATSGenerated(result);
        } catch (err) {
          showMessage(err.message, "error");
        }
      }, "atsgenerate");
    }
  }

  function renderATSCheck(result) {
    const box = $("#atsResult") || $("#atsCheckResult") || document.createElement("div");
    if (!box.id) {
      box.id = "atsResult";
      ($("#atsCheckForm") || document.body).after(box);
    }
    const score = pct(first(result.ats_score, result.score));
    box.innerHTML = `
      <section class="card result-card">
        ${ring(score, "ATS")}
        <div>
          <h2>ATS Analysis</h2>
          <p>${esc(result.summary || "Resume analysis completed.")}</p>
          <div class="two-cols">
            <div><h3>Matched keywords</h3><p>${esc((result.matched_keywords || []).join(", ") || "None detected")}</p></div>
            <div><h3>Missing keywords</h3><p>${esc((result.missing_keywords || []).join(", ") || "No major missing keywords")}</p></div>
          </div>
          ${result.improvements?.length ? `<h3>Improvements</h3><ul>${result.improvements.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </div>
      </section>
    `;
  }

  function renderATSGenerated(result) {
    const summaryBox = $("#summarySection") || $("#enhancedSummary") || $("#summary") || $(".summary-section");
    const resumeBox = $("#generatedResume") || $("#atsGenerateResult") || $("#generatedResumeBox");
    const summary = result.enhanced_summary || result.summary || "";
    const fullResume = result.full_resume || summary;
    if (summaryBox) {
      summaryBox.innerHTML = `
        <section class="card ai-summary-card">
          <span class="pill">${result.ai_powered ? "AI generated" : "Dynamic fallback"}</span>
          <h2>Enhanced Summary</h2>
          <p>${esc(summary)}</p>
        </section>
      `;
    }
    if (resumeBox) {
      resumeBox.innerHTML = `
        <section class="card generated-resume-card">
          <div class="card-top"><h2>Generated Resume</h2><button type="button" class="btn ghost" id="copyResumeBtn">Copy</button></div>
          <pre>${esc(fullResume)}</pre>
          ${result.improvements?.length ? `<h3>Next improvements</h3><ul>${result.improvements.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </section>
      `;
      bindOnce($("#copyResumeBtn"), "click", async () => {
        await navigator.clipboard?.writeText(fullResume);
        showMessage("Resume copied", "success");
      }, "copyresume");
    } else if (!summaryBox) {
      showMessage(summary || "Resume generated", "success");
    }
  }

  async function loadAdmin() {
    if (!pageName.includes("admin")) return;
    const ok = await requireAdmin();
    if (!ok) return;
    await Promise.allSettled([loadAdminStats(), loadAdminLists(), fillAdminDropdowns()]);
    setupAdminForms();
  }

  async function loadAdminStats() {
    const box = $("#adminStatsBox") || $("#adminStats") || $("#statsBox");
    if (!box) return;
    try {
      const stats = await api("/api/admin/stats");
      box.innerHTML = Object.entries(stats).map(([key, value]) => `<div class="stat-card"><strong>${esc(value)}</strong><span>${esc(key.replace(/_/g, " "))}</span></div>`).join("");
    } catch (err) {
      box.innerHTML = emptyCard(err.message);
    }
  }

  async function fillAdminDropdowns() {
    try {
      const [specs, courses] = await Promise.all([api("/api/specializations"), api("/api/courses")]);
      const specRows = specs.specializations || [];
      const courseRows = courses.courses || [];
      $$('select[name="specialization_id"], select[name="spec_id"], #specialization_id, #spec_id').forEach((select) => {
        const current = select.value;
        select.innerHTML = `<option value="">Choose specialization</option>` + specRows.map((s) => `<option value="${esc(s.specialization_id || s.id)}">${esc(s.name)}</option>`).join("");
        if (current) select.value = current;
      });
      $$('select[name="course_id"], #course_id').forEach((select) => {
        const current = select.value;
        select.innerHTML = `<option value="">Choose course</option>` + courseRows.map((c) => `<option value="${esc(c.course_id || c.id)}">${esc(c.title)}</option>`).join("");
        if (current) select.value = current;
      });
    } catch (_) {}
  }

  async function loadAdminLists() {
    const targets = [
      ["#adminSpecializationsList", "/api/specializations", "specializations", renderAdminSpecialization],
      ["#adminCoursesList", "/api/courses", "courses", renderAdminCourse],
      ["#adminJobsList", "/api/jobs", "jobs", renderAdminJob],
      ["#adminQuizzesList", "/api/quizzes", "quizzes", renderAdminQuiz],
      ["#adminCertificatesList", "/api/certificates", "certificates", renderAdminCertificate],
      ["#adminUsersList", "/api/admin/users", "users", renderAdminUser],
    ];
    for (const [selector, url, key, renderer] of targets) {
      const box = $(selector);
      if (!box) continue;
      try {
        const data = await api(url);
        const rows = data[key] || [];
        box.innerHTML = rows.length ? rows.map(renderer).join("") : emptyCard(`No ${key} yet.`);
      } catch (err) {
        box.innerHTML = emptyCard(err.message);
      }
    }
    bindAdminActions();
  }

  function adminRow(type, id, title, meta, extra = "") {
    return `
      <article class="admin-row" data-type="${esc(type)}" data-id="${esc(id)}">
        <div><strong>${esc(title)}</strong><span>${esc(meta || "")}</span>${extra}</div>
        <div class="admin-actions">
          ${["specialization", "course", "job"].includes(type) ? `<button class="btn ghost admin-edit" type="button">Edit</button>` : ""}
          <button class="btn danger admin-delete" type="button">Delete</button>
        </div>
      </article>
    `;
  }

  function renderAdminSpecialization(s) { return adminRow("specialization", s.specialization_id || s.id, s.name, s.description); }
  function renderAdminCourse(c) { return adminRow("course", c.course_id || c.id, c.title, `${first(c.specialization_name, "")} • ${first(c.level, "")}`); }
  function renderAdminJob(j) { return adminRow("job", j.job_id || j.id, j.title, first(j.specialization, j.specialization_name)); }
  function renderAdminQuiz(q) { return adminRow("quiz", q.quiz_id || q.id, q.title, first(q.course_title, "")); }
  function renderAdminCertificate(c) { return adminRow("certificate", c.id || c.certification_id, c.name, first(c.specialization_name, c.type)); }
  function renderAdminUser(u) {
    const id = u.id || u.user_id;
    return `
      <article class="admin-row" data-type="user" data-id="${esc(id)}">
        <div><strong>${esc(u.name)}</strong><span>${esc(u.email)} • ${esc(u.role)} ${u.banned ? "• banned" : ""}</span></div>
        <div class="admin-actions">
          <button class="btn ghost admin-role" data-role="${u.role === "admin" ? "student" : "admin"}" type="button">Make ${u.role === "admin" ? "Student" : "Admin"}</button>
          <button class="btn danger admin-ban" data-banned="${u.banned ? "1" : "0"}" type="button">${u.banned ? "Unban" : "Ban"}</button>
        </div>
      </article>
    `;
  }

  function bindAdminActions() {
    $$(".admin-delete").forEach((btn) => bindOnce(btn, "click", async () => {
      const row = btn.closest(".admin-row");
      const type = row?.dataset.type;
      const id = row?.dataset.id;
      if (!id || !type) return;
      if (!confirm("Delete this item?")) return;
      const paths = { specialization: `/api/specializations/${id}`, course: `/api/courses/${id}`, job: `/api/jobs/${id}`, quiz: `/api/quizzes/${id}`, certificate: `/api/certificates/${id}` };
      try {
        await api(paths[type], { method: "DELETE" });
        showMessage("Deleted", "success");
        await loadAdminLists();
      } catch (err) { showMessage(err.message, "error"); }
    }, "delete"));

    $$(".admin-ban").forEach((btn) => bindOnce(btn, "click", async () => {
      const row = btn.closest(".admin-row");
      const id = row?.dataset.id;
      const banned = btn.dataset.banned === "1";
      try {
        await api(`/api/admin/users/${id}/${banned ? "unban" : "ban"}`, { method: "POST", body: {} });
        showMessage(banned ? "User unbanned" : "User banned", "success");
        await loadAdminLists();
      } catch (err) { showMessage(err.message, "error"); }
    }, "ban"));

    $$(".admin-role").forEach((btn) => bindOnce(btn, "click", async () => {
      const row = btn.closest(".admin-row");
      const id = row?.dataset.id;
      const role = btn.dataset.role;
      try {
        await api(`/api/admin/users/${id}/role`, { method: "POST", body: { role } });
        showMessage("Role updated", "success");
        await loadAdminLists();
      } catch (err) { showMessage(err.message, "error"); }
    }, "role"));

    $$(".admin-edit").forEach((btn) => bindOnce(btn, "click", async () => {
      const row = btn.closest(".admin-row");
      const type = row?.dataset.type;
      const id = row?.dataset.id;
      openAdminEdit(type, id);
    }, "edit"));
  }

  async function openAdminEdit(type, id) {
    try {
      const path = type === "specialization" ? `/api/specializations/${id}` : type === "course" ? `/api/courses/${id}` : `/api/jobs/${id}`;
      const data = await api(path);
      const item = data[type] || data.specialization || data.course || data.job || data;
      const formId = type === "specialization" ? "specializationForm" : type === "course" ? "courseForm" : "jobForm";
      const form = $(`#${formId}`) || $(`form[data-admin='${type}']`);
      if (!form) return showMessage(`No ${type} form found for editing`, "error");
      form.dataset.editId = id;
      Object.entries(item).forEach(([key, value]) => {
        const field = form.elements[key] || form.elements[key.replace(/_url$/, "")];
        if (field && field.type !== "file") field.value = value ?? "";
      });
      const title = form.querySelector("h2,h1");
      if (title) title.textContent = `Edit ${type}`;
      const submit = form.querySelector("button[type='submit']");
      if (submit) submit.textContent = `Update ${type}`;
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  function setupAdminForms() {
    bindAdminForm("specializationForm", "/api/specializations", "specialization", true);
    bindAdminForm("courseForm", "/api/courses", "course", true);
    bindAdminForm("jobForm", "/api/jobs", "job", false);
    bindAdminForm("certificateForm", "/api/certificates", "certificate", false);
    setupQuizAdminForm();
  }

  function bindAdminForm(id, createPath, type, multipart) {
    const form = $(`#${id}`) || $(`form[data-admin='${type}']`);
    if (!form) return;
    bindOnce(form, "submit", async (e) => {
      e.preventDefault();
      const editId = form.dataset.editId;
      const path = editId ? `/api/admin/${type}s/${editId}` : createPath;
      const method = editId ? "PUT" : "POST";
      const body = multipart ? new FormData(form) : formDataToObject(form);
      try {
        await api(path, { method, body });
        showMessage(editId ? `${type} updated` : `${type} added`, "success");
        form.reset();
        delete form.dataset.editId;
        await Promise.allSettled([loadAdminStats(), loadAdminLists(), fillAdminDropdowns()]);
      } catch (err) {
        showMessage(err.message, "error");
      }
    }, `${type}form`);
  }

  function setupQuizAdminForm() {
    const form = $("#quizForm") || $("form[data-admin='quiz']");
    if (!form) return;
    const addQuestionBtn = $("#addQuestionBtn") || $("[data-add-question]");
    const questionsBox = $("#quizQuestionsBuilder") || $("#questionsBuilder");
    if (addQuestionBtn && questionsBox) {
      bindOnce(addQuestionBtn, "click", () => {
        const index = questionsBox.children.length + 1;
        const div = document.createElement("div");
        div.className = "question-builder card";
        div.innerHTML = `
          <h3>Question ${index}</h3>
          <input name="question_${index}" placeholder="Question" required>
          <div class="form-grid">
            <input name="option_a_${index}" placeholder="Option A" required>
            <input name="option_b_${index}" placeholder="Option B" required>
            <input name="option_c_${index}" placeholder="Option C" required>
            <input name="option_d_${index}" placeholder="Option D" required>
          </div>
          <select name="correct_answer_${index}" required><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select>
        `;
        questionsBox.appendChild(div);
      }, "addquestion");
    }
    bindOnce(form, "submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = formDataToObject(form);
      const questions = [];
      const indexes = new Set();
      for (const key of fd.keys()) {
        const m = key.match(/_(\d+)$/);
        if (m) indexes.add(m[1]);
      }
      indexes.forEach((i) => {
        const q = fd.get(`question_${i}`);
        if (!q) return;
        questions.push({
          question: q,
          option_a: fd.get(`option_a_${i}`),
          option_b: fd.get(`option_b_${i}`),
          option_c: fd.get(`option_c_${i}`),
          option_d: fd.get(`option_d_${i}`),
          correct_answer: fd.get(`correct_answer_${i}`) || "A",
        });
      });
      payload.questions = questions;
      try {
        await api("/api/quizzes", { method: "POST", body: payload });
        showMessage("Quiz added", "success");
        form.reset();
        if (questionsBox) questionsBox.innerHTML = "";
        await loadAdminLists();
      } catch (err) {
        showMessage(err.message, "error");
      }
    }, "quizadmin");
  }

  function expose() {
    Object.assign(window, {
      navbar,
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
      loadJobs,
      loadJobDetails,
      loadQuizzes,
      loadQuizDetails,
      setupRecommendation,
      setupATS,
      loadAdmin,
      enrollSpecialization,
      unenrollSpecialization,
      trackCourseOpened,
      SQRApi: api,
    });
  }

  async function init() {
    expose();
    navbar();
    setupSignup();
    setupSignin();
    blockAdminFromStudentPages();
    setupATS();
    await Promise.allSettled([
      refreshMe(),
      loadHome(),
      loadProfile(),
      loadSpecializations(),
      loadCourses(),
      loadJobs(),
      loadQuizzes(),
      setupRecommendation(),
      loadAdmin(),
    ]);
  }

  expose();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
