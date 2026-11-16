const fs = require("fs");
const path = require("path");
const officeParser = require("officeparser");
const academicTutor = require("../services/ai/academic-tutor");

async function testTutor() {
  const filePath = path.join(__dirname, "../uploads/1790494140754-572705239.pdf");
  const ast = await officeParser.parseOffice(filePath);
  const textObj = await ast.to("text");
  const text = String(textObj.value || "");

  console.log("=== RUNNING PEDAGOGICAL AI TUTOR QUALITY TESTS ===");

  // TEST 1: "what is this pdf about?"
  console.log("\n--- TEST 1: Question: 'what is this pdf about?' ---");
  const res1 = academicTutor.generateAcademicTeachingResponse({
    mode: "ask-ai",
    question: "what is this pdf about?",
    text
  });
  console.log(res1);

  // TEST 2: "What is an agent?"
  console.log("\n--- TEST 2: Question: 'What is an agent?' ---");
  const res2 = academicTutor.generateAcademicTeachingResponse({
    mode: "ask-ai",
    question: "What is an agent?",
    text
  });
  console.log(res2);

  // TEST 3: "How does an agent work step by step?"
  console.log("\n--- TEST 3: Question: 'How does an agent work step by step?' ---");
  const res3 = academicTutor.generateAcademicTeachingResponse({
    mode: "ask-ai",
    question: "How does an agent work step by step?",
    text
  });
  console.log(res3);

  // TEST 4: "Differentiate between sensors and actuators"
  console.log("\n--- TEST 4: Question: 'Differentiate between sensors and actuators' ---");
  const res4 = academicTutor.generateAcademicTeachingResponse({
    mode: "ask-ai",
    question: "Differentiate between sensors and actuators",
    text
  });
  console.log(res4);

  // TEST 5: Follow-up conversational test:
  // History: user asked "What is an intelligent agent?", tutor responded.
  // Next query: "What are its components?"
  console.log("\n--- TEST 5: Conversational Follow-up: 'What are its components?' ---");
  const history = [
    { role: "user", message: "What is an intelligent agent?" },
    { role: "assistant", message: "An intelligent agent is an autonomous entity that perceives its environment through sensors and acts to achieve goals." }
  ];
  const res5 = academicTutor.generateAcademicTeachingResponse({
    mode: "ask-ai",
    question: "What are its components?",
    text,
    history
  });
  console.log(res5);

  // TEST 6: Out-of-document test: "How does photosynthesis work?"
  console.log("\n--- TEST 6: Out-of-Document: 'How does photosynthesis work?' ---");
  const res6 = academicTutor.generateAcademicTeachingResponse({
    mode: "ask-ai",
    question: "How does photosynthesis work?",
    text
  });
  console.log(res6);
}

testTutor().catch(console.error);
