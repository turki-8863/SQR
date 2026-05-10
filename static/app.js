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

function showMessage(text, type = "error") {
  const box = document.getElementById("message");
  if (!box) return;
  box.innerHTML = text;
  box.className = type === "success" ? "message success" : "message error";
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
  return row?.id || row?.specialization_id || row?.course_id || row?.quiz_id || row?.job_id;
}

function fileUrl(filename) {
  if (!filename) return "";
  if (String(filename).startsWith("http")) return filename;
  if (String(filename).startsWith("/uploads/")) return API + filename;
  return `${API}/uploads/${filename}`;
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
  if (!getToken()) window.location.href = "signin.html";
}

function requireAdmin() {
  const user = getUser();
  if (!user || user.role !== "admin") {
    alert("Admin access only");
    window.location.href = "gp.html";
  }
}

document.addEventListener("DOMContentLoaded", () => {
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
  const jobSelect = document.getElementById("jobSpecFilter");

  if (!box && !select && !courseSelect && !jobSelect) return;

  try {
    const raw = await api("/api/specializations");
    const specs = asArray(raw, "specializations");

    if (box) {
      box.innerHTML = specs.map(s => `
        <div class="card card-mini" onclick="window.location.href='specialization-details.html?id=${getId(s)}'">
          ${s.image || s.image_url ? `<img src="${fileUrl(s.image_url || s.image)}" class="card-img">` : ""}
          <h3>${s.name || ""}</h3>
        </div>
      `).join("") || `<p>No specializations yet.</p>`;
    }

    const options = `<option value="">All Specializations</option>` + specs.map(s => `
      <option value="${getId(s)}">${s.name}</option>
    `).join("");

    [select, courseSelect, jobSelect].forEach(el => {
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
        <p><b>Level:</b> ${course.level_badge?.label || course.level || "Beginner"}</p>
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
    `).join("") || `<p>No jobs yet.</p>`;
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

function setupAtsChecker() {
  const checkForm = document.getElementById("atsCheckForm");
  if (!checkForm || checkForm.dataset.ready) return;

  checkForm.dataset.ready = "1";

  checkForm.addEventListener("submit", async e => {
    e.preventDefault();
    requireLogin();

    const resultBox = document.getElementById("atsResult");
    const resumeFile = document.getElementById("resume_file")?.files?.[0];
    const resumeText = document.getElementById("resume_text")?.value?.trim() || "";
    const targetJob = document.getElementById("target_job")?.value?.trim()
      || document.getElementById("job_description")?.value?.trim()
      || "";

    if (!targetJob) {
      showMessage("Target job or job description is required");
      return;
    }

    if (!resumeFile && !resumeText) {
      showMessage("Please upload a PDF/DOCX/TXT resume or paste your resume text");
      return;
    }

    const formData = new FormData(checkForm);
    formData.set("target_job", targetJob);
    formData.set("job_description", targetJob);

    if (resumeText) {
      formData.set("resume_text", resumeText);
    }

    if (resumeFile) {
      formData.set("resume_file", resumeFile);
    }

    if (resultBox) {
      resultBox.classList.remove("hidden");
      resultBox.innerHTML = `
        <div class="card">
          <h2>Checking Resume...</h2>
          <p>Please wait while SQR analyzes your resume.</p>
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
              ${Array.isArray(result.improvements) && result.improvements.length ? result.improvements.map(x => `<li>${x}</li>`).join("") : "<li>Add more role-specific keywords, measurable achievements, and clear project details.</li>"}
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
      if (resultBox) {
        resultBox.innerHTML = "";
      }
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
        await api("/api/specializations", {
          method: "POST",
          body: new FormData(specForm)
        });
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
        await api("/api/courses", {
          method: "POST",
          body: new FormData(courseForm)
        });
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

      data.questions = [{
        question_text: data.question_text || data.question || "Question",
        option_a: data.option_a || data.option1 || "A",
        option_b: data.option_b || data.option2 || "B",
        option_c: data.option_c || data.option3 || "C",
        option_d: data.option_d || data.option4 || "D",
        correct_answer: data.correct_answer || data.answer || "A"
      }];

      try {
        await api("/api/admin/quizzes", {
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

      const data = Object.fromEntries(new FormData(jobForm).entries());

      try {
        await api("/api/jobs", {
          method: "POST",
          body: JSON.stringify(data)
        });

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
        await api("/api/certificates", {
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

window.navbar = navbar;
window.logout = logout;
window.requireLogin = requireLogin;
window.requireAdmin = requireAdmin;
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
