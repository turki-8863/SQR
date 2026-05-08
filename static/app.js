const API = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "http://127.0.0.1:5000"
  : "https://YOUR-RENDER-BACKEND.onrender.com";

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
    throw new Error(data.error || data.message || "Request failed");
  }

  return data;
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
        <a href="Quiz.html">Quizzes</a>
        <a href="ATS.html">ATS</a>
        <a href="jobs.html">Jobs</a>
        <a href="recommendation.html">Recommendation</a>
        ${user ? `<a href="profile.html">Profile</a>` : ""}
        ${user && user.role === "admin" ? `<a href="admin.html">Admin</a>` : ""}
      </nav>

      <div class="auth-buttons">
        ${
          user
            ? `<button onclick="logout()" class="btn danger">Logout</button>`
            : `
              <a href="signin.html" class="btn ghost">Sign In</a>
              <a href="signup.html" class="btn primary">Sign Up</a>
            `
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
  setupSignup();
  setupSignin();
  loadProfile();
  loadSpecializations();
  loadCourses();
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

    try {
      const result = await api("/api/signup", {
        method: "POST",
        body: JSON.stringify(data)
      });

      setAuth(result.token, result.user);
      showMessage("Account created successfully", "success");

      setTimeout(() => {
        window.location.href = "profile.html";
      }, 700);
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
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(data)
      });

      setAuth(result.token, result.user);
      showMessage("Signed in successfully", "success");

      setTimeout(() => {
        window.location.href = "profile.html";
      }, 700);
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

    box.innerHTML = `
      <div class="card">
        <h2>${data.user.name}</h2>
        <p><b>Email:</b> ${data.user.email}</p>
        <p><b>Role:</b> ${data.user.role}</p>
      </div>
    `;

    const form = document.getElementById("profileForm");
    if (form) {
      document.getElementById("name").value = data.user.name || "";
      document.getElementById("skills").value = data.user.skills || "";
      document.getElementById("interests").value = data.user.interests || "";

      form.addEventListener("submit", async e => {
        e.preventDefault();

        try {
          await api("/api/profile", {
            method: "PUT",
            body: JSON.stringify({
              name: document.getElementById("name").value,
              skills: document.getElementById("skills").value,
              interests: document.getElementById("interests").value
            })
          });

          showMessage("Profile updated", "success");
        } catch (err) {
          showMessage(err.message);
        }
      });
    }

    loadProgress();
  } catch (err) {
    showMessage(err.message);
  }
}

async function loadProgress() {
  const box = document.getElementById("progressBox");
  if (!box) return;

  try {
    const data = await api("/api/progress");

    box.innerHTML = data.progress.map(p => `
      <div class="card">
        <h3>${p.specialization}</h3>
        <div class="progress">
          <div style="width:${p.percentage}%"></div>
        </div>
        <p>${p.percentage}% completed</p>
      </div>
    `).join("");
  } catch {
    box.innerHTML = "";
  }
}

async function loadSpecializations() {
  const box = document.getElementById("specializationsBox");
  const select = document.getElementById("specSelect");

  if (!box && !select) return;

  try {
    const data = await api("/api/specializations");

    if (box) {
      box.innerHTML = data.specializations.map(s => `
        <div class="card">
          ${s.image ? `<img src="${API}/uploads/${s.image}" class="card-img">` : ""}
          <h3>${s.name}</h3>
          <p>${s.description || ""}</p>
          ${s.skills ? `<p><b>Skills:</b> ${s.skills}</p>` : ""}
          <button onclick="chooseSpecialization(${s.id})">Choose Specialization</button>
        </div>
      `).join("");
    }

    if (select) {
      select.innerHTML = data.specializations.map(s => `
        <option value="${s.id}">${s.name}</option>
      `).join("");
    }
  } catch (err) {
    showMessage(err.message);
  }
}

