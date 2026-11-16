const fs = require("fs");
const path = require("path");
const officeParser = require("officeparser");

async function run() {
  const uploads = fs.readdirSync(path.join(__dirname, "../uploads")).filter(f => f.endsWith(".pdf"));
  for (let i = 0; i < Math.min(5, uploads.length); i++) {
    const filePath = path.join(__dirname, "../uploads", uploads[i]);
    try {
      const ast = await officeParser.parseOffice(filePath);
      const textObj = await ast.to("text");
      const text = String(textObj.value || "").trim();
      console.log(`\n--- [${i}] ${uploads[i]} (Extracted ${text.length} chars) ---`);
      console.log(text.slice(0, 200).replace(/\r?\n/g, " "));
    } catch (e) {
      console.log(`\n--- [${i}] ${uploads[i]} ERROR:`, e.message);
    }
  }
}

run();
