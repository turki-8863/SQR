SQR full fixed files

Upload these files to the same paths in your GitHub repo:

SQR.py
static/app.js
static/styles.css
templates/recommendation.html

SQL files:
sql/sqr_full_schema_no_drop.sql
sql/railway_progress_enroll_fix.sql

Recommended order:
1. Upload/replace SQR.py, static/app.js, static/styles.css, and templates/recommendation.html.
2. Commit and push to GitHub.
3. Let Render/Railway redeploy.
4. Run sql/sqr_full_schema_no_drop.sql in Railway MySQL.
5. If you already had old progress/enrollment rows, also run sql/railway_progress_enroll_fix.sql.
6. Sign in as a STUDENT account, not admin, then open a course.
7. Check Railway:
   SELECT * FROM course_enrollments ORDER BY enrolled_at DESC LIMIT 10;
   SELECT * FROM specialization_enrollments ORDER BY enrolled_at DESC LIMIT 10;
   SELECT * FROM progress ORDER BY updated_at DESC LIMIT 10;

Important behavior:
- Admin role is redirected to admin.html and blocked from student APIs.
- Student can access courses, ATS, recommendation, jobs, quizzes, profile.
- Opening a course auto-enrolls the student and gives 50% progress.
- Passing quizzes completes the remaining 50%.
- If a course has no quizzes, opening/enrolling it marks it complete.
- Mark Completed buttons are removed from the UI.
- ATS checker accepts PDF, DOCX, and TXT upload.
- ATS generator does not save generated user info unless SQR_SAVE_ATS=1 is set in environment.

Do not upload the whole folder itself. Upload the files into matching GitHub folders.
