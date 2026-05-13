import os
import json
import re
import datetime
import base64
import hashlib
from io import BytesIO
from functools import wraps

import jwt
import mysql.connector
from mysql.connector import pooling
from flask import Flask, request, jsonify, send_from_directory, send_file, render_template, redirect
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from cryptography.fernet import Fernet

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    import PyPDF2
except Exception:
    PyPDF2 = None

try:
    from docx import Document
except Exception:
    Document = None

try:
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
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
    TA_LEFT = None
    colors = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(BASE_DIR, os.getenv("UPLOAD_FOLDER", "uploads"))

app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)
CORS(app, resources={r"/api/*": {"origins": os.getenv("CORS_ORIGINS", "*").split(",")}})

app.config["SECRET_KEY"] = os.getenv("SQR_SECRET_KEY") or os.getenv("SECRET_KEY") or "CHANGE_THIS_SECRET_KEY_BEFORE_DEPLOYMENT"
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_CONTENT_LENGTH", 50 * 1024 * 1024))
app.config["UPLOAD_FOLDER"] = UPLOAD_DIR
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

AES_SECRET = os.getenv("AES_SECRET_KEY", "CHANGE_THIS_AES_SECRET_KEY_32_CHARS")

def get_aes_key():
    return base64.urlsafe_b64encode(hashlib.sha256(AES_SECRET.encode()).digest())

cipher = Fernet(get_aes_key())

def encrypt_text(value):
    if not value:
        return ""
    return cipher.encrypt(str(value).encode()).decode()

def decrypt_text(value):
    if not value:
        return ""
    try:
        return cipher.decrypt(str(value).encode()).decode()
    except Exception:
        return value

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "").strip(),
    "port": int(os.getenv("DB_PORT", "3306").strip() or "3306"),
    "user": os.getenv("DB_USER", "").strip(),
    "password": os.getenv("DB_PASSWORD", "").strip(),
    "database": os.getenv("DB_NAME", "").strip(),
    "connection_timeout": int(os.getenv("DB_TIMEOUT", "10")),
    "autocommit": True,
}

pool = None

try:
    if DB_CONFIG["host"] and DB_CONFIG["user"] and DB_CONFIG["database"]:
        pool = pooling.MySQLConnectionPool(
            pool_name="sqr_pool",
            pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
            **DB_CONFIG
        )
        print("Database connected")
    else:
        print("Database connection skipped: DB_HOST, DB_USER, or DB_NAME missing")
except Exception as e:
    print("Database connection failed:", e)
    pool = None

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) if OpenAI and os.getenv("OPENAI_API_KEY") else None
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

TECH_SKILLS = [
    "python", "java", "javascript", "typescript", "html", "css", "sql", "mysql", "postgresql",
    "react", "node", "flask", "django", "api", "rest", "git", "github", "docker", "aws", "azure",
    "linux", "security", "cybersecurity", "networking", "forensics", "wireshark", "burp suite",
    "database", "machine learning", "data analysis", "communication", "teamwork", "problem solving",
    "cloud", "devops", "kubernetes", "mongodb", "php", "c++", "go", "rust", "swift"
]

COURSE_LEVEL_META = {
    "beginner": {"label": "Beginner", "color": "green", "class": "level-beginner", "hex": "#22c55e"},
    "intermediate": {"label": "Intermediate", "color": "yellow", "class": "level-intermediate", "hex": "#eab308"},
    "advanced": {"label": "Advanced", "color": "red", "class": "level-advanced", "hex": "#ef4444"},
}

CS_SPECIALIZATION_BANK = [
    "Artificial Intelligence", "Machine Learning", "Data Science", "Data Engineering", "Cybersecurity",
    "Digital Forensics", "Software Engineering", "Web Development", "Mobile App Development",
    "Cloud Computing", "DevOps", "Database Administration", "Computer Networks", "Game Development",
    "UI/UX Engineering", "Blockchain Development", "Internet of Things", "Robotics", "Computer Vision",
    "Natural Language Processing"
]


def get_db():
    global pool
    if pool is None:
        pool = pooling.MySQLConnectionPool(
            pool_name="sqr_pool",
            pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
            **DB_CONFIG
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


def table_exists(table_name):
    try:
        row = query_db(
            """
            SELECT COUNT(*) AS total
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s
            """,
            (DB_CONFIG["database"], table_name),
            fetchone=True
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
            fetchone=True
        )
        return bool(row and row.get("total"))
    except Exception:
        return False


def add_column_if_missing(table_name, column_name, column_sql):
    if table_exists(table_name) and not column_exists(table_name, column_name):
        exec_db(f"ALTER TABLE `{table_name}` ADD COLUMN {column_sql}")


def first_existing_column(table_name, names):
    for name in names:
        if column_exists(table_name, name):
            return name
    return names[0]


def db_primary(table_name):
    mapping = {
        "users": ["id", "user_id"],
        "specializations": ["id", "specialization_id"],
        "courses": ["id", "course_id"],
        "certificates": ["id", "certificate_id"],
        "quizzes": ["id", "quiz_id"],
        "quiz_questions": ["id", "question_id"],
        "jobs": ["id", "job_id"],
        "ats_results": ["id", "ats_id"],
        "assessments": ["id", "assessment_id"],
        "assessment_answers": ["id", "answer_id"],
        "specialization_recommendations": ["id", "recommendation_id"],
        "job_recommendations": ["id", "recommendation_id"],
    }
    for col in mapping.get(table_name, ["id"]):
        if column_exists(table_name, col):
            return col
    return mapping.get(table_name, ["id"])[0]


def user_pk_col():
    return db_primary("users")


def spec_pk_col():
    return first_existing_column("specializations", ["id", "specialization_id"])


def spec_image_col():
    return first_existing_column("specializations", ["image", "image_url"])


def course_pk_col():
    return first_existing_column("courses", ["id", "course_id"])


def course_spec_col():
    return first_existing_column("courses", ["spec_id", "specialization_id"])


def course_link_col():
    return first_existing_column("courses", ["link", "course_link"])


def course_image_col():
    return first_existing_column("courses", ["image", "image_url"])


def course_video_col():
    return first_existing_column("courses", ["video", "video_url"])


def quiz_pk_col():
    return first_existing_column("quizzes", ["id", "quiz_id"])


def question_pk_col():
    return first_existing_column("quiz_questions", ["id", "question_id"])


def question_text_col():
    return first_existing_column("quiz_questions", ["question", "question_text"])


def question_option_col(letter):
    choices = {
        "a": ["option1", "option_a"],
        "b": ["option2", "option_b"],
        "c": ["option3", "option_c"],
        "d": ["option4", "option_d"],
    }
    return first_existing_column("quiz_questions", choices[letter])


def question_answer_col():
    return first_existing_column("quiz_questions", ["answer", "correct_answer"])


def row_value(row, *names):
    for name in names:
        if isinstance(row, dict) and name in row:
            return row.get(name)
    return None


def insert_dynamic(table_name, values):
    columns = []
    params = []
    for key, value in values.items():
        if value is not None and column_exists(table_name, key):
            columns.append(key)
            params.append(value)
    if not columns:
        raise ValueError(f"No matching columns for insert into {table_name}")
    placeholders = ",".join(["%s"] * len(columns))
    column_sql = ",".join(f"`{column}`" for column in columns)
    return query_db(f"INSERT INTO `{table_name}` ({column_sql}) VALUES ({placeholders})", tuple(params), commit=True)


def update_dynamic(table_name, pk_col, pk_value, values):
    sets = []
    params = []
    for key, value in values.items():
        if value is not None and column_exists(table_name, key):
            sets.append(f"`{key}`=%s")
            params.append(value)
    if not sets:
        return 0
    params.append(pk_value)
    return exec_db(f"UPDATE `{table_name}` SET {','.join(sets)} WHERE `{pk_col}`=%s", tuple(params))


def normalize_level(level):
    value = str(level or "beginner").strip().lower()
    aliases = {
        "begginer": "beginner",
        "beginner": "beginner",
        "intermidiete": "intermediate",
        "intermediate": "intermediate",
        "medium": "intermediate",
        "advance": "advanced",
        "advanced": "advanced",
    }
    return aliases.get(value, "beginner")


def add_course_level_meta(course):
    level = normalize_level(course.get("level"))
    course["level"] = level
    course["level_badge"] = COURSE_LEVEL_META[level]
    return course


def upload_url(filename):
    value = str(filename or "").strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://") or value.startswith("/uploads/"):
        return value
    return f"/uploads/{value}"


def normalize_specialization(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "specialization_id")
    row["specialization_id"] = row_value(row, "specialization_id", "id")
    row["image"] = row_value(row, "image", "image_url") or ""
    row["image_url"] = upload_url(row_value(row, "image_url", "image"))
    return row


def normalize_course(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "course_id")
    row["course_id"] = row_value(row, "course_id", "id")
    row["spec_id"] = row_value(row, "spec_id", "specialization_id")
    row["specialization_id"] = row_value(row, "specialization_id", "spec_id")
    row["link"] = row_value(row, "link", "course_link") or ""
    row["course_link"] = row_value(row, "course_link", "link") or ""
    row["image"] = row_value(row, "image", "image_url") or ""
    row["image_url"] = upload_url(row_value(row, "image_url", "image"))
    row["video"] = row_value(row, "video", "video_url") or ""
    row["video_url"] = upload_url(row_value(row, "video_url", "video"))
    return add_course_level_meta(row)


def normalize_quiz(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "quiz_id")
    row["quiz_id"] = row_value(row, "quiz_id", "id")
    return row


def normalize_question(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "question_id")
    row["question_id"] = row_value(row, "question_id", "id")
    row["question"] = row_value(row, "question", "question_text") or ""
    row["question_text"] = row_value(row, "question_text", "question") or ""
    row["option1"] = row_value(row, "option1", "option_a") or ""
    row["option2"] = row_value(row, "option2", "option_b") or ""
    row["option3"] = row_value(row, "option3", "option_c") or ""
    row["option4"] = row_value(row, "option4", "option_d") or ""
    row["option_a"] = row_value(row, "option_a", "option1") or ""
    row["option_b"] = row_value(row, "option_b", "option2") or ""
    row["option_c"] = row_value(row, "option_c", "option3") or ""
    row["option_d"] = row_value(row, "option_d", "option4") or ""
    row["answer"] = row_value(row, "answer", "correct_answer") or ""
    row["correct_answer"] = row_value(row, "correct_answer", "answer") or ""
    return row


def normalize_job(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "job_id")
    row["job_id"] = row_value(row, "job_id", "id")
    row["skills"] = row_value(row, "skills", "required_skills") or ""
    row["required_skills"] = row_value(row, "required_skills", "skills") or ""
    row["salary"] = row_value(row, "salary", "average_salary") or ""
    row["average_salary"] = row_value(row, "average_salary", "salary") or ""
    row["link"] = row_value(row, "link", "job_link") or ""
    row["job_link"] = row_value(row, "job_link", "link") or ""
    row["specialization"] = row_value(row, "specialization_name", "specialization", "specialization_id") or ""
    return row


def user_id_value(user):
    if not user:
        return None
    return user.get("id") or user.get("user_id")


def clean_user(user):
    if not user:
        return None
    user = dict(user)
    user.pop("password", None)
    user["id"] = user.get("id") or user.get("user_id")
    user["user_id"] = user.get("user_id") or user.get("id")
    user["current_mode"] = user.get("current_mode") or user.get("role") or "student"
    user["banned"] = user.get("banned", user.get("is_banned", 0))
    user["is_banned"] = user.get("is_banned", user.get("banned", 0))
    return user


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
    candidate = base
    counter = 1
    while column_exists("users", "username") and query_db("SELECT * FROM users WHERE username=%s", (candidate,), fetchone=True):
        counter += 1
        candidate = f"{base}{counter}"
    return candidate


def generate_token(user):
    uid = user_id_value(user)
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
        upk = user_pk_col()
        user = query_db(f"SELECT * FROM users WHERE `{upk}`=%s", (uid,), fetchone=True)
        if not user:
            return None
        if int(user.get("banned", user.get("is_banned", 0)) or 0) == 1:
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
        if user.get("role") != "admin":
            return jsonify({"error": "Admin only"}), 403
        request.current_user = user
        return func(*args, **kwargs)
    return wrapper


def allowed_file(filename):
    allowed = {"png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm", "pdf", "docx", "txt"}
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


def safe_json_loads(text):
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{.*\}", str(text or ""), re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError("Invalid JSON")


def ai_json(prompt, fallback):
    if not client:
        return fallback
    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "Return valid JSON only. You are an expert CS career, resume, and ATS assistant."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.25,
        )
        content = response.choices[0].message.content
        result = safe_json_loads(content)
        return result if isinstance(result, dict) else fallback
    except Exception as e:
        print("AI fallback used:", e)
        return fallback


