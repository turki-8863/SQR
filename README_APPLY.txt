SQR fixed patch

Replace these files in your project:
1. sqr.py -> project root sqr.py
2. app.js -> static/app.js

Then push to GitHub and redeploy Render.

What was fixed:
- specializations/courses/jobs GET routes now use the real table name specializations.
- courses search uses c.level instead of c.difficulty.
- jobs and courses joins use specializations.
- ATS generator now returns and displays enhanced_summary / ai_enhanced_summary.
- Recommendation now has quiz-based scoring.
- Specialization recommendations and job recommendations are separated.
- Job scores are calculated separately using quiz specialization score + job skill match.

Important for AI:
- To use real OpenAI enhancement, add OPENAI_API_KEY to Render environment variables.
- Without OPENAI_API_KEY, the backend still creates a cleaner local enhanced summary, but ai_used will be false.

Optional SQL:
- Run sqr_database_patch.sql only if recommendation_results does not exist.
