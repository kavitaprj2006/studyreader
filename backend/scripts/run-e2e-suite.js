process.env.NODE_ENV = "test";
const http = require("http");
const fs = require("fs");
const path = require("path");

// Start app in-process
const { app, pool, startServer } = require("../server");

function request(port, options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...options, port, hostname: "127.0.0.1" }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (_) {
          parsed = body;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });
    req.on("error", reject);
    if (data) req.write(typeof data === "string" ? data : JSON.stringify(data));
    req.end();
  });
}

function uploadFile(port, options, filePath, fieldName = "pdf", extraFields = {}) {
  return new Promise((resolve, reject) => {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const filename = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);

    let preData = "";
    for (const [key, val] of Object.entries(extraFields)) {
      preData += `--${boundary}\r\n`;
      preData += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      preData += `${val}\r\n`;
    }

    preData += `--${boundary}\r\n`;
    preData += `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`;
    preData += `Content-Type: application/pdf\r\n\r\n`;

    const postData = `\r\n--${boundary}--\r\n`;
    const contentLength = Buffer.byteLength(preData) + fileData.length + Buffer.byteLength(postData);

    const headers = {
      ...options.headers,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": contentLength
    };

    const req = http.request({ ...options, port, hostname: "127.0.0.1", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (_) {
          parsed = body;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on("error", reject);
    req.write(preData);
    req.write(fileData);
    req.write(postData);
    req.end();
  });
}

async function runSuite() {
  console.log("==================================================================");
  console.log("STUDYREADER: IN-PROCESS END-TO-END VERIFICATION SUITE");
  console.log("==================================================================\n");

  await startServer();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  console.log(`Test server running on port ${port}\n`);

  try {
    // 1. Create a clean test user
    const testEmail = `student_${Date.now()}@studyreader.edu`;
    console.log(`1. Registering test student: ${testEmail}...`);

    const regRes = await request(
      port,
      {
        path: "/api/auth/signup",
        method: "POST",
        headers: { "Content-Type": "application/json" }
      },
      {
        name: "Alex Johnson",
        email: testEmail,
        password: "Password123!",
        role: "student"
      }
    );

    console.log("Signup Status:", regRes.statusCode);
    if (regRes.statusCode !== 201) {
      throw new Error(`Signup failed: ${JSON.stringify(regRes.data)}`);
    }

    const cookie = regRes.headers["set-cookie"]
      ? regRes.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ")
      : "";

    console.log("Session Cookie established.\n");

    // 2. Upload test document (Lecture 2 Intelligent Agents)
    const samplePdfPath = path.join(__dirname, "../uploads/1790494140754-572705239.pdf");
    console.log(`2. Uploading academic document: ${path.basename(samplePdfPath)}...`);

    const uploadRes = await uploadFile(
      port,
      {
        path: "/api/pdfs/upload",
        method: "POST",
        headers: { Cookie: cookie }
      },
      samplePdfPath,
      "pdf",
      { category: "resource" }
    );

    console.log("Upload Status:", uploadRes.statusCode);
    if (uploadRes.statusCode !== 200 && uploadRes.statusCode !== 201) {
      throw new Error(`Upload failed: ${JSON.stringify(uploadRes.data)}`);
    }

    const uploadedPdf = uploadRes.data.pdf;
    const pdfId = uploadedPdf.id;
    console.log(`Document saved! ID: ${pdfId}, Filename: "${uploadedPdf.originalFilename || uploadedPdf.filename}"\n`);

    // 3. Test AI Chat: "what is this pdf about?"
    console.log("3. Asking AI Tutor: 'what is this pdf about?'");
    const chat1 = await request(
      port,
      {
        path: `/api/pdfs/${pdfId}/chat`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie }
      },
      { message: "what is this pdf about?" }
    );

    console.log("Chat Response Status:", chat1.statusCode);
    const msg1 = chat1.data.assistantMessage?.message || "";
    console.log("\nAI Answer:\n", msg1, "\n");

    const hasGlitchedTemplate = msg1.includes("formal structural methodology used in computational and academic systems");
    const hasThisPdfAbout = msg1.includes("this pdf about is");
    console.log(">>> Template Glitch Check:", hasGlitchedTemplate ? "FAIL" : "PASS (Clean)");
    console.log(">>> Grammar/Prefix Check:", hasThisPdfAbout ? "FAIL" : "PASS (Clean)");

    // 4. Test Conversational Follow-up: "what are its main components?"
    console.log("\n4. Asking Follow-up: 'what are its main components?' (testing history resolution)...");
    const chat2 = await request(
      port,
      {
        path: `/api/pdfs/${pdfId}/chat`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie }
      },
      { message: "what are its main components?" }
    );

    console.log("Chat 2 Response Status:", chat2.statusCode);
    const msg2 = chat2.data.assistantMessage?.message || "";
    console.log("\nFollow-up Answer:\n", msg2, "\n");

    // 5. Test Chat History Retrieval
    console.log("5. Verifying Chat History via GET /api/pdfs/:id/chat...");
    const histRes = await request(port, {
      path: `/api/pdfs/${pdfId}/chat`,
      method: "GET",
      headers: { Cookie: cookie }
    });

    const historyMessages = histRes.data.messages || [];
    console.log(`History count: ${historyMessages.length} messages in database.`);
    console.log("History check:", historyMessages.length >= 4 ? "PASS" : "FAIL");

    // 6. Test Structured Summary
    console.log("\n6. Requesting Structured Revision Summary...");
    const sumRes = await request(
      port,
      {
        path: `/api/pdfs/${pdfId}/ai`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie }
      },
      { mode: "summary", summaryType: "quick" }
    );

    console.log("Summary Status:", sumRes.statusCode);
    const sumText = sumRes.data.answer || "";
    console.log("\nSummary Output:\n", sumText.slice(0, 400) + "...\n");

    // 7. Test Out-of-Document Detection
    console.log("7. Testing Out-of-Document Query: 'how does photosynthesis work?'...");
    const chat3 = await request(
      port,
      {
        path: `/api/pdfs/${pdfId}/chat`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie }
      },
      { message: "how does photosynthesis work?" }
    );

    const msg3 = chat3.data.assistantMessage?.message || "";
    console.log("\nOut-of-Document Answer:\n", msg3, "\n");
    const hasNotice = msg3.includes("Notice: Topic Not in Document") || msg3.includes("not discussed anywhere in this text");
    console.log("Out-of-Document Honesty:", hasNotice ? "PASS (Honest fallback)" : "FAIL");

    console.log("\n==================================================================");
    console.log("IN-PROCESS END-TO-END SUITE COMPLETED SUCCESSFULLY");
    console.log("==================================================================");

  } finally {
    server.close();
    pool.end();
  }
}

runSuite().catch((err) => {
  console.error("Suite failed:", err);
  process.exit(1);
});
