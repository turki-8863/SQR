const API =
  window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
    ? "http://127.0.0.1:5000"
    : window.location.origin;

function route(path) {
  return path;
}

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

function updateStoredUser(updates) {
  const user = getUser() || {};
  const updated = { ...user, ...updates };
  localStorage.setItem("sqr_user", JSON.stringify(updated));
  return updated;
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

function logout() {
  localStorage.removeItem("sqr_token");
  localStorage.removeItem("sqr_user");
  localStorage.removeItem("token");
  window.location.href = route("/signin");
}

function requireLogin() {
  if (!getToken()) {
    window.location.href = route("/signin");
  }
}

function requireAdmin() {
  const user = getUser();

  if (!getToken()) {
    window.location.href = route("/signin");
    return;
  }

  if (!user || user.role !== "admin" || user.current_mode === "student") {
    alert("Admin mode only");
    window.location.href = route("/");
  }
}

function isAdminMode() {
  const user = getUser();
  return !!(user && user.role === "admin" && user.current_mode !== "student");
}

async function switchMode(mode) {
  const data = await apiPost(mode === "admin" ? "/api/mode/admin" : "/api/mode/student", {});
  if (!data.error) {
    updateStoredUser({ current_mode: mode });
    window.location.href = mode === "admin" ? route("/admin") : route("/");
  } else {
    alert(data.error);
  }
}

function navbar() {
  const token = getToken();
  const user = getUser();
  const adminMode = user && user.role === "admin" && user.current_mode !== "student";
  const studentMode = !user || user.role === "student" || user.current_mode === "student";

  document.write(`
    <header class="navbar">
      <a href="${route("/")}" class="logo">
        SQR
        <small>Learn. Grow. Succeed.</small>
      </a>

      <nav class="nav-links">
        <a href="${route("/")}">Home</a>
        ${studentMode ? `<a href="${route("/specializations")}">Specializations</a>` : ""}
        ${studentMode ? `<a href="${route("/courses")}">Courses</a>` : ""}
        ${studentMode ? `<a href="${route("/quizzes")}">Quizzes</a>` : ""}
        ${studentMode ? `<a href="${route("/recommendation")}">Recommendation</a>` : ""}
        ${studentMode ? `<a href="${route("/ats")}">ATS Generator</a>` : ""}
        ${studentMode ? `<a href="${route("/jobs")}">Jobs</a>` : ""}
        ${token && studentMode ? `<a href="${route("/profile")}">Profile</a>` : ""}
        ${adminMode ? `<a href="${route("/admin")}">Admin</a>` : ""}
      </nav>

      <div class="nav-actions">
        ${
          token
            ? `
              <span class="nav-user">${user ? escapeHTML(user.name) : "User"}</span>
              ${user && user.role === "admin" ? `
                <button class="btn-light" onclick="switchMode('${adminMode ? "student" : "admin"}')">
                  ${adminMode ? "Student Mode" : "Admin Mode"}
                </button>
              ` : ""}
              <button class="btn primary" onclick="logout()">Logout</button>
            `
            : `
              <a class="btn-light" href="${route("/signin")}">Sign In</a>
              <a class="btn-main" href="${route("/signup")}">Sign Up</a>
            `
        }
      </div>
    </header>
  `);
}

async function handleResponse(res) {
  let data;

  try {
    data = await res.json();
  } catch {
    data = { error: "Invalid server response" };
  }

  if (res.status === 401) {
    localStorage.removeItem("sqr_token");
    localStorage.removeItem("sqr_user");
    localStorage.removeItem("token");
  }

  return data;
}

async function apiGet(path) {
  const res = await fetch(API + path, {
    method: "GET",
    headers: authHeaders()
  });

  return handleResponse(res);
}

async function apiPost(path, data) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(data || {})
  });

  return handleResponse(res);
}

async function apiPut(path, data) {
  const res = await fetch(API + path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(data || {})
  });

  return handleResponse(res);
}

async function apiDelete(path) {
  const res = await fetch(API + path, {
    method: "DELETE",
    headers: authHeaders()
  });

  return handleResponse(res);
}

async function apiForm(path, formData, method = "POST") {
  const res = await fetch(API + path, {
    method,
    headers: authHeaders(),
    body: formData
  });

  return handleResponse(res);
}

function showMessage(id, message, type = "success") {
  const box = document.getElementById(id);
  if (!box) return;

  box.innerHTML = `<div class="alert ${type}">${escapeHTML(message)}</div>`;

  setTimeout(() => {
    box.innerHTML = "";
  }, 4000);
}

function escapeHTML(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function imageUrl(path) {
  if (!path) return "";

  if (path.startsWith("http")) return path;
  if (path.startsWith("/uploads/")) return API + path;

  return API + "/uploads/" + path;
}

function levelClass(level) {
  const value = String(level || "beginner").toLowerCase();

  if (value === "beginner" || value === "begginer") return "level-beginner";
  if (value === "intermediate" || value === "intermidiete") return "level-intermediate";
  if (value === "advanced" || value === "advance") return "level-advanced";

  return "level-beginner";
}

function levelLabel(level) {
  const value = String(level || "beginner").toLowerCase();

  if (value === "beginner" || value === "begginer") return "Beginner";
  if (value === "intermediate" || value === "intermidiete") return "Intermediate";
  if (value === "advanced" || value === "advance") return "Advanced";

  return "Beginner";
}

function matchColor(percent) {
  const p = Number(percent || 0);

  if (p >= 80) return "match-high";
  if (p >= 50) return "match-medium";

  return "match-low";
}

function scoreLabel(percent) {
  const p = Number(percent || 0);

  if (p >= 85) return "Excellent match";
  if (p >= 70) return "Strong match";
  if (p >= 50) return "Good match";
  if (p > 0) return "Partial match";

  return "Add profile skills";
}

function progressBar(percent) {
  const p = Math.max(0, Math.min(100, Number(percent || 0)));

  return `
    <div class="progress-box">
      <div class="progress-bar" style="width:${p}%"></div>
    </div>
  `;
}

function loadingHTML(text = "Loading...") {
  return `
    <div class="loading-box">
      <div class="spinner"></div>
      <p>${escapeHTML(text)}</p>
    </div>
  `;
}

function emptyState(title, text) {
  return `
    <div class="empty-state">
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(text)}</p>
    </div>
  `;
}

function formatList(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  return String(value)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function keywordTags(value) {
  const items = formatList(value);

  if (!items.length) return "";

  return `
    <div class="keyword-list">
      ${items.map(item => `<span class="keyword">${escapeHTML(item)}</span>`).join("")}
    </div>
  `;
}

function safePercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

async function enrollSpecialization(specId) {
  requireLogin();
  const data = await apiPost(`/api/enroll/specialization/${specId}`, {});
  if (data.error) {
    alert(data.error);
    return data;
  }
  alert(data.message || "Enrolled successfully");
  return data;
}

async function enrollCourse(courseId) {
  requireLogin();
  const data = await apiPost(`/api/enroll/course/${courseId}`, {});
  if (data.error) {
    alert(data.error);
    return data;
  }
  alert(data.message || "Course enrolled successfully");
  return data;
}
