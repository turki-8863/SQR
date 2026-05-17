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

TECH_SKILLS = [
    "python", "java", "javascript", "typescript", "html", "css", "sql", "mysql", "postgresql",
    "react", "node", "flask", "django", "api", "rest", "git", "github", "docker", "aws", "azure",
    "linux", "security", "cybersecurity", "networking", "forensics", "wireshark", "burp suite", "database",
    "machine learning", "ai", "data analysis", "data engineering", "etl", "cloud", "mongodb", "communication",
    "teamwork", "problem solving", "devops", "kubernetes", "php", "c++", "go", "rust", "swift",
    "figma", "ui", "ux", "testing", "automation", "incident response", "siem"
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
    "ui/ux engineering": ["ui", "ux", "design", "interface", "figma", "frontend", "user"],
}


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


def safe_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(float(value))
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


def first_existing_column(table_name, names):
    for name in names:
        if column_exists(table_name, name):
            return name
    return names[0]


def row_value(row, *names):
    for name in names:
        if isinstance(row, dict) and row.get(name) not in [None, ""]:
            return row.get(name)
    return None


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
    level = normalize_level(course.get("level"))
    course["level"] = level
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
    if not include_answer:
        row.pop("answer", None)
        row.pop("correct_answer", None)
    return row


def normalize_job(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "job_id")
    row["job_id"] = row["id"]
    row["skills"] = row_value(row, "skills", "required_skills") or ""
    row["required_skills"] = row["skills"]
    row["salary"] = row_value(row, "salary", "average_salary") or ""
    row["average_salary"] = row["salary"]
    row["link"] = row_value(row, "link", "job_link") or ""
    row["job_link"] = row["link"]
    row["specialization"] = row_value(row, "specialization_name", "specialization") or ""
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


def calculate_match_percentage(profile_text, target_text):
    profile = safe_text(profile_text).lower()
    target = safe_text(target_text).lower()
    words = []
    for skill in TECH_SKILLS:
        if skill in profile or skill in target:
            words.append(skill)
    matched = [skill for skill in words if skill in profile and skill in target]
    unique_target = sorted(set([skill for skill in words if skill in target]))
    if not unique_target:
        tokens = set(re.findall(r"[a-zA-Z][a-zA-Z+#.]{2,}", target))
        user_tokens = set(re.findall(r"[a-zA-Z][a-zA-Z+#.]{2,}", profile))
        if not tokens:
            return 0, []
        score = round((len(tokens & user_tokens) / max(len(tokens), 1)) * 100)
        return max(0, min(100, score)), sorted(tokens & user_tokens)[:12]
    score = round((len(set(matched)) / max(len(unique_target), 1)) * 100)
    return max(0, min(100, score)), sorted(set(matched))[:12]


def extract_resume_text(file):
    if not file or not file.filename:
        return ""
    name = file.filename.lower()
    raw = file.read()
    file.seek(0)
    if name.endswith(".txt"):
        return raw.decode("utf-8", errors="ignore")
    if name.endswith(".pdf") and PdfReader:
        reader = PdfReader(BytesIO(raw))
        return "\n".join([page.extract_text() or "" for page in reader.pages])
    if name.endswith(".docx") and Document:
        doc = Document(BytesIO(raw))
        return "\n".join([p.text for p in doc.paragraphs])
    return ""


def ai_json(prompt, fallback):
    if not client:
        return fallback
    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "Return valid JSON only. Do not invent user experience."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )
        text = response.choices[0].message.content or "{}"
        match = re.search(r"\{.*\}", text, re.DOTALL)
        return json.loads(match.group(0) if match else text)
    except Exception:
        return fallback



def init_db():
    """Create/patch the database without deleting project features.
    This version matches the Railway dump tables: specialization_id, course_id,
    quiz_id, job_id, specialization_enrollments, course_enrollments, and ats_id.
    """
    statements = [
        """
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role ENUM('student','admin') NOT NULL DEFAULT 'student',
            is_banned TINYINT(1) DEFAULT 0,
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
            admin_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            admin_level ENUM('owner','manager') DEFAULT 'manager',
            can_manage_users TINYINT(1) DEFAULT 1,
            can_manage_specializations TINYINT(1) DEFAULT 1,
            can_manage_courses TINYINT(1) DEFAULT 1,
            can_manage_quizzes TINYINT(1) DEFAULT 1,
            can_view_reports TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS specializations (
            specialization_id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            roadmap TEXT,
            job_titles TEXT,
            career_paths TEXT,
            image_url VARCHAR(255),
            skills TEXT,
            image VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS courses (
            course_id INT AUTO_INCREMENT PRIMARY KEY,
            specialization_id INT NOT NULL,
            title VARCHAR(150) NOT NULL,
            description TEXT,
            level ENUM('Beginner','Intermediate','Advanced') DEFAULT 'Beginner',
            course_link VARCHAR(255),
            video_url VARCHAR(255),
            image_url VARCHAR(255),
            spec_id INT,
            link VARCHAR(255),
            image VARCHAR(255),
            video VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
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
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS certifications (
            certification_id INT AUTO_INCREMENT PRIMARY KEY,
            specialization_id INT NOT NULL,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            official_link VARCHAR(255),
            price VARCHAR(50),
            type ENUM('Practical','Theoretical','Both') DEFAULT 'Both',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS jobs (
            job_id INT AUTO_INCREMENT PRIMARY KEY,
            specialization_id INT NOT NULL,
            title VARCHAR(150) NOT NULL,
            description TEXT,
            required_skills TEXT,
            average_salary VARCHAR(100),
            job_link VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS quizzes (
            quiz_id INT AUTO_INCREMENT PRIMARY KEY,
            course_id INT NOT NULL,
            title VARCHAR(150) NOT NULL,
            description TEXT,
            total_questions INT DEFAULT 0,
            spec_id INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS quiz_questions (
            question_id INT AUTO_INCREMENT PRIMARY KEY,
            quiz_id INT NOT NULL,
            question_text TEXT NOT NULL,
            option_a VARCHAR(255),
            option_b VARCHAR(255),
            option_c VARCHAR(255),
            option_d VARCHAR(255),
            correct_answer ENUM('A','B','C','D') NOT NULL,
            score DECIMAL(5,2) DEFAULT 1.00,
            question TEXT,
            option1 VARCHAR(255),
            option2 VARCHAR(255),
            option3 VARCHAR(255),
            option4 VARCHAR(255),
            answer VARCHAR(255)
        )
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
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS course_enrollments (
            enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            course_id INT NOT NULL,
            progress_percentage DECIMAL(5,2) DEFAULT 0.00,
            status ENUM('Not Started','In Progress','Completed') DEFAULT 'Not Started',
            enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL DEFAULT NULL,
            UNIQUE KEY unique_user_course (user_id, course_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS quiz_attempts (
            attempt_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            quiz_id INT NOT NULL,
            score DECIMAL(5,2) DEFAULT 0.00,
            passed TINYINT(1) DEFAULT 0,
            attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS ats_results (
            ats_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            resume_text LONGTEXT,
            target_job VARCHAR(150),
            ats_score DECIMAL(5,2) DEFAULT 0.00,
            missing_keywords TEXT,
            matched_keywords TEXT,
            suggestions TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
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
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS recommendation_results (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            recommendation_json LONGTEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_completed_courses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            course_id INT NOT NULL,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_completed_course (user_id, course_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_completed_quizzes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            quiz_id INT NOT NULL,
            score INT DEFAULT 0,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_completed_quiz (user_id, quiz_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS progress (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            spec_id INT NOT NULL,
            progress INT DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS specialization_progress (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            specialization_id INT NOT NULL,
            progress INT DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_spec_progress (user_id, specialization_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS students (
            student_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            university VARCHAR(150),
            major VARCHAR(100),
            gpa DECIMAL(3,2),
            skills TEXT,
            interests TEXT,
            graduation_year INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS assessments (
            assessment_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(150) DEFAULT 'Career Assessment',
            description TEXT,
            total_score DECIMAL(6,2) DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS assessment_answers (
            answer_id INT AUTO_INCREMENT PRIMARY KEY,
            assessment_id INT NOT NULL,
            question_text TEXT NOT NULL,
            selected_option VARCHAR(255),
            score DECIMAL(6,2) DEFAULT 0.00
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS cvs (
            cv_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            file_url VARCHAR(255),
            generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
    ]
    for statement in statements:
        try:
            exec_db(statement)
        except Exception as exc:
            print("init_db statement skipped:", exc)

    compatibility_columns = {
        "users": [
            ("current_mode", "ENUM('student','admin') DEFAULT 'student'"),
            ("banned", "TINYINT DEFAULT 0"),
            ("skills", "TEXT"),
            ("interests", "TEXT"),
            ("goal", "TEXT"),
        ],
        "specializations": [
            ("roadmap", "TEXT"),
            ("job_titles", "TEXT"),
            ("career_paths", "TEXT"),
            ("image_url", "VARCHAR(255)"),
            ("skills", "TEXT"),
            ("image", "VARCHAR(255)"),
        ],
        "courses": [
            ("spec_id", "INT"),
            ("link", "VARCHAR(255)"),
            ("image", "VARCHAR(255)"),
            ("video", "VARCHAR(255)"),
            ("course_link", "VARCHAR(255)"),
            ("video_url", "VARCHAR(255)"),
            ("image_url", "VARCHAR(255)"),
        ],
        "quiz_questions": [
            ("question", "TEXT"),
            ("option1", "VARCHAR(255)"),
            ("option2", "VARCHAR(255)"),
            ("option3", "VARCHAR(255)"),
            ("option4", "VARCHAR(255)"),
            ("answer", "VARCHAR(255)"),
        ],
    }
    for table, columns in compatibility_columns.items():
        if not table_exists(table):
            continue
        for column, definition in columns:
            try:
                if not column_exists(table, column):
                    exec_db(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}")
            except Exception as exc:
                print(f"init_db alter skipped for {table}.{column}:", exc)



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


@app.route("/api/health")
def health():
    return jsonify({
        "message": "SQR Backend is running",
        "features": ["auth", "admin", "specializations", "courses", "quizzes", "jobs", "profile", "progress", "ATS", "recommendation"],
        "database": DB_CONFIG.get("database")
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
    hashed_password = generate_password_hash(password, method="pbkdf2:sha256", salt_length=16)
    if column_exists("users", "username"):
        username = generate_username(name, email)
        user_id = query_db(
            """
            INSERT INTO users (username, name, email, password, role, current_mode, banned)
            VALUES (%s,%s,%s,%s,'student','student',0)
            """,
            (username, name, email, hashed_password),
            commit=True
        )
    else:
        user_id = query_db(
            """
            INSERT INTO users (name, email, password, role, current_mode, banned)
            VALUES (%s,%s,%s,'student','student',0)
            """,
            (name, email, hashed_password),
            commit=True
        )
    user = query_db("SELECT * FROM users WHERE id=%s", (user_id,), fetchone=True)
    return jsonify({"message": "Account created", "token": generate_token(user), "user": clean_user(user)}), 201



@app.route("/api/signin", methods=["POST"])
def signin():
    data = get_json()
    email = safe_text(data.get("email")).lower()
    password = safe_text(data.get("password"))
    user = query_db("SELECT * FROM users WHERE email=%s", (email,), fetchone=True)
    if not user or not check_password_hash(user.get("password") or "", password):
        return jsonify({"error": "Invalid email or password"}), 401
    if safe_int(user.get("banned"), 0) == 1:
        return jsonify({"error": "Your account is banned"}), 403
    return jsonify({"message": "Login successful", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/me")
@login_required
def me():
    return jsonify(clean_user(request.current_user))



@app.route("/api/profile", methods=["GET"])
@login_required
def get_profile():
    user = clean_user(request.current_user)
    user_id = user["id"]
    quiz_history = []
    try:
        quiz_history = query_db(
            """
            SELECT
                qa.attempt_id AS id,
                qa.attempt_id,
                qa.score,
                qa.passed,
                qa.attempted_at AS created_at,
                q.title AS quiz_title,
                c.title AS course_title,
                c.course_id,
                CASE
                    WHEN qa.score <= 1 THEN ROUND(qa.score * 100)
                    ELSE ROUND(qa.score)
                END AS score_percentage,
                COALESCE((SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id=qa.quiz_id), 0) AS total
            FROM quiz_attempts qa
            LEFT JOIN quizzes q ON q.quiz_id=qa.quiz_id
            LEFT JOIN courses c ON c.course_id=q.course_id
            WHERE qa.user_id=%s
            ORDER BY qa.attempted_at DESC
            LIMIT 30
            """,
            (user_id,),
            fetchall=True
        ) or []
    except Exception as exc:
        print("PROFILE QUIZ HISTORY ERROR:", exc)

    ats_history = []
    try:
        ats_history = query_db(
            """
            SELECT
                ats_id AS id,
                ats_id,
                target_job,
                ats_score AS score,
                ats_score,
                suggestions AS summary,
                matched_keywords,
                missing_keywords,
                created_at
            FROM ats_results
            WHERE user_id=%s
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (user_id,),
            fetchall=True
        ) or []
    except Exception as exc:
        print("PROFILE ATS HISTORY ERROR:", exc)

    return jsonify({"user": user, "quiz_history": quiz_history, "ats_history": ats_history})



