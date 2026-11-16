# StudyReader

StudyReader is a secure, user-focused PDF study application.

## Current milestone

- Final database schema
- Node.js + Express backend
- MySQL connection
- Server-side sessions
- bcrypt password hashing
- CSRF protection for auth mutations
- Signup
- Login
- Logout
- Protected session
- Role-based admin authorization
- Initial frontend pages

## Local setup

1. Install Node.js and MySQL.
2. Create the database:
   `mysql -u root -p < database/schema.sql`
3. Copy `backend/.env.example` to `backend/.env`.
4. Set the MySQL credentials and a strong SESSION_SECRET.
5. From `backend/` run:
   `npm install`
6. Start:
   `npm run dev`
7. Open:
   `http://localhost:3000/pages/login/index.html`

Never commit `backend/.env`.
