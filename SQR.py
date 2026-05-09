import os
import json
import re
import datetime
from io import BytesIO
from functools import wraps
from cryptography.fernet import Fernet

import jwt
import mysql.connector
from mysql.connector import pooling
from flask import Flask, request, jsonify, send_from_directory, send_file, render_template, redirect
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from docx import Document
from docx.shared import Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import base64
import hashlib

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    import PyPDF2
except Exception:
    PyPDF2 = None

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": os.getenv("CORS_ORIGINS", "*").split(",")}})

app.config["SECRET_KEY"] = os.getenv("SQR_SECRET_KEY", "CHANGE_THIS_SECRET_KEY_BEFORE_DEPLOYMENT")
app.config["UPLOAD_FOLDER"] = os.getenv("UPLOAD_FOLDER", "uploads")
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_CONTENT_LENGTH", 50 * 1024 * 1024))
AES_SECRET = os.getenv("AES_SECRET_KEY", "CHANGE_THIS_AES_SECRET_KEY_32_CHARS")
SECRET_KEY = os.getenv("SECRET_KEY", "sqr_secret_key")
def get_aes_key():
    key = hashlib.sha256(AES_SECRET.encode()).digest()
    return base64.urlsafe_b64encode(key)
def encrypt_text(value):
    if not value:
        return ""
    return cipher.encrypt(value.encode()).decode()

def decrypt_text(value):
    if not value:
        return ""
    try:
        return cipher.decrypt(value.encode()).decode()
    except Exception:
        return value
cipher = Fernet(get_aes_key())
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
def strong_password(password):
    if len(password) < 8:
        return False
    if not re.search(r"[A-Z]", password):
        return False
    if not re.search(r"[a-z]", password):
        return False
    if not re.search(r"[0-9]", password):
        return False
    return True
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "").strip(),
    "port": int(os.getenv("DB_PORT", "3306").strip()),
    "user": os.getenv("DB_USER", "").strip(),
    "password": os.getenv("DB_PASSWORD", "").strip(),
    "database": os.getenv("DB_NAME", "").strip(),
    "connection_timeout": 10,
    "autocommit": True,
}

pool = None

try:
    pool = pooling.MySQLConnectionPool(
        pool_name="sqr_pool",
        pool_size=int(os.getenv("DB_POOL_SIZE", 5)),
        **DB_CONFIG
    )
    print("Database connected")
