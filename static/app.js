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
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

function logout() {
  localStorage.removeItem("sqr_token");
  localStorage.removeItem("sqr_user");
  localStorage.removeItem("token");
  window.location.href = "signin.html";
}


function passwordIsStrong(password) {
  return /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && String(password || "").length >= 8;
}

function setupPasswordRules() {
  const signupForm = document.getElementById("signupForm");
  const password = document.getElementById("password");
  if (!signupForm || !password || password.dataset.rulesReady) return;
  password.dataset.rulesReady = "1";
  password.setAttribute("minlength", "8");
  password.setAttribute("pattern", "(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}");
  password.setAttribute("title", "Password must be at least 8 characters and include uppercase, lowercase, and number");
  const rules = document.createElement("div");
  rules.id = "passwordRules";
  rules.className = "password-rules";
  rules.innerHTML = `
    <b>Password requirements:</b>
    <ul>
      <li id="ruleLength">At least 8 characters</li>
      <li id="ruleUpper">At least one uppercase letter</li>
      <li id="ruleLower">At least one lowercase letter</li>
      <li id="ruleNumber">At least one number</li>
    </ul>
  `;
  password.insertAdjacentElement("afterend", rules);
  const update = () => {
    const value = password.value || "";
    const checks = {
      ruleLength: value.length >= 8,
      ruleUpper: /[A-Z]/.test(value),
      ruleLower: /[a-z]/.test(value),
      ruleNumber: /[0-9]/.test(value)
    };
    Object.entries(checks).forEach(([id, ok]) => {
      const item = document.getElementById(id);
      if (item) item.className = ok ? "rule-ok" : "rule-bad";
    });
  };
  password.addEventListener("input", update);
  update();
}

function markRequiredLabels() {
  document.querySelectorAll("label.required, label:has(+ textarea[required]), label:has(+ input[required]), label:has(+ select[required])").forEach(label => {
    if (!label.querySelector(".required-star")) {
      label.insertAdjacentHTML("beforeend", ` <span class="required-star">*</span>`);
    }
  });
}

function showMessage(text, type = "error") {
  const box = document.getElementById("message");
  if (!box) return;
  box.innerHTML = text;
  box.className = type === "success" ? "message success" : "message error";
}

function asArray(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  return [];
}

function getId(row) {
  return row?.id || row?.specialization_id || row?.course_id || row?.quiz_id || row?.job_id;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTextBlock(value) {
  const text = String(value || "").trim();
  return text ? escapeHTML(text).replace(/\n/g, "<br>") : "Not added yet.";
}

function currentIdFromUrl() {
  return new URLSearchParams(window.location.search).get("id");
}

function fileUrl(filename) {
  if (!filename) return "";
  if (String(filename).startsWith("http") || String(filename).startsWith("/uploads/")) {
    return String(filename).startsWith("http") ? filename : API + filename;
  }
  return `${API}/uploads/${filename}`;
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
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
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
      if (!String(err.message).includes("Route not found") && !String(err.message).includes("404")) {
        throw err;
      }
    }
  }
  throw lastError || new Error("Request failed");
}

function navbar() {
  const user = getUser();

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
        ${user && user.role === "admin" ? `<a href="admin.html">Admin</a>` : ""}
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
  if (!getToken()) {
    window.location.href = "signin.html";
  }
}

function requireAdmin() {
  const user = getUser();
  if (!user || user.role !== "admin") {
    alert("Admin access only");
    window.location.href = "gp.html";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupPasswordRules();
  markRequiredLabels();
  setupSignup();
  setupSignin();
  loadProfile();
  loadSpecializations();
  loadSpecializationDetails();
  loadCourses();
  loadCourseOptions();
  loadCourseDetails();
  loadQuizzes();
  loadJobs();
  loadAdmin();
  setupATS();
  setupRecommendation();
});