def extract_terms(text):
    text = str(text or "").lower()
    words = set(re.findall(r"[a-zA-Z][a-zA-Z+#.]{1,}", text))
    phrases = {skill for skill in TECH_SKILLS if skill in text}
    return words | phrases


def calculate_match_percentage(profile_text, target_text):
    profile_terms = extract_terms(profile_text)
    target_terms = extract_terms(target_text)
    if not target_terms:
        return 0, []
    matched = sorted(profile_terms & target_terms)
    direct_score = len(matched) / max(len(target_terms), 1)
    important = [skill for skill in TECH_SKILLS if skill in str(target_text or "").lower()]
    important_matched = [skill for skill in important if skill in str(profile_text or "").lower()]
    important_score = len(important_matched) / max(len(important), 1) if important else direct_score
    score = int(min(100, round((direct_score * 45 + important_score * 55))))
    return score, sorted(set(matched + important_matched))[:20]


def current_profile_text():
    user = get_current_user()
    if not user:
        return ""
    return " ".join(str(user.get(k) or "") for k in ["skills", "interests", "goal"])


def local_ats_score(resume_text, job_description=""):
    resume_lower = str(resume_text or "").lower()
    matched = [k for k in TECH_SKILLS if k in resume_lower]
    missing = [k for k in TECH_SKILLS if k not in resume_lower]
    sections = {
        "contact": any(x in resume_lower for x in ["@", "linkedin", "phone", "+966", "+1"]),
        "summary": any(x in resume_lower for x in ["summary", "profile", "objective"]),
        "skills": "skills" in resume_lower,
        "experience": any(x in resume_lower for x in ["experience", "work", "internship"]),
        "education": "education" in resume_lower,
        "projects": "projects" in resume_lower,
        "certifications": any(x in resume_lower for x in ["certifications", "certificates", "certificate"]),
    }
    keyword_score = int((len(matched) / max(len(TECH_SKILLS), 1)) * 35)
    section_score = sum(6 for exists in sections.values() if exists)
    job_score = 0
    job_matches = []
    if job_description:
        job_pct, job_matches = calculate_match_percentage(resume_text, job_description)
        job_score = int(job_pct * 0.35)
    action_verbs = ["built", "developed", "designed", "implemented", "improved", "analyzed", "created", "managed", "tested", "deployed"]
    action_score = min(10, sum(2 for verb in action_verbs if verb in resume_lower))
    metric_score = 10 if re.search(r"\b\d+%?|\b\d+\+", resume_lower) else 3
    score = max(10, min(100, keyword_score + section_score + job_score + action_score + metric_score))
    return {
        "ats_score": score,
        "summary": "ATS analysis completed using the resume content and target job description.",
        "matched_keywords": sorted(set(matched + job_matches)),
        "missing_keywords": missing[:20],
        "strengths": [
            "The resume includes ATS-readable technical keywords." if matched else "The resume is readable, but it needs more technical keywords.",
            "Core resume sections are present." if sum(sections.values()) >= 4 else "The resume needs more standard ATS sections."
        ],
        "weaknesses": [
            "Some keywords from the target job are missing." if job_description else "No job description was provided, so job-specific matching is limited.",
            "Add measurable achievements using numbers, percentages, tools, and outcomes."
        ],
        "improvements": [
            "Add a targeted professional summary with the target job title.",
            "Create a Skills section grouped by programming, tools, databases, and frameworks.",
            "Rewrite experience bullets using action verb + tool + result.",
            "Mirror important job description keywords naturally and honestly.",
            "Add 2-3 projects with technologies, problem solved, and measurable output."
        ],
        "section_scores": {
            "contact": 90 if sections["contact"] else 35,
            "summary": 85 if sections["summary"] else 35,
            "skills": 90 if sections["skills"] else 35,
            "experience": 85 if sections["experience"] else 35,
            "education": 85 if sections["education"] else 35,
            "projects": 80 if sections["projects"] else 30,
            "keywords": min(100, keyword_score * 2),
            "job_match": min(100, job_score * 3),
            "formatting": 80,
        }
    }


def improve_summary_local(summary, target_job, skills):
    target = target_job or "technology role"
    skill_text = skills or "technical problem solving, communication, and project delivery"
    base = str(summary or "").strip()
    if not base:
        base = "Motivated technology candidate with practical academic and project experience."
    return f"Detail-oriented candidate targeting a {target} role with strengths in {skill_text}. Experienced in turning academic and project work into clear technical solutions, with a focus on clean implementation, teamwork, and measurable improvement. Prepared to contribute to real-world projects by learning quickly, communicating clearly, and applying ATS-relevant technical skills."


def extract_pdf_text_from_stream(file):
    if not PyPDF2:
        return ""
    reader = PyPDF2.PdfReader(file)
    text = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        if page_text.strip():
            text.append(page_text.strip())
    return "\n".join(text)


def extract_docx_text_from_stream(file):
    if not Document:
        return ""
    document = Document(file)
    return "\n".join(p.text for p in document.paragraphs if p.text.strip())


def extract_resume_text_from_request():
    if request.content_type and "multipart/form-data" in request.content_type:
        text = request.form.get("resume_text", "")
        file = request.files.get("resume") or request.files.get("file")
        if file and file.filename:
            ext = file.filename.rsplit(".", 1)[-1].lower()
            if ext == "pdf":
                text += "\n" + extract_pdf_text_from_stream(file)
            elif ext == "docx":
                text += "\n" + extract_docx_text_from_stream(file)
            elif ext == "txt":
                text += "\n" + file.read().decode("utf-8", errors="ignore")
        return text.strip()
    data = request.json or {}
    return data.get("resume_text", data.get("resume", "")).strip()


def init_db():
    statements = [
        """
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            username VARCHAR(100) UNIQUE,
            email VARCHAR(150) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role ENUM('student','admin') DEFAULT 'student',
            current_mode ENUM('student','admin') DEFAULT 'student',
            banned TINYINT DEFAULT 0,
            skills TEXT,
            interests TEXT,
            goal TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            admin_level VARCHAR(50) DEFAULT 'manager',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS specializations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            skills TEXT,
            roadmap TEXT,
            job_titles TEXT,
            career_paths TEXT,
            image VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS courses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            spec_id INT NOT NULL,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            link VARCHAR(255),
            image VARCHAR(255),
            video VARCHAR(255),
            level VARCHAR(50) DEFAULT 'beginner',
            completed_weight INT DEFAULT 50,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS certificates (
            id INT AUTO_INCREMENT PRIMARY KEY,
            spec_id INT NOT NULL,
            name VARCHAR(200) NOT NULL,
            description TEXT,
            link VARCHAR(255),
            price VARCHAR(100),
            type VARCHAR(50) DEFAULT 'both',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS quizzes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            spec_id INT NULL,
            course_id INT NULL,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            total_questions INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE SET NULL,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS quiz_questions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            quiz_id INT NOT NULL,
            question TEXT NOT NULL,
            option1 VARCHAR(255),
            option2 VARCHAR(255),
            option3 VARCHAR(255),
            option4 VARCHAR(255),
            answer VARCHAR(255),
            score INT DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS specialization_enrollments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            spec_id INT NOT NULL,
            progress INT DEFAULT 0,
            status ENUM('not_started','in_progress','completed') DEFAULT 'not_started',
            enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL,
            UNIQUE KEY unique_spec_enrollment (user_id, spec_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS course_enrollments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            course_id INT NOT NULL,
            progress INT DEFAULT 0,
            status ENUM('not_started','in_progress','completed') DEFAULT 'not_started',
            enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL,
            UNIQUE KEY unique_course_enrollment (user_id, course_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS quiz_attempts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            quiz_id INT NOT NULL,
            course_id INT NULL,
            score INT DEFAULT 0,
            total INT DEFAULT 0,
            percentage DECIMAL(5,2) DEFAULT 0,
            passed TINYINT DEFAULT 0,
            answers_json LONGTEXT,
            attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS jobs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            skills TEXT,
            specialization VARCHAR(150),
            specialization_id INT NULL,
            salary VARCHAR(100),
            link VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS ats_results (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NULL,
            resume_name VARCHAR(255),
            ats_score INT DEFAULT 0,
            score INT DEFAULT 0,
            resume_text LONGTEXT,
            generated_resume LONGTEXT,
            job_description LONGTEXT,
            target_job VARCHAR(255),
            missing_keywords LONGTEXT,
            matched_keywords LONGTEXT,
            suggestions LONGTEXT,
            result_json LONGTEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS assessments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(255),
            description TEXT,
            interests TEXT,
            skills TEXT,
            goal TEXT,
            total_score INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS assessment_answers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            assessment_id INT NOT NULL,
            question_text TEXT,
            selected_option TEXT,
            score INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS specialization_recommendations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            spec_id INT NULL,
            assessment_id INT NULL,
            match_percentage INT DEFAULT 0,
            matched_skills TEXT,
            missing_skills TEXT,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE SET NULL,
            FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS job_recommendations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            job_id INT NOT NULL,
            match_percentage INT DEFAULT 0,
            matched_skills TEXT,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS progress (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            spec_id INT NOT NULL,
            progress INT DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_user_spec_progress (user_id, spec_id)
        )
        """,
    ]
    db = get_db()
    cursor = db.cursor()
    try:
        for statement in statements:
            cursor.execute(statement)
        db.commit()
    finally:
        cursor.close()
        db.close()