async function chooseSpecialization(id) {
  requireLogin();

  try {
    await api("/api/user/specialization", {
      method: "POST",
      body: JSON.stringify({ specialization_id: id })
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
    const spec = document.getElementById("courseSpecFilter")?.value || "";
    const level = document.getElementById("courseLevelFilter")?.value || "";

    let path = "/api/courses";
    const params = new URLSearchParams();

    if (spec) params.append("specialization_id", spec);
    if (level) params.append("level", level);

    if (params.toString()) path += "?" + params.toString();

    const data = await api(path);

    box.innerHTML = data.courses.map(c => `
      <div class="card">
        ${c.image ? `<img src="${API}/uploads/${c.image}" class="card-img">` : ""}
        <h3>${c.title}</h3>
        <p>${c.description || ""}</p>
        <p><b>Level:</b> ${c.level || "Beginner"}</p>
        ${c.link ? `<a href="${c.link}" target="_blank">Open Course</a>` : ""}
        <button onclick="completeCourse(${c.id})">Mark Completed</button>
      </div>
    `).join("");
  } catch (err) {
    showMessage(err.message);
  }
}

async function completeCourse(id) {
  requireLogin();

  try {
    await api("/api/courses/complete", {
      method: "POST",
      body: JSON.stringify({ course_id: id })
    });

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

    let path = "/api/quizzes";
    const params = new URLSearchParams();

    if (spec) params.append("specialization_id", spec);
    if (course) params.append("course_id", course);

    if (params.toString()) path += "?" + params.toString();

    const data = await api(path);

    box.innerHTML = data.quizzes.map(q => `
      <div class="card">
        <h3>${q.title}</h3>
        <p>${q.description || ""}</p>
        <button onclick="startQuiz(${q.id})">Start Quiz</button>
      </div>
    `).join("");
  } catch (err) {
    showMessage(err.message);
  }
}

async function startQuiz(id) {
  const box = document.getElementById("quizBox");
  if (!box) return;

  try {
    const data = await api(`/api/quizzes/${id}`);

    box.innerHTML = `
      <div class="card">
        <h2>${data.quiz.title}</h2>
        <form id="takeQuizForm">
          ${data.questions.map((q, i) => `
            <div class="quiz-question">
              <h4>${i + 1}. ${q.question}</h4>
              ${["a", "b", "c", "d"].map(opt => `
                <label>
                  <input type="radio" name="q${q.id}" value="${opt}">
                  ${q["option_" + opt] || ""}
                </label>
              `).join("")}
            </div>
          `).join("")}
          <button type="submit">Submit Quiz</button>
        </form>
      </div>
    `;

    document.getElementById("takeQuizForm").addEventListener("submit", async e => {
      e.preventDefault();

      const answers = data.questions.map(q => {
        const selected = document.querySelector(`input[name="q${q.id}"]:checked`);
        return {
          question_id: q.id,
          answer: selected ? selected.value : ""
        };
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
    let path = "/api/jobs";

    if (spec) path += "?specialization_id=" + encodeURIComponent(spec);

    const data = await api(path);

    box.innerHTML = data.jobs.map(j => `
      <div class="card">
        <h3>${j.title}</h3>
        <p>${j.description || ""}</p>
        <p><b>Specialization:</b> ${j.specialization || ""}</p>
        <p><b>Required Skills:</b> ${j.required_skills || ""}</p>
        ${j.match_percentage !== undefined ? `<p><b>Match:</b> ${j.match_percentage}%</p>` : ""}
      </div>
    `).join("");
  } catch (err) {
    showMessage(err.message);
  }
}

function setupRecommendation() {
  const form = document.getElementById("recommendationForm");
  const box = document.getElementById("recommendationResult");

  if (!form || !box) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const data = {
      interests: document.getElementById("interests")?.value || "",
      skills: document.getElementById("skills")?.value || "",
      answers: document.getElementById("answers")?.value || ""
    };

    try {
      const result = await api("/api/recommendation", {
        method: "POST",
        body: JSON.stringify(data)
      });

      box.innerHTML = `
        <div class="card">
          <h2>Recommended Specialization</h2>
          <h3>${result.specialization}</h3>
          <p>${result.reason || ""}</p>
          <p><b>Match:</b> ${result.percentage || 0}%</p>
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

  if (checkForm) {
    checkForm.addEventListener("submit", async e => {
      e.preventDefault();

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
              <h2>ATS Score: ${result.score}%</h2>
              <p>${result.feedback || ""}</p>
              <h3>Missing Keywords</h3>
              <p>${(result.missing_keywords || []).join(", ")}</p>
              <h3>Matched Keywords</h3>
              <p>${(result.matched_keywords || []).join(", ")}</p>
            </div>
          `;
        }
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (generateForm) {
    generateForm.addEventListener("submit", async e => {
      e.preventDefault();

      const data = Object.fromEntries(new FormData(generateForm).entries());

      try {
        const result = await api("/api/ats/generate", {
          method: "POST",
          body: JSON.stringify(data)
        });

        const box = document.getElementById("generatedResume");
        if (box) {
          box.innerHTML = `
            <div class="card resume-preview">
              <h2>${result.name || data.name || ""}</h2>
              <p>${result.email || data.email || ""}</p>
              <hr>
              <h3>Summary</h3>
              <p>${result.summary || ""}</p>
              <h3>Skills</h3>
              <p>${result.skills || ""}</p>
              <h3>Projects</h3>
              <p>${result.projects || ""}</p>
              <h3>Education</h3>
              <p>${result.education || ""}</p>
            </div>
          `;
        }
      } catch (err) {
        showMessage(err.message);
      }
    });
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

  if (specForm) {
    specForm.addEventListener("submit", async e => {
      e.preventDefault();

      const formData = new FormData(specForm);

      try {
        await api("/api/admin/specializations", {
          method: "POST",
          body: formData
        });

        showMessage("Specialization added", "success");
        specForm.reset();
        loadSpecializations();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (courseForm) {
    courseForm.addEventListener("submit", async e => {
      e.preventDefault();

      const formData = new FormData(courseForm);

      try {
        await api("/api/admin/courses", {
          method: "POST",
          body: formData
        });

        showMessage("Course added", "success");
        courseForm.reset();
        loadCourses();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (quizForm) {
    quizForm.addEventListener("submit", async e => {
      e.preventDefault();

      const data = Object.fromEntries(new FormData(quizForm).entries());

      try {
        await api("/api/admin/quizzes", {
          method: "POST",
          body: JSON.stringify(data)
        });

        showMessage("Quiz added", "success");
        quizForm.reset();
        loadQuizzes();
      } catch (err) {
        showMessage(err.message);
      }
    });
  }

  if (jobForm) {
    jobForm.addEventListener("submit", async e => {
      e.preventDefault();

      const data = Object.fromEntries(new FormData(jobForm).entries());

      try {
        await api("/api/admin/jobs", {
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

  if (certForm) {
    certForm.addEventListener("submit", async e => {
      e.preventDefault();

      const data = Object.fromEntries(new FormData(certForm).entries());

      try {
        await api("/api/admin/certificates", {
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
    const data = await api("/api/admin/users");

    box.innerHTML = data.users.map(u => `
      <div class="card">
        <h3>${u.name}</h3>
        <p>${u.email}</p>
        <p><b>Role:</b> ${u.role}</p>
        ${
          u.role === "admin"
            ? `<button onclick="makeStudent(${u.id})">Make Student</button>`
            : `<button onclick="makeAdmin(${u.id})">Make Admin</button>`
        }
        <button onclick="banUser(${u.id})" class="danger">Ban</button>
      </div>
    `).join("");
  } catch (err) {
    showMessage(err.message);
  }
}

async function makeAdmin(id) {
  try {
    await api(`/api/admin/users/${id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role: "admin" })
    });

    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function makeStudent(id) {
  try {
    await api(`/api/admin/users/${id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role: "student" })
    });

    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function banUser(id) {
  if (!confirm("Ban this user?")) return;

  try {
    await api(`/api/admin/users/${id}/ban`, {
      method: "PUT"
    });

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
window.makeAdmin = makeAdmin;
window.makeStudent = makeStudent;
window.banUser = banUser;