@app.route("/api/profile", methods=["PUT"])
@login_required
def update_profile():
    data = get_json()
    name = safe_text(data.get("name")) or request.current_user.get("name")
    skills = safe_text(data.get("skills"))
    interests = safe_text(data.get("interests"))
    goal = safe_text(data.get("goal"))
    exec_db(
        "UPDATE users SET name=%s, skills=%s, interests=%s, goal=%s WHERE id=%s",
        (name, skills, interests, goal, request.current_user["id"])
    )
    user = query_db("SELECT * FROM users WHERE id=%s", (request.current_user["id"],), fetchone=True)
    return jsonify({"message": "Profile updated", "user": clean_user(user)})



def compute_user_progress(user_id):
    specs = query_db("SELECT * FROM specializations ORDER BY name", fetchall=True) or []
    progress_rows = []
    for spec in specs:
        spec_id = row_value(spec, "specialization_id", "id")
        if not spec_id:
            continue
        total_courses_row = query_db(
            "SELECT COUNT(*) AS total FROM courses WHERE specialization_id=%s",
            (spec_id,),
            fetchone=True
        ) or {"total": 0}
        total_courses = safe_int(total_courses_row.get("total"), 0)

        opened_row = {"total": 0}
        if table_exists("course_enrollments"):
            opened_row = query_db(
                """
                SELECT COUNT(DISTINCT ce.course_id) AS total
                FROM course_enrollments ce
                JOIN courses c ON c.course_id=ce.course_id
                WHERE ce.user_id=%s AND c.specialization_id=%s
                """,
                (user_id, spec_id),
                fetchone=True
            ) or {"total": 0}
        elif table_exists("user_completed_courses"):
            opened_row = query_db(
                """
                SELECT COUNT(DISTINCT ucc.course_id) AS total
                FROM user_completed_courses ucc
                JOIN courses c ON c.course_id=ucc.course_id
                WHERE ucc.user_id=%s AND c.specialization_id=%s
                """,
                (user_id, spec_id),
                fetchone=True
            ) or {"total": 0}

        quiz_row = {"completed_quizzes": 0, "average_score": 0}
        if table_exists("quiz_attempts"):
            quiz_row = query_db(
                """
                SELECT
                    COUNT(DISTINCT q.course_id) AS completed_quizzes,
                    COALESCE(ROUND(AVG(CASE WHEN qa.score <= 1 THEN qa.score * 100 ELSE qa.score END),0),0) AS average_score
                FROM quiz_attempts qa
                JOIN quizzes q ON q.quiz_id=qa.quiz_id
                JOIN courses c ON c.course_id=q.course_id
                WHERE qa.user_id=%s AND c.specialization_id=%s AND (qa.passed=1 OR qa.score >= 60 OR qa.score >= 0.6)
                """,
                (user_id, spec_id),
                fetchone=True
            ) or {"completed_quizzes": 0, "average_score": 0}

        opened_courses = safe_int(opened_row.get("total"), 0)
        completed_quizzes = safe_int(quiz_row.get("completed_quizzes"), 0)
        average_score = safe_int(quiz_row.get("average_score"), 0)
        if total_courses <= 0:
            percent_value = 0
        else:
            opened_part = (opened_courses / total_courses) * 50
            quiz_part = (completed_quizzes / total_courses) * 50
            percent_value = max(0, min(100, round(opened_part + quiz_part)))

        try:
            if table_exists("specialization_progress"):
                query_db(
                    """
                    INSERT INTO specialization_progress (user_id, specialization_id, progress)
                    VALUES (%s,%s,%s)
                    ON DUPLICATE KEY UPDATE progress=%s
                    """,
                    (user_id, spec_id, percent_value, percent_value),
                    commit=True
                )
        except Exception as exc:
            print("SPECIALIZATION_PROGRESS SAVE ERROR:", exc)

        try:
            if table_exists("specialization_enrollments"):
                status = "Completed" if percent_value >= 100 else ("In Progress" if percent_value > 0 else "Not Started")
                query_db(
                    """
                    UPDATE specialization_enrollments
                    SET progress_percentage=%s, status=%s, completed_at=CASE WHEN %s >= 100 THEN CURRENT_TIMESTAMP ELSE completed_at END
                    WHERE user_id=%s AND specialization_id=%s
                    """,
                    (percent_value, status, percent_value, user_id, spec_id),
                    commit=True
                )
        except Exception as exc:
            print("SPECIALIZATION_ENROLLMENTS PROGRESS ERROR:", exc)

        progress_rows.append({
            "specialization_id": spec_id,
            "id": spec_id,
            "specialization_name": spec.get("name"),
            "name": spec.get("name"),
            "total_courses": total_courses,
            "opened_courses": opened_courses,
            "completed_quizzes": completed_quizzes,
            "average_quiz_score": average_score,
            "progress": percent_value,
            "percentage": percent_value,
        })
    return progress_rows



@app.route("/api/profile/progress")
@login_required
def profile_progress():
    return jsonify({"progress": compute_user_progress(request.current_user["id"])})



@app.route("/api/specializations", methods=["GET"])
def get_specializations():
    try:
        rows = query_db(
            """
            SELECT *
            FROM specializations
            ORDER BY specialization_id DESC
            """,
            fetchall=True
        ) or []
        return jsonify({"specializations": [normalize_specialization(row) for row in rows]}), 200
    except Exception as e:
        print("GET SPECIALIZATIONS ERROR:", str(e))
        return jsonify({"error": "Could not load specializations", "details": str(e)}), 500


@app.route("/api/specializations/<int:spec_id>", methods=["GET"])
def get_specialization(spec_id):
    try:
        spec = query_db("SELECT * FROM specializations WHERE specialization_id=%s", (spec_id,), fetchone=True)
        if not spec:
            return jsonify({"error": "Specialization not found"}), 404

        courses = query_db(
            """
            SELECT *
            FROM courses
            WHERE specialization_id=%s
            ORDER BY course_id DESC
            """,
            (spec_id,),
            fetchall=True
        ) or []

        jobs = query_db(
            """
            SELECT *
            FROM jobs
            WHERE specialization_id=%s
            ORDER BY job_id DESC
            """,
            (spec_id,),
            fetchall=True
        ) or []

        certificates = []
        if table_exists("certificates"):
            certificates = query_db(
                """
                SELECT id, spec_id AS specialization_id, name, description, link, price, type, created_at
                FROM certificates
                WHERE spec_id=%s
                ORDER BY id DESC
                """,
                (spec_id,),
                fetchall=True
            ) or []
        certifications = []
        if table_exists("certifications"):
            certifications = query_db(
                """
                SELECT certification_id AS id, specialization_id, name, description, official_link AS link, price, type, created_at
                FROM certifications
                WHERE specialization_id=%s
                ORDER BY certification_id DESC
                """,
                (spec_id,),
                fetchall=True
            ) or []

        merged_certs = certificates + certifications
        return jsonify({
            "specialization": normalize_specialization(spec),
            "courses": [normalize_course(row) for row in courses],
            "jobs": [normalize_job(row) for row in jobs],
            "certificates": merged_certs,
            "certifications": merged_certs
        }), 200
    except Exception as e:
        print("SPECIALIZATION DETAILS ERROR:", str(e))
        return jsonify({"error": "Server error", "details": str(e)}), 500


@app.route("/api/specializations/<int:spec_id>/enrollment-status", methods=["GET"])
@login_required
def specialization_enrollment_status(spec_id):
    try:
        user_id = request.current_user["id"]
        row = query_db(
            """
            SELECT 1
            FROM specialization_enrollments
            WHERE user_id=%s AND specialization_id=%s
            LIMIT 1
            """,
            (user_id, spec_id),
            fetchone=True
        )
        return jsonify({"enrolled": bool(row), "is_enrolled": bool(row), "user_enrolled": bool(row)}), 200
    except Exception as e:
        print("SPECIALIZATION STATUS ERROR:", str(e))
        return jsonify({"error": "Server error", "details": str(e)}), 500


@app.route("/api/specializations/<int:spec_id>/enroll", methods=["POST"])
@login_required
def enroll_specialization(spec_id):
    try:
        user_id = request.current_user["id"]
        spec = query_db("SELECT specialization_id FROM specializations WHERE specialization_id=%s", (spec_id,), fetchone=True)
        if not spec:
            return jsonify({"error": "Specialization not found"}), 404
        existing = query_db(
            """
            SELECT 1
            FROM specialization_enrollments
            WHERE user_id=%s AND specialization_id=%s
            LIMIT 1
            """,
            (user_id, spec_id),
            fetchone=True
        )
        if existing:
            return jsonify({"message": "Already enrolled", "enrolled": True}), 200
        query_db(
            """
            INSERT INTO specialization_enrollments (user_id, specialization_id, progress_percentage, status)
            VALUES (%s,%s,0,'Not Started')
            """,
            (user_id, spec_id),
            commit=True
        )
        return jsonify({"message": "Enrolled successfully", "enrolled": True}), 201
    except Exception as e:
        print("SPECIALIZATION ENROLL ERROR:", str(e))
        return jsonify({"error": "Server error", "details": str(e)}), 500


@app.route("/api/specializations/<int:spec_id>/unenroll", methods=["POST"])
@login_required
def unenroll_specialization(spec_id):
    try:
        user_id = request.current_user["id"]
        query_db(
            """
            DELETE FROM specialization_enrollments
            WHERE user_id=%s AND specialization_id=%s
            """,
            (user_id, spec_id),
            commit=True
        )
        return jsonify({"message": "Unenrolled successfully", "enrolled": False}), 200
    except Exception as e:
        print("SPECIALIZATION UNENROLL ERROR:", str(e))
        return jsonify({"error": "Server error", "details": str(e)}), 500