def ensure_runtime_schema():
    try:
        if table_exists("users"):
            add_column_if_missing("users", "username", "username VARCHAR(100) NULL")
            add_column_if_missing("users", "current_mode", "current_mode ENUM('student','admin') DEFAULT 'student'")
            add_column_if_missing("users", "banned", "banned TINYINT DEFAULT 0")
            add_column_if_missing("users", "skills", "skills TEXT")
            add_column_if_missing("users", "interests", "interests TEXT")
            add_column_if_missing("users", "goal", "goal TEXT")
            if column_exists("users", "username"):
                exec_db("UPDATE users SET username=LOWER(REPLACE(SUBSTRING_INDEX(email,'@',1),'.','_')) WHERE username IS NULL OR username=''")
            if column_exists("users", "is_banned") and column_exists("users", "banned"):
                exec_db("UPDATE users SET banned=is_banned WHERE banned IS NULL OR banned<>is_banned")
        if table_exists("specializations"):
            add_column_if_missing("specializations", "skills", "skills TEXT")
            add_column_if_missing("specializations", "roadmap", "roadmap TEXT")
            add_column_if_missing("specializations", "job_titles", "job_titles TEXT")
            add_column_if_missing("specializations", "career_paths", "career_paths TEXT")
            add_column_if_missing("specializations", "image", "image VARCHAR(255)")
            if column_exists("specializations", "image_url") and column_exists("specializations", "image"):
                exec_db("UPDATE specializations SET image=image_url WHERE (image IS NULL OR image='') AND image_url IS NOT NULL")
        if table_exists("courses"):
            add_column_if_missing("courses", "completed_weight", "completed_weight INT DEFAULT 50")
            add_column_if_missing("courses", "image", "image VARCHAR(255)")
            add_column_if_missing("courses", "video", "video VARCHAR(255)")
            add_column_if_missing("courses", "link", "link VARCHAR(255)")
            add_column_if_missing("courses", "level", "level VARCHAR(50) DEFAULT 'beginner'")
            if column_exists("courses", "specialization_id") and column_exists("courses", "spec_id"):
                exec_db("UPDATE courses SET spec_id=specialization_id WHERE spec_id IS NULL")
            if column_exists("courses", "course_link") and column_exists("courses", "link"):
                exec_db("UPDATE courses SET link=course_link WHERE (link IS NULL OR link='') AND course_link IS NOT NULL")
            if column_exists("courses", "image_url") and column_exists("courses", "image"):
                exec_db("UPDATE courses SET image=image_url WHERE (image IS NULL OR image='') AND image_url IS NOT NULL")
            if column_exists("courses", "video_url") and column_exists("courses", "video"):
                exec_db("UPDATE courses SET video=video_url WHERE (video IS NULL OR video='') AND video_url IS NOT NULL")
        if table_exists("quizzes"):
            add_column_if_missing("quizzes", "course_id", "course_id INT NULL")
            add_column_if_missing("quizzes", "spec_id", "spec_id INT NULL")
            add_column_if_missing("quizzes", "total_questions", "total_questions INT DEFAULT 0")
            if column_exists("quizzes", "specialization_id") and column_exists("quizzes", "spec_id"):
                exec_db("UPDATE quizzes SET spec_id=specialization_id WHERE spec_id IS NULL")
        if table_exists("quiz_questions"):
            add_column_if_missing("quiz_questions", "question", "question TEXT")
            add_column_if_missing("quiz_questions", "option1", "option1 VARCHAR(255)")
            add_column_if_missing("quiz_questions", "option2", "option2 VARCHAR(255)")
            add_column_if_missing("quiz_questions", "option3", "option3 VARCHAR(255)")
            add_column_if_missing("quiz_questions", "option4", "option4 VARCHAR(255)")
            add_column_if_missing("quiz_questions", "answer", "answer VARCHAR(255)")
            add_column_if_missing("quiz_questions", "score", "score INT DEFAULT 1")
            if column_exists("quiz_questions", "question_text") and column_exists("quiz_questions", "question"):
                exec_db("UPDATE quiz_questions SET question=question_text WHERE (question IS NULL OR question='') AND question_text IS NOT NULL")
            if column_exists("quiz_questions", "option_a") and column_exists("quiz_questions", "option1"):
                exec_db("UPDATE quiz_questions SET option1=option_a WHERE (option1 IS NULL OR option1='') AND option_a IS NOT NULL")
            if column_exists("quiz_questions", "option_b") and column_exists("quiz_questions", "option2"):
                exec_db("UPDATE quiz_questions SET option2=option_b WHERE (option2 IS NULL OR option2='') AND option_b IS NOT NULL")
            if column_exists("quiz_questions", "option_c") and column_exists("quiz_questions", "option3"):
                exec_db("UPDATE quiz_questions SET option3=option_c WHERE (option3 IS NULL OR option3='') AND option_c IS NOT NULL")
            if column_exists("quiz_questions", "option_d") and column_exists("quiz_questions", "option4"):
                exec_db("UPDATE quiz_questions SET option4=option_d WHERE (option4 IS NULL OR option4='') AND option_d IS NOT NULL")
            if column_exists("quiz_questions", "correct_answer") and column_exists("quiz_questions", "answer"):
                exec_db("UPDATE quiz_questions SET answer=correct_answer WHERE (answer IS NULL OR answer='') AND correct_answer IS NOT NULL")
        if table_exists("course_enrollments"):
            add_column_if_missing("course_enrollments", "progress", "progress INT DEFAULT 0")
            add_column_if_missing("course_enrollments", "status", "status ENUM('not_started','in_progress','completed') DEFAULT 'not_started'")
            add_column_if_missing("course_enrollments", "completed_at", "completed_at TIMESTAMP NULL")
            if column_exists("course_enrollments", "progress_percentage") and column_exists("course_enrollments", "progress"):
                exec_db("UPDATE course_enrollments SET progress=progress_percentage WHERE progress IS NULL OR progress=0")
        if table_exists("specialization_enrollments"):
            add_column_if_missing("specialization_enrollments", "progress", "progress INT DEFAULT 0")
            add_column_if_missing("specialization_enrollments", "status", "status ENUM('not_started','in_progress','completed') DEFAULT 'not_started'")
            add_column_if_missing("specialization_enrollments", "completed_at", "completed_at TIMESTAMP NULL")
            if column_exists("specialization_enrollments", "specialization_id") and column_exists("specialization_enrollments", "spec_id"):
                exec_db("UPDATE specialization_enrollments SET spec_id=specialization_id WHERE spec_id IS NULL")
            if column_exists("specialization_enrollments", "progress_percentage") and column_exists("specialization_enrollments", "progress"):
                exec_db("UPDATE specialization_enrollments SET progress=progress_percentage WHERE progress IS NULL OR progress=0")
        if table_exists("quiz_attempts"):
            add_column_if_missing("quiz_attempts", "course_id", "course_id INT NULL")
            add_column_if_missing("quiz_attempts", "answers_json", "answers_json LONGTEXT NULL")
            add_column_if_missing("quiz_attempts", "passed", "passed TINYINT DEFAULT 0")
            add_column_if_missing("quiz_attempts", "total", "total INT DEFAULT 0")
            add_column_if_missing("quiz_attempts", "percentage", "percentage DECIMAL(5,2) DEFAULT 0")
        if table_exists("jobs"):
            add_column_if_missing("jobs", "skills", "skills TEXT NULL")
            add_column_if_missing("jobs", "specialization", "specialization VARCHAR(150) NULL")
            add_column_if_missing("jobs", "specialization_id", "specialization_id INT NULL")
            add_column_if_missing("jobs", "salary", "salary VARCHAR(100) NULL")
            add_column_if_missing("jobs", "link", "link VARCHAR(255) NULL")
            if column_exists("jobs", "required_skills") and column_exists("jobs", "skills"):
                exec_db("UPDATE jobs SET skills=required_skills WHERE (skills IS NULL OR skills='') AND required_skills IS NOT NULL")
            if column_exists("jobs", "average_salary") and column_exists("jobs", "salary"):
                exec_db("UPDATE jobs SET salary=average_salary WHERE (salary IS NULL OR salary='') AND average_salary IS NOT NULL")
            if column_exists("jobs", "job_link") and column_exists("jobs", "link"):
                exec_db("UPDATE jobs SET link=job_link WHERE (link IS NULL OR link='') AND job_link IS NOT NULL")
        if table_exists("ats_results"):
            add_column_if_missing("ats_results", "resume_name", "resume_name VARCHAR(255) NULL")
            add_column_if_missing("ats_results", "ats_score", "ats_score INT DEFAULT 0")
            add_column_if_missing("ats_results", "score", "score INT DEFAULT 0")
            add_column_if_missing("ats_results", "resume_text", "resume_text LONGTEXT NULL")
            add_column_if_missing("ats_results", "generated_resume", "generated_resume LONGTEXT NULL")
            add_column_if_missing("ats_results", "job_description", "job_description LONGTEXT NULL")
            add_column_if_missing("ats_results", "target_job", "target_job VARCHAR(255) NULL")
            add_column_if_missing("ats_results", "missing_keywords", "missing_keywords LONGTEXT NULL")
            add_column_if_missing("ats_results", "matched_keywords", "matched_keywords LONGTEXT NULL")
            add_column_if_missing("ats_results", "suggestions", "suggestions LONGTEXT NULL")
            add_column_if_missing("ats_results", "result_json", "result_json LONGTEXT NULL")
        if table_exists("assessment_answers"):
            add_column_if_missing("assessment_answers", "question_text", "question_text TEXT")
            add_column_if_missing("assessment_answers", "selected_option", "selected_option TEXT")
            add_column_if_missing("assessment_answers", "score", "score INT DEFAULT 0")
    except Exception as e:
        print("Runtime schema update skipped:", e)


def render_page(template_name):
    template_path = os.path.join(TEMPLATES_DIR, template_name)
    root_path = os.path.join(BASE_DIR, template_name)
    if os.path.exists(template_path):
        return render_template(template_name)
    if os.path.exists(root_path):
        return send_from_directory(BASE_DIR, template_name)
    return jsonify({
        "message": "SQR Backend is running, but the HTML template was not found",
        "missing_template": template_name,
        "expected_location": os.path.join("templates", template_name),
        "root_path": BASE_DIR,
        "templates_files": os.listdir(TEMPLATES_DIR) if os.path.exists(TEMPLATES_DIR) else []
    }), 500


def page_or_json(template_name):
    return render_page(template_name)


@app.route("/")
def home():
    return render_page("gp.html")


@app.route("/debug-files")
def debug_files():
    return jsonify({
        "cwd": os.getcwd(),
        "base_dir": BASE_DIR,
        "root_path": app.root_path,
        "template_folder": app.template_folder,
        "static_folder": app.static_folder,
        "root_files": os.listdir(BASE_DIR) if os.path.exists(BASE_DIR) else [],
        "templates_exists": os.path.exists(TEMPLATES_DIR),
        "templates_files": os.listdir(TEMPLATES_DIR) if os.path.exists(TEMPLATES_DIR) else [],
        "static_exists": os.path.exists(STATIC_DIR),
        "static_files": os.listdir(STATIC_DIR) if os.path.exists(STATIC_DIR) else [],
        "upload_exists": os.path.exists(UPLOAD_DIR),
        "database": DB_CONFIG.get("database"),
        "database_pool": bool(pool),
    })


@app.route("/home")
def page_home():
    return render_page("gp.html")


@app.route("/specializations")
def page_specializations():
    return page_or_json("Specialization.html")


@app.route("/courses")
def page_courses():
    return page_or_json("Courses.html")


@app.route("/specialization-details")
def page_specialization_details():
    return page_or_json("specialization-details.html")


@app.route("/course-details")
def page_course_details():
    return page_or_json("course-details.html")


@app.route("/quizzes")
def page_quizzes():
    return page_or_json("Quiz.html")


@app.route("/recommendation")
def page_recommendation():
    return page_or_json("recommendation.html")


@app.route("/jobs")
def page_jobs():
    return page_or_json("jobs.html")


@app.route("/job-details")
@app.route("/JobDetails.html")
def page_job_details():
    return page_or_json("JobDetails.html")


@app.route("/ats")
def page_ats():
    return page_or_json("ATS.html")


@app.route("/profile")
def page_profile():
    return page_or_json("profile.html")


@app.route("/admin")
def page_admin():
    return page_or_json("admin.html")


@app.route("/signin")
def page_signin():
    return page_or_json("signin.html")


@app.route("/signup")
def page_signup():
    return page_or_json("signup.html")


@app.route("/<path:page>.html")
def legacy_html_pages(page):
    aliases = {
        "gp": "gp.html",
        "Specialization": "Specialization.html",
        "Sepecialization": "Specialization.html",
        "Courses": "Courses.html",
        "courses": "Courses.html",
        "specialization-details": "specialization-details.html",
        "course-details": "course-details.html",
        "Quiz": "Quiz.html",
        "ATS": "ATS.html",
        "ats": "ATS.html",
        "profile": "profile.html",
        "admin": "admin.html",
        "signin": "signin.html",
        "signup": "signup.html",
        "jobs": "jobs.html",
        "JobDetails": "JobDetails.html",
        "job-details": "JobDetails.html",
        "recommendation": "recommendation.html",
    }
    return page_or_json(aliases.get(page, f"{page}.html"))


