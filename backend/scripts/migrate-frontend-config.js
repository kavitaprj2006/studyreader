const fs = require("fs");
const path = require("path");

const filesToUpdate = [
  "frontend/scripts/document-text.js",
  "frontend/scripts/duplicate-upload.js",
  "frontend/scripts/read-aloud.js",
  "frontend/scripts/navigation.js",
  "frontend/pages/login/login.js",
  "frontend/pages/signup/signup.js",
  "frontend/pages/dashboard/dashboard.js",
  "frontend/pages/teacher-dashboard/teacher-dashboard.js",
  "frontend/pages/library/library.js",
  "frontend/pages/pdf-study/pdf-study.js",
  "frontend/pages/admin/index.html"
];

for (const rel of filesToUpdate) {
  const full = path.resolve(rel);
  if (!fs.existsSync(full)) {
    console.log("File not found:", rel);
    continue;
  }

  let content = fs.readFileSync(full, "utf8");
  let modified = false;

  // Patterns to replace
  const regexList = [
    /const\s+API_BASE_URL\s*=\s*["']http:\/\/127\.0\.0\.1:3000["'];?/g,
    /const\s+API_BASE_URL\s*=\s*\r?\n\s*["']http:\/\/127\.0\.0\.1:3000["'];?/g,
    /const\s+DOCUMENT_TEXT_API_BASE_URL\s*=\s*\r?\n\s*["']http:\/\/127\.0\.0\.1:3000["'];?/g,
    /const\s+DOCUMENT_TEXT_API_BASE_URL\s*=\s*["']http:\/\/127\.0\.0\.1:3000["'];?/g
  ];

  for (const re of regexList) {
    if (re.test(content)) {
      content = content.replace(re, "const API_BASE_URL = window.API_BASE_URL || \"http://127.0.0.1:3000\";");
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(full, content, "utf8");
    console.log("Successfully updated API_BASE_URL in:", rel);
  } else {
    console.log("No replacement needed in:", rel);
  }
}
