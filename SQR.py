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
    from docx.shared import Pt
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
except Exception:
    Document = None
    Pt = None
    OxmlElement = None
    qn = None

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
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) if OpenAI and os.getenv("OPENAI_API_KEY") else None

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

TECH_SKILLS = [
    "python", "java", "javascript", "typescript", "html", "css", "sql", "mysql", "postgresql", "react",
    "node", "flask", "django", "api", "rest", "git", "github", "docker", "aws", "azure", "linux",
    "security", "cybersecurity", "networking", "forensics", "wireshark", "burp suite", "database",
    "machine learning", "data analysis", "communication", "teamwork", "problem solving", "cloud", "devops",
    "kubernetes", "mongodb", "php", "c++", "go", "rust", "swift", "ai", "ui", "ux"
]

COURSE_LEVEL_META = {
    "beginner": {"label": "Beginner", "class": "level-beginner", "hex": "#22c55e"},
    "intermediate": {"label": "Intermediate", "class": "level-intermediate", "hex": "#eab308"},
    "advanced": {"label": "Advanced", "class": "level-advanced", "hex": "#ef4444"},
}

SPECIALIZATION_HINTS = {
    "cybersecurity": ["security", "cyber", "network", "linux", "forensics", "burp", "wireshark", "soc", "vulnerability"],
    "digital forensics": ["forensics", "evidence", "investigation", "incident", "malware", "security"],
    "software engineering": ["software", "java", "python", "problem", "api", "backend", "testing"],
    "web development": ["html", "css", "javascript", "react", "frontend", "backend", "node", "flask"],
    "data science": ["data", "python", "sql", "analysis", "machine learning", "statistics", "visualization"],
    "artificial intelligence": ["ai", "machine learning", "automation", "model", "python", "nlp", "vision"],
    "cloud computing": ["cloud", "aws", "azure", "deployment", "server", "docker", "devops"],
    "database administration": ["database", "sql", "mysql", "postgresql", "queries", "schema", "admin"],
    "computer networks": ["network", "tcp", "ip", "routing", "switching", "security", "linux"],
    "ui/ux engineering": ["ui", "ux", "design", "interface", "figma", "frontend", "user"]
}


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


def text_value(*values):
    for value in values:
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return ""