@app.route("/api/specializations", methods=["POST"])
@admin_required
def add_specialization():
    data = request_data()
    image = save_file("image") or safe_text(data.get("image") or data.get("image_url"))
    name = safe_text(data.get("name"))
    if not name:
        return jsonify({"error": "Specialization name is required"}), 400
    spec_id = query_db(
        """
        INSERT INTO specializations (name, description, roadmap, job_titles, career_paths, skills, image_url, image)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            name,
            safe_text(data.get("description")),
            safe_text(data.get("roadmap")),
            safe_text(data.get("job_titles")),
            safe_text(data.get("career_paths")),
            safe_text(data.get("skills")),
            image,
            image,
        ),
        commit=True
    )
    return jsonify({"message": "Specialization added", "id": spec_id, "specialization_id": spec_id})


@app.route("/api/specializations/<int:spec_id>", methods=["PUT"])
@admin_required
def update_specialization(spec_id):
    data = request_data()
    old = query_db("SELECT * FROM specializations WHERE specialization_id=%s", (spec_id,), fetchone=True)
    if not old:
        return jsonify({"error": "Specialization not found"}), 404
    image = save_file("image") or safe_text(data.get("image") or data.get("image_url")) or row_value(old, "image_url", "image")
    exec_db(
        """
        UPDATE specializations
        SET name=%s, description=%s, roadmap=%s, job_titles=%s, career_paths=%s, skills=%s, image_url=%s, image=%s
        WHERE specialization_id=%s
        """,
        (
            safe_text(data.get("name")) or old.get("name"),
            safe_text(data.get("description")) or old.get("description"),
            safe_text(data.get("roadmap")) or old.get("roadmap"),
            safe_text(data.get("job_titles")) or old.get("job_titles"),
            safe_text(data.get("career_paths")) or old.get("career_paths"),
            safe_text(data.get("skills")) or old.get("skills"),
            image,
            image,
            spec_id,
        )
    )
    return jsonify({"message": "Specialization updated"})


@app.route("/api/specializations/<int:spec_id>", methods=["DELETE"])
@admin_required
def delete_specialization(spec_id):
    exec_db("DELETE FROM specializations WHERE specialization_id=%s", (spec_id,))
    return jsonify({"message": "Specialization deleted"})




@app.route("/api/courses", methods=["GET"])
def get_courses():
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    search = safe_text(request.args.get("search"))
    sql = """
        SELECT c.*, s.name AS specialization_name
        FROM courses c
        LEFT JOIN specializations s ON s.specialization_id=c.specialization_id
        WHERE 1=1
    """
    params = []
    if spec_id:
        sql += " AND c.specialization_id=%s"
        params.append(spec_id)
    if search:
        sql += " AND (c.title LIKE %s OR c.description LIKE %s OR c.level LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    sql += " ORDER BY c.course_id DESC"
    rows = query_db(sql, tuple(params), fetchall=True) or []
    return jsonify({"courses": [normalize_course(row) for row in rows]})


@app.route("/api/courses/<int:course_id>", methods=["GET"])
def get_course(course_id):
    course = query_db(
        """
        SELECT c.*, s.name AS specialization_name
        FROM courses c
        LEFT JOIN specializations s ON s.specialization_id=c.specialization_id
        WHERE c.course_id=%s
        """,
        (course_id,),
        fetchone=True
    )
    if not course:
        return jsonify({"error": "Course not found"}), 404
    quizzes = query_db("SELECT * FROM quizzes WHERE course_id=%s ORDER BY quiz_id DESC", (course_id,), fetchall=True) or []
    return jsonify({"course": normalize_course(course), "quizzes": [normalize_quiz(row) for row in quizzes]})


@app.route("/api/courses", methods=["POST"])
@admin_required
def add_course():
    data = request_data()
    image = save_file("image") or safe_text(data.get("image") or data.get("image_url"))
    video = save_file("video") or safe_text(data.get("video") or data.get("video_url"))
    title = safe_text(data.get("title"))
    spec_id = safe_int(data.get("specialization_id") or data.get("spec_id"), None)
    if not title:
        return jsonify({"error": "Course title is required"}), 400
    if not spec_id:
        return jsonify({"error": "Specialization is required"}), 400
    level = normalize_level(data.get("level")).capitalize()
    if level == "Intermediate":
        level = "Intermediate"
    course_id = query_db(
        """
        INSERT INTO courses (specialization_id, spec_id, title, description, level, course_link, link, image_url, image, video_url, video)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            spec_id,
            spec_id,
            title,
            safe_text(data.get("description")),
            level,
            safe_text(data.get("course_link") or data.get("link")),
            safe_text(data.get("course_link") or data.get("link")),
            image,
            image,
            video,
            video,
        ),
        commit=True
    )
    return jsonify({"message": "Course added", "id": course_id, "course_id": course_id})


@app.route("/api/courses/<int:course_id>", methods=["PUT"])
@admin_required
def update_course(course_id):
    data = request_data()
    old = query_db("SELECT * FROM courses WHERE course_id=%s", (course_id,), fetchone=True)
    if not old:
        return jsonify({"error": "Course not found"}), 404
    image = save_file("image") or safe_text(data.get("image") or data.get("image_url")) or row_value(old, "image_url", "image")
    video = save_file("video") or safe_text(data.get("video") or data.get("video_url")) or row_value(old, "video_url", "video")
    spec_id = safe_int(data.get("specialization_id") or data.get("spec_id"), row_value(old, "specialization_id", "spec_id"))
    level = normalize_level(data.get("level") or old.get("level")).capitalize()
    exec_db(
        """
        UPDATE courses
        SET specialization_id=%s, spec_id=%s, title=%s, description=%s, level=%s,
            course_link=%s, link=%s, image_url=%s, image=%s, video_url=%s, video=%s
        WHERE course_id=%s
        """,
        (
            spec_id,
            spec_id,
            safe_text(data.get("title")) or old.get("title"),
            safe_text(data.get("description")) or old.get("description"),
            level,
            safe_text(data.get("course_link") or data.get("link") or row_value(old, "course_link", "link")),
            safe_text(data.get("course_link") or data.get("link") or row_value(old, "course_link", "link")),
            image,
            image,
            video,
            video,
            course_id,
        )
    )
    return jsonify({"message": "Course updated"})


@app.route("/api/courses/<int:course_id>", methods=["DELETE"])
@admin_required
def delete_course(course_id):
    exec_db("DELETE FROM courses WHERE course_id=%s", (course_id,))
    return jsonify({"message": "Course deleted"})


@app.route("/api/courses/<int:course_id>/open", methods=["POST"])
@student_required
def open_course(course_id):
    course = query_db("SELECT * FROM courses WHERE course_id=%s", (course_id,), fetchone=True)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    data = get_json()
    completed = 1 if data.get("completed") else 0
    status = "Completed" if completed else "In Progress"
    progress_value = 100 if completed else 25
    query_db(
        """
        INSERT INTO course_enrollments (user_id, course_id, progress_percentage, status, completed_at)
        VALUES (%s,%s,%s,%s,CASE WHEN %s=100 THEN CURRENT_TIMESTAMP ELSE NULL END)
        ON DUPLICATE KEY UPDATE
            progress_percentage=GREATEST(progress_percentage, VALUES(progress_percentage)),
            status=CASE WHEN VALUES(progress_percentage) >= 100 THEN 'Completed' ELSE 'In Progress' END,
            completed_at=CASE WHEN VALUES(progress_percentage) >= 100 THEN CURRENT_TIMESTAMP ELSE completed_at END
        """,
        (request.current_user["id"], course_id, progress_value, status, progress_value),
        commit=True
    )
    if completed and table_exists("user_completed_courses"):
        query_db(
            "INSERT IGNORE INTO user_completed_courses (user_id, course_id) VALUES (%s,%s)",
            (request.current_user["id"], course_id),
            commit=True
        )
    compute_user_progress(request.current_user["id"])
    return jsonify({"message": "Course progress tracked"})




@app.route("/api/quizzes", methods=["GET"])
def get_quizzes():
    course_id = request.args.get("course_id")
    sql = """
        SELECT q.*, c.title AS course_title
        FROM quizzes q
        LEFT JOIN courses c ON c.course_id=q.course_id
        WHERE 1=1
    """
    params = []
    if course_id:
        sql += " AND q.course_id=%s"
        params.append(course_id)
    sql += " ORDER BY q.quiz_id DESC"
    rows = query_db(sql, tuple(params), fetchall=True) or []
    return jsonify({"quizzes": [normalize_quiz(row) for row in rows]})


@app.route("/api/quizzes/<int:quiz_id>", methods=["GET"])
def get_quiz(quiz_id):
    quiz = query_db(
        """
        SELECT q.*, c.title AS course_title
        FROM quizzes q
        LEFT JOIN courses c ON c.course_id=q.course_id
        WHERE q.quiz_id=%s
        """,
        (quiz_id,),
        fetchone=True
    )
    if not quiz:
        return jsonify({"error": "Quiz not found"}), 404
    questions = query_db("SELECT * FROM quiz_questions WHERE quiz_id=%s ORDER BY question_id", (quiz_id,), fetchall=True) or []
    return jsonify({"quiz": normalize_quiz(quiz), "questions": [normalize_question(row) for row in questions]})


@app.route("/api/quizzes", methods=["POST"])
@admin_required
def add_quiz():
    data = get_json()
    title = safe_text(data.get("title") or data.get("name"))
    course_id = safe_int(data.get("course_id"), None)
    if not title or not course_id:
        return jsonify({"error": "Quiz title and course are required"}), 400
    course = query_db("SELECT * FROM courses WHERE course_id=%s", (course_id,), fetchone=True)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    quiz_id = query_db(
        "INSERT INTO quizzes (course_id,title,description,total_questions,spec_id) VALUES (%s,%s,%s,0,%s)",
        (course_id, title, safe_text(data.get("description")), row_value(course, "specialization_id", "spec_id")),
        commit=True
    )
    questions = data.get("questions") or []
    if not questions and data.get("questions_json"):
        try:
            questions = json.loads(data.get("questions_json"))
        except Exception:
            questions = []
    count = 0
    for q in questions:
        add_question_to_quiz(quiz_id, q)
        count += 1
    exec_db("UPDATE quizzes SET total_questions=%s WHERE quiz_id=%s", (count, quiz_id))
    return jsonify({"message": "Quiz added", "id": quiz_id, "quiz_id": quiz_id})


