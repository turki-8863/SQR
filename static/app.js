const API = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "http://127.0.0.1:5000"
  : "https://sqr-ba83.onrender.com";

let lastGeneratedResume = "";

function getToken() {
  return localStorage.getItem("sqr_token") || localStorage.getItem("token");
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("sqr_user") || "null");
  } catch {
    return null;
  }
}

function setAuth(token, user) {
  localStorage.setItem("sqr_token", token);
  localStorage.setItem("sqr_user", JSON.stringify(user));
  localStorage.removeItem("token");
  lastGeneratedResume = "";
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

function logout() {
  const user = getUser();

  if (user?.id) {
    localStorage.removeItem("lastGeneratedResume_user_" + user.id);
  }

  localStorage.removeItem("sqr_token");
  localStorage.removeItem("sqr_user");
  localStorage.removeItem("token");
  localStorage.removeItem("lastGeneratedResume");
  localStorage.removeItem("ats_data");
  localStorage.removeItem("ats_resume");
  localStorage.removeItem("ats_result");
  localStorage.removeItem("ats_latest");
  localStorage.removeItem("generated_resume");
  sessionStorage.removeItem("ats_data");
  sessionStorage.removeItem("ats_resume");
  sessionStorage.removeItem("ats_result");
  sessionStorage.removeItem("ats_latest");
  sessionStorage.removeItem("generated_resume");

  lastGeneratedResume = "";
  window.location.href = "signin.html";
}

function showMessage(text, type = "error") {
  const box = document.getElementById("message");
  if (!box) return;
  box.innerHTML = text;
  box.className = type === "success" ? "alert success" : "alert error";
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...authHeaders()
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(API + path, {
    ...options,
    headers
  });

  let data = {};
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(data.error || data.message || data.details || `Request failed (${res.status})`);
  }

  return data;
}

async function apiTry(paths, options = {}) {
  let lastError;

  for (const path of paths) {
    try {
      return await api(path, options);
    } catch (err) {
      lastError = err;
      if (!String(err.message).includes("404")) throw err;
    }
  }

  throw lastError || new Error("Request failed");
}

function asArray(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  return [];
}

function getId(row) {
  return row?.id || row?.specialization_id || row?.course_id || row?.quiz_id || row?.job_id || row?.user_id;
}

function fileUrl(filename) {
  if (!filename) return "";
  if (String(filename).startsWith("http")) return filename;
  if (String(filename).startsWith("/uploads/")) return API + filename;
  return `${API}/uploads/${filename}`;
}

function normalizeFormData(form) {
  const data = Object.fromEntries(new FormData(form).entries());

  if (data.spec_id && !data.specialization_id) data.specialization_id = data.spec_id;
  if (data.specialization && !data.specialization_id) data.specialization_id = data.specialization;
  if (data.course_id && !data.course) data.course = data.course_id;
  if (data.required_skills && !data.skills) data.skills = data.required_skills;
  if (data.skills && !data.required_skills) data.required_skills = data.skills;

  return data;
}

function navbar() {
  const user = getUser();

if (user && user.role === "admin") {
  document.body.insertAdjacentHTML("afterbegin", `
    <header class="navbar">
      <a href="admin.html" class="logo">
        <span>SQR</span>
        <small>Admin Panel</small>
      </a>

      <nav class="nav-links">
        <a href="admin.html">Admin</a>
      </nav>

      <div class="auth-buttons">
        <button onclick="logout()" class="btn danger">Logout</button>
      </div>
    </header>
  `);
  return;
}

  document.body.insertAdjacentHTML("afterbegin", `
    <header class="navbar">
      <a href="gp.html" class="logo">
        <span>SQR</span>
        <small>Skill Quest Road</small>
      </a>

      <nav class="nav-links">
        <a href="gp.html">Home</a>
        <a href="Specialization.html">Specializations</a>
        <a href="Courses.html">Courses</a>
        <a href="ATS.html">ATS</a>
        <a href="jobs.html">Jobs</a>
        <a href="recommendation.html">Recommendation</a>
        ${user ? `<a href="profile.html">Profile</a>` : ""}
      </nav>

      <div class="auth-buttons">
        ${user
          ? `<button onclick="logout()" class="btn danger">Logout</button>`
          : `<a href="signin.html" class="btn ghost">Sign In</a><a href="signup.html" class="btn primary">Sign Up</a>`
        }
      </div>
    </header>
  `);
}

function requireLogin() {
  if (!getToken()) window.location.href = "signin.html";
}

function requireAdmin() {
  const user = getUser();

  if (!user || user.role !== "admin") {
    alert("Admin access only");
    window.location.href = "gp.html";
  }
}

function blockAdminFromStudentPages() {
  const user = getUser();

  if (!user || user.role !== "admin") return;

  const currentPage = location.pathname.split("/").pop() || "gp.html";

  if (currentPage !== "admin.html") {
    window.location.href = "admin.html";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  blockAdminFromStudentPages();

  setupSignup();
  setupSignin();
  loadProfile();
  loadSpecializations();
  loadSpecializationDetails();
  loadCourses();
  loadCourseDetails();
  loadJobs();
  setupRecommendation();
  setupATS();
  loadAdmin();
});

