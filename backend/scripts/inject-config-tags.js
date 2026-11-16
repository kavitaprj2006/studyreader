const fs = require("fs");
const path = require("path");

const htmlFiles = [
  "frontend/pages/login/index.html",
  "frontend/pages/signup/index.html",
  "frontend/pages/dashboard/index.html",
  "frontend/pages/teacher-dashboard/index.html",
  "frontend/pages/library/index.html",
  "frontend/pages/pdf-study/index.html",
  "frontend/pages/admin/index.html"
];

for (const rel of htmlFiles) {
  const full = path.resolve(rel);
  if (!fs.existsSync(full)) continue;

  let content = fs.readFileSync(full, "utf8");
  if (content.includes("config.js")) {
    console.log("config.js already in:", rel);
    continue;
  }

  // Inject in <head> or right before navigation.js / first script
  if (content.includes("<script src=\"../../scripts/navigation.js\"></script>")) {
    content = content.replace(
      "<script src=\"../../scripts/navigation.js\"></script>",
      "<script src=\"../../scripts/config.js\"></script>\n  <script src=\"../../scripts/navigation.js\"></script>"
    );
  } else if (content.includes("</head>")) {
    content = content.replace("</head>", "  <script src=\"../../scripts/config.js\"></script>\n</head>");
  } else {
    content = content.replace("</body>", "  <script src=\"../../scripts/config.js\"></script>\n</body>");
  }

  fs.writeFileSync(full, content, "utf8");
  console.log("Injected config.js in:", rel);
}