function setupSignup() {
  const form = document.getElementById("signupForm");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const data = {
      name: document.getElementById("name")?.value.trim(),
      email: document.getElementById("email")?.value.trim(),
      password: document.getElementById("password")?.value
    };

    if (!passwordIsStrong(data.password)) {
      showMessage("Password must be at least 8 characters and include uppercase, lowercase, and number");
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

    if (!passwordIsStrong(data.password)) {
      showMessage("Password must be at least 8 characters and include uppercase, lowercase, and number");
      return;
    }

    try {
      const result = await apiTry(["/api/login", "/api/signin"], {
        method: "POST",
        body: JSON.stringify(data)
      });

      setAuth(result.token, result.user);
      showMessage("Signed in successfully", "success");
      setTimeout(() => window.location.href = "profile.html", 700);
    } catch (err) {
      const msg = String(err.message || "");
      showMessage(msg.toLowerCase().includes("banned") ? "Your account is banned. Please contact the admin." : msg);
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
        <h2>${user.name || "Student"}</h2>
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
        <div class="progress">
          <div style="width:${p.progress || p.percentage || 0}%"></div>
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
  const select = document.getElementById("specSelect");
  const courseSelect = document.getElementById("courseSpecFilter");
  const quizSelect = document.getElementById("quizSpecFilter");
  const jobSelect = document.getElementById("jobSpecFilter");

  if (!box && !select && !courseSelect && !quizSelect && !jobSelect) return;

  try {
    const raw = await api("/api/specializations");
    const specs = asArray(raw, "specializations");

    if (box) {
      box.innerHTML = specs.map(s => {
        const id = getId(s);
        const image = s.image_url || s.image;
        return `
          <a class="card clickable-card mini-card" href="specialization-details.html?id=${id}">
            ${image ? `<img src="${fileUrl(image)}" class="card-img" alt="${escapeHTML(s.name || "Specialization")}">` : `<div class="card-img placeholder-img">SQR</div>`}
            <h3>${escapeHTML(s.name || "Specialization")}</h3>
          </a>
        `;
      }).join("") || `<div class="empty-state"><h3>No specializations yet</h3><p>Admin can add specializations from the admin page.</p></div>`;
    }

    const options = `<option value="">All Specializations</option>` + specs.map(s => `
      <option value="${getId(s)}">${escapeHTML(s.name || "Specialization")}</option>
    `).join("");

    [select, courseSelect, quizSelect, jobSelect].forEach(el => {
      if (el) el.innerHTML = options;
    });
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadSpecializationDetails() {
  const box = document.getElementById("specializationDetailsBox");
  if (!box) return;

  const id = currentIdFromUrl();
  if (!id) {
    box.innerHTML = `<div class="empty-state"><h3>Specialization not found</h3><p>No specialization id was provided.</p></div>`;
    return;
  }

  try {
    const spec = await api(`/api/specializations/${id}`);
    const image = spec.image_url || spec.image;
    const courses = spec.courses || [];
    const certificates = spec.certificates || [];

    box.innerHTML = `
      <div class="details-hero card">
        ${image ? `<img src="${fileUrl(image)}" class="details-img" alt="${escapeHTML(spec.name || "Specialization")}">` : ""}
        <div>
          <h1>${escapeHTML(spec.name || "Specialization")}</h1>
          <p>${formatTextBlock(spec.description)}</p>
          <button onclick="chooseSpecialization(${id})">Choose This Specialization</button>
        </div>
      </div>

      <div class="grid details-grid">
        <div class="card"><h2>Skills</h2><p>${formatTextBlock(spec.skills)}</p></div>
        <div class="card"><h2>Roadmap</h2><p>${formatTextBlock(spec.roadmap)}</p></div>
        <div class="card"><h2>Job Titles</h2><p>${formatTextBlock(spec.job_titles || spec.career_paths)}</p></div>
      </div>

      <h2>Courses</h2>
      <div class="grid">
        ${courses.map(c => {
          const courseImage = c.image_url || c.image;
          return `
            <a class="card clickable-card mini-card" href="course-details.html?id=${getId(c)}">
              ${courseImage ? `<img src="${fileUrl(courseImage)}" class="card-img" alt="${escapeHTML(c.title || "Course")}">` : `<div class="card-img placeholder-img">Course</div>`}
              <h3>${escapeHTML(c.title || "Course")}</h3>
            </a>
          `;
        }).join("") || `<p>No courses added for this specialization yet.</p>`}
      </div>

      ${certificates.length ? `<h2>Certificates</h2><div class="grid">${certificates.map(cert => `
        <div class="card">
          <h3>${escapeHTML(cert.name || "Certificate")}</h3>
          <p>${formatTextBlock(cert.description)}</p>
          ${cert.price ? `<p><b>Price:</b> ${escapeHTML(cert.price)}</p>` : ""}
          ${cert.type ? `<p><b>Type:</b> ${escapeHTML(cert.type)}</p>` : ""}
          ${cert.link ? `<a href="${escapeHTML(cert.link)}" target="_blank">Official Link</a>` : ""}
        </div>
      `).join("")}</div>` : ""}
    `;
  } catch (err) {
    box.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHTML(err.message)}</p></div>`;
  }
}

async function chooseSpecialization(id) {
  requireLogin();

  try {
    await apiTry([`/api/specializations/${id}/enroll`, "/api/user/specialization", "/api/student/specialization"], {
      method: "POST",
      body: JSON.stringify({ specialization_id: id, spec_id: id })
    });

    alert("Specialization selected");
    location.reload();
  } catch (err) {
    alert(err.message);
  }
}

async function loadCourses() {
  const box = document.getElementById("coursesBox");
  if (!box) return;

  try {
    const spec = document.getElementById("courseSpecFilter")?.value || currentIdFromUrl() || "";
    const level = document.getElementById("courseLevelFilter")?.value || "";
    const params = new URLSearchParams();

    if (spec) {
      params.append("spec_id", spec);
      params.append("specialization_id", spec);
    }
    if (level) params.append("level", level);

    const raw = await api(`/api/courses${params.toString() ? "?" + params.toString() : ""}`);
    const courses = asArray(raw, "courses");

    box.innerHTML = courses.map(c => {
      const id = getId(c);
      const image = c.image_url || c.image;
      return `
        <a class="card clickable-card mini-card" href="course-details.html?id=${id}">
          ${image ? `<img src="${fileUrl(image)}" class="card-img" alt="${escapeHTML(c.title || "Course")}">` : `<div class="card-img placeholder-img">Course</div>`}
          <h3>${escapeHTML(c.title || "Course")}</h3>
        </a>
      `;
    }).join("") || `<div class="empty-state"><h3>No courses yet</h3><p>Admin can add courses from the admin page.</p></div>`;
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadCourseOptions() {
  const selects = [document.getElementById("quizCourseFilter"), document.getElementById("courseSelect")].filter(Boolean);
  if (!selects.length) return;
  try {
    const raw = await api("/api/courses");
    const courses = asArray(raw, "courses");
    const options = `<option value="">Select Course</option>` + courses.map(c => `
      <option value="${getId(c)}">${escapeHTML(c.title || "Course")}</option>
    `).join("");
    selects.forEach(select => select.innerHTML = options);
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadCourseDetails() {
  const box = document.getElementById("courseDetailsBox");
  if (!box) return;

  const id = currentIdFromUrl();
  if (!id) {
    box.innerHTML = `<div class="empty-state"><h3>Course not found</h3><p>No course id was provided.</p></div>`;
    return;
  }

  try {
    const course = await api(`/api/courses/${id}`);
    const image = course.image_url || course.image;
    const video = course.video_url || course.video;
    const link = course.link || course.course_link;
    const quizzes = course.quizzes || [];

    box.innerHTML = `
      <div class="details-hero card">
        ${image ? `<img src="${fileUrl(image)}" class="details-img" alt="${escapeHTML(course.title || "Course")}">` : ""}
        <div>
          <h1>${escapeHTML(course.title || "Course")}</h1>
          <p><b>Level:</b> ${escapeHTML(course.level_badge?.label || course.level || "Beginner")}</p>
          <p>${formatTextBlock(course.description)}</p>
          <div class="card-actions">
            ${link ? `<a class="btn primary" href="${escapeHTML(link)}" target="_blank">Open Actual Course</a>` : ""}
            ${video ? `<a class="btn ghost" href="${fileUrl(video)}" target="_blank">Open Video</a>` : ""}
            <button onclick="completeCourse(${id})">Mark Course Completed</button>
          </div>
        </div>
      </div>

      <h2>Course Quizzes</h2>
      <div id="courseQuizzesBox" class="grid">
        ${quizzes.map(q => `
          <div class="card">
            <h3>${escapeHTML(q.title || "Quiz")}</h3>
            <p>${formatTextBlock(q.description)}</p>
            <button onclick="startCourseQuiz(${getId(q)})">Start Quiz</button>
          </div>
        `).join("") || `<p>No quizzes added for this course yet.</p>`}
      </div>
    `;
    window.loadedQuizzes = quizzes;
  } catch (err) {
    box.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHTML(err.message)}</p></div>`;
  }
}

function startCourseQuiz(id) {
  const box = document.getElementById("courseQuizzesBox") || document.getElementById("courseDetailsBox");
  if (box) box.id = "quizzesBox";
  startQuiz(id);
}

async function completeCourse(id) {
  requireLogin();

  try {
    await api(`/api/courses/${id}/complete`, { method: "POST" });
    alert("Course completed");
    loadCourses();
    loadProgress();
  } catch (err) {
    alert(err.message);
  }
}

async function loadQuizzes() {
  const box = document.getElementById("quizzesBox");
  if (!box) return;

  try {
    const spec = document.getElementById("quizSpecFilter")?.value || "";
    const course = document.getElementById("quizCourseFilter")?.value || "";
    const params = new URLSearchParams();

    if (spec) params.append("spec_id", spec);
    if (course) params.append("course_id", course);

    const raw = await api(`/api/quizzes${params.toString() ? "?" + params.toString() : ""}`);
    const quizzes = asArray(raw, "quizzes");

    window.loadedQuizzes = quizzes;

    box.innerHTML = quizzes.map(q => `
      <div class="card">
        <h3>${q.title || "Quiz"}</h3>
        <p>${q.description || ""}</p>
        <button onclick="startQuiz(${getId(q)})">Start Quiz</button>
      </div>
    `).join("");
  } catch (err) {
    showMessage(err.message);
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
                return `<label><input type="radio" name="q${getId(q)}" value="${value}"> ${value}</label>`;
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
    if (spec) params.append("specialization", spec);

    const raw = await api(`/api/jobs${params.toString() ? "?" + params.toString() : ""}`);
    const jobs = asArray(raw, "jobs");

    box.innerHTML = jobs.map(j => `
      <div class="card">
        <h3>${j.title || ""}</h3>
        <p>${j.description || ""}</p>
        <p><b>Specialization:</b> ${j.specialization || j.specialization_name || ""}</p>
        <p><b>Required Skills:</b> ${j.required_skills || j.skills || ""}</p>
        ${j.salary ? `<p><b>Salary:</b> ${j.salary}</p>` : ""}
        ${j.link ? `<a href="${j.link}" target="_blank">Apply / Details</a>` : ""}
        ${j.match_percentage !== undefined ? `<p><b>Match:</b> ${j.match_percentage}%</p>` : ""}
      </div>
    `).join("");
  } catch (err) {
    showMessage(err.message);
  }
}

function setupRecommendation() {
  const form = document.getElementById("recommendationForm") || document.getElementById("recForm");
  const box = document.getElementById("recommendationResult") || document.getElementById("resultBox");

  if (!form || !box) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());
    data.interests = data.interests || document.getElementById("interests")?.value || "";
    data.skills = data.skills || document.getElementById("skills")?.value || "";
    data.goal = data.goal || document.getElementById("goal")?.value || "";

    try {
      const result = await api("/api/recommendation", {
        method: "POST",
        body: JSON.stringify(data)
      });

      const best = result.best || result.recommended_specializations?.[0] || result;

      box.innerHTML = `
        <div class="card">
          <h2>Recommended Specialization</h2>
          <h3>${best.name || best.specialization || ""}</h3>
          <p>${best.reason || result.reason || ""}</p>
          <p><b>Match:</b> ${best.match_percentage || best.score || best.percentage || 0}%</p>
        </div>
      `;
    } catch (err) {
      showMessage(err.message);
    }
  });
}

