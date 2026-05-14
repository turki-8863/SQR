SQR full enhanced project package v2

Files included:
- SQR.py
- static/app.js
- static/styles.css
- templates/*.html
- requirements.txt
- Procfile
- render.yaml
- .python-version
- sql/sqr_railway_no_drop_v2.sql

Install:
1. Upload the full folder contents to GitHub.
2. Run sql/sqr_railway_no_drop_v2.sql in Railway MySQL.
3. On Render set Health Check Path to /healthz.
4. Use the included Procfile or this start command:
   gunicorn SQR:app --bind 0.0.0.0:$PORT --workers 1 --threads 2 --timeout 120 --max-requests 500 --max-requests-jitter 50 --access-logfile - --error-logfile -
5. Set PYTHON_VERSION=3.11.11 or keep the included .python-version file.

Important behavior:
- Admin mode is blocked from student pages and redirected to admin.html.
- Student users cannot access admin.html.
- Opening a course or course media tracks progress.
- Course opened/enrolled = 50%, passed course quizzes complete the remaining 50%.
- ATS checker only requires upload PDF/DOCX/TXT and optional job description.
- ATS generator does not save personal resume data unless SQR_SAVE_ATS=1.
- The SQL script is no-drop and does not delete your data.