except Exception as e:
    print("Database connection failed:", e)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) if OpenAI and os.getenv("OPENAI_API_KEY") else None
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def get_db():
    global pool

    if pool is None:
        pool = pooling.MySQLConnectionPool(
            pool_name="sqr_pool",
            pool_size=int(os.getenv("DB_POOL_SIZE", 5)),
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
    query_db(sql, params=params, commit=True)


def init_db():
    statements = [
        """
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            email VARCHAR(150) UNIQUE NOT NULL,
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
        CREATE TABLE IF NOT EXISTS certificates (
            id INT AUTO_INCREMENT PRIMARY KEY,
            spec_id INT NOT NULL,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            link VARCHAR(255),
            price VARCHAR(100),
            type ENUM('practical','theoretical','both') DEFAULT 'both',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE CASCADE
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE CASCADE
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS progress (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            spec_id INT NOT NULL,
            progress INT DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_progress (user_id, spec_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE CASCADE
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS ats_results (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            ats_score INT,
            resume_text LONGTEXT,
            job_description LONGTEXT,
            result_json LONGTEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
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


def db_primary(table_name):
    mapping = {
        "users": ["user_id", "id"],
        "specializations": ["specialization_id", "id"],
        "courses": ["course_id", "id"],
        "quizzes": ["quiz_id", "id"],
        "quiz_questions": ["question_id", "id"],
        "jobs": ["job_id", "id"],
        "assessments": ["assessment_id", "id"],
        "recommendations": ["recommendation_id", "id"],
        "ats_results": ["ats_id", "id"],
    }
    for col in mapping.get(table_name, ["id"]):
        try:
            if column_exists(table_name, col):
                return col
        except Exception:
            pass
    return mapping.get(table_name, ["id"])[0]


def user_id_value(user):
    return user.get("user_id") or user.get("id")


def clean_user(user):
    if not user:
        return None
    user = dict(user)
    user.pop("password", None)
    if "user_id" in user and "id" not in user:
        user["id"] = user["user_id"]
    if "current_mode" not in user:
        user["current_mode"] = user.get("role", "student")
    if "is_banned" in user and "banned" not in user:
        user["banned"] = user["is_banned"]
    return user


def generate_token(user):
    uid = user_id_value(user)
    payload = {
        "id": uid,
        "user_id": uid,
        "name": user.get("name"),
        "email": user.get("email"),
        "role": user.get("role", "student"),
        "current_mode": user.get("current_mode", user.get("role", "student")),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=int(os.getenv("JWT_HOURS", 24))),
    }
    return jwt.encode(payload, app.config["SECRET_KEY"], algorithm="HS256")


def get_current_user():
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not token:
        return None
    try:
        data = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
        uid = data.get("user_id") or data.get("id")
        upk = db_primary("users")
        user = query_db(f"SELECT * FROM users WHERE `{upk}`=%s", (uid,), fetchone=True)
        if not user:
            return None
        banned = user.get("is_banned", user.get("banned", 0))
        if banned:
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
            return jsonify({"error": "Admin mode only"}), 403
        request.current_user = user
        return func(*args, **kwargs)
    return wrapper


def allowed_file(filename):
    allowed = {"png", "jpg", "jpeg", "gif", "webp", "mp4", "pdf", "docx", "txt"}
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed


def save_file(field_name):
    file = request.files.get(field_name)
    if not file or not file.filename or not allowed_file(file.filename):
        return ""
    filename = secure_filename(file.filename)
    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S%f")
    filename = f"{stamp}_{filename}"
    file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
    return filename


def upload_url(filename):
    return f"/uploads/{filename}" if filename else ""


def safe_json_loads(text):
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{.*\}", text or "", re.DOTALL)
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
                {"role": "system", "content": "You are an expert CS career, resume, and ATS assistant. Return valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.25,
        )
        return safe_json_loads(response.choices[0].message.content)
    except Exception:
        return fallback


def improve_summary_local(summary, target_job, skills):
    target = target_job or "technology role"
    skill_text = skills or "technical problem solving, communication, and project delivery"
    base = str(summary or "").strip()
    if not base:
        return ""
    return f"Detail-oriented candidate targeting a {target} role with practical strengths in {skill_text}. Experienced in turning academic and project work into clear technical solutions, with a focus on clean implementation, teamwork, and measurable improvement. Prepared to contribute to real-world projects by learning quickly, communicating clearly, and applying ATS-relevant technical skills."


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
    document = Document(file)
    return "\n".join(p.text for p in document.paragraphs if p.text.strip())


def extract_resume_text_from_request():
    if request.content_type and "multipart/form-data" in request.content_type:
        text = request.form.get("resume_text", "")
        file = request.files.get("resume")
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


TECH_SKILLS = [
    "python", "java", "javascript", "typescript", "html", "css", "sql", "mysql", "postgresql", "react", "node", "flask", "django", "api", "rest", "git", "github", "docker", "aws", "azure", "linux", "security", "cybersecurity", "networking", "forensics", "wireshark", "burp suite", "database", "machine learning", "data analysis", "communication", "teamwork", "problem solving", "cloud", "devops", "kubernetes", "mongodb", "php", "c++", "go", "rust", "swift"
]

COURSE_LEVEL_META = {
    "beginner": {"label": "Beginner", "color": "green", "class": "level-beginner", "hex": "#22c55e"},
    "intermediate": {"label": "Intermediate", "color": "yellow", "class": "level-intermediate", "hex": "#eab308"},
    "advanced": {"label": "Advanced", "color": "red", "class": "level-advanced", "hex": "#ef4444"},
}


def normalize_level(level):
    value = str(level or "beginner").strip().lower()
    aliases = {"begginer": "beginner", "intermidiete": "intermediate", "intermediate": "intermediate", "advance": "advanced", "advanced": "advanced"}
    return aliases.get(value, "beginner")


def add_course_level_meta(course):
    level = normalize_level(course.get("level"))
    course["level"] = level
    course["level_badge"] = COURSE_LEVEL_META[level]
    return course


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
    job_lower = str(job_description or "").lower()
    matched = [k for k in TECH_SKILLS if k in resume_lower]
    missing = [k for k in TECH_SKILLS if k not in resume_lower]
    sections = {
        "contact": any(x in resume_lower for x in ["@", "linkedin", "phone"]),
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
        job_score, job_matches = calculate_match_percentage(resume_text, job_description)
        job_score = int(job_score * 0.35)
    action_verbs = ["built", "developed", "designed", "implemented", "improved", "analyzed", "created", "managed", "tested", "deployed"]
    action_score = min(10, sum(2 for verb in action_verbs if verb in resume_lower))
    metric_score = 10 if re.search(r"\b\d+%?|\b\d+\+", resume_lower) else 3
    score = max(10, min(100, keyword_score + section_score + job_score + action_score + metric_score))
    return {
        "ats_score": score,
        "summary": "ATS score generated with local ATS logic. Add OPENAI_API_KEY for deeper AI reasoning.",
        "matched_keywords": sorted(set(matched + job_matches)),
        "missing_keywords": missing[:20],
        "strengths": [
            "The resume includes ATS-readable technical keywords." if matched else "The resume is readable, but it needs more technical keywords.",
            "Core sections are present." if sum(sections.values()) >= 4 else "The resume needs more standard ATS sections."
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
            "formatting": 80
        }
    }


def local_recommendations(interests, skills, goal, resume_text, jobs, specs):
    profile_text = f"{interests} {skills} {goal} {resume_text}"
    detected = sorted(skill for skill in TECH_SKILLS if skill in profile_text.lower())
    recommended_jobs = []
    for job in jobs:
        job_text = f"{job.get('title','')} {job.get('skills','')} {job.get('specialization','')} {job.get('description','')}"
        score, matches = calculate_match_percentage(profile_text, job_text)
        if score > 0:
            recommended_jobs.append({
                "id": job["id"],
                "title": job["title"],
                "match_percentage": score,
                "score": score,
                "matched_skills": matches,
                "reason": "Matched skills: " + (", ".join(matches[:8]) if matches else "general profile similarity"),
                "linkedin_style_label": "Strong match" if score >= 75 else "Good match" if score >= 55 else "Partial match"
            })
    recommended_specs = []
    for spec in specs:
        spec_text = f"{spec.get('name','')} {spec.get('description','')} {spec.get('skills','')}"
        score, matches = calculate_match_percentage(profile_text, spec_text)
        if score > 0:
            recommended_specs.append({
                "id": spec["id"],
                "name": spec["name"],
                "match_percentage": score,
                "score": score,
                "matched_skills": matches,
                "reason": "Matched skills: " + (", ".join(matches[:8]) if matches else "general profile similarity")
            })
    recommended_jobs.sort(key=lambda x: x["match_percentage"], reverse=True)
    recommended_specs.sort(key=lambda x: x["match_percentage"], reverse=True)
    return {
        "recommended_specializations": recommended_specs[:5],
        "recommended_jobs": recommended_jobs[:8],
        "detected_skills": detected,
        "reason": "Recommendations use profile, goal, resume text, job skills, and specialization skills to calculate match percentages.",
        "roadmap": [
            "Choose the highest match specialization.",
            "Complete beginner courses first, then intermediate, then advanced.",
            "Build portfolio projects that use the missing job skills.",
            "Update the ATS resume summary and skills section for the target job.",
            "Apply first to jobs above 70%, then improve missing skills for lower matches."
        ]
    }


def get_json():
    return request.get_json(silent=True) or {}



def column_exists(table_name, column_name):
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


def table_exists(table_name):
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


def add_column_if_missing(table_name, column_name, column_sql):
    if not column_exists(table_name, column_name):
        exec_db(f"ALTER TABLE {table_name} ADD COLUMN {column_sql}")


def first_existing_column(table_name, names):
    for name in names:
        if column_exists(table_name, name):
            return name
    return names[0]


def spec_pk_col():
    return first_existing_column("specializations", ["specialization_id", "id"])


def spec_image_col():
    return first_existing_column("specializations", ["image_url", "image"])


def course_pk_col():
    return first_existing_column("courses", ["course_id", "id"])


def course_spec_col():
    return first_existing_column("courses", ["specialization_id", "spec_id"])


def course_link_col():
    return first_existing_column("courses", ["course_link", "link"])


def course_image_col():
    return first_existing_column("courses", ["image_url", "image"])


def course_video_col():
    return first_existing_column("courses", ["video_url", "video"])


def quiz_pk_col():
    return first_existing_column("quizzes", ["quiz_id", "id"])


def question_pk_col():
    return first_existing_column("quiz_questions", ["question_id", "id"])


def question_text_col():
    return first_existing_column("quiz_questions", ["question_text", "question"])


def question_option_col(letter):
    mapping = {
        "a": ["option_a", "option1"],
        "b": ["option_b", "option2"],
        "c": ["option_c", "option3"],
        "d": ["option_d", "option4"]
    }
    return first_existing_column("quiz_questions", mapping[letter])


def question_answer_col():
    return first_existing_column("quiz_questions", ["correct_answer", "answer"])


def row_value(row, *names):
    for name in names:
        if isinstance(row, dict) and name in row:
            return row.get(name)
    return None


def normalize_specialization(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "specialization_id")
    row["specialization_id"] = row_value(row, "specialization_id", "id")
    row["image"] = row_value(row, "image", "image_url")
    row["image_url"] = row_value(row, "image_url", "image")
    return row


def normalize_course(row):
    if not row:
        return row
    row = dict(row)
    row["id"] = row_value(row, "id", "course_id")
    row["course_id"] = row_value(row, "course_id", "id")
    row["spec_id"] = row_value(row, "spec_id", "specialization_id")
    row["specialization_id"] = row_value(row, "specialization_id", "spec_id")
    row["link"] = row_value(row, "link", "course_link")
    row["course_link"] = row_value(row, "course_link", "link")
    row["image"] = row_value(row, "image", "image_url")
    row["image_url"] = row_value(row, "image_url", "image")
    row["video"] = row_value(row, "video", "video_url")
    row["video_url"] = row_value(row, "video_url", "video")
    return row


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
    row["question"] = row_value(row, "question", "question_text")
    row["question_text"] = row_value(row, "question_text", "question")
    row["option1"] = row_value(row, "option1", "option_a")
    row["option2"] = row_value(row, "option2", "option_b")
    row["option3"] = row_value(row, "option3", "option_c")
    row["option4"] = row_value(row, "option4", "option_d")
    row["option_a"] = row_value(row, "option_a", "option1")
    row["option_b"] = row_value(row, "option_b", "option2")
    row["option_c"] = row_value(row, "option_c", "option3")
    row["option_d"] = row_value(row, "option_d", "option4")
    row["answer"] = row_value(row, "answer", "correct_answer")
    row["correct_answer"] = row_value(row, "correct_answer", "answer")
    return row


def insert_dynamic(table_name, values):
    columns = []
    params = []
    for key, value in values.items():
        if value is not None and column_exists(table_name, key):
            columns.append(key)
            params.append(value)
    if not columns:
        raise ValueError("No matching columns for insert")
    placeholders = ",".join(["%s"] * len(columns))
    column_sql = ",".join(f"`{c}`" for c in columns)
    return query_db(f"INSERT INTO `{table_name}` ({column_sql}) VALUES ({placeholders})", tuple(params), commit=True)


def ensure_runtime_schema():
    try:
        if table_exists("users"):
            add_column_if_missing("users", "current_mode", "current_mode ENUM('student','admin') DEFAULT 'student'")
            add_column_if_missing("users", "banned", "banned TINYINT DEFAULT 0")
            add_column_if_missing("users", "skills", "skills TEXT")
            add_column_if_missing("users", "interests", "interests TEXT")
            add_column_if_missing("users", "goal", "goal TEXT")
        if table_exists("specializations"):
            add_column_if_missing("specializations", "roadmap", "roadmap TEXT")
            add_column_if_missing("specializations", "job_titles", "job_titles TEXT")
            add_column_if_missing("specializations", "career_paths", "career_paths TEXT")
            add_column_if_missing("specializations", "skills", "skills TEXT")
            add_column_if_missing("specializations", "image", "image VARCHAR(255)")
        if table_exists("courses"):
            add_column_if_missing("courses", "completed_weight", "completed_weight INT DEFAULT 50")
        if table_exists("quizzes"):
            add_column_if_missing("quizzes", "course_id", "course_id INT NULL")
            add_column_if_missing("quizzes", "spec_id", "spec_id INT NULL")
        exec_db("""
        CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            admin_level ENUM('owner','manager') DEFAULT 'manager',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """)
        exec_db("""
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
        """)
        exec_db("""
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
        """)
        exec_db("""
        CREATE TABLE IF NOT EXISTS quiz_attempts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            quiz_id INT NOT NULL,
            course_id INT NULL,
            score INT DEFAULT 0,
            passed TINYINT DEFAULT 0,
            answers_json LONGTEXT,
            attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
        )
        """)
        exec_db("""
        CREATE TABLE IF NOT EXISTS assessments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            interests TEXT,
            skills TEXT,
            goal TEXT,
            total_score INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """)
        exec_db("""
        CREATE TABLE IF NOT EXISTS assessment_answers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            assessment_id INT NOT NULL,
            question TEXT NOT NULL,
            selected_answer TEXT,
            score INT DEFAULT 0,
            FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
        )
        """)
        exec_db("""
        CREATE TABLE IF NOT EXISTS specialization_recommendations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            assessment_id INT NULL,
            spec_id INT NOT NULL,
            match_percentage INT DEFAULT 0,
            matched_skills TEXT,
            missing_skills TEXT,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (spec_id) REFERENCES specializations(id) ON DELETE CASCADE,
            FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL
        )
        """)
        exec_db("""
        CREATE TABLE IF NOT EXISTS job_recommendations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            job_id INT NOT NULL,
            match_percentage INT DEFAULT 0,
            matched_skills TEXT,
            missing_skills TEXT,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )
        """)
    except Exception as e:
        print("Runtime schema update skipped:", e)


def recalculate_course_progress(user_id, course_id):
    course = query_db("SELECT * FROM courses WHERE id=%s", (course_id,), fetchone=True)
    if not course:
        return 0
    quizzes = query_db("SELECT id FROM quizzes WHERE course_id=%s", (course_id,), fetchall=True)
    quiz_ids = [q["id"] for q in quizzes]
    completed_row = query_db("SELECT status FROM course_enrollments WHERE user_id=%s AND course_id=%s", (user_id, course_id), fetchone=True)
    base = 50 if completed_row and completed_row.get("status") == "completed" else 0
    quiz_score = 0
    if quiz_ids:
        passed = 0
        for quiz_id in quiz_ids:
            row = query_db("SELECT MAX(passed) AS passed FROM quiz_attempts WHERE user_id=%s AND quiz_id=%s", (user_id, quiz_id), fetchone=True)
            if row and row.get("passed"):
                passed += 1
        quiz_score = round((passed / len(quiz_ids)) * 50)
    else:
        quiz_score = 50 if base == 50 else 0
    progress = min(100, int(base + quiz_score))
    status = "completed" if progress >= 100 else "in_progress" if progress > 0 else "not_started"
    exec_db("""
        INSERT INTO course_enrollments (user_id, course_id, progress, status, completed_at)
        VALUES (%s,%s,%s,%s,IF(%s='completed',NOW(),NULL))
        ON DUPLICATE KEY UPDATE progress=%s,status=%s,completed_at=IF(%s='completed',NOW(),completed_at)
    """, (user_id, course_id, progress, status, status, progress, status, status))
    recalculate_specialization_progress(user_id, course.get("spec_id"))
    return progress


def recalculate_specialization_progress(user_id, spec_id):
    if not spec_id:
        return 0
    courses = query_db("""
        SELECT c.id, IFNULL(ce.progress,0) AS progress
        FROM courses c
        JOIN course_enrollments ce ON ce.course_id=c.id AND ce.user_id=%s
        WHERE c.spec_id=%s
    """, (user_id, spec_id), fetchall=True)
    progress = int(round(sum(c["progress"] for c in courses) / len(courses))) if courses else 0
    status = "completed" if progress >= 100 else "in_progress" if progress > 0 else "not_started"
    exec_db("""
        INSERT INTO specialization_enrollments (user_id,spec_id,progress,status,completed_at)
        VALUES (%s,%s,%s,%s,IF(%s='completed',NOW(),NULL))
        ON DUPLICATE KEY UPDATE progress=%s,status=%s,completed_at=IF(%s='completed',NOW(),completed_at)
    """, (user_id, spec_id, progress, status, status, progress, status, status))
    exec_db("""
        INSERT INTO progress (user_id,spec_id,progress)
        VALUES (%s,%s,%s)
        ON DUPLICATE KEY UPDATE progress=%s
    """, (user_id, spec_id, progress, progress))
    return progress


@app.route("/")
def home():
    return render_template("gp.html")


def page_or_json(template_name):
    try:
        return render_template(template_name)
    except Exception:
        return jsonify({"message": "SQR Backend is running", "page": template_name})


@app.route("/home")
def page_home():
    return render_template("gp.html")


@app.route("/specializations")
def page_specializations():
    return page_or_json("Specialization.html")


@app.route("/courses")
def page_courses():
    return page_or_json("Courses.html")


@app.route("/quizzes")
def page_quizzes():
    return page_or_json("Quiz.html")




@app.route("/recommendation")
def page_recommendation():
    return page_or_json("recommendation.html")


@app.route("/jobs")
def page_jobs():
    return page_or_json("jobs.html")

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
        "Quiz": "Quiz.html",
        "ATS": "ATS.html",
        "ats": "ATS.html",
        "profile": "profile.html",
        "admin": "admin.html",
        "signin": "signin.html",
        "signup": "signup.html"
    }
    template = aliases.get(page, f"{page}.html")
    return page_or_json(template)


@app.route("/uploads/<path:filename>")
def uploads(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()

    if not name or not email or not password:
        return jsonify({"error": "Name, email, and password are required"}), 400

    if not strong_password(password):
        return jsonify({"error": "Password must be at least 8 characters and include uppercase, lowercase, and number"}), 400

    upk = db_primary("users")
    existing = query_db("SELECT * FROM users WHERE email=%s", (email,), fetchone=True)
    if existing:
        return jsonify({"error": "Email already exists"}), 409

    hashed_password = generate_password_hash(password, method="pbkdf2:sha256", salt_length=16)
    values = {"name": name, "email": email, "password": hashed_password, "role": "student", "current_mode": "student", "is_banned": 0, "banned": 0}
    user_id = insert_dynamic("users", values)
    user = query_db(f"SELECT * FROM users WHERE `{upk}`=%s", (user_id,), fetchone=True)
    token = generate_token(user)
    return jsonify({"message": "Signup successful", "token": token, "user": clean_user(user)}), 201

@app.route("/api/me")
@login_required
def me():
    return jsonify(clean_user(request.current_user))


@app.route("/api/mode/admin", methods=["POST"])
@login_required
def switch_admin_mode():
    if request.current_user.get("role") != "admin":
        return jsonify({"error": "Only admin accounts can switch to admin mode"}), 403
    exec_db("UPDATE users SET current_mode='admin' WHERE id=%s", (request.current_user["id"],))
    user = query_db("SELECT * FROM users WHERE id=%s", (request.current_user["id"],), fetchone=True)
    return jsonify({"message": "Switched to admin mode", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/mode/student", methods=["POST"])
@login_required
def switch_student_mode():
    if request.current_user.get("role") != "admin":
        return jsonify({"error": "Only admin accounts can switch modes"}), 403
    exec_db("UPDATE users SET current_mode='student' WHERE id=%s", (request.current_user["id"],))
    user = query_db("SELECT * FROM users WHERE id=%s", (request.current_user["id"],), fetchone=True)
    return jsonify({"message": "Switched to student mode", "token": generate_token(user), "user": clean_user(user)})


@app.route("/api/admin/users")
@admin_required
def admin_users():
    return jsonify(query_db("SELECT id,name,email,role,banned,created_at FROM users ORDER BY id DESC", fetchall=True))


@app.route("/api/admin/users/<int:user_id>/make-admin", methods=["PUT"])
@admin_required
def make_admin(user_id):
    exec_db("UPDATE users SET role='admin', current_mode='admin' WHERE id=%s", (user_id,))
    query_db("INSERT IGNORE INTO admins (user_id, admin_level) VALUES (%s,'manager')", (user_id,), commit=True)
    return jsonify({"message": "User is now admin"})


@app.route("/api/admin/users/<int:user_id>/make-student", methods=["PUT"])
@admin_required
def make_student(user_id):
    exec_db("UPDATE users SET role='student', current_mode='student' WHERE id=%s", (user_id,))
    return jsonify({"message": "User is now student"})


@app.route("/api/admin/users/<int:user_id>/ban", methods=["PUT"])
@admin_required
def ban_user(user_id):
    exec_db("UPDATE users SET banned=1 WHERE id=%s", (user_id,))
    return jsonify({"message": "User banned"})


@app.route("/api/admin/users/<int:user_id>/unban", methods=["PUT"])
@admin_required
def unban_user(user_id):
    exec_db("UPDATE users SET banned=0 WHERE id=%s", (user_id,))
    return jsonify({"message": "User unbanned"})


@app.route("/api/specializations", methods=["GET"])
def get_specializations():
    specs = query_db("SELECT * FROM specializations ORDER BY id DESC", fetchall=True)
    for spec in specs:
        spec["image_url"] = upload_url(spec.get("image"))
        spec["certificates"] = query_db("SELECT * FROM certificates WHERE spec_id=%s ORDER BY id DESC", (spec["id"],), fetchall=True)
    return jsonify(specs)


@app.route("/api/specializations/<int:spec_id>")
def get_specialization(spec_id):
    spec = query_db("SELECT * FROM specializations WHERE id=%s", (spec_id,), fetchone=True)
    if not spec:
        return jsonify({"error": "Specialization not found"}), 404
    spec["image_url"] = upload_url(spec.get("image"))
    spec["certificates"] = query_db("SELECT * FROM certificates WHERE spec_id=%s ORDER BY id DESC", (spec_id,), fetchall=True)
    spec["courses"] = query_db("SELECT * FROM courses WHERE spec_id=%s ORDER BY id DESC", (spec_id,), fetchall=True)
    for course in spec["courses"]:
        course["image_url"] = upload_url(course.get("image"))
        course["video_url"] = upload_url(course.get("video"))
        add_course_level_meta(course)
        course["quizzes"] = query_db("SELECT * FROM quizzes WHERE course_id=%s ORDER BY id DESC", (course["id"],), fetchall=True)
    spec["quizzes"] = query_db("SELECT q.* FROM quizzes q JOIN courses c ON q.course_id=c.id WHERE c.spec_id=%s ORDER BY q.id DESC", (spec_id,), fetchall=True)
    return jsonify(spec)


@app.route("/api/specializations", methods=["POST"])
@admin_required
def add_specialization():
    name = request.form.get("name", "").strip()
    description = request.form.get("description", "").strip()
    skills = request.form.get("skills", "").strip()
    roadmap = request.form.get("roadmap", "").strip()
    job_titles = request.form.get("job_titles", "").strip()
    career_paths = request.form.get("career_paths", "").strip()
    image = save_file("image")
    if not name:
        return jsonify({"error": "Specialization name is required"}), 400
    spec_id = query_db("INSERT INTO specializations (name,description,skills,roadmap,job_titles,career_paths,image) VALUES (%s,%s,%s,%s,%s,%s,%s)", (name, description, skills, roadmap, job_titles, career_paths, image), commit=True)
    return jsonify({"message": "Specialization added", "id": spec_id}), 201


@app.route("/api/specializations/<int:spec_id>", methods=["PUT"])
@admin_required
def update_specialization(spec_id):
    old = query_db("SELECT * FROM specializations WHERE id=%s", (spec_id,), fetchone=True)
    if not old:
        return jsonify({"error": "Specialization not found"}), 404
    name = request.form.get("name", old["name"]).strip()
    description = request.form.get("description", old.get("description") or "").strip()
    skills = request.form.get("skills", old.get("skills") or "").strip()
    roadmap = request.form.get("roadmap", old.get("roadmap") or "").strip()
    job_titles = request.form.get("job_titles", old.get("job_titles") or "").strip()
    career_paths = request.form.get("career_paths", old.get("career_paths") or "").strip()
    image = save_file("image") or old.get("image", "")
    exec_db("UPDATE specializations SET name=%s,description=%s,skills=%s,roadmap=%s,job_titles=%s,career_paths=%s,image=%s WHERE id=%s", (name, description, skills, roadmap, job_titles, career_paths, image, spec_id))
    return jsonify({"message": "Specialization updated"})


@app.route("/api/specializations/<int:spec_id>", methods=["DELETE"])
@admin_required
def delete_specialization(spec_id):
    exec_db("DELETE FROM specializations WHERE id=%s", (spec_id,))
    return jsonify({"message": "Specialization deleted"})


@app.route("/api/certificates", methods=["POST"])
@admin_required
def add_certificate():
    data = get_json()
    if not data.get("spec_id") or not data.get("name"):
        return jsonify({"error": "spec_id and name are required"}), 400
    cert_id = query_db("INSERT INTO certificates (spec_id,name,description,link,price,type) VALUES (%s,%s,%s,%s,%s,%s)", (data.get("spec_id"), data.get("name"), data.get("description"), data.get("link"), data.get("price"), data.get("type", "both")), commit=True)
    return jsonify({"message": "Certificate added", "id": cert_id}), 201


@app.route("/api/certificates/<int:cert_id>", methods=["PUT"])
@admin_required
def update_certificate(cert_id):
    data = get_json()
    exec_db("UPDATE certificates SET name=%s,description=%s,link=%s,price=%s,type=%s WHERE id=%s", (data.get("name"), data.get("description"), data.get("link"), data.get("price"), data.get("type", "both"), cert_id))
    return jsonify({"message": "Certificate updated"})


@app.route("/api/certificates/<int:cert_id>", methods=["DELETE"])
@admin_required
def delete_certificate(cert_id):
    exec_db("DELETE FROM certificates WHERE id=%s", (cert_id,))
    return jsonify({"message": "Certificate deleted"})


@app.route("/api/courses", methods=["GET"])
def get_courses():
    spec_id = request.args.get("spec_id")
    level = request.args.get("level")
    search = request.args.get("search", "")
    sort = request.args.get("sort", "newest")
    sql = "SELECT * FROM courses WHERE 1=1"
    params = []
    if spec_id:
        sql += " AND spec_id=%s"
        params.append(spec_id)
    if level:
        sql += " AND level=%s"
        params.append(level)
    if search:
        sql += " AND (title LIKE %s OR description LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%"])
    sql += " ORDER BY title ASC" if sort == "title" else " ORDER BY id ASC" if sort == "oldest" else " ORDER BY id DESC"
    courses = query_db(sql, tuple(params), fetchall=True)
    for course in courses:
        course["image_url"] = upload_url(course.get("image"))
        course["video_url"] = upload_url(course.get("video"))
        add_course_level_meta(course)
    return jsonify(courses)


@app.route("/api/courses", methods=["POST"])
@admin_required
def add_course():
    spec_id = request.form.get("spec_id")
    title = request.form.get("title", "").strip()
    if not spec_id or not title:
        return jsonify({"error": "spec_id and title are required"}), 400
    course_id = query_db("INSERT INTO courses (spec_id,title,description,link,image,video,level) VALUES (%s,%s,%s,%s,%s,%s,%s)", (spec_id, title, request.form.get("description", "").strip(), request.form.get("link", "").strip(), save_file("image"), save_file("video"), normalize_level(request.form.get("level", "beginner"))), commit=True)
    return jsonify({"message": "Course added", "id": course_id}), 201


@app.route("/api/courses/<int:course_id>", methods=["PUT"])
@admin_required
def update_course(course_id):
    old = query_db("SELECT * FROM courses WHERE id=%s", (course_id,), fetchone=True)
    if not old:
        return jsonify({"error": "Course not found"}), 404
    values = (request.form.get("spec_id") or old["spec_id"], request.form.get("title") or old["title"], request.form.get("description") or old.get("description"), request.form.get("link") or old.get("link"), save_file("image") or old.get("image"), save_file("video") or old.get("video"), request.form.get("level") or old.get("level"), course_id)
    exec_db("UPDATE courses SET spec_id=%s,title=%s,description=%s,link=%s,image=%s,video=%s,level=%s WHERE id=%s", values)
    return jsonify({"message": "Course updated"})


@app.route("/api/courses/<int:course_id>", methods=["DELETE"])
@admin_required
def delete_course(course_id):
    exec_db("DELETE FROM courses WHERE id=%s", (course_id,))
    return jsonify({"message": "Course deleted"})


@app.route("/api/quizzes", methods=["GET"])
def get_quizzes():
    spec_id = request.args.get("spec_id") or request.args.get("specialization_id")
    course_id = request.args.get("course_id")
    qpk = quiz_pk_col()
    cpk = course_pk_col()
    cspec = course_spec_col()
    qid = question_pk_col()
    if course_id:
        quizzes = query_db(f"SELECT * FROM quizzes WHERE course_id=%s ORDER BY `{qpk}` DESC", (course_id,), fetchall=True)
    elif spec_id:
        quizzes = query_db(f"SELECT q.* FROM quizzes q JOIN courses c ON q.course_id=c.`{cpk}` WHERE c.`{cspec}`=%s ORDER BY q.`{qpk}` DESC", (spec_id,), fetchall=True)
    else:
        quizzes = query_db(f"SELECT * FROM quizzes ORDER BY `{qpk}` DESC", fetchall=True)
    fixed = []
    for quiz in quizzes:
        quiz = normalize_quiz(quiz)
        questions = query_db(f"SELECT * FROM quiz_questions WHERE quiz_id=%s ORDER BY `{qid}` ASC", (quiz["id"],), fetchall=True)
        quiz["questions"] = [normalize_question(q) for q in questions]
        fixed.append(quiz)
    return jsonify(fixed)


@app.route("/api/admin/quizzes", methods=["POST"])
@admin_required
def add_quiz():
    data = get_json()
    course_id = data.get("course_id")
    title = str(data.get("title", "")).strip()
    description = str(data.get("description", "")).strip()
    questions = data.get("questions", [])
    if not course_id or not title:
        return jsonify({"error": "course_id and title are required"}), 400
    if not isinstance(questions, list) or not questions:
        return jsonify({"error": "At least one question is required"}), 400
    cpk = course_pk_col()
    course = normalize_course(query_db(f"SELECT * FROM courses WHERE `{cpk}`=%s", (course_id,), fetchone=True))
    if not course:
        return jsonify({"error": "Course not found"}), 404
    quiz_values = {
        "course_id": course_id,
        "spec_id": course.get("spec_id"),
        "specialization_id": course.get("specialization_id"),
        "title": title,
        "description": description,
        "total_questions": len(questions)
    }
    quiz_id = insert_dynamic("quizzes", quiz_values)
    qt = question_text_col()
    qa = question_option_col("a")
    qb = question_option_col("b")
    qc = question_option_col("c")
    qd = question_option_col("d")
    ans = question_answer_col()
    for q in questions:
        insert_dynamic("quiz_questions", {
            "quiz_id": quiz_id,
            qt: q.get("question_text") or q.get("question"),
            qa: q.get("option_a") or q.get("option1"),
            qb: q.get("option_b") or q.get("option2"),
            qc: q.get("option_c") or q.get("option3"),
            qd: q.get("option_d") or q.get("option4"),
            ans: q.get("correct_answer") or q.get("answer"),
            "score": q.get("score", 1)
        })
    return jsonify({"message": "Quiz added successfully", "quiz_id": quiz_id, "id": quiz_id}), 201


@app.route("/api/quizzes/<int:quiz_id>", methods=["PUT"])
@admin_required
def update_quiz(quiz_id):
    data = get_json()
    course_id = data.get("course_id")
    spec_id = data.get("spec_id")
    if course_id:
        course = query_db("SELECT * FROM courses WHERE id=%s", (course_id,), fetchone=True)
        if course:
            spec_id = course["spec_id"]
    exec_db("UPDATE quizzes SET spec_id=%s,course_id=%s,title=%s,description=%s WHERE id=%s", (spec_id, course_id, data.get("title"), data.get("description"), quiz_id))
    return jsonify({"message": "Quiz updated"})


@app.route("/api/quizzes/<int:quiz_id>", methods=["DELETE"])
@admin_required
def delete_quiz(quiz_id):
    exec_db("DELETE FROM quizzes WHERE id=%s", (quiz_id,))
    return jsonify({"message": "Quiz deleted"})


@app.route("/api/quiz-questions", methods=["POST"])
@admin_required
def add_question():
    data = get_json()
    question_id = insert_dynamic("quiz_questions", {
        "quiz_id": data.get("quiz_id"),
        question_text_col(): data.get("question_text") or data.get("question"),
        question_option_col("a"): data.get("option_a") or data.get("option1"),
        question_option_col("b"): data.get("option_b") or data.get("option2"),
        question_option_col("c"): data.get("option_c") or data.get("option3"),
        question_option_col("d"): data.get("option_d") or data.get("option4"),
        question_answer_col(): data.get("correct_answer") or data.get("answer"),
        "score": data.get("score", 1)
    })
    quiz_id = data.get("quiz_id")
    if quiz_id and column_exists("quizzes", "total_questions"):
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
    data = get_json()
    answers = data.get("answers", {})
    raw_questions = query_db("SELECT * FROM quiz_questions WHERE quiz_id=%s", (quiz_id,), fetchall=True)
    questions = [normalize_question(q) for q in raw_questions]
    if not questions:
        return jsonify({"error": "Quiz has no questions"}), 404
    correct = 0
    for q in questions:
        qid = str(q.get("id") or q.get("question_id"))
        selected = answers.get(qid)
        if selected is None:
            selected = answers.get(qid.lower(), "")
        if str(selected).strip().lower() == str(q.get("answer") or q.get("correct_answer") or "").strip().lower():
            correct += 1
    score = int((correct / len(questions)) * 100)
    quiz = normalize_quiz(query_db(f"SELECT * FROM quizzes WHERE `{quiz_pk_col()}`=%s", (quiz_id,), fetchone=True))
    passed = 1 if score >= 60 else 0
    course_progress = 0
    specialization_progress = 0
    if quiz:
        query_db("INSERT INTO quiz_attempts (user_id,quiz_id,course_id,score,passed,answers_json) VALUES (%s,%s,%s,%s,%s,%s)", (request.current_user["id"], quiz_id, quiz.get("course_id"), score, passed, json.dumps(answers, ensure_ascii=False)), commit=True)
        if quiz.get("course_id"):
            course = normalize_course(query_db(f"SELECT * FROM courses WHERE `{course_pk_col()}`=%s", (quiz.get("course_id"),), fetchone=True))
            if course:
                query_db("INSERT IGNORE INTO specialization_enrollments (user_id,spec_id,progress,status) VALUES (%s,%s,0,'not_started')", (request.current_user["id"], course["spec_id"]), commit=True)
                query_db("INSERT IGNORE INTO course_enrollments (user_id,course_id,progress,status) VALUES (%s,%s,0,'not_started')", (request.current_user["id"], quiz.get("course_id")), commit=True)
                course_progress = recalculate_course_progress(request.current_user["id"], quiz.get("course_id"))
                specialization_progress = recalculate_specialization_progress(request.current_user["id"], course["spec_id"])
        elif quiz.get("spec_id"):
            exec_db("INSERT INTO progress (user_id,spec_id,progress) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE progress=GREATEST(progress,VALUES(progress))", (request.current_user["id"], quiz["spec_id"], score))
    return jsonify({"score": score, "correct": correct, "total": len(questions), "passed": bool(passed), "course_progress": course_progress, "specialization_progress": specialization_progress})


@app.route("/api/profile", methods=["GET"])
@login_required
def profile():
    user = clean_user(request.current_user)
    spec_progress = query_db("""
        SELECT se.spec_id,s.name,s.description,s.image,se.progress,se.status,se.enrolled_at
        FROM specialization_enrollments se
        JOIN specializations s ON s.id=se.spec_id
        WHERE se.user_id=%s
        ORDER BY se.enrolled_at DESC
    """, (user["id"],), fetchall=True)
    for item in spec_progress:
        item["image_url"] = upload_url(item.get("image"))
    course_progress = query_db("""
        SELECT ce.course_id,c.title,c.spec_id,s.name AS specialization_name,ce.progress,ce.status,ce.enrolled_at
        FROM course_enrollments ce
        JOIN courses c ON c.id=ce.course_id
        JOIN specializations s ON s.id=c.spec_id
        WHERE ce.user_id=%s
        ORDER BY ce.enrolled_at DESC
    """, (user["id"],), fetchall=True)
    return jsonify({"user": user, "progress": spec_progress, "specialization_progress": spec_progress, "course_progress": course_progress})


@app.route("/api/profile", methods=["PUT"])
@login_required
def update_profile():
    data = get_json()
    exec_db("UPDATE users SET name=%s,skills=%s,interests=%s,goal=%s WHERE id=%s", (data.get("name", request.current_user["name"]), data.get("skills", request.current_user.get("skills")), data.get("interests", request.current_user.get("interests")), data.get("goal", request.current_user.get("goal")), request.current_user["id"]))
    return jsonify({"message": "Profile updated"})


@app.route("/api/progress", methods=["POST"])
@login_required
def update_progress():
    data = get_json()
    spec_id = data.get("spec_id")
    progress = max(0, min(int(data.get("progress", 0)), 100))
    if not spec_id:
        return jsonify({"error": "spec_id is required"}), 400
    exec_db("INSERT INTO progress (user_id,spec_id,progress) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE progress=%s", (request.current_user["id"], spec_id, progress, progress))
    exec_db("INSERT INTO specialization_enrollments (user_id,spec_id,progress,status) VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE progress=%s,status=%s", (request.current_user["id"], spec_id, progress, "completed" if progress >= 100 else "in_progress", progress, "completed" if progress >= 100 else "in_progress"))
    return jsonify({"message": "Progress updated"})


@app.route("/api/specializations/<int:spec_id>/enroll", methods=["POST"])
@login_required
def enroll_specialization(spec_id):
    spec = query_db("SELECT id FROM specializations WHERE id=%s", (spec_id,), fetchone=True)
    if not spec:
        return jsonify({"error": "Specialization not found"}), 404
    query_db("INSERT IGNORE INTO specialization_enrollments (user_id,spec_id,progress,status) VALUES (%s,%s,0,'not_started')", (request.current_user["id"], spec_id), commit=True)
    return jsonify({"message": "Enrolled in specialization", "spec_id": spec_id})


@app.route("/api/specializations/enrolled")
@login_required
def enrolled_specializations():
    rows = query_db("""
        SELECT se.*, s.name, s.description, s.image, s.roadmap, s.job_titles, s.career_paths
        FROM specialization_enrollments se
        JOIN specializations s ON s.id=se.spec_id
        WHERE se.user_id=%s
        ORDER BY se.enrolled_at DESC
    """, (request.current_user["id"],), fetchall=True)
    for row in rows:
        row["image_url"] = upload_url(row.get("image"))
    return jsonify(rows)


@app.route("/api/courses/<int:course_id>/enroll", methods=["POST"])
@login_required
def enroll_course(course_id):
    course = query_db("SELECT * FROM courses WHERE id=%s", (course_id,), fetchone=True)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    query_db("INSERT IGNORE INTO specialization_enrollments (user_id,spec_id,progress,status) VALUES (%s,%s,0,'not_started')", (request.current_user["id"], course["spec_id"]), commit=True)
    query_db("INSERT IGNORE INTO course_enrollments (user_id,course_id,progress,status) VALUES (%s,%s,0,'not_started')", (request.current_user["id"], course_id), commit=True)
    recalculate_specialization_progress(request.current_user["id"], course["spec_id"])
    return jsonify({"message": "Enrolled in course", "course_id": course_id})


@app.route("/api/courses/<int:course_id>/complete", methods=["POST"])
@login_required
def complete_course(course_id):
    course = query_db("SELECT * FROM courses WHERE id=%s", (course_id,), fetchone=True)
    if not course:
        return jsonify({"error": "Course not found"}), 404
    query_db("INSERT IGNORE INTO course_enrollments (user_id,course_id,progress,status) VALUES (%s,%s,0,'not_started')", (request.current_user["id"], course_id), commit=True)
    exec_db("UPDATE course_enrollments SET status='completed', completed_at=NOW() WHERE user_id=%s AND course_id=%s", (request.current_user["id"], course_id))
    progress = recalculate_course_progress(request.current_user["id"], course_id)
    return jsonify({"message": "Course marked completed", "course_progress": progress})


@app.route("/api/courses/enrolled")
@login_required
def enrolled_courses():
    rows = query_db("""
        SELECT ce.*, c.title, c.description, c.level, c.image, c.video, c.link, c.spec_id, s.name AS specialization_name
        FROM course_enrollments ce
        JOIN courses c ON c.id=ce.course_id
        JOIN specializations s ON s.id=c.spec_id
        WHERE ce.user_id=%s
        ORDER BY ce.enrolled_at DESC
    """, (request.current_user["id"],), fetchall=True)
    for row in rows:
        row["image_url"] = upload_url(row.get("image"))
        row["video_url"] = upload_url(row.get("video"))
        add_course_level_meta(row)
    return jsonify(rows)


@app.route("/api/jobs", methods=["GET"])
def get_jobs():
    search = request.args.get("search", "")
    specialization = request.args.get("specialization", "")
    profile_text = request.args.get("profile_text", "") or current_profile_text()
    sql = "SELECT * FROM jobs WHERE 1=1"
    params = []
    if search:
        sql += " AND (title LIKE %s OR description LIKE %s OR skills LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    if specialization:
        sql += " AND specialization LIKE %s"
        params.append(f"%{specialization}%")
    jobs = query_db(sql + " ORDER BY id DESC", tuple(params), fetchall=True)
    for job in jobs:
        job_text = f"{job.get('title','')} {job.get('description','')} {job.get('skills','')} {job.get('specialization','')}"
        score, matches = calculate_match_percentage(profile_text, job_text)
        job["match_percentage"] = score
        job["match_label"] = "Strong match" if score >= 75 else "Good match" if score >= 55 else "Partial match" if score > 0 else "Add profile skills"
        job["matched_skills"] = matches
    return jsonify(jobs)


@app.route("/api/jobs", methods=["POST"])
@admin_required
def add_job():
    data = get_json()
    if not data.get("title"):
        return jsonify({"error": "title is required"}), 400
    job_id = query_db("INSERT INTO jobs (title,description,skills,specialization,salary,link) VALUES (%s,%s,%s,%s,%s,%s)", (data.get("title"), data.get("description"), data.get("skills"), data.get("specialization"), data.get("salary"), data.get("link")), commit=True)
    return jsonify({"message": "Job added", "id": job_id}), 201


@app.route("/api/jobs/<int:job_id>", methods=["PUT"])
@admin_required
def update_job(job_id):
    data = get_json()
    exec_db("UPDATE jobs SET title=%s,description=%s,skills=%s,specialization=%s,salary=%s,link=%s WHERE id=%s", (data.get("title"), data.get("description"), data.get("skills"), data.get("specialization"), data.get("salary"), data.get("link"), job_id))
    return jsonify({"message": "Job updated"})


@app.route("/api/jobs/<int:job_id>", methods=["DELETE"])
@admin_required
def delete_job(job_id):
    exec_db("DELETE FROM jobs WHERE id=%s", (job_id,))
    return jsonify({"message": "Job deleted"})


@app.route("/api/ats/check", methods=["POST"])
@login_required
def ats_check():
    resume_text = extract_resume_text_from_request()
    if request.content_type and "multipart/form-data" in request.content_type:
        job_description = request.form.get("job_description", request.form.get("target_job", ""))
    else:
        data = get_json()
        job_description = data.get("job_description", data.get("target_job", ""))

    if not resume_text:
        return jsonify({"error": "Resume text or file is required"}), 400

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
    "contact": 0, "summary": 0, "skills": 0, "experience": 0, "education": 0, "projects": 0, "keywords": 0, "job_match": 0, "formatting": 0
  }}
}}
Scoring rules: keyword relevance 30%, job-description match 30%, resume sections 20%, measurable achievements 10%, formatting/ATS readability 10%.
Resume:\n{resume_text[:9000]}
Job description:\n{job_description[:5000]}
"""
    result = ai_json(prompt, fallback)

    insert_dynamic("ats_results", {
        "user_id": user_id_value(request.current_user),
        "resume_text": resume_text,
        "target_job": job_description,
        "job_description": job_description,
        "ats_score": result.get("ats_score", fallback.get("ats_score", 0)),
        "missing_keywords": json.dumps(result.get("missing_keywords", []), ensure_ascii=False),
        "matched_keywords": json.dumps(result.get("matched_keywords", []), ensure_ascii=False),
        "suggestions": json.dumps(result.get("improvements", []), ensure_ascii=False),
        "result_json": json.dumps(result, ensure_ascii=False)
    })
    return jsonify(result)


