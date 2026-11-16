# StudyReader Authentication

Authentication is implemented centrally by `backend/server.js`.

Security decisions:
- Passwords are hashed with bcrypt.
- Authentication uses a server-side MySQL session.
- The session cookie is HTTP-only.
- Production cookies use Secure + SameSite=Lax.
- CSRF tokens are required for state-changing auth requests.
- Login has basic failed-attempt lockout.
- Authorization is checked on the backend.
- Admin access is role-based.

Keep secrets in environment variables. Never commit `.env`.
