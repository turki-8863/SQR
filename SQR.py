import os
import re
import json
import datetime
from io import BytesIO
from functools import wraps

import jwt
import mysql.connector
from mysql.connector import pooling
from flask import Flask, request, jsonify, send_from_directory, send_file, render_template
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    from PyPDF2 import PdfReader
except Exception:
    PdfReader = None

try:
    from docx import Document
except Exception:
    Document = None

try:
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib import colors
except Exception:
    SimpleDocTemplate = None
    Paragraph = None
    Spacer = None
    HRFlowable = None
    A4 = None
    getSampleStyleSheet = None
    ParagraphStyle = None
    TA_CENTER = None
    colors = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(BASE_DIR, os.getenv("UPLOAD_FOLDER", "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)
CORS(app, resources={r"/api/*": {"origins": os.getenv("CORS_ORIGINS", "*").split(",")}})

app.config["SECRET_KEY"] = os.getenv("SQR_SECRET_KEY") or os.getenv("SECRET_KEY") or "CHANGE_THIS_SECRET_KEY_BEFORE_DEPLOYMENT"
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_CONTENT_LENGTH", str(50 * 1024 * 1024)))
app.config["UPLOAD_FOLDER"] = UPLOAD_DIR

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost").strip(),
    "port": int(os.getenv("DB_PORT", "3306").strip() or "3306"),
    "user": os.getenv("DB_USER", "root").strip(),
    "password": os.getenv("DB_PASSWORD", "").strip(),
    "database": os.getenv("DB_NAME", "railway").strip(),
    "connection_timeout": int(os.getenv("DB_TIMEOUT", "10")),
    "autocommit": True,
}

pool = None
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) if OpenAI and os.getenv("OPENAI_API_KEY") else None
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

COURSE_LEVEL_META = {
    "beginner": {"label": "Beginner", "class": "level-beginner", "hex": "#22c55e"},
    "intermediate": {"label": "Intermediate", "class": "level-intermediate", "hex": "#eab308"},
    "advanced": {"label": "Advanced", "class": "level-advanced", "hex": "#ef4444"},
}

SPECIALIZATION_HINTS = {
    "cybersecurity": ["security", "cyber", "network", "linux", "forensics", "burp", "wireshark", "soc", "vulnerability", "incident"],
    "digital forensics": ["forensics", "evidence", "investigation", "incident", "malware", "security"],
    "software engineering": ["software", "java", "python", "problem", "api", "backend", "testing", "oop"],
    "web development": ["html", "css", "javascript", "react", "frontend", "backend", "node", "flask"],
    "data science": ["data", "python", "sql", "analysis", "machine learning", "statistics", "visualization"],
    "artificial intelligence": ["ai", "machine learning", "deep learning", "automation", "model", "python", "nlp", "vision"],
    "cloud computing": ["cloud", "aws", "azure", "deployment", "server", "docker", "devops", "kubernetes"],
    "database administration": ["database", "sql", "mysql", "postgresql", "queries", "schema", "admin"],
    "computer networks": ["network", "tcp", "ip", "routing", "switching", "security", "linux"],
    "ui/ux engineering": ["ui", "ux", "design", "interface", "figma", "frontend", "user"],
    "game development": ["game", "unity", "graphics", "c++", "logic"],
}

SQR_PAGE_BLUEPRINTS = {
    "home": ["homeSpecializations", "homeCourses", "homeJobs"],
    "profile": ["profileSummary", "profileProgressBars", "profileQuizHistory", "profileAtsHistory"],
    "specializations": ["specializationDetails", "specializationsBox"],
    "courses": ["courseDetails", "coursesBox"],
    "quiz": ["quizDetails", "quizResult", "quizzesBox"],
    "ats": ["atsCheckForm", "atsGenerateForm", "atsResult", "generatedResume"],
    "jobs": ["jobsBox", "jobDetails"],
    "recommendation": ["recommendationForm", "recommendationResult", "recommendationQuestionBank"],
    "admin": ["adminStatsBox", "adminSpecializationsList", "adminCoursesList", "adminJobsList", "adminQuizzesList", "adminCertificatesList", "adminUsersList"],
}

SQR_COLOR_THEME_TOKENS = {
    "background": "#020617",
    "surface": "rgba(15,23,42,0.82)",
    "cyan": "#22d3ee",
    "blue": "#3b82f6",
    "purple": "#8b5cf6",
    "pink": "#ec4899",
    "green": "#22c55e",
    "orange": "#f97316",
    "red": "#ef4444",
}

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    global pool
    if pool is None:
        pool = pooling.MySQLConnectionPool(
            pool_name="sqr_pool",
            pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
            **DB_CONFIG,
        )
    return pool.get_connection()


def query_db(sql, params=None, fetchone=False, fetchall=False, commit=False):
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(sql, params or ())
        result = None
        if fetchone:
            result = cursor.fetchone()
        elif fetchall:
            result = cursor.fetchall()
        if commit:
            db.commit()
            result = cursor.lastrowid
        return result
    except Exception:
        if commit:
            db.rollback()
        raise
    finally:
        cursor.close()
        db.close()


def exec_db(sql, params=None):
    return query_db(sql, params=params, commit=True)


def get_json():
    return request.get_json(silent=True) or {}


def safe_text(value):
    return str(value or "").strip()


def safe_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except Exception:
        return default


def safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def table_exists(table_name):
    try:
        row = query_db(
            """
            SELECT COUNT(*) AS total
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s
            """,
            (DB_CONFIG["database"], table_name),
            fetchone=True,
        )
        return bool(row and row.get("total"))
    except Exception:
        return False


def column_exists(table_name, column_name):
    try:
        row = query_db(
            """
            SELECT COUNT(*) AS total
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s
            """,
            (DB_CONFIG["database"], table_name, column_name),
            fetchone=True,
        )
        return bool(row and row.get("total"))
    except Exception:
        return False


def table_columns(table_name):
    try:
        rows = query_db(
            """
            SELECT COLUMN_NAME AS name
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s
            ORDER BY ORDINAL_POSITION
            """,
            (DB_CONFIG["database"], table_name),
            fetchall=True,
        ) or []
        return [r.get("name") for r in rows if r.get("name")]
    except Exception:
        return []


def first_existing_column(table_name, names):
    for name in names:
        if column_exists(table_name, name):
            return name
    return names[0]


def pk_col(table_name):
    candidates = {
        "users": ["id", "user_id"],
        "admins": ["admin_id", "id"],
        "specializations": ["specialization_id", "id"],
        "specialization": ["specialization_id", "id"],
        "courses": ["course_id", "id"],
        "quizzes": ["quiz_id", "id"],
        "quiz_questions": ["question_id", "id"],
        "jobs": ["job_id", "id"],
        "certifications": ["certification_id", "id"],
        "certificates": ["id", "certification_id"],
        "ats_results": ["ats_id", "id"],
        "recommendations": ["recommendation_id", "id"],
        "recommendation_results": ["id", "recommendation_id"],
        "course_enrollments": ["enrollment_id", "id"],
        "specialization_enrollments": ["enrollment_id", "id"],
        "quiz_attempts": ["attempt_id", "id"],
    }
    return first_existing_column(table_name, candidates.get(table_name, ["id"]))


def active_specializations_table():
    if table_exists("specializations"):
        return "specializations"
    if table_exists("specialization"):
        return "specialization"
    return "specializations"


def row_value(row, *names):
    for name in names:
        if isinstance(row, dict) and row.get(name) not in [None, ""]:
            return row.get(name)
    return None


def insert_dynamic(table_name, data):
    cols = set(table_columns(table_name))
    clean = {k: v for k, v in data.items() if k in cols and v is not None}
    if not clean:
        return None
    names = list(clean.keys())
    placeholders = ",".join(["%s"] * len(names))
    col_sql = ",".join([f"`{c}`" for c in names])
    sql = f"INSERT INTO `{table_name}` ({col_sql}) VALUES ({placeholders})"
    return query_db(sql, tuple(clean[c] for c in names), commit=True)


def update_dynamic(table_name, item_id, data, id_candidates=None):
    cols = set(table_columns(table_name))
    clean = {k: v for k, v in data.items() if k in cols and v is not None}
    if not clean:
        return 0
    id_col = first_existing_column(table_name, id_candidates or [pk_col(table_name), "id"])
    sets = ", ".join([f"`{c}`=%s" for c in clean])
    params = list(clean.values()) + [item_id]
    query_db(f"UPDATE `{table_name}` SET {sets} WHERE `{id_col}`=%s", params, commit=True)
    return 1


def delete_by_id(table_name, item_id, id_candidates=None):
    id_col = first_existing_column(table_name, id_candidates or [pk_col(table_name), "id"])
    query_db(f"DELETE FROM `{table_name}` WHERE `{id_col}`=%s", (item_id,), commit=True)


def select_by_id(table_name, item_id, id_candidates=None):
    id_col = first_existing_column(table_name, id_candidates or [pk_col(table_name), "id"])
    return query_db(f"SELECT * FROM `{table_name}` WHERE `{id_col}`=%s", (item_id,), fetchone=True)