function setupSignup() {
  const form = document.getElementById("signupForm");
  if (!form || form.dataset.ready) return;
  form.dataset.ready = "1";

  const passwordInput = document.getElementById("password");
  const passwordRules = {
    lengthCheck: password => password.length >= 8,
    upperCheck: password => /[A-Z]/.test(password),
    lowerCheck: password => /[a-z]/.test(password),
    numberCheck: password => /[0-9]/.test(password),
    specialCheck: password => /[^A-Za-z0-9]/.test(password)
  };

  function updatePasswordChecklist() {
    if (!passwordInput) return;
    const password = passwordInput.value;

    Object.keys(passwordRules).forEach(id => {
      const item = document.getElementById(id);
      if (!item) return;
      const icon = item.querySelector("span");

      if (passwordRules[id](password)) {
        item.classList.add("valid");
        if (icon) icon.textContent = "✓";
      } else {
        item.classList.remove("valid");
        if (icon) icon.textContent = "✗";
      }
    });
  }

  function isPasswordStrong(password) {
    return Object.values(passwordRules).every(rule => rule(password));
  }

  if (passwordInput) {
    passwordInput.addEventListener("input", updatePasswordChecklist);
    updatePasswordChecklist();
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const data = {
      name: document.getElementById("name")?.value.trim() || "",
      username: document.getElementById("username")?.value.trim().toLowerCase() || "",
      email: document.getElementById("email")?.value.trim().toLowerCase() || "",
      password: document.getElementById("password")?.value || ""
    };

    if (!data.name || !data.username || !data.email || !data.password) {
      showMessage("Name, username, email, and password are required");
      return;
    }

    if (!isPasswordStrong(data.password)) {
      showMessage("Please complete all password requirements.");
      return;
    }

    try {
      const result = await api("/api/signup", {
        method: "POST",
        body: JSON.stringify(data)
      });

      setAuth(result.token, result.user);
      showMessage("Account created successfully", "success");
      setTimeout(() => window.location.href = "profile.html", 700);
    } catch (err) {
      showMessage(err.message);
    }
  });
}

function setupSignin() {
  const form = document.getElementById("signinForm");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const data = {
      email: document.getElementById("email")?.value.trim(),
      password: document.getElementById("password")?.value
    };

    try {
      const result = await apiTry(["/api/login", "/api/signin"], {
        method: "POST",
        body: JSON.stringify(data)
      });

      setAuth(result.token, result.user);
      showMessage("Signed in successfully", "success");
      setTimeout(() => window.location.href = "profile.html", 700);
    } catch (err) {
      showMessage(err.message);
    }
  });
}

async function loadProfile() {
  const box = document.getElementById("profileBox");
  if (!box) return;

  requireLogin();

  try {
    const data = await api("/api/profile");
    const user = data.user || data;

    box.innerHTML = `
      <div class="card">
        <h2>${user.name || "User"}</h2>
        <p><b>Email:</b> ${user.email || ""}</p>
        <p><b>Role:</b> ${user.role || "student"}</p>
      </div>
    `;

    const form = document.getElementById("profileForm");

    if (form && !form.dataset.ready) {
      form.dataset.ready = "1";

      if (document.getElementById("name")) document.getElementById("name").value = user.name || "";
      if (document.getElementById("skills")) document.getElementById("skills").value = user.skills || "";
      if (document.getElementById("interests")) document.getElementById("interests").value = user.interests || "";
      if (document.getElementById("goal")) document.getElementById("goal").value = user.goal || "";

      form.addEventListener("submit", async e => {
        e.preventDefault();

        try {
          await api("/api/profile", {
            method: "PUT",
            body: JSON.stringify({
              name: document.getElementById("name")?.value || "",
              skills: document.getElementById("skills")?.value || "",
              interests: document.getElementById("interests")?.value || "",
              goal: document.getElementById("goal")?.value || ""
            })
          });

          showMessage("Profile updated", "success");
        } catch (err) {
          showMessage(err.message);
        }
      });
    }

    loadProgress(data);
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadProgress(profileData = null) {
  const box = document.getElementById("progressBox");
  if (!box) return;

  try {
    const data = profileData || await api("/api/profile");
    const progress = data.progress || data.specialization_progress || [];

    box.innerHTML = progress.map(p => `
      <div class="card">
        <h3>${p.name || p.specialization || p.specialization_name || "Specialization"}</h3>
        <div class="progress-box">
          <div class="progress-bar" style="width:${p.progress || p.percentage || 0}%"></div>
        </div>
        <p>${p.progress || p.percentage || 0}% completed</p>
      </div>
    `).join("") || `<p>No progress yet.</p>`;
  } catch {
    box.innerHTML = "";
  }
}


async function loadSpecializations() {
  const box = document.getElementById("specializationsBox");
  const selects = [
    document.getElementById("specSelect"),
    document.getElementById("courseSpecFilter"),
    document.getElementById("jobSpecFilter"),
    document.getElementById("courseSpecialization"),
    document.getElementById("courseSpec"),
    document.getElementById("courseSpecSelect"),
    document.getElementById("jobSpecialization"),
    document.getElementById("jobSpec"),
    document.getElementById("jobSpecSelect"),
    document.getElementById("certSpecialization")
  ].filter(Boolean);

  if (!box && !selects.length) return;

  try {
    const raw = await api("/api/specializations");
    const specs = asArray(raw, "specializations");

    if (box) {
      box.innerHTML = specs.map(s => `
        <div class="card card-mini" onclick="window.location.href='specialization-details.html?id=${getId(s)}'">
          ${s.image || s.image_url ? `<img src="${fileUrl(s.image_url || s.image)}" class="card-img">` : ""}
          <h3>${s.name || ""}</h3>
          <p>${s.description || ""}</p>
        </div>
      `).join("") || `<p>No specializations yet.</p>`;
    }

    const options = `<option value="">All Specializations</option>` + specs.map(s => `
      <option value="${getId(s)}">${s.name}</option>
    `).join("");

    selects.forEach(el => {
      el.innerHTML = options;
    });

    setupSelectSearch("courseSpecializationSearch", "courseSpecialization");
    setupSelectSearch("jobSpecializationSearch", "jobSpecialization");
    setupSelectSearch("certSpecializationSearch", "certSpecialization");
  } catch (err) {
    showMessage(err.message);
  }
}

function setupSelectSearch(inputId, selectId) {
  const input = document.getElementById(inputId);
  const select = document.getElementById(selectId);
  if (!input || !select || input.dataset.ready) return;
  input.dataset.ready = "1";

  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    Array.from(select.options).forEach(option => {
      if (!option.value) {
        option.hidden = false;
        return;
      }
      option.hidden = term && !option.textContent.toLowerCase().includes(term);
    });
  });
}

