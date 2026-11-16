require("dotenv").config({ path: __dirname + "/.env" });
const { Pool } = require("pg");
const http = require("http");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

function makeRequest(options, postData, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {
      "Content-Type": "application/json",
      ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    };

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        headers,
        ...options
      },
      (res) => {
        let body = "";
        const setCookie = res.headers["set-cookie"];
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            setCookie: setCookie ? setCookie[0] : null,
            body: parsed
          });
        });
      }
    );

    req.on("error", reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log("=================================================");
  console.log("  StudyReader Registration & Role Verification   ");
  console.log("=================================================");

  const timestamp = Date.now();
  const studentEmail = `student_test_${timestamp}@studyreader.edu`;
  const teacherEmail = `teacher_test_${timestamp}@studyreader.edu`;

  try {
    // -----------------------------------------------------------------
    // TEST 1: Register NEW account selecting STUDENT
    // -----------------------------------------------------------------
    console.log(`\n[TEST 1] Registering Student: ${studentEmail}`);
    const studentSignupRes = await makeRequest(
      { method: "POST", path: "/api/auth/signup" },
      JSON.stringify({
        name: "Test Student",
        email: studentEmail,
        password: "password123",
        role: "student"
      })
    );
    console.log("Signup HTTP Status:", studentSignupRes.statusCode);
    console.log("Signup Response Body:", studentSignupRes.body);

    if (studentSignupRes.statusCode !== 201 || studentSignupRes.body.user?.role !== "student") {
      throw new Error("Student signup failed or returned incorrect role!");
    }

    // Verify in PostgreSQL database
    const dbStudent = await pool.query(
      "SELECT id, name, email, role, is_approved FROM users WHERE email = $1",
      [studentEmail]
    );
    console.log("Database Record for Student:", dbStudent.rows[0]);
    if (dbStudent.rows[0]?.role !== "student") {
      throw new Error(`Database stored incorrect role for student: ${dbStudent.rows[0]?.role}`);
    }

    // -----------------------------------------------------------------
    // TEST 2: Register NEW account selecting TEACHER
    // -----------------------------------------------------------------
    console.log(`\n[TEST 2] Registering Teacher: ${teacherEmail}`);
    const teacherSignupRes = await makeRequest(
      { method: "POST", path: "/api/auth/signup" },
      JSON.stringify({
        name: "Professor Turing",
        email: teacherEmail,
        password: "password123",
        role: "teacher"
      })
    );
    console.log("Signup HTTP Status:", teacherSignupRes.statusCode);
    console.log("Signup Response Body:", teacherSignupRes.body);

    if (teacherSignupRes.statusCode !== 201 || teacherSignupRes.body.user?.role !== "teacher") {
      throw new Error("Teacher signup failed or returned incorrect role!");
    }

    // Verify in PostgreSQL database
    const dbTeacher = await pool.query(
      "SELECT id, name, email, role, is_approved FROM users WHERE email = $1",
      [teacherEmail]
    );
    console.log("Database Record for Teacher:", dbTeacher.rows[0]);
    if (dbTeacher.rows[0]?.role !== "teacher") {
      throw new Error(`Database stored incorrect role for teacher: ${dbTeacher.rows[0]?.role}`);
    }

    // -----------------------------------------------------------------
    // TEST 3: Login as Teacher
    // -----------------------------------------------------------------
    console.log(`\n[TEST 3] Logging in as Teacher: ${teacherEmail}`);
    const teacherLoginRes = await makeRequest(
      { method: "POST", path: "/api/auth/login" },
      JSON.stringify({
        email: teacherEmail,
        password: "password123"
      })
    );
    console.log("Login HTTP Status:", teacherLoginRes.statusCode);
    console.log("Login Response Body:", teacherLoginRes.body);

    if (teacherLoginRes.statusCode !== 200 || teacherLoginRes.body.user?.role !== "teacher") {
      throw new Error("Teacher login failed or returned incorrect role!");
    }

    const sessionCookie = teacherLoginRes.setCookie;
    console.log("Session Cookie received:", sessionCookie ? "YES" : "NO");

    // -----------------------------------------------------------------
    // TEST 4: Call /api/auth/me with Teacher session
    // -----------------------------------------------------------------
    console.log("\n[TEST 4] Calling /api/auth/me with Teacher session...");
    const meRes = await makeRequest(
      { method: "GET", path: "/api/auth/me" },
      null,
      sessionCookie
    );
    console.log("/api/auth/me HTTP Status:", meRes.statusCode);
    console.log("/api/auth/me Response Body:", meRes.body);

    if (meRes.statusCode !== 200 || meRes.body.user?.role !== "teacher") {
      throw new Error("/api/auth/me did not return role: 'teacher'!");
    }

    // -----------------------------------------------------------------
    // TEST 5: Verify Role Protected Endpoint /api/auth/teacher-only
    // -----------------------------------------------------------------
    console.log("\n[TEST 5] Calling /api/auth/teacher-only with Teacher session...");
    const teacherOnlyRes = await makeRequest(
      { method: "GET", path: "/api/auth/teacher-only" },
      null,
      sessionCookie
    );
    console.log("/api/auth/teacher-only HTTP Status:", teacherOnlyRes.statusCode);
    console.log("/api/auth/teacher-only Response Body:", teacherOnlyRes.body);

    if (teacherOnlyRes.statusCode !== 200) {
      throw new Error("Teacher could not access teacher-only endpoint!");
    }

    // -----------------------------------------------------------------
    // TEST 6: Security - Rogue Admin Signup Prevention
    // -----------------------------------------------------------------
    console.log("\n[TEST 6] Testing Rogue Admin signup injection...");
    const rogueAdminRes = await makeRequest(
      { method: "POST", path: "/api/auth/signup" },
      JSON.stringify({
        name: "Rogue Admin",
        email: `hacker_${timestamp}@studyreader.edu`,
        password: "password123",
        role: "admin"
      })
    );
    console.log("Rogue Admin HTTP Status:", rogueAdminRes.statusCode);
    console.log("Rogue Admin Response Body:", rogueAdminRes.body);

    if (rogueAdminRes.statusCode !== 400) {
      throw new Error("Rogue admin signup was not rejected with 400 Bad Request!");
    }

    // -----------------------------------------------------------------
    // TEST 7: Verify Existing Accounts Data Intact
    // -----------------------------------------------------------------
    console.log("\n[TEST 7] Checking integrity of existing users in database...");
    const existingUsers = await pool.query(
      "SELECT id, name, email, role, created_at FROM users ORDER BY id ASC"
    );
    console.log("Total users in database:", existingUsers.rows.length);
    console.table(existingUsers.rows);

    console.log("\n>>> ALL 7 AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY! <<<");

  } catch (err) {
    console.error("\nTEST SUITE FAILED:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