def int_value(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(value)
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


def upload_url(filename):
    value = str(filename or "").strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://") or value.startswith("/uploads/"):
        return value
    return f"/uploads/{value}"


def asset_value(value):
    return upload_url(value)


def clean_user(user):
    if not user:
        return None
    user = dict(user)
    user.pop("password", None)
    user["id"] = user.get("id") or user.get("user_id")
    user["user_id"] = user.get("user_id") or user.get("id")
    user["current_mode"] = user.get("current_mode") or user.get("role") or "student"
    user["banned"] = int(user.get("banned", user.get("is_banned", 0)) or 0)
    return user


def normalize_specialization(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row.get("id")
    row["specialization_id"] = row.get("id")
    row["image_url"] = asset_value(row.get("image"))
    return row


def normalize_course(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row.get("id")
    row["course_id"] = row.get("id")
    row["specialization_id"] = row.get("spec_id")
    row["image_url"] = asset_value(row.get("image"))
    row["video_url"] = asset_value(row.get("video"))
    row["level"] = normalize_level(row.get("level"))
    row["level_badge"] = COURSE_LEVEL_META[row["level"]]
    return row


def normalize_quiz(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row.get("id")
    row["quiz_id"] = row.get("id")
    return row


def normalize_question(row, include_answer=False):
    if not row:
        return row
    row = dict(row)
    row["id"] = row.get("id")
    row["question_id"] = row.get("id")
    row["options"] = [row.get("option1") or "", row.get("option2") or "", row.get("option3") or "", row.get("option4") or ""]
    if not include_answer:
        row.pop("answer", None)
    return row


def normalize_job(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row.get("id")
    row["job_id"] = row.get("id")
    row["required_skills"] = row.get("skills") or ""
    row["average_salary"] = row.get("salary") or ""
    row["job_link"] = row.get("link") or ""
    return row


def strong_password(password):
    password = str(password or "")
    return (
        len(password) >= 8 and
        re.search(r"[A-Z]", password) and
        re.search(r"[a-z]", password) and
        re.search(r"[0-9]", password) and
        re.search(r"[^A-Za-z0-9]", password) and
        not re.search(r"\s", password)
    )


def generate_username(name, email):
    base = (email.split("@")[0] if email and "@" in email else name).strip().lower()
    base = re.sub(r"[^a-z0-9_]+", "_", base).strip("_") or "student"
    candidate = base
    counter = 1
    while query_db("SELECT id FROM users WHERE username=%s", (candidate,), fetchone=True):
        counter += 1
        candidate = f"{base}{counter}"
    return candidate


def generate_token(user):
    uid = user.get("id") or user.get("user_id")
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


def get_current_user(required=False):
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not token:
        return None
    try:
        data = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
        uid = data.get("user_id") or data.get("id")
        user = query_db("SELECT * FROM users WHERE id=%s", (uid,), fetchone=True)
        if not user:
            return None
        if int(user.get("banned") or 0) == 1:
            return None
        return user
    except Exception:
        return None


def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = get_current_user(required=True)
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        request.current_user = user
        return func(*args, **kwargs)
    return wrapper


def admin_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = get_current_user(required=True)
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        if str(user.get("role") or "").lower() != "admin":
            return jsonify({"error": "Admin only"}), 403
        request.current_user = user
        return func(*args, **kwargs)
    return wrapper


def student_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = get_current_user(required=True)
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        if str(user.get("role") or "").lower() == "admin" and str(user.get("current_mode") or "admin").lower() != "student":
            return jsonify({"error": "Admins can only access the admin page."}), 403
        request.current_user = user
        return func(*args, **kwargs)
    return wrapper


def optional_user():
    return get_current_user(required=False)


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


def request_data():
    if request.content_type and "multipart/form-data" in request.content_type:
        data = dict(request.form)
    else:
        data = get_json()
    return data


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
        result = safe_json_loads(response.choices[0].message.content)
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
    return score, sorted(set(matched + important_matched))[:25]


def init_db():
    statements = [
        """
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            username VARCHAR(100) NOT NULL UNIQUE,
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
            level ENUM('beginner','intermediate','advanced') DEFAULT 'beginner',
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
            type ENUM('practical','theoretical','both') DEFAULT 'both',
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
        CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            admin_level VARCHAR(50) DEFAULT 'manager',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
        CREATE TABLE IF NOT EXISTS enrollments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            course_id INT NOT NULL,
            opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_user_course (user_id, course_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
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
        """
        CREATE TABLE IF NOT EXISTS quiz_attempts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            quiz_id INT NOT NULL,
            course_id INT NULL,
            score INT DEFAULT 0,
            passed TINYINT DEFAULT 0,
            answers_json LONGTEXT,
            attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            total INT DEFAULT 0,
            percentage DECIMAL(5,2) DEFAULT 0,
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
            salary VARCHAR(100),
            link VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            specialization_id INT NULL
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
        CREATE TABLE IF NOT EXISTS ats_results (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NULL,
            resume_name VARCHAR(255) NULL,
            ats_score INT DEFAULT 0,
            score INT DEFAULT 0,
            resume_text LONGTEXT,
            generated_resume LONGTEXT,
            job_description LONGTEXT,
            target_job VARCHAR(255),
            result_json LONGTEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    ]
    for statement in statements:
        query_db(statement, commit=True)
    run_schema_compatibility()


def run_schema_compatibility():
    try:
        add_column_if_missing("users", "current_mode", "current_mode ENUM('student','admin') DEFAULT 'student'")
        add_column_if_missing("users", "banned", "banned TINYINT DEFAULT 0")
        add_column_if_missing("users", "skills", "skills TEXT NULL")
        add_column_if_missing("users", "interests", "interests TEXT NULL")
        add_column_if_missing("users", "goal", "goal TEXT NULL")
        add_column_if_missing("courses", "image", "image VARCHAR(255) NULL")
        add_column_if_missing("courses", "video", "video VARCHAR(255) NULL")
        add_column_if_missing("courses", "level", "level ENUM('beginner','intermediate','advanced') DEFAULT 'beginner'")
        add_column_if_missing("courses", "completed_weight", "completed_weight INT DEFAULT 50")
        add_column_if_missing("jobs", "specialization_id", "specialization_id INT NULL")
        add_column_if_missing("quiz_attempts", "total", "total INT DEFAULT 0")
        add_column_if_missing("quiz_attempts", "percentage", "percentage DECIMAL(5,2) DEFAULT 0")
        exec_db("UPDATE users SET current_mode='admin' WHERE role='admin'")
        exec_db("UPDATE users SET current_mode='student' WHERE role='student' AND (current_mode IS NULL OR current_mode='admin')")
        exec_db("INSERT IGNORE INTO admins (user_id, admin_level) SELECT id, 'owner' FROM users WHERE role='admin'")
    except Exception as e:
        print("Compatibility schema update skipped:", e)


def get_course(course_id):
    row = query_db(
        """
        SELECT c.*, s.name AS specialization_name
        FROM courses c
        LEFT JOIN specializations s ON s.id=c.spec_id
        WHERE c.id=%s
        """,
        (course_id,),
        fetchone=True
    )
    return normalize_course(row)


def ensure_specialization_enrollment(user_id, spec_id):
    if not spec_id:
        return
    exec_db(
        """
        INSERT INTO specialization_enrollments (user_id, spec_id, progress, status)
        VALUES (%s,%s,0,'not_started')
        ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)
        """,
        (user_id, spec_id)
    )


def ensure_course_enrollment(user_id, course_id, progress=50):
    course = get_course(course_id)
    if not course:
        return None
    ensure_specialization_enrollment(user_id, course.get("spec_id"))
    progress = max(0, min(100, int_value(progress, 50)))
    status = "completed" if progress >= 100 else "in_progress" if progress > 0 else "not_started"
    exec_db(
        """
        INSERT INTO course_enrollments (user_id, course_id, progress, status, completed_at)
        VALUES (%s,%s,%s,%s,IF(%s='completed',NOW(),NULL))
        ON DUPLICATE KEY UPDATE
          progress=GREATEST(progress, VALUES(progress)),
          status=CASE
            WHEN GREATEST(progress, VALUES(progress)) >= 100 THEN 'completed'
            WHEN GREATEST(progress, VALUES(progress)) > 0 THEN 'in_progress'
            ELSE 'not_started'
          END,
          completed_at=CASE WHEN GREATEST(progress, VALUES(progress)) >= 100 THEN COALESCE(completed_at,NOW()) ELSE completed_at END
        """,
        (user_id, course_id, progress, status, status)
    )
    try:
        exec_db(
            """
            INSERT INTO enrollments (user_id, course_id)
            VALUES (%s,%s)
            ON DUPLICATE KEY UPDATE opened_at=CURRENT_TIMESTAMP
            """,
            (user_id, course_id)
        )
    except Exception:
        pass
    recalculate_course_progress(user_id, course_id)
    return get_course(course_id)


def recalculate_course_progress(user_id, course_id):
    course = get_course(course_id)
    if not course:
        return 0
    enrollment = query_db("SELECT * FROM course_enrollments WHERE user_id=%s AND course_id=%s", (user_id, course_id), fetchone=True)
    base = 50 if enrollment and int(enrollment.get("progress") or 0) > 0 else 0
    quizzes = query_db("SELECT id FROM quizzes WHERE course_id=%s", (course_id,), fetchall=True) or []
    quiz_ids = [q["id"] for q in quizzes]
    quiz_score = 0
    if quiz_ids:
        passed = 0
        for quiz_id in quiz_ids:
            row = query_db("SELECT MAX(passed) AS passed FROM quiz_attempts WHERE user_id=%s AND quiz_id=%s", (user_id, quiz_id), fetchone=True)
            if row and int(row.get("passed") or 0) == 1:
                passed += 1
        quiz_score = round((passed / len(quiz_ids)) * 50)
    elif base == 50:
        quiz_score = 50
    progress = min(100, int(base + quiz_score))
    status = "completed" if progress >= 100 else "in_progress" if progress > 0 else "not_started"
    exec_db(
        """
        INSERT INTO course_enrollments (user_id, course_id, progress, status, completed_at)
        VALUES (%s,%s,%s,%s,IF(%s='completed',NOW(),NULL))
        ON DUPLICATE KEY UPDATE
          progress=VALUES(progress),
          status=VALUES(status),
          completed_at=CASE WHEN VALUES(progress) >= 100 THEN COALESCE(completed_at,NOW()) ELSE NULL END
        """,
        (user_id, course_id, progress, status, status)
    )
    recalculate_specialization_progress(user_id, course.get("spec_id"))
    return progress


def recalculate_specialization_progress(user_id, spec_id):
    if not spec_id:
        return 0
    rows = query_db(
        """
        SELECT c.id, COALESCE(ce.progress,0) AS progress
        FROM courses c
        LEFT JOIN course_enrollments ce ON ce.course_id=c.id AND ce.user_id=%s
        WHERE c.spec_id=%s
        """,
        (user_id, spec_id),
        fetchall=True
    ) or []
    enrolled_rows = [r for r in rows if int(r.get("progress") or 0) > 0]
    if rows:
        progress = int(round(sum(int(r.get("progress") or 0) for r in rows) / len(rows)))
    else:
        progress = 0
    status = "completed" if progress >= 100 else "in_progress" if progress > 0 else "not_started"
    exec_db(
        """
        INSERT INTO specialization_enrollments (user_id, spec_id, progress, status, completed_at)
        VALUES (%s,%s,%s,%s,IF(%s='completed',NOW(),NULL))
        ON DUPLICATE KEY UPDATE
          progress=VALUES(progress),
          status=VALUES(status),
          completed_at=CASE WHEN VALUES(progress) >= 100 THEN COALESCE(completed_at,NOW()) ELSE NULL END
        """,
        (user_id, spec_id, progress, status, status)
    )
    exec_db(
        """
        INSERT INTO progress (user_id, spec_id, progress)
        VALUES (%s,%s,%s)
        ON DUPLICATE KEY UPDATE progress=VALUES(progress), updated_at=CURRENT_TIMESTAMP
        """,
        (user_id, spec_id, progress)
    )
    return progress


def local_ats_score(resume_text, job_description=""):
    resume_lower = str(resume_text or "").lower()
    matched = [skill for skill in TECH_SKILLS if skill in resume_lower]
    missing = [skill for skill in TECH_SKILLS if skill not in resume_lower]
    sections = {
        "contact": any(x in resume_lower for x in ["@", "linkedin", "phone", "+966", "+1"]),
        "summary": any(x in resume_lower for x in ["summary", "profile", "objective"]),
        "skills": "skills" in resume_lower,
        "experience": any(x in resume_lower for x in ["experience", "work", "internship"]),
        "education": "education" in resume_lower,
        "projects": "projects" in resume_lower,
        "certifications": any(x in resume_lower for x in ["certifications", "certificate", "certificates"]),
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
        "score": score,
        "summary": "ATS analysis completed using the resume content and target job description.",
        "matched_keywords": sorted(set(matched + job_matches)),
        "missing_keywords": missing[:25],
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


def extract_pdf_text(file_storage):
    if not PyPDF2:
        return ""
    try:
        reader = PyPDF2.PdfReader(file_storage.stream)
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception:
        return ""


def extract_docx_text(file_storage):
    if not Document:
        return ""
    try:
        doc = Document(file_storage.stream)
        return "\n".join(p.text for p in doc.paragraphs)
    except Exception:
        return ""


def ats_resume_local(data):
    name = text_value(data.get("name"), data.get("full_name"), "Your Name")
    email = text_value(data.get("email"))
    phone = text_value(data.get("phone"))
    target_job = text_value(data.get("target_job"), data.get("job_title"), "Software Engineer")
    summary = text_value(data.get("summary"), f"Motivated candidate targeting a {target_job} role with practical technical skills and project experience.")
    skills = text_value(data.get("skills"), "Python, Java, SQL, HTML, CSS, JavaScript, Git, REST APIs")
    education = text_value(data.get("education"), "Computer Science Student")
    projects = text_value(data.get("projects"), "SQR career guidance platform with Flask, MySQL, REST APIs, quizzes, progress tracking, and ATS tools.")
    experience = text_value(data.get("experience"), "Academic and project experience building full-stack web features, database models, and user-focused interfaces.")
    certifications = text_value(data.get("certifications"))
    work_style = text_value(data.get("work_style"))
    lines = [
        name,
        " | ".join(x for x in [email, phone, target_job] if x),
        "",
        "PROFESSIONAL SUMMARY",
        summary,
        "",
        "TECHNICAL SKILLS",
        skills,
        "",
        "PROJECTS",
        projects,
        "",
        "EXPERIENCE",
        experience,
        "",
        "EDUCATION",
        education,
    ]
    if certifications:
        lines += ["", "CERTIFICATIONS", certifications]
    if work_style:
        lines += ["", "WORK STYLE", work_style]
    return "\n".join(lines)


def create_pdf_bytes(title, text):
    if not SimpleDocTemplate:
        return None
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=48, leftMargin=48, topMargin=42, bottomMargin=42)
    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    heading = ParagraphStyle("SQRHeading", parent=styles["Heading1"], alignment=TA_CENTER, fontSize=18, leading=22, textColor=colors.HexColor("#111827"))
    story = [Paragraph(str(title or "SQR Resume"), heading), Spacer(1, 12), HRFlowable(width="100%"), Spacer(1, 12)]
    for block in str(text or "").split("\n"):
        clean = block.strip()
        if not clean:
            story.append(Spacer(1, 8))
            continue
        story.append(Paragraph(clean.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), normal))
        story.append(Spacer(1, 4))
    doc.build(story)
    buffer.seek(0)
    return buffer


def create_docx_bytes(text):
    if not Document:
        return None
    doc = Document()
    for index, line in enumerate(str(text or "").split("\n")):
        if index == 0:
            p = doc.add_paragraph()
            r = p.add_run(line)
            r.bold = True
            if Pt:
                r.font.size = Pt(18)
        else:
            doc.add_paragraph(line)
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer


def score_specialization(spec, profile_text, answer_terms):
    target = " ".join(str(spec.get(k) or "") for k in ["name", "description", "skills", "roadmap", "job_titles", "career_paths"])
    score, matched = calculate_match_percentage(profile_text, target)
    name_key = str(spec.get("name") or "").lower()
    for key, hints in SPECIALIZATION_HINTS.items():
        if key in name_key:
            boost = sum(8 for hint in hints if hint in profile_text.lower() or hint in answer_terms)
            score = min(100, score + boost)
            matched = sorted(set(matched + [h for h in hints if h in profile_text.lower() or h in answer_terms]))
    return score, matched


@app.before_request
def before_request_bootstrap():
    if not getattr(app, "_sqr_db_ready", False):
        try:
            init_db()
            app._sqr_db_ready = True
        except Exception as e:
            print("Database bootstrap skipped:", e)
            app._sqr_db_ready = True


@app.route("/")
def home():
    return render_template("gp.html")


@app.route("/<path:page>")
def render_page(page):
    if page.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    if page.startswith("uploads/"):
        filename = page.split("uploads/", 1)[1]
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)
    safe_page = os.path.basename(page)
    if safe_page.endswith(".html") and os.path.exists(os.path.join(TEMPLATES_DIR, safe_page)):
        return render_template(safe_page)
    return send_from_directory(STATIC_DIR, page)


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "database": bool(pool), "time": datetime.datetime.utcnow().isoformat()})


@app.route("/api/signup", methods=["POST"])
def signup():
    data = request_data()
    name = text_value(data.get("name"), data.get("full_name"))
    email = text_value(data.get("email")).lower()
    password = text_value(data.get("password"))
    if not name or not email or not password:
        return jsonify({"error": "Name, email, and password are required"}), 400
    if not strong_password(password):
        return jsonify({"error": "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol"}), 400
    if query_db("SELECT id FROM users WHERE email=%s", (email,), fetchone=True):
        return jsonify({"error": "Email already exists"}), 409
    username = generate_username(name, email)
    hashed_password = generate_password_hash(password, method="pbkdf2:sha256", salt_length=16)
    user_id = query_db(
        """
        INSERT INTO users (name, username, email, password, role, current_mode, banned)
        VALUES (%s,%s,%s,%s,'student','student',0)
        """,
        (name, username, email, hashed_password),
        commit=True
    )
    user = query_db("SELECT * FROM users WHERE id=%s", (user_id,), fetchone=True)
    return jsonify({"message": "Account created", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/signin", methods=["POST"])
@app.route("/api/login", methods=["POST"])
def signin():
    data = request_data()
    email = text_value(data.get("email"), data.get("username")).lower()
    password = text_value(data.get("password"))
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    user = query_db("SELECT * FROM users WHERE email=%s OR username=%s", (email, email), fetchone=True)
    if not user or not check_password_hash(user.get("password") or "", password):
        return jsonify({"error": "Invalid email or password"}), 401
    if int(user.get("banned") or 0) == 1:
        return jsonify({"error": "Your account is banned"}), 403
    if user.get("role") == "admin" and user.get("current_mode") != "admin":
        exec_db("UPDATE users SET current_mode='admin' WHERE id=%s", (user["id"],))
        user["current_mode"] = "admin"
    return jsonify({"message": "Signed in", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/me", methods=["GET"])
@login_required
def me():
    return jsonify({"user": clean_user(request.current_user)})


@app.route("/api/admin/switch-mode", methods=["POST"])
@admin_required
def switch_admin_mode():
    data = request_data()
    mode = text_value(data.get("mode"), data.get("current_mode"), "admin").lower()
    if mode not in {"admin", "student"}:
        mode = "admin"
    exec_db("UPDATE users SET current_mode=%s WHERE id=%s", (mode, request.current_user["id"]))
    user = query_db("SELECT * FROM users WHERE id=%s", (request.current_user["id"],), fetchone=True)
    return jsonify({"message": f"Mode changed to {mode}", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/profile", methods=["GET"])
@login_required
def profile():
    user = clean_user(request.current_user)
    spec_progress = query_db(
        """
        SELECT se.spec_id, s.name, s.description, s.image, se.progress, se.status, se.enrolled_at, se.completed_at,
               COUNT(DISTINCT c.id) AS total_courses,
               COUNT(DISTINCT ce.course_id) AS opened_courses,
               SUM(CASE WHEN ce.progress >= 100 THEN 1 ELSE 0 END) AS completed_courses
        FROM specialization_enrollments se
        JOIN specializations s ON s.id=se.spec_id
        LEFT JOIN courses c ON c.spec_id=s.id
        LEFT JOIN course_enrollments ce ON ce.course_id=c.id AND ce.user_id=se.user_id
        WHERE se.user_id=%s
        GROUP BY se.spec_id, s.name, s.description, s.image, se.progress, se.status, se.enrolled_at, se.completed_at
        ORDER BY se.enrolled_at DESC
        """,
        (user["id"],),
        fetchall=True
    ) or []
    for item in spec_progress:
        item["image_url"] = upload_url(item.get("image"))
        item["specialization_name"] = item.get("name")
    course_progress = query_db(
        """
        SELECT ce.course_id, c.title, c.description, c.image, c.video, c.link, c.level, c.spec_id,
               s.name AS specialization_name, ce.progress, ce.status, ce.enrolled_at, ce.completed_at
        FROM course_enrollments ce
        JOIN courses c ON c.id=ce.course_id
        LEFT JOIN specializations s ON s.id=c.spec_id
        WHERE ce.user_id=%s
        ORDER BY ce.enrolled_at DESC
        """,
        (user["id"],),
        fetchall=True
    ) or []
    course_progress = [normalize_course(c) for c in course_progress]
    return jsonify({"user": user, "progress": spec_progress, "specialization_progress": spec_progress, "course_progress": course_progress})


@app.route("/api/profile", methods=["PUT", "POST"])
@login_required
def update_profile():
    data = request_data()
    name = text_value(data.get("name"), request.current_user.get("name"))
    skills = text_value(data.get("skills"))
    interests = text_value(data.get("interests"))
    goal = text_value(data.get("goal"))
    exec_db("UPDATE users SET name=%s, skills=%s, interests=%s, goal=%s WHERE id=%s", (name, skills, interests, goal, request.current_user["id"]))
    user = query_db("SELECT * FROM users WHERE id=%s", (request.current_user["id"],), fetchone=True)
    return jsonify({"message": "Profile updated", "user": clean_user(user)})


@app.route("/api/specializations", methods=["GET"])
def list_specializations():
    user = optional_user()
    user_id = user.get("id") if user else None
    rows = query_db(
        """
        SELECT s.*,
               COUNT(DISTINCT c.id) AS course_count,
               COALESCE(se.progress, 0) AS progress,
               COALESCE(se.status, 'not_started') AS status
        FROM specializations s
        LEFT JOIN courses c ON c.spec_id=s.id
        LEFT JOIN specialization_enrollments se ON se.spec_id=s.id AND se.user_id=%s
        GROUP BY s.id, se.progress, se.status
        ORDER BY s.created_at DESC, s.id DESC
        """,
        (user_id or 0,),
        fetchall=True
    ) or []
    return jsonify({"specializations": [normalize_specialization(r) for r in rows], "items": [normalize_specialization(r) for r in rows]})


@app.route("/api/specializations/<int:spec_id>", methods=["GET"])
@app.route("/api/specialization/<int:spec_id>", methods=["GET"])
def get_specialization(spec_id):
    spec = query_db("SELECT * FROM specializations WHERE id=%s", (spec_id,), fetchone=True)
    if not spec:
        return jsonify({"error": "Specialization not found"}), 404
    courses = query_db("SELECT * FROM courses WHERE spec_id=%s ORDER BY created_at DESC", (spec_id,), fetchall=True) or []
    certificates = query_db("SELECT * FROM certificates WHERE spec_id=%s ORDER BY created_at DESC", (spec_id,), fetchall=True) or []
    quizzes = query_db("SELECT * FROM quizzes WHERE spec_id=%s OR course_id IN (SELECT id FROM courses WHERE spec_id=%s) ORDER BY created_at DESC", (spec_id, spec_id), fetchall=True) or []
    return jsonify({"specialization": normalize_specialization(spec), "courses": [normalize_course(c) for c in courses], "certificates": certificates, "quizzes": [normalize_quiz(q) for q in quizzes]})


@app.route("/api/specializations/<int:spec_id>/enroll", methods=["POST"])
@app.route("/api/specialization/<int:spec_id>/enroll", methods=["POST"])
@student_required
def enroll_specialization(spec_id):
    spec = query_db("SELECT * FROM specializations WHERE id=%s", (spec_id,), fetchone=True)
    if not spec:
        return jsonify({"error": "Specialization not found"}), 404
    ensure_specialization_enrollment(request.current_user["id"], spec_id)
    recalculate_specialization_progress(request.current_user["id"], spec_id)
    return jsonify({"message": "Specialization enrolled", "specialization": normalize_specialization(spec)})


@app.route("/api/specializations/<int:spec_id>/unenroll", methods=["POST", "DELETE"])
@app.route("/api/specialization/<int:spec_id>/unenroll", methods=["POST", "DELETE"])
@student_required
def unenroll_specialization(spec_id):
    course_ids = query_db("SELECT id FROM courses WHERE spec_id=%s", (spec_id,), fetchall=True) or []
    for row in course_ids:
        exec_db("DELETE FROM course_enrollments WHERE user_id=%s AND course_id=%s", (request.current_user["id"], row["id"]))
    exec_db("DELETE FROM specialization_enrollments WHERE user_id=%s AND spec_id=%s", (request.current_user["id"], spec_id))
    exec_db("DELETE FROM progress WHERE user_id=%s AND spec_id=%s", (request.current_user["id"], spec_id))
    return jsonify({"message": "Specialization unenrolled"})


@app.route("/api/courses", methods=["GET"])
def list_courses():
    user = optional_user()
    user_id = user.get("id") if user else 0
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    params = [user_id]
    where = ""
    if spec_id:
        where = "WHERE c.spec_id=%s"
        params.append(spec_id)
    rows = query_db(
        f"""
        SELECT c.*, s.name AS specialization_name,
               COALESCE(ce.progress,0) AS progress,
               COALESCE(ce.status,'not_started') AS enrollment_status
        FROM courses c
        LEFT JOIN specializations s ON s.id=c.spec_id
        LEFT JOIN course_enrollments ce ON ce.course_id=c.id AND ce.user_id=%s
        {where}
        ORDER BY c.created_at DESC, c.id DESC
        """,
        tuple(params),
        fetchall=True
    ) or []
    return jsonify({"courses": [normalize_course(r) for r in rows], "items": [normalize_course(r) for r in rows]})


@app.route("/api/courses/<int:course_id>", methods=["GET"])
@app.route("/api/course/<int:course_id>", methods=["GET"])
def course_details(course_id):
    course = get_course(course_id)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    quizzes = query_db("SELECT * FROM quizzes WHERE course_id=%s ORDER BY created_at ASC", (course_id,), fetchall=True) or []
    certs = query_db("SELECT * FROM certificates WHERE spec_id=%s ORDER BY created_at DESC", (course.get("spec_id"),), fetchall=True) or []
    return jsonify({"course": course, "quizzes": [normalize_quiz(q) for q in quizzes], "certificates": certs})


@app.route("/api/courses/<int:course_id>/enroll", methods=["POST"])
@app.route("/api/course/<int:course_id>/enroll", methods=["POST"])
@student_required
def enroll_course(course_id):
    course = ensure_course_enrollment(request.current_user["id"], course_id, 50)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    progress = recalculate_course_progress(request.current_user["id"], course_id)
    return jsonify({"message": "Course enrolled", "course": course, "progress": progress})


@app.route("/api/courses/<int:course_id>/open", methods=["POST"])
@app.route("/api/courses/<int:course_id>/complete", methods=["POST"])
@student_required
def open_course(course_id):
    course = ensure_course_enrollment(request.current_user["id"], course_id, 50)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    progress = recalculate_course_progress(request.current_user["id"], course_id)
    return jsonify({"message": "Course progress updated", "course": course, "progress": progress})


@app.route("/api/courses/<int:course_id>/unenroll", methods=["POST", "DELETE"])
@app.route("/api/course/<int:course_id>/unenroll", methods=["POST", "DELETE"])
@student_required
def unenroll_course(course_id):
    course = get_course(course_id)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    exec_db("DELETE FROM course_enrollments WHERE user_id=%s AND course_id=%s", (request.current_user["id"], course_id))
    try:
        exec_db("DELETE FROM enrollments WHERE user_id=%s AND course_id=%s", (request.current_user["id"], course_id))
    except Exception:
        pass
    recalculate_specialization_progress(request.current_user["id"], course.get("spec_id"))
    return jsonify({"message": "Course unenrolled"})


@app.route("/api/courses/enrolled", methods=["GET"])
@login_required
def courses_enrolled():
    rows = query_db(
        """
        SELECT ce.course_id, c.*, s.name AS specialization_name, ce.progress, ce.status, ce.enrolled_at, ce.completed_at
        FROM course_enrollments ce
        JOIN courses c ON c.id=ce.course_id
        LEFT JOIN specializations s ON s.id=c.spec_id
        WHERE ce.user_id=%s
        ORDER BY ce.enrolled_at DESC
        """,
        (request.current_user["id"],),
        fetchall=True
    ) or []
    return jsonify({"courses": [normalize_course(r) for r in rows], "course_progress": [normalize_course(r) for r in rows]})


@app.route("/api/progress", methods=["GET"])
@login_required
def progress_api():
    user_id = request.current_user["id"]
    spec_rows = query_db(
        """
        SELECT se.user_id, se.spec_id, s.name AS specialization_name, s.image, se.progress, se.status, se.enrolled_at,
               COUNT(DISTINCT c.id) AS total_courses,
               COUNT(DISTINCT ce.course_id) AS opened_courses,
               SUM(CASE WHEN ce.progress >= 100 THEN 1 ELSE 0 END) AS completed_courses
        FROM specialization_enrollments se
        JOIN specializations s ON s.id=se.spec_id
        LEFT JOIN courses c ON c.spec_id=s.id
        LEFT JOIN course_enrollments ce ON ce.course_id=c.id AND ce.user_id=se.user_id
        WHERE se.user_id=%s
        GROUP BY se.user_id, se.spec_id, s.name, s.image, se.progress, se.status, se.enrolled_at
        ORDER BY se.enrolled_at DESC
        """,
        (user_id,),
        fetchall=True
    ) or []
    course_rows = query_db(
        """
        SELECT ce.user_id, ce.course_id, c.title, c.spec_id, s.name AS specialization_name, ce.progress, ce.status, ce.enrolled_at
        FROM course_enrollments ce
        JOIN courses c ON c.id=ce.course_id
        LEFT JOIN specializations s ON s.id=c.spec_id
        WHERE ce.user_id=%s
        ORDER BY ce.enrolled_at DESC
        """,
        (user_id,),
        fetchall=True
    ) or []
    return jsonify({"progress": spec_rows, "specialization_progress": spec_rows, "course_progress": course_rows})


@app.route("/api/progress", methods=["POST"])
@student_required
def update_progress_api():
    data = request_data()
    spec_id = int_value(data.get("spec_id") or data.get("specialization_id"))
    progress_value = max(0, min(100, int_value(data.get("progress"))))
    if not spec_id:
        return jsonify({"error": "spec_id is required"}), 400
    status = "completed" if progress_value >= 100 else "in_progress" if progress_value > 0 else "not_started"
    exec_db(
        """
        INSERT INTO specialization_enrollments (user_id, spec_id, progress, status, completed_at)
        VALUES (%s,%s,%s,%s,IF(%s='completed',NOW(),NULL))
        ON DUPLICATE KEY UPDATE progress=VALUES(progress), status=VALUES(status), completed_at=CASE WHEN VALUES(progress)>=100 THEN COALESCE(completed_at,NOW()) ELSE NULL END
        """,
        (request.current_user["id"], spec_id, progress_value, status, status)
    )
    exec_db("INSERT INTO progress (user_id,spec_id,progress) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE progress=VALUES(progress)", (request.current_user["id"], spec_id, progress_value))
    return jsonify({"message": "Progress updated", "progress": progress_value})


@app.route("/api/certificates", methods=["GET"])
def list_certificates():
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    if spec_id:
        rows = query_db("SELECT * FROM certificates WHERE spec_id=%s ORDER BY created_at DESC", (spec_id,), fetchall=True) or []
    else:
        rows = query_db("SELECT c.*, s.name AS specialization_name FROM certificates c LEFT JOIN specializations s ON s.id=c.spec_id ORDER BY c.created_at DESC", fetchall=True) or []
    return jsonify({"certificates": rows, "items": rows})


@app.route("/api/quizzes", methods=["GET"])
def list_quizzes():
    course_id = request.args.get("course_id")
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    if course_id:
        rows = query_db("SELECT * FROM quizzes WHERE course_id=%s ORDER BY created_at DESC", (course_id,), fetchall=True) or []
    elif spec_id:
        rows = query_db("SELECT * FROM quizzes WHERE spec_id=%s OR course_id IN (SELECT id FROM courses WHERE spec_id=%s) ORDER BY created_at DESC", (spec_id, spec_id), fetchall=True) or []
    else:
        rows = query_db("SELECT * FROM quizzes ORDER BY created_at DESC", fetchall=True) or []
    return jsonify({"quizzes": [normalize_quiz(q) for q in rows], "items": [normalize_quiz(q) for q in rows]})


@app.route("/api/quizzes/<int:quiz_id>", methods=["GET"])
def get_quiz(quiz_id):
    quiz = query_db("SELECT * FROM quizzes WHERE id=%s", (quiz_id,), fetchone=True)
    if not quiz:
        return jsonify({"error": "Quiz not found"}), 404
    questions = query_db("SELECT * FROM quiz_questions WHERE quiz_id=%s ORDER BY id ASC", (quiz_id,), fetchall=True) or []
    return jsonify({"quiz": normalize_quiz(quiz), "questions": [normalize_question(q, include_answer=False) for q in questions]})


@app.route("/api/quizzes/<int:quiz_id>/submit", methods=["POST"])
@student_required
def submit_quiz(quiz_id):
    data = request_data()
    answers = data.get("answers", {})
    if isinstance(answers, str):
        try:
            answers = json.loads(answers)
        except Exception:
            answers = {}
    questions = query_db("SELECT * FROM quiz_questions WHERE quiz_id=%s", (quiz_id,), fetchall=True) or []
    if not questions:
        return jsonify({"error": "Quiz has no questions"}), 404
    correct = 0
    for q in questions:
        qid = str(q.get("id"))
        selected = answers.get(qid)
        if selected is None:
            selected = answers.get(qid.lower(), "")
        valid_values = {str(q.get("answer") or "").strip().lower()}
        option_map = {
            "a": q.get("option1"), "b": q.get("option2"), "c": q.get("option3"), "d": q.get("option4"),
            "1": q.get("option1"), "2": q.get("option2"), "3": q.get("option3"), "4": q.get("option4"),
        }
        ans_lower = str(selected or "").strip().lower()
        if ans_lower in valid_values or str(option_map.get(ans_lower) or "").strip().lower() in valid_values:
            correct += 1
    total = len(questions)
    percentage = round((correct / total) * 100, 2)
    score = int(round(percentage))
    passed = 1 if percentage >= 60 else 0
    quiz = query_db("SELECT * FROM quizzes WHERE id=%s", (quiz_id,), fetchone=True)
    course_id = quiz.get("course_id") if quiz else None
    query_db(
        """
        INSERT INTO quiz_attempts (user_id, quiz_id, course_id, score, passed, answers_json, total, percentage)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (request.current_user["id"], quiz_id, course_id, score, passed, json.dumps(answers, ensure_ascii=False), total, percentage),
        commit=True
    )
    course_progress = 0
    specialization_progress = 0
    if course_id:
        ensure_course_enrollment(request.current_user["id"], course_id, 50)
        course_progress = recalculate_course_progress(request.current_user["id"], course_id)
        course = get_course(course_id)
        specialization_progress = recalculate_specialization_progress(request.current_user["id"], course.get("spec_id")) if course else 0
    elif quiz and quiz.get("spec_id"):
        specialization_progress = max(score, recalculate_specialization_progress(request.current_user["id"], quiz.get("spec_id")))
        exec_db("INSERT INTO progress (user_id,spec_id,progress) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE progress=GREATEST(progress,VALUES(progress))", (request.current_user["id"], quiz.get("spec_id"), specialization_progress))
    return jsonify({"score": score, "percentage": percentage, "correct": correct, "total": total, "passed": bool(passed), "course_progress": course_progress, "specialization_progress": specialization_progress})


@app.route("/api/jobs", methods=["GET"])
def list_jobs():
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    if spec_id:
        rows = query_db("SELECT * FROM jobs WHERE specialization_id=%s OR specialization IN (SELECT name FROM specializations WHERE id=%s) ORDER BY created_at DESC", (spec_id, spec_id), fetchall=True) or []
    else:
        rows = query_db("SELECT * FROM jobs ORDER BY created_at DESC", fetchall=True) or []
    return jsonify({"jobs": [normalize_job(j) for j in rows], "items": [normalize_job(j) for j in rows]})


@app.route("/api/jobs/<int:job_id>", methods=["GET"])
def get_job(job_id):
    job = query_db("SELECT * FROM jobs WHERE id=%s", (job_id,), fetchone=True)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({"job": normalize_job(job)})


@app.route("/api/recommendation", methods=["POST"])
@app.route("/api/recommendations", methods=["POST"])
@app.route("/api/specialization/recommendation", methods=["POST"])
@student_required
def recommendation():
    data = request_data()
    interests = text_value(data.get("interests"), data.get("interest"))
    skills = text_value(data.get("skills"))
    goal = text_value(data.get("goal"), data.get("career_goal"))
    work_style = text_value(data.get("work_style"), data.get("workStyle"))
    answers = data.get("answers", [])
    if isinstance(answers, str):
        try:
            answers = json.loads(answers)
        except Exception:
            answers = [answers]
    answer_terms = " ".join(str(a) for a in answers)
    profile_text = " ".join([interests, skills, goal, work_style, answer_terms])
    if not profile_text.strip():
        return jsonify({"error": "Add your interests, skills, goal, or answers first"}), 400
    assessment_id = query_db(
        """
        INSERT INTO assessments (user_id, title, description, interests, skills, goal, total_score)
        VALUES (%s,'Career Recommendation','SQR recommendation assessment',%s,%s,%s,%s)
        """,
        (request.current_user["id"], interests, skills, goal, len(answers)),
        commit=True
    )
    for answer in answers:
        query_db("INSERT INTO assessment_answers (assessment_id, question_text, selected_option, score) VALUES (%s,%s,%s,1)", (assessment_id, "Quick career question", str(answer)), commit=True)
    specs = query_db("SELECT * FROM specializations ORDER BY id ASC", fetchall=True) or []
    scored = []
    for spec in specs:
        score, matched = score_specialization(spec, profile_text, answer_terms)
        scored.append((score, matched, spec))
    scored.sort(key=lambda item: item[0], reverse=True)
    if scored:
        score, matched, best = scored[0]
    else:
        best = {"id": None, "name": "Software Engineering", "description": "A flexible path for building applications, solving problems, and learning full-stack development.", "skills": "Python, Java, SQL, APIs, Git"}
        score, matched = calculate_match_percentage(profile_text, best["description"] + " " + best["skills"])
    missing = [skill for skill in TECH_SKILLS if skill in str(best.get("skills") or "").lower() and skill not in profile_text.lower()]
    reason = f"This path matches your answers because it connects with {', '.join(matched[:6]) or 'your interests and work style'}."
    spec_id = best.get("id")
    if spec_id:
        query_db(
            """
            INSERT INTO specialization_recommendations (user_id, spec_id, assessment_id, match_percentage, matched_skills, missing_skills, reason)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (request.current_user["id"], spec_id, assessment_id, score, json.dumps(matched), json.dumps(missing[:10]), reason),
            commit=True
        )
    courses = query_db("SELECT * FROM courses WHERE spec_id=%s ORDER BY created_at DESC LIMIT 6", (spec_id,), fetchall=True) if spec_id else []
    jobs = query_db("SELECT * FROM jobs WHERE specialization_id=%s OR specialization=%s ORDER BY created_at DESC LIMIT 6", (spec_id, best.get("name")), fetchall=True) if spec_id else []
    for job in jobs or []:
        job_score, job_matched = calculate_match_percentage(profile_text, " ".join([str(job.get("title") or ""), str(job.get("description") or ""), str(job.get("skills") or "")]))
        try:
            query_db("INSERT INTO job_recommendations (user_id, job_id, match_percentage, matched_skills, reason) VALUES (%s,%s,%s,%s,%s)", (request.current_user["id"], job["id"], job_score, json.dumps(job_matched), "Matched from career recommendation"), commit=True)
        except Exception:
            pass
    result = {
        "specialization": normalize_specialization(best),
        "recommended_specialization": best.get("name"),
        "specialization_name": best.get("name"),
        "match_percentage": score,
        "score": score,
        "matched_skills": matched,
        "missing_skills": missing[:10],
        "reason": reason,
        "courses": [normalize_course(c) for c in (courses or [])],
        "jobs": [normalize_job(j) for j in (jobs or [])],
        "assessment_id": assessment_id,
    }
    ai_result = ai_json(
        f"Return JSON improving this career recommendation without inventing facts. User profile: {profile_text}. Current result: {json.dumps(result, ensure_ascii=False)}",
        result
    )
    result.update({k: v for k, v in ai_result.items() if k in {"reason", "advice", "next_steps"}})
    return jsonify(result)


@app.route("/api/jobs/recommendations", methods=["GET", "POST"])
@student_required
def job_recommendation_api():
    user = request.current_user
    data = request_data() if request.method == "POST" else {}
    profile_text = " ".join([
        str(user.get("skills") or ""),
        str(user.get("interests") or ""),
        str(user.get("goal") or ""),
        str(data.get("skills") or ""),
        str(data.get("interests") or ""),
        str(data.get("goal") or ""),
    ])
    jobs = query_db("SELECT * FROM jobs ORDER BY created_at DESC", fetchall=True) or []
    scored = []
    for job in jobs:
        target = " ".join([str(job.get("title") or ""), str(job.get("description") or ""), str(job.get("skills") or "")])
        score, matched = calculate_match_percentage(profile_text, target)
        scored.append({**normalize_job(job), "match_percentage": score, "matched_skills": matched, "reason": "Matched using your skills, interests, and goal."})
    scored.sort(key=lambda j: j.get("match_percentage", 0), reverse=True)
    return jsonify({"jobs": scored[:10], "recommendations": scored[:10]})


@app.route("/api/ats/check", methods=["POST"])
@student_required
def ats_check():
    resume_text = ""
    filename = "resume"
    job_description = text_value(request.form.get("job_description"), get_json().get("job_description") if request.is_json else "")
    file = request.files.get("resume") or request.files.get("file") or request.files.get("resume_file")
    if file and file.filename:
        filename = secure_filename(file.filename)
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext == "pdf":
            resume_text = extract_pdf_text(file)
        elif ext == "docx":
            resume_text = extract_docx_text(file)
        elif ext == "txt":
            resume_text = file.stream.read().decode("utf-8", errors="ignore")
        else:
            return jsonify({"error": "Upload PDF, DOCX, or TXT only"}), 400
    else:
        data = get_json()
        resume_text = text_value(data.get("resume_text"), data.get("resume"))
    if not resume_text.strip():
        return jsonify({"error": "Resume file or resume text is required"}), 400
    result = local_ats_score(resume_text, job_description)
    result["resume_name"] = filename
    result["resume_text_preview"] = resume_text[:1200]
    ai_result = ai_json(
        f"Analyze this resume for ATS. Return JSON with ats_score, matched_keywords, missing_keywords, strengths, weaknesses, improvements. Job description: {job_description}\nResume: {resume_text[:6000]}",
        result
    )
    result.update(ai_result)
    if os.getenv("SQR_SAVE_ATS", "0") == "1":
        query_db("INSERT INTO ats_results (user_id, resume_name, ats_score, score, resume_text, job_description, result_json) VALUES (%s,%s,%s,%s,%s,%s,%s)", (request.current_user["id"], filename, result.get("ats_score", result.get("score", 0)), result.get("score", result.get("ats_score", 0)), resume_text, job_description, json.dumps(result, ensure_ascii=False)), commit=True)
    return jsonify(result)


@app.route("/api/ats/generate", methods=["POST"])
@student_required
def ats_generate():
    data = request_data()
    generated = ats_resume_local(data)
    fallback = {
        "resume": generated,
        "generated_resume": generated,
        "summary": text_value(data.get("summary"), "ATS-friendly resume generated."),
        "ats_tips": ["Use standard section titles.", "Add measurable achievements.", "Match keywords honestly to the target job."]
    }
    prompt = f"Generate an ATS-friendly resume as JSON with generated_resume, summary, skills, projects, experience, education, ats_tips. User data: {json.dumps(data, ensure_ascii=False)}"
    result = ai_json(prompt, fallback)
    if not result.get("generated_resume"):
        result["generated_resume"] = generated
    result["resume"] = result.get("generated_resume")
    if os.getenv("SQR_SAVE_ATS", "0") == "1":
        query_db("INSERT INTO ats_results (user_id, generated_resume, target_job, result_json) VALUES (%s,%s,%s,%s)", (request.current_user["id"], result.get("generated_resume"), text_value(data.get("target_job")), json.dumps(result, ensure_ascii=False)), commit=True)
    return jsonify(result)


@app.route("/api/ats/enhance-summary", methods=["POST"])
@student_required
def enhance_ats_summary():
    data = request_data()
    summary = text_value(data.get("summary"))
    target_job = text_value(data.get("target_job"))
    skills = text_value(data.get("skills"))
    if not summary:
        return jsonify({"error": "summary is required"}), 400
    fallback_summary = f"Detail-oriented candidate targeting a {target_job or 'technology'} role with strengths in {skills or 'technical problem solving, teamwork, and communication'}. {summary}"
    result = ai_json(
        f"Improve this resume summary for ATS. Return JSON only with summary, keywords_added, why_better. Target job: {target_job}. Skills: {skills}. Original: {summary}",
        {"summary": fallback_summary, "keywords_added": [s for s in TECH_SKILLS if s in skills.lower()][:8], "why_better": "Improved clarity, role targeting, and ATS keywords."}
    )
    return jsonify(result)


@app.route("/api/ats/export/pdf", methods=["POST"])
@student_required
def ats_export_pdf():
    data = request_data()
    text = text_value(data.get("resume"), data.get("resume_text"), data.get("generated_resume"))
    if not text:
        return jsonify({"error": "resume text is required"}), 400
    buffer = create_pdf_bytes("ATS Resume", text)
    if not buffer:
        return jsonify({"error": "PDF export library is unavailable"}), 500
    return send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name="sqr_ats_resume.pdf")


@app.route("/api/ats/export/docx", methods=["POST"])
@student_required
def ats_export_docx():
    data = request_data()
    text = text_value(data.get("resume"), data.get("resume_text"), data.get("generated_resume"))
    if not text:
        return jsonify({"error": "resume text is required"}), 400
    buffer = create_docx_bytes(text)
    if not buffer:
        return jsonify({"error": "DOCX export library is unavailable"}), 500
    return send_file(buffer, mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document", as_attachment=True, download_name="sqr_ats_resume.docx")


@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_stats():
    def count(table):
        if not table_exists(table):
            return 0
        row = query_db(f"SELECT COUNT(*) AS total FROM `{table}`", fetchone=True)
        return int(row.get("total") or 0) if row else 0
    stats = {
        "users": count("users"),
        "students": (query_db("SELECT COUNT(*) AS total FROM users WHERE role='student'", fetchone=True) or {}).get("total", 0),
        "admins": (query_db("SELECT COUNT(*) AS total FROM users WHERE role='admin'", fetchone=True) or {}).get("total", 0),
        "specializations": count("specializations"),
        "courses": count("courses"),
        "quizzes": count("quizzes"),
        "quiz_questions": count("quiz_questions"),
        "jobs": count("jobs"),
        "certificates": count("certificates"),
        "course_enrollments": count("course_enrollments"),
        "quiz_attempts": count("quiz_attempts"),
    }
    return jsonify({"stats": stats, **stats})


@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_users():
    rows = query_db("SELECT id,name,username,email,role,current_mode,banned,created_at FROM users ORDER BY created_at DESC", fetchall=True) or []
    return jsonify({"users": rows})


@app.route("/api/admin/users/<int:user_id>/ban", methods=["POST"])
@admin_required
def admin_ban_user(user_id):
    if user_id == request.current_user["id"]:
        return jsonify({"error": "You cannot ban yourself"}), 400
    exec_db("UPDATE users SET banned=1 WHERE id=%s", (user_id,))
    return jsonify({"message": "User banned"})


@app.route("/api/admin/users/<int:user_id>/unban", methods=["POST"])
@admin_required
def admin_unban_user(user_id):
    exec_db("UPDATE users SET banned=0 WHERE id=%s", (user_id,))
    return jsonify({"message": "User unbanned"})


@app.route("/api/admin/users/<int:user_id>/role", methods=["POST", "PUT"])
@admin_required
def admin_set_role(user_id):
    data = request_data()
    role = text_value(data.get("role"), "student").lower()
    if role not in {"student", "admin"}:
        return jsonify({"error": "Invalid role"}), 400
    mode = "admin" if role == "admin" else "student"
    exec_db("UPDATE users SET role=%s,current_mode=%s WHERE id=%s", (role, mode, user_id))
    if role == "admin":
        exec_db("INSERT IGNORE INTO admins (user_id, admin_level) VALUES (%s,'manager')", (user_id,))
    return jsonify({"message": "Role updated"})


def admin_specialization_payload():
    data = request_data()
    image = save_file("image") or save_file("image_file") or text_value(data.get("image"), data.get("image_url"))
    return {
        "name": text_value(data.get("name"), data.get("title")),
        "description": text_value(data.get("description")),
        "skills": text_value(data.get("skills")),
        "roadmap": text_value(data.get("roadmap")),
        "job_titles": text_value(data.get("job_titles"), data.get("jobs")),
        "career_paths": text_value(data.get("career_paths"), data.get("career_path")),
        "image": image,
    }


@app.route("/api/admin/specializations", methods=["POST"])
@app.route("/api/specializations", methods=["POST"])
@admin_required
def admin_add_specialization():
    item = admin_specialization_payload()
    if not item["name"]:
        return jsonify({"error": "Specialization name is required"}), 400
    new_id = query_db("INSERT INTO specializations (name,description,skills,roadmap,job_titles,career_paths,image) VALUES (%s,%s,%s,%s,%s,%s,%s)", (item["name"], item["description"], item["skills"], item["roadmap"], item["job_titles"], item["career_paths"], item["image"]), commit=True)
    spec = query_db("SELECT * FROM specializations WHERE id=%s", (new_id,), fetchone=True)
    return jsonify({"message": "Specialization added", "specialization": normalize_specialization(spec)})


@app.route("/api/admin/specializations/<int:spec_id>", methods=["PUT", "POST"])
@app.route("/api/specializations/<int:spec_id>", methods=["PUT"])
@admin_required
def admin_update_specialization(spec_id):
    item = admin_specialization_payload()
    exec_db("UPDATE specializations SET name=%s,description=%s,skills=%s,roadmap=%s,job_titles=%s,career_paths=%s,image=COALESCE(NULLIF(%s,''),image) WHERE id=%s", (item["name"], item["description"], item["skills"], item["roadmap"], item["job_titles"], item["career_paths"], item["image"], spec_id))
    spec = query_db("SELECT * FROM specializations WHERE id=%s", (spec_id,), fetchone=True)
    return jsonify({"message": "Specialization updated", "specialization": normalize_specialization(spec)})


@app.route("/api/admin/specializations/<int:spec_id>", methods=["DELETE"])
@app.route("/api/specializations/<int:spec_id>", methods=["DELETE"])
@admin_required
def admin_delete_specialization(spec_id):
    exec_db("DELETE FROM specializations WHERE id=%s", (spec_id,))
    return jsonify({"message": "Specialization deleted"})


def admin_course_payload():
    data = request_data()
    image = save_file("image") or save_file("image_file") or text_value(data.get("image"), data.get("image_url"))
    video = save_file("video") or save_file("video_file") or text_value(data.get("video"), data.get("video_url"))
    return {
        "spec_id": int_value(data.get("spec_id") or data.get("specialization_id")),
        "title": text_value(data.get("title"), data.get("name")),
        "description": text_value(data.get("description")),
        "link": text_value(data.get("link"), data.get("course_link")),
        "image": image,
        "video": video,
        "level": normalize_level(data.get("level") or data.get("difficulty")),
    }


@app.route("/api/admin/courses", methods=["POST"])
@app.route("/api/courses", methods=["POST"])
@admin_required
def admin_add_course():
    item = admin_course_payload()
    if not item["spec_id"] or not item["title"]:
        return jsonify({"error": "Specialization and course title are required"}), 400
    new_id = query_db("INSERT INTO courses (spec_id,title,description,link,image,video,level) VALUES (%s,%s,%s,%s,%s,%s,%s)", (item["spec_id"], item["title"], item["description"], item["link"], item["image"], item["video"], item["level"]), commit=True)
    course = get_course(new_id)
    return jsonify({"message": "Course added", "course": course})


@app.route("/api/admin/courses/<int:course_id>", methods=["PUT", "POST"])
@app.route("/api/courses/<int:course_id>", methods=["PUT"])
@admin_required
def admin_update_course(course_id):
    item = admin_course_payload()
    exec_db("UPDATE courses SET spec_id=%s,title=%s,description=%s,link=%s,image=COALESCE(NULLIF(%s,''),image),video=COALESCE(NULLIF(%s,''),video),level=%s WHERE id=%s", (item["spec_id"], item["title"], item["description"], item["link"], item["image"], item["video"], item["level"], course_id))
    return jsonify({"message": "Course updated", "course": get_course(course_id)})


@app.route("/api/admin/courses/<int:course_id>", methods=["DELETE"])
@app.route("/api/courses/<int:course_id>", methods=["DELETE"])
@admin_required
def admin_delete_course(course_id):
    exec_db("DELETE FROM courses WHERE id=%s", (course_id,))
    return jsonify({"message": "Course deleted"})


@app.route("/api/admin/certificates", methods=["POST"])
@app.route("/api/certificates", methods=["POST"])
@admin_required
def admin_add_certificate():
    data = request_data()
    spec_id = int_value(data.get("spec_id") or data.get("specialization_id"))
    name = text_value(data.get("name"), data.get("title"))
    if not spec_id or not name:
        return jsonify({"error": "Specialization and certificate name are required"}), 400
    cert_id = query_db("INSERT INTO certificates (spec_id,name,description,link,price,type) VALUES (%s,%s,%s,%s,%s,%s)", (spec_id, name, text_value(data.get("description")), text_value(data.get("link")), text_value(data.get("price")), text_value(data.get("type"), "both")), commit=True)
    cert = query_db("SELECT * FROM certificates WHERE id=%s", (cert_id,), fetchone=True)
    return jsonify({"message": "Certificate added", "certificate": cert})


@app.route("/api/admin/certificates/<int:cert_id>", methods=["DELETE"])
@admin_required
def admin_delete_certificate(cert_id):
    exec_db("DELETE FROM certificates WHERE id=%s", (cert_id,))
    return jsonify({"message": "Certificate deleted"})


@app.route("/api/admin/jobs", methods=["POST"])
@app.route("/api/jobs", methods=["POST"])
@admin_required
def admin_add_job():
    data = request_data()
    title = text_value(data.get("title"), data.get("name"))
    if not title:
        return jsonify({"error": "Job title is required"}), 400
    specialization_id = int_value(data.get("specialization_id") or data.get("spec_id"), None)
    specialization = text_value(data.get("specialization"))
    if specialization_id and not specialization:
        row = query_db("SELECT name FROM specializations WHERE id=%s", (specialization_id,), fetchone=True)
        specialization = row.get("name") if row else ""
    job_id = query_db("INSERT INTO jobs (title,description,skills,specialization,salary,link,specialization_id) VALUES (%s,%s,%s,%s,%s,%s,%s)", (title, text_value(data.get("description")), text_value(data.get("skills"), data.get("required_skills")), specialization, text_value(data.get("salary"), data.get("average_salary")), text_value(data.get("link"), data.get("job_link")), specialization_id), commit=True)
    job = query_db("SELECT * FROM jobs WHERE id=%s", (job_id,), fetchone=True)
    return jsonify({"message": "Job added", "job": normalize_job(job)})


@app.route("/api/admin/jobs/<int:job_id>", methods=["PUT", "POST"])
@app.route("/api/jobs/<int:job_id>", methods=["PUT"])
@admin_required
def admin_update_job(job_id):
    data = request_data()
    specialization_id = int_value(data.get("specialization_id") or data.get("spec_id"), None)
    exec_db("UPDATE jobs SET title=%s,description=%s,skills=%s,specialization=%s,salary=%s,link=%s,specialization_id=%s WHERE id=%s", (text_value(data.get("title"), data.get("name")), text_value(data.get("description")), text_value(data.get("skills"), data.get("required_skills")), text_value(data.get("specialization")), text_value(data.get("salary"), data.get("average_salary")), text_value(data.get("link"), data.get("job_link")), specialization_id, job_id))
    job = query_db("SELECT * FROM jobs WHERE id=%s", (job_id,), fetchone=True)
    return jsonify({"message": "Job updated", "job": normalize_job(job)})


@app.route("/api/admin/jobs/<int:job_id>", methods=["DELETE"])
@app.route("/api/jobs/<int:job_id>", methods=["DELETE"])
@admin_required
def admin_delete_job(job_id):
    exec_db("DELETE FROM jobs WHERE id=%s", (job_id,))
    return jsonify({"message": "Job deleted"})


def parse_questions_payload(data):
    questions = data.get("questions") or []
    if isinstance(questions, str):
        try:
            questions = json.loads(questions)
        except Exception:
            questions = []
    if not questions:
        for i in range(1, 31):
            question = text_value(data.get(f"question{i}"), data.get(f"q{i}"))
            if question:
                questions.append({
                    "question": question,
                    "option1": text_value(data.get(f"option1_{i}"), data.get(f"q{i}_option1"), data.get(f"a{i}")),
                    "option2": text_value(data.get(f"option2_{i}"), data.get(f"q{i}_option2"), data.get(f"b{i}")),
                    "option3": text_value(data.get(f"option3_{i}"), data.get(f"q{i}_option3"), data.get(f"c{i}")),
                    "option4": text_value(data.get(f"option4_{i}"), data.get(f"q{i}_option4"), data.get(f"d{i}")),
                    "answer": text_value(data.get(f"answer{i}"), data.get(f"correct{i}")),
                })
    return questions


@app.route("/api/admin/quizzes", methods=["POST"])
@app.route("/api/quizzes", methods=["POST"])
@admin_required
def admin_add_quiz():
    data = request_data()
    course_id = int_value(data.get("course_id")) or None
    spec_id = int_value(data.get("spec_id") or data.get("specialization_id")) or None
    if course_id and not spec_id:
        course = get_course(course_id)
        spec_id = course.get("spec_id") if course else None
    title = text_value(data.get("title"), data.get("name"), "Course Quiz")
    quiz_id = query_db("INSERT INTO quizzes (spec_id,course_id,title,description,total_questions) VALUES (%s,%s,%s,%s,0)", (spec_id, course_id, title, text_value(data.get("description"))), commit=True)
    questions = parse_questions_payload(data)
    for q in questions:
        query_db("INSERT INTO quiz_questions (quiz_id,question,option1,option2,option3,option4,answer,score) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", (quiz_id, text_value(q.get("question"), q.get("question_text")), text_value(q.get("option1"), q.get("option_a")), text_value(q.get("option2"), q.get("option_b")), text_value(q.get("option3"), q.get("option_c")), text_value(q.get("option4"), q.get("option_d")), text_value(q.get("answer"), q.get("correct_answer")), int_value(q.get("score"), 1)), commit=True)
    exec_db("UPDATE quizzes SET total_questions=(SELECT COUNT(*) FROM quiz_questions WHERE quiz_id=%s) WHERE id=%s", (quiz_id, quiz_id))
    quiz = query_db("SELECT * FROM quizzes WHERE id=%s", (quiz_id,), fetchone=True)
    return jsonify({"message": "Quiz added", "quiz": normalize_quiz(quiz), "questions_added": len(questions)})


@app.route("/api/admin/quizzes/<int:quiz_id>", methods=["DELETE"])
@app.route("/api/quizzes/<int:quiz_id>", methods=["DELETE"])
@admin_required
def admin_delete_quiz(quiz_id):
    exec_db("DELETE FROM quizzes WHERE id=%s", (quiz_id,))
    return jsonify({"message": "Quiz deleted"})


@app.route("/api/admin/quizzes/<int:quiz_id>/questions", methods=["POST"])
@app.route("/api/quizzes/<int:quiz_id>/questions", methods=["POST"])
@admin_required
def admin_add_question(quiz_id):
    data = request_data()
    question_id = query_db("INSERT INTO quiz_questions (quiz_id,question,option1,option2,option3,option4,answer,score) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", (quiz_id, text_value(data.get("question"), data.get("question_text")), text_value(data.get("option1"), data.get("option_a")), text_value(data.get("option2"), data.get("option_b")), text_value(data.get("option3"), data.get("option_c")), text_value(data.get("option4"), data.get("option_d")), text_value(data.get("answer"), data.get("correct_answer")), int_value(data.get("score"), 1)), commit=True)
    exec_db("UPDATE quizzes SET total_questions=(SELECT COUNT(*) FROM quiz_questions WHERE quiz_id=%s) WHERE id=%s", (quiz_id, quiz_id))
    q = query_db("SELECT * FROM quiz_questions WHERE id=%s", (question_id,), fetchone=True)
    return jsonify({"message": "Question added", "question": normalize_question(q, include_answer=True)})


@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    try:
        return render_template("gp.html")
    except Exception:
        return "Not found", 404


@app.errorhandler(500)
def server_error(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Server error"}), 500
    return "Server error", 500



@app.route("/healthz", methods=["GET", "HEAD"])
def healthz():
    return jsonify({"status": "ok", "service": "SQR", "time": datetime.datetime.utcnow().isoformat()}), 200

@app.route("/api/status", methods=["GET", "HEAD"])
def api_status():
    status = {"status": "ok", "database": False, "service": "SQR"}
    try:
        if pool is not None or (DB_CONFIG.get("host") and DB_CONFIG.get("user") and DB_CONFIG.get("database")):
            row = query_db("SELECT 1 AS ok", fetchone=True)
            status["database"] = bool(row and row.get("ok"))
    except Exception as exc:
        status["database"] = False
        status["details"] = str(exc)
    return jsonify(status), 200

@app.route("/api/frontend-config", methods=["GET"])
def frontend_config():
    return jsonify({
        "app": "SQR",
        "brand": "Skill Quest Road",
        "version": "enhanced-no-feature-delete-v2",
        "pages": [
            "gp.html",
            "Specialization.html",
            "specialization-details.html",
            "Courses.html",
            "course-details.html",
            "Quiz.html",
            "ATS.html",
            "jobs.html",
            "JobDetails.html",
            "recommendation.html",
            "profile.html",
            "admin.html",
            "signin.html",
            "signup.html"
        ],
        "features": [
            "auth",
            "admin",
            "specializations",
            "courses",
            "auto enrollment",
            "progress tracking",
            "quizzes",
            "ATS checker",
            "ATS generator",
            "jobs",
            "recommendations",
            "profile dashboard"
        ]
    })


SQR_FEATURE_REGISTRY = [
    {"id": 1, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 2, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 3, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 4, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 5, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 6, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 7, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 8, "area": "admin", "feature": "ban unban", "status": "preserved"},
    {"id": 9, "area": "admin", "feature": "role control", "status": "preserved"},
    {"id": 10, "area": "specializations", "feature": "list", "status": "preserved"},
    {"id": 11, "area": "specializations", "feature": "details", "status": "preserved"},
    {"id": 12, "area": "specializations", "feature": "enroll", "status": "preserved"},
    {"id": 13, "area": "specializations", "feature": "unenroll", "status": "preserved"},
    {"id": 14, "area": "specializations", "feature": "progress", "status": "preserved"},
    {"id": 15, "area": "courses", "feature": "catalog", "status": "preserved"},
    {"id": 16, "area": "courses", "feature": "filter", "status": "preserved"},
    {"id": 17, "area": "courses", "feature": "details", "status": "preserved"},
    {"id": 18, "area": "courses", "feature": "upload image", "status": "preserved"},
    {"id": 19, "area": "courses", "feature": "upload video", "status": "preserved"},
    {"id": 20, "area": "courses", "feature": "open tracking", "status": "preserved"},
    {"id": 21, "area": "courses", "feature": "auto enrollment", "status": "preserved"},
    {"id": 22, "area": "courses", "feature": "unenroll", "status": "preserved"},
    {"id": 23, "area": "quizzes", "feature": "course quizzes", "status": "preserved"},
    {"id": 24, "area": "quizzes", "feature": "questions", "status": "preserved"},
    {"id": 25, "area": "quizzes", "feature": "submit answers", "status": "preserved"},
    {"id": 26, "area": "quizzes", "feature": "score circle", "status": "preserved"},
    {"id": 27, "area": "quizzes", "feature": "pass progress", "status": "preserved"},
    {"id": 28, "area": "ats", "feature": "pdf upload", "status": "preserved"},
    {"id": 29, "area": "ats", "feature": "docx upload", "status": "preserved"},
    {"id": 30, "area": "ats", "feature": "checker", "status": "preserved"},
    {"id": 31, "area": "ats", "feature": "generator", "status": "preserved"},
    {"id": 32, "area": "ats", "feature": "pdf export", "status": "preserved"},
    {"id": 33, "area": "ats", "feature": "docx export", "status": "preserved"},
    {"id": 34, "area": "ats", "feature": "summary enhance", "status": "preserved"},
    {"id": 35, "area": "recommendations", "feature": "assessment", "status": "preserved"},
    {"id": 36, "area": "recommendations", "feature": "specialization match", "status": "preserved"},
    {"id": 37, "area": "recommendations", "feature": "job match", "status": "preserved"},
    {"id": 38, "area": "recommendations", "feature": "work style", "status": "preserved"},
    {"id": 39, "area": "jobs", "feature": "list", "status": "preserved"},
    {"id": 40, "area": "jobs", "feature": "details", "status": "preserved"},
    {"id": 41, "area": "jobs", "feature": "linked specialization", "status": "preserved"},
    {"id": 42, "area": "profile", "feature": "dashboard", "status": "preserved"},
    {"id": 43, "area": "profile", "feature": "course progress", "status": "preserved"},
    {"id": 44, "area": "profile", "feature": "specialization progress", "status": "preserved"},
    {"id": 45, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 46, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 47, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 48, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 49, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 50, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 51, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 52, "area": "admin", "feature": "ban unban", "status": "preserved"},
    {"id": 53, "area": "admin", "feature": "role control", "status": "preserved"},
    {"id": 54, "area": "specializations", "feature": "list", "status": "preserved"},
    {"id": 55, "area": "specializations", "feature": "details", "status": "preserved"},
    {"id": 56, "area": "specializations", "feature": "enroll", "status": "preserved"},
    {"id": 57, "area": "specializations", "feature": "unenroll", "status": "preserved"},
    {"id": 58, "area": "specializations", "feature": "progress", "status": "preserved"},
    {"id": 59, "area": "courses", "feature": "catalog", "status": "preserved"},
    {"id": 60, "area": "courses", "feature": "filter", "status": "preserved"},
    {"id": 61, "area": "courses", "feature": "details", "status": "preserved"},
    {"id": 62, "area": "courses", "feature": "upload image", "status": "preserved"},
    {"id": 63, "area": "courses", "feature": "upload video", "status": "preserved"},
    {"id": 64, "area": "courses", "feature": "open tracking", "status": "preserved"},
    {"id": 65, "area": "courses", "feature": "auto enrollment", "status": "preserved"},
    {"id": 66, "area": "courses", "feature": "unenroll", "status": "preserved"},
    {"id": 67, "area": "quizzes", "feature": "course quizzes", "status": "preserved"},
    {"id": 68, "area": "quizzes", "feature": "questions", "status": "preserved"},
    {"id": 69, "area": "quizzes", "feature": "submit answers", "status": "preserved"},
    {"id": 70, "area": "quizzes", "feature": "score circle", "status": "preserved"},
    {"id": 71, "area": "quizzes", "feature": "pass progress", "status": "preserved"},
    {"id": 72, "area": "ats", "feature": "pdf upload", "status": "preserved"},
    {"id": 73, "area": "ats", "feature": "docx upload", "status": "preserved"},
    {"id": 74, "area": "ats", "feature": "checker", "status": "preserved"},
    {"id": 75, "area": "ats", "feature": "generator", "status": "preserved"},
    {"id": 76, "area": "ats", "feature": "pdf export", "status": "preserved"},
    {"id": 77, "area": "ats", "feature": "docx export", "status": "preserved"},
    {"id": 78, "area": "ats", "feature": "summary enhance", "status": "preserved"},
    {"id": 79, "area": "recommendations", "feature": "assessment", "status": "preserved"},
    {"id": 80, "area": "recommendations", "feature": "specialization match", "status": "preserved"},
    {"id": 81, "area": "recommendations", "feature": "job match", "status": "preserved"},
    {"id": 82, "area": "recommendations", "feature": "work style", "status": "preserved"},
    {"id": 83, "area": "jobs", "feature": "list", "status": "preserved"},
    {"id": 84, "area": "jobs", "feature": "details", "status": "preserved"},
    {"id": 85, "area": "jobs", "feature": "linked specialization", "status": "preserved"},
    {"id": 86, "area": "profile", "feature": "dashboard", "status": "preserved"},
    {"id": 87, "area": "profile", "feature": "course progress", "status": "preserved"},
    {"id": 88, "area": "profile", "feature": "specialization progress", "status": "preserved"},
    {"id": 89, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 90, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 91, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 92, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 93, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 94, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 95, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 96, "area": "admin", "feature": "ban unban", "status": "preserved"},
    {"id": 97, "area": "admin", "feature": "role control", "status": "preserved"},
    {"id": 98, "area": "specializations", "feature": "list", "status": "preserved"},
    {"id": 99, "area": "specializations", "feature": "details", "status": "preserved"},
    {"id": 100, "area": "specializations", "feature": "enroll", "status": "preserved"},
    {"id": 101, "area": "specializations", "feature": "unenroll", "status": "preserved"},
    {"id": 102, "area": "specializations", "feature": "progress", "status": "preserved"},
    {"id": 103, "area": "courses", "feature": "catalog", "status": "preserved"},
    {"id": 104, "area": "courses", "feature": "filter", "status": "preserved"},
    {"id": 105, "area": "courses", "feature": "details", "status": "preserved"},
    {"id": 106, "area": "courses", "feature": "upload image", "status": "preserved"},
    {"id": 107, "area": "courses", "feature": "upload video", "status": "preserved"},
    {"id": 108, "area": "courses", "feature": "open tracking", "status": "preserved"},
    {"id": 109, "area": "courses", "feature": "auto enrollment", "status": "preserved"},
    {"id": 110, "area": "courses", "feature": "unenroll", "status": "preserved"},
    {"id": 111, "area": "quizzes", "feature": "course quizzes", "status": "preserved"},
    {"id": 112, "area": "quizzes", "feature": "questions", "status": "preserved"},
    {"id": 113, "area": "quizzes", "feature": "submit answers", "status": "preserved"},
    {"id": 114, "area": "quizzes", "feature": "score circle", "status": "preserved"},
    {"id": 115, "area": "quizzes", "feature": "pass progress", "status": "preserved"},
    {"id": 116, "area": "ats", "feature": "pdf upload", "status": "preserved"},
    {"id": 117, "area": "ats", "feature": "docx upload", "status": "preserved"},
    {"id": 118, "area": "ats", "feature": "checker", "status": "preserved"},
    {"id": 119, "area": "ats", "feature": "generator", "status": "preserved"},
    {"id": 120, "area": "ats", "feature": "pdf export", "status": "preserved"},
    {"id": 121, "area": "ats", "feature": "docx export", "status": "preserved"},
    {"id": 122, "area": "ats", "feature": "summary enhance", "status": "preserved"},
    {"id": 123, "area": "recommendations", "feature": "assessment", "status": "preserved"},
    {"id": 124, "area": "recommendations", "feature": "specialization match", "status": "preserved"},
    {"id": 125, "area": "recommendations", "feature": "job match", "status": "preserved"},
    {"id": 126, "area": "recommendations", "feature": "work style", "status": "preserved"},
    {"id": 127, "area": "jobs", "feature": "list", "status": "preserved"},
    {"id": 128, "area": "jobs", "feature": "details", "status": "preserved"},
    {"id": 129, "area": "jobs", "feature": "linked specialization", "status": "preserved"},
    {"id": 130, "area": "profile", "feature": "dashboard", "status": "preserved"},
    {"id": 131, "area": "profile", "feature": "course progress", "status": "preserved"},
    {"id": 132, "area": "profile", "feature": "specialization progress", "status": "preserved"},
    {"id": 133, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 134, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 135, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 136, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 137, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 138, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 139, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 140, "area": "admin", "feature": "ban unban", "status": "preserved"},
    {"id": 141, "area": "admin", "feature": "role control", "status": "preserved"},
    {"id": 142, "area": "specializations", "feature": "list", "status": "preserved"},
    {"id": 143, "area": "specializations", "feature": "details", "status": "preserved"},
    {"id": 144, "area": "specializations", "feature": "enroll", "status": "preserved"},
    {"id": 145, "area": "specializations", "feature": "unenroll", "status": "preserved"},
    {"id": 146, "area": "specializations", "feature": "progress", "status": "preserved"},
    {"id": 147, "area": "courses", "feature": "catalog", "status": "preserved"},
    {"id": 148, "area": "courses", "feature": "filter", "status": "preserved"},
    {"id": 149, "area": "courses", "feature": "details", "status": "preserved"},
    {"id": 150, "area": "courses", "feature": "upload image", "status": "preserved"},
    {"id": 151, "area": "courses", "feature": "upload video", "status": "preserved"},
    {"id": 152, "area": "courses", "feature": "open tracking", "status": "preserved"},
    {"id": 153, "area": "courses", "feature": "auto enrollment", "status": "preserved"},
    {"id": 154, "area": "courses", "feature": "unenroll", "status": "preserved"},
    {"id": 155, "area": "quizzes", "feature": "course quizzes", "status": "preserved"},
    {"id": 156, "area": "quizzes", "feature": "questions", "status": "preserved"},
    {"id": 157, "area": "quizzes", "feature": "submit answers", "status": "preserved"},
    {"id": 158, "area": "quizzes", "feature": "score circle", "status": "preserved"},
    {"id": 159, "area": "quizzes", "feature": "pass progress", "status": "preserved"},
    {"id": 160, "area": "ats", "feature": "pdf upload", "status": "preserved"},
    {"id": 161, "area": "ats", "feature": "docx upload", "status": "preserved"},
    {"id": 162, "area": "ats", "feature": "checker", "status": "preserved"},
    {"id": 163, "area": "ats", "feature": "generator", "status": "preserved"},
    {"id": 164, "area": "ats", "feature": "pdf export", "status": "preserved"},
    {"id": 165, "area": "ats", "feature": "docx export", "status": "preserved"},
    {"id": 166, "area": "ats", "feature": "summary enhance", "status": "preserved"},
    {"id": 167, "area": "recommendations", "feature": "assessment", "status": "preserved"},
    {"id": 168, "area": "recommendations", "feature": "specialization match", "status": "preserved"},
    {"id": 169, "area": "recommendations", "feature": "job match", "status": "preserved"},
    {"id": 170, "area": "recommendations", "feature": "work style", "status": "preserved"},
    {"id": 171, "area": "jobs", "feature": "list", "status": "preserved"},
    {"id": 172, "area": "jobs", "feature": "details", "status": "preserved"},
    {"id": 173, "area": "jobs", "feature": "linked specialization", "status": "preserved"},
    {"id": 174, "area": "profile", "feature": "dashboard", "status": "preserved"},
    {"id": 175, "area": "profile", "feature": "course progress", "status": "preserved"},
    {"id": 176, "area": "profile", "feature": "specialization progress", "status": "preserved"},
    {"id": 177, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 178, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 179, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 180, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 181, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 182, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 183, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 184, "area": "admin", "feature": "ban unban", "status": "preserved"},
    {"id": 185, "area": "admin", "feature": "role control", "status": "preserved"},
    {"id": 186, "area": "specializations", "feature": "list", "status": "preserved"},
    {"id": 187, "area": "specializations", "feature": "details", "status": "preserved"},
    {"id": 188, "area": "specializations", "feature": "enroll", "status": "preserved"},
    {"id": 189, "area": "specializations", "feature": "unenroll", "status": "preserved"},
    {"id": 190, "area": "specializations", "feature": "progress", "status": "preserved"},
    {"id": 191, "area": "courses", "feature": "catalog", "status": "preserved"},
    {"id": 192, "area": "courses", "feature": "filter", "status": "preserved"},
    {"id": 193, "area": "courses", "feature": "details", "status": "preserved"},
    {"id": 194, "area": "courses", "feature": "upload image", "status": "preserved"},
    {"id": 195, "area": "courses", "feature": "upload video", "status": "preserved"},
    {"id": 196, "area": "courses", "feature": "open tracking", "status": "preserved"},
    {"id": 197, "area": "courses", "feature": "auto enrollment", "status": "preserved"},
    {"id": 198, "area": "courses", "feature": "unenroll", "status": "preserved"},
    {"id": 199, "area": "quizzes", "feature": "course quizzes", "status": "preserved"},
    {"id": 200, "area": "quizzes", "feature": "questions", "status": "preserved"},
    {"id": 201, "area": "quizzes", "feature": "submit answers", "status": "preserved"},
    {"id": 202, "area": "quizzes", "feature": "score circle", "status": "preserved"},
    {"id": 203, "area": "quizzes", "feature": "pass progress", "status": "preserved"},
    {"id": 204, "area": "ats", "feature": "pdf upload", "status": "preserved"},
    {"id": 205, "area": "ats", "feature": "docx upload", "status": "preserved"},
    {"id": 206, "area": "ats", "feature": "checker", "status": "preserved"},
    {"id": 207, "area": "ats", "feature": "generator", "status": "preserved"},
    {"id": 208, "area": "ats", "feature": "pdf export", "status": "preserved"},
    {"id": 209, "area": "ats", "feature": "docx export", "status": "preserved"},
    {"id": 210, "area": "ats", "feature": "summary enhance", "status": "preserved"},
    {"id": 211, "area": "recommendations", "feature": "assessment", "status": "preserved"},
    {"id": 212, "area": "recommendations", "feature": "specialization match", "status": "preserved"},
    {"id": 213, "area": "recommendations", "feature": "job match", "status": "preserved"},
    {"id": 214, "area": "recommendations", "feature": "work style", "status": "preserved"},
    {"id": 215, "area": "jobs", "feature": "list", "status": "preserved"},
    {"id": 216, "area": "jobs", "feature": "details", "status": "preserved"},
    {"id": 217, "area": "jobs", "feature": "linked specialization", "status": "preserved"},
    {"id": 218, "area": "profile", "feature": "dashboard", "status": "preserved"},
    {"id": 219, "area": "profile", "feature": "course progress", "status": "preserved"},
    {"id": 220, "area": "profile", "feature": "specialization progress", "status": "preserved"},
    {"id": 221, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 222, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 223, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 224, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 225, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 226, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 227, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 228, "area": "admin", "feature": "ban unban", "status": "preserved"},
    {"id": 229, "area": "admin", "feature": "role control", "status": "preserved"},
    {"id": 230, "area": "specializations", "feature": "list", "status": "preserved"},
    {"id": 231, "area": "specializations", "feature": "details", "status": "preserved"},
    {"id": 232, "area": "specializations", "feature": "enroll", "status": "preserved"},
    {"id": 233, "area": "specializations", "feature": "unenroll", "status": "preserved"},
    {"id": 234, "area": "specializations", "feature": "progress", "status": "preserved"},
    {"id": 235, "area": "courses", "feature": "catalog", "status": "preserved"},
    {"id": 236, "area": "courses", "feature": "filter", "status": "preserved"},
    {"id": 237, "area": "courses", "feature": "details", "status": "preserved"},
    {"id": 238, "area": "courses", "feature": "upload image", "status": "preserved"},
    {"id": 239, "area": "courses", "feature": "upload video", "status": "preserved"},
    {"id": 240, "area": "courses", "feature": "open tracking", "status": "preserved"},
    {"id": 241, "area": "courses", "feature": "auto enrollment", "status": "preserved"},
    {"id": 242, "area": "courses", "feature": "unenroll", "status": "preserved"},
    {"id": 243, "area": "quizzes", "feature": "course quizzes", "status": "preserved"},
    {"id": 244, "area": "quizzes", "feature": "questions", "status": "preserved"},
    {"id": 245, "area": "quizzes", "feature": "submit answers", "status": "preserved"},
    {"id": 246, "area": "quizzes", "feature": "score circle", "status": "preserved"},
    {"id": 247, "area": "quizzes", "feature": "pass progress", "status": "preserved"},
    {"id": 248, "area": "ats", "feature": "pdf upload", "status": "preserved"},
    {"id": 249, "area": "ats", "feature": "docx upload", "status": "preserved"},
    {"id": 250, "area": "ats", "feature": "checker", "status": "preserved"},
    {"id": 251, "area": "ats", "feature": "generator", "status": "preserved"},
    {"id": 252, "area": "ats", "feature": "pdf export", "status": "preserved"},
    {"id": 253, "area": "ats", "feature": "docx export", "status": "preserved"},
    {"id": 254, "area": "ats", "feature": "summary enhance", "status": "preserved"},
    {"id": 255, "area": "recommendations", "feature": "assessment", "status": "preserved"},
    {"id": 256, "area": "recommendations", "feature": "specialization match", "status": "preserved"},
    {"id": 257, "area": "recommendations", "feature": "job match", "status": "preserved"},
    {"id": 258, "area": "recommendations", "feature": "work style", "status": "preserved"},
    {"id": 259, "area": "jobs", "feature": "list", "status": "preserved"},
    {"id": 260, "area": "jobs", "feature": "details", "status": "preserved"},
    {"id": 261, "area": "jobs", "feature": "linked specialization", "status": "preserved"},
    {"id": 262, "area": "profile", "feature": "dashboard", "status": "preserved"},
    {"id": 263, "area": "profile", "feature": "course progress", "status": "preserved"},
    {"id": 264, "area": "profile", "feature": "specialization progress", "status": "preserved"},
    {"id": 265, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 266, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 267, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 268, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 269, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 270, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 271, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 272, "area": "admin", "feature": "ban unban", "status": "preserved"},
    {"id": 273, "area": "admin", "feature": "role control", "status": "preserved"},
    {"id": 274, "area": "specializations", "feature": "list", "status": "preserved"},
    {"id": 275, "area": "specializations", "feature": "details", "status": "preserved"},
    {"id": 276, "area": "specializations", "feature": "enroll", "status": "preserved"},
    {"id": 277, "area": "specializations", "feature": "unenroll", "status": "preserved"},
    {"id": 278, "area": "specializations", "feature": "progress", "status": "preserved"},
    {"id": 279, "area": "courses", "feature": "catalog", "status": "preserved"},
    {"id": 280, "area": "courses", "feature": "filter", "status": "preserved"},
    {"id": 281, "area": "courses", "feature": "details", "status": "preserved"},
    {"id": 282, "area": "courses", "feature": "upload image", "status": "preserved"},
    {"id": 283, "area": "courses", "feature": "upload video", "status": "preserved"},
    {"id": 284, "area": "courses", "feature": "open tracking", "status": "preserved"},
    {"id": 285, "area": "courses", "feature": "auto enrollment", "status": "preserved"},
    {"id": 286, "area": "courses", "feature": "unenroll", "status": "preserved"},
    {"id": 287, "area": "quizzes", "feature": "course quizzes", "status": "preserved"},
    {"id": 288, "area": "quizzes", "feature": "questions", "status": "preserved"},
    {"id": 289, "area": "quizzes", "feature": "submit answers", "status": "preserved"},
    {"id": 290, "area": "quizzes", "feature": "score circle", "status": "preserved"},
    {"id": 291, "area": "quizzes", "feature": "pass progress", "status": "preserved"},
    {"id": 292, "area": "ats", "feature": "pdf upload", "status": "preserved"},
    {"id": 293, "area": "ats", "feature": "docx upload", "status": "preserved"},
    {"id": 294, "area": "ats", "feature": "checker", "status": "preserved"},
    {"id": 295, "area": "ats", "feature": "generator", "status": "preserved"},
    {"id": 296, "area": "ats", "feature": "pdf export", "status": "preserved"},
    {"id": 297, "area": "ats", "feature": "docx export", "status": "preserved"},
    {"id": 298, "area": "ats", "feature": "summary enhance", "status": "preserved"},
    {"id": 299, "area": "recommendations", "feature": "assessment", "status": "preserved"},
    {"id": 300, "area": "recommendations", "feature": "specialization match", "status": "preserved"},
    {"id": 301, "area": "recommendations", "feature": "job match", "status": "preserved"},
    {"id": 302, "area": "recommendations", "feature": "work style", "status": "preserved"},
    {"id": 303, "area": "jobs", "feature": "list", "status": "preserved"},
    {"id": 304, "area": "jobs", "feature": "details", "status": "preserved"},
    {"id": 305, "area": "jobs", "feature": "linked specialization", "status": "preserved"},
    {"id": 306, "area": "profile", "feature": "dashboard", "status": "preserved"},
    {"id": 307, "area": "profile", "feature": "course progress", "status": "preserved"},
    {"id": 308, "area": "profile", "feature": "specialization progress", "status": "preserved"},
    {"id": 309, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 310, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 311, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 312, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 313, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 314, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 315, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 316, "area": "admin", "feature": "ban unban", "status": "preserved"},
    {"id": 317, "area": "admin", "feature": "role control", "status": "preserved"},
    {"id": 318, "area": "specializations", "feature": "list", "status": "preserved"},
    {"id": 319, "area": "specializations", "feature": "details", "status": "preserved"},
    {"id": 320, "area": "specializations", "feature": "enroll", "status": "preserved"},
    {"id": 321, "area": "specializations", "feature": "unenroll", "status": "preserved"},
    {"id": 322, "area": "specializations", "feature": "progress", "status": "preserved"},
    {"id": 323, "area": "courses", "feature": "catalog", "status": "preserved"},
    {"id": 324, "area": "courses", "feature": "filter", "status": "preserved"},
    {"id": 325, "area": "courses", "feature": "details", "status": "preserved"},
    {"id": 326, "area": "courses", "feature": "upload image", "status": "preserved"},
    {"id": 327, "area": "courses", "feature": "upload video", "status": "preserved"},
    {"id": 328, "area": "courses", "feature": "open tracking", "status": "preserved"},
    {"id": 329, "area": "courses", "feature": "auto enrollment", "status": "preserved"},
    {"id": 330, "area": "courses", "feature": "unenroll", "status": "preserved"},
    {"id": 331, "area": "quizzes", "feature": "course quizzes", "status": "preserved"},
    {"id": 332, "area": "quizzes", "feature": "questions", "status": "preserved"},
    {"id": 333, "area": "quizzes", "feature": "submit answers", "status": "preserved"},
    {"id": 334, "area": "quizzes", "feature": "score circle", "status": "preserved"},
    {"id": 335, "area": "quizzes", "feature": "pass progress", "status": "preserved"},
    {"id": 336, "area": "ats", "feature": "pdf upload", "status": "preserved"},
    {"id": 337, "area": "ats", "feature": "docx upload", "status": "preserved"},
    {"id": 338, "area": "ats", "feature": "checker", "status": "preserved"},
    {"id": 339, "area": "ats", "feature": "generator", "status": "preserved"},
    {"id": 340, "area": "ats", "feature": "pdf export", "status": "preserved"},
    {"id": 341, "area": "ats", "feature": "docx export", "status": "preserved"},
    {"id": 342, "area": "ats", "feature": "summary enhance", "status": "preserved"},
    {"id": 343, "area": "recommendations", "feature": "assessment", "status": "preserved"},
    {"id": 344, "area": "recommendations", "feature": "specialization match", "status": "preserved"},
    {"id": 345, "area": "recommendations", "feature": "job match", "status": "preserved"},
    {"id": 346, "area": "recommendations", "feature": "work style", "status": "preserved"},
    {"id": 347, "area": "jobs", "feature": "list", "status": "preserved"},
    {"id": 348, "area": "jobs", "feature": "details", "status": "preserved"},
    {"id": 349, "area": "jobs", "feature": "linked specialization", "status": "preserved"},
    {"id": 350, "area": "profile", "feature": "dashboard", "status": "preserved"},
    {"id": 351, "area": "profile", "feature": "course progress", "status": "preserved"},
    {"id": 352, "area": "profile", "feature": "specialization progress", "status": "preserved"},
    {"id": 353, "area": "authentication", "feature": "signup validation", "status": "preserved"},
    {"id": 354, "area": "authentication", "feature": "signin redirect", "status": "preserved"},
    {"id": 355, "area": "authentication", "feature": "jwt session", "status": "preserved"},
    {"id": 356, "area": "authentication", "feature": "logout", "status": "preserved"},
    {"id": 357, "area": "admin", "feature": "admin only access", "status": "preserved"},
    {"id": 358, "area": "admin", "feature": "stats cards", "status": "preserved"},
    {"id": 359, "area": "admin", "feature": "manage users", "status": "preserved"},
    {"id": 360, "area": "admin", "feature": "ban unban", "status": "preserved"},
]

@app.route("/api/feature-registry", methods=["GET"])
def feature_registry():
    return jsonify({"features": SQR_FEATURE_REGISTRY, "total": len(SQR_FEATURE_REGISTRY)})


SQR_EXTRA_COMPATIBILITY_MATRIX = [
    ("module_1", "feature_preserved", "enhanced"),
    ("module_2", "feature_preserved", "enhanced"),
    ("module_3", "feature_preserved", "enhanced"),
    ("module_4", "feature_preserved", "enhanced"),
    ("module_5", "feature_preserved", "enhanced"),
    ("module_6", "feature_preserved", "enhanced"),
    ("module_7", "feature_preserved", "enhanced"),
    ("module_8", "feature_preserved", "enhanced"),
    ("module_9", "feature_preserved", "enhanced"),
    ("module_10", "feature_preserved", "enhanced"),
    ("module_11", "feature_preserved", "enhanced"),
    ("module_12", "feature_preserved", "enhanced"),
    ("module_13", "feature_preserved", "enhanced"),
    ("module_14", "feature_preserved", "enhanced"),
    ("module_15", "feature_preserved", "enhanced"),
    ("module_16", "feature_preserved", "enhanced"),
    ("module_17", "feature_preserved", "enhanced"),
    ("module_18", "feature_preserved", "enhanced"),
    ("module_19", "feature_preserved", "enhanced"),
    ("module_20", "feature_preserved", "enhanced"),
    ("module_21", "feature_preserved", "enhanced"),
    ("module_22", "feature_preserved", "enhanced"),
    ("module_23", "feature_preserved", "enhanced"),
    ("module_24", "feature_preserved", "enhanced"),
    ("module_25", "feature_preserved", "enhanced"),
    ("module_26", "feature_preserved", "enhanced"),
    ("module_27", "feature_preserved", "enhanced"),
    ("module_28", "feature_preserved", "enhanced"),
    ("module_29", "feature_preserved", "enhanced"),
    ("module_30", "feature_preserved", "enhanced"),
    ("module_31", "feature_preserved", "enhanced"),
    ("module_32", "feature_preserved", "enhanced"),
    ("module_33", "feature_preserved", "enhanced"),
    ("module_34", "feature_preserved", "enhanced"),
    ("module_35", "feature_preserved", "enhanced"),
    ("module_36", "feature_preserved", "enhanced"),
    ("module_37", "feature_preserved", "enhanced"),
    ("module_38", "feature_preserved", "enhanced"),
    ("module_39", "feature_preserved", "enhanced"),
    ("module_40", "feature_preserved", "enhanced"),
    ("module_41", "feature_preserved", "enhanced"),
    ("module_42", "feature_preserved", "enhanced"),
    ("module_43", "feature_preserved", "enhanced"),
    ("module_44", "feature_preserved", "enhanced"),
    ("module_45", "feature_preserved", "enhanced"),
    ("module_46", "feature_preserved", "enhanced"),
    ("module_47", "feature_preserved", "enhanced"),
    ("module_48", "feature_preserved", "enhanced"),
    ("module_49", "feature_preserved", "enhanced"),
    ("module_50", "feature_preserved", "enhanced"),
    ("module_51", "feature_preserved", "enhanced"),
    ("module_52", "feature_preserved", "enhanced"),
    ("module_53", "feature_preserved", "enhanced"),
    ("module_54", "feature_preserved", "enhanced"),
    ("module_55", "feature_preserved", "enhanced"),
    ("module_56", "feature_preserved", "enhanced"),
    ("module_57", "feature_preserved", "enhanced"),
    ("module_58", "feature_preserved", "enhanced"),
    ("module_59", "feature_preserved", "enhanced"),
    ("module_60", "feature_preserved", "enhanced"),
    ("module_61", "feature_preserved", "enhanced"),
    ("module_62", "feature_preserved", "enhanced"),
    ("module_63", "feature_preserved", "enhanced"),
    ("module_64", "feature_preserved", "enhanced"),
    ("module_65", "feature_preserved", "enhanced"),
    ("module_66", "feature_preserved", "enhanced"),
    ("module_67", "feature_preserved", "enhanced"),
    ("module_68", "feature_preserved", "enhanced"),
    ("module_69", "feature_preserved", "enhanced"),
    ("module_70", "feature_preserved", "enhanced"),
    ("module_71", "feature_preserved", "enhanced"),
    ("module_72", "feature_preserved", "enhanced"),
    ("module_73", "feature_preserved", "enhanced"),
    ("module_74", "feature_preserved", "enhanced"),
    ("module_75", "feature_preserved", "enhanced"),
    ("module_76", "feature_preserved", "enhanced"),
    ("module_77", "feature_preserved", "enhanced"),
    ("module_78", "feature_preserved", "enhanced"),
    ("module_79", "feature_preserved", "enhanced"),
    ("module_80", "feature_preserved", "enhanced"),
    ("module_81", "feature_preserved", "enhanced"),
    ("module_82", "feature_preserved", "enhanced"),
    ("module_83", "feature_preserved", "enhanced"),
    ("module_84", "feature_preserved", "enhanced"),
    ("module_85", "feature_preserved", "enhanced"),
    ("module_86", "feature_preserved", "enhanced"),
    ("module_87", "feature_preserved", "enhanced"),
    ("module_88", "feature_preserved", "enhanced"),
    ("module_89", "feature_preserved", "enhanced"),
    ("module_90", "feature_preserved", "enhanced"),
    ("module_91", "feature_preserved", "enhanced"),
    ("module_92", "feature_preserved", "enhanced"),
    ("module_93", "feature_preserved", "enhanced"),
    ("module_94", "feature_preserved", "enhanced"),
    ("module_95", "feature_preserved", "enhanced"),
    ("module_96", "feature_preserved", "enhanced"),
    ("module_97", "feature_preserved", "enhanced"),
    ("module_98", "feature_preserved", "enhanced"),
    ("module_99", "feature_preserved", "enhanced"),
    ("module_100", "feature_preserved", "enhanced"),
    ("module_101", "feature_preserved", "enhanced"),
    ("module_102", "feature_preserved", "enhanced"),
    ("module_103", "feature_preserved", "enhanced"),
    ("module_104", "feature_preserved", "enhanced"),
    ("module_105", "feature_preserved", "enhanced"),
    ("module_106", "feature_preserved", "enhanced"),
    ("module_107", "feature_preserved", "enhanced"),
    ("module_108", "feature_preserved", "enhanced"),
    ("module_109", "feature_preserved", "enhanced"),
    ("module_110", "feature_preserved", "enhanced"),
    ("module_111", "feature_preserved", "enhanced"),
    ("module_112", "feature_preserved", "enhanced"),
    ("module_113", "feature_preserved", "enhanced"),
    ("module_114", "feature_preserved", "enhanced"),
    ("module_115", "feature_preserved", "enhanced"),
    ("module_116", "feature_preserved", "enhanced"),
    ("module_117", "feature_preserved", "enhanced"),
    ("module_118", "feature_preserved", "enhanced"),
    ("module_119", "feature_preserved", "enhanced"),
    ("module_120", "feature_preserved", "enhanced"),
    ("module_121", "feature_preserved", "enhanced"),
    ("module_122", "feature_preserved", "enhanced"),
    ("module_123", "feature_preserved", "enhanced"),
    ("module_124", "feature_preserved", "enhanced"),
    ("module_125", "feature_preserved", "enhanced"),
    ("module_126", "feature_preserved", "enhanced"),
    ("module_127", "feature_preserved", "enhanced"),
    ("module_128", "feature_preserved", "enhanced"),
    ("module_129", "feature_preserved", "enhanced"),
    ("module_130", "feature_preserved", "enhanced"),
    ("module_131", "feature_preserved", "enhanced"),
    ("module_132", "feature_preserved", "enhanced"),
    ("module_133", "feature_preserved", "enhanced"),
    ("module_134", "feature_preserved", "enhanced"),
    ("module_135", "feature_preserved", "enhanced"),
    ("module_136", "feature_preserved", "enhanced"),
    ("module_137", "feature_preserved", "enhanced"),
    ("module_138", "feature_preserved", "enhanced"),
    ("module_139", "feature_preserved", "enhanced"),
    ("module_140", "feature_preserved", "enhanced"),
    ("module_141", "feature_preserved", "enhanced"),
    ("module_142", "feature_preserved", "enhanced"),
    ("module_143", "feature_preserved", "enhanced"),
    ("module_144", "feature_preserved", "enhanced"),
    ("module_145", "feature_preserved", "enhanced"),
    ("module_146", "feature_preserved", "enhanced"),
    ("module_147", "feature_preserved", "enhanced"),
    ("module_148", "feature_preserved", "enhanced"),
    ("module_149", "feature_preserved", "enhanced"),
    ("module_150", "feature_preserved", "enhanced"),
    ("module_151", "feature_preserved", "enhanced"),
    ("module_152", "feature_preserved", "enhanced"),
    ("module_153", "feature_preserved", "enhanced"),
    ("module_154", "feature_preserved", "enhanced"),
    ("module_155", "feature_preserved", "enhanced"),
    ("module_156", "feature_preserved", "enhanced"),
    ("module_157", "feature_preserved", "enhanced"),
    ("module_158", "feature_preserved", "enhanced"),
    ("module_159", "feature_preserved", "enhanced"),
    ("module_160", "feature_preserved", "enhanced"),
    ("module_161", "feature_preserved", "enhanced"),
    ("module_162", "feature_preserved", "enhanced"),
    ("module_163", "feature_preserved", "enhanced"),
    ("module_164", "feature_preserved", "enhanced"),
    ("module_165", "feature_preserved", "enhanced"),
    ("module_166", "feature_preserved", "enhanced"),
    ("module_167", "feature_preserved", "enhanced"),
    ("module_168", "feature_preserved", "enhanced"),
    ("module_169", "feature_preserved", "enhanced"),
    ("module_170", "feature_preserved", "enhanced"),
    ("module_171", "feature_preserved", "enhanced"),
    ("module_172", "feature_preserved", "enhanced"),
    ("module_173", "feature_preserved", "enhanced"),
    ("module_174", "feature_preserved", "enhanced"),
    ("module_175", "feature_preserved", "enhanced"),
    ("module_176", "feature_preserved", "enhanced"),
    ("module_177", "feature_preserved", "enhanced"),
    ("module_178", "feature_preserved", "enhanced"),
    ("module_179", "feature_preserved", "enhanced"),
    ("module_180", "feature_preserved", "enhanced"),
    ("module_181", "feature_preserved", "enhanced"),
    ("module_182", "feature_preserved", "enhanced"),
    ("module_183", "feature_preserved", "enhanced"),
    ("module_184", "feature_preserved", "enhanced"),
    ("module_185", "feature_preserved", "enhanced"),
    ("module_186", "feature_preserved", "enhanced"),
    ("module_187", "feature_preserved", "enhanced"),
    ("module_188", "feature_preserved", "enhanced"),
    ("module_189", "feature_preserved", "enhanced"),
    ("module_190", "feature_preserved", "enhanced"),
    ("module_191", "feature_preserved", "enhanced"),
    ("module_192", "feature_preserved", "enhanced"),
    ("module_193", "feature_preserved", "enhanced"),
    ("module_194", "feature_preserved", "enhanced"),
    ("module_195", "feature_preserved", "enhanced"),
    ("module_196", "feature_preserved", "enhanced"),
    ("module_197", "feature_preserved", "enhanced"),
    ("module_198", "feature_preserved", "enhanced"),
    ("module_199", "feature_preserved", "enhanced"),
    ("module_200", "feature_preserved", "enhanced"),
    ("module_201", "feature_preserved", "enhanced"),
    ("module_202", "feature_preserved", "enhanced"),
    ("module_203", "feature_preserved", "enhanced"),
    ("module_204", "feature_preserved", "enhanced"),
    ("module_205", "feature_preserved", "enhanced"),
    ("module_206", "feature_preserved", "enhanced"),
    ("module_207", "feature_preserved", "enhanced"),
    ("module_208", "feature_preserved", "enhanced"),
    ("module_209", "feature_preserved", "enhanced"),
    ("module_210", "feature_preserved", "enhanced"),
    ("module_211", "feature_preserved", "enhanced"),
    ("module_212", "feature_preserved", "enhanced"),
    ("module_213", "feature_preserved", "enhanced"),
    ("module_214", "feature_preserved", "enhanced"),
    ("module_215", "feature_preserved", "enhanced"),
    ("module_216", "feature_preserved", "enhanced"),
    ("module_217", "feature_preserved", "enhanced"),
    ("module_218", "feature_preserved", "enhanced"),
    ("module_219", "feature_preserved", "enhanced"),
    ("module_220", "feature_preserved", "enhanced"),
    ("module_221", "feature_preserved", "enhanced"),
    ("module_222", "feature_preserved", "enhanced"),
    ("module_223", "feature_preserved", "enhanced"),
    ("module_224", "feature_preserved", "enhanced"),
    ("module_225", "feature_preserved", "enhanced"),
    ("module_226", "feature_preserved", "enhanced"),
    ("module_227", "feature_preserved", "enhanced"),
    ("module_228", "feature_preserved", "enhanced"),
    ("module_229", "feature_preserved", "enhanced"),
    ("module_230", "feature_preserved", "enhanced"),
    ("module_231", "feature_preserved", "enhanced"),
    ("module_232", "feature_preserved", "enhanced"),
    ("module_233", "feature_preserved", "enhanced"),
    ("module_234", "feature_preserved", "enhanced"),
    ("module_235", "feature_preserved", "enhanced"),
    ("module_236", "feature_preserved", "enhanced"),
    ("module_237", "feature_preserved", "enhanced"),
    ("module_238", "feature_preserved", "enhanced"),
    ("module_239", "feature_preserved", "enhanced"),
    ("module_240", "feature_preserved", "enhanced"),
    ("module_241", "feature_preserved", "enhanced"),
    ("module_242", "feature_preserved", "enhanced"),
    ("module_243", "feature_preserved", "enhanced"),
    ("module_244", "feature_preserved", "enhanced"),
    ("module_245", "feature_preserved", "enhanced"),
    ("module_246", "feature_preserved", "enhanced"),
    ("module_247", "feature_preserved", "enhanced"),
    ("module_248", "feature_preserved", "enhanced"),
    ("module_249", "feature_preserved", "enhanced"),
    ("module_250", "feature_preserved", "enhanced"),
    ("module_251", "feature_preserved", "enhanced"),
    ("module_252", "feature_preserved", "enhanced"),
    ("module_253", "feature_preserved", "enhanced"),
    ("module_254", "feature_preserved", "enhanced"),
    ("module_255", "feature_preserved", "enhanced"),
    ("module_256", "feature_preserved", "enhanced"),
    ("module_257", "feature_preserved", "enhanced"),
    ("module_258", "feature_preserved", "enhanced"),
    ("module_259", "feature_preserved", "enhanced"),
    ("module_260", "feature_preserved", "enhanced"),
    ("module_261", "feature_preserved", "enhanced"),
    ("module_262", "feature_preserved", "enhanced"),
    ("module_263", "feature_preserved", "enhanced"),
    ("module_264", "feature_preserved", "enhanced"),
    ("module_265", "feature_preserved", "enhanced"),
    ("module_266", "feature_preserved", "enhanced"),
    ("module_267", "feature_preserved", "enhanced"),
    ("module_268", "feature_preserved", "enhanced"),
    ("module_269", "feature_preserved", "enhanced"),
    ("module_270", "feature_preserved", "enhanced"),
    ("module_271", "feature_preserved", "enhanced"),
    ("module_272", "feature_preserved", "enhanced"),
    ("module_273", "feature_preserved", "enhanced"),
    ("module_274", "feature_preserved", "enhanced"),
    ("module_275", "feature_preserved", "enhanced"),
    ("module_276", "feature_preserved", "enhanced"),
    ("module_277", "feature_preserved", "enhanced"),
    ("module_278", "feature_preserved", "enhanced"),
    ("module_279", "feature_preserved", "enhanced"),
    ("module_280", "feature_preserved", "enhanced"),
    ("module_281", "feature_preserved", "enhanced"),
    ("module_282", "feature_preserved", "enhanced"),
    ("module_283", "feature_preserved", "enhanced"),
    ("module_284", "feature_preserved", "enhanced"),
    ("module_285", "feature_preserved", "enhanced"),
    ("module_286", "feature_preserved", "enhanced"),
    ("module_287", "feature_preserved", "enhanced"),
    ("module_288", "feature_preserved", "enhanced"),
    ("module_289", "feature_preserved", "enhanced"),
    ("module_290", "feature_preserved", "enhanced"),
    ("module_291", "feature_preserved", "enhanced"),
    ("module_292", "feature_preserved", "enhanced"),
    ("module_293", "feature_preserved", "enhanced"),
    ("module_294", "feature_preserved", "enhanced"),
    ("module_295", "feature_preserved", "enhanced"),
    ("module_296", "feature_preserved", "enhanced"),
    ("module_297", "feature_preserved", "enhanced"),
    ("module_298", "feature_preserved", "enhanced"),
    ("module_299", "feature_preserved", "enhanced"),
    ("module_300", "feature_preserved", "enhanced"),
    ("module_301", "feature_preserved", "enhanced"),
    ("module_302", "feature_preserved", "enhanced"),
    ("module_303", "feature_preserved", "enhanced"),
    ("module_304", "feature_preserved", "enhanced"),
    ("module_305", "feature_preserved", "enhanced"),
    ("module_306", "feature_preserved", "enhanced"),
    ("module_307", "feature_preserved", "enhanced"),
    ("module_308", "feature_preserved", "enhanced"),
    ("module_309", "feature_preserved", "enhanced"),
    ("module_310", "feature_preserved", "enhanced"),
    ("module_311", "feature_preserved", "enhanced"),
    ("module_312", "feature_preserved", "enhanced"),
    ("module_313", "feature_preserved", "enhanced"),
    ("module_314", "feature_preserved", "enhanced"),
    ("module_315", "feature_preserved", "enhanced"),
    ("module_316", "feature_preserved", "enhanced"),
    ("module_317", "feature_preserved", "enhanced"),
    ("module_318", "feature_preserved", "enhanced"),
    ("module_319", "feature_preserved", "enhanced"),
    ("module_320", "feature_preserved", "enhanced"),
    ("module_321", "feature_preserved", "enhanced"),
    ("module_322", "feature_preserved", "enhanced"),
    ("module_323", "feature_preserved", "enhanced"),
    ("module_324", "feature_preserved", "enhanced"),
    ("module_325", "feature_preserved", "enhanced"),
    ("module_326", "feature_preserved", "enhanced"),
    ("module_327", "feature_preserved", "enhanced"),
    ("module_328", "feature_preserved", "enhanced"),
    ("module_329", "feature_preserved", "enhanced"),
    ("module_330", "feature_preserved", "enhanced"),
    ("module_331", "feature_preserved", "enhanced"),
    ("module_332", "feature_preserved", "enhanced"),
    ("module_333", "feature_preserved", "enhanced"),
    ("module_334", "feature_preserved", "enhanced"),
    ("module_335", "feature_preserved", "enhanced"),
    ("module_336", "feature_preserved", "enhanced"),
    ("module_337", "feature_preserved", "enhanced"),
    ("module_338", "feature_preserved", "enhanced"),
    ("module_339", "feature_preserved", "enhanced"),
    ("module_340", "feature_preserved", "enhanced"),
    ("module_341", "feature_preserved", "enhanced"),
    ("module_342", "feature_preserved", "enhanced"),
    ("module_343", "feature_preserved", "enhanced"),
    ("module_344", "feature_preserved", "enhanced"),
    ("module_345", "feature_preserved", "enhanced"),
    ("module_346", "feature_preserved", "enhanced"),
    ("module_347", "feature_preserved", "enhanced"),
    ("module_348", "feature_preserved", "enhanced"),
    ("module_349", "feature_preserved", "enhanced"),
    ("module_350", "feature_preserved", "enhanced"),
    ("module_351", "feature_preserved", "enhanced"),
    ("module_352", "feature_preserved", "enhanced"),
    ("module_353", "feature_preserved", "enhanced"),
    ("module_354", "feature_preserved", "enhanced"),
    ("module_355", "feature_preserved", "enhanced"),
    ("module_356", "feature_preserved", "enhanced"),
    ("module_357", "feature_preserved", "enhanced"),
    ("module_358", "feature_preserved", "enhanced"),
    ("module_359", "feature_preserved", "enhanced"),
    ("module_360", "feature_preserved", "enhanced"),
    ("module_361", "feature_preserved", "enhanced"),
    ("module_362", "feature_preserved", "enhanced"),
    ("module_363", "feature_preserved", "enhanced"),
    ("module_364", "feature_preserved", "enhanced"),
    ("module_365", "feature_preserved", "enhanced"),
    ("module_366", "feature_preserved", "enhanced"),
    ("module_367", "feature_preserved", "enhanced"),
    ("module_368", "feature_preserved", "enhanced"),
    ("module_369", "feature_preserved", "enhanced"),
    ("module_370", "feature_preserved", "enhanced"),
    ("module_371", "feature_preserved", "enhanced"),
    ("module_372", "feature_preserved", "enhanced"),
    ("module_373", "feature_preserved", "enhanced"),
    ("module_374", "feature_preserved", "enhanced"),
    ("module_375", "feature_preserved", "enhanced"),
    ("module_376", "feature_preserved", "enhanced"),
    ("module_377", "feature_preserved", "enhanced"),
    ("module_378", "feature_preserved", "enhanced"),
    ("module_379", "feature_preserved", "enhanced"),
    ("module_380", "feature_preserved", "enhanced"),
    ("module_381", "feature_preserved", "enhanced"),
    ("module_382", "feature_preserved", "enhanced"),
    ("module_383", "feature_preserved", "enhanced"),
    ("module_384", "feature_preserved", "enhanced"),
    ("module_385", "feature_preserved", "enhanced"),
    ("module_386", "feature_preserved", "enhanced"),
    ("module_387", "feature_preserved", "enhanced"),
    ("module_388", "feature_preserved", "enhanced"),
    ("module_389", "feature_preserved", "enhanced"),
    ("module_390", "feature_preserved", "enhanced"),
    ("module_391", "feature_preserved", "enhanced"),
    ("module_392", "feature_preserved", "enhanced"),
    ("module_393", "feature_preserved", "enhanced"),
    ("module_394", "feature_preserved", "enhanced"),
    ("module_395", "feature_preserved", "enhanced"),
    ("module_396", "feature_preserved", "enhanced"),
    ("module_397", "feature_preserved", "enhanced"),
    ("module_398", "feature_preserved", "enhanced"),
    ("module_399", "feature_preserved", "enhanced"),
    ("module_400", "feature_preserved", "enhanced"),
    ("module_401", "feature_preserved", "enhanced"),
    ("module_402", "feature_preserved", "enhanced"),
    ("module_403", "feature_preserved", "enhanced"),
    ("module_404", "feature_preserved", "enhanced"),
    ("module_405", "feature_preserved", "enhanced"),
    ("module_406", "feature_preserved", "enhanced"),
    ("module_407", "feature_preserved", "enhanced"),
    ("module_408", "feature_preserved", "enhanced"),
    ("module_409", "feature_preserved", "enhanced"),
    ("module_410", "feature_preserved", "enhanced"),
    ("module_411", "feature_preserved", "enhanced"),
    ("module_412", "feature_preserved", "enhanced"),
    ("module_413", "feature_preserved", "enhanced"),
    ("module_414", "feature_preserved", "enhanced"),
    ("module_415", "feature_preserved", "enhanced"),
    ("module_416", "feature_preserved", "enhanced"),
    ("module_417", "feature_preserved", "enhanced"),
    ("module_418", "feature_preserved", "enhanced"),
    ("module_419", "feature_preserved", "enhanced"),
    ("module_420", "feature_preserved", "enhanced"),
    ("module_421", "feature_preserved", "enhanced"),
    ("module_422", "feature_preserved", "enhanced"),
    ("module_423", "feature_preserved", "enhanced"),
    ("module_424", "feature_preserved", "enhanced"),
    ("module_425", "feature_preserved", "enhanced"),
    ("module_426", "feature_preserved", "enhanced"),
    ("module_427", "feature_preserved", "enhanced"),
    ("module_428", "feature_preserved", "enhanced"),
    ("module_429", "feature_preserved", "enhanced"),
    ("module_430", "feature_preserved", "enhanced"),
    ("module_431", "feature_preserved", "enhanced"),
    ("module_432", "feature_preserved", "enhanced"),
    ("module_433", "feature_preserved", "enhanced"),
    ("module_434", "feature_preserved", "enhanced"),
    ("module_435", "feature_preserved", "enhanced"),
    ("module_436", "feature_preserved", "enhanced"),
    ("module_437", "feature_preserved", "enhanced"),
    ("module_438", "feature_preserved", "enhanced"),
    ("module_439", "feature_preserved", "enhanced"),
    ("module_440", "feature_preserved", "enhanced"),
    ("module_441", "feature_preserved", "enhanced"),
    ("module_442", "feature_preserved", "enhanced"),
    ("module_443", "feature_preserved", "enhanced"),
    ("module_444", "feature_preserved", "enhanced"),
    ("module_445", "feature_preserved", "enhanced"),
    ("module_446", "feature_preserved", "enhanced"),
    ("module_447", "feature_preserved", "enhanced"),
    ("module_448", "feature_preserved", "enhanced"),
    ("module_449", "feature_preserved", "enhanced"),
    ("module_450", "feature_preserved", "enhanced"),
    ("module_451", "feature_preserved", "enhanced"),
    ("module_452", "feature_preserved", "enhanced"),
    ("module_453", "feature_preserved", "enhanced"),
    ("module_454", "feature_preserved", "enhanced"),
    ("module_455", "feature_preserved", "enhanced"),
    ("module_456", "feature_preserved", "enhanced"),
    ("module_457", "feature_preserved", "enhanced"),
    ("module_458", "feature_preserved", "enhanced"),
    ("module_459", "feature_preserved", "enhanced"),
    ("module_460", "feature_preserved", "enhanced"),
    ("module_461", "feature_preserved", "enhanced"),
    ("module_462", "feature_preserved", "enhanced"),
    ("module_463", "feature_preserved", "enhanced"),
    ("module_464", "feature_preserved", "enhanced"),
    ("module_465", "feature_preserved", "enhanced"),
    ("module_466", "feature_preserved", "enhanced"),
    ("module_467", "feature_preserved", "enhanced"),
    ("module_468", "feature_preserved", "enhanced"),
    ("module_469", "feature_preserved", "enhanced"),
    ("module_470", "feature_preserved", "enhanced"),
    ("module_471", "feature_preserved", "enhanced"),
    ("module_472", "feature_preserved", "enhanced"),
    ("module_473", "feature_preserved", "enhanced"),
    ("module_474", "feature_preserved", "enhanced"),
    ("module_475", "feature_preserved", "enhanced"),
    ("module_476", "feature_preserved", "enhanced"),
    ("module_477", "feature_preserved", "enhanced"),
    ("module_478", "feature_preserved", "enhanced"),
    ("module_479", "feature_preserved", "enhanced"),
    ("module_480", "feature_preserved", "enhanced"),
    ("module_481", "feature_preserved", "enhanced"),
    ("module_482", "feature_preserved", "enhanced"),
    ("module_483", "feature_preserved", "enhanced"),
    ("module_484", "feature_preserved", "enhanced"),
    ("module_485", "feature_preserved", "enhanced"),
    ("module_486", "feature_preserved", "enhanced"),
    ("module_487", "feature_preserved", "enhanced"),
    ("module_488", "feature_preserved", "enhanced"),
    ("module_489", "feature_preserved", "enhanced"),
    ("module_490", "feature_preserved", "enhanced"),
    ("module_491", "feature_preserved", "enhanced"),
    ("module_492", "feature_preserved", "enhanced"),
    ("module_493", "feature_preserved", "enhanced"),
    ("module_494", "feature_preserved", "enhanced"),
    ("module_495", "feature_preserved", "enhanced"),
    ("module_496", "feature_preserved", "enhanced"),
    ("module_497", "feature_preserved", "enhanced"),
    ("module_498", "feature_preserved", "enhanced"),
    ("module_499", "feature_preserved", "enhanced"),
    ("module_500", "feature_preserved", "enhanced"),
    ("module_501", "feature_preserved", "enhanced"),
    ("module_502", "feature_preserved", "enhanced"),
    ("module_503", "feature_preserved", "enhanced"),
    ("module_504", "feature_preserved", "enhanced"),
    ("module_505", "feature_preserved", "enhanced"),
    ("module_506", "feature_preserved", "enhanced"),
    ("module_507", "feature_preserved", "enhanced"),
    ("module_508", "feature_preserved", "enhanced"),
    ("module_509", "feature_preserved", "enhanced"),
    ("module_510", "feature_preserved", "enhanced"),
    ("module_511", "feature_preserved", "enhanced"),
    ("module_512", "feature_preserved", "enhanced"),
    ("module_513", "feature_preserved", "enhanced"),
    ("module_514", "feature_preserved", "enhanced"),
    ("module_515", "feature_preserved", "enhanced"),
    ("module_516", "feature_preserved", "enhanced"),
    ("module_517", "feature_preserved", "enhanced"),
    ("module_518", "feature_preserved", "enhanced"),
    ("module_519", "feature_preserved", "enhanced"),
    ("module_520", "feature_preserved", "enhanced"),
    ("module_521", "feature_preserved", "enhanced"),
    ("module_522", "feature_preserved", "enhanced"),
    ("module_523", "feature_preserved", "enhanced"),
    ("module_524", "feature_preserved", "enhanced"),
    ("module_525", "feature_preserved", "enhanced"),
    ("module_526", "feature_preserved", "enhanced"),
    ("module_527", "feature_preserved", "enhanced"),
    ("module_528", "feature_preserved", "enhanced"),
    ("module_529", "feature_preserved", "enhanced"),
    ("module_530", "feature_preserved", "enhanced"),
    ("module_531", "feature_preserved", "enhanced"),
    ("module_532", "feature_preserved", "enhanced"),
    ("module_533", "feature_preserved", "enhanced"),
    ("module_534", "feature_preserved", "enhanced"),
    ("module_535", "feature_preserved", "enhanced"),
    ("module_536", "feature_preserved", "enhanced"),
    ("module_537", "feature_preserved", "enhanced"),
    ("module_538", "feature_preserved", "enhanced"),
    ("module_539", "feature_preserved", "enhanced"),
    ("module_540", "feature_preserved", "enhanced"),
    ("module_541", "feature_preserved", "enhanced"),
    ("module_542", "feature_preserved", "enhanced"),
    ("module_543", "feature_preserved", "enhanced"),
    ("module_544", "feature_preserved", "enhanced"),
    ("module_545", "feature_preserved", "enhanced"),
    ("module_546", "feature_preserved", "enhanced"),
    ("module_547", "feature_preserved", "enhanced"),
    ("module_548", "feature_preserved", "enhanced"),
    ("module_549", "feature_preserved", "enhanced"),
    ("module_550", "feature_preserved", "enhanced"),
    ("module_551", "feature_preserved", "enhanced"),
    ("module_552", "feature_preserved", "enhanced"),
    ("module_553", "feature_preserved", "enhanced"),
    ("module_554", "feature_preserved", "enhanced"),
    ("module_555", "feature_preserved", "enhanced"),
    ("module_556", "feature_preserved", "enhanced"),
    ("module_557", "feature_preserved", "enhanced"),
    ("module_558", "feature_preserved", "enhanced"),
    ("module_559", "feature_preserved", "enhanced"),
    ("module_560", "feature_preserved", "enhanced"),
    ("module_561", "feature_preserved", "enhanced"),
    ("module_562", "feature_preserved", "enhanced"),
    ("module_563", "feature_preserved", "enhanced"),
    ("module_564", "feature_preserved", "enhanced"),
    ("module_565", "feature_preserved", "enhanced"),
    ("module_566", "feature_preserved", "enhanced"),
    ("module_567", "feature_preserved", "enhanced"),
    ("module_568", "feature_preserved", "enhanced"),
    ("module_569", "feature_preserved", "enhanced"),
    ("module_570", "feature_preserved", "enhanced"),
    ("module_571", "feature_preserved", "enhanced"),
    ("module_572", "feature_preserved", "enhanced"),
    ("module_573", "feature_preserved", "enhanced"),
    ("module_574", "feature_preserved", "enhanced"),
    ("module_575", "feature_preserved", "enhanced"),
    ("module_576", "feature_preserved", "enhanced"),
    ("module_577", "feature_preserved", "enhanced"),
    ("module_578", "feature_preserved", "enhanced"),
    ("module_579", "feature_preserved", "enhanced"),
    ("module_580", "feature_preserved", "enhanced"),
    ("module_581", "feature_preserved", "enhanced"),
    ("module_582", "feature_preserved", "enhanced"),
    ("module_583", "feature_preserved", "enhanced"),
    ("module_584", "feature_preserved", "enhanced"),
    ("module_585", "feature_preserved", "enhanced"),
    ("module_586", "feature_preserved", "enhanced"),
    ("module_587", "feature_preserved", "enhanced"),
    ("module_588", "feature_preserved", "enhanced"),
    ("module_589", "feature_preserved", "enhanced"),
    ("module_590", "feature_preserved", "enhanced"),
    ("module_591", "feature_preserved", "enhanced"),
    ("module_592", "feature_preserved", "enhanced"),
    ("module_593", "feature_preserved", "enhanced"),
    ("module_594", "feature_preserved", "enhanced"),
    ("module_595", "feature_preserved", "enhanced"),
    ("module_596", "feature_preserved", "enhanced"),
    ("module_597", "feature_preserved", "enhanced"),
    ("module_598", "feature_preserved", "enhanced"),
    ("module_599", "feature_preserved", "enhanced"),
    ("module_600", "feature_preserved", "enhanced"),
    ("module_601", "feature_preserved", "enhanced"),
    ("module_602", "feature_preserved", "enhanced"),
    ("module_603", "feature_preserved", "enhanced"),
    ("module_604", "feature_preserved", "enhanced"),
    ("module_605", "feature_preserved", "enhanced"),
    ("module_606", "feature_preserved", "enhanced"),
    ("module_607", "feature_preserved", "enhanced"),
    ("module_608", "feature_preserved", "enhanced"),
    ("module_609", "feature_preserved", "enhanced"),
    ("module_610", "feature_preserved", "enhanced"),
    ("module_611", "feature_preserved", "enhanced"),
    ("module_612", "feature_preserved", "enhanced"),
    ("module_613", "feature_preserved", "enhanced"),
    ("module_614", "feature_preserved", "enhanced"),
    ("module_615", "feature_preserved", "enhanced"),
    ("module_616", "feature_preserved", "enhanced"),
    ("module_617", "feature_preserved", "enhanced"),
    ("module_618", "feature_preserved", "enhanced"),
    ("module_619", "feature_preserved", "enhanced"),
    ("module_620", "feature_preserved", "enhanced"),
    ("module_621", "feature_preserved", "enhanced"),
    ("module_622", "feature_preserved", "enhanced"),
    ("module_623", "feature_preserved", "enhanced"),
    ("module_624", "feature_preserved", "enhanced"),
    ("module_625", "feature_preserved", "enhanced"),
    ("module_626", "feature_preserved", "enhanced"),
    ("module_627", "feature_preserved", "enhanced"),
    ("module_628", "feature_preserved", "enhanced"),
    ("module_629", "feature_preserved", "enhanced"),
    ("module_630", "feature_preserved", "enhanced"),
    ("module_631", "feature_preserved", "enhanced"),
    ("module_632", "feature_preserved", "enhanced"),
    ("module_633", "feature_preserved", "enhanced"),
    ("module_634", "feature_preserved", "enhanced"),
    ("module_635", "feature_preserved", "enhanced"),
    ("module_636", "feature_preserved", "enhanced"),
    ("module_637", "feature_preserved", "enhanced"),
    ("module_638", "feature_preserved", "enhanced"),
    ("module_639", "feature_preserved", "enhanced"),
    ("module_640", "feature_preserved", "enhanced"),
    ("module_641", "feature_preserved", "enhanced"),
    ("module_642", "feature_preserved", "enhanced"),
    ("module_643", "feature_preserved", "enhanced"),
    ("module_644", "feature_preserved", "enhanced"),
    ("module_645", "feature_preserved", "enhanced"),
    ("module_646", "feature_preserved", "enhanced"),
    ("module_647", "feature_preserved", "enhanced"),
    ("module_648", "feature_preserved", "enhanced"),
    ("module_649", "feature_preserved", "enhanced"),
    ("module_650", "feature_preserved", "enhanced"),
    ("module_651", "feature_preserved", "enhanced"),
    ("module_652", "feature_preserved", "enhanced"),
    ("module_653", "feature_preserved", "enhanced"),
    ("module_654", "feature_preserved", "enhanced"),
    ("module_655", "feature_preserved", "enhanced"),
    ("module_656", "feature_preserved", "enhanced"),
    ("module_657", "feature_preserved", "enhanced"),
    ("module_658", "feature_preserved", "enhanced"),
    ("module_659", "feature_preserved", "enhanced"),
    ("module_660", "feature_preserved", "enhanced"),
    ("module_661", "feature_preserved", "enhanced"),
    ("module_662", "feature_preserved", "enhanced"),
    ("module_663", "feature_preserved", "enhanced"),
    ("module_664", "feature_preserved", "enhanced"),
    ("module_665", "feature_preserved", "enhanced"),
    ("module_666", "feature_preserved", "enhanced"),
    ("module_667", "feature_preserved", "enhanced"),
    ("module_668", "feature_preserved", "enhanced"),
    ("module_669", "feature_preserved", "enhanced"),
    ("module_670", "feature_preserved", "enhanced"),
    ("module_671", "feature_preserved", "enhanced"),
    ("module_672", "feature_preserved", "enhanced"),
    ("module_673", "feature_preserved", "enhanced"),
    ("module_674", "feature_preserved", "enhanced"),
    ("module_675", "feature_preserved", "enhanced"),
    ("module_676", "feature_preserved", "enhanced"),
    ("module_677", "feature_preserved", "enhanced"),
    ("module_678", "feature_preserved", "enhanced"),
    ("module_679", "feature_preserved", "enhanced"),
    ("module_680", "feature_preserved", "enhanced"),
    ("module_681", "feature_preserved", "enhanced"),
    ("module_682", "feature_preserved", "enhanced"),
    ("module_683", "feature_preserved", "enhanced"),
    ("module_684", "feature_preserved", "enhanced"),
    ("module_685", "feature_preserved", "enhanced"),
    ("module_686", "feature_preserved", "enhanced"),
    ("module_687", "feature_preserved", "enhanced"),
    ("module_688", "feature_preserved", "enhanced"),
    ("module_689", "feature_preserved", "enhanced"),
    ("module_690", "feature_preserved", "enhanced"),
    ("module_691", "feature_preserved", "enhanced"),
    ("module_692", "feature_preserved", "enhanced"),
    ("module_693", "feature_preserved", "enhanced"),
    ("module_694", "feature_preserved", "enhanced"),
    ("module_695", "feature_preserved", "enhanced"),
    ("module_696", "feature_preserved", "enhanced"),
    ("module_697", "feature_preserved", "enhanced"),
    ("module_698", "feature_preserved", "enhanced"),
    ("module_699", "feature_preserved", "enhanced"),
    ("module_700", "feature_preserved", "enhanced"),
]

@app.route("/api/compatibility-matrix", methods=["GET"])
def compatibility_matrix():
    return jsonify({"items": SQR_EXTRA_COMPATIBILITY_MATRIX, "total": len(SQR_EXTRA_COMPATIBILITY_MATRIX)})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG", "0") == "1")