async function loadCoursesIntoAdminSelects() {
  const selects = [
    document.getElementById("quizCourseSelect"),
    document.getElementById("quizCourse"),
    document.getElementById("courseSelect")
  ].filter(Boolean);

  if (!selects.length) return;

  try {
    const raw = await api("/api/courses");
    const courses = asArray(raw, "courses");
    const options = `<option value="">Choose Course</option>` + courses.map(c => {
      const specName = c.specialization_name || c.specialization || c.spec_name || "";
      const label = `${c.title || "Course"}${specName ? " - " + specName : ""}`;
      return `<option value="${getId(c)}">${label}</option>`;
    }).join("");

    selects.forEach(select => {
      select.innerHTML = options;
    });

    setupSelectSearch("quizCourseSearch", "quizCourseSelect");
    setupSelectSearch("quizCourseSearch", "quizCourse");
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadSpecializationDetails() {
  const box = document.getElementById("specializationDetailsBox");
  if (!box) return;

  const id = new URLSearchParams(location.search).get("id");

  if (!id) {
    box.innerHTML = `<div class="card">Specialization not found.</div>`;
    return;
  }

  try {
    const s = await api(`/api/specializations/${id}`);

    box.innerHTML = `
      <div class="detail-hero card">
        ${s.image || s.image_url ? `<img src="${fileUrl(s.image_url || s.image)}" class="card-img">` : ""}
        <h1>${s.name || ""}</h1>
        <p>${s.description || ""}</p>

        <h3>Skills</h3>
        <p>${s.skills || "No skills added yet."}</p>

        <h3>Roadmap</h3>
        <p>${s.roadmap || "No roadmap added yet."}</p>

        <h3>Job Titles</h3>
        <p>${s.job_titles || s.career_paths || "No job titles added yet."}</p>
      </div>

      <h2>Courses</h2>
      <div class="grid">
        ${(s.courses || []).map(c => `
          <div class="card card-mini" onclick="window.location.href='course-details.html?id=${getId(c)}'">
            ${c.image || c.image_url ? `<img src="${fileUrl(c.image_url || c.image)}" class="card-img">` : ""}
            <h3>${c.title || ""}</h3>
          </div>
        `).join("") || `<p>No courses yet.</p>`}
      </div>
    `;
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadCourses() {
  const box = document.getElementById("coursesBox");
  if (!box) return;

  try {
    const spec = document.getElementById("courseSpecFilter")?.value || "";
    const level = document.getElementById("courseLevelFilter")?.value || "";
    const params = new URLSearchParams();

    if (spec) {
      params.append("spec_id", spec);
      params.append("specialization_id", spec);
    }

    if (level) params.append("level", level);

    const raw = await api(`/api/courses${params.toString() ? "?" + params.toString() : ""}`);
    const courses = asArray(raw, "courses");

    box.innerHTML = courses.map(c => `
      <div class="card card-mini" onclick="window.location.href='course-details.html?id=${getId(c)}'">
        ${c.image || c.image_url ? `<img src="${fileUrl(c.image_url || c.image)}" class="card-img">` : ""}
        <h3>${escapeHTML(c.title || "")}</h3>
        <p>${escapeHTML(c.description || "")}</p>
        <span class="badge">${escapeHTML(c.level_badge?.label || c.level || "Beginner")}</span>
      </div>
    `).join("") || `<p>No courses yet.</p>`;
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadCourseDetails() {
  const box = document.getElementById("courseDetailsBox");
  if (!box) return;

  const id = new URLSearchParams(location.search).get("id");

  if (!id) {
    box.innerHTML = `<div class="card">Course not found.</div>`;
    return;
  }

  try {
    let course = null;

    try {
      course = await api(`/api/courses/${id}`);
    } catch {
      const coursesRaw = await api("/api/courses");
      const courses = asArray(coursesRaw, "courses");
      course = courses.find(c => Number(getId(c)) === Number(id));
    }

    if (!course) {
      box.innerHTML = `<div class="card">Course not found.</div>`;
      return;
    }

    const quizRaw = await api(`/api/quizzes?course_id=${id}`);
    const quizzes = asArray(quizRaw, "quizzes");
    window.loadedQuizzes = quizzes;

    const courseLink = course.link || course.course_link || "";
    const courseVideo = course.video || course.video_url || "";

    box.innerHTML = `
      <div class="detail-hero card">
        ${course.image || course.image_url ? `<img src="${fileUrl(course.image_url || course.image)}" class="card-img">` : ""}

        <h1>${escapeHTML(course.title || "")}</h1>
        <p>${escapeHTML(course.description || "")}</p>
        <p><b>Level:</b> ${escapeHTML(course.level_badge?.label || course.level || "Beginner")}</p>

        ${courseVideo ? `
          <h3>Course Video</h3>
          <video
            controls
            class="course-video"
            style="width:100%;max-height:460px;border-radius:18px;margin:15px 0;background:#000;"
            onplay="trackCourseOpened(${getId(course)})"
          >
            <source src="${fileUrl(courseVideo)}">
            Your browser does not support the video tag.
          </video>
        ` : ""}

        ${courseLink ? `
          <a
            href="${escapeHTML(courseLink)}"
            target="_blank"
            class="btn primary"
            onclick="trackCourseOpened(${getId(course)})"
          >
            Open Course Link
          </a>
        ` : ""}
      </div>

      <div class="quiz-inside-course">
        <h2>Course Quizzes</h2>
        <p>Progress is tracked automatically from opening the course video/link and completing quizzes.</p>

        <div id="quizzesBox">
          ${quizzes.map(q => `
            <div class="card">
              <h3>${escapeHTML(q.title || "Quiz")}</h3>
              <p>${escapeHTML(q.description || "")}</p>
              <button onclick="startQuiz(${getId(q)})">Start Quiz</button>
            </div>
          `).join("") || `<p>No quizzes for this course yet.</p>`}
        </div>
      </div>
    `;
  } catch (err) {
    showMessage(err.message);
  }
}

async function trackCourseOpened(courseId) {
  requireLogin();

  try {
    await api(`/api/courses/${courseId}/open`, { method: "POST" });
    loadProgress();
  } catch (err) {
    console.warn("Course open tracking failed:", err.message);
  }
}

async function startQuiz(id) {
  const box = document.getElementById("quizBox") || document.getElementById("quizzesBox");
  if (!box) return;

  try {
    let quiz = (window.loadedQuizzes || []).find(q => Number(getId(q)) === Number(id));

    if (!quiz) {
      const raw = await api("/api/quizzes");
      quiz = asArray(raw, "quizzes").find(q => Number(getId(q)) === Number(id));
    }

    if (!quiz) throw new Error("Quiz not found");

    const questions = quiz.questions || [];
    if (!questions.length) throw new Error("This quiz has no questions yet");

    box.innerHTML = `
      <div class="card">
        <h2>${quiz.title || "Quiz"}</h2>

        <form id="takeQuizForm">
          ${questions.map((q, i) => `
            <div class="quiz-question">
              <h4>${i + 1}. ${q.question || q.question_text || ""}</h4>
              ${["a", "b", "c", "d"].map((letter, index) => {
                const value = q[`option_${letter}`] || q[`option${index + 1}`] || "";
                return `<label><input type="radio" name="q${getId(q)}" value="${letter.toUpperCase()}"> ${value}</label>`;
              }).join("")}
            </div>
          `).join("")}
          <button type="submit">Submit Quiz</button>
        </form>
      </div>
    `;

    document.getElementById("takeQuizForm").addEventListener("submit", async e => {
      e.preventDefault();

      const answers = {};

      questions.forEach(q => {
        const qid = getId(q);
        const selected = document.querySelector(`input[name="q${qid}"]:checked`);
        answers[qid] = selected ? selected.value : "";
      });

      try {
        const result = await api(`/api/quizzes/${id}/submit`, {
          method: "POST",
          body: JSON.stringify({ answers })
        });

        showMessage(`Quiz completed. Score: ${result.score}%`, "success");
        loadProgress();
      } catch (err) {
        showMessage(err.message);
      }
    });
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadJobs() {
  const box = document.getElementById("jobsBox");
  if (!box) return;

  try {
    const spec = document.getElementById("jobSpecFilter")?.value || "";
    const params = new URLSearchParams();

    if (spec) {
      params.append("specialization", spec);
      params.append("specialization_id", spec);
      params.append("spec_id", spec);
    }

    const raw = await api(`/api/jobs${params.toString() ? "?" + params.toString() : ""}`);
    const jobs = asArray(raw, "jobs");

    box.innerHTML = jobs.map(j => `
      <div class="card">
        <h3>${j.title || ""}</h3>
        <p>${j.description || ""}</p>
        <p><b>Specialization:</b> ${j.specialization || j.specialization_name || ""}</p>
        <p><b>Required Skills:</b> ${j.required_skills || j.skills || ""}</p>
        ${j.salary ? `<p><b>Salary:</b> ${j.salary}</p>` : ""}
        ${j.link ? `<a href="${j.link}" target="_blank" class="btn">Apply / Details</a>` : ""}
        ${j.match_percentage !== undefined ? `<p><b>Match:</b> ${j.match_percentage}%</p>` : ""}
      </div>
    `).join("") || `<p>No jobs yet.</p>`;
  } catch (err) {
    showMessage(err.message);
  }
}


function setupRecommendation() {
  const form = document.getElementById("recommendationForm") || document.getElementById("recForm");
  const box = document.getElementById("recommendationResult") || document.getElementById("resultBox") || document.getElementById("recOutput");

  if (!form || !box || form.dataset.ready) return;

  form.dataset.ready = "1";

  form.addEventListener("submit", async e => {
    e.preventDefault();
    requireLogin();

    const data = Object.fromEntries(new FormData(form).entries());

    data.interests = data.interests || document.getElementById("interests")?.value || "";
    data.skills = data.skills || document.getElementById("skills")?.value || "";
    data.goal = data.goal || document.getElementById("goal")?.value || "";
    data.preferred_work = data.preferred_work || document.getElementById("preferred_work")?.value || "";
    data.experience = data.experience || document.getElementById("experience")?.value || "";

    if (!data.answers) {
      const profileText = [data.interests, data.skills, data.goal, data.preferred_work, data.experience].filter(Boolean).join(" ");
      data.answers = profileText ? [{ question: "Student profile", answer: profileText }] : [];
    }

    try {
      const result = await apiTry(["/api/recommendation", "/api/recommendation/submit", "/api/recommendations"], {
        method: "POST",
        body: JSON.stringify(data)
      });

      const specs = result.recommended_specializations || [];
      const jobs = result.recommended_jobs || [];
      const best = specs[0] || result.best || result.recommendation || result;

      box.classList.remove("hidden");
      box.innerHTML = `
        <div class="card">
          <h2>Recommended Specialization</h2>
          <h3>${best.name || best.specialization || result.best_match || "Recommended Path"}</h3>
          <p>${best.reason || result.reason || result.summary || "This recommendation is based on your answers."}</p>
          <p><b>Match:</b> ${best.match_percentage || best.match_score || best.score || result.match_score || 0}%</p>

          ${Array.isArray(best.skills_to_learn) && best.skills_to_learn.length ? `
            <h3>Skills to Learn</h3>
            <ul>${best.skills_to_learn.map(x => `<li>${x}</li>`).join("")}</ul>
          ` : ""}

          ${Array.isArray(specs) && specs.length > 1 ? `
            <h3>Other Good Specializations</h3>
            <div class="grid">
              ${specs.slice(1, 5).map(s => `
                <div class="mini-card">
                  <strong>${s.name || "Specialization"}</strong>
                  <p>${s.match_percentage || s.match_score || 0}% match</p>
                  <small>${s.reason || "Matched with your answers."}</small>
                </div>
              `).join("")}
            </div>
          ` : ""}

          ${Array.isArray(jobs) && jobs.length ? `
            <h3>Recommended Jobs</h3>
            <div class="grid">
              ${jobs.slice(0, 6).map(j => `
                <div class="mini-card">
                  <strong>${j.title || "Job"}</strong>
                  <p>${j.match_percentage || j.score || 0}% match</p>
                </div>
              `).join("")}
            </div>
          ` : ""}

          ${Array.isArray(result.roadmap) && result.roadmap.length ? `
            <h3>Roadmap</h3>
            <ol>${result.roadmap.map(x => `<li>${x}</li>`).join("")}</ol>
          ` : ""}
        </div>
      `;

      showMessage("Recommendation generated successfully", "success");
    } catch (err) {
      showMessage(err.message);
    }
  });
}

function getATSUserKey() {
  const user = getUser();
  return user?.id ? `lastGeneratedResume_user_${user.id}` : "lastGeneratedResume_guest";
}

function clearOldSharedATSStorage() {
  [
    "ats_data",
    "ats_resume",
    "ats_result",
    "ats_latest",
    "generated_resume",
    "resume_data",
    "lastGeneratedResume"
  ].forEach(key => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

function resetATSFormsIfDifferentUser() {
  const user = getUser();
  const currentUserId = user?.id ? String(user.id) : "guest";
  const previousUserId = sessionStorage.getItem("sqr_active_ats_user");

  if (previousUserId && previousUserId !== currentUserId) {
    document.getElementById("atsGenerateForm")?.reset();
    document.getElementById("atsCheckForm")?.reset();

    [
      "generatedResume",
      "resumeOutput",
      "atsResult",
      "atsResults",
      "atsOutput",
      "atsCheckResult",
      "generatedResumeBox"
    ].forEach(id => {
      const box = document.getElementById(id);
      if (box) box.innerHTML = "";
    });

    lastGeneratedResume = "";
  }

  sessionStorage.setItem("sqr_active_ats_user", currentUserId);
}

function setupAtsChecker() {
  const checkForm = document.getElementById("atsCheckForm");
  if (!checkForm || checkForm.dataset.ready) return;

  checkForm.dataset.ready = "1";

  const textArea = document.getElementById("resume_text");
  if (textArea) {
    textArea.closest("div")?.remove();
    textArea.remove();
  }

  checkForm.addEventListener("submit", async e => {
    e.preventDefault();
    requireLogin();

    const resultBox =
      document.getElementById("atsCheckResult") ||
      document.getElementById("atsResult") ||
      document.getElementById("atsResults") ||
      document.getElementById("atsOutput");

    const resumeFile =
      document.getElementById("resume")?.files?.[0] ||
      document.getElementById("resume_file")?.files?.[0] ||
      document.querySelector('input[type="file"][name="resume"]')?.files?.[0] ||
      document.querySelector('input[type="file"][name="resume_file"]')?.files?.[0];

    const targetJob =
      document.getElementById("target_job_check")?.value?.trim() ||
      document.getElementById("target_job")?.value?.trim() ||
      document.getElementById("job_description")?.value?.trim() ||
      checkForm.querySelector('[name="target_job"]')?.value?.trim() ||
      checkForm.querySelector('[name="job_description"]')?.value?.trim() ||
      "";

    if (!targetJob) {
      showMessage("Target job or job description is required");
      return;
    }

    if (!resumeFile) {
      showMessage("Please upload your resume as PDF, DOCX, or TXT");
      return;
    }

    const allowed = [".pdf", ".docx", ".txt"];
    const fileName = resumeFile.name.toLowerCase();

    if (!allowed.some(ext => fileName.endsWith(ext))) {
      showMessage("Only PDF, DOCX, or TXT files are allowed");
      return;
    }

    const formData = new FormData();
    formData.append("target_job", targetJob);
    formData.append("job_description", targetJob);
    formData.append("resume", resumeFile);
    formData.append("resume_file", resumeFile);

    if (resultBox) {
      resultBox.classList.remove("hidden");
      resultBox.innerHTML = `
        <div class="card">
          <h2>Checking Resume...</h2>
          <p>SQR is analyzing your uploaded resume.</p>
        </div>
      `;
    }

    try {
      const result = await api("/api/ats/check", {
        method: "POST",
        body: formData
      });

      localStorage.setItem(`sqr_ats_check_user_${getUser()?.id || "guest"}`, JSON.stringify(result));

      if (resultBox) {
        const sectionScores = result.section_scores || {};

        resultBox.classList.remove("hidden");
        resultBox.innerHTML = `
          <div class="card">
            <h2>ATS Score: ${escapeHTML(result.ats_score ?? result.score ?? 0)}%</h2>

            <h3>Summary</h3>
            <p>${escapeHTML(result.summary || result.feedback || "ATS analysis completed.")}</p>

            <h3>Matched Keywords</h3>
            <p>${Array.isArray(result.matched_keywords) && result.matched_keywords.length ? result.matched_keywords.map(escapeHTML).join(", ") : "No matched keywords found."}</p>

            <h3>Missing Keywords</h3>
            <p>${Array.isArray(result.missing_keywords) && result.missing_keywords.length ? result.missing_keywords.map(escapeHTML).join(", ") : "No missing keywords found."}</p>

            <h3>Strengths</h3>
            <ul>
              ${Array.isArray(result.strengths) && result.strengths.length ? result.strengths.map(x => `<li>${escapeHTML(x)}</li>`).join("") : "<li>No strengths listed.</li>"}
            </ul>

            <h3>Weaknesses</h3>
            <ul>
              ${Array.isArray(result.weaknesses) && result.weaknesses.length ? result.weaknesses.map(x => `<li>${escapeHTML(x)}</li>`).join("") : "<li>No weaknesses listed.</li>"}
            </ul>

            <h3>Advice to Improve Resume</h3>
            <ul>
              ${Array.isArray(result.improvements) && result.improvements.length ? result.improvements.map(x => `<li>${escapeHTML(x)}</li>`).join("") : "<li>Add role-specific keywords, measurable achievements, and clear project details.</li>"}
            </ul>

            ${Object.keys(sectionScores).length ? `
              <h3>Section Scores</h3>
              <div class="grid">
                ${Object.entries(sectionScores).map(([key, value]) => `
                  <div class="mini-card">
                    <strong>${escapeHTML(key.replaceAll("_", " ").toUpperCase())}</strong>
                    <p>${escapeHTML(value)}%</p>
                  </div>
                `).join("")}
              </div>
            ` : ""}
          </div>
        `;
      }

      showMessage("ATS check completed successfully", "success");
    } catch (err) {
      if (resultBox) resultBox.innerHTML = "";
      showMessage(err.message);
    }
  });
}

async function loadOnlyThisUserLatestATS() {
  const user = getUser();
  if (!user?.id || !getToken()) return;

  try {
    const latest = await api("/api/ats/latest");
    if (!latest || !latest.id || String(latest.user_id) !== String(user.id)) return;

    const result = latest.result || {};
    const resume = latest.generated_resume || result.generated_resume || result.resume || latest.resume_text || "";

    if (resume) {
      lastGeneratedResume = resume;
      localStorage.setItem(getATSUserKey(), resume);
    }
  } catch {
    /* Latest ATS is optional. Do not block the page. */
  }
}

function setupATS() {
  clearOldSharedATSStorage();
  resetATSFormsIfDifferentUser();
  setupAtsChecker();

  const generateForm = document.getElementById("atsGenerateForm");

  if (generateForm && !generateForm.dataset.ready) {
    generateForm.dataset.ready = "1";

    generateForm.addEventListener("submit", async e => {
      e.preventDefault();
      requireLogin();

      const data = Object.fromEntries(new FormData(generateForm).entries());

      try {
        const result = await api("/api/ats/generate", {
          method: "POST",
          body: JSON.stringify(data)
        });

        lastGeneratedResume = result.generated_resume || result.resume || "";
        localStorage.setItem(getATSUserKey(), lastGeneratedResume);
        localStorage.setItem(`sqr_ats_generate_user_${getUser()?.id || "guest"}`, JSON.stringify(result));

        const box =
          document.getElementById("generatedResume") ||
          document.getElementById("resumeOutput") ||
          document.getElementById("generatedResumeBox") ||
          document.getElementById("atsOutput") ||
          document.getElementById("atsResult");

        if (box) {
          box.classList.remove("hidden");
          box.innerHTML = `
            <div class="card resume-preview">
              <h2>Generated ATS Resume</h2>
              ${result.ats_score !== undefined ? `<p><b>ATS Score:</b> ${escapeHTML(result.ats_score)}%</p>` : ""}
              ${result.enhanced_summary ? `<h3>Enhanced Summary</h3><p>${escapeHTML(result.enhanced_summary)}</p>` : ""}
              ${result.matched_keywords ? `<h3>Matched Keywords</h3><p>${result.matched_keywords.map(escapeHTML).join(", ")}</p>` : ""}
              <h3>Resume</h3>
              <pre class="resume-text">${escapeHTML(lastGeneratedResume || "No resume returned from backend.")}</pre>
              <div class="actions">
                <button type="button" onclick="copyGeneratedResume()">Copy Resume</button>
                <button type="button" onclick="exportResumePdf()">Export PDF</button>
                <button type="button" onclick="exportResumeDocx()">Export DOCX</button>
              </div>
            </div>
          `;
        }

        showMessage("ATS resume generated successfully", "success");
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  loadOnlyThisUserLatestATS();
}

async function copyGeneratedResume() {
  const saved = localStorage.getItem(getATSUserKey()) || "";
  lastGeneratedResume = lastGeneratedResume || saved;

  if (!lastGeneratedResume) return alert("Generate a resume first");

  await navigator.clipboard.writeText(lastGeneratedResume);
  alert("Resume copied");
}

async function downloadBlob(path, filename) {
  const saved = localStorage.getItem(getATSUserKey()) || "";
  lastGeneratedResume = lastGeneratedResume || saved;

  if (!lastGeneratedResume) return alert("Generate a resume first");

  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ resume: lastGeneratedResume })
  });

  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch {}
    throw new Error(data.error || "Export failed");
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

async function exportResumePdf() {
  try {
    await downloadBlob("/api/ats/export/pdf", "SQR_ATS_Resume.pdf");
  } catch (err) {
    alert(err.message);
  }
}

async function exportResumeDocx() {
  try {
    await downloadBlob("/api/ats/export/docx", "SQR_ATS_Resume.docx");
  } catch (err) {
    alert(err.message);
  }
}

async function loadAdmin() {
  const adminBox = document.getElementById("adminBox");
  if (!adminBox) return;

  requireAdmin();
  setupAdminForms();
  loadAdminUsers();
  loadSpecializations();
  loadAdminStats();
  loadAdminLists();
  loadCoursesIntoAdminSelects();
  showAdminSection("dashboardSection");
}

function setupAdminForms() {
  const specForm = document.getElementById("addSpecForm");
  const courseForm = document.getElementById("addCourseForm");
  const quizForm = document.getElementById("addQuizForm");
  const jobForm = document.getElementById("addJobForm");
  const certForm = document.getElementById("addCertForm");

  if (specForm && !specForm.dataset.ready) {
    specForm.dataset.ready = "1";
    specForm.addEventListener("submit", async e => {
      e.preventDefault();
      try {
        await api("/api/specializations", { method: "POST", body: new FormData(specForm) });
        showMessage("Specialization added", "success");
        specForm.reset();
        loadSpecializations();
        loadAdminStats();
        loadAdminLists();
      } catch (err) { showMessage(err.message); }
    });
  }

  if (courseForm && !courseForm.dataset.ready) {
    courseForm.dataset.ready = "1";
    courseForm.addEventListener("submit", async e => {
      e.preventDefault();
      const formData = new FormData(courseForm);
      const specValue = formData.get("specialization_id") || formData.get("spec_id") || document.getElementById("courseSpecialization")?.value || document.getElementById("courseSpec")?.value || "";
      const titleValue = formData.get("title") || formData.get("course_title") || document.getElementById("courseTitle")?.value || "";
      if (!specValue) return showMessage("Please choose a specialization for this course");
      if (!titleValue.trim()) return showMessage("Course title is required");
      formData.set("specialization_id", specValue);
      formData.set("spec_id", specValue);
      formData.set("title", titleValue.trim());
      formData.set("link", formData.get("link") || formData.get("course_link") || document.getElementById("courseLink")?.value || "");
      formData.set("course_link", formData.get("course_link") || formData.get("link") || "");
      try {
        await apiTry(["/api/courses", "/api/admin/courses"], { method: "POST", body: formData });
        showMessage("Course added", "success");
        courseForm.reset();
        loadCourses();
        loadSpecializations();
        loadCoursesIntoAdminSelects();
        loadAdminStats();
        loadAdminLists();
      } catch (err) { showMessage(err.message); }
    });
  }

  if (quizForm && !quizForm.dataset.ready) {
    quizForm.dataset.ready = "1";
    quizForm.addEventListener("submit", async e => {
      e.preventDefault();
      const data = normalizeFormData(quizForm);
      data.questions = [{
        question_text: data.question_text || data.question || "Question",
        option_a: data.option_a || data.option1 || "A",
        option_b: data.option_b || data.option2 || "B",
        option_c: data.option_c || data.option3 || "C",
        option_d: data.option_d || data.option4 || "D",
        correct_answer: data.correct_answer || data.answer || "A"
      }];
      try {
        await apiTry(["/api/admin/quizzes", "/api/quizzes"], { method: "POST", body: JSON.stringify(data) });
        showMessage("Quiz added", "success");
        quizForm.reset();
        loadAdminStats();
        loadAdminLists();
      } catch (err) { showMessage(err.message); }
    });
  }

  if (jobForm && !jobForm.dataset.ready) {
    jobForm.dataset.ready = "1";
    jobForm.addEventListener("submit", async e => {
      e.preventDefault();
      const data = normalizeFormData(jobForm);
      const specValue = data.specialization_id || data.spec_id || document.getElementById("jobSpecialization")?.value || document.getElementById("jobSpec")?.value || "";
      data.title = data.title || data.job_title || document.getElementById("jobTitle")?.value || "";
      if (!specValue) return showMessage("Please choose a specialization for this job");
      if (!data.title.trim()) return showMessage("Job title is required");
      data.specialization_id = specValue;
      data.spec_id = specValue;
      data.specialization = specValue;
      data.required_skills = data.required_skills || data.skills || document.getElementById("jobSkills")?.value || "";
      data.skills = data.required_skills;
      data.average_salary = data.average_salary || data.salary || document.getElementById("jobSalary")?.value || "";
      data.salary = data.average_salary;
      data.job_link = data.job_link || data.link || document.getElementById("jobLink")?.value || "";
      data.link = data.job_link;
      try {
        await apiTry(["/api/jobs", "/api/admin/jobs"], { method: "POST", body: JSON.stringify(data) });
        showMessage("Job added", "success");
        jobForm.reset();
        loadJobs();
        loadAdminStats();
        loadAdminLists();
      } catch (err) { showMessage(err.message); }
    });
  }

  if (certForm && !certForm.dataset.ready) {
    certForm.dataset.ready = "1";
    certForm.addEventListener("submit", async e => {
      e.preventDefault();
      const data = normalizeFormData(certForm);
      data.spec_id = data.spec_id || data.specialization_id;
      try {
        await apiTry(["/api/certificates", "/api/admin/certificates"], { method: "POST", body: JSON.stringify(data) });
        showMessage("Certificate added", "success");
        certForm.reset();
        loadAdminStats();
        loadAdminLists();
      } catch (err) { showMessage(err.message); }
    });
  }
}

async function loadAdminUsers() {
  const box = document.getElementById("usersBox");
  if (!box) return;

  try {
    const raw = await api("/api/admin/users");
    const users = asArray(raw, "users");

    box.innerHTML = users.map(u => `
      <div class="card">
        <h3>${u.name || ""}</h3>
        <p>${u.email || ""}</p>
        <p><b>Role:</b> ${u.role || "student"}</p>
        <p><b>Status:</b> ${(u.banned || u.is_banned) ? `<span class="status-banned">Banned</span>` : `<span class="status-active">Active</span>`}</p>

        ${u.role === "admin"
          ? `<button onclick="makeStudent(${getId(u)})">Make Student</button>`
          : `<button onclick="makeAdmin(${getId(u)})">Make Admin</button>`
        }

        ${(u.banned || u.is_banned)
          ? `<button onclick="unbanUser(${getId(u)})">Unban</button>`
          : `<button onclick="banUser(${getId(u)})" class="danger">Ban</button>`
        }
      </div>
    `).join("");
  } catch (err) {
    showMessage(err.message);
  }
}

async function makeAdmin(id) {
  try {
    await api(`/api/admin/users/${id}/make-admin`, { method: "PUT" });
    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function makeStudent(id) {
  try {
    await api(`/api/admin/users/${id}/make-student`, { method: "PUT" });
    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function banUser(id) {
  if (!confirm("Ban this user?")) return;

  try {
    await api(`/api/admin/users/${id}/ban`, { method: "PUT" });
    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function unbanUser(id) {
  try {
    await api(`/api/admin/users/${id}/unban`, { method: "PUT" });
    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}


function showAdminSection(sectionId) {
  document.querySelectorAll(".admin-section").forEach(section => section.classList.remove("active"));
  document.getElementById(sectionId)?.classList.add("active");
  document.querySelectorAll(".admin-menu button").forEach(btn => btn.classList.remove("active"));
  document.querySelector(`[data-section="${sectionId}"]`)?.classList.add("active");
}

async function loadAdminStats() {
  const box = document.getElementById("adminStatsBox");
  if (!box) return;
  try {
    const data = await api("/api/admin/stats");
    box.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><h3>Users</h3><p>${data.users || 0}</p></div>
        <div class="stat-card"><h3>Specializations</h3><p>${data.specializations || 0}</p></div>
        <div class="stat-card"><h3>Courses</h3><p>${data.courses || 0}</p></div>
        <div class="stat-card"><h3>Jobs</h3><p>${data.jobs || 0}</p></div>
        <div class="stat-card"><h3>Quizzes</h3><p>${data.quizzes || 0}</p></div>
        <div class="stat-card"><h3>Certificates</h3><p>${data.certificates || 0}</p></div>
      </div>`;
  } catch (err) { showMessage(err.message); }
}

async function loadAdminLists() {
  await Promise.allSettled([
    loadAdminSpecializationsList(),
    loadAdminCoursesList(),
    loadAdminJobsList(),
    loadAdminQuizzesList(),
    loadAdminCertificatesList()
  ]);
}

async function loadAdminSpecializationsList() {
  const box = document.getElementById("adminSpecializationsList");
  if (!box) return;
  const specs = asArray(await api("/api/specializations"), "specializations");
  box.innerHTML = specs.map(s => `<div class="card"><h3>${s.name || ""}</h3><p>${s.description || ""}</p><div class="admin-actions"><button onclick="editSpecialization(${getId(s)})">Edit</button><button class="danger" onclick="deleteItem('/api/specializations/${getId(s)}')">Delete</button></div></div>`).join("") || "<p>No specializations.</p>";
}

async function loadAdminCoursesList() {
  const box = document.getElementById("adminCoursesList");
  if (!box) return;
  const courses = asArray(await api("/api/courses"), "courses");
  box.innerHTML = courses.map(c => `<div class="card"><h3>${c.title || ""}</h3><p>${c.description || ""}</p><p><b>Level:</b> ${c.level_badge?.label || c.level || "Beginner"}</p><div class="admin-actions"><button onclick="editCourse(${getId(c)})">Edit</button><button class="danger" onclick="deleteItem('/api/courses/${getId(c)}')">Delete</button></div></div>`).join("") || "<p>No courses.</p>";
}

async function loadAdminJobsList() {
  const box = document.getElementById("adminJobsList");
  if (!box) return;
  const jobs = asArray(await api("/api/jobs"), "jobs");
  box.innerHTML = jobs.map(j => `<div class="card"><h3>${j.title || ""}</h3><p>${j.description || ""}</p><p><b>Skills:</b> ${j.required_skills || j.skills || ""}</p><p><b>Salary:</b> ${j.average_salary || j.salary || ""}</p><div class="admin-actions"><button onclick="editJob(${getId(j)})">Edit</button><button class="danger" onclick="deleteItem('/api/jobs/${getId(j)}')">Delete</button></div></div>`).join("") || "<p>No jobs.</p>";
}

async function loadAdminQuizzesList() {
  const box = document.getElementById("adminQuizzesList");
  if (!box) return;
  const quizzes = asArray(await api("/api/quizzes"), "quizzes");
  box.innerHTML = quizzes.map(q => `<div class="card"><h3>${q.title || ""}</h3><p>${q.description || ""}</p><p><b>Course ID:</b> ${q.course_id || ""}</p><div class="admin-actions"><button onclick="editQuiz(${getId(q)})">Edit</button><button class="danger" onclick="deleteItem('/api/quizzes/${getId(q)}')">Delete</button></div></div>`).join("") || "<p>No quizzes.</p>";
}

async function loadAdminCertificatesList() {
  const box = document.getElementById("adminCertificatesList");
  if (!box) return;
  try {
    const certs = asArray(await api("/api/certificates"), "certificates");
    box.innerHTML = certs.map(c => `<div class="card"><h3>${c.name || ""}</h3><p>${c.description || ""}</p><p><b>Price:</b> ${c.price || ""}</p><div class="admin-actions"><button onclick="editCertificate(${getId(c)})">Edit</button><button class="danger" onclick="deleteItem('/api/certificates/${getId(c)}')">Delete</button></div></div>`).join("") || "<p>No certificates.</p>";
  } catch { box.innerHTML = "<p>No certificates.</p>"; }
}

async function deleteItem(path) {
  if (!confirm("Delete this item?")) return;
  try {
    await api(path, { method: "DELETE" });
    showMessage("Deleted successfully", "success");
    loadAdminStats();
    loadAdminLists();
    loadSpecializations();
  } catch (err) { showMessage(err.message); }
}

async function putJson(path, data) {
  await api(path, { method: "PUT", body: JSON.stringify(data) });
  showMessage("Updated successfully", "success");
  loadAdminStats();
  loadAdminLists();
  loadSpecializations();
}

async function editSpecialization(id) { const name = prompt("New specialization name:"); if (name) await putJson(`/api/specializations/${id}`, { name }); }
async function editCourse(id) { const title = prompt("New course title:"); if (title) await putJson(`/api/courses/${id}`, { title }); }
async function editJob(id) { const title = prompt("New job title:"); if (title) await putJson(`/api/jobs/${id}`, { title }); }
async function editQuiz(id) { const title = prompt("New quiz title:"); if (title) await putJson(`/api/quizzes/${id}`, { title }); }
async function editCertificate(id) { const name = prompt("New certificate name:"); if (name) await putJson(`/api/certificates/${id}`, { name }); }


window.navbar = navbar;
window.logout = logout;
window.requireLogin = requireLogin;
window.requireAdmin = requireAdmin;
window.blockAdminFromStudentPages = blockAdminFromStudentPages;
window.trackCourseOpened = trackCourseOpened;
window.startQuiz = startQuiz;
window.makeAdmin = makeAdmin;
window.makeStudent = makeStudent;
window.banUser = banUser;
window.unbanUser = unbanUser;
window.copyGeneratedResume = copyGeneratedResume;
window.exportResumePdf = exportResumePdf;
window.exportResumeDocx = exportResumeDocx;
window.setupAtsChecker = setupAtsChecker;
window.blockAdminFromStudentPages = blockAdminFromStudentPages;

window.showAdminSection = showAdminSection;
window.loadAdminStats = loadAdminStats;
window.loadAdminLists = loadAdminLists;
window.loadCoursesIntoAdminSelects = loadCoursesIntoAdminSelects;
window.setupSelectSearch = setupSelectSearch;
window.deleteItem = deleteItem;
window.editSpecialization = editSpecialization;
window.editCourse = editCourse;
window.editJob = editJob;
window.editQuiz = editQuiz;
window.editCertificate = editCertificate;