def add_column_if_missing(table_name, column_name, column_sql):
    try:
        if table_exists(table_name) and not column_exists(table_name, column_name):
            exec_db(f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` {column_sql}")
    except Exception as exc:
        print(f"Skipped adding {table_name}.{column_name}: {exc}")

# ---------------------------------------------------------------------------
# Normalizers
# ---------------------------------------------------------------------------

def upload_url(filename):
    value = safe_text(filename)
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://") or value.startswith("/uploads/"):
        return value
    return f"/uploads/{value}"


def normalize_level(level):
    value = safe_text(level).lower() or "beginner"
    aliases = {
        "begginer": "beginner",
        "beginner": "beginner",
        "medium": "intermediate",
        "intermidiete": "intermediate",
        "intermediate": "intermediate",
        "advance": "advanced",
        "advanced": "advanced",
    }
    return aliases.get(value, "beginner")


def add_level_meta(course):
    level = normalize_level(course.get("level") or course.get("difficulty"))
    course["level"] = level
    course["difficulty"] = level
    course["level_badge"] = COURSE_LEVEL_META[level]
    return course


def normalize_specialization(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "specialization_id")
    row["specialization_id"] = row["id"]
    row["image_url"] = upload_url(row_value(row, "image", "image_url"))
    row["skills"] = row_value(row, "skills", "required_skills") or ""
    row["description"] = row.get("description") or ""
    return row


def normalize_course(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "course_id")
    row["course_id"] = row["id"]
    row["specialization_id"] = row_value(row, "specialization_id", "spec_id")
    row["spec_id"] = row["specialization_id"]
    row["link"] = row_value(row, "link", "course_link") or ""
    row["course_link"] = row["link"]
    row["image_url"] = upload_url(row_value(row, "image", "image_url", "thumbnail"))
    row["video_url"] = upload_url(row_value(row, "video", "video_url", "media_url"))
    row["specialization_name"] = row_value(row, "specialization_name", "specialization") or ""
    return add_level_meta(row)


def normalize_quiz(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "quiz_id")
    row["quiz_id"] = row["id"]
    row["course_id"] = row_value(row, "course_id", "course")
    return row


def normalize_question(row, include_answer=False):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "question_id")
    row["question_id"] = row["id"]
    row["question"] = row_value(row, "question", "question_text") or ""
    row["options"] = [
        row_value(row, "option1", "option_a") or "",
        row_value(row, "option2", "option_b") or "",
        row_value(row, "option3", "option_c") or "",
        row_value(row, "option4", "option_d") or "",
    ]
    row["correct_option"] = row_value(row, "answer", "correct_answer", "correct_option") or ""
    if not include_answer:
        row.pop("answer", None)
        row.pop("correct_answer", None)
        row.pop("correct_option", None)
    return row


def normalize_job(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "job_id")
    row["job_id"] = row["id"]
    row["specialization_id"] = row_value(row, "specialization_id", "spec_id")
    row["skills"] = row_value(row, "skills", "required_skills") or ""
    row["required_skills"] = row["skills"]
    row["salary"] = row_value(row, "salary", "average_salary") or ""
    row["average_salary"] = row["salary"]
    row["link"] = row_value(row, "link", "job_link") or ""
    row["job_link"] = row["link"]
    row["specialization"] = row_value(row, "specialization_name", "specialization") or ""
    return row


def normalize_certificate(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "certification_id")
    row["certification_id"] = row["id"]
    row["specialization_id"] = row_value(row, "specialization_id", "spec_id")
    row["link"] = row_value(row, "link", "official_link") or ""
    return row


def clean_user(user):
    if not user:
        return None
    user = dict(user)
    user.pop("password", None)
    user["id"] = row_value(user, "id", "user_id")
    user["user_id"] = user["id"]
    user["current_mode"] = user.get("current_mode") or user.get("role") or "student"
    user["banned"] = safe_int(row_value(user, "banned", "is_banned"), 0)
    return user

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def strong_password(password):
    password = str(password or "")
    return (
        len(password) >= 8
        and re.search(r"[A-Z]", password)
        and re.search(r"[a-z]", password)
        and re.search(r"[0-9]", password)
        and re.search(r"[^A-Za-z0-9]", password)
        and not re.search(r"\s", password)
    )


def generate_username(name, email):
    base = (email.split("@")[0] if email and "@" in email else name).strip().lower()
    base = re.sub(r"[^a-z0-9_]+", "_", base).strip("_") or "student"
    if not column_exists("users", "username"):
        return base
    candidate = base
    counter = 1
    while query_db("SELECT id FROM users WHERE username=%s", (candidate,), fetchone=True):
        counter += 1
        candidate = f"{base}{counter}"
    return candidate


def generate_token(user):
    uid = row_value(user, "id", "user_id")
    payload = {
        "id": uid,
        "user_id": uid,
        "name": user.get("name"),
        "email": user.get("email"),
        "role": user.get("role", "student"),
        "current_mode": user.get("current_mode", user.get("role", "student")),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=int(os.getenv("JWT_HOURS", "24"))),
    }
    return jwt.encode(payload, app.config["SECRET_KEY"], algorithm="HS256")


def get_current_user():
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not token:
        return None
    try:
        data = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
        uid = data.get("user_id") or data.get("id")
        user = query_db("SELECT * FROM users WHERE id=%s", (uid,), fetchone=True)
        if not user:
            return None
        if safe_int(row_value(user, "banned", "is_banned"), 0) == 1:
            return None
        return user
    except Exception:
        return None


def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        request.current_user = user
        return func(*args, **kwargs)
    return wrapper


def admin_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        if safe_text(user.get("role")).lower() != "admin":
            return jsonify({"error": "Admin only"}), 403
        request.current_user = user
        return func(*args, **kwargs)
    return wrapper


def student_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        if safe_text(user.get("role")).lower() == "admin" and safe_text(user.get("current_mode") or "admin").lower() != "student":
            return jsonify({"error": "Admins can only access the admin page unless switched to student mode."}), 403
        request.current_user = user
        return func(*args, **kwargs)
    return wrapper

# ---------------------------------------------------------------------------
# Files and resume parsing
# ---------------------------------------------------------------------------

def allowed_file(filename):
    allowed = {"png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm", "ogg", "pdf", "docx", "txt"}
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed


def save_file(field_name):
    file = request.files.get(field_name)
    if not file or not file.filename:
        return ""
    if not allowed_file(file.filename):
        return ""
    original = secure_filename(file.filename)
    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S%f")
    filename = f"{stamp}_{original}"
    file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
    return filename


def request_data():
    if request.content_type and "multipart/form-data" in request.content_type:
        return dict(request.form)
    return get_json()


def extract_resume_text(file):
    if not file or not file.filename:
        return ""
    name = file.filename.lower()
    raw = file.read()
    file.seek(0)
    if name.endswith(".txt"):
        return raw.decode("utf-8", errors="ignore")
    if name.endswith(".pdf"):
        if not PdfReader:
            return ""
        reader = PdfReader(BytesIO(raw))
        return "\n".join([page.extract_text() or "" for page in reader.pages])
    if name.endswith(".docx"):
        if not Document:
            return ""
        doc = Document(BytesIO(raw))
        return "\n".join([p.text for p in doc.paragraphs])
    return ""

# ---------------------------------------------------------------------------
# ATS engine: fixed with the uploaded ats_engine.py logic
# ---------------------------------------------------------------------------

SYNONYMS = {
    "js": "javascript", "ts": "typescript", "py": "python",
    "golang": "go", "c#": "csharp", "c sharp": "csharp",
    ".net": "dotnet", "asp.net": "dotnet",
    "gcp": "google cloud", "google cloud platform": "google cloud",
    "amazon web services": "aws", "azure devops": "azure",
    "k8s": "kubernetes", "kube": "kubernetes",
    "ml": "machine learning", "dl": "deep learning",
    "nlp": "natural language processing",
    "ai": "artificial intelligence",
    "cv": "computer vision",
    "llm": "large language models", "llms": "large language models",
    "postgres": "postgresql", "mongo": "mongodb",
    "mssql": "sql server", "ms sql": "sql server",
    "rdbms": "sql",
    "ci/cd": "cicd", "ci cd": "cicd",
    "oop": "object oriented programming",
    "tdd": "test driven development",
    "rest api": "rest", "restful": "rest",
    "graphql api": "graphql",
    "ui/ux": "ui ux", "ux/ui": "ui ux",
    "agile/scrum": "agile scrum", "scrum/agile": "agile scrum",
    "power bi": "powerbi", "tableau server": "tableau",
    "ms excel": "excel", "microsoft excel": "excel",
    "ms office": "microsoft office",
    "git hub": "github", "git lab": "gitlab",
    "pen test": "penetration testing", "pentest": "penetration testing",
    "soc analyst": "security operations",
    "appsec": "application security",
    "comm skills": "communication",
    "problem-solving": "problem solving",
    "critical-thinking": "critical thinking",
}

BROAD_SKILLS = [
    "python", "java", "javascript", "typescript", "csharp", "go", "rust",
    "swift", "kotlin", "php", "ruby", "scala", "r", "matlab", "bash",
    "html", "css", "react", "angular", "vue", "nextjs", "nodejs",
    "django", "flask", "fastapi", "spring", "laravel", "rails",
    "sql", "mysql", "postgresql", "mongodb", "redis", "elasticsearch",
    "machine learning", "deep learning", "tensorflow", "pytorch",
    "scikit-learn", "pandas", "numpy", "spark", "hadoop",
    "data analysis", "data engineering", "etl",
    "aws", "google cloud", "azure", "docker", "kubernetes", "terraform",
    "cicd", "linux", "git", "github", "gitlab",
    "cybersecurity", "networking", "penetration testing",
    "wireshark", "burp suite", "application security",
    "agile scrum", "communication", "problem solving",
    "teamwork", "project management", "leadership",
    "rest", "graphql", "microservices", "api design",
    "powerbi", "tableau", "excel", "looker",
]

TECH_SKILLS = BROAD_SKILLS


def _normalise(text):
    text = safe_text(text).lower().strip()
    text = re.sub(r"[^\w\s#+./]", " ", text)
    text = re.sub(r"\s+", " ", text)
    for alias, canonical in SYNONYMS.items():
        text = re.sub(r"\b" + re.escape(alias) + r"\b", canonical, text)
    return text


def _extract_ngrams(text, max_n=4):
    words = text.split()
    grams = set()
    for n in range(1, max_n + 1):
        for i in range(len(words) - n + 1):
            grams.add(" ".join(words[i:i + n]))
    return grams


def extract_terms(text):
    text_norm = _normalise(text or "")
    return sorted([skill for skill in BROAD_SKILLS if skill in text_norm])


_REQUIRED_SIGNALS = re.compile(
    r"\b(required|must have|must-have|essential|mandatory|minimum|you (must|need|will need)|need to have|require[sd]?)\b",
    re.I,
)
_PREFERRED_SIGNALS = re.compile(
    r"\b(preferred|nice to have|nice-to-have|bonus|plus|desired|advantageous|ideally|optional|appreciated)\b",
    re.I,
)


def _split_jd_sections(jd):
    lines = safe_text(jd).splitlines()
    req_lines, pref_lines, mode = [], [], "required"
    for line in lines:
        if _PREFERRED_SIGNALS.search(line):
            mode = "preferred"
        elif _REQUIRED_SIGNALS.search(line):
            mode = "required"
        if mode == "preferred":
            pref_lines.append(line)
        else:
            req_lines.append(line)
    req = " ".join(req_lines) if req_lines else jd
    pref = " ".join(pref_lines)
    return req, pref


def extract_jd_keywords(jd):
    if not safe_text(jd):
        return list(BROAD_SKILLS), []
    req_text, pref_text = _split_jd_sections(jd)
    norm_req = _normalise(req_text)
    norm_pref = _normalise(pref_text)
    jd_grams = _extract_ngrams(_normalise(jd))
    required = sorted(s for s in BROAD_SKILLS if s in norm_req)
    preferred = sorted(s for s in BROAD_SKILLS if s in norm_pref and s not in required)
    cap_skill = re.compile(r"\b([A-Z][A-Za-z0-9+#.]{2,})\b")
    extra_candidates = {
        _normalise(m)
        for m in cap_skill.findall(safe_text(jd))
        if _normalise(m) not in ("the", "and", "for", "with", "this", "that")
    }
    for cand in extra_candidates:
        if cand in jd_grams and cand not in required and cand not in preferred:
            preferred.append(cand)
    return required, preferred[:30]


SECTION_PATTERNS = {
    "contact": re.compile(r"(\b[\w.+-]+@[\w.-]+\.\w+\b|linkedin\.com|github\.com|\+?\d[\d\s\-]{7,})", re.I),
    "summary": re.compile(r"\b(summary|profile|objective|about me|professional background)\b", re.I),
    "skills": re.compile(r"\b(skills|technical skills|core competencies|technologies|tech stack)\b", re.I),
    "experience": re.compile(r"\b(experience|employment|work history|professional experience|internship)\b", re.I),
    "education": re.compile(r"\b(education|degree|university|college|bachelor|master|phd|diploma)\b", re.I),
    "projects": re.compile(r"\b(projects?|portfolio|personal projects?|side projects?)\b", re.I),
    "certifications": re.compile(r"\b(certif|certificate|certified|aws certified|comptia|cisco)\b", re.I),
}

ACTION_VERBS = [
    "built", "developed", "designed", "implemented", "improved",
    "analyzed", "created", "managed", "tested", "deployed", "led",
    "architected", "optimised", "optimized", "automated", "reduced",
    "increased", "delivered", "integrated", "migrated", "launched",
    "collaborated", "mentored", "owned", "drove", "scaled",
]

METRIC_RE = re.compile(r"\b\d[\d,]*\s*(%|percent|x|times|users|requests|ms|seconds|hours|days|k\b|m\b)", re.I)
NUMBER_RE = re.compile(r"\b\d{2,}\b")


def _section_quality(section, resume_lower):
    result = {}
    for name, pat in SECTION_PATTERNS.items():
        present = bool(pat.search(resume_lower))
        quality = 0
        if present:
            quality = 60
            if name == "experience":
                verb_count = sum(1 for v in ACTION_VERBS if v in resume_lower)
                has_metrics = bool(METRIC_RE.search(resume_lower) or NUMBER_RE.search(resume_lower))
                quality += min(25, verb_count * 5)
                quality += 15 if has_metrics else 0
            elif name == "skills":
                quality += 20 if resume_lower.count(",") > 5 else 0
                quality += 20 if resume_lower.count("•") + resume_lower.count("-") > 3 else 0
            elif name == "summary":
                sentences = len(re.findall(r"[.!?]", resume_lower[:500]))
                quality += 20 if 2 <= sentences <= 6 else 0
                quality += 20 if any(v in resume_lower[:500] for v in ACTION_VERBS) else 0
            else:
                quality += 40
        result[name] = {"present": present, "quality": min(100, quality)}
    return result


ATS_FORMAT_ISSUES = [
    (re.compile(r"\|.*\|.*\|", re.M), "Tables detected - most ATS parsers skip table content entirely."),
    (re.compile(r"[^\x00-\x7F]"), "Non-ASCII characters found - replace with standard equivalents."),
    (re.compile(r"(header|footer)", re.I), "Header/footer keywords found - avoid putting key info in page headers."),
    (re.compile(r"\.(jpg|png|gif|svg)\b", re.I), "Image references detected - ATS cannot read text inside images."),
    (re.compile(r"curriculum vitae", re.I), "Title 'Curriculum Vitae' - use 'Resume' for North American ATS systems."),
]


def local_ats_score(resume_text, job_description=""):
    resume_lower = _normalise(resume_text)
    resume_grams = _extract_ngrams(resume_lower)
    required_kw, preferred_kw = extract_jd_keywords(job_description)
    matched_req = [k for k in required_kw if k in resume_grams]
    matched_pref = [k for k in preferred_kw if k in resume_grams]
    missing_req = [k for k in required_kw if k not in resume_grams]
    missing_pref = [k for k in preferred_kw if k not in resume_grams]
    total_weight = len(required_kw) * 2 + len(preferred_kw)
    match_weight = len(matched_req) * 2 + len(matched_pref)
    keyword_score = int((match_weight / max(total_weight, 1)) * 35)
    sections = _section_quality("", resume_lower)
    section_weights = {"contact": 3, "summary": 4, "skills": 5, "experience": 6, "education": 4, "projects": 2, "certifications": 1}
    raw_section = sum((sections[s]["quality"] / 100) * w for s, w in section_weights.items())
    section_score = int((raw_section / sum(section_weights.values())) * 25)
    verb_count = sum(1 for v in ACTION_VERBS if v in resume_lower)
    has_metrics = bool(METRIC_RE.search(resume_text))
    has_numbers = bool(NUMBER_RE.search(resume_text))
    bullet_score = min(20, min(12, verb_count * 2) + (5 if has_metrics else 0) + (3 if has_numbers else 0))
    format_issues = [msg for pat, msg in ATS_FORMAT_ISSUES if pat.search(resume_text)]
    format_score = max(0, 10 - len(format_issues) * 3)
    word_count = len(safe_text(resume_text).split())
    if 300 <= word_count <= 800:
        length_score = 10
    elif 200 <= word_count < 300 or 800 < word_count <= 1000:
        length_score = 6
    elif 100 <= word_count < 200 or 1000 < word_count <= 1200:
        length_score = 3
    else:
        length_score = 1
    total_score = max(5, min(100, keyword_score + section_score + bullet_score + format_score + length_score))
    if total_score >= 85:
        grade, label = "A", "Excellent - likely to pass ATS screening"
    elif total_score >= 70:
        grade, label = "B", "Good - minor improvements recommended"
    elif total_score >= 55:
        grade, label = "C", "Fair - several gaps to address"
    elif total_score >= 40:
        grade, label = "D", "Weak - significant rework needed"
    else:
        grade, label = "F", "Poor - resume needs a full overhaul"
    strengths = []
    improvements = []
    if matched_req:
        strengths.append(f"Matches {len(matched_req)} required keyword(s): {', '.join(matched_req[:6])}.")
    if has_metrics:
        strengths.append("Contains quantified achievements - ATS and recruiters both favour numbers.")
    if verb_count >= 4:
        strengths.append(f"Good use of action verbs ({verb_count} detected).")
    if sections["skills"]["present"]:
        strengths.append("Dedicated Skills section present - ATS parsers look for this explicitly.")
    if sections["projects"]["present"]:
        strengths.append("Projects section strengthens keyword density and shows practical work.")
    if missing_req:
        improvements.append(f"Add missing required keywords naturally: {', '.join(missing_req[:8])}. Mirror the exact wording from the job description.")
    if not has_metrics:
        improvements.append("No quantified achievements found. Add numbers like 'Reduced load time by 40%' or 'Processed 10k records/day'.")
    if verb_count < 4:
        improvements.append("Weak bullet points. Start each bullet with a strong action verb: Built, Designed, Improved, Automated, Reduced, Led, Delivered.")
    if not sections["summary"]["present"]:
        improvements.append("No professional summary found. Add a 2-3 sentence summary at the top that mirrors the job title and required keywords.")
    if not sections["skills"]["present"]:
        improvements.append("No Skills section detected. Create one with clearly labelled categories: Languages, Frameworks, Databases, Tools, Certifications.")
    if format_issues:
        improvements.extend(format_issues)
    if word_count < 300:
        improvements.append(f"Resume is too short ({word_count} words). ATS systems expect 300-700 words. Expand experience bullets and add a projects section.")
    if missing_pref:
        improvements.append(f"Preferred skills not on resume: {', '.join(missing_pref[:6])}. Add any you genuinely have.")
    section_scores = {
        "contact": sections["contact"]["quality"],
        "summary": sections["summary"]["quality"],
        "skills": sections["skills"]["quality"],
        "experience": sections["experience"]["quality"],
        "education": sections["education"]["quality"],
        "projects": sections["projects"]["quality"],
        "certifications": sections["certifications"]["quality"],
        "keyword_match": int((match_weight / max(total_weight, 1)) * 100),
        "bullet_quality": int((bullet_score / 20) * 100),
        "formatting": int((format_score / 10) * 100),
    }
    return {
        "ats_score": total_score,
        "grade": grade,
        "label": label,
        "summary": f"Score {total_score}/100 ({grade}) - {label}.",
        "score_breakdown": {
            "keyword_match": keyword_score,
            "section_quality": section_score,
            "bullet_quality": bullet_score,
            "formatting": format_score,
            "length": length_score,
        },
        "matched_keywords": sorted(set(matched_req + matched_pref)),
        "missing_keywords": missing_req[:12] + missing_pref[:6],
        "required_keywords": required_kw,
        "preferred_keywords": preferred_kw,
        "strengths": strengths or ["Resume is readable and structured."],
        "improvements": improvements,
        "formatting_issues": format_issues,
        "section_scores": section_scores,
        "word_count": word_count,
        "action_verb_count": verb_count,
        "has_metrics": has_metrics,
        "engine": "local_v2",
    }


_ATS_SYSTEM = """You are a senior ATS specialist and technical recruiter. Analyse the resume against the job description rigorously. Your only output is a single valid JSON object. No prose. No markdown fences."""

_ATS_USER_TEMPLATE = """
JOB DESCRIPTION:
{jd}

RESUME:
{resume}

Return this exact JSON shape:
{{
  "ats_score": <integer 0-100>,
  "grade": "<A|B|C|D|F>",
  "label": "<one sentence verdict>",
  "summary": "<2-3 sentence summary for the candidate>",
  "score_breakdown": {{
    "keyword_match": <0-35>,
    "section_quality": <0-25>,
    "bullet_quality": <0-20>,
    "formatting": <0-10>,
    "length": <0-10>
  }},
  "matched_keywords": ["..."],
  "missing_keywords": ["..."],
  "required_keywords": ["..."],
  "preferred_keywords": ["..."],
  "strengths": ["..."],
  "improvements": ["..."],
  "formatting_issues": ["..."],
  "section_scores": {{
    "contact": <0-100>,
    "summary": <0-100>,
    "skills": <0-100>,
    "experience": <0-100>,
    "education": <0-100>,
    "projects": <0-100>,
    "certifications": <0-100>,
    "keyword_match": <0-100>,
    "bullet_quality": <0-100>,
    "formatting": <0-100>
  }},
  "word_count": <integer>,
  "action_verb_count": <integer>,
  "has_metrics": <true|false>,
  "engine": "openai"
}}
"""


def parse_json_from_ai(text, fallback=None):
    fallback = fallback if fallback is not None else {}
    try:
        raw = safe_text(text)
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`")
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(match.group(0) if match else raw)
    except Exception:
        return fallback


def ai_json(prompt, fallback=None, system="Return valid JSON only. Do not invent user experience.", temperature=0.2, max_tokens=1200):
    fallback = fallback if fallback is not None else {}
    if not client:
        return fallback
    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        text = response.choices[0].message.content or "{}"
        return parse_json_from_ai(text, fallback)
    except Exception as exc:
        print(f"[ai_json] failed: {exc}")
        return fallback


def ai_ats_score(resume_text, job_description, client_obj=None, model=None):
    used_client = client_obj or client
    used_model = model or OPENAI_MODEL
    if not used_client:
        return None
    try:
        prompt = _ATS_USER_TEMPLATE.format(jd=safe_text(job_description)[:4000], resume=safe_text(resume_text)[:4000])
        response = used_client.chat.completions.create(
            model=used_model,
            messages=[
                {"role": "system", "content": _ATS_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=1200,
        )
        raw = response.choices[0].message.content or ""
        result = parse_json_from_ai(raw)
        if isinstance(result, dict) and isinstance(result.get("ats_score"), int):
            return result
        return None
    except Exception as exc:
        print(f"[ai_ats_score] failed: {exc}")
        return None


def smart_ats_score(resume_text, job_description="", client=None, model="gpt-4o-mini"):
    ai_result = ai_ats_score(resume_text, job_description, client, model)
    if ai_result and isinstance(ai_result.get("ats_score"), int):
        return ai_result
    return local_ats_score(resume_text, job_description)


def calculate_match_percentage(profile_text, target_text):
    if not safe_text(target_text):
        return 0, []
    profile_grams = _extract_ngrams(_normalise(profile_text))
    target_grams = _extract_ngrams(_normalise(target_text))
    raw_matches = profile_grams & target_grams
    stop = {"the", "and", "for", "with", "this", "that", "are", "was", "you", "our", "not", "but", "its", "can", "will", "may", "use", "used", "using", "have", "has", "been"}
    meaningful = {t for t in raw_matches if len(t) >= 3 and t not in stop}
    skill_set = set(BROAD_SKILLS)
    skill_hits = [m for m in meaningful if m in skill_set]
    other_hits = [m for m in meaningful if m not in skill_set]
    target_skills = [s for s in BROAD_SKILLS if s in _normalise(target_text)]
    if not target_skills:
        target_skills = list(target_grams)[:40]
    skill_score = len(skill_hits) / max(len(target_skills), 1)
    union_overlap = target_grams & _extract_ngrams(_normalise(profile_text) + " " + _normalise(target_text))
    overlap_score = min(1.0, len(meaningful) / max(len(union_overlap), 1))
    score = int(min(100, round((skill_score * 65 + overlap_score * 35))))
    matched = sorted(set(skill_hits + other_hits[:10]))[:20]
    return score, matched


def improve_summary_local(summary, target_job, skills, name=""):
    target = (target_job or "technology").strip().rstrip(".")
    detected = [s for s in BROAD_SKILLS if s in _normalise(skills or "")]
    top_skills = ", ".join(detected[:4]) if detected else "software development and problem-solving"
    base = safe_text(summary)
    intro = f"{safe_text(name)} is a" if safe_text(name) else "Results-driven"
    if base:
        return (
            f"{intro} {target} professional with demonstrated expertise in {top_skills}. "
            f"{base.rstrip('.')}. "
            f"Adept at translating technical requirements into measurable outcomes, collaborating across teams, "
            f"and delivering production-ready solutions aligned with {target} best practices."
        )
    return (
        f"{intro} {target} professional with hands-on experience in {top_skills}. "
        f"Track record of building reliable, scalable systems and driving continuous improvement. "
        f"Strong communicator who bridges technical and business perspectives to deliver results in fast-paced environments."
    )


def ai_improve_summary(summary, target_job, skills, name=""):
    fallback = {"summary": improve_summary_local(summary, target_job, skills, name)}
    prompt = f"""
Improve this resume summary. Make it specific, ATS-friendly, natural, and not generic.
Do not invent degrees, companies, years, certifications, awards, or experience.

Name: {safe_text(name)}
Target job: {safe_text(target_job)}
Skills: {safe_text(skills)}
Current summary: {safe_text(summary)}

Return JSON only:
{{"summary":"improved summary here"}}
"""
    result = ai_json(prompt, fallback=fallback, temperature=0.4, max_tokens=450)
    return safe_text(result.get("summary")) or fallback["summary"]

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def init_db():
    try:
        if table_exists("specialization") and not table_exists("specializations"):
            exec_db("RENAME TABLE specialization TO specializations")
            print("Renamed specialization table to specializations")
    except Exception as exc:
        print("specialization compatibility rename skipped:", exc)

    statements = [
        """
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role ENUM('student','admin') NOT NULL DEFAULT 'student',
            current_mode ENUM('student','admin') DEFAULT 'student',
            banned TINYINT DEFAULT 0,
            is_banned TINYINT DEFAULT 0,
            skills TEXT,
            interests TEXT,
            goal TEXT,
            work_style TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS admins (
            admin_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            admin_level ENUM('owner','manager') DEFAULT 'manager',
            can_manage_users TINYINT DEFAULT 1,
            can_manage_specializations TINYINT DEFAULT 1,
            can_manage_courses TINYINT DEFAULT 1,
            can_manage_quizzes TINYINT DEFAULT 1,
            can_view_reports TINYINT DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS specializations (
            specialization_id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            title VARCHAR(150),
            description TEXT,
            roadmap TEXT,
            job_titles TEXT,
            career_paths TEXT,
            image_url VARCHAR(255),
            skills TEXT,
            image VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS courses (
            course_id INT AUTO_INCREMENT PRIMARY KEY,
            specialization_id INT NOT NULL,
            title VARCHAR(200) NOT NULL,
            name VARCHAR(200),
            description TEXT,
            level ENUM('Beginner','Intermediate','Advanced') DEFAULT 'Beginner',
            difficulty ENUM('beginner','intermediate','advanced') DEFAULT 'beginner',
            course_link VARCHAR(255),
            video_url VARCHAR(255),
            image_url VARCHAR(255),
            spec_id INT,
            link VARCHAR(255),
            image VARCHAR(255),
            video VARCHAR(255),
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS certificates (
            id INT AUTO_INCREMENT PRIMARY KEY,
            spec_id INT NOT NULL,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            link VARCHAR(255),
            price VARCHAR(100),
            type ENUM('practical','theoretical','both') DEFAULT 'both',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS certifications (
            certification_id INT AUTO_INCREMENT PRIMARY KEY,
            specialization_id INT NOT NULL,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            official_link VARCHAR(255),
            link VARCHAR(255),
            price VARCHAR(50),
            type ENUM('Practical','Theoretical','Both') DEFAULT 'Both',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS jobs (
            job_id INT AUTO_INCREMENT PRIMARY KEY,
            specialization_id INT NOT NULL,
            title VARCHAR(150) NOT NULL,
            description TEXT,
            required_skills TEXT,
            skills TEXT,
            average_salary VARCHAR(100),
            salary VARCHAR(100),
            job_link VARCHAR(255),
            link VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS quizzes (
            quiz_id INT AUTO_INCREMENT PRIMARY KEY,
            course_id INT NOT NULL,
            title VARCHAR(150) NOT NULL,
            name VARCHAR(150),
            description TEXT,
            total_questions INT DEFAULT 0,
            passing_score INT DEFAULT 60,
            spec_id INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS quiz_questions (
            question_id INT AUTO_INCREMENT PRIMARY KEY,
            quiz_id INT NOT NULL,
            question_text TEXT,
            question TEXT,
            option_a VARCHAR(255),
            option_b VARCHAR(255),
            option_c VARCHAR(255),
            option_d VARCHAR(255),
            correct_answer VARCHAR(10),
            option1 VARCHAR(255),
            option2 VARCHAR(255),
            option3 VARCHAR(255),
            option4 VARCHAR(255),
            answer VARCHAR(255),
            score DECIMAL(5,2) DEFAULT 1.00
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS specialization_enrollments (
            enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            specialization_id INT NOT NULL,
            progress_percentage DECIMAL(5,2) DEFAULT 0.00,
            status ENUM('Not Started','In Progress','Completed') DEFAULT 'Not Started',
            enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL DEFAULT NULL,
            UNIQUE KEY unique_user_specialization (user_id, specialization_id)
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS course_enrollments (
            enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            course_id INT NOT NULL,
            progress_percentage DECIMAL(5,2) DEFAULT 0.00,
            status ENUM('Not Started','In Progress','Completed') DEFAULT 'Not Started',
            opened_count INT DEFAULT 0,
            enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL DEFAULT NULL,
            UNIQUE KEY unique_user_course (user_id, course_id)
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS quiz_attempts (
            attempt_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            quiz_id INT NOT NULL,
            score DECIMAL(5,2) DEFAULT 0.00,
            passed TINYINT DEFAULT 0,
            answers_json LONGTEXT,
            attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS ats_results (
            ats_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            resume_text LONGTEXT,
            target_job VARCHAR(150),
            job_description LONGTEXT,
            ats_score DECIMAL(5,2) DEFAULT 0.00,
            grade VARCHAR(5),
            matched_keywords TEXT,
            missing_keywords TEXT,
            suggestions TEXT,
            result_json LONGTEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS recommendations (
            recommendation_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            specialization_id INT NOT NULL,
            assessment_id INT DEFAULT NULL,
            match_score DECIMAL(5,2) DEFAULT 0.00,
            explanation TEXT,
            generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS recommendation_results (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            recommendation_json LONGTEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        """,
        """
        CREATE TABLE IF NOT EXISTS user_completed_courses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            course_id INT NOT NULL,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_completed_course (user_id, course_id)
        ) ENGINE=InnoDB
        """,
    ]
    for sql in statements:
        try:
            exec_db(sql)
        except Exception as exc:
            print("init_db statement skipped:", exc)

    compatibility = {
        "users": [
            ("current_mode", "ENUM('student','admin') DEFAULT 'student'"),
            ("banned", "TINYINT DEFAULT 0"),
            ("is_banned", "TINYINT DEFAULT 0"),
            ("skills", "TEXT"),
            ("interests", "TEXT"),
            ("goal", "TEXT"),
            ("work_style", "TEXT"),
        ],
        "specializations": [
            ("title", "VARCHAR(150)"),
            ("roadmap", "TEXT"),
            ("job_titles", "TEXT"),
            ("career_paths", "TEXT"),
            ("image_url", "VARCHAR(255)"),
            ("image", "VARCHAR(255)"),
            ("skills", "TEXT"),
        ],
        "courses": [
            ("specialization_id", "INT"),
            ("spec_id", "INT"),
            ("name", "VARCHAR(200)"),
            ("difficulty", "VARCHAR(50) DEFAULT 'beginner'"),
            ("level", "VARCHAR(50) DEFAULT 'Beginner'"),
            ("link", "VARCHAR(255)"),
            ("course_link", "VARCHAR(255)"),
            ("image", "VARCHAR(255)"),
            ("image_url", "VARCHAR(255)"),
            ("video", "VARCHAR(255)"),
            ("video_url", "VARCHAR(255)"),
            ("content", "TEXT"),
        ],
        "jobs": [
            ("specialization_id", "INT"),
            ("required_skills", "TEXT"),
            ("skills", "TEXT"),
            ("average_salary", "VARCHAR(100)"),
            ("salary", "VARCHAR(100)"),
            ("job_link", "VARCHAR(255)"),
            ("link", "VARCHAR(255)"),
        ],
        "quizzes": [
            ("course_id", "INT"),
            ("name", "VARCHAR(150)"),
            ("passing_score", "INT DEFAULT 60"),
            ("total_questions", "INT DEFAULT 0"),
            ("spec_id", "INT"),
        ],
        "quiz_questions": [
            ("question_text", "TEXT"),
            ("question", "TEXT"),
            ("option_a", "VARCHAR(255)"),
            ("option_b", "VARCHAR(255)"),
            ("option_c", "VARCHAR(255)"),
            ("option_d", "VARCHAR(255)"),
            ("correct_answer", "VARCHAR(10)"),
            ("option1", "VARCHAR(255)"),
            ("option2", "VARCHAR(255)"),
            ("option3", "VARCHAR(255)"),
            ("option4", "VARCHAR(255)"),
            ("answer", "VARCHAR(255)"),
        ],
        "course_enrollments": [
            ("opened_count", "INT DEFAULT 0"),
            ("progress_percentage", "DECIMAL(5,2) DEFAULT 0.00"),
            ("status", "VARCHAR(50) DEFAULT 'Not Started'"),
            ("completed_at", "TIMESTAMP NULL DEFAULT NULL"),
        ],
        "ats_results": [
            ("job_description", "LONGTEXT"),
            ("grade", "VARCHAR(5)"),
            ("result_json", "LONGTEXT"),
        ],
    }
    for table, cols in compatibility.items():
        for name, definition in cols:
            add_column_if_missing(table, name, definition)

# ---------------------------------------------------------------------------
# Recommendation helpers
# ---------------------------------------------------------------------------

def profile_text_for_user(user):
    if not user:
        return ""
    return " ".join([
        safe_text(user.get("name")),
        safe_text(user.get("skills")),
        safe_text(user.get("interests")),
        safe_text(user.get("goal")),
        safe_text(user.get("work_style")),
    ])


def public_stats():
    def count(table):
        try:
            if not table_exists(table):
                return 0
            row = query_db(f"SELECT COUNT(*) AS total FROM `{table}`", fetchone=True)
            return int(row.get("total") or 0) if row else 0
        except Exception:
            return 0
    return {
        "users": count("users"),
        "specializations": count(active_specializations_table()),
        "courses": count("courses"),
        "quizzes": count("quizzes"),
        "jobs": count("jobs"),
        "certificates": count("certificates") + count("certifications"),
        "ats_results": count("ats_results"),
    }


def recommend_specializations_from_text(text, limit=5):
    specs_table = active_specializations_table()
    idc = pk_col(specs_table)
    specs = query_db(f"SELECT * FROM `{specs_table}` ORDER BY `{idc}` DESC", fetchall=True) or []
    results = []
    for raw in specs:
        spec = normalize_specialization(raw)
        target = " ".join([
            safe_text(spec.get("name")),
            safe_text(spec.get("description")),
            safe_text(spec.get("skills")),
            safe_text(spec.get("roadmap")),
            safe_text(spec.get("career_paths")),
            " ".join(SPECIALIZATION_HINTS.get(safe_text(spec.get("name")).lower(), [])),
        ])
        score, matched = calculate_match_percentage(text, target)
        spec["match_score"] = score
        spec["matched_keywords"] = matched
        spec["explanation"] = (
            f"This specialization matches your profile through: {', '.join(matched[:6])}."
            if matched else "This option is included for exploration, but your profile has limited keyword overlap with it."
        )
        results.append(spec)
    results.sort(key=lambda x: x.get("match_score", 0), reverse=True)
    return results[:limit]


def recommend_jobs_from_text(text, limit=6):
    spec_table = active_specializations_table()
    spec_pk = pk_col(spec_table)
    try:
        rows = query_db(
            f"""
            SELECT j.*, s.name AS specialization_name
            FROM jobs j
            LEFT JOIN `{spec_table}` s ON s.`{spec_pk}` = j.specialization_id
            ORDER BY j.`{pk_col('jobs')}` DESC
            """,
            fetchall=True,
        ) or []
    except Exception:
        rows = query_db(f"SELECT * FROM jobs ORDER BY `{pk_col('jobs')}` DESC", fetchall=True) or []
    jobs = []
    for raw in rows:
        job = normalize_job(raw)
        target = " ".join([safe_text(job.get("title")), safe_text(job.get("description")), safe_text(job.get("required_skills")), safe_text(job.get("skills"))])
        score, matched = calculate_match_percentage(text, target)
        job["match_score"] = score
        job["matched_keywords"] = matched
        job["explanation"] = f"Matched job skills: {', '.join(matched[:6])}." if matched else "Low keyword overlap. Build more related skills first."
        jobs.append(job)
    jobs.sort(key=lambda x: x.get("match_score", 0), reverse=True)
    return jobs[:limit]


def update_course_progress(user_id, course_id, progress=None, status=None, opened_increment=False):
    if not table_exists("course_enrollments"):
        return
    existing = query_db("SELECT * FROM course_enrollments WHERE user_id=%s AND course_id=%s", (user_id, course_id), fetchone=True)
    if existing:
        new_progress = progress if progress is not None else max(safe_float(existing.get("progress_percentage")), 10.0 if opened_increment else 0.0)
        new_status = status or ("In Progress" if new_progress < 100 else "Completed")
        if opened_increment and column_exists("course_enrollments", "opened_count"):
            query_db(
                """
                UPDATE course_enrollments
                SET progress_percentage=%s, status=%s, opened_count=COALESCE(opened_count,0)+1
                WHERE user_id=%s AND course_id=%s
                """,
                (new_progress, new_status, user_id, course_id),
                commit=True,
            )
        else:
            query_db(
                "UPDATE course_enrollments SET progress_percentage=%s, status=%s WHERE user_id=%s AND course_id=%s",
                (new_progress, new_status, user_id, course_id),
                commit=True,
            )
    else:
        new_progress = progress if progress is not None else (10 if opened_increment else 0)
        new_status = status or ("In Progress" if new_progress < 100 else "Completed")
        insert_dynamic("course_enrollments", {"user_id": user_id, "course_id": course_id, "progress_percentage": new_progress, "status": new_status, "opened_count": 1 if opened_increment else 0})


def update_specialization_progress_for_user(user_id, specialization_id):
    try:
        course_id_col = pk_col("courses")
        rows = query_db("SELECT * FROM courses WHERE specialization_id=%s OR spec_id=%s", (specialization_id, specialization_id), fetchall=True) or []
        total = len(rows)
        if total == 0:
            progress = 0
        else:
            ids = [row_value(r, "course_id", "id") for r in rows]
            placeholders = ",".join(["%s"] * len(ids))
            completed = query_db(
                f"SELECT COUNT(*) AS total FROM course_enrollments WHERE user_id=%s AND course_id IN ({placeholders}) AND progress_percentage >= 100",
                tuple([user_id] + ids),
                fetchone=True,
            )
            progress = round((safe_int(completed.get("total") if completed else 0) / total) * 100, 2)
        existing = query_db("SELECT * FROM specialization_enrollments WHERE user_id=%s AND specialization_id=%s", (user_id, specialization_id), fetchone=True)
        status = "Completed" if progress >= 100 else ("In Progress" if progress > 0 else "Not Started")
        if existing:
            query_db(
                "UPDATE specialization_enrollments SET progress_percentage=%s, status=%s WHERE user_id=%s AND specialization_id=%s",
                (progress, status, user_id, specialization_id),
                commit=True,
            )
        else:
            insert_dynamic("specialization_enrollments", {"user_id": user_id, "specialization_id": specialization_id, "progress_percentage": progress, "status": status})
    except Exception as exc:
        print("update_specialization_progress_for_user failed:", exc)

# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

def render_page(template_name):
    return render_template(template_name)


@app.route("/")
def home():
    return render_page("gp.html")


@app.route("/home")
def page_home():
    return render_page("gp.html")


@app.route("/specializations")
def page_specializations():
    return render_page("Specialization.html")


@app.route("/courses")
def page_courses():
    return render_page("Courses.html")


@app.route("/quizzes")
def page_quizzes():
    return render_page("Quiz.html")


@app.route("/ats")
def page_ats():
    return render_page("ATS.html")


@app.route("/jobs")
def page_jobs():
    return render_page("jobs.html")


@app.route("/recommendation")
def page_recommendation():
    return render_page("recommendation.html")


@app.route("/profile")
def page_profile():
    return render_page("profile.html")


@app.route("/admin")
def page_admin():
    return render_page("admin.html")


@app.route("/signin")
def page_signin():
    return render_page("signin.html")


@app.route("/signup")
def page_signup():
    return render_page("signup.html")


@app.route("/<path:page>.html")
def legacy_html_pages(page):
    aliases = {
        "gp": "gp.html",
        "Specialization": "Specialization.html",
        "Sepecialization": "Specialization.html",
        "Courses": "Courses.html",
        "courses": "Courses.html",
        "Quiz": "Quiz.html",
        "ATS": "ATS.html",
        "ats": "ATS.html",
        "jobs": "jobs.html",
        "JobDetails": "JobDetails.html",
        "recommendation": "recommendation.html",
        "profile": "profile.html",
        "admin": "admin.html",
        "signin": "signin.html",
        "signup": "signup.html",
    }
    return render_page(aliases.get(page, f"{page}.html"))


@app.route("/uploads/<path:filename>")
def uploads(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

# ---------------------------------------------------------------------------
# Auth/profile APIs
# ---------------------------------------------------------------------------

@app.route("/api/health")
def health():
    return jsonify({
        "message": "SQR Backend is running",
        "features": ["auth", "admin", "specializations", "courses", "quizzes", "jobs", "profile", "progress", "ATS", "recommendation"],
        "database": DB_CONFIG.get("database"),
        "openai_enabled": bool(client),
    })


@app.route("/api/signup", methods=["POST"])
def signup():
    data = get_json()
    name = safe_text(data.get("name"))
    email = safe_text(data.get("email")).lower()
    password = safe_text(data.get("password"))
    if not name or not email or not password:
        return jsonify({"error": "Name, email, and password are required"}), 400
    if not strong_password(password):
        return jsonify({"error": "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol"}), 400
    if query_db("SELECT id FROM users WHERE email=%s", (email,), fetchone=True):
        return jsonify({"error": "Email already exists"}), 409
    hashed = generate_password_hash(password, method="pbkdf2:sha256", salt_length=16)
    payload = {"name": name, "email": email, "password": hashed, "role": "student", "current_mode": "student", "banned": 0, "is_banned": 0}
    if column_exists("users", "username"):
        payload["username"] = generate_username(name, email)
    user_id = insert_dynamic("users", payload)
    user = query_db("SELECT * FROM users WHERE id=%s", (user_id,), fetchone=True)
    return jsonify({"message": "Account created", "token": generate_token(user), "user": clean_user(user)}), 201


@app.route("/api/signin", methods=["POST"])
@app.route("/api/login", methods=["POST"])
def signin():
    data = get_json()
    email = safe_text(data.get("email")).lower()
    password = safe_text(data.get("password"))
    user = query_db("SELECT * FROM users WHERE email=%s", (email,), fetchone=True)
    if not user or not check_password_hash(user.get("password") or "", password):
        return jsonify({"error": "Invalid email or password"}), 401
    if safe_int(row_value(user, "banned", "is_banned"), 0) == 1:
        return jsonify({"error": "Your account is banned"}), 403
    return jsonify({"message": "Signed in", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/me", methods=["GET"])
@app.route("/api/profile", methods=["GET"])
@login_required
def profile_get():
    user = clean_user(request.current_user)
    return jsonify({"user": user})


@app.route("/api/profile", methods=["PUT", "PATCH"])
@login_required
def profile_update():
    data = request_data()
    user_id = row_value(request.current_user, "id", "user_id")
    allowed = {"name", "skills", "interests", "goal", "work_style"}
    payload = {k: safe_text(data.get(k)) for k in allowed if k in data}
    if payload:
        update_dynamic("users", user_id, payload, ["id", "user_id"])
    user = query_db("SELECT * FROM users WHERE id=%s", (user_id,), fetchone=True)
    return jsonify({"message": "Profile updated", "user": clean_user(user)})


@app.route("/api/mode", methods=["POST"])
@login_required
def switch_mode():
    data = get_json()
    mode = safe_text(data.get("mode")).lower()
    if mode not in ["student", "admin"]:
        return jsonify({"error": "Mode must be student or admin"}), 400
    if mode == "admin" and safe_text(request.current_user.get("role")).lower() != "admin":
        return jsonify({"error": "Admin mode requires admin role"}), 403
    update_dynamic("users", row_value(request.current_user, "id", "user_id"), {"current_mode": mode}, ["id", "user_id"])
    user = query_db("SELECT * FROM users WHERE id=%s", (row_value(request.current_user, "id", "user_id"),), fetchone=True)
    return jsonify({"message": "Mode updated", "user": clean_user(user), "token": generate_token(user)})

# ---------------------------------------------------------------------------
# Specializations
# ---------------------------------------------------------------------------

@app.route("/api/specializations", methods=["GET"])
def get_specializations():
    table = active_specializations_table()
    rows = query_db(f"SELECT * FROM `{table}` ORDER BY `{pk_col(table)}` DESC", fetchall=True) or []
    return jsonify({"specializations": [normalize_specialization(r) for r in rows]})


@app.route("/api/specializations/<int:spec_id>", methods=["GET"])
def get_specialization(spec_id):
    table = active_specializations_table()
    spec = select_by_id(table, spec_id, ["specialization_id", "id"])
    if not spec:
        return jsonify({"error": "Specialization not found"}), 404
    spec = normalize_specialization(spec)
    courses = query_db("SELECT * FROM courses WHERE specialization_id=%s OR spec_id=%s ORDER BY `{}` DESC".format(pk_col("courses")), (spec_id, spec_id), fetchall=True) or []
    jobs = query_db("SELECT * FROM jobs WHERE specialization_id=%s ORDER BY `{}` DESC".format(pk_col("jobs")), (spec_id,), fetchall=True) or []
    certs = []
    if table_exists("certifications"):
        certs += query_db("SELECT * FROM certifications WHERE specialization_id=%s ORDER BY `{}` DESC".format(pk_col("certifications")), (spec_id,), fetchall=True) or []
    if table_exists("certificates"):
        certs += query_db("SELECT * FROM certificates WHERE spec_id=%s ORDER BY `{}` DESC".format(pk_col("certificates")), (spec_id,), fetchall=True) or []
    return jsonify({
        "specialization": spec,
        "courses": [normalize_course(c) for c in courses],
        "jobs": [normalize_job(j) for j in jobs],
        "certifications": [normalize_certificate(c) for c in certs],
        "certificates": [normalize_certificate(c) for c in certs],
    })


@app.route("/api/specializations/<int:spec_id>/enroll", methods=["POST"])
@login_required
def enroll_specialization(spec_id):
    user_id = row_value(request.current_user, "id", "user_id")
    spec = select_by_id(active_specializations_table(), spec_id, ["specialization_id", "id"])
    if not spec:
        return jsonify({"error": "Specialization not found"}), 404
    try:
        insert_dynamic("specialization_enrollments", {"user_id": user_id, "specialization_id": spec_id, "progress_percentage": 0, "status": "In Progress"})
    except Exception:
        query_db("UPDATE specialization_enrollments SET status='In Progress' WHERE user_id=%s AND specialization_id=%s", (user_id, spec_id), commit=True)
    if column_exists("users", "specialization_id"):
        update_dynamic("users", user_id, {"specialization_id": spec_id}, ["id", "user_id"])
    return jsonify({"message": "Enrolled", "specialization": normalize_specialization(spec)})


@app.route("/api/specializations/<int:spec_id>/unenroll", methods=["POST", "DELETE"])
@login_required
def unenroll_specialization(spec_id):
    user_id = row_value(request.current_user, "id", "user_id")
    query_db("DELETE FROM specialization_enrollments WHERE user_id=%s AND specialization_id=%s", (user_id, spec_id), commit=True)
    return jsonify({"message": "Unenrolled"})

# ---------------------------------------------------------------------------
# Courses
# ---------------------------------------------------------------------------

@app.route("/api/courses", methods=["GET"])
def get_courses():
    search = safe_text(request.args.get("search"))
    spec_id = request.args.get("specialization_id") or request.args.get("spec_id")
    spec_table = active_specializations_table()
    spec_pk = pk_col(spec_table)
    sql = f"""
        SELECT c.*, s.name AS specialization_name
        FROM courses c
        LEFT JOIN `{spec_table}` s ON s.`{spec_pk}` = COALESCE(c.specialization_id, c.spec_id)
        WHERE 1=1
    """
    params = []
    if search:
        sql += " AND (c.title LIKE %s OR c.description LIKE %s OR c.name LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    if spec_id:
        sql += " AND (c.specialization_id=%s OR c.spec_id=%s)"
        params.extend([spec_id, spec_id])
    sql += f" ORDER BY c.`{pk_col('courses')}` DESC"
    rows = query_db(sql, params, fetchall=True) or []
    return jsonify({"courses": [normalize_course(r) for r in rows]})


@app.route("/api/courses/<int:course_id>", methods=["GET"])
@login_required
def get_course(course_id):
    course = select_by_id("courses", course_id, ["course_id", "id"])
    if not course:
        return jsonify({"error": "Course not found"}), 404
    user_id = row_value(request.current_user, "id", "user_id")
    update_course_progress(user_id, course_id, opened_increment=True)
    spec_id = row_value(course, "specialization_id", "spec_id")
    if spec_id:
        update_specialization_progress_for_user(user_id, spec_id)
    quizzes = query_db("SELECT * FROM quizzes WHERE course_id=%s ORDER BY `{}` DESC".format(pk_col("quizzes")), (course_id,), fetchall=True) or []
    return jsonify({"course": normalize_course(course), "quizzes": [normalize_quiz(q) for q in quizzes]})


@app.route("/api/courses/<int:course_id>/open", methods=["POST"])
@login_required
def open_course(course_id):
    course = select_by_id("courses", course_id, ["course_id", "id"])
    if not course:
        return jsonify({"error": "Course not found"}), 404
    user_id = row_value(request.current_user, "id", "user_id")
    update_course_progress(user_id, course_id, opened_increment=True)
    spec_id = row_value(course, "specialization_id", "spec_id")
    if spec_id:
        update_specialization_progress_for_user(user_id, spec_id)
    return jsonify({"message": "Course opened and progress tracked", "course": normalize_course(course)})


@app.route("/api/courses/<int:course_id>/unenroll", methods=["POST", "DELETE"])
@login_required
def unenroll_course(course_id):
    user_id = row_value(request.current_user, "id", "user_id")
    query_db("DELETE FROM course_enrollments WHERE user_id=%s AND course_id=%s", (user_id, course_id), commit=True)
    return jsonify({"message": "Course unenrolled"})

# ---------------------------------------------------------------------------
# Jobs/certifications
# ---------------------------------------------------------------------------

@app.route("/api/jobs", methods=["GET"])
def get_jobs():
    search = safe_text(request.args.get("search"))
    spec_id = request.args.get("specialization_id") or request.args.get("spec_id")
    spec_table = active_specializations_table()
    spec_pk = pk_col(spec_table)
    sql = f"""
        SELECT j.*, s.name AS specialization_name
        FROM jobs j
        LEFT JOIN `{spec_table}` s ON s.`{spec_pk}`=j.specialization_id
        WHERE 1=1
    """
    params = []
    if search:
        sql += " AND (j.title LIKE %s OR j.description LIKE %s OR j.required_skills LIKE %s OR j.skills LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%", f"%{search}%"])
    if spec_id:
        sql += " AND j.specialization_id=%s"
        params.append(spec_id)
    sql += f" ORDER BY j.`{pk_col('jobs')}` DESC"
    rows = query_db(sql, params, fetchall=True) or []
    return jsonify({"jobs": [normalize_job(r) for r in rows]})


@app.route("/api/jobs/<int:job_id>", methods=["GET"])
def get_job(job_id):
    job = select_by_id("jobs", job_id, ["job_id", "id"])
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({"job": normalize_job(job)})


@app.route("/api/certificates", methods=["GET"])
@app.route("/api/certifications", methods=["GET"])
def get_certificates():
    spec_id = request.args.get("specialization_id") or request.args.get("spec_id")
    rows = []
    if table_exists("certifications"):
        sql = "SELECT * FROM certifications WHERE 1=1"
        params = []
        if spec_id:
            sql += " AND specialization_id=%s"
            params.append(spec_id)
        sql += f" ORDER BY `{pk_col('certifications')}` DESC"
        rows += query_db(sql, params, fetchall=True) or []
    if table_exists("certificates"):
        sql = "SELECT * FROM certificates WHERE 1=1"
        params = []
        if spec_id:
            sql += " AND spec_id=%s"
            params.append(spec_id)
        sql += f" ORDER BY `{pk_col('certificates')}` DESC"
        rows += query_db(sql, params, fetchall=True) or []
    normalized = [normalize_certificate(r) for r in rows]
    return jsonify({"certificates": normalized, "certifications": normalized})

# ---------------------------------------------------------------------------
# Quizzes
# ---------------------------------------------------------------------------

@app.route("/api/quizzes", methods=["GET"])
def get_quizzes():
    course_id = request.args.get("course_id")
    sql = "SELECT * FROM quizzes WHERE 1=1"
    params = []
    if course_id:
        sql += " AND course_id=%s"
        params.append(course_id)
    sql += f" ORDER BY `{pk_col('quizzes')}` DESC"
    rows = query_db(sql, params, fetchall=True) or []
    return jsonify({"quizzes": [normalize_quiz(r) for r in rows]})


@app.route("/api/courses/<int:course_id>/quizzes", methods=["GET"])
def get_course_quizzes(course_id):
    rows = query_db("SELECT * FROM quizzes WHERE course_id=%s ORDER BY `{}` DESC".format(pk_col("quizzes")), (course_id,), fetchall=True) or []
    return jsonify({"quizzes": [normalize_quiz(r) for r in rows]})


@app.route("/api/quizzes/<int:quiz_id>", methods=["GET"])
def get_quiz(quiz_id):
    quiz = select_by_id("quizzes", quiz_id, ["quiz_id", "id"])
    if not quiz:
        return jsonify({"error": "Quiz not found"}), 404
    questions = query_db("SELECT * FROM quiz_questions WHERE quiz_id=%s ORDER BY `{}` ASC".format(pk_col("quiz_questions")), (quiz_id,), fetchall=True) or []
    return jsonify({"quiz": normalize_quiz(quiz), "questions": [normalize_question(q) for q in questions]})


@app.route("/api/quizzes/<int:quiz_id>/submit", methods=["POST"])
@login_required
def submit_quiz(quiz_id):
    data = get_json()
    answers = data.get("answers") or {}
    if isinstance(answers, list):
        answers = {str(item.get("question_id") or item.get("id")): item.get("answer") for item in answers if isinstance(item, dict)}
    quiz = select_by_id("quizzes", quiz_id, ["quiz_id", "id"])
    if not quiz:
        return jsonify({"error": "Quiz not found"}), 404
    questions = query_db("SELECT * FROM quiz_questions WHERE quiz_id=%s", (quiz_id,), fetchall=True) or []
    total = len(questions)
    correct = 0
    details = []
    for q in questions:
        qid = str(row_value(q, "question_id", "id"))
        expected = safe_text(row_value(q, "correct_answer", "answer", "correct_option")).upper()
        given = safe_text(answers.get(qid) or answers.get(str(q.get("question"))) or "").upper()
        expected = {"1": "A", "2": "B", "3": "C", "4": "D"}.get(expected, expected[:1])
        given = {"1": "A", "2": "B", "3": "C", "4": "D"}.get(given, given[:1])
        ok = bool(expected and given and expected == given)
        if ok:
            correct += 1
        details.append({"question_id": qid, "correct": ok, "expected": expected, "given": given})
    score = round((correct / max(total, 1)) * 100, 2)
    passing_score = safe_int(row_value(quiz, "passing_score"), 60)
    passed = score >= passing_score
    user_id = row_value(request.current_user, "id", "user_id")
    insert_dynamic("quiz_attempts", {"user_id": user_id, "quiz_id": quiz_id, "score": score, "passed": 1 if passed else 0, "answers_json": json.dumps(details)})
    course_id = row_value(quiz, "course_id")
    if course_id and passed:
        update_course_progress(user_id, course_id, progress=100, status="Completed")
        course = select_by_id("courses", course_id, ["course_id", "id"])
        spec_id = row_value(course or {}, "specialization_id", "spec_id")
        if spec_id:
            update_specialization_progress_for_user(user_id, spec_id)
    return jsonify({"score": score, "correct": correct, "total": total, "passed": passed, "details": details})

# ---------------------------------------------------------------------------
# Recommendation APIs
# ---------------------------------------------------------------------------

@app.route("/api/recommendations", methods=["POST"])
@app.route("/api/recommendations/analyze", methods=["POST"])
@login_required
def recommendations_analyze():
    data = request_data()
    user = request.current_user
    text = " ".join([
        safe_text(data.get("interests")),
        safe_text(data.get("skills")),
        safe_text(data.get("work_style")),
        safe_text(data.get("goal")),
        safe_text(data.get("answers")),
        profile_text_for_user(user),
    ])
    specs = recommend_specializations_from_text(text, 8)
    jobs = recommend_jobs_from_text(text, 8)
    fallback = {
        "specializations": specs,
        "jobs": jobs,
        "top_specialization": specs[0] if specs else None,
        "top_jobs": jobs[:3],
        "summary": "Recommendation generated from your quiz/profile answers and matched separately for specializations and jobs.",
    }
    prompt = f"""
You are a CS career advisor for the SQR platform.
Use the user's interests, skills, work style, and quiz answers to recommend CS specializations and jobs separately.
Do not mix job recommendation with specialization recommendation.
Do not invent unavailable specializations or jobs; select from the provided JSON lists only.

USER PROFILE TEXT:
{text}

CANDIDATE SPECIALIZATIONS:
{json.dumps(specs, ensure_ascii=False)[:6000]}

CANDIDATE JOBS:
{json.dumps(jobs, ensure_ascii=False)[:6000]}

Return JSON only:
{{
  "summary":"short personalized recommendation summary",
  "specializations":[{{"id":1,"name":"...","match_score":90,"why":"...","next_steps":["..."]}}],
  "jobs":[{{"id":1,"title":"...","match_score":85,"why":"...","skills_to_build":["..."]}}],
  "top_specialization":{{"id":1,"name":"...","match_score":90}},
  "top_jobs":[{{"id":1,"title":"...","match_score":85}}]
}}
"""
    result = ai_json(prompt, fallback=fallback, temperature=0.25, max_tokens=1600)
    user_id = row_value(user, "id", "user_id")
    try:
        insert_dynamic("recommendation_results", {"user_id": user_id, "recommendation_json": json.dumps(result, ensure_ascii=False)})
    except Exception:
        pass
    return jsonify(result)


@app.route("/api/recommendations/preview", methods=["POST"])
@login_required
def recommendations_preview():
    data = request_data()
    text = " ".join([safe_text(data.get("interests")), safe_text(data.get("skills")), safe_text(data.get("work_style")), safe_text(data.get("goal")), profile_text_for_user(request.current_user)])
    return jsonify({"specializations": recommend_specializations_from_text(text, 8), "jobs": recommend_jobs_from_text(text, 8)})


@app.route("/api/job-recommendations", methods=["GET", "POST"])
@login_required
def job_recommendations():
    data = request_data() if request.method == "POST" else {}
    text = " ".join([safe_text(data.get("skills")), safe_text(data.get("interests")), safe_text(data.get("goal")), profile_text_for_user(request.current_user)])
    return jsonify({"jobs": recommend_jobs_from_text(text, 10)})

# ---------------------------------------------------------------------------
# ATS APIs
# ---------------------------------------------------------------------------

@app.route("/api/ats/check", methods=["POST"])
@login_required
def ats_check():
    file = request.files.get("resume") or request.files.get("resume_file") or request.files.get("file")
    job_description = safe_text(request.form.get("job_description") or request.form.get("description") or request.form.get("target_description") or request.args.get("job_description"))
    if not file or not file.filename:
        return jsonify({"error": "Upload a PDF, DOCX, or TXT resume file"}), 400
    if not file.filename.lower().endswith((".pdf", ".docx", ".txt")):
        return jsonify({"error": "Only PDF, DOCX, or TXT resumes are supported"}), 400
    resume_text = extract_resume_text(file)
    if not safe_text(resume_text):
        return jsonify({"error": "Could not read text from the resume. Use a text-based PDF, DOCX, or TXT file."}), 400
    result = smart_ats_score(resume_text, job_description, client, OPENAI_MODEL)
    user_id = row_value(request.current_user, "id", "user_id")
    try:
        insert_dynamic("ats_results", {
            "user_id": user_id,
            "resume_text": resume_text[:20000],
            "target_job": safe_text(request.form.get("target_job") or request.form.get("job_title")),
            "job_description": job_description,
            "ats_score": result.get("ats_score"),
            "grade": result.get("grade"),
            "matched_keywords": ", ".join(result.get("matched_keywords", [])),
            "missing_keywords": ", ".join(result.get("missing_keywords", [])),
            "suggestions": json.dumps(result.get("improvements", []), ensure_ascii=False),
            "result_json": json.dumps(result, ensure_ascii=False),
        })
    except Exception as exc:
        print("ATS result save skipped:", exc)
    return jsonify(result)


def build_resume_text_from_data(data, enhanced_summary):
    name = safe_text(data.get("name"))
    email = safe_text(data.get("email"))
    phone = safe_text(data.get("phone"))
    location = safe_text(data.get("location"))
    linkedin = safe_text(data.get("linkedin"))
    github = safe_text(data.get("github"))
    target_job = safe_text(data.get("target_job") or data.get("job_title"))
    skills = safe_text(data.get("skills"))
    soft_skills = safe_text(data.get("soft_skills"))
    education = safe_text(data.get("education"))
    experience = safe_text(data.get("experience"))
    projects = safe_text(data.get("projects"))
    certifications = safe_text(data.get("certifications"))
    parts = []
    if name:
        parts.append(name.upper())
    contact = " | ".join([x for x in [email, phone, location, linkedin, github] if x])
    if contact:
        parts.append(contact)
    if target_job:
        parts.append(f"\nTARGET ROLE\n{target_job}")
    parts.append(f"\nPROFESSIONAL SUMMARY\n{enhanced_summary}")
    if skills:
        parts.append(f"\nTECHNICAL SKILLS\n{skills}")
    if soft_skills:
        parts.append(f"\nSOFT SKILLS\n{soft_skills}")
    if experience:
        parts.append(f"\nEXPERIENCE\n{experience}")
    if projects:
        parts.append(f"\nPROJECTS\n{projects}")
    if education:
        parts.append(f"\nEDUCATION\n{education}")
    if certifications:
        parts.append(f"\nCERTIFICATIONS\n{certifications}")
    return "\n".join(parts).strip()


@app.route("/api/ats/generate", methods=["POST"])
@login_required
def ats_generate():
    data = request_data()
    required = ["name", "email", "target_job", "skills"]
    missing = [field for field in required if not safe_text(data.get(field))]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400
    name = safe_text(data.get("name"))
    target_job = safe_text(data.get("target_job") or data.get("job_title"))
    skills = safe_text(data.get("skills"))
    summary = safe_text(data.get("summary"))
    enhanced_summary = ai_improve_summary(summary, target_job, skills, name)
    resume_text = build_resume_text_from_data(data, enhanced_summary)
    score = smart_ats_score(resume_text, safe_text(data.get("job_description")), client, OPENAI_MODEL)
    payload = {
        "message": "Resume generated",
        "enhanced_summary": enhanced_summary,
        "summary": enhanced_summary,
        "resume_text": resume_text,
        "generated_resume": resume_text,
        "ats_analysis": score,
        "ats_score": score.get("ats_score"),
        "engine": "openai" if client else "local_v2",
    }
    return jsonify(payload)


@app.route("/api/ats/history", methods=["GET"])
@login_required
def ats_history():
    user_id = row_value(request.current_user, "id", "user_id")
    rows = query_db("SELECT * FROM ats_results WHERE user_id=%s ORDER BY `{}` DESC LIMIT 20".format(pk_col("ats_results")), (user_id,), fetchall=True) or []
    return jsonify({"history": rows})


def resume_to_pdf_bytes(text):
    if not SimpleDocTemplate:
        return None
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=42, leftMargin=42, topMargin=42, bottomMargin=42)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("SQRTitle", parent=styles["Title"], alignment=TA_CENTER, fontSize=18, leading=22, spaceAfter=12)
    body_style = ParagraphStyle("SQRBody", parent=styles["BodyText"], fontSize=10.5, leading=14, spaceAfter=7)
    story = []
    lines = safe_text(text).splitlines()
    if lines:
        story.append(Paragraph(lines[0], title_style))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#334155")))
        story.append(Spacer(1, 8))
        body = "<br/>".join([re.sub(r"&(?!amp;)", "&amp;", line) for line in lines[1:]])
        story.append(Paragraph(body or " ", body_style))
    doc.build(story)
    buffer.seek(0)
    return buffer


@app.route("/api/ats/export/pdf", methods=["POST"])
@login_required
def ats_export_pdf():
    data = get_json()
    text = safe_text(data.get("resume_text") or data.get("generated_resume"))
    if not text:
        return jsonify({"error": "resume_text is required"}), 400
    pdf = resume_to_pdf_bytes(text)
    if not pdf:
        return jsonify({"error": "PDF export requires reportlab"}), 500
    return send_file(pdf, mimetype="application/pdf", as_attachment=True, download_name="SQR_ATS_Resume.pdf")


@app.route("/api/ats/export/docx", methods=["POST"])
@login_required
def ats_export_docx():
    if not Document:
        return jsonify({"error": "DOCX export requires python-docx"}), 500
    data = get_json()
    text = safe_text(data.get("resume_text") or data.get("generated_resume"))
    if not text:
        return jsonify({"error": "resume_text is required"}), 400
    doc = Document()
    lines = text.splitlines()
    if lines:
        doc.add_heading(lines[0], 0)
        for line in lines[1:]:
            if line.strip().isupper() and len(line.strip()) < 40:
                doc.add_heading(line.strip(), level=1)
            elif line.strip():
                doc.add_paragraph(line.strip())
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return send_file(buffer, mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document", as_attachment=True, download_name="SQR_ATS_Resume.docx")

# ---------------------------------------------------------------------------
# Admin APIs
# ---------------------------------------------------------------------------

@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_stats():
    return jsonify(public_stats())


@app.route("/api/admin/dashboard/advanced", methods=["GET"])
@admin_required
def admin_dashboard_advanced():
    tables = ["users", active_specializations_table(), "courses", "quizzes", "quiz_questions", "jobs", "certificates", "certifications", "ats_results", "course_enrollments", "quiz_attempts"]
    return jsonify({
        "stats": public_stats(),
        "tables": {name: table_columns(name) for name in tables if table_exists(name)},
        "recent": {
            "specializations": (query_db(f"SELECT * FROM `{active_specializations_table()}` ORDER BY `{pk_col(active_specializations_table())}` DESC LIMIT 5", fetchall=True) or []),
            "courses": (query_db(f"SELECT * FROM courses ORDER BY `{pk_col('courses')}` DESC LIMIT 5", fetchall=True) or []),
            "jobs": (query_db(f"SELECT * FROM jobs ORDER BY `{pk_col('jobs')}` DESC LIMIT 5", fetchall=True) or []),
            "quizzes": (query_db(f"SELECT * FROM quizzes ORDER BY `{pk_col('quizzes')}` DESC LIMIT 5", fetchall=True) or []),
        },
    })


@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_users():
    rows = query_db("SELECT * FROM users ORDER BY id DESC", fetchall=True) or []
    return jsonify({"users": [clean_user(r) for r in rows]})


@app.route("/api/admin/users/<int:user_id>/ban", methods=["POST", "PUT"])
@admin_required
def admin_ban_user(user_id):
    payload = {"banned": 1, "is_banned": 1}
    update_dynamic("users", user_id, payload, ["id", "user_id"])
    return jsonify({"message": "User banned"})


@app.route("/api/admin/users/<int:user_id>/unban", methods=["POST", "PUT"])
@admin_required
def admin_unban_user(user_id):
    payload = {"banned": 0, "is_banned": 0}
    update_dynamic("users", user_id, payload, ["id", "user_id"])
    return jsonify({"message": "User unbanned"})


@app.route("/api/admin/users/<int:user_id>/role", methods=["PUT", "POST"])
@admin_required
def admin_update_user_role(user_id):
    data = get_json()
    role = safe_text(data.get("role", "student")).lower()
    if role not in ["student", "admin"]:
        return jsonify({"error": "Role must be student or admin"}), 400
    update_dynamic("users", user_id, {"role": role, "current_mode": role}, ["id", "user_id"])
    if role == "admin":
        try:
            insert_dynamic("admins", {"user_id": user_id, "admin_level": safe_text(data.get("admin_level")) or "manager"})
        except Exception:
            pass
    return jsonify({"message": "Role updated"})


@app.route("/api/admin/specializations", methods=["POST"])
@admin_required
def admin_add_specialization():
    data = request_data()
    filename = save_file("image") or save_file("image_file")
    table = active_specializations_table()
    payload = {
        "name": safe_text(data.get("name") or data.get("title")),
        "title": safe_text(data.get("title") or data.get("name")),
        "description": safe_text(data.get("description")),
        "roadmap": safe_text(data.get("roadmap")),
        "job_titles": safe_text(data.get("job_titles")),
        "career_paths": safe_text(data.get("career_paths")),
        "skills": safe_text(data.get("skills")),
        "image": filename or safe_text(data.get("image")),
        "image_url": filename or safe_text(data.get("image_url")),
    }
    if not payload["name"]:
        return jsonify({"error": "Specialization name is required"}), 400
    new_id = insert_dynamic(table, payload)
    return jsonify({"message": "Specialization added", "id": new_id}), 201


@app.route("/api/admin/specializations/<int:spec_id>", methods=["PUT", "PATCH"])
@admin_required
def admin_update_specialization(spec_id):
    data = request_data()
    filename = save_file("image") or save_file("image_file")
    table = active_specializations_table()
    payload = {
        "name": safe_text(data.get("name")) if "name" in data else None,
        "title": safe_text(data.get("title")) if "title" in data else None,
        "description": safe_text(data.get("description")) if "description" in data else None,
        "roadmap": safe_text(data.get("roadmap")) if "roadmap" in data else None,
        "job_titles": safe_text(data.get("job_titles")) if "job_titles" in data else None,
        "career_paths": safe_text(data.get("career_paths")) if "career_paths" in data else None,
        "skills": safe_text(data.get("skills")) if "skills" in data else None,
        "image": filename or (safe_text(data.get("image")) if "image" in data else None),
        "image_url": filename or (safe_text(data.get("image_url")) if "image_url" in data else None),
    }
    update_dynamic(table, spec_id, payload, ["specialization_id", "id"])
    return jsonify({"message": "Specialization updated"})


@app.route("/api/admin/specializations/<int:spec_id>", methods=["DELETE"])
@admin_required
def admin_delete_specialization(spec_id):
    delete_by_id(active_specializations_table(), spec_id, ["specialization_id", "id"])
    return jsonify({"message": "Specialization deleted"})


@app.route("/api/admin/courses", methods=["POST"])
@admin_required
def admin_add_course():
    data = request_data()
    img = save_file("image") or save_file("image_file")
    vid = save_file("video") or save_file("video_file")
    spec_id = safe_int(data.get("specialization_id") or data.get("spec_id"))
    title = safe_text(data.get("title") or data.get("name"))
    if not spec_id or not title:
        return jsonify({"error": "specialization_id and title are required"}), 400
    level = normalize_level(data.get("level") or data.get("difficulty"))
    payload = {
        "specialization_id": spec_id,
        "spec_id": spec_id,
        "title": title,
        "name": title,
        "description": safe_text(data.get("description")),
        "level": level.title(),
        "difficulty": level,
        "link": safe_text(data.get("link") or data.get("course_link")),
        "course_link": safe_text(data.get("course_link") or data.get("link")),
        "image": img or safe_text(data.get("image")),
        "image_url": img or safe_text(data.get("image_url")),
        "video": vid or safe_text(data.get("video")),
        "video_url": vid or safe_text(data.get("video_url")),
        "content": safe_text(data.get("content")),
    }
    course_id = insert_dynamic("courses", payload)
    return jsonify({"message": "Course added", "id": course_id}), 201


@app.route("/api/admin/courses/<int:course_id>", methods=["PUT", "PATCH"])
@admin_required
def admin_update_course(course_id):
    data = request_data()
    img = save_file("image") or save_file("image_file")
    vid = save_file("video") or save_file("video_file")
    spec_id = safe_int(data.get("specialization_id") or data.get("spec_id"), None)
    level = normalize_level(data.get("level") or data.get("difficulty")) if ("level" in data or "difficulty" in data) else None
    payload = {
        "specialization_id": spec_id,
        "spec_id": spec_id,
        "title": safe_text(data.get("title")) if "title" in data else None,
        "name": safe_text(data.get("name")) if "name" in data else None,
        "description": safe_text(data.get("description")) if "description" in data else None,
        "level": level.title() if level else None,
        "difficulty": level,
        "link": safe_text(data.get("link")) if "link" in data else None,
        "course_link": safe_text(data.get("course_link")) if "course_link" in data else None,
        "image": img or (safe_text(data.get("image")) if "image" in data else None),
        "image_url": img or (safe_text(data.get("image_url")) if "image_url" in data else None),
        "video": vid or (safe_text(data.get("video")) if "video" in data else None),
        "video_url": vid or (safe_text(data.get("video_url")) if "video_url" in data else None),
        "content": safe_text(data.get("content")) if "content" in data else None,
    }
    update_dynamic("courses", course_id, payload, ["course_id", "id"])
    return jsonify({"message": "Course updated"})


@app.route("/api/admin/courses/<int:course_id>", methods=["DELETE"])
@admin_required
def admin_delete_course(course_id):
    delete_by_id("courses", course_id, ["course_id", "id"])
    return jsonify({"message": "Course deleted"})


@app.route("/api/admin/jobs", methods=["POST"])
@admin_required
def admin_add_job():
    data = request_data()
    spec_id = safe_int(data.get("specialization_id") or data.get("spec_id"))
    title = safe_text(data.get("title"))
    if not spec_id or not title:
        return jsonify({"error": "specialization_id and title are required"}), 400
    payload = {
        "specialization_id": spec_id,
        "title": title,
        "description": safe_text(data.get("description")),
        "required_skills": safe_text(data.get("required_skills") or data.get("skills")),
        "skills": safe_text(data.get("skills") or data.get("required_skills")),
        "average_salary": safe_text(data.get("average_salary") or data.get("salary")),
        "salary": safe_text(data.get("salary") or data.get("average_salary")),
        "job_link": safe_text(data.get("job_link") or data.get("link")),
        "link": safe_text(data.get("link") or data.get("job_link")),
    }
    job_id = insert_dynamic("jobs", payload)
    return jsonify({"message": "Job added", "id": job_id}), 201


@app.route("/api/admin/jobs/<int:job_id>", methods=["PUT", "PATCH"])
@admin_required
def admin_update_job(job_id):
    data = request_data()
    payload = {
        "specialization_id": safe_int(data.get("specialization_id") or data.get("spec_id"), None) if ("specialization_id" in data or "spec_id" in data) else None,
        "title": safe_text(data.get("title")) if "title" in data else None,
        "description": safe_text(data.get("description")) if "description" in data else None,
        "required_skills": safe_text(data.get("required_skills") or data.get("skills")) if ("required_skills" in data or "skills" in data) else None,
        "skills": safe_text(data.get("skills") or data.get("required_skills")) if ("required_skills" in data or "skills" in data) else None,
        "average_salary": safe_text(data.get("average_salary") or data.get("salary")) if ("average_salary" in data or "salary" in data) else None,
        "salary": safe_text(data.get("salary") or data.get("average_salary")) if ("average_salary" in data or "salary" in data) else None,
        "job_link": safe_text(data.get("job_link") or data.get("link")) if ("job_link" in data or "link" in data) else None,
        "link": safe_text(data.get("link") or data.get("job_link")) if ("job_link" in data or "link" in data) else None,
    }
    update_dynamic("jobs", job_id, payload, ["job_id", "id"])
    return jsonify({"message": "Job updated"})


@app.route("/api/admin/jobs/<int:job_id>", methods=["DELETE"])
@admin_required
def admin_delete_job(job_id):
    delete_by_id("jobs", job_id, ["job_id", "id"])
    return jsonify({"message": "Job deleted"})


@app.route("/api/admin/certificates", methods=["POST"])
@app.route("/api/admin/certifications", methods=["POST"])
@admin_required
def admin_add_certificate():
    data = request_data()
    spec_id = safe_int(data.get("specialization_id") or data.get("spec_id"))
    name = safe_text(data.get("name") or data.get("title"))
    if not spec_id or not name:
        return jsonify({"error": "specialization_id and name are required"}), 400
    table = "certifications" if table_exists("certifications") else "certificates"
    payload = {
        "specialization_id": spec_id,
        "spec_id": spec_id,
        "name": name,
        "description": safe_text(data.get("description")),
        "official_link": safe_text(data.get("official_link") or data.get("link")),
        "link": safe_text(data.get("link") or data.get("official_link")),
        "price": safe_text(data.get("price")),
        "type": safe_text(data.get("type")) or "Both",
    }
    cert_id = insert_dynamic(table, payload)
    return jsonify({"message": "Certificate added", "id": cert_id}), 201


@app.route("/api/admin/quizzes", methods=["POST"])
@admin_required
def admin_add_quiz():
    data = request_data()
    course_id = safe_int(data.get("course_id"))
    title = safe_text(data.get("title") or data.get("name"))
    if not course_id or not title:
        return jsonify({"error": "course_id and title are required"}), 400
    quiz_id = insert_dynamic("quizzes", {"course_id": course_id, "title": title, "name": title, "description": safe_text(data.get("description")), "passing_score": safe_int(data.get("passing_score"), 60)})
    questions = data.get("questions") or []
    if isinstance(questions, str):
        try:
            questions = json.loads(questions)
        except Exception:
            questions = []
    added = 0
    for q in questions:
        if not isinstance(q, dict):
            continue
        add_question_payload(quiz_id, q)
        added += 1
    if added:
        update_dynamic("quizzes", quiz_id, {"total_questions": added}, ["quiz_id", "id"])
    return jsonify({"message": "Quiz added", "id": quiz_id, "questions_added": added}), 201


def add_question_payload(quiz_id, q):
    correct = safe_text(q.get("correct_answer") or q.get("answer") or q.get("correct_option")).upper()
    correct = {"1": "A", "2": "B", "3": "C", "4": "D"}.get(correct, correct[:1] or "A")
    payload = {
        "quiz_id": quiz_id,
        "question_text": safe_text(q.get("question_text") or q.get("question")),
        "question": safe_text(q.get("question") or q.get("question_text")),
        "option_a": safe_text(q.get("option_a") or q.get("option1") or q.get("a")),
        "option_b": safe_text(q.get("option_b") or q.get("option2") or q.get("b")),
        "option_c": safe_text(q.get("option_c") or q.get("option3") or q.get("c")),
        "option_d": safe_text(q.get("option_d") or q.get("option4") or q.get("d")),
        "option1": safe_text(q.get("option1") or q.get("option_a") or q.get("a")),
        "option2": safe_text(q.get("option2") or q.get("option_b") or q.get("b")),
        "option3": safe_text(q.get("option3") or q.get("option_c") or q.get("c")),
        "option4": safe_text(q.get("option4") or q.get("option_d") or q.get("d")),
        "correct_answer": correct,
        "answer": correct,
    }
    return insert_dynamic("quiz_questions", payload)


@app.route("/api/admin/quizzes/<int:quiz_id>/questions", methods=["POST"])
@admin_required
def admin_add_quiz_question(quiz_id):
    data = get_json()
    qid = add_question_payload(quiz_id, data)
    return jsonify({"message": "Question added", "id": qid}), 201


@app.route("/api/admin/quizzes/<int:quiz_id>", methods=["DELETE"])
@admin_required
def admin_delete_quiz(quiz_id):
    query_db("DELETE FROM quiz_questions WHERE quiz_id=%s", (quiz_id,), commit=True)
    delete_by_id("quizzes", quiz_id, ["quiz_id", "id"])
    return jsonify({"message": "Quiz deleted"})

# ---------------------------------------------------------------------------
# View models/static helper APIs
# ---------------------------------------------------------------------------

@app.route("/api/schema/check", methods=["GET"])
def schema_check():
    tables = ["users", "admins", active_specializations_table(), "courses", "quizzes", "quiz_questions", "jobs", "certificates", "certifications", "course_enrollments", "quiz_attempts", "ats_results", "recommendations"]
    return jsonify({
        "database": DB_CONFIG.get("database"),
        "connected": bool(pool),
        "tables": [{"name": table, "exists": table_exists(table), "columns": table_columns(table)} for table in tables],
    })


@app.route("/api/static/page-blueprint/<page_name>", methods=["GET"])
def page_blueprint(page_name):
    key = safe_text(page_name).replace(".html", "").lower()
    return jsonify({"page": key, "dynamic_targets": SQR_PAGE_BLUEPRINTS.get(key, []), "theme": SQR_COLOR_THEME_TOKENS})


@app.route("/api/static/dynamic-containers", methods=["GET"])
def dynamic_containers():
    page = safe_text(request.args.get("page")).replace(".html", "").lower()
    rows = []
    for p, targets in SQR_PAGE_BLUEPRINTS.items():
        for i, target in enumerate(targets, 1):
            if not page or page == p:
                rows.append({"page": p, "target": target, "priority": i, "purpose": f"Dynamic container {target} on {p} page"})
    return jsonify({"containers": rows, "count": len(rows)})


@app.route("/api/runtime/report", methods=["GET"])
def runtime_report():
    return jsonify({
        "python_file": "sqr.py",
        "db_host_set": bool(DB_CONFIG.get("host")),
        "db_name_set": bool(DB_CONFIG.get("database")),
        "openai_enabled": bool(client),
        "upload_folder": app.config.get("UPLOAD_FOLDER"),
        "public_stats": public_stats(),
        "page_targets": SQR_PAGE_BLUEPRINTS,
    })


@app.route("/api/view-model/home", methods=["GET"])
def view_model_home():
    return jsonify({"page": "home", "title": "Skill Quest Road", "counts": public_stats(), "sections": SQR_PAGE_BLUEPRINTS.get("home", []), "colors": SQR_COLOR_THEME_TOKENS})


@app.route("/api/view-model/profile", methods=["GET"])
@login_required
def view_model_profile():
    user = clean_user(request.current_user)
    user_id = row_value(request.current_user, "id", "user_id")
    enrollments = query_db("SELECT * FROM course_enrollments WHERE user_id=%s", (user_id,), fetchall=True) or []
    attempts = query_db("SELECT * FROM quiz_attempts WHERE user_id=%s ORDER BY `{}` DESC LIMIT 20".format(pk_col("quiz_attempts")), (user_id,), fetchall=True) or []
    ats = query_db("SELECT * FROM ats_results WHERE user_id=%s ORDER BY `{}` DESC LIMIT 10".format(pk_col("ats_results")), (user_id,), fetchall=True) or []
    filled = sum(1 for field in ["name", "email", "skills", "interests", "goal"] if safe_text(request.current_user.get(field)))
    return jsonify({
        "page": "profile",
        "user": user,
        "activity": {"course_enrollments": enrollments, "quiz_attempts": attempts, "ats_history": ats},
        "completeness": round((filled / 5) * 100),
        "sections": SQR_PAGE_BLUEPRINTS.get("profile", []),
    })

# ---------------------------------------------------------------------------
# Error handlers and startup
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Endpoint not found"}), 404
    try:
        return render_template("gp.html"), 404
    except Exception:
        return jsonify({"error": "Page not found"}), 404


@app.errorhandler(413)
def too_large(error):
    return jsonify({"error": "File is too large"}), 413


@app.errorhandler(500)
def server_error(error):
    return jsonify({"error": "Server error", "details": str(error)}), 500


try:
    init_db()
    print("SQR database checked")
except Exception as exc:
    print("init_db skipped or failed:", exc)


if __name__ == "__main__":
    app.run(
        host=os.getenv("FLASK_HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", os.getenv("FLASK_PORT", 5000))),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
