# SQR Non-Deleting Railway Patch

This package keeps your original long HTML/CSS design and patches only the backend/API compatibility parts plus one small frontend message fix.

Changed files:
- SQR.py
- static/app.js

Unchanged design files are still included so you can replace the project safely without losing your long templates/styles.

What was fixed:
- Specializations load using Railway primary key `specializations.id` instead of only nullable `specialization_id`.
- Specialization enroll/unenroll uses Railway table `specialization_enrollments(user_id, spec_id, progress, status)`.
- Courses load/details/enroll/unenroll/open use Railway table `courses.id` and `course_enrollments.course_id`.
- Course open tracking auto-enrolls the course only when the user is already enrolled in that specialization.
- Profile progress uses Railway columns and no longer queries missing columns like `enrollment_id`, `attempt_id`, or `ats_id`.
- Quiz submit/history uses `quizzes.id` and `quiz_attempts.id`.
- ATS history uses `ats_results.id`.
- Gemini env var typo is supported: both `GEMINI_API_KEY` and `GEIMINI_API_KEY` work, same for model.

Recommended Render variables:
- DB_HOST
- DB_NAME=railway
- DB_USER
- DB_PASSWORD
- DB_PORT
- SQR_SECRET_KEY
- GEMINI_API_KEY
- GEMINI_MODEL=gemini-2.5-flash or gemini-2.0-flash

Tested syntax:
- python -m py_compile SQR.py
- node --check static/app.js