@app.route("/uploads/<path:filename>")
def uploads(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/api/signup", methods=["POST"])
def signup():
    data = get_json()
    name = safe_text(data.get("name"))
    email = safe_text(data.get("email")).lower()
    username = safe_text(data.get("username")).lower()
    password = safe_text(data.get("password"))

    if not name or not email or not password:
        return jsonify({"error": "Name, email, and password are required"}), 400
    if not username:
        username = generate_username(name, email)
    if not strong_password(password):
        return jsonify({"error": "Password must be at least 8 characters and include uppercase, lowercase, number, special character, and no spaces"}), 400
    if query_db("SELECT * FROM users WHERE email=%s", (email,), fetchone=True):
        return jsonify({"error": "Email already exists"}), 409
    if column_exists("users", "username") and query_db("SELECT * FROM users WHERE username=%s", (username,), fetchone=True):
        return jsonify({"error": "Username already exists"}), 409

    hashed_password = generate_password_hash(password, method="pbkdf2:sha256", salt_length=16)
    values = {
        "name": name,
        "username": username,
        "email": email,
        "password": hashed_password,
        "role": "student",
        "current_mode": "student",
        "banned": 0,
        "is_banned": 0,
    }
    new_id = insert_dynamic("users", values)
    upk = user_pk_col()
    user = query_db(f"SELECT * FROM users WHERE `{upk}`=%s", (new_id,), fetchone=True)
    if not user:
        user = query_db("SELECT * FROM users WHERE email=%s", (email,), fetchone=True)
    return jsonify({"message": "Signup successful", "token": generate_token(user), "user": clean_user(user)}), 201


@app.route("/api/login", methods=["POST"])
@app.route("/api/signin", methods=["POST"])
def login():
    data = get_json()
    email = safe_text(data.get("email")).lower()
    password = safe_text(data.get("password"))
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    user = query_db("SELECT * FROM users WHERE email=%s", (email,), fetchone=True)
    if not user or not check_password_hash(user.get("password", ""), password):
        return jsonify({"error": "Invalid email or password"}), 401
    if int(user.get("banned", user.get("is_banned", 0)) or 0) == 1:
        return jsonify({"error": "Your account is banned"}), 403
    return jsonify({"message": "Login successful", "token": generate_token(user), "user": clean_user(user)}), 200


@app.route("/api/me")
@login_required
def me():
    return jsonify(clean_user(request.current_user))


@app.route("/api/mode/admin", methods=["POST"])
@login_required
def switch_admin_mode():
    if request.current_user.get("role") != "admin":
        return jsonify({"error": "Only admin accounts can switch to admin mode"}), 403
    upk = user_pk_col()
    update_dynamic("users", upk, user_id_value(request.current_user), {"current_mode": "admin"})
    user = query_db(f"SELECT * FROM users WHERE `{upk}`=%s", (user_id_value(request.current_user),), fetchone=True)
    return jsonify({"message": "Switched to admin mode", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/mode/student", methods=["POST"])
@login_required
def switch_student_mode():
    if request.current_user.get("role") != "admin":
        return jsonify({"error": "Only admin accounts can switch modes"}), 403
    upk = user_pk_col()
    update_dynamic("users", upk, user_id_value(request.current_user), {"current_mode": "student"})
    user = query_db(f"SELECT * FROM users WHERE `{upk}`=%s", (user_id_value(request.current_user),), fetchone=True)
    return jsonify({"message": "Switched to student mode", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/admin/users")
@admin_required
def admin_users():
    upk = user_pk_col()
    users = query_db(f"SELECT * FROM users ORDER BY `{upk}` DESC", fetchall=True) or []
    return jsonify([clean_user(u) for u in users])


@app.route("/api/admin/users/<int:user_id>/make-admin", methods=["PUT"])
@admin_required
def make_admin(user_id):
    upk = user_pk_col()
    update_dynamic("users", upk, user_id, {"role": "admin", "current_mode": "admin"})
    if table_exists("admins"):
        try:
            query_db("INSERT IGNORE INTO admins (user_id, admin_level) VALUES (%s,'manager')", (user_id,), commit=True)
        except Exception:
            pass
    return jsonify({"message": "User is now admin"})


@app.route("/api/admin/users/<int:user_id>/make-student", methods=["PUT"])
@admin_required
def make_student(user_id):
    upk = user_pk_col()
    update_dynamic("users", upk, user_id, {"role": "student", "current_mode": "student"})
    return jsonify({"message": "User is now student"})


@app.route("/api/admin/users/<int:user_id>/role", methods=["PUT"])
@admin_required
def update_user_role_alias(user_id):
    role = get_json().get("role", "student")
    if role == "admin":
        return make_admin(user_id)
    return make_student(user_id)


@app.route("/api/admin/users/<int:user_id>/ban", methods=["PUT"])
@admin_required
def ban_user(user_id):
    upk = user_pk_col()
    update_dynamic("users", upk, user_id, {"banned": 1, "is_banned": 1})
    return jsonify({"message": "User banned"})


@app.route("/api/admin/users/<int:user_id>/unban", methods=["PUT"])
@admin_required
def unban_user(user_id):
    upk = user_pk_col()
    update_dynamic("users", upk, user_id, {"banned": 0, "is_banned": 0})
    return jsonify({"message": "User unbanned"})


@app.route("/api/specializations", methods=["GET"])
def get_specializations():
    spk = spec_pk_col()
    specs = query_db(f"SELECT * FROM specializations ORDER BY `{spk}` DESC", fetchall=True) or []
    fixed = []
    for spec in specs:
        spec = normalize_specialization(spec)
        try:
            spec["certificates"] = query_db("SELECT * FROM certificates WHERE spec_id=%s ORDER BY id DESC", (spec["id"],), fetchall=True) or []
        except Exception:
            spec["certificates"] = []
        fixed.append(spec)
    return jsonify(fixed)


@app.route("/api/specializations/<int:spec_id>", methods=["GET"])
def get_specialization(spec_id):
    spk = spec_pk_col()
    spec = query_db(f"SELECT * FROM specializations WHERE `{spk}`=%s", (spec_id,), fetchone=True)
    if not spec:
        return jsonify({"error": "Specialization not found"}), 404
    spec = normalize_specialization(spec)
    try:
        spec["certificates"] = query_db("SELECT * FROM certificates WHERE spec_id=%s ORDER BY id DESC", (spec["id"],), fetchall=True) or []
    except Exception:
        spec["certificates"] = []
    cpk = course_pk_col()
    cspec = course_spec_col()
    courses = query_db(f"SELECT * FROM courses WHERE `{cspec}`=%s ORDER BY `{cpk}` DESC", (spec_id,), fetchall=True) or []
    fixed_courses = []
    for course in courses:
        course = normalize_course(course)
        course["quizzes"] = query_db(f"SELECT * FROM quizzes WHERE course_id=%s ORDER BY `{quiz_pk_col()}` DESC", (course["id"],), fetchall=True) or []
        fixed_courses.append(course)
    spec["courses"] = fixed_courses
    try:
        spec["quizzes"] = query_db(f"SELECT q.* FROM quizzes q JOIN courses c ON q.course_id=c.`{cpk}` WHERE c.`{cspec}`=%s ORDER BY q.`{quiz_pk_col()}` DESC", (spec_id,), fetchall=True) or []
    except Exception:
        spec["quizzes"] = []
    return jsonify(spec)


@app.route("/api/specializations", methods=["POST"])
@admin_required
def add_specialization():
    data = request.form.to_dict() if request.form else get_json()
    name = safe_text(data.get("name"))
    if not name:
        return jsonify({"error": "Specialization name is required"}), 400
    image = save_file("image") or data.get("image_url") or data.get("image") or ""
    spec_id = insert_dynamic("specializations", {
        "name": name,
        "description": data.get("description", ""),
        "skills": data.get("skills", ""),
        "roadmap": data.get("roadmap", ""),
        "job_titles": data.get("job_titles", ""),
        "career_paths": data.get("career_paths", ""),
        "image": image,
        "image_url": image,
    })
    return jsonify({"message": "Specialization added", "id": spec_id, "specialization_id": spec_id}), 201


@app.route("/api/admin/specializations", methods=["POST"])
@admin_required
def admin_add_specialization_alias():
    return add_specialization()


@app.route("/api/specializations/<int:spec_id>", methods=["PUT"])
@admin_required
def update_specialization(spec_id):
    spk = spec_pk_col()
    old = query_db(f"SELECT * FROM specializations WHERE `{spk}`=%s", (spec_id,), fetchone=True)
    if not old:
        return jsonify({"error": "Specialization not found"}), 404
    old = normalize_specialization(old)
    data = request.form.to_dict() if request.form else get_json()
    image = save_file("image") or data.get("image_url") or data.get("image") or old.get("image") or ""
    update_dynamic("specializations", spk, spec_id, {
        "name": data.get("name", old.get("name")),
        "description": data.get("description", old.get("description")),
        "skills": data.get("skills", old.get("skills")),
        "roadmap": data.get("roadmap", old.get("roadmap")),
        "job_titles": data.get("job_titles", old.get("job_titles")),
        "career_paths": data.get("career_paths", old.get("career_paths")),
        "image": image,
        "image_url": image,
    })
    return jsonify({"message": "Specialization updated"})


@app.route("/api/specializations/<int:spec_id>", methods=["DELETE"])
@admin_required
def delete_specialization(spec_id):
    exec_db(f"DELETE FROM specializations WHERE `{spec_pk_col()}`=%s", (spec_id,))
    return jsonify({"message": "Specialization deleted"})


@app.route("/api/certificates", methods=["GET"])
def get_certificates():
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    sql = "SELECT * FROM certificates WHERE 1=1"
    params = []
    if spec_id:
        sql += " AND spec_id=%s"
        params.append(spec_id)
    sql += " ORDER BY id DESC"
    return jsonify(query_db(sql, tuple(params), fetchall=True) or [])


@app.route("/api/certificates", methods=["POST"])
@admin_required
def add_certificate():
    data = request.form.to_dict() if request.form else get_json()
    spec_id = data.get("spec_id") or data.get("specialization_id")
    if not spec_id or not data.get("name"):
        return jsonify({"error": "spec_id and name are required"}), 400
    cert_id = insert_dynamic("certificates", {
        "spec_id": spec_id,
        "specialization_id": spec_id,
        "name": data.get("name"),
        "description": data.get("description", ""),
        "link": data.get("link", ""),
        "price": data.get("price", ""),
        "type": data.get("type", "both"),
    })
    return jsonify({"message": "Certificate added", "id": cert_id}), 201


@app.route("/api/admin/certificates", methods=["POST"])
@admin_required
def admin_add_certificate_alias():
    return add_certificate()


@app.route("/api/certificates/<int:cert_id>", methods=["PUT"])
@admin_required
def update_certificate(cert_id):
    data = request.form.to_dict() if request.form else get_json()
    update_dynamic("certificates", db_primary("certificates"), cert_id, {
        "name": data.get("name"),
        "description": data.get("description"),
        "link": data.get("link"),
        "price": data.get("price"),
        "type": data.get("type", "both"),
    })
    return jsonify({"message": "Certificate updated"})


@app.route("/api/certificates/<int:cert_id>", methods=["DELETE"])
@admin_required
def delete_certificate(cert_id):
    exec_db(f"DELETE FROM certificates WHERE `{db_primary('certificates')}`=%s", (cert_id,))
    return jsonify({"message": "Certificate deleted"})


@app.route("/api/courses", methods=["GET"])
def get_courses():
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    level = request.args.get("level") or request.args.get("difficulty")
    search = request.args.get("search", "")
    sort = request.args.get("sort", "newest")
    cpk = course_pk_col()
    cspec = course_spec_col()
    sql = "SELECT * FROM courses WHERE 1=1"
    params = []
    if spec_id:
        sql += f" AND `{cspec}`=%s"
        params.append(spec_id)
    if level:
        sql += " AND LOWER(level)=LOWER(%s)"
        params.append(normalize_level(level))
    if search:
        sql += " AND (title LIKE %s OR description LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%"])
    if sort == "title":
        sql += " ORDER BY title ASC"
    elif sort == "oldest":
        sql += f" ORDER BY `{cpk}` ASC"
    else:
        sql += f" ORDER BY `{cpk}` DESC"
    courses = query_db(sql, tuple(params), fetchall=True) or []
    return jsonify([normalize_course(course) for course in courses])


@app.route("/api/courses", methods=["POST"])
@admin_required
def add_course():
    data = request.form.to_dict() if request.form else get_json()
    spec_id = data.get("specialization_id") or data.get("spec_id") or data.get("specialization")
    title = safe_text(data.get("title") or data.get("course_title"))
    if not spec_id or not title:
        return jsonify({"error": "spec_id and title are required"}), 400
    image = save_file("image") or data.get("image_url") or data.get("image") or ""
    video = save_file("video") or data.get("video_url") or data.get("video") or ""
    level = normalize_level(data.get("level") or data.get("difficulty") or "beginner")
    course_id = insert_dynamic("courses", {
        "specialization_id": spec_id,
        "spec_id": spec_id,
        "title": title,
        "description": data.get("description", ""),
        "course_link": data.get("course_link") or data.get("link") or "",
        "link": data.get("link") or data.get("course_link") or "",
        "image_url": image,
        "image": image,
        "video_url": video,
        "video": video,
        "level": level,
    })
    return jsonify({"message": "Course added", "id": course_id, "course_id": course_id}), 201


@app.route("/api/admin/courses", methods=["POST"])
@admin_required
def admin_add_course_alias():
    return add_course()


@app.route("/api/courses/<int:course_id>", methods=["GET"])
def get_course(course_id):
    cpk = course_pk_col()
    course = query_db(f"SELECT * FROM courses WHERE `{cpk}`=%s", (course_id,), fetchone=True)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    course = normalize_course(course)
    quizzes = query_db(f"SELECT * FROM quizzes WHERE course_id=%s ORDER BY `{quiz_pk_col()}` DESC", (course["id"],), fetchall=True) or []
    fixed = []
    for quiz in quizzes:
        quiz = normalize_quiz(quiz)
        questions = query_db(f"SELECT * FROM quiz_questions WHERE quiz_id=%s ORDER BY `{question_pk_col()}` ASC", (quiz["id"],), fetchall=True) or []
        quiz["questions"] = [normalize_question(q) for q in questions]
        fixed.append(quiz)
    course["quizzes"] = fixed
    return jsonify(course)


@app.route("/api/courses/<int:course_id>", methods=["PUT"])
@admin_required
def update_course(course_id):
    cpk = course_pk_col()
    old = query_db(f"SELECT * FROM courses WHERE `{cpk}`=%s", (course_id,), fetchone=True)
    if not old:
        return jsonify({"error": "Course not found"}), 404
    old = normalize_course(old)
    data = request.form.to_dict() if request.form else get_json()
    spec_id = data.get("specialization_id") or data.get("spec_id") or old.get("spec_id")
    image = save_file("image") or data.get("image_url") or data.get("image") or old.get("image") or ""
    video = save_file("video") or data.get("video_url") or data.get("video") or old.get("video") or ""
    update_dynamic("courses", cpk, course_id, {
        "specialization_id": spec_id,
        "spec_id": spec_id,
        "title": data.get("title", old.get("title")),
        "description": data.get("description", old.get("description")),
        "course_link": data.get("course_link") or data.get("link") or old.get("link"),
        "link": data.get("link") or data.get("course_link") or old.get("link"),
        "image_url": image,
        "image": image,
        "video_url": video,
        "video": video,
        "level": normalize_level(data.get("level") or data.get("difficulty") or old.get("level")),
    })
    return jsonify({"message": "Course updated"})


@app.route("/api/courses/<int:course_id>", methods=["DELETE"])
@admin_required
def delete_course(course_id):
    exec_db(f"DELETE FROM courses WHERE `{course_pk_col()}`=%s", (course_id,))
    return jsonify({"message": "Course deleted"})


def get_course_by_id(course_id):
    course = query_db(f"SELECT * FROM courses WHERE `{course_pk_col()}`=%s", (course_id,), fetchone=True)
    return normalize_course(course) if course else None


def ensure_specialization_enrollment(user_id, spec_id):
    if not spec_id:
        return
    query_db(
        """
        INSERT INTO specialization_enrollments (user_id, spec_id, progress, status)
        VALUES (%s, %s, 0, 'not_started')
        ON DUPLICATE KEY UPDATE spec_id=VALUES(spec_id)
        """,
        (user_id, spec_id),
        commit=True
    )


def ensure_course_enrollment(user_id, course_id, progress=0):
    course = get_course_by_id(course_id)
    if not course:
        return None
    ensure_specialization_enrollment(user_id, course.get("spec_id"))
    status = "completed" if int(progress or 0) >= 100 else "in_progress" if int(progress or 0) > 0 else "not_started"
    query_db(
        """
        INSERT INTO course_enrollments (user_id, course_id, progress, status, completed_at)
        VALUES (%s, %s, %s, %s, IF(%s='completed', NOW(), NULL))
        ON DUPLICATE KEY UPDATE
            progress=GREATEST(IFNULL(progress,0), VALUES(progress)),
            status=IF(GREATEST(IFNULL(progress,0), VALUES(progress))>=100,'completed',IF(GREATEST(IFNULL(progress,0), VALUES(progress))>0,'in_progress','not_started')),
            completed_at=IF(GREATEST(IFNULL(progress,0), VALUES(progress))>=100,NOW(),completed_at)
        """,
        (user_id, course_id, progress, status, status),
        commit=True
    )
    return course


def recalculate_specialization_progress(user_id, spec_id):
    if not spec_id:
        return 0
    cpk = course_pk_col()
    cspec = course_spec_col()
    courses = query_db(
        f"""
        SELECT c.`{cpk}` AS course_id, IFNULL(ce.progress,0) AS progress
        FROM courses c
        LEFT JOIN course_enrollments ce ON ce.course_id=c.`{cpk}` AND ce.user_id=%s
        WHERE c.`{cspec}`=%s
        """,
        (user_id, spec_id),
        fetchall=True
    ) or []
    progress = int(round(sum(int(c.get("progress") or 0) for c in courses) / len(courses))) if courses else 0
    status = "completed" if progress >= 100 else "in_progress" if progress > 0 else "not_started"
    query_db(
        """
        INSERT INTO specialization_enrollments (user_id, spec_id, progress, status, completed_at)
        VALUES (%s, %s, %s, %s, IF(%s='completed', NOW(), NULL))
        ON DUPLICATE KEY UPDATE
            progress=%s,
            status=%s,
            completed_at=IF(%s='completed', NOW(), completed_at)
        """,
        (user_id, spec_id, progress, status, status, progress, status, status),
        commit=True
    )
    if table_exists("progress"):
        try:
            query_db(
                """
                INSERT INTO progress (user_id, spec_id, progress)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE progress=%s
                """,
                (user_id, spec_id, progress, progress),
                commit=True
            )
        except Exception:
            pass
    return progress


def recalculate_course_progress(user_id, course_id):
    course = get_course_by_id(course_id)
    if not course:
        return 0
    enrollment = query_db(
        "SELECT progress FROM course_enrollments WHERE user_id=%s AND course_id=%s",
        (user_id, course_id),
        fetchone=True
    )
    current_progress = int((enrollment or {}).get("progress") or 0)
    content_score = 50 if current_progress >= 50 else 0
    quizzes = query_db("SELECT id FROM quizzes WHERE course_id=%s", (course_id,), fetchall=True) or []
    if not quizzes:
        progress = 100 if content_score else current_progress
    else:
        passed = 0
        for quiz in quizzes:
            row = query_db(
                "SELECT MAX(passed) AS passed FROM quiz_attempts WHERE user_id=%s AND quiz_id=%s",
                (user_id, quiz["id"]),
                fetchone=True
            )
            if row and int(row.get("passed") or 0) == 1:
                passed += 1
        quiz_score = round((passed / len(quizzes)) * 50)
        progress = min(100, int(content_score + quiz_score))
    status = "completed" if progress >= 100 else "in_progress" if progress > 0 else "not_started"
    query_db(
        """
        INSERT INTO course_enrollments (user_id, course_id, progress, status, completed_at)
        VALUES (%s, %s, %s, %s, IF(%s='completed', NOW(), NULL))
        ON DUPLICATE KEY UPDATE
            progress=%s,
            status=%s,
            completed_at=IF(%s='completed', NOW(), completed_at)
        """,
        (user_id, course_id, progress, status, status, progress, status, status),
        commit=True
    )
    recalculate_specialization_progress(user_id, course.get("spec_id"))
    return progress


@app.route("/api/specializations/<int:spec_id>/enroll", methods=["POST"])
@login_required
def enroll_specialization(spec_id):
    spec = query_db(f"SELECT * FROM specializations WHERE `{spec_pk_col()}`=%s", (spec_id,), fetchone=True)
    if not spec:
        return jsonify({"error": "Specialization not found"}), 404
    user_id = user_id_value(request.current_user)
    ensure_specialization_enrollment(user_id, spec_id)
    progress = recalculate_specialization_progress(user_id, spec_id)
    return jsonify({"message": "Enrolled in specialization", "spec_id": spec_id, "progress": progress})


@app.route("/api/specializations/enrolled")
@login_required
def enrolled_specializations():
    user_id = user_id_value(request.current_user)
    rows = query_db(
        """
        SELECT se.*, s.name, s.description, s.image, s.roadmap, s.job_titles, s.career_paths
        FROM specialization_enrollments se
        JOIN specializations s ON s.id=se.spec_id
        WHERE se.user_id=%s
        ORDER BY se.enrolled_at DESC
        """,
        (user_id,),
        fetchall=True
    ) or []
    for row in rows:
        row["image_url"] = upload_url(row.get("image"))
    return jsonify(rows)


@app.route("/api/courses/<int:course_id>/enroll", methods=["POST"])
@login_required
def enroll_course(course_id):
    user_id = user_id_value(request.current_user)
    course = ensure_course_enrollment(user_id, course_id, 0)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    progress = recalculate_specialization_progress(user_id, course.get("spec_id"))
    return jsonify({"message": "Enrolled in course", "course_id": course_id, "spec_id": course.get("spec_id"), "specialization_progress": progress})


@app.route("/api/courses/<int:course_id>/open", methods=["POST"])
@login_required
def open_course(course_id):
    user_id = user_id_value(request.current_user)
    course = ensure_course_enrollment(user_id, course_id, 50)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    progress = recalculate_course_progress(user_id, course_id)
    return jsonify({"message": "Course opened and user enrolled automatically", "course_id": course_id, "progress": progress})


@app.route("/api/courses/<int:course_id>/complete", methods=["POST"])
@login_required
def complete_course(course_id):
    return open_course(course_id)


@app.route("/api/courses/<int:course_id>/unenroll", methods=["DELETE", "POST"])
@login_required
def unenroll_course(course_id):
    user_id = user_id_value(request.current_user)
    course = get_course_by_id(course_id)
    query_db("DELETE FROM course_enrollments WHERE user_id=%s AND course_id=%s", (user_id, course_id), commit=True)
    if course:
        recalculate_specialization_progress(user_id, course.get("spec_id"))
    return jsonify({"message": "Unenrolled successfully", "course_id": course_id})


@app.route("/api/courses/enrolled")
@login_required
def enrolled_courses():
    user_id = user_id_value(request.current_user)
    rows = query_db(
        """
        SELECT ce.*, c.title, c.description, c.level, c.image, c.video, c.link, c.spec_id, s.name AS specialization_name
        FROM course_enrollments ce
        JOIN courses c ON c.id=ce.course_id
        LEFT JOIN specializations s ON s.id=c.spec_id
        WHERE ce.user_id=%s
        ORDER BY ce.enrolled_at DESC
        """,
        (user_id,),
        fetchall=True
    ) or []
    return jsonify([normalize_course(row) for row in rows])


@app.route("/api/progress", methods=["GET"])
@login_required
def get_progress():
    user_id = user_id_value(request.current_user)
    specs = query_db(f"SELECT * FROM specializations ORDER BY `{spec_pk_col()}` DESC", fetchall=True) or []
    result = []
    for spec in specs:
        spec = normalize_specialization(spec)
        progress = recalculate_specialization_progress(user_id, spec["id"])
        cpk = course_pk_col()
        cspec = course_spec_col()
        total_row = query_db(f"SELECT COUNT(*) AS total FROM courses WHERE `{cspec}`=%s", (spec["id"],), fetchone=True) or {"total": 0}
        opened_row = query_db(
            f"""
            SELECT COUNT(*) AS total
            FROM course_enrollments ce
            JOIN courses c ON c.`{cpk}`=ce.course_id
            WHERE ce.user_id=%s AND c.`{cspec}`=%s AND ce.progress>0
            """,
            (user_id, spec["id"]),
            fetchone=True
        ) or {"total": 0}
        completed_row = query_db(
            f"""
            SELECT COUNT(*) AS total
            FROM course_enrollments ce
            JOIN courses c ON c.`{cpk}`=ce.course_id
            WHERE ce.user_id=%s AND c.`{cspec}`=%s AND ce.progress>=100
            """,
            (user_id, spec["id"]),
            fetchone=True
        ) or {"total": 0}
        result.append({
            "specialization_id": spec["id"],
            "spec_id": spec["id"],
            "specialization_name": spec.get("name"),
            "name": spec.get("name"),
            "total_courses": int(total_row.get("total") or 0),
            "opened_courses": int(opened_row.get("total") or 0),
            "completed_courses": int(completed_row.get("total") or 0),
            "progress": progress,
        })
    return jsonify(result)


@app.route("/api/progress", methods=["POST"])
@login_required
def update_progress():
    data = get_json()
    spec_id = data.get("spec_id") or data.get("specialization_id")
    if not spec_id:
        return jsonify({"error": "spec_id is required"}), 400
    progress_value = max(0, min(int(data.get("progress", 0)), 100))
    status = "completed" if progress_value >= 100 else "in_progress" if progress_value > 0 else "not_started"
    user_id = user_id_value(request.current_user)
    query_db(
        """
        INSERT INTO specialization_enrollments (user_id, spec_id, progress, status, completed_at)
        VALUES (%s, %s, %s, %s, IF(%s='completed', NOW(), NULL))
        ON DUPLICATE KEY UPDATE progress=%s, status=%s, completed_at=IF(%s='completed', NOW(), completed_at)
        """,
        (user_id, spec_id, progress_value, status, status, progress_value, status, status),
        commit=True
    )
    return jsonify({"message": "Progress updated", "progress": progress_value, "status": status})


@app.route("/api/quizzes", methods=["GET"])
def get_quizzes():
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    course_id = request.args.get("course_id")
    qpk = quiz_pk_col()
    if course_id:
        quizzes = query_db(f"SELECT * FROM quizzes WHERE course_id=%s ORDER BY `{qpk}` DESC", (course_id,), fetchall=True) or []
    elif spec_id:
        cpk = course_pk_col()
        cspec = course_spec_col()
        quizzes = query_db(f"SELECT q.* FROM quizzes q JOIN courses c ON q.course_id=c.`{cpk}` WHERE c.`{cspec}`=%s ORDER BY q.`{qpk}` DESC", (spec_id,), fetchall=True) or []
    else:
        quizzes = query_db(f"SELECT * FROM quizzes ORDER BY `{qpk}` DESC", fetchall=True) or []
    fixed = []
    for quiz in quizzes:
        quiz = normalize_quiz(quiz)
        questions = query_db(f"SELECT * FROM quiz_questions WHERE quiz_id=%s ORDER BY `{question_pk_col()}` ASC", (quiz["id"],), fetchall=True) or []
        quiz["questions"] = [normalize_question(q) for q in questions]
        fixed.append(quiz)
    return jsonify(fixed)


@app.route("/api/admin/quizzes", methods=["POST"])
@app.route("/api/quizzes", methods=["POST"])
@admin_required
def add_quiz():
    data = get_json()
    course_id = data.get("course_id")
    title = safe_text(data.get("title"))
    description = safe_text(data.get("description"))
    questions = data.get("questions", [])
    if not course_id or not title:
        return jsonify({"error": "course_id and title are required"}), 400
    if not isinstance(questions, list) or not questions:
        return jsonify({"error": "At least one question is required"}), 400
    course = get_course_by_id(course_id)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    quiz_id = insert_dynamic("quizzes", {
        "course_id": course_id,
        "spec_id": course.get("spec_id"),
        "specialization_id": course.get("spec_id"),
        "title": title,
        "description": description,
        "total_questions": len(questions),
    })
    for q in questions:
        insert_dynamic("quiz_questions", {
            "quiz_id": quiz_id,
            question_text_col(): q.get("question_text") or q.get("question"),
            question_option_col("a"): q.get("option_a") or q.get("option1"),
            question_option_col("b"): q.get("option_b") or q.get("option2"),
            question_option_col("c"): q.get("option_c") or q.get("option3"),
            question_option_col("d"): q.get("option_d") or q.get("option4"),
            question_answer_col(): q.get("correct_answer") or q.get("answer"),
            "score": q.get("score", 1),
        })
    return jsonify({"message": "Quiz added successfully", "quiz_id": quiz_id, "id": quiz_id}), 201


@app.route("/api/quizzes/<int:quiz_id>", methods=["PUT"])
@admin_required
def update_quiz(quiz_id):
    data = get_json()
    qpk = quiz_pk_col()
    course_id = data.get("course_id")
    spec_id = data.get("spec_id") or data.get("specialization_id")
    if course_id:
        course = get_course_by_id(course_id)
        if course:
            spec_id = course.get("spec_id")
    update_dynamic("quizzes", qpk, quiz_id, {
        "spec_id": spec_id,
        "specialization_id": spec_id,
        "course_id": course_id,
        "title": data.get("title"),
        "description": data.get("description"),
    })
    return jsonify({"message": "Quiz updated"})


@app.route("/api/quizzes/<int:quiz_id>", methods=["DELETE"])
@admin_required
def delete_quiz(quiz_id):
    exec_db(f"DELETE FROM quizzes WHERE `{quiz_pk_col()}`=%s", (quiz_id,))
    return jsonify({"message": "Quiz deleted"})


@app.route("/api/quiz-questions", methods=["POST"])
@admin_required
def add_question():
    data = get_json()
    quiz_id = data.get("quiz_id")
    if not quiz_id:
        return jsonify({"error": "quiz_id is required"}), 400
    question_id = insert_dynamic("quiz_questions", {
        "quiz_id": quiz_id,
        question_text_col(): data.get("question_text") or data.get("question"),
        question_option_col("a"): data.get("option_a") or data.get("option1"),
        question_option_col("b"): data.get("option_b") or data.get("option2"),
        question_option_col("c"): data.get("option_c") or data.get("option3"),
        question_option_col("d"): data.get("option_d") or data.get("option4"),
        question_answer_col(): data.get("correct_answer") or data.get("answer"),
        "score": data.get("score", 1),
    })
    if column_exists("quizzes", "total_questions"):
        exec_db(f"UPDATE quizzes SET total_questions=(SELECT COUNT(*) FROM quiz_questions WHERE quiz_id=%s) WHERE `{quiz_pk_col()}`=%s", (quiz_id, quiz_id))
    return jsonify({"message": "Question added", "id": question_id, "question_id": question_id}), 201


@app.route("/api/quiz-questions/<int:question_id>", methods=["DELETE"])
@admin_required
def delete_question(question_id):
    exec_db(f"DELETE FROM quiz_questions WHERE `{question_pk_col()}`=%s", (question_id,))
    return jsonify({"message": "Question deleted"})


@app.route("/api/quizzes/<int:quiz_id>/submit", methods=["POST"])
@login_required
def submit_quiz(quiz_id):
    user_id = user_id_value(request.current_user)
    data = get_json()
    answers = data.get("answers", {})
    quiz = query_db(f"SELECT * FROM quizzes WHERE `{quiz_pk_col()}`=%s", (quiz_id,), fetchone=True)
    if not quiz:
        return jsonify({"error": "Quiz not found"}), 404
    quiz = normalize_quiz(quiz)
    questions = query_db(f"SELECT * FROM quiz_questions WHERE quiz_id=%s ORDER BY `{question_pk_col()}` ASC", (quiz_id,), fetchall=True) or []
    questions = [normalize_question(q) for q in questions]
    if not questions:
        return jsonify({"error": "Quiz has no questions"}), 400
    score = 0
    possible = 0
    detailed = []
    for q in questions:
        qid = str(q["id"])
        user_answer = safe_text(answers.get(qid, answers.get(q.get("question"), ""))).lower()
        correct_answer = safe_text(q.get("answer") or q.get("correct_answer")).lower()
        points = int(q.get("score") or 1)
        possible += points
        correct = user_answer == correct_answer
        if correct:
            score += points
        detailed.append({"question_id": q["id"], "answer": user_answer, "correct": correct})
    total_questions = len(questions)
    percentage = round((score / max(possible, 1)) * 100, 2)
    passed = 1 if percentage >= 60 else 0
    insert_dynamic("quiz_attempts", {
        "user_id": user_id,
        "quiz_id": quiz_id,
        "course_id": quiz.get("course_id"),
        "score": score,
        "total": possible,
        "percentage": percentage,
        "passed": passed,
        "answers_json": json.dumps({"answers": answers, "details": detailed}, ensure_ascii=False),
    })
    course_progress = None
    if quiz.get("course_id"):
        course_progress = recalculate_course_progress(user_id, quiz.get("course_id"))
    return jsonify({
        "message": "Quiz submitted",
        "score": score,
        "total": possible,
        "total_questions": total_questions,
        "percentage": percentage,
        "passed": bool(passed),
        "course_progress": course_progress,
    })


@app.route("/api/profile", methods=["GET"])
@login_required
def profile():
    user = clean_user(request.current_user)
    user_id = user_id_value(request.current_user)
    if user.get("role") == "admin" and user.get("current_mode") == "admin":
        return jsonify({"error": "Admin accounts use the admin dashboard only", "user": user}), 403
    spec_progress = query_db(
        """
        SELECT se.spec_id, s.name, s.description, s.image, se.progress, se.status, se.enrolled_at
        FROM specialization_enrollments se
        JOIN specializations s ON s.id=se.spec_id
        WHERE se.user_id=%s
        ORDER BY se.enrolled_at DESC
        """,
        (user_id,),
        fetchall=True
    ) or []
    for item in spec_progress:
        item["image_url"] = upload_url(item.get("image"))
    course_progress = query_db(
        """
        SELECT ce.course_id, c.title, c.spec_id, s.name AS specialization_name, ce.progress, ce.status, ce.enrolled_at
        FROM course_enrollments ce
        JOIN courses c ON c.id=ce.course_id
        LEFT JOIN specializations s ON s.id=c.spec_id
        WHERE ce.user_id=%s
        ORDER BY ce.enrolled_at DESC
        """,
        (user_id,),
        fetchall=True
    ) or []
    return jsonify({"user": user, "progress": spec_progress, "specialization_progress": spec_progress, "course_progress": course_progress})


@app.route("/api/profile", methods=["PUT"])
@login_required
def update_profile():
    user_id = user_id_value(request.current_user)
    data = get_json()
    username = safe_text(data.get("username")).lower() if data.get("username") else None
    if username and column_exists("users", "username"):
        existing = query_db("SELECT * FROM users WHERE username=%s AND id<>%s", (username, user_id), fetchone=True)
        if existing:
            return jsonify({"error": "Username already exists"}), 409
    update_dynamic("users", user_pk_col(), user_id, {
        "name": data.get("name", request.current_user.get("name")),
        "username": username,
        "skills": data.get("skills", request.current_user.get("skills")),
        "interests": data.get("interests", request.current_user.get("interests")),
        "goal": data.get("goal", request.current_user.get("goal")),
    })
    return jsonify({"message": "Profile updated"})


@app.route("/api/jobs", methods=["GET"])
def get_jobs():
    search = request.args.get("search", "")
    specialization = request.args.get("specialization", "") or request.args.get("specialization_id", "") or request.args.get("spec_id", "")
    profile_text = request.args.get("profile_text", "") or current_profile_text()
    jpk = db_primary("jobs")
    sql = "SELECT j.*"
    if column_exists("jobs", "specialization_id") and column_exists("specializations", "id"):
        sql += ", s.name AS specialization_name FROM jobs j LEFT JOIN specializations s ON s.id=j.specialization_id WHERE 1=1"
    else:
        sql += " FROM jobs j WHERE 1=1"
    params = []
    if search:
        skill_col = "required_skills" if column_exists("jobs", "required_skills") else "skills"
        sql += f" AND (j.title LIKE %s OR j.description LIKE %s OR j.`{skill_col}` LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    if specialization:
        if str(specialization).isdigit() and column_exists("jobs", "specialization_id"):
            sql += " AND j.specialization_id=%s"
            params.append(specialization)
        elif column_exists("jobs", "specialization"):
            sql += " AND j.specialization LIKE %s"
            params.append(f"%{specialization}%")
    jobs = query_db(sql + f" ORDER BY j.`{jpk}` DESC", tuple(params), fetchall=True) or []
    fixed = []
    for job in jobs:
        job = normalize_job(job)
        job_text = f"{job.get('title','')} {job.get('description','')} {job.get('skills','')} {job.get('specialization','')}"
        score, matches = calculate_match_percentage(profile_text, job_text)
        job["match_percentage"] = score
        job["match_label"] = "Strong match" if score >= 75 else "Good match" if score >= 55 else "Partial match" if score > 0 else "Add profile skills"
        job["matched_skills"] = matches
        fixed.append(job)
    return jsonify(fixed)


@app.route("/api/jobs/<int:job_id>", methods=["GET"])
def get_job(job_id):
    jpk = db_primary("jobs")
    if column_exists("jobs", "specialization_id") and column_exists("specializations", "id"):
        row = query_db(f"SELECT j.*, s.name AS specialization_name FROM jobs j LEFT JOIN specializations s ON s.id=j.specialization_id WHERE j.`{jpk}`=%s", (job_id,), fetchone=True)
    else:
        row = query_db(f"SELECT * FROM jobs WHERE `{jpk}`=%s", (job_id,), fetchone=True)
    if not row:
        return jsonify({"error": "Job not found"}), 404
    job = normalize_job(row)
    profile_text = current_profile_text()
    score, matches = calculate_match_percentage(profile_text, f"{job.get('title','')} {job.get('description','')} {job.get('skills','')} {job.get('specialization','')}")
    job["match_percentage"] = score
    job["match_label"] = "Strong match" if score >= 75 else "Good match" if score >= 55 else "Partial match" if score > 0 else "Add profile skills"
    job["matched_skills"] = matches
    return jsonify(job)


@app.route("/api/jobs", methods=["POST"])
@admin_required
def add_job():
    data = request.form.to_dict() if request.form else get_json()
    spec_id = data.get("specialization_id") or data.get("spec_id")
    specialization_text = data.get("specialization_name") or data.get("specialization") or ""
    title = safe_text(data.get("title") or data.get("job_title"))
    if not title:
        return jsonify({"error": "title is required"}), 400
    job_id = insert_dynamic("jobs", {
        "specialization_id": spec_id if str(spec_id or "").isdigit() else None,
        "title": title,
        "description": data.get("description", ""),
        "required_skills": data.get("required_skills") or data.get("skills") or "",
        "skills": data.get("skills") or data.get("required_skills") or "",
        "average_salary": data.get("average_salary") or data.get("salary") or "",
        "salary": data.get("salary") or data.get("average_salary") or "",
        "job_link": data.get("job_link") or data.get("link") or "",
        "link": data.get("link") or data.get("job_link") or "",
        "specialization": specialization_text or spec_id or "",
    })
    return jsonify({"message": "Job added", "id": job_id, "job_id": job_id}), 201


@app.route("/api/admin/jobs", methods=["POST"])
@admin_required
def admin_add_job_alias():
    return add_job()


@app.route("/api/jobs/<int:job_id>", methods=["PUT"])
@admin_required
def update_job(job_id):
    data = request.form.to_dict() if request.form else get_json()
    jpk = db_primary("jobs")
    old = query_db(f"SELECT * FROM jobs WHERE `{jpk}`=%s", (job_id,), fetchone=True)
    if not old:
        return jsonify({"error": "Job not found"}), 404
    old = normalize_job(old)
    spec_id = data.get("specialization_id") or data.get("spec_id") or old.get("specialization_id")
    update_dynamic("jobs", jpk, job_id, {
        "specialization_id": spec_id if str(spec_id or "").isdigit() else None,
        "title": data.get("title", old.get("title")),
        "description": data.get("description", old.get("description")),
        "required_skills": data.get("required_skills") or data.get("skills") or old.get("skills"),
        "skills": data.get("skills") or data.get("required_skills") or old.get("skills"),
        "average_salary": data.get("average_salary") or data.get("salary") or old.get("salary"),
        "salary": data.get("salary") or data.get("average_salary") or old.get("salary"),
        "job_link": data.get("job_link") or data.get("link") or old.get("link"),
        "link": data.get("link") or data.get("job_link") or old.get("link"),
        "specialization": data.get("specialization") or data.get("specialization_name") or old.get("specialization"),
    })
    return jsonify({"message": "Job updated"})


@app.route("/api/jobs/<int:job_id>", methods=["DELETE"])
@admin_required
def delete_job(job_id):
    exec_db(f"DELETE FROM jobs WHERE `{db_primary('jobs')}`=%s", (job_id,))
    return jsonify({"message": "Job deleted"})


@app.route("/api/ats/check", methods=["POST"])
@login_required
def ats_check():
    resume_text = extract_resume_text_from_request()
    if request.content_type and "multipart/form-data" in request.content_type:
        job_description = safe_text(request.form.get("job_description", request.form.get("target_job", "")))
    else:
        data = get_json()
        job_description = safe_text(data.get("job_description", data.get("target_job", "")))
    if not resume_text:
        return jsonify({"error": "Resume PDF/DOCX/TXT file or resume text is required"}), 400
    fallback = local_ats_score(resume_text, job_description)
    prompt = f"""
You are a strict ATS engine and technical recruiter. Score the resume against the job description.
Return valid JSON only using this schema:
{{
  "ats_score": 0,
  "summary": "clear 3-4 sentence explanation",
  "matched_keywords": [],
  "missing_keywords": [],
  "strengths": [],
  "weaknesses": [],
  "improvements": [],
  "section_scores": {{
    "contact": 0,
    "summary": 0,
    "skills": 0,
    "experience": 0,
    "education": 0,
    "projects": 0,
    "keywords": 0,
    "job_match": 0,
    "formatting": 0
  }}
}}
Resume:
{resume_text[:9000]}
Job description:
{job_description[:5000]}
"""
    result = ai_json(prompt, fallback)
    if not isinstance(result, dict):
        result = fallback
    for key, value in fallback.items():
        result.setdefault(key, value)
    try:
        insert_dynamic("ats_results", {
            "user_id": user_id_value(request.current_user),
            "resume_name": request.form.get("resume_name", "ATS Check") if request.form else "ATS Check",
            "resume_text": resume_text,
            "target_job": job_description,
            "job_description": job_description,
            "ats_score": result.get("ats_score", 0),
            "score": result.get("ats_score", 0),
            "missing_keywords": json.dumps(result.get("missing_keywords", []), ensure_ascii=False),
            "matched_keywords": json.dumps(result.get("matched_keywords", []), ensure_ascii=False),
            "suggestions": json.dumps(result.get("improvements", []), ensure_ascii=False),
            "result_json": json.dumps(result, ensure_ascii=False),
        })
    except Exception as e:
        print("ATS result save failed:", e)
    return jsonify(result)


def ai_enhance_summary(summary, target_job="", skills=""):
    summary = safe_text(summary)
    target_job = safe_text(target_job)
    skills = safe_text(skills)
    fallback = improve_summary_local(summary or "Motivated technology candidate", target_job, skills)
    prompt = f"""
Improve this resume summary for ATS and recruiter readability.
Return JSON only: {{"summary":""}}
Rules: 2-3 sentences, natural wording, no fake claims.
Target job: {target_job}
Skills: {skills}
Original summary: {summary}
"""
    result = ai_json(prompt, {"summary": fallback})
    return safe_text(result.get("summary") or fallback)


def build_resume(data, enhanced_summary):
    name = safe_text(data.get("name") or data.get("full_name"))
    email = safe_text(data.get("email"))
    phone = safe_text(data.get("phone"))
    location = safe_text(data.get("location"))
    target_job = safe_text(data.get("target_job"))
    skills = safe_text(data.get("skills"))
    education = safe_text(data.get("education"))
    experience = safe_text(data.get("experience"))
    projects = safe_text(data.get("projects"))
    certifications = safe_text(data.get("certifications"))
    lines = []
    if name:
        lines.append(name.upper())
    contact = " | ".join(x for x in [email, phone, location] if x)
    if contact:
        lines.append(contact)
    if target_job:
        lines.append(f"Target Role: {target_job}")
    lines.extend(["", "PROFESSIONAL SUMMARY", enhanced_summary])
    if skills:
        lines.extend(["", "SKILLS", skills])
    if experience:
        lines.extend(["", "EXPERIENCE", experience])
    if projects:
        lines.extend(["", "PROJECTS", projects])
    if education:
        lines.extend(["", "EDUCATION", education])
    if certifications:
        lines.extend(["", "CERTIFICATIONS", certifications])
    return "\n".join(lines).strip()


def ats_score_engine(data, enhanced_summary=""):
    resume_text = " ".join(str(data.get(k) or "") for k in [
        "name", "full_name", "email", "phone", "summary", "target_job", "skills",
        "education", "experience", "projects", "certifications"
    ])
    resume_text = f"{resume_text} {enhanced_summary}"
    target_text = safe_text(data.get("job_description") or data.get("target_job"))
    result = local_ats_score(resume_text, target_text)
    return result.get("ats_score", 0), result.get("matched_keywords", [])


@app.route("/api/ats/generate", methods=["POST"])
@login_required
def generate_ats_resume():
    data = get_json()
    summary = safe_text(data.get("summary"))
    target_job = safe_text(data.get("target_job") or data.get("job_description"))
    skills = safe_text(data.get("skills"))
    if not summary and not skills and not data.get("experience") and not data.get("education") and not data.get("projects"):
        return jsonify({"error": "Please enter resume information before generating."}), 400
    enhanced_summary = ai_enhance_summary(summary, target_job, skills)
    generated_resume = build_resume(data, enhanced_summary)
    ats_score, matched_keywords = ats_score_engine(data, enhanced_summary)
    result = {
        "resume": generated_resume,
        "generated_resume": generated_resume,
        "enhanced_summary": enhanced_summary,
        "ats_score": ats_score,
        "matched_keywords": matched_keywords,
        "target_job": target_job,
    }
    return jsonify(result)


@app.route("/api/ats/save", methods=["POST"])
@login_required
def save_ats_result():
    user_id = user_id_value(request.current_user)
    data = get_json()
    result_obj = data.get("result", data)
    score = int(data.get("score", data.get("ats_score", result_obj.get("ats_score", 0) if isinstance(result_obj, dict) else 0)) or 0)
    insert_dynamic("ats_results", {
        "user_id": user_id,
        "resume_name": data.get("resume_name", "Saved Resume"),
        "target_job": data.get("target_job", ""),
        "job_description": data.get("job_description", data.get("target_job", "")),
        "ats_score": score,
        "score": score,
        "resume_text": data.get("resume_text", ""),
        "generated_resume": data.get("generated_resume", data.get("resume", "")),
        "result_json": json.dumps(result_obj, ensure_ascii=False),
    })
    return jsonify({"message": "ATS result saved"})


@app.route("/api/ats/history", methods=["GET"])
@login_required
def ats_history():
    user_id = user_id_value(request.current_user)
    pk = db_primary("ats_results")
    rows = query_db(f"SELECT * FROM ats_results WHERE user_id=%s ORDER BY `{pk}` DESC", (user_id,), fetchall=True) or []
    fixed = []
    for row in rows:
        row = dict(row)
        row["id"] = row.get("id") or row.get("ats_id")
        row["score"] = row.get("score", row.get("ats_score", 0))
        row["ats_score"] = row.get("ats_score", row.get("score", 0))
        try:
            row["result"] = json.loads(row.get("result_json") or "{}")
        except Exception:
            row["result"] = {}
        fixed.append(row)
    return jsonify(fixed)


@app.route("/api/ats/latest", methods=["GET"])
@login_required
def ats_latest():
    user_id = user_id_value(request.current_user)
    pk = db_primary("ats_results")
    row = query_db(f"SELECT * FROM ats_results WHERE user_id=%s ORDER BY `{pk}` DESC LIMIT 1", (user_id,), fetchone=True)
    if not row:
        return jsonify({})
    row = dict(row)
    try:
        row["result"] = json.loads(row.get("result_json") or "{}")
    except Exception:
        row["result"] = {}
    row["score"] = row.get("score", row.get("ats_score", 0))
    row["ats_score"] = row.get("ats_score", row.get("score", 0))
    return jsonify(row)


@app.route("/api/ats/enhance-summary", methods=["POST"])
@login_required
def enhance_ats_summary():
    data = get_json()
    summary = safe_text(data.get("summary"))
    if not summary:
        return jsonify({"error": "summary is required"}), 400
    return jsonify({"summary": ai_enhance_summary(summary, safe_text(data.get("target_job")), safe_text(data.get("skills")))})


@app.route("/api/ats/export/pdf", methods=["POST"])
@login_required
def export_resume_pdf():
    if not SimpleDocTemplate:
        return jsonify({"error": "PDF export dependency reportlab is not installed"}), 500
    data = get_json()
    resume = safe_text(data.get("resume") or data.get("generated_resume"))
    if not resume:
        return jsonify({"error": "resume is required"}), 400
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=42, leftMargin=42, topMargin=38, bottomMargin=38)
    styles = getSampleStyleSheet()
    name_style = ParagraphStyle("NameStyle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=26, alignment=TA_CENTER, textColor=colors.HexColor("#111827"), spaceAfter=4)
    contact_style = ParagraphStyle("ContactStyle", parent=styles["Normal"], fontName="Helvetica", fontSize=9, leading=12, alignment=TA_CENTER, textColor=colors.HexColor("#374151"), spaceAfter=12)
    section_style = ParagraphStyle("SectionStyle", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=15, alignment=TA_LEFT, textColor=colors.HexColor("#111827"), spaceBefore=12, spaceAfter=4)
    body_style = ParagraphStyle("BodyStyle", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=13, textColor=colors.HexColor("#1F2937"), spaceAfter=4)
    bullet_style = ParagraphStyle("BulletStyle", parent=body_style, leftIndent=14, firstLineIndent=-8, spaceAfter=3)
    small_style = ParagraphStyle("SmallStyle", parent=styles["Normal"], fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#374151"), spaceAfter=4)

    def clean_text(text):
        return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    lines = [line.strip() for line in resume.split("\n") if line.strip()]
    if not lines:
        return jsonify({"error": "resume is empty"}), 400
    story = [Paragraph(clean_text(lines[0]), name_style)]
    index = 1
    if index < len(lines) and "|" in lines[index]:
        story.append(Paragraph(clean_text(lines[index]), contact_style))
        index += 1
    if index < len(lines) and lines[index].lower().startswith("target role"):
        story.append(Paragraph(clean_text(lines[index]), small_style))
        index += 1
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#111827"), spaceBefore=4, spaceAfter=8))
    for line in lines[index:]:
        clean = clean_text(line)
        if line.isupper() and len(line) <= 45:
            story.append(Spacer(1, 5))
            story.append(Paragraph(clean, section_style))
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#D1D5DB"), spaceBefore=1, spaceAfter=5))
        elif line.startswith("- "):
            story.append(Paragraph("• " + clean[2:], bullet_style))
        else:
            story.append(Paragraph(clean, body_style))
    doc.build(story)
    buffer.seek(0)
    return send_file(buffer, as_attachment=True, download_name="SQR_Resume.pdf", mimetype="application/pdf")


@app.route("/api/ats/export/docx", methods=["POST"])
@login_required
def export_resume_docx():
    if not Document:
        return jsonify({"error": "DOCX export dependency python-docx is not installed"}), 500
    data = get_json()
    resume = safe_text(data.get("resume") or data.get("generated_resume"))
    if not resume:
        return jsonify({"error": "resume is required"}), 400
    doc = Document()
    for line in resume.split("\n"):
        stripped = line.strip()
        if stripped.isupper() and len(stripped) < 40:
            doc.add_heading(stripped, level=1)
        elif stripped.startswith("- "):
            doc.add_paragraph(stripped[2:], style="List Bullet")
        else:
            doc.add_paragraph(line)
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return send_file(buffer, as_attachment=True, download_name="SQR_Resume.docx", mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.route("/api/recommendation/quiz", methods=["GET"])
@login_required
def recommendation_quiz():
    return jsonify({
        "title": "AI Computer Science Specialization Quiz",
        "description": "Answer these questions and the AI will recommend the best CS specialization for you.",
        "questions": [
            {"id": 1, "question": "What type of work do you enjoy most?", "options": ["Building websites, apps, and software systems", "Protecting systems and investigating cyber attacks", "Working with data, databases, and analytics", "Training AI models and building intelligent systems"]},
            {"id": 2, "question": "Which tools or topics sound most interesting to you?", "options": ["Python, machine learning, automation, math", "Linux, networks, ethical hacking, forensics", "SQL, databases, cloud pipelines, ETL", "JavaScript, APIs, frontend, backend"]},
            {"id": 3, "question": "What kind of problem do you prefer solving?", "options": ["Predicting results and making systems smarter", "Finding weaknesses and securing systems", "Organizing and processing large amounts of data", "Creating useful applications for users"]},
            {"id": 4, "question": "Which project would you choose?", "options": ["AI chatbot or recommendation system", "Security audit or digital forensics case", "Data warehouse or dashboard", "Full-stack web application"]},
            {"id": 5, "question": "What career goal fits you best?", "options": ["AI Engineer or Machine Learning Engineer", "Cybersecurity Analyst or Digital Forensics Investigator", "Data Engineer or Data Analyst", "Software Engineer or Full-Stack Developer"]},
        ]
    })


def local_ai_specialization_fallback(answer_text):
    text = answer_text.lower()
    scores = {
        "Artificial Intelligence": ["ai", "machine learning", "model", "chatbot", "prediction", "automation", "python", "math", "intelligent"],
        "Cybersecurity": ["security", "cyber", "hacking", "linux", "network", "forensics", "attack", "protect", "vulnerabilities"],
        "Data Engineering": ["data", "sql", "database", "pipeline", "etl", "warehouse", "cloud", "dashboard", "analytics"],
        "Software Engineering": ["software", "web", "app", "javascript", "api", "frontend", "backend", "full-stack", "systems"],
        "Cloud Computing": ["cloud", "aws", "devops", "docker", "deployment", "servers", "scale"],
        "Computer Networks": ["network", "routing", "switching", "protocol", "infrastructure"],
    }
    results = []
    for name, keywords in scores.items():
        matched = [k for k in keywords if k in text]
        score = min(100, 45 + len(matched) * 10) if matched else 20
        results.append({
            "name": name,
            "match_score": score,
            "match_percentage": score,
            "reason": "This specialization matches your quiz answers because you showed interest in " + ", ".join(matched[:5]) if matched else "This is a general computer science match.",
            "skills_to_learn": matched[:6],
            "career_paths": [],
            "in_system": False,
            "specialization_id": None,
        })
    results.sort(key=lambda x: x["match_score"], reverse=True)
    return results[:3]


def get_system_specializations_for_ai():
    rows = query_db(f"SELECT * FROM specializations ORDER BY `{spec_pk_col()}` DESC", fetchall=True) or []
    fixed = []
    for row in rows:
        row = normalize_specialization(row)
        fixed.append({
            "id": row.get("id"),
            "specialization_id": row.get("specialization_id") or row.get("id"),
            "name": row.get("name"),
            "description": row.get("description"),
            "roadmap": row.get("roadmap"),
            "job_titles": row.get("job_titles"),
            "career_paths": row.get("career_paths"),
            "skills": row.get("skills", ""),
        })
    return fixed


@app.route("/api/recommendation", methods=["POST"])
@app.route("/api/recommendation/submit", methods=["POST"])
@app.route("/api/recommendations", methods=["POST"])
@login_required
def submit_recommendation_quiz():
    data = get_json()
    answers = data.get("answers", [])
    if not answers:
        legacy_text = " ".join(str(x) for x in [data.get("interests", ""), data.get("skills", ""), data.get("goal", "")] if x).strip()
        if legacy_text:
            answers = [{"question": "Student profile", "answer": legacy_text}]
        else:
            return jsonify({"error": "Answers are required"}), 400
    answer_text_parts = []
    for item in answers:
        if isinstance(item, dict):
            answer_text_parts.append(str(item.get("question", "")))
            answer_text_parts.append(str(item.get("answer", item.get("selected", ""))))
        else:
            answer_text_parts.append(str(item))
    answer_text = " ".join(answer_text_parts).strip()
    db_specs = get_system_specializations_for_ai()
    fallback_specs = local_ai_specialization_fallback(answer_text)
    fallback = {
        "recommended_specializations": fallback_specs,
        "best_match": fallback_specs[0]["name"] if fallback_specs else "Software Engineering",
        "summary": "Recommendation generated from quiz answers using local fallback logic.",
        "roadmap": [
            "Start with beginner courses in the recommended specialization.",
            "Build one small project related to the field.",
            "Take quizzes to measure your progress.",
            "Use the ATS checker to prepare your resume for related jobs."
        ]
    }
    prompt = f"""
You are an expert computer science academic advisor.
Recommend the best computer science specialization based on the quiz answers.
Return JSON only in this format:
{{
  "recommended_specializations": [
    {{
      "name": "",
      "match_score": 0,
      "match_percentage": 0,
      "reason": "",
      "skills_to_learn": [],
      "career_paths": [],
      "in_system": false,
      "specialization_id": null
    }}
  ],
  "best_match": "",
  "summary": "",
  "roadmap": []
}}
User quiz answers:
{answer_text}
Available system specializations:
{json.dumps(db_specs, ensure_ascii=False)}
Allowed CS specialization examples:
{json.dumps(CS_SPECIALIZATION_BANK, ensure_ascii=False)}
"""
    result = ai_json(prompt, fallback)
    if not isinstance(result, dict):
        result = fallback
    assessment_id = None
    try:
        assessment_id = insert_dynamic("assessments", {
            "user_id": user_id_value(request.current_user),
            "title": "AI Computer Science Specialization Quiz",
            "description": answer_text,
            "interests": answer_text,
            "skills": "",
            "goal": "",
            "total_score": 0,
        })
        for item in answers:
            question = item.get("question", "Recommendation Question") if isinstance(item, dict) else "Recommendation Question"
            answer = item.get("answer", item.get("selected", item)) if isinstance(item, dict) else item
            insert_dynamic("assessment_answers", {
                "assessment_id": assessment_id,
                "question_text": str(question),
                "question": str(question),
                "selected_option": str(answer),
                "selected_answer": str(answer),
                "score": 1,
            })
    except Exception as e:
        print("Assessment save skipped:", e)
    for rec in result.get("recommended_specializations", []):
        rec_name = str(rec.get("name", "")).lower().strip()
        matched_db_spec = None
        for spec in db_specs:
            if str(spec.get("name", "")).lower().strip() == rec_name:
                matched_db_spec = spec
                break
        if matched_db_spec:
            sid = matched_db_spec.get("specialization_id") or matched_db_spec.get("id")
            rec["in_system"] = True
            rec["specialization_id"] = sid
            rec["id"] = sid
            try:
                insert_dynamic("specialization_recommendations", {
                    "user_id": user_id_value(request.current_user),
                    "spec_id": sid,
                    "assessment_id": assessment_id,
                    "match_percentage": rec.get("match_percentage", rec.get("match_score", 0)),
                    "matched_skills": json.dumps(rec.get("skills_to_learn", []), ensure_ascii=False),
                    "missing_skills": "",
                    "reason": rec.get("reason", ""),
                })
            except Exception:
                pass
        else:
            rec["in_system"] = False
            rec["specialization_id"] = None
            rec["id"] = None
        rec.setdefault("match_percentage", rec.get("match_score", 0))
    result["assessment_id"] = assessment_id
    return jsonify(result)


@app.route("/api/recommendations/analyze", methods=["POST"])
@login_required
def analyze_recommendations():
    return submit_recommendation_quiz()


@app.route("/api/specialization-recommendations")
@login_required
def get_specialization_recommendations():
    if not table_exists("specialization_recommendations"):
        return jsonify([])
    rows = query_db(
        """
        SELECT sr.*, s.name, s.description, s.image, s.roadmap, s.job_titles, s.career_paths
        FROM specialization_recommendations sr
        JOIN specializations s ON s.id=sr.spec_id
        WHERE sr.user_id=%s
        ORDER BY sr.created_at DESC
        """,
        (user_id_value(request.current_user),),
        fetchall=True
    ) or []
    for row in rows:
        row["image_url"] = upload_url(row.get("image")) if row.get("image") else ""
        row["specialization_id"] = row.get("spec_id")
        row["match_score"] = row.get("match_percentage", 0)
        row["explanation"] = row.get("reason", "")
    return jsonify(rows)


@app.route("/api/job-recommendations")
@login_required
def get_job_recommendations():
    user_id = user_id_value(request.current_user)
    profile_text = current_profile_text()
    jobs = query_db(f"SELECT * FROM jobs ORDER BY `{db_primary('jobs')}` DESC", fetchall=True) or []
    result = []
    for job in jobs:
        job = normalize_job(job)
        job_text = f"{job.get('title','')} {job.get('description','')} {job.get('skills','')} {job.get('specialization','')}"
        score, matches = calculate_match_percentage(profile_text, job_text)
        if score > 0:
            job["match_percentage"] = score
            job["matched_skills"] = matches
            result.append(job)
            try:
                insert_dynamic("job_recommendations", {
                    "user_id": user_id,
                    "job_id": job.get("id"),
                    "match_percentage": score,
                    "matched_skills": json.dumps(matches, ensure_ascii=False),
                    "reason": "Matched skills: " + ", ".join(matches[:8]),
                })
            except Exception:
                pass
    result.sort(key=lambda x: x.get("match_percentage", 0), reverse=True)
    return jsonify(result[:10])


@app.route("/api/admin/stats")
@app.route("/api/admin/dashboard")
@app.route("/api/admin/dashboard/stats")
@admin_required
def admin_stats():
    def count(table):
        if not table_exists(table):
            return 0
        row = query_db(f"SELECT COUNT(*) AS total FROM `{table}`", fetchone=True)
        return int(row.get("total") or 0) if row else 0
    stats = {
        "users": count("users"),
        "admins": query_db("SELECT COUNT(*) AS total FROM users WHERE role='admin'", fetchone=True).get("total", 0) if table_exists("users") and column_exists("users", "role") else 0,
        "students": query_db("SELECT COUNT(*) AS total FROM users WHERE role='student'", fetchone=True).get("total", 0) if table_exists("users") and column_exists("users", "role") else 0,
        "specializations": count("specializations"),
        "courses": count("courses"),
        "quizzes": count("quizzes"),
        "questions": count("quiz_questions"),
        "jobs": count("jobs"),
        "certificates": count("certificates"),
        "course_enrollments": count("course_enrollments"),
        "specialization_enrollments": count("specialization_enrollments"),
        "quiz_attempts": count("quiz_attempts"),
        "ats_results": count("ats_results"),
    }
    return jsonify(stats)


try:
    if os.getenv("SQR_INIT_DB", "1") == "1":
        init_db()
    ensure_runtime_schema()
    print("SQR database schema compatibility checked")
except Exception as e:
    print("Schema startup check skipped:", e)


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(413)
def too_large(error):
    return jsonify({"error": "File is too large"}), 413


@app.errorhandler(Exception)
def show_real_error(error):
    import traceback
    traceback.print_exc()
    return jsonify({"error": "Server error", "details": str(error), "trace": traceback.format_exc()}), 500


if __name__ == "__main__":
    app.run(
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("FLASK_PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
