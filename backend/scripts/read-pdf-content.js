const fs = require("fs");
const path = require("path");
const officeParser = require("officeparser");

async function run() {
  const filePath = path.join(__dirname, "../uploads/1790494140754-572705239.pdf");
  const ast = await officeParser.parseOffice(filePath);
  const textObj = await ast.to("text");
  const text = String(textObj.value || "");
  console.log("=== FULL TEXT PREVIEW ===");
  console.log(text.slice(0, 2000));
}

run();
