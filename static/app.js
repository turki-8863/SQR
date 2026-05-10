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

  lastGeneratedResume = "";
  window.location.href = "signin.html";
}

function showMessage(text, type = "error") {
  const box = document.getElementById("message");
  if (!box) return;
  box.innerHTML = text;
  box.className = type === "success" ? "alert success" : "alert error";
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
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const data = {
      name: document.getElementById("name")?.value.trim(),
      email: document.getElementById("email")?.value.trim(),
      password: document.getElementById("password")?.value
    };

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

  const select = document.getElementById("specSelect");
  const courseSelect = document.getElementById("courseSpecFilter");
  const jobSelect = document.getElementById("jobSpecFilter");

  const courseAdminSelect =
    document.getElementById("courseSpecialization") ||
    document.getElementById("courseSpec") ||
    document.getElementById("courseSpecSelect");

  const jobAdminSelect =
    document.getElementById("jobSpecialization") ||
    document.getElementById("jobSpec") ||
    document.getElementById("jobSpecSelect");

  if (!box && !select && !courseSelect && !jobSelect && !courseAdminSelect && !jobAdminSelect) return;

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

    [select, courseSelect, jobSelect, courseAdminSelect, jobAdminSelect].forEach(el => {
      if (el) el.innerHTML = options;
    });
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
        <h3>${c.title || ""}</h3>
        <p>${c.description || ""}</p>
        <span class="badge">${c.level || c.difficulty || "Beginner"}</span>
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
    const coursesRaw = await api("/api/courses");
    const courses = asArray(coursesRaw, "courses");
    const course = courses.find(c => Number(getId(c)) === Number(id));

    if (!course) {
      box.innerHTML = `<div class="card">Course not found.</div>`;
      return;
    }

    const quizRaw = await api(`/api/quizzes?course_id=${id}`);
    const quizzes = asArray(quizRaw, "quizzes");
    window.loadedQuizzes = quizzes;

    box.innerHTML = `
      <div class="detail-hero card">
        ${course.image || course.image_url ? `<img src="${fileUrl(course.image_url || course.image)}" class="card-img">` : ""}
        <h1>${course.title || ""}</h1>
        <p>${course.description || ""}</p>
        <p><b>Level:</b> ${course.level_badge?.label || course.level || course.difficulty || "Beginner"}</p>
        ${course.link || course.course_link ? `<a href="${course.link || course.course_link}" target="_blank" class="btn primary">Open Course</a>` : ""}
        <button onclick="completeCourse(${getId(course)})">Mark Completed</button>
      </div>

      <div class="quiz-inside-course">
        <h2>Course Quizzes</h2>
        <div id="quizzesBox">
          ${quizzes.map(q => `
            <div class="card">
              <h3>${q.title || "Quiz"}</h3>
              <p>${q.description || ""}</p>
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

async function completeCourse(id) {
  requireLogin();

  try {
    await api(`/api/courses/${id}/complete`, { method: "POST" });
    alert("Course completed");
    loadProgress();
  } catch (err) {
    alert(err.message);
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

    try {
      const result = await apiTry(["/api/recommendation", "/api/recommendations"], {
        method: "POST",
        body: JSON.stringify(data)
      });

      const best = result.best || result.recommended_specializations?.[0] || result.recommendation || result;

      box.classList.remove("hidden");

      box.innerHTML = `
        <div class="card">
          <h2>Recommended Specialization</h2>
          <h3>${best.name || best.specialization || result.specialization || "Recommended Path"}</h3>
          <p>${best.reason || result.reason || result.summary || "This recommendation is based on your answers."}</p>
          <p><b>Match:</b> ${best.match_percentage || best.score || best.percentage || result.match_score || 0}%</p>

          ${result.skills_to_improve ? `
            <h3>Skills to Improve</h3>
            <ul>${result.skills_to_improve.map(x => `<li>${x}</li>`).join("")}</ul>
          ` : ""}

          ${result.next_step ? `
            <h3>Next Step</h3>
            <p>${result.next_step}</p>
          ` : ""}
        </div>
      `;

      showMessage("Recommendation generated successfully", "success");
    } catch (err) {
      showMessage(err.message);
    }
  });
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

    const resultBox = document.getElementById("atsResult");
    const resumeFile = document.getElementById("resume_file")?.files?.[0];

    const targetJob =
      document.getElementById("target_job")?.value?.trim()
      || document.getElementById("job_description")?.value?.trim()
      || "";

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

      if (resultBox) {
        const sectionScores = result.section_scores || {};

        resultBox.classList.remove("hidden");
        resultBox.innerHTML = `
          <div class="card">
            <h2>ATS Score: ${result.ats_score ?? result.score ?? 0}%</h2>

            <h3>Summary</h3>
            <p>${result.summary || result.feedback || "ATS analysis completed."}</p>

            <h3>Matched Keywords</h3>
            <p>${Array.isArray(result.matched_keywords) && result.matched_keywords.length ? result.matched_keywords.join(", ") : "No matched keywords found."}</p>

            <h3>Missing Keywords</h3>
            <p>${Array.isArray(result.missing_keywords) && result.missing_keywords.length ? result.missing_keywords.join(", ") : "No missing keywords found."}</p>

            <h3>Strengths</h3>
            <ul>
              ${Array.isArray(result.strengths) && result.strengths.length ? result.strengths.map(x => `<li>${x}</li>`).join("") : "<li>No strengths listed.</li>"}
            </ul>

            <h3>Weaknesses</h3>
            <ul>
              ${Array.isArray(result.weaknesses) && result.weaknesses.length ? result.weaknesses.map(x => `<li>${x}</li>`).join("") : "<li>No weaknesses listed.</li>"}
            </ul>

            <h3>Advice to Improve Resume</h3>
            <ul>
              ${Array.isArray(result.improvements) && result.improvements.length ? result.improvements.map(x => `<li>${x}</li>`).join("") : "<li>Add role-specific keywords, measurable achievements, and clear project details.</li>"}
            </ul>

            ${Object.keys(sectionScores).length ? `
              <h3>Section Scores</h3>
              <div class="grid">
                ${Object.entries(sectionScores).map(([key, value]) => `
                  <div class="mini-card">
                    <strong>${key.replaceAll("_", " ").toUpperCase()}</strong>
                    <p>${value}%</p>
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

function setupATS() {
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

        lastGeneratedResume = result.resume || "";

        const currentUser = getUser();

        if (currentUser?.id) {
          localStorage.setItem("lastGeneratedResume_user_" + currentUser.id, lastGeneratedResume);
        }

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
  const user = getUser();

  const saved = user?.id
    ? localStorage.getItem("lastGeneratedResume_user_" + user.id)
    : "";

  lastGeneratedResume = lastGeneratedResume || saved || "";

  if (!lastGeneratedResume) return alert("Generate a resume first");

  await navigator.clipboard.writeText(lastGeneratedResume);
  alert("Resume copied");
}

async function downloadBlob(path, filename) {
  const user = getUser();

  const saved = user?.id
    ? localStorage.getItem("lastGeneratedResume_user_" + user.id)
    : "";

  lastGeneratedResume = lastGeneratedResume || saved || "";

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
}

async function loadAdminStats() {
  const box = document.getElementById("adminStatsBox");
  if (!box) return;

  try {
    const data = await apiTry(["/api/admin/stats", "/api/stats"]);

    box.innerHTML = `
      <div class="grid">
        <div class="card"><h3>Users</h3><p>${data.users || data.total_users || 0}</p></div>
        <div class="card"><h3>Specializations</h3><p>${data.specializations || data.total_specializations || 0}</p></div>
        <div class="card"><h3>Courses</h3><p>${data.courses || data.total_courses || 0}</p></div>
        <div class="card"><h3>Jobs</h3><p>${data.jobs || data.total_jobs || 0}</p></div>
      </div>
    `;
  } catch {
    box.innerHTML = "";
  }
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
        await api("/api/specializations", {
          method: "POST",
          body: new FormData(specForm)
        });

        showMessage("Specialization added", "success");
        specForm.reset();
        loadSpecializations();
        loadAdminStats();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (courseForm && !courseForm.dataset.ready) {
    courseForm.dataset.ready = "1";

    courseForm.addEventListener("submit", async e => {
      e.preventDefault();

      const data = normalizeFormData(courseForm);

      const specValue =
        data.specialization_id ||
        data.spec_id ||
        data.specialization ||
        document.getElementById("courseSpecialization")?.value ||
        document.getElementById("courseSpec")?.value ||
        document.getElementById("courseSpecSelect")?.value ||
        document.getElementById("specSelect")?.value ||
        "";

      if (!specValue) {
        showMessage("Please choose a specialization for this course");
        return;
      }

      data.specialization_id = specValue;
      data.spec_id = specValue;

      data.title =
        data.title ||
        data.course_title ||
        document.getElementById("courseTitle")?.value ||
        "";

      data.description =
        data.description ||
        document.getElementById("courseDescription")?.value ||
        "";

      data.level =
        data.level ||
        data.difficulty ||
        document.getElementById("courseDifficulty")?.value ||
        "Beginner";

      data.difficulty = data.level;

      data.image_url =
        data.image_url ||
        data.image ||
        document.getElementById("courseImage")?.value ||
        "";

      data.link =
        data.link ||
        data.course_link ||
        document.getElementById("courseLink")?.value ||
        "";

      if (!data.title.trim()) {
        showMessage("Course title is required");
        return;
      }

      try {
        await apiTry(["/api/courses", "/api/admin/courses"], {
          method: "POST",
          body: JSON.stringify(data)
        });

        showMessage("Course added", "success");
        courseForm.reset();
        loadCourses();
        loadAdminStats();
      } catch (err) {
        showMessage(err.message);
      }
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
        await apiTry(["/api/admin/quizzes", "/api/quizzes"], {
          method: "POST",
          body: JSON.stringify(data)
        });

        showMessage("Quiz added", "success");
        quizForm.reset();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (jobForm && !jobForm.dataset.ready) {
    jobForm.dataset.ready = "1";

    jobForm.addEventListener("submit", async e => {
      e.preventDefault();

      const data = normalizeFormData(jobForm);

      const specValue =
        data.specialization_id ||
        data.spec_id ||
        data.specialization ||
        document.getElementById("jobSpecialization")?.value ||
        document.getElementById("jobSpec")?.value ||
        document.getElementById("jobSpecSelect")?.value ||
        "";

      if (!specValue) {
        showMessage("Please choose a specialization for this job");
        return;
      }

      data.specialization_id = specValue;
      data.spec_id = specValue;
      data.specialization = specValue;

      data.title =
        data.title ||
        data.job_title ||
        document.getElementById("jobTitle")?.value ||
        "";

      data.description =
        data.description ||
        document.getElementById("jobDescription")?.value ||
        "";

      data.required_skills =
        data.required_skills ||
        data.skills ||
        document.getElementById("jobSkills")?.value ||
        "";

      data.skills = data.required_skills;

      data.salary =
        data.salary ||
        document.getElementById("jobSalary")?.value ||
        "";

      data.link =
        data.link ||
        document.getElementById("jobLink")?.value ||
        "";

      if (!data.title.trim()) {
        showMessage("Job title is required");
        return;
      }

      try {
        await apiTry(["/api/jobs", "/api/admin/jobs"], {
          method: "POST",
          body: JSON.stringify(data)
        });

        showMessage("Job added", "success");
        jobForm.reset();
        loadJobs();
        loadAdminStats();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (certForm && !certForm.dataset.ready) {
    certForm.dataset.ready = "1";

    certForm.addEventListener("submit", async e => {
      e.preventDefault();

      const data = normalizeFormData(certForm);
      data.spec_id = data.spec_id || data.specialization_id;

      try {
        await apiTry(["/api/certificates", "/api/admin/certificates"], {
          method: "POST",
          body: JSON.stringify(data)
        });

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
    loadAdminStats();
  } catch (err) {
    alert(err.message);
  }
}

async function makeStudent(id) {
  try {
    await api(`/api/admin/users/${id}/make-student`, { method: "PUT" });
    loadAdminUsers();
    loadAdminStats();
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

window.navbar = navbar;
window.logout = logout;
window.requireLogin = requireLogin;
window.requireAdmin = requireAdmin;
window.blockAdminFromStudentPages = blockAdminFromStudentPages;
window.completeCourse = completeCourse;
window.startQuiz = startQuiz;
window.makeAdmin = makeAdmin;
window.makeStudent = makeStudent;
window.banUser = banUser;
window.unbanUser = unbanUser;
window.copyGeneratedResume = copyGeneratedResume;
window.exportResumePdf = exportResumePdf;
window.exportResumeDocx = exportResumeDocx;
window.setupAtsChecker = setupAtsChecker;