function setupATS() {
  const checkForm = document.getElementById("atsCheckForm");
  const generateForm = document.getElementById("atsGenerateForm");

  if (checkForm && !checkForm.dataset.ready) {
    checkForm.dataset.ready = "1";
    checkForm.addEventListener("submit", async e => {
      e.preventDefault();
      requireLogin();

      const formData = new FormData(checkForm);

      try {
        const result = await api("/api/ats/check", {
          method: "POST",
          body: formData
        });

        const box = document.getElementById("atsResult");
        if (box) {
          box.innerHTML = `
            <div class="card">
              <h2>ATS Score: ${result.ats_score ?? result.score ?? 0}%</h2>
              <p>${result.summary || result.feedback || ""}</p>
              <h3>Missing Keywords</h3>
              <p>${(result.missing_keywords || []).join(", ")}</p>
              <h3>Matched Keywords</h3>
              <p>${(result.matched_keywords || result.found_keywords || []).join(", ")}</p>
              ${result.improvements ? `<h3>Improvements</h3><ul>${result.improvements.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}
            </div>
          `;
        }
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

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

        lastGeneratedResume = result.resume || "";
        const box = document.getElementById("generatedResume") || document.getElementById("resumeOutput");

        if (box) {
          box.innerHTML = `
            <div class="card resume-preview">
              <h2>Generated ATS Resume</h2>
              ${result.ats_score !== undefined ? `<p><b>ATS Score:</b> ${result.ats_score}%</p>` : ""}
              ${result.enhanced_summary ? `<h3>Enhanced Summary</h3><p>${result.enhanced_summary}</p>` : ""}
              ${result.matched_keywords ? `<h3>Matched Keywords</h3><p>${result.matched_keywords.join(", ")}</p>` : ""}
              <h3>Resume</h3>
              <pre class="resume-text">${lastGeneratedResume || "No resume returned from backend."}</pre>
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
}

async function copyGeneratedResume() {
  if (!lastGeneratedResume) return alert("Generate a resume first");
  await navigator.clipboard.writeText(lastGeneratedResume);
  alert("Resume copied");
}

async function downloadBlob(path, filename) {
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
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (courseForm && !courseForm.dataset.ready) {
    courseForm.dataset.ready = "1";
    courseForm.addEventListener("submit", async e => {
      e.preventDefault();
      try {
        await api("/api/courses", { method: "POST", body: new FormData(courseForm) });
        showMessage("Course added", "success");
        courseForm.reset();
        loadCourses();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (quizForm && !quizForm.dataset.ready) {
    quizForm.dataset.ready = "1";
    quizForm.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(quizForm).entries());
      if (!data.questions) {
        data.questions = [{
          question_text: data.question_text || data.question || "Question",
          option_a: data.option_a || data.option1 || "A",
          option_b: data.option_b || data.option2 || "B",
          option_c: data.option_c || data.option3 || "C",
          option_d: data.option_d || data.option4 || "D",
          correct_answer: data.correct_answer || data.answer || "A"
        }];
      }
      try {
        await api("/api/admin/quizzes", { method: "POST", body: JSON.stringify(data) });
        showMessage("Quiz added", "success");
        quizForm.reset();
        loadQuizzes();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (jobForm && !jobForm.dataset.ready) {
    jobForm.dataset.ready = "1";
    jobForm.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(jobForm).entries());
      try {
        await api("/api/jobs", { method: "POST", body: JSON.stringify(data) });
        showMessage("Job added", "success");
        jobForm.reset();
        loadJobs();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (certForm && !certForm.dataset.ready) {
    certForm.dataset.ready = "1";
    certForm.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(certForm).entries());
      data.spec_id = data.spec_id || data.specialization_id;
      try {
        await api("/api/certificates", { method: "POST", body: JSON.stringify(data) });
        showMessage("Certificate added", "success");
        certForm.reset();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }
}

async function loadAdminUsers() {
  const box = document.getElementById("usersBox");
  if (!box) return;

  try {
    const raw = await api("/api/admin/users");
    const users = asArray(raw, "users");

    box.innerHTML = users.map(u => {
      const banned = Number(u.banned || u.is_banned || 0) === 1;
      return `
      <div class="card">
        <h3>${escapeHTML(u.name)}</h3>
        <p>${escapeHTML(u.email)}</p>
        <p><b>Role:</b> ${escapeHTML(u.role)}</p>
        <p><b>Status:</b> <span class="${banned ? "status-banned" : "status-active"}">${banned ? "Banned" : "Active"}</span></p>
        ${u.role === "admin"
          ? `<button onclick="makeStudent(${u.id})">Make Student</button>`
          : `<button onclick="makeAdmin(${u.id})">Make Admin</button>`
        }
        ${banned
          ? `<button onclick="unbanUser(${u.id})">Unban</button>`
          : `<button onclick="banUser(${u.id})" class="danger">Ban</button>`
        }
      </div>
    `}).join("");
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
  if (!confirm("Unban this user?")) return;

  try {
    await api(`/api/admin/users/${id}/unban`, { method: "PUT" });
    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}

window.navbar = navbar;
window.logout = logout;
window.chooseSpecialization = chooseSpecialization;
window.completeCourse = completeCourse;
window.startQuiz = startQuiz;
window.loadCourseOptions = loadCourseOptions;
window.makeAdmin = makeAdmin;
window.makeStudent = makeStudent;
window.banUser = banUser;
window.unbanUser = unbanUser;
window.copyGeneratedResume = copyGeneratedResume;
window.exportResumePdf = exportResumePdf;
window.exportResumeDocx = exportResumeDocx;
window.loadSpecializationDetails = loadSpecializationDetails;
window.loadCourseDetails = loadCourseDetails;
window.startCourseQuiz = startCourseQuiz;