def add_question_to_quiz(quiz_id, data):
    question = safe_text(data.get("question") or data.get("question_text"))
    option_a = safe_text(data.get("option_a") or data.get("option1"))
    option_b = safe_text(data.get("option_b") or data.get("option2"))
    option_c = safe_text(data.get("option_c") or data.get("option3"))
    option_d = safe_text(data.get("option_d") or data.get("option4"))
    answer = safe_text(data.get("correct_answer") or data.get("answer")).upper()
    aliases = {"1": "A", "2": "B", "3": "C", "4": "D", option_a.upper(): "A", option_b.upper(): "B", option_c.upper(): "C", option_d.upper(): "D"}
    answer = aliases.get(answer, answer if answer in ["A", "B", "C", "D"] else "A")
    return query_db(
        """
        INSERT INTO quiz_questions
            (quiz_id,question_text,option_a,option_b,option_c,option_d,correct_answer,question,option1,option2,option3,option4,answer)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (quiz_id, question, option_a, option_b, option_c, option_d, answer, question, option_a, option_b, option_c, option_d, answer),
        commit=True
    )


@app.route("/api/quizzes/<int:quiz_id>/questions", methods=["POST"])
@admin_required
def add_quiz_question(quiz_id):
    question_id = add_question_to_quiz(quiz_id, get_json())
    row = query_db("SELECT COUNT(*) AS total FROM quiz_questions WHERE quiz_id=%s", (quiz_id,), fetchone=True) or {"total": 0}
    exec_db("UPDATE quizzes SET total_questions=%s WHERE quiz_id=%s", (safe_int(row.get("total"), 0), quiz_id))
    return jsonify({"message": "Question added", "id": question_id})


@app.route("/api/quizzes/<int:quiz_id>", methods=["DELETE"])
@admin_required
def delete_quiz(quiz_id):
    exec_db("DELETE FROM quizzes WHERE quiz_id=%s", (quiz_id,))
    return jsonify({"message": "Quiz deleted"})


@app.route("/api/quizzes/<int:quiz_id>/submit", methods=["POST"])
@student_required
def submit_quiz(quiz_id):
    data = get_json()
    answers = data.get("answers") or {}
    questions = query_db("SELECT * FROM quiz_questions WHERE quiz_id=%s ORDER BY question_id", (quiz_id,), fetchall=True) or []
    quiz = query_db("SELECT * FROM quizzes WHERE quiz_id=%s", (quiz_id,), fetchone=True)
    if not quiz:
        return jsonify({"error": "Quiz not found"}), 404
    score = 0
    details = []
    for q in questions:
        qid = str(row_value(q, "question_id", "id"))
        given = safe_text(answers.get(qid) or answers.get(row_value(q, "question_id", "id"))).upper()
        correct = safe_text(row_value(q, "correct_answer", "answer")).upper()
        normalized = {"1": "A", "2": "B", "3": "C", "4": "D"}.get(given, given)
        ok = normalized == correct
        if ok:
            score += 1
        details.append({"question_id": qid, "given": normalized, "correct": correct, "correct_boolean": bool(ok)})
    total = len(questions)
    percentage = round((score / total) * 100) if total else 0
    passed = 1 if percentage >= 60 else 0
    attempt_id = query_db(
        """
        INSERT INTO quiz_attempts (user_id,quiz_id,score,passed)
        VALUES (%s,%s,%s,%s)
        """,
        (request.current_user["id"], quiz_id, percentage, passed),
        commit=True
    )
    if passed and table_exists("user_completed_quizzes"):
        query_db(
            "INSERT INTO user_completed_quizzes (user_id, quiz_id, score) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE score=GREATEST(score,VALUES(score)), completed_at=CURRENT_TIMESTAMP",
            (request.current_user["id"], quiz_id, percentage),
            commit=True
        )
    course_id = quiz.get("course_id")
    if course_id:
        progress_value = 100 if passed else 50
        query_db(
            """
            INSERT INTO course_enrollments (user_id, course_id, progress_percentage, status, completed_at)
            VALUES (%s,%s,%s,%s,CASE WHEN %s=100 THEN CURRENT_TIMESTAMP ELSE NULL END)
            ON DUPLICATE KEY UPDATE
                progress_percentage=GREATEST(progress_percentage,VALUES(progress_percentage)),
                status=CASE WHEN VALUES(progress_percentage) >= 100 THEN 'Completed' ELSE 'In Progress' END,
                completed_at=CASE WHEN VALUES(progress_percentage) >= 100 THEN CURRENT_TIMESTAMP ELSE completed_at END
            """,
            (request.current_user["id"], course_id, progress_value, "Completed" if passed else "In Progress", progress_value),
            commit=True
        )
        if passed and table_exists("user_completed_courses"):
            query_db(
                "INSERT IGNORE INTO user_completed_courses (user_id, course_id) VALUES (%s,%s)",
                (request.current_user["id"], course_id),
                commit=True
            )
    compute_user_progress(request.current_user["id"])
    return jsonify({"message": "Quiz submitted", "attempt_id": attempt_id, "score": score, "total": total, "score_percentage": percentage, "details": details})




@app.route("/api/jobs", methods=["GET"])
def get_jobs():
    search = safe_text(request.args.get("search"))
    spec_id = request.args.get("specialization_id") or request.args.get("spec_id")
    sql = """
        SELECT j.*, s.name AS specialization_name
        FROM jobs j
        LEFT JOIN specializations s ON s.specialization_id=j.specialization_id
        WHERE 1=1
    """
    params = []
    if search:
        sql += " AND (j.title LIKE %s OR j.description LIKE %s OR j.required_skills LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    if spec_id:
        sql += " AND j.specialization_id=%s"
        params.append(spec_id)
    sql += " ORDER BY j.job_id DESC"
    rows = query_db(sql, tuple(params), fetchall=True) or []
    return jsonify({"jobs": [normalize_job(row) for row in rows]})


@app.route("/api/jobs/<int:job_id>", methods=["GET"])
def get_job(job_id):
    row = query_db(
        """
        SELECT j.*, s.name AS specialization_name
        FROM jobs j
        LEFT JOIN specializations s ON s.specialization_id=j.specialization_id
        WHERE j.job_id=%s
        """,
        (job_id,),
        fetchone=True
    )
    if not row:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({"job": normalize_job(row)})


@app.route("/api/jobs", methods=["POST"])
@admin_required
def add_job():
    data = get_json()
    title = safe_text(data.get("title"))
    spec_id = safe_int(data.get("specialization_id") or data.get("spec_id"), None)
    if not title:
        return jsonify({"error": "Job title is required"}), 400
    if not spec_id:
        return jsonify({"error": "Specialization is required"}), 400
    job_id = query_db(
        """
        INSERT INTO jobs (specialization_id,title,description,required_skills,average_salary,job_link)
        VALUES (%s,%s,%s,%s,%s,%s)
        """,
        (spec_id, title, safe_text(data.get("description")), safe_text(data.get("required_skills") or data.get("skills")), safe_text(data.get("average_salary") or data.get("salary")), safe_text(data.get("job_link") or data.get("link"))),
        commit=True
    )
    return jsonify({"message": "Job added", "id": job_id, "job_id": job_id})


@app.route("/api/jobs/<int:job_id>", methods=["PUT"])
@admin_required
def update_job(job_id):
    data = get_json()
    old = query_db("SELECT * FROM jobs WHERE job_id=%s", (job_id,), fetchone=True)
    if not old:
        return jsonify({"error": "Job not found"}), 404
    exec_db(
        """
        UPDATE jobs
        SET specialization_id=%s,title=%s,description=%s,required_skills=%s,average_salary=%s,job_link=%s
        WHERE job_id=%s
        """,
        (
            safe_int(data.get("specialization_id") or data.get("spec_id"), old.get("specialization_id")),
            safe_text(data.get("title")) or old.get("title"),
            safe_text(data.get("description")) or old.get("description"),
            safe_text(data.get("required_skills") or data.get("skills") or old.get("required_skills")),
            safe_text(data.get("average_salary") or data.get("salary") or old.get("average_salary")),
            safe_text(data.get("job_link") or data.get("link") or old.get("job_link")),
            job_id,
        )
    )
    return jsonify({"message": "Job updated"})


@app.route("/api/jobs/<int:job_id>", methods=["DELETE"])
@admin_required
def delete_job(job_id):
    exec_db("DELETE FROM jobs WHERE job_id=%s", (job_id,))
    return jsonify({"message": "Job deleted"})


@app.route("/api/certificates", methods=["GET"])
def get_certificates():
    rows = []
    if table_exists("certificates"):
        rows += query_db(
            """
            SELECT c.id, c.spec_id AS specialization_id, c.name, c.description, c.link, c.price, c.type, c.created_at, s.name AS specialization_name
            FROM certificates c
            LEFT JOIN specializations s ON s.specialization_id=c.spec_id
            ORDER BY c.id DESC
            """,
            fetchall=True
        ) or []
    if table_exists("certifications"):
        rows += query_db(
            """
            SELECT c.certification_id AS id, c.specialization_id, c.name, c.description, c.official_link AS link, c.price, c.type, c.created_at, s.name AS specialization_name
            FROM certifications c
            LEFT JOIN specializations s ON s.specialization_id=c.specialization_id
            ORDER BY c.certification_id DESC
            """,
            fetchall=True
        ) or []
    return jsonify({"certificates": rows})


@app.route("/api/certificates", methods=["POST"])
@admin_required
def add_certificate():
    data = get_json()
    name = safe_text(data.get("name"))
    spec_id = safe_int(data.get("specialization_id") or data.get("spec_id"), None)
    if not name:
        return jsonify({"error": "Certificate name is required"}), 400
    if not spec_id:
        return jsonify({"error": "Specialization is required"}), 400
    cert_id = query_db(
        "INSERT INTO certificates (spec_id,name,description,link,price,type) VALUES (%s,%s,%s,%s,%s,%s)",
        (spec_id, name, safe_text(data.get("description")), safe_text(data.get("link") or data.get("official_link")), safe_text(data.get("price")), safe_text(data.get("type")).lower() or "both"),
        commit=True
    )
    return jsonify({"message": "Certificate added", "id": cert_id})


@app.route("/api/certificates/<int:cert_id>", methods=["DELETE"])
@admin_required
def delete_certificate(cert_id):
    exec_db("DELETE FROM certificates WHERE id=%s", (cert_id,))
    return jsonify({"message": "Certificate deleted"})


@app.route("/api/recommendations", methods=["POST"])
@student_required
def recommendations():
    data = get_json()
    interests = safe_text(data.get("interests"))
    skills = safe_text(data.get("skills"))
    preferred_work = safe_text(data.get("preferred_work") or data.get("goal"))
    profile_text = f"{interests} {skills} {preferred_work}".lower()
    specs = [normalize_specialization(row) for row in (query_db("SELECT * FROM specializations", fetchall=True) or [])]
    jobs = [normalize_job(row) for row in (query_db("SELECT j.*, s.name AS specialization_name FROM jobs j LEFT JOIN specializations s ON s.specialization_id=j.specialization_id", fetchall=True) or [])]
    recommended_specs = []
    for spec in specs:
        target = f"{spec.get('name','')} {spec.get('description','')} {spec.get('skills','')}"
        score, matches = calculate_match_percentage(profile_text, target)
        lower_name = safe_text(spec.get("name")).lower()
        for key, hints in SPECIALIZATION_HINTS.items():
            if key in lower_name:
                score = max(score, min(100, len([h for h in hints if h in profile_text]) * 18))
        recommended_specs.append({"id": spec.get("id"), "name": spec.get("name"), "match_percentage": score, "matched_skills": matches, "reason": "Matched your interests and skills with specialization content."})
    recommended_jobs = []
    for job in jobs:
        target = f"{job.get('title','')} {job.get('description','')} {job.get('skills','')} {job.get('specialization','')}"
        score, matches = calculate_match_percentage(profile_text, target)
        recommended_jobs.append({"id": job.get("id"), "title": job.get("title"), "match_percentage": score, "matched_skills": matches, "salary": job.get("salary"), "reason": "Matched your profile with job skills and description."})
    recommended_specs.sort(key=lambda item: item["match_percentage"], reverse=True)
    recommended_jobs.sort(key=lambda item: item["match_percentage"], reverse=True)
    fallback = {
        "recommended_specializations": recommended_specs[:5],
        "recommended_jobs": recommended_jobs[:8],
        "roadmap": [
            "Choose the highest matching specialization.",
            "Start beginner courses, then move to intermediate and advanced content.",
            "Complete course quizzes to update your profile progress.",
            "Use ATS tools to improve your resume for the highest matching jobs."
        ],
        "summary": "Recommendations are based on your answers and current database content."
    }
    prompt = f"Return JSON with recommended_specializations, recommended_jobs, roadmap, summary. User interests: {interests}. Skills: {skills}. Preferred work: {preferred_work}. Specs: {json.dumps(specs[:20])}. Jobs: {json.dumps(jobs[:30])}."
    result = ai_json(prompt, fallback)
    try:
        if table_exists("recommendation_results"):
            query_db("INSERT INTO recommendation_results (user_id,recommendation_json) VALUES (%s,%s)", (request.current_user["id"], json.dumps(result)), commit=True)
        elif table_exists("recommendations") and recommended_specs:
            top = recommended_specs[0]
            query_db(
                "INSERT INTO recommendations (user_id,specialization_id,match_score,explanation) VALUES (%s,%s,%s,%s)",
                (request.current_user["id"], top.get("id"), top.get("match_percentage", 0), json.dumps(result)),
                commit=True
            )
    except Exception as exc:
        print("RECOMMENDATION SAVE ERROR:", exc)
    return jsonify(result)


@app.route("/api/recommendations/analyze", methods=["POST"])
@student_required
def recommendations_analyze():
    return recommendations()


@app.route("/api/ats/check", methods=["POST"])
@student_required
def ats_check():
    target_job = safe_text(request.form.get("target_job") or request.form.get("job_description"))
    resume_file = request.files.get("resume_file") or request.files.get("resume")
    if not target_job:
        return jsonify({"error": "Target job or job description is required"}), 400
    if not resume_file:
        return jsonify({"error": "Please upload a PDF, DOCX, or TXT resume"}), 400
    resume_text = extract_resume_text(resume_file)
    if not resume_text.strip():
        return jsonify({"error": "Could not read resume text from this file"}), 400
    score, matched = calculate_match_percentage(resume_text, target_job)
    target_skills = [skill for skill in TECH_SKILLS if skill in target_job.lower()]
    missing = [skill for skill in target_skills if skill not in resume_text.lower()]
    section_scores = {
        "keywords": score,
        "structure": 85 if re.search(r"education|experience|projects|skills", resume_text, re.I) else 55,
        "clarity": 80 if len(resume_text.split()) > 120 else 60,
    }
    ats_score = round((section_scores["keywords"] * 0.5) + (section_scores["structure"] * 0.3) + (section_scores["clarity"] * 0.2))
    fallback = {
        "ats_score": ats_score,
        "score": ats_score,
        "summary": "ATS analysis completed using resume text, target job keywords, and structure checks.",
        "matched_keywords": matched,
        "missing_keywords": missing[:20],
        "strengths": ["Resume file was readable", "Relevant keywords were detected"] if matched else ["Resume file was readable"],
        "weaknesses": ["Add more target-job keywords"] if missing else [],
        "improvements": ["Add measurable achievements", "Add missing role-specific keywords", "Keep sections clear: Summary, Skills, Projects, Education"],
        "section_scores": section_scores,
    }
    prompt = f"Return JSON ATS result with ats_score, summary, matched_keywords, missing_keywords, strengths, weaknesses, improvements, section_scores. Target job: {target_job}. Resume: {resume_text[:5000]}"
    result = ai_json(prompt, fallback)
    ats_score = safe_int(result.get("ats_score") or result.get("score"), ats_score)
    suggestions = safe_text(result.get("summary")) or json.dumps(result.get("improvements", []))
    query_db(
        """
        INSERT INTO ats_results (user_id,resume_text,target_job,ats_score,matched_keywords,missing_keywords,suggestions)
        VALUES (%s,%s,%s,%s,%s,%s,%s)
        """,
        (request.current_user["id"], resume_text[:60000], target_job[:150], ats_score, json.dumps(result.get("matched_keywords", [])), json.dumps(result.get("missing_keywords", [])), suggestions),
        commit=True
    )
    return jsonify(result)


@app.route("/api/ats/generate", methods=["POST"])
@student_required
def ats_generate():
    try:
        data = request.get_json(silent=True) or request.form.to_dict()
        name = safe_text(data.get("name"))
        email = safe_text(data.get("email"))
        phone = safe_text(data.get("phone"))
        location = safe_text(data.get("location"))
        target_role = safe_text(data.get("target_role") or data.get("target_job"))
        linkedin = safe_text(data.get("linkedin"))
        summary = safe_text(data.get("summary"))
        technical_skills = safe_text(data.get("technical_skills") or data.get("technicalSkills") or data.get("tech_skills") or data.get("skills"))
        soft_skills = safe_text(data.get("soft_skills") or data.get("softSkills"))
        education = safe_text(data.get("education"))
        experience = safe_text(data.get("experience"))
        projects = safe_text(data.get("projects"))
        certifications = safe_text(data.get("certifications"))
        if not name or not email or not phone or not target_role or not summary or not technical_skills or not soft_skills or not education:
            return jsonify({"error": "Name, email, phone, target role, summary, technical skills, soft skills, and education are required"}), 400
        enhanced_summary = (
            f"{name} is an aspiring {target_role} with experience in {technical_skills}. "
            f"The candidate demonstrates {soft_skills} and is focused on building practical, ATS-friendly career readiness."
        )
        resume_parts = [name.upper()]
        contact_line = f"{email} | {phone}"
        if location:
            contact_line += f" | {location}"
        if linkedin:
            contact_line += f" | {linkedin}"
        resume_parts.append(contact_line)
        resume_parts.extend([
            "\nPROFESSIONAL SUMMARY", summary,
            "\nTARGET ROLE", target_role,
            "\nTECHNICAL SKILLS", technical_skills,
            "\nSOFT SKILLS", soft_skills,
            "\nEDUCATION", education,
        ])
        if experience:
            resume_parts.extend(["\nEXPERIENCE", experience])
        if projects:
            resume_parts.extend(["\nPROJECTS", projects])
        if certifications:
            resume_parts.extend(["\nCERTIFICATIONS", certifications])
        resume = "\n".join(resume_parts)
        keyword_text = " ".join([target_role, summary, technical_skills, soft_skills, education, experience, projects, certifications]).lower()
        ats_keywords = ["python", "java", "sql", "linux", "flask", "html", "css", "javascript", "git", "api", "database", "project", "communication", "teamwork", "problem solving", "leadership"]
        matched = [kw for kw in ats_keywords if kw in keyword_text]
        ats_score = min(100, 55 + len(matched) * 5)
        return jsonify({"resume": resume, "enhanced_summary": enhanced_summary, "ats_score": ats_score, "matched_keywords": matched, "message": "ATS resume generated successfully"}), 200
    except Exception as e:
        print("ATS GENERATE ERROR:", e)
        return jsonify({"error": "Could not generate ATS resume"}), 500


def build_resume_pdf(text):
    if not all([SimpleDocTemplate, Paragraph, Spacer, A4, getSampleStyleSheet]):
        return None
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=44, leftMargin=44, topMargin=42, bottomMargin=42)
    styles = getSampleStyleSheet()
    normal = styles["BodyText"]
    normal.fontSize = 10
    normal.leading = 14
    heading = styles["Heading2"]
    story = []
    for line in safe_text(text).splitlines():
        value = line.strip()
        if not value:
            story.append(Spacer(1, 8))
        elif value.isupper() and len(value) <= 40:
            story.append(Paragraph(value, heading))
        else:
            story.append(Paragraph(escape_pdf_text(value), normal))
    doc.build(story)
    buffer.seek(0)
    return buffer


def escape_pdf_text(value):
    return safe_text(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

@app.route("/api/ats/export/pdf", methods=["POST"])
@student_required
def export_pdf():
    data = get_json()
    text = safe_text(data.get("resume") or data.get("text"))
    if not text:
        return jsonify({"error": "Resume text is required"}), 400
    pdf = build_resume_pdf(text)
    if not pdf:
        return jsonify({"error": "PDF export library is not installed"}), 500
    return send_file(pdf, mimetype="application/pdf", as_attachment=True, download_name="sqr_resume.pdf")


@app.route("/api/ats/export/docx", methods=["POST"])
@student_required
def export_docx():
    if not Document:
        return jsonify({"error": "DOCX export library is not installed"}), 500
    data = get_json()
    text = safe_text(data.get("resume") or data.get("text"))
    if not text:
        return jsonify({"error": "Resume text is required"}), 400
    doc = Document()
    for line in text.splitlines():
        value = line.strip()
        if not value:
            doc.add_paragraph("")
        elif value.isupper() and len(value) < 35:
            doc.add_heading(value, level=2)
        else:
            doc.add_paragraph(value)
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return send_file(buffer, mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document", as_attachment=True, download_name="sqr_resume.docx")


@app.route("/api/admin/stats")
@admin_required
def admin_stats():
    def count(table):
        if not table_exists(table):
            return 0
        row = query_db(f"SELECT COUNT(*) AS total FROM `{table}`", fetchone=True) or {"total": 0}
        return safe_int(row.get("total"), 0)
    return jsonify({
        "users": count("users"),
        "specializations": count("specializations"),
        "courses": count("courses"),
        "quizzes": count("quizzes"),
        "jobs": count("jobs"),
        "certificates": count("certificates"),
        "ats_results": count("ats_results"),
    })



@app.route("/api/admin/users")
@admin_required
def admin_users():
    rows = query_db("SELECT * FROM users ORDER BY id DESC", fetchall=True) or []
    return jsonify({"users": [clean_user(row) for row in rows]})




@app.route("/api/admin/users/<int:user_id>/ban", methods=["PUT", "POST"])
@admin_required
def ban_user(user_id):
    if user_id == request.current_user["id"]:
        return jsonify({"error": "You cannot ban yourself"}), 400
    if column_exists("users", "banned") and column_exists("users", "is_banned"):
        exec_db("UPDATE users SET banned=1, is_banned=1 WHERE id=%s", (user_id,))
    elif column_exists("users", "banned"):
        exec_db("UPDATE users SET banned=1 WHERE id=%s", (user_id,))
    else:
        exec_db("UPDATE users SET is_banned=1 WHERE id=%s", (user_id,))
    return jsonify({"message": "User banned"})




@app.route("/api/admin/users/<int:user_id>/unban", methods=["PUT", "POST"])
@admin_required
def unban_user(user_id):
    if column_exists("users", "banned") and column_exists("users", "is_banned"):
        exec_db("UPDATE users SET banned=0, is_banned=0 WHERE id=%s", (user_id,))
    elif column_exists("users", "banned"):
        exec_db("UPDATE users SET banned=0 WHERE id=%s", (user_id,))
    else:
        exec_db("UPDATE users SET is_banned=0 WHERE id=%s", (user_id,))
    return jsonify({"message": "User unbanned"})




@app.route("/api/admin/users/<int:user_id>/role", methods=["PUT", "POST"])
@admin_required
def change_user_role(user_id):
    data = get_json()
    role = safe_text(data.get("role")).lower()
    if role not in ["student", "admin"]:
        return jsonify({"error": "Role must be student or admin"}), 400
    current_mode = "admin" if role == "admin" else "student"
    exec_db("UPDATE users SET role=%s,current_mode=%s WHERE id=%s", (role, current_mode, user_id))
    if role == "admin":
        try:
            exec_db("INSERT IGNORE INTO admins (user_id,admin_level) VALUES (%s,'manager')", (user_id,))
        except Exception as exc:
            print("ADMIN INSERT SKIPPED:", exc)
    else:
        try:
            exec_db("DELETE FROM admins WHERE user_id=%s", (user_id,))
        except Exception:
            pass
    return jsonify({"message": "User role updated"})



@app.route("/api/mode", methods=["PUT", "POST"])
@login_required
def switch_mode():
    data = get_json()
    mode = safe_text(data.get("mode")).lower()
    if request.current_user.get("role") != "admin":
        return jsonify({"error": "Only admins can switch mode"}), 403
    if mode not in ["student", "admin"]:
        return jsonify({"error": "Mode must be student or admin"}), 400
    exec_db("UPDATE users SET current_mode=%s WHERE id=%s", (mode, request.current_user["id"]))
    user = query_db("SELECT * FROM users WHERE id=%s", (request.current_user["id"],), fetchone=True)
    return jsonify({"message": "Mode updated", "token": generate_token(user), "user": clean_user(user)})



# =====================================================
# SQR LONG DYNAMIC PATCH LAYER
# Non-destructive extension: adds dynamic bootstrap, diagnostics,
# recommendation question bank, and rich profile/admin summary routes.
# =====================================================

SQR_RECOMMENDATION_QUESTION_BANK = [
    {
        "id": "cybersecurity_interest",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "interest",
        "question": "How interested are you in Cybersecurity tasks such as linux, networking, and security?",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 5
    },
    {
        "id": "cybersecurity_skill",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "skill",
        "question": "How confident are you with linux, networking, or security for a Cybersecurity path?",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 5
    },
    {
        "id": "cybersecurity_work_style",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "work_style",
        "question": "Do you prefer work that involves linux, networking, and practical problem solving for Cybersecurity?",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 5
    },
    {
        "id": "cybersecurity_project",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using linux, networking, and security?",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 5
    },
    {
        "id": "cybersecurity_career",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "career",
        "question": "Would you consider a future job connected to Cybersecurity and skills like linux and networking?",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 5
    },
    {
        "id": "digital_forensics_interest",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "interest",
        "question": "How interested are you in Digital Forensics tasks such as forensics, evidence, and malware?",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 5
    },
    {
        "id": "digital_forensics_skill",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "skill",
        "question": "How confident are you with forensics, evidence, or malware for a Digital Forensics path?",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 5
    },
    {
        "id": "digital_forensics_work_style",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "work_style",
        "question": "Do you prefer work that involves forensics, evidence, and practical problem solving for Digital Forensics?",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 5
    },
    {
        "id": "digital_forensics_project",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using forensics, evidence, and malware?",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 5
    },
    {
        "id": "digital_forensics_career",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "career",
        "question": "Would you consider a future job connected to Digital Forensics and skills like forensics and evidence?",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 5
    },
    {
        "id": "software_engineering_interest",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "interest",
        "question": "How interested are you in Software Engineering tasks such as java, python, and testing?",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 5
    },
    {
        "id": "software_engineering_skill",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "skill",
        "question": "How confident are you with java, python, or testing for a Software Engineering path?",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 5
    },
    {
        "id": "software_engineering_work_style",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "work_style",
        "question": "Do you prefer work that involves java, python, and practical problem solving for Software Engineering?",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 5
    },
    {
        "id": "software_engineering_project",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using java, python, and testing?",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 5
    },
    {
        "id": "software_engineering_career",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "career",
        "question": "Would you consider a future job connected to Software Engineering and skills like java and python?",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 5
    },
    {
        "id": "web_development_interest",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "interest",
        "question": "How interested are you in Web Development tasks such as html, css, and javascript?",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 5
    },
    {
        "id": "web_development_skill",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "skill",
        "question": "How confident are you with html, css, or javascript for a Web Development path?",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 5
    },
    {
        "id": "web_development_work_style",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "work_style",
        "question": "Do you prefer work that involves html, css, and practical problem solving for Web Development?",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 5
    },
    {
        "id": "web_development_project",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using html, css, and javascript?",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 5
    },
    {
        "id": "web_development_career",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "career",
        "question": "Would you consider a future job connected to Web Development and skills like html and css?",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 5
    },
    {
        "id": "data_science_interest",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "interest",
        "question": "How interested are you in Data Science tasks such as python, sql, and statistics?",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 5
    },
    {
        "id": "data_science_skill",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "skill",
        "question": "How confident are you with python, sql, or statistics for a Data Science path?",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 5
    },
    {
        "id": "data_science_work_style",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "work_style",
        "question": "Do you prefer work that involves python, sql, and practical problem solving for Data Science?",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 5
    },
    {
        "id": "data_science_project",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using python, sql, and statistics?",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 5
    },
    {
        "id": "data_science_career",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "career",
        "question": "Would you consider a future job connected to Data Science and skills like python and sql?",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 5
    },
    {
        "id": "ai_ml_interest",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "interest",
        "question": "How interested are you in AI and Machine Learning tasks such as python, machine learning, and deep learning?",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 5
    },
    {
        "id": "ai_ml_skill",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "skill",
        "question": "How confident are you with python, machine learning, or deep learning for a AI and Machine Learning path?",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 5
    },
    {
        "id": "ai_ml_work_style",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "work_style",
        "question": "Do you prefer work that involves python, machine learning, and practical problem solving for AI and Machine Learning?",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 5
    },
    {
        "id": "ai_ml_project",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using python, machine learning, and deep learning?",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 5
    },
    {
        "id": "ai_ml_career",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "career",
        "question": "Would you consider a future job connected to AI and Machine Learning and skills like python and machine learning?",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 5
    },
    {
        "id": "cloud_devops_interest",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "interest",
        "question": "How interested are you in Cloud and DevOps tasks such as aws, docker, and linux?",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 5
    },
    {
        "id": "cloud_devops_skill",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "skill",
        "question": "How confident are you with aws, docker, or linux for a Cloud and DevOps path?",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 5
    },
    {
        "id": "cloud_devops_work_style",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "work_style",
        "question": "Do you prefer work that involves aws, docker, and practical problem solving for Cloud and DevOps?",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 5
    },
    {
        "id": "cloud_devops_project",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using aws, docker, and linux?",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 5
    },
    {
        "id": "cloud_devops_career",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "career",
        "question": "Would you consider a future job connected to Cloud and DevOps and skills like aws and docker?",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 5
    },
    {
        "id": "database_interest",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "interest",
        "question": "How interested are you in Database Systems tasks such as sql, mysql, and postgresql?",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 5
    },
    {
        "id": "database_skill",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "skill",
        "question": "How confident are you with sql, mysql, or postgresql for a Database Systems path?",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 5
    },
    {
        "id": "database_work_style",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "work_style",
        "question": "Do you prefer work that involves sql, mysql, and practical problem solving for Database Systems?",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 5
    },
    {
        "id": "database_project",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using sql, mysql, and postgresql?",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 5
    },
    {
        "id": "database_career",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "career",
        "question": "Would you consider a future job connected to Database Systems and skills like sql and mysql?",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 5
    },
    {
        "id": "mobile_interest",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "interest",
        "question": "How interested are you in Mobile App Development tasks such as flutter, swift, and kotlin?",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 5
    },
    {
        "id": "mobile_skill",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "skill",
        "question": "How confident are you with flutter, swift, or kotlin for a Mobile App Development path?",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 5
    },
    {
        "id": "mobile_work_style",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "work_style",
        "question": "Do you prefer work that involves flutter, swift, and practical problem solving for Mobile App Development?",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 5
    },
    {
        "id": "mobile_project",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using flutter, swift, and kotlin?",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 5
    },
    {
        "id": "mobile_career",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "career",
        "question": "Would you consider a future job connected to Mobile App Development and skills like flutter and swift?",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 5
    },
    {
        "id": "networks_interest",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "interest",
        "question": "How interested are you in Computer Networks tasks such as routing, tcp/ip, and switching?",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 5
    },
    {
        "id": "networks_skill",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "skill",
        "question": "How confident are you with routing, tcp/ip, or switching for a Computer Networks path?",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 5
    },
    {
        "id": "networks_work_style",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "work_style",
        "question": "Do you prefer work that involves routing, tcp/ip, and practical problem solving for Computer Networks?",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 5
    },
    {
        "id": "networks_project",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using routing, tcp/ip, and switching?",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 5
    },
    {
        "id": "networks_career",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "career",
        "question": "Would you consider a future job connected to Computer Networks and skills like routing and tcp/ip?",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 5
    },
    {
        "id": "uiux_interest",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "interest",
        "question": "How interested are you in UI/UX Engineering tasks such as design, accessibility, and prototyping?",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 5
    },
    {
        "id": "uiux_skill",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "skill",
        "question": "How confident are you with design, accessibility, or prototyping for a UI/UX Engineering path?",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 5
    },
    {
        "id": "uiux_work_style",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "work_style",
        "question": "Do you prefer work that involves design, accessibility, and practical problem solving for UI/UX Engineering?",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 5
    },
    {
        "id": "uiux_project",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using design, accessibility, and prototyping?",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 5
    },
    {
        "id": "uiux_career",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "career",
        "question": "Would you consider a future job connected to UI/UX Engineering and skills like design and accessibility?",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 5
    },
    {
        "id": "game_interest",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "interest",
        "question": "How interested are you in Game Development tasks such as c++, unity, and graphics?",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 5
    },
    {
        "id": "game_skill",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "skill",
        "question": "How confident are you with c++, unity, or graphics for a Game Development path?",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 5
    },
    {
        "id": "game_work_style",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "work_style",
        "question": "Do you prefer work that involves c++, unity, and practical problem solving for Game Development?",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 5
    },
    {
        "id": "game_project",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "project",
        "question": "Would you enjoy building portfolio projects using c++, unity, and graphics?",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 5
    },
    {
        "id": "game_career",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "career",
        "question": "Would you consider a future job connected to Game Development and skills like c++ and unity?",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 5
    },
    {
        "id": "cybersecurity_scenario_1",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "scenario",
        "question": "For Cybersecurity, choose how much you like a beginner scenario that uses networking and security.",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 4
    },
    {
        "id": "cybersecurity_scenario_2",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "scenario",
        "question": "For Cybersecurity, choose how much you like a intermediate scenario that uses security and incident response.",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 4
    },
    {
        "id": "cybersecurity_scenario_3",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "scenario",
        "question": "For Cybersecurity, choose how much you like a advanced scenario that uses incident response and linux.",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 4
    },
    {
        "id": "cybersecurity_scenario_4",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "scenario",
        "question": "For Cybersecurity, choose how much you like a project scenario that uses linux and networking.",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 4
    },
    {
        "id": "cybersecurity_scenario_5",
        "specialization_key": "cybersecurity",
        "specialization": "Cybersecurity",
        "dimension": "scenario",
        "question": "For Cybersecurity, choose how much you like a career scenario that uses networking and security.",
        "keywords": [
            "linux",
            "networking",
            "security",
            "incident response"
        ],
        "weight": 4
    },
    {
        "id": "digital_forensics_scenario_1",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "scenario",
        "question": "For Digital Forensics, choose how much you like a beginner scenario that uses evidence and malware.",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 4
    },
    {
        "id": "digital_forensics_scenario_2",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "scenario",
        "question": "For Digital Forensics, choose how much you like a intermediate scenario that uses malware and investigation.",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 4
    },
    {
        "id": "digital_forensics_scenario_3",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "scenario",
        "question": "For Digital Forensics, choose how much you like a advanced scenario that uses investigation and forensics.",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 4
    },
    {
        "id": "digital_forensics_scenario_4",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "scenario",
        "question": "For Digital Forensics, choose how much you like a project scenario that uses forensics and evidence.",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 4
    },
    {
        "id": "digital_forensics_scenario_5",
        "specialization_key": "digital_forensics",
        "specialization": "Digital Forensics",
        "dimension": "scenario",
        "question": "For Digital Forensics, choose how much you like a career scenario that uses evidence and malware.",
        "keywords": [
            "forensics",
            "evidence",
            "malware",
            "investigation"
        ],
        "weight": 4
    },
    {
        "id": "software_engineering_scenario_1",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "scenario",
        "question": "For Software Engineering, choose how much you like a beginner scenario that uses python and testing.",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 4
    },
    {
        "id": "software_engineering_scenario_2",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "scenario",
        "question": "For Software Engineering, choose how much you like a intermediate scenario that uses testing and architecture.",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 4
    },
    {
        "id": "software_engineering_scenario_3",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "scenario",
        "question": "For Software Engineering, choose how much you like a advanced scenario that uses architecture and java.",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 4
    },
    {
        "id": "software_engineering_scenario_4",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "scenario",
        "question": "For Software Engineering, choose how much you like a project scenario that uses java and python.",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 4
    },
    {
        "id": "software_engineering_scenario_5",
        "specialization_key": "software_engineering",
        "specialization": "Software Engineering",
        "dimension": "scenario",
        "question": "For Software Engineering, choose how much you like a career scenario that uses python and testing.",
        "keywords": [
            "java",
            "python",
            "testing",
            "architecture"
        ],
        "weight": 4
    },
    {
        "id": "web_development_scenario_1",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "scenario",
        "question": "For Web Development, choose how much you like a beginner scenario that uses css and javascript.",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 4
    },
    {
        "id": "web_development_scenario_2",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "scenario",
        "question": "For Web Development, choose how much you like a intermediate scenario that uses javascript and react.",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 4
    },
    {
        "id": "web_development_scenario_3",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "scenario",
        "question": "For Web Development, choose how much you like a advanced scenario that uses react and html.",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 4
    },
    {
        "id": "web_development_scenario_4",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "scenario",
        "question": "For Web Development, choose how much you like a project scenario that uses html and css.",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 4
    },
    {
        "id": "web_development_scenario_5",
        "specialization_key": "web_development",
        "specialization": "Web Development",
        "dimension": "scenario",
        "question": "For Web Development, choose how much you like a career scenario that uses css and javascript.",
        "keywords": [
            "html",
            "css",
            "javascript",
            "react"
        ],
        "weight": 4
    },
    {
        "id": "data_science_scenario_1",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "scenario",
        "question": "For Data Science, choose how much you like a beginner scenario that uses sql and statistics.",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 4
    },
    {
        "id": "data_science_scenario_2",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "scenario",
        "question": "For Data Science, choose how much you like a intermediate scenario that uses statistics and machine learning.",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 4
    },
    {
        "id": "data_science_scenario_3",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "scenario",
        "question": "For Data Science, choose how much you like a advanced scenario that uses machine learning and python.",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 4
    },
    {
        "id": "data_science_scenario_4",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "scenario",
        "question": "For Data Science, choose how much you like a project scenario that uses python and sql.",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 4
    },
    {
        "id": "data_science_scenario_5",
        "specialization_key": "data_science",
        "specialization": "Data Science",
        "dimension": "scenario",
        "question": "For Data Science, choose how much you like a career scenario that uses sql and statistics.",
        "keywords": [
            "python",
            "sql",
            "statistics",
            "machine learning"
        ],
        "weight": 4
    },
    {
        "id": "ai_ml_scenario_1",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "scenario",
        "question": "For AI and Machine Learning, choose how much you like a beginner scenario that uses machine learning and deep learning.",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 4
    },
    {
        "id": "ai_ml_scenario_2",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "scenario",
        "question": "For AI and Machine Learning, choose how much you like a intermediate scenario that uses deep learning and models.",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 4
    },
    {
        "id": "ai_ml_scenario_3",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "scenario",
        "question": "For AI and Machine Learning, choose how much you like a advanced scenario that uses models and python.",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 4
    },
    {
        "id": "ai_ml_scenario_4",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "scenario",
        "question": "For AI and Machine Learning, choose how much you like a project scenario that uses python and machine learning.",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 4
    },
    {
        "id": "ai_ml_scenario_5",
        "specialization_key": "ai_ml",
        "specialization": "AI and Machine Learning",
        "dimension": "scenario",
        "question": "For AI and Machine Learning, choose how much you like a career scenario that uses machine learning and deep learning.",
        "keywords": [
            "python",
            "machine learning",
            "deep learning",
            "models"
        ],
        "weight": 4
    },
    {
        "id": "cloud_devops_scenario_1",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "scenario",
        "question": "For Cloud and DevOps, choose how much you like a beginner scenario that uses docker and linux.",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 4
    },
    {
        "id": "cloud_devops_scenario_2",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "scenario",
        "question": "For Cloud and DevOps, choose how much you like a intermediate scenario that uses linux and ci/cd.",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 4
    },
    {
        "id": "cloud_devops_scenario_3",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "scenario",
        "question": "For Cloud and DevOps, choose how much you like a advanced scenario that uses ci/cd and aws.",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 4
    },
    {
        "id": "cloud_devops_scenario_4",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "scenario",
        "question": "For Cloud and DevOps, choose how much you like a project scenario that uses aws and docker.",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 4
    },
    {
        "id": "cloud_devops_scenario_5",
        "specialization_key": "cloud_devops",
        "specialization": "Cloud and DevOps",
        "dimension": "scenario",
        "question": "For Cloud and DevOps, choose how much you like a career scenario that uses docker and linux.",
        "keywords": [
            "aws",
            "docker",
            "linux",
            "ci/cd"
        ],
        "weight": 4
    },
    {
        "id": "database_scenario_1",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "scenario",
        "question": "For Database Systems, choose how much you like a beginner scenario that uses mysql and postgresql.",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 4
    },
    {
        "id": "database_scenario_2",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "scenario",
        "question": "For Database Systems, choose how much you like a intermediate scenario that uses postgresql and data modeling.",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 4
    },
    {
        "id": "database_scenario_3",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "scenario",
        "question": "For Database Systems, choose how much you like a advanced scenario that uses data modeling and sql.",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 4
    },
    {
        "id": "database_scenario_4",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "scenario",
        "question": "For Database Systems, choose how much you like a project scenario that uses sql and mysql.",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 4
    },
    {
        "id": "database_scenario_5",
        "specialization_key": "database",
        "specialization": "Database Systems",
        "dimension": "scenario",
        "question": "For Database Systems, choose how much you like a career scenario that uses mysql and postgresql.",
        "keywords": [
            "sql",
            "mysql",
            "postgresql",
            "data modeling"
        ],
        "weight": 4
    },
    {
        "id": "mobile_scenario_1",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "scenario",
        "question": "For Mobile App Development, choose how much you like a beginner scenario that uses swift and kotlin.",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 4
    },
    {
        "id": "mobile_scenario_2",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "scenario",
        "question": "For Mobile App Development, choose how much you like a intermediate scenario that uses kotlin and ui.",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 4
    },
    {
        "id": "mobile_scenario_3",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "scenario",
        "question": "For Mobile App Development, choose how much you like a advanced scenario that uses ui and flutter.",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 4
    },
    {
        "id": "mobile_scenario_4",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "scenario",
        "question": "For Mobile App Development, choose how much you like a project scenario that uses flutter and swift.",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 4
    },
    {
        "id": "mobile_scenario_5",
        "specialization_key": "mobile",
        "specialization": "Mobile App Development",
        "dimension": "scenario",
        "question": "For Mobile App Development, choose how much you like a career scenario that uses swift and kotlin.",
        "keywords": [
            "flutter",
            "swift",
            "kotlin",
            "ui"
        ],
        "weight": 4
    },
    {
        "id": "networks_scenario_1",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "scenario",
        "question": "For Computer Networks, choose how much you like a beginner scenario that uses tcp/ip and switching.",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 4
    },
    {
        "id": "networks_scenario_2",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "scenario",
        "question": "For Computer Networks, choose how much you like a intermediate scenario that uses switching and security.",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 4
    },
    {
        "id": "networks_scenario_3",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "scenario",
        "question": "For Computer Networks, choose how much you like a advanced scenario that uses security and routing.",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 4
    },
    {
        "id": "networks_scenario_4",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "scenario",
        "question": "For Computer Networks, choose how much you like a project scenario that uses routing and tcp/ip.",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 4
    },
    {
        "id": "networks_scenario_5",
        "specialization_key": "networks",
        "specialization": "Computer Networks",
        "dimension": "scenario",
        "question": "For Computer Networks, choose how much you like a career scenario that uses tcp/ip and switching.",
        "keywords": [
            "routing",
            "tcp/ip",
            "switching",
            "security"
        ],
        "weight": 4
    },
    {
        "id": "uiux_scenario_1",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "scenario",
        "question": "For UI/UX Engineering, choose how much you like a beginner scenario that uses accessibility and prototyping.",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 4
    },
    {
        "id": "uiux_scenario_2",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "scenario",
        "question": "For UI/UX Engineering, choose how much you like a intermediate scenario that uses prototyping and frontend.",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 4
    },
    {
        "id": "uiux_scenario_3",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "scenario",
        "question": "For UI/UX Engineering, choose how much you like a advanced scenario that uses frontend and design.",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 4
    },
    {
        "id": "uiux_scenario_4",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "scenario",
        "question": "For UI/UX Engineering, choose how much you like a project scenario that uses design and accessibility.",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 4
    },
    {
        "id": "uiux_scenario_5",
        "specialization_key": "uiux",
        "specialization": "UI/UX Engineering",
        "dimension": "scenario",
        "question": "For UI/UX Engineering, choose how much you like a career scenario that uses accessibility and prototyping.",
        "keywords": [
            "design",
            "accessibility",
            "prototyping",
            "frontend"
        ],
        "weight": 4
    },
    {
        "id": "game_scenario_1",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "scenario",
        "question": "For Game Development, choose how much you like a beginner scenario that uses unity and graphics.",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 4
    },
    {
        "id": "game_scenario_2",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "scenario",
        "question": "For Game Development, choose how much you like a intermediate scenario that uses graphics and logic.",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 4
    },
    {
        "id": "game_scenario_3",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "scenario",
        "question": "For Game Development, choose how much you like a advanced scenario that uses logic and c++.",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 4
    },
    {
        "id": "game_scenario_4",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "scenario",
        "question": "For Game Development, choose how much you like a project scenario that uses c++ and unity.",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 4
    },
    {
        "id": "game_scenario_5",
        "specialization_key": "game",
        "specialization": "Game Development",
        "dimension": "scenario",
        "question": "For Game Development, choose how much you like a career scenario that uses unity and graphics.",
        "keywords": [
            "c++",
            "unity",
            "graphics",
            "logic"
        ],
        "weight": 4
    }
]

SQR_PAGE_BLUEPRINTS = {
    "home": [
        "homeSpecializations",
        "homeCourses",
        "homeJobs"
    ],
    "profile": [
        "profileSummary",
        "profileProgressBars",
        "profileQuizHistory",
        "profileAtsHistory"
    ],
    "specializations": [
        "specializationDetails",
        "specializationsBox"
    ],
    "courses": [
        "courseDetails",
        "coursesBox"
    ],
    "quiz": [
        "quizDetails",
        "quizResult",
        "quizzesBox"
    ],
    "ats": [
        "atsCheckForm",
        "atsGenerateForm",
        "atsResult",
        "generatedResume"
    ],
    "jobs": [
        "jobsBox",
        "jobDetails"
    ],
    "recommendation": [
        "recommendationForm",
        "recommendationResult",
        "recommendationQuestionBank"
    ],
    "admin": [
        "adminStatsBox",
        "adminSpecializationsList",
        "adminCoursesList",
        "adminJobsList",
        "adminQuizzesList",
        "adminCertificatesList",
        "adminUsersList"
    ]
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
    "red": "#ef4444"
}


def sqr_patch_safe_count(table_name):
    try:
        if not table_exists(table_name):
            return 0
        row = query_db(f"SELECT COUNT(*) AS total FROM `{table_name}`", fetchone=True)
        return int(row.get("total") or 0) if row else 0
    except Exception:
        return 0


def sqr_patch_table_columns(table_name):
    try:
        if not DB_CONFIG.get("database"):
            return []
        rows = query_db(
            """
            SELECT COLUMN_NAME AS name
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s
            ORDER BY ORDINAL_POSITION
            """,
            (DB_CONFIG.get("database"), table_name),
            fetchall=True
        ) or []
        return [r.get("name") for r in rows if r.get("name")]
    except Exception:
        return []


def sqr_patch_select_rows(table_name, limit=8, order_col="created_at"):
    try:
        if not table_exists(table_name):
            return []
        columns = sqr_patch_table_columns(table_name)
        order_sql = f" ORDER BY `{order_col}` DESC" if order_col in columns else ""
        safe_limit = max(1, min(int(limit or 8), 50))
        return query_db(f"SELECT * FROM `{table_name}`{order_sql} LIMIT {safe_limit}", fetchall=True) or []
    except Exception:
        return []


def sqr_patch_normalize_rows(table_name, rows):
    normalized = []
    for row in rows or []:
        try:
            if table_name == "specializations":
                normalized.append(normalize_specialization(row))
            elif table_name == "courses":
                normalized.append(normalize_course(row))
            elif table_name == "jobs":
                normalized.append(normalize_job(row))
            elif table_name == "quizzes":
                normalized.append(normalize_quiz(row))
            else:
                normalized.append(dict(row))
        except Exception:
            normalized.append(dict(row))
    return normalized


def sqr_patch_public_stats():
    return {
        "users": sqr_patch_safe_count("users"),
        "specializations": sqr_patch_safe_count("specializations"),
        "courses": sqr_patch_safe_count("courses"),
        "quizzes": sqr_patch_safe_count("quizzes"),
        "jobs": sqr_patch_safe_count("jobs"),
        "certificates": sqr_patch_safe_count("certificates"),
        "ats_results": sqr_patch_safe_count("ats_results"),
        "quiz_attempts": sqr_patch_safe_count("quiz_attempts")
    }


def sqr_patch_keyword_list(text):
    source = safe_text(text).lower()
    found = []
    for skill in TECH_SKILLS:
        if skill.lower() in source and skill not in found:
            found.append(skill)
    return found


def sqr_patch_score_text_against_keywords(text, keywords):
    body = safe_text(text).lower()
    keys = [safe_text(k).lower() for k in (keywords or []) if safe_text(k)]
    if not keys:
        return 0, []
    matched = [k for k in keys if k in body]
    score = round((len(matched) / max(len(keys), 1)) * 100)
    return min(100, score), matched


def sqr_patch_recommend_from_text(text, limit=5):
    profile_text = safe_text(text)
    specs = sqr_patch_normalize_rows("specializations", sqr_patch_select_rows("specializations", 50))
    jobs = sqr_patch_normalize_rows("jobs", sqr_patch_select_rows("jobs", 50))
    spec_matches = []
    for spec in specs:
        keywords = sqr_patch_keyword_list(" ".join([safe_text(spec.get("name")), safe_text(spec.get("description")), safe_text(spec.get("skills"))]))
        score, matched = sqr_patch_score_text_against_keywords(profile_text, keywords)
        if score or safe_text(spec.get("name")).lower() in profile_text.lower():
            spec_matches.append({
                "id": spec.get("id"),
                "name": spec.get("name"),
                "match_percentage": max(score, 20 if safe_text(spec.get("name")).lower() in profile_text.lower() else 0),
                "matched_skills": matched,
                "reason": "Matched profile text with specialization keywords."
            })
    job_matches = []
    for job in jobs:
        keywords = sqr_patch_keyword_list(" ".join([safe_text(job.get("title")), safe_text(job.get("description")), safe_text(job.get("skills")), safe_text(job.get("required_skills"))]))
        score, matched = sqr_patch_score_text_against_keywords(profile_text, keywords)
        if score or safe_text(job.get("title")).lower() in profile_text.lower():
            job_matches.append({
                "id": job.get("id"),
                "title": job.get("title"),
                "match_percentage": max(score, 20 if safe_text(job.get("title")).lower() in profile_text.lower() else 0),
                "matched_skills": matched,
                "reason": "Matched profile text with job skills."
            })
    spec_matches.sort(key=lambda item: item.get("match_percentage", 0), reverse=True)
    job_matches.sort(key=lambda item: item.get("match_percentage", 0), reverse=True)
    return {
        "recommended_specializations": spec_matches[:limit],
        "recommended_jobs": job_matches[:limit],
        "detected_skills": sqr_patch_keyword_list(profile_text),
        "roadmap": [
            "Choose the highest matching specialization.",
            "Open linked courses to start progress tracking.",
            "Complete course quizzes to raise profile progress.",
            "Use ATS tools for the target job.",
            "Apply first to jobs with stronger skill matches."
        ]
    }


def sqr_patch_profile_text(user):
    if not user:
        return ""
    return " ".join([
        safe_text(user.get("name")),
        safe_text(user.get("skills")),
        safe_text(user.get("interests")),
        safe_text(user.get("goal")),
        safe_text(user.get("work_style")) if isinstance(user, dict) else ""
    ])


def sqr_patch_user_activity(user_id):
    data = {"opened_courses": 0, "quiz_attempts": 0, "ats_results": 0}
    try:
        if table_exists("course_enrollments"):
            row = query_db("SELECT COUNT(*) AS total FROM course_enrollments WHERE user_id=%s", (user_id,), fetchone=True)
            data["opened_courses"] = int(row.get("total") or 0) if row else 0
        elif table_exists("progress"):
            row = query_db("SELECT COUNT(*) AS total FROM progress WHERE user_id=%s", (user_id,), fetchone=True)
            data["opened_courses"] = int(row.get("total") or 0) if row else 0
    except Exception:
        pass
    try:
        if table_exists("quiz_attempts"):
            row = query_db("SELECT COUNT(*) AS total FROM quiz_attempts WHERE user_id=%s", (user_id,), fetchone=True)
            data["quiz_attempts"] = int(row.get("total") or 0) if row else 0
    except Exception:
        pass
    try:
        if table_exists("ats_results"):
            row = query_db("SELECT COUNT(*) AS total FROM ats_results WHERE user_id=%s", (user_id,), fetchone=True)
            data["ats_results"] = int(row.get("total") or 0) if row else 0
    except Exception:
        pass
    return data


@app.route("/api/public/bootstrap", methods=["GET"])
def sqr_patch_public_bootstrap():
    return jsonify({
        "message": "SQR dynamic bootstrap loaded",
        "stats": sqr_patch_public_stats(),
        "specializations": sqr_patch_normalize_rows("specializations", sqr_patch_select_rows("specializations", 6)),
        "courses": sqr_patch_normalize_rows("courses", sqr_patch_select_rows("courses", 6)),
        "jobs": sqr_patch_normalize_rows("jobs", sqr_patch_select_rows("jobs", 6)),
        "theme": SQR_COLOR_THEME_TOKENS,
        "pages": SQR_PAGE_BLUEPRINTS
    })


@app.route("/api/home/dashboard", methods=["GET"])
def sqr_patch_home_dashboard():
    return jsonify({
        "stats": sqr_patch_public_stats(),
        "latest_specializations": sqr_patch_normalize_rows("specializations", sqr_patch_select_rows("specializations", 9)),
        "latest_courses": sqr_patch_normalize_rows("courses", sqr_patch_select_rows("courses", 9)),
        "latest_jobs": sqr_patch_normalize_rows("jobs", sqr_patch_select_rows("jobs", 9))
    })


@app.route("/api/recommendation/questions", methods=["GET"])
def sqr_patch_recommendation_questions():
    specialization_key = safe_text(request.args.get("specialization_key")).lower()
    dimension = safe_text(request.args.get("dimension")).lower()
    questions = []
    for question in SQR_RECOMMENDATION_QUESTION_BANK:
        if specialization_key and safe_text(question.get("specialization_key")).lower() != specialization_key:
            continue
        if dimension and safe_text(question.get("dimension")).lower() != dimension:
            continue
        questions.append(question)
    return jsonify({"questions": questions, "count": len(questions)})


@app.route("/api/catalog/search", methods=["GET"])
def sqr_patch_catalog_search():
    term = safe_text(request.args.get("q")).lower()
    limit = max(1, min(int(request.args.get("limit", 12) or 12), 40))
    results = {"specializations": [], "courses": [], "jobs": [], "quizzes": []}
    if not term:
        return jsonify(results)
    for table_name, key in [("specializations", "specializations"), ("courses", "courses"), ("jobs", "jobs"), ("quizzes", "quizzes")]:
        rows = sqr_patch_normalize_rows(table_name, sqr_patch_select_rows(table_name, 50))
        filtered = []
        for row in rows:
            body = " ".join(safe_text(v) for v in row.values()).lower()
            if term in body:
                filtered.append(row)
        results[key] = filtered[:limit]
    return jsonify(results)


@app.route("/api/profile/dashboard/advanced", methods=["GET"])
@login_required
def sqr_patch_profile_dashboard_advanced():
    user = clean_user(request.current_user)
    user_id = user.get("id") or user.get("user_id")
    recommendation = sqr_patch_recommend_from_text(sqr_patch_profile_text(user), 5)
    activity = sqr_patch_user_activity(user_id)
    progress_payload = []
    try:
        if "profile_progress" in globals():
            pass
    except Exception:
        pass
    return jsonify({
        "user": user,
        "activity": activity,
        "recommendation_preview": recommendation,
        "profile_completeness": sqr_patch_profile_completeness(user),
        "stats": sqr_patch_public_stats(),
        "progress_hint": "Use /api/profile/progress for real progress bars shown only on profile.html."
    })


def sqr_patch_profile_completeness(user):
    fields = ["name", "email", "skills", "interests", "goal"]
    if not user:
        return 0
    filled = sum(1 for field in fields if safe_text(user.get(field)))
    return round((filled / len(fields)) * 100)


@app.route("/api/admin/dashboard/advanced", methods=["GET"])
@admin_required
def sqr_patch_admin_dashboard_advanced():
    return jsonify({
        "stats": sqr_patch_public_stats(),
        "tables": {
            name: sqr_patch_table_columns(name)
            for name in ["users", "specializations", "courses", "quizzes", "quiz_questions", "jobs", "certificates", "ats_results", "course_enrollments", "quiz_attempts"]
        },
        "recent": {
            "specializations": sqr_patch_normalize_rows("specializations", sqr_patch_select_rows("specializations", 5)),
            "courses": sqr_patch_normalize_rows("courses", sqr_patch_select_rows("courses", 5)),
            "jobs": sqr_patch_normalize_rows("jobs", sqr_patch_select_rows("jobs", 5)),
            "quizzes": sqr_patch_normalize_rows("quizzes", sqr_patch_select_rows("quizzes", 5))
        }
    })


@app.route("/api/schema/check", methods=["GET"])
def sqr_patch_schema_check():
    tables = ["users", "admins", "specializations", "courses", "quizzes", "quiz_questions", "jobs", "certificates", "course_enrollments", "quiz_attempts", "ats_results", "assessments"]
    return jsonify({
        "database": DB_CONFIG.get("database"),
        "connected": bool(pool),
        "tables": [
            {"name": table, "exists": table_exists(table), "columns": sqr_patch_table_columns(table)}
            for table in tables
        ]
    })


@app.route("/api/static/page-blueprint/<page_name>", methods=["GET"])
def sqr_patch_page_blueprint(page_name):
    key = safe_text(page_name).replace(".html", "").lower()
    return jsonify({"page": key, "dynamic_targets": SQR_PAGE_BLUEPRINTS.get(key, []), "theme": SQR_COLOR_THEME_TOKENS})


@app.route("/api/recommendations/preview", methods=["POST"])
@login_required
def sqr_patch_recommendations_preview():
    data = get_json()
    text = " ".join([
        safe_text(data.get("interests")),
        safe_text(data.get("skills")),
        safe_text(data.get("work_style")),
        safe_text(data.get("goal")),
        sqr_patch_profile_text(request.current_user)
    ])
    return jsonify(sqr_patch_recommend_from_text(text, 8))


# Extra backend view-model helpers used by the colorful templates.
# These routes are intentionally unique so they do not replace existing project features.
@app.route("/api/view-model/home", methods=["GET"])
def sqr_patch_view_model_home():
    payload = sqr_patch_public_stats()
    return jsonify({
        "page": "home",
        "title": "Skill Quest Road",
        "counts": payload,
        "sections": SQR_PAGE_BLUEPRINTS.get("home", []),
        "colors": SQR_COLOR_THEME_TOKENS
    })


@app.route("/api/view-model/profile", methods=["GET"])
@login_required
def sqr_patch_view_model_profile():
    user = clean_user(request.current_user)
    return jsonify({
        "page": "profile",
        "user": user,
        "activity": sqr_patch_user_activity(user.get("id") or user.get("user_id")),
        "completeness": sqr_patch_profile_completeness(user),
        "sections": SQR_PAGE_BLUEPRINTS.get("profile", [])
    })

SQR_DYNAMIC_CONTAINER_REGISTRY = [
    {
        "page": "home",
        "target": "homeSpecializations",
        "priority": 1,
        "purpose": "Dynamic container homeSpecializations on home page"
    },
    {
        "page": "home",
        "target": "homeCourses",
        "priority": 2,
        "purpose": "Dynamic container homeCourses on home page"
    },
    {
        "page": "home",
        "target": "homeJobs",
        "priority": 3,
        "purpose": "Dynamic container homeJobs on home page"
    },
    {
        "page": "profile",
        "target": "profileSummary",
        "priority": 1,
        "purpose": "Dynamic container profileSummary on profile page"
    },
    {
        "page": "profile",
        "target": "profileProgressBars",
        "priority": 2,
        "purpose": "Dynamic container profileProgressBars on profile page"
    },
    {
        "page": "profile",
        "target": "profileQuizHistory",
        "priority": 3,
        "purpose": "Dynamic container profileQuizHistory on profile page"
    },
    {
        "page": "profile",
        "target": "profileAtsHistory",
        "priority": 4,
        "purpose": "Dynamic container profileAtsHistory on profile page"
    },
    {
        "page": "specializations",
        "target": "specializationDetails",
        "priority": 1,
        "purpose": "Dynamic container specializationDetails on specializations page"
    },
    {
        "page": "specializations",
        "target": "specializationsBox",
        "priority": 2,
        "purpose": "Dynamic container specializationsBox on specializations page"
    },
    {
        "page": "courses",
        "target": "courseDetails",
        "priority": 1,
        "purpose": "Dynamic container courseDetails on courses page"
    },
    {
        "page": "courses",
        "target": "coursesBox",
        "priority": 2,
        "purpose": "Dynamic container coursesBox on courses page"
    },
    {
        "page": "quiz",
        "target": "quizDetails",
        "priority": 1,
        "purpose": "Dynamic container quizDetails on quiz page"
    },
    {
        "page": "quiz",
        "target": "quizResult",
        "priority": 2,
        "purpose": "Dynamic container quizResult on quiz page"
    },
    {
        "page": "quiz",
        "target": "quizzesBox",
        "priority": 3,
        "purpose": "Dynamic container quizzesBox on quiz page"
    },
    {
        "page": "ats",
        "target": "atsCheckForm",
        "priority": 1,
        "purpose": "Dynamic container atsCheckForm on ats page"
    },
    {
        "page": "ats",
        "target": "atsGenerateForm",
        "priority": 2,
        "purpose": "Dynamic container atsGenerateForm on ats page"
    },
    {
        "page": "ats",
        "target": "atsResult",
        "priority": 3,
        "purpose": "Dynamic container atsResult on ats page"
    },
    {
        "page": "ats",
        "target": "generatedResume",
        "priority": 4,
        "purpose": "Dynamic container generatedResume on ats page"
    },
    {
        "page": "jobs",
        "target": "jobsBox",
        "priority": 1,
        "purpose": "Dynamic container jobsBox on jobs page"
    },
    {
        "page": "jobs",
        "target": "jobDetails",
        "priority": 2,
        "purpose": "Dynamic container jobDetails on jobs page"
    },
    {
        "page": "recommendation",
        "target": "recommendationForm",
        "priority": 1,
        "purpose": "Dynamic container recommendationForm on recommendation page"
    },
    {
        "page": "recommendation",
        "target": "recommendationResult",
        "priority": 2,
        "purpose": "Dynamic container recommendationResult on recommendation page"
    },
    {
        "page": "recommendation",
        "target": "recommendationQuestionBank",
        "priority": 3,
        "purpose": "Dynamic container recommendationQuestionBank on recommendation page"
    },
    {
        "page": "admin",
        "target": "adminStatsBox",
        "priority": 1,
        "purpose": "Dynamic container adminStatsBox on admin page"
    },
    {
        "page": "admin",
        "target": "adminSpecializationsList",
        "priority": 2,
        "purpose": "Dynamic container adminSpecializationsList on admin page"
    },
    {
        "page": "admin",
        "target": "adminCoursesList",
        "priority": 3,
        "purpose": "Dynamic container adminCoursesList on admin page"
    },
    {
        "page": "admin",
        "target": "adminJobsList",
        "priority": 4,
        "purpose": "Dynamic container adminJobsList on admin page"
    },
    {
        "page": "admin",
        "target": "adminQuizzesList",
        "priority": 5,
        "purpose": "Dynamic container adminQuizzesList on admin page"
    },
    {
        "page": "admin",
        "target": "adminCertificatesList",
        "priority": 6,
        "purpose": "Dynamic container adminCertificatesList on admin page"
    },
    {
        "page": "admin",
        "target": "adminUsersList",
        "priority": 7,
        "purpose": "Dynamic container adminUsersList on admin page"
    }
]


@app.route("/api/static/dynamic-containers", methods=["GET"])
def sqr_patch_dynamic_containers():
    page = safe_text(request.args.get("page")).replace(".html", "").lower()
    rows = [row for row in SQR_DYNAMIC_CONTAINER_REGISTRY if not page or row.get("page") == page]
    return jsonify({"containers": rows, "count": len(rows)})


def sqr_patch_runtime_report():
    return {
        "python_file": "SQR.py",
        "db_host_set": bool(DB_CONFIG.get("host")),
        "db_name_set": bool(DB_CONFIG.get("database")),
        "openai_enabled": bool(client),
        "upload_folder": app.config.get("UPLOAD_FOLDER"),
        "public_stats": sqr_patch_public_stats(),
        "page_targets": SQR_PAGE_BLUEPRINTS
    }


@app.route("/api/runtime/report", methods=["GET"])
def sqr_patch_runtime_report_route():
    return jsonify(sqr_patch_runtime_report())

@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Endpoint not found"}), 404
    return render_template("gp.html"), 404


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
    app.run(host=os.getenv("FLASK_HOST", "0.0.0.0"), port=int(os.getenv("PORT", os.getenv("FLASK_PORT", 5000))), debug=os.getenv("FLASK_DEBUG", "0") == "1")