TECH_SKILLS = [
    "python", "java", "javascript", "html", "css", "sql", "mysql", "flask",
    "django", "react", "node", "linux", "git", "github", "api", "rest",
    "cybersecurity", "network security", "data analysis", "machine learning",
    "artificial intelligence", "cloud", "aws", "docker", "mongodb", "typescript"
]

def safe_text(value):
    return str(value or "").strip()

def split_lines(text):
    return [line.strip() for line in safe_text(text).splitlines() if line.strip()]

def improve_summary_local(summary, target_job, skills):
    summary = safe_text(summary)
    target_job = safe_text(target_job)
    skills = safe_text(skills)

    role_text = f" as a {target_job}" if target_job else ""
    skill_list = ", ".join(split_lines(skills.replace(",", "\n"))[:6])

    if skill_list:
        return f"Motivated computer science professional{role_text} with hands-on knowledge in {skill_list}. Skilled in building practical solutions, solving technical problems, and applying strong analytical thinking to deliver reliable results."

    return f"Motivated computer science professional{role_text} with strong problem-solving skills, technical understanding, and a focus on building reliable digital solutions."

def ai_enhance_summary(summary, target_job, skills):
    summary = safe_text(summary)
    target_job = safe_text(target_job)
    skills = safe_text(skills)

    if not summary:
        return improve_summary_local(summary, target_job, skills)

    prompt = f"""
Rewrite this resume summary for ATS and recruiter readability.

Return JSON only:
{{
  "summary": "",
  "keywords_added": []
}}

Rules:
- Rewrite it completely.
- Do not return the same text.
- 2 sentences only.
- No fake claims.
- Use natural ATS keywords.
- Match the target job if provided.
- Use skills only when relevant.

Target Job: {target_job}
Skills: {skills}
Original Summary: {summary}
"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an ATS resume writing engine. Return valid JSON only."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.5,
            max_tokens=220
        )

        content = response.choices[0].message.content.strip()
        data = json.loads(content)
        new_summary = safe_text(data.get("summary"))

        if new_summary and new_summary.lower() != summary.lower():
            return new_summary

        return improve_summary_local(summary, target_job, skills)

    except Exception:
        return improve_summary_local(summary, target_job, skills)

def ats_score_engine(data, enhanced_summary):
    score = 0

    if safe_text(data.get("name")):
        score += 8
    if safe_text(data.get("email")):
        score += 8
    if safe_text(data.get("phone")):
        score += 6
    if enhanced_summary:
        score += 18
    if safe_text(data.get("skills")):
        score += 18
    if safe_text(data.get("experience")):
        score += 14
    if safe_text(data.get("education")):
        score += 10
    if safe_text(data.get("projects")):
        score += 8
    if safe_text(data.get("certifications")):
        score += 5
    if safe_text(data.get("target_job")):
        score += 5

    text = " ".join([
        safe_text(data.get("skills")),
        safe_text(data.get("experience")),
        safe_text(data.get("projects")),
        enhanced_summary
    ]).lower()

    matched = [skill for skill in TECH_SKILLS if skill in text]

    if len(matched) >= 8:
        score += 10
    elif len(matched) >= 5:
        score += 7
    elif len(matched) >= 3:
        score += 4

    return min(score, 100), matched[:10]

def section(title, content):
    content = safe_text(content)

    if not content:
        return ""

    lines = split_lines(content)

    if len(lines) > 1:
        body = "\n".join([f"- {line}" for line in lines])
    else:
        body = content

    return f"\n{title.upper()}\n{'-' * len(title)}\n{body}\n"

def build_resume(data, enhanced_summary):
    name = safe_text(data.get("name")) or "Your Name"
    email = safe_text(data.get("email"))
    phone = safe_text(data.get("phone"))
    linkedin = safe_text(data.get("linkedin"))
    portfolio = safe_text(data.get("portfolio"))
    target_job = safe_text(data.get("target_job"))

    contacts = " | ".join(filter(None, [email, phone, linkedin, portfolio]))

    resume = f"{name.upper()}\n"

    if contacts:
        resume += f"{contacts}\n"

    if target_job:
        resume += f"Target Role: {target_job}\n"

    resume += section("Professional Summary", enhanced_summary)
    resume += section("Technical Skills", data.get("skills"))
    resume += section("Soft Skills", data.get("soft_skills"))
    resume += section("Languages", data.get("languages"))
    resume += section("Work Experience", data.get("experience"))
    resume += section("Projects", data.get("projects"))
    resume += section("Education", data.get("education"))
    resume += section("Certifications", data.get("certifications"))

    return resume.strip()

@app.route("/api/ats/generate", methods=["POST"])
@login_required
def generate_ats_resume():
    data = request.get_json(silent=True) or {}

    summary = safe_text(data.get("summary"))
    target_job = safe_text(data.get("target_job"))
    skills = safe_text(data.get("skills"))

    enhanced_summary = ai_enhance_summary(summary, target_job, skills)
    resume = build_resume(data, enhanced_summary)
    ats_score, matched_keywords = ats_score_engine(data, enhanced_summary)

    return jsonify({
        "resume": resume,
        "enhanced_summary": enhanced_summary,
        "ats_score": ats_score,
        "matched_keywords": matched_keywords
    })

@app.route("/api/ats/enhance-summary", methods=["POST"])
@login_required
def enhance_ats_summary():
    data = request.get_json(silent=True) or {}

    summary = safe_text(data.get("summary"))
    target_job = safe_text(data.get("target_job"))
    skills = safe_text(data.get("skills"))

    if not summary:
        return jsonify({"error": "summary is required"}), 400

    enhanced_summary = ai_enhance_summary(summary, target_job, skills)

    return jsonify({
        "summary": enhanced_summary
    })

@app.route("/api/ats/export/pdf", methods=["POST"])
@login_required
def export_resume_pdf():
    try:
        data = request.get_json(silent=True) or {}
        resume = str(data.get("resume", "")).strip()

        if not resume:
            return jsonify({"error": "resume is required"}), 400

        from io import BytesIO
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
        from reportlab.lib import colors

        buffer = BytesIO()

        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=42,
            leftMargin=42,
            topMargin=38,
            bottomMargin=38
        )

        styles = getSampleStyleSheet()

        name_style = ParagraphStyle(
            "NameStyle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#111827"),
            spaceAfter=4
        )

        contact_style = ParagraphStyle(
            "ContactStyle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#374151"),
            spaceAfter=12
        )

        section_style = ParagraphStyle(
            "SectionStyle",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            alignment=TA_LEFT,
            textColor=colors.HexColor("#111827"),
            spaceBefore=12,
            spaceAfter=4
        )

        body_style = ParagraphStyle(
            "BodyStyle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            textColor=colors.HexColor("#1F2937"),
            spaceAfter=4
        )

        bullet_style = ParagraphStyle(
            "BulletStyle",
            parent=body_style,
            leftIndent=14,
            firstLineIndent=-8,
            spaceAfter=3
        )

        small_style = ParagraphStyle(
            "SmallStyle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#374151"),
            spaceAfter=4
        )

        def clean_text(text):
            return (
                str(text)
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )

        story = []
        lines = [line.strip() for line in resume.split("\n") if line.strip()]

        if not lines:
            return jsonify({"error": "resume is empty"}), 400

        story.append(Paragraph(clean_text(lines[0]), name_style))

        index = 1

        if index < len(lines) and "|" in lines[index]:
            story.append(Paragraph(clean_text(lines[index]), contact_style))
            index += 1

        if index < len(lines) and lines[index].lower().startswith("target role"):
            story.append(Paragraph(clean_text(lines[index]), small_style))
            index += 1

        story.append(HRFlowable(
            width="100%",
            thickness=1,
            color=colors.HexColor("#111827"),
            spaceBefore=4,
            spaceAfter=8
        ))

        for line in lines[index:]:
            clean = clean_text(line)

            if set(line) == {"-"}:
                continue

            if line.isupper() and len(line) <= 45:
                story.append(Spacer(1, 5))
                story.append(Paragraph(clean, section_style))
                story.append(HRFlowable(
                    width="100%",
                    thickness=0.5,
                    color=colors.HexColor("#D1D5DB"),
                    spaceBefore=1,
                    spaceAfter=5
                ))

            elif line.startswith("- "):
                story.append(Paragraph("• " + clean[2:], bullet_style))

            else:
                story.append(Paragraph(clean, body_style))

        doc.build(story)
        buffer.seek(0)

        return send_file(
            buffer,
            as_attachment=True,
            download_name="SQR_Resume.pdf",
            mimetype="application/pdf"
        )

    except Exception as e:
        return jsonify({
            "error": "PDF export failed",
            "details": str(e)
        }), 500

@app.route("/api/ats/export/docx", methods=["POST"])
@login_required
def export_resume_docx():
    data = request.get_json(silent=True) or {}
    resume = safe_text(data.get("resume"))

    if not resume:
        return jsonify({"error": "resume is required"}), 400

    doc = Document()

    for line in resume.split("\n"):
        if line.strip().isupper() and len(line.strip()) < 40:
            doc.add_heading(line.strip(), level=1)
        elif re.match(r"^- ", line.strip()):
            doc.add_paragraph(line.strip()[2:], style="List Bullet")
        else:
            doc.add_paragraph(line)

    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name="SQR_Resume.docx",
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

CS_SPECIALIZATION_BANK = [
    "Artificial Intelligence", "Machine Learning", "Data Science", "Data Engineering",
    "Cybersecurity", "Digital Forensics", "Software Engineering", "Web Development",
    "Mobile App Development", "Cloud Computing", "DevOps", "Database Administration",
    "Computer Networks", "Game Development", "UI/UX Engineering", "Blockchain Development",
    "Internet of Things", "Robotics", "Computer Vision", "Natural Language Processing"
]


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
            {"id": 5, "question": "What career goal fits you best?", "options": ["AI Engineer or Machine Learning Engineer", "Cybersecurity Analyst or Digital Forensics Investigator", "Data Engineer or Data Analyst", "Software Engineer or Full-Stack Developer"]}
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
        "Computer Networks": ["network", "routing", "switching", "protocol", "infrastructure"]
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
            "specialization_id": None
        })
    results.sort(key=lambda x: x["match_score"], reverse=True)
    return results[:3]


def get_system_specializations_for_ai():
    spk = db_primary("specializations")
    rows = query_db(f"SELECT * FROM specializations ORDER BY `{spk}` DESC", fetchall=True)
    fixed = []
    for row in rows or []:
        row = normalize_specialization(row)
        fixed.append({
            "id": row.get("id"),
            "specialization_id": row.get("specialization_id") or row.get("id"),
            "name": row.get("name"),
            "description": row.get("description"),
            "roadmap": row.get("roadmap"),
            "job_titles": row.get("job_titles"),
            "career_paths": row.get("career_paths"),
            "skills": row.get("skills", "")
        })
    return fixed


@app.route("/api/recommendation/submit", methods=["POST"])
@app.route("/api/recommendations", methods=["POST"])
@login_required
def submit_recommendation_quiz():
    data = get_json()
    answers = data.get("answers", [])

    if not answers:
        legacy_parts = [data.get("interests", ""), data.get("skills", ""), data.get("goal", "")]
        legacy_text = " ".join(str(x) for x in legacy_parts if x)
        if legacy_text.strip():
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

The user answered a career quiz. Recommend the best computer science specialization.

Important rules:
- Recommend based on quiz answers, not just existing database rows.
- You may recommend a specialization even if it is not already in the system.
- Focus only on computer science fields.
- Give match percentage.
- Give clear reason.
- Give skills to learn.
- Give possible career paths.
- If the specialization exists in the system list, set in_system true and use its specialization_id.
- If it does not exist in the system list, set in_system false and specialization_id null.

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

    apk = db_primary("assessments")
    assessment_id = insert_dynamic("assessments", {
        "user_id": user_id_value(request.current_user),
        "title": "AI Computer Science Specialization Quiz",
        "description": answer_text,
        "interests": answer_text,
        "skills": "",
        "goal": "",
        "total_score": 0
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
            "score": 1
        })

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
                insert_dynamic("recommendations", {
                    "user_id": user_id_value(request.current_user),
                    "specialization_id": sid,
                    "assessment_id": assessment_id,
                    "match_score": rec.get("match_score", rec.get("match_percentage", 0)),
                    "explanation": rec.get("reason", "")
                })
            except Exception:
                pass
        else:
            rec["in_system"] = False
            rec["specialization_id"] = None
            rec["id"] = None
        if "match_percentage" not in rec:
            rec["match_percentage"] = rec.get("match_score", 0)

    result["assessment_id"] = assessment_id
    return jsonify(result)


@app.route("/api/recommendations/analyze", methods=["POST"])
@login_required
def analyze_recommendations():
    return submit_recommendation_quiz()


@app.route("/api/specialization-recommendations")
@login_required
def get_specialization_recommendations():
    rows = query_db("""
        SELECT r.*, s.name, s.description, s.image_url, s.roadmap, s.job_titles, s.career_paths
        FROM recommendations r
        JOIN specializations s ON s.specialization_id=r.specialization_id
        WHERE r.user_id=%s
        ORDER BY r.generated_at DESC
    """, (user_id_value(request.current_user),), fetchall=True)
    return jsonify(rows or [])


@app.route("/api/job-recommendations")
@login_required
def get_job_recommendations():
    return jsonify([])


@app.route("/api/admin/specializations", methods=["POST"])
@admin_required
def admin_add_specialization_alias():
    return add_specialization()


@app.route("/api/admin/courses", methods=["POST"])
@admin_required
def admin_add_course_alias():
    return add_course()


@app.route("/api/admin/jobs", methods=["POST"])
@admin_required
def admin_add_job_alias():
    return add_job()


@app.route("/api/admin/certificates", methods=["POST"])
@admin_required
def admin_add_certificate_alias():
    return add_certificate()


@app.route("/api/admin/users/<int:user_id>/role", methods=["PUT"])
@admin_required
def update_user_role_alias(user_id):
    data = get_json()
    role = data.get("role", "student")
    if role == "admin":
        return make_admin(user_id)
    return make_student(user_id)


@app.route("/api/admin/stats")
@admin_required
def admin_stats():
    return jsonify({
        "users": query_db("SELECT COUNT(*) AS total FROM users", fetchone=True)["total"],
        "specializations": query_db("SELECT COUNT(*) AS total FROM specializations", fetchone=True)["total"],
        "courses": query_db("SELECT COUNT(*) AS total FROM courses", fetchone=True)["total"],
        "quizzes": query_db("SELECT COUNT(*) AS total FROM quizzes", fetchone=True)["total"],
        "jobs": query_db("SELECT COUNT(*) AS total FROM jobs", fetchone=True)["total"],
    })


try:
    print("Using existing SQR database schema")
except Exception as e:
    print("Schema startup check skipped:", e)


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(413)
def too_large(error):
    return jsonify({"error": "File is too large"}), 413


@app.errorhandler(500)
def server_error(error):
    return jsonify({"error": "Server error", "details": str(error)}), 500


if __name__ == "__main__":
    app.run(host=os.getenv("FLASK_HOST", "127.0.0.1"), port=int(os.getenv("FLASK_PORT", 5000)), debug=os.getenv("FLASK_DEBUG", "0") == "1")
