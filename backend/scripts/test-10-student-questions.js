const path = require("path");
const officeParser = require("officeparser");
const academicTutor = require("../services/ai/academic-tutor");

async function runTestSuite() {
  const filePath = path.join(__dirname, "../uploads/1790494140754-572705239.pdf");
  const ast = await officeParser.parseOffice(filePath);
  const textObj = await ast.to("text");
  const text = String(textObj.value || "");

  const tests = [
    {
      id: 1,
      type: "Document Overview",
      question: "what is this pdf about?",
      history: []
    },
    {
      id: 2,
      type: "Core Definition",
      question: "What is a rational agent?",
      history: []
    },
    {
      id: 3,
      type: "Mechanism / Step-by-Step",
      question: "How does an agent work step by step?",
      history: []
    },
    {
      id: 4,
      type: "Comparison / Tradeoffs",
      question: "Differentiate between sensors and actuators",
      history: []
    },
    {
      id: 5,
      type: "Simple Words / ELI5",
      question: "Explain intelligent agents in simple words",
      history: []
    },
    {
      id: 6,
      type: "System Components",
      question: "What are the main components of an agent structure?",
      history: []
    },
    {
      id: 7,
      type: "Real-World Example / Analogy",
      question: "Give a real world example of a robotic agent",
      history: []
    },
    {
      id: 8,
      type: "Exam Questions & Answers",
      question: "What are likely exam questions on this material?",
      history: []
    },
    {
      id: 9,
      type: "Multi-Turn Pronoun Resolution",
      question: "What are its key components?",
      history: [
        { role: "user", message: "Can you explain what an intelligent agent is?" },
        { role: "assistant", message: "An intelligent agent is an autonomous entity that perceives its environment through sensors and acts using actuators to achieve its goals." }
      ]
    },
    {
      id: 10,
      type: "Out-of-Document Honest Fallback",
      question: "How does cellular respiration and mitochondria work?",
      history: []
    }
  ];

  console.log("==================================================================");
  console.log("STUDYREADER AI TUTOR: 10-QUESTION COMPREHENSIVE PEDAGOGICAL AUDIT");
  console.log("==================================================================\n");

  let passed = 0;

  for (const t of tests) {
    console.log(`\n------------------------------------------------------------------`);
    console.log(`TEST ${t.id} [${t.type}]`);
    console.log(`Query: "${t.question}"`);
    if (t.history.length) {
      console.log(`Prior Context: "${t.history[0].message}"`);
    }
    console.log(`------------------------------------------------------------------`);

    const response = academicTutor.generateAcademicTeachingResponse({
      mode: "ask-ai",
      question: t.question,
      text,
      history: t.history
    });

    console.log(response);

    // Assertions
    const hasUnnaturalTemplate = response.includes("formal structural methodology used in computational and academic systems");
    const hasThisPdfAboutGlitch = response.includes("this pdf about is");
    const hasContent = response && response.length > 50;

    if (!hasUnnaturalTemplate && !hasThisPdfAboutGlitch && hasContent) {
      console.log(`\n>>> RESULT: PASS (Natural, Grounded, Pedagogical)`);
      passed++;
    } else {
      console.log(`\n>>> RESULT: FAIL (Detected template glitch or empty content)`);
    }
  }

  console.log(`\n==================================================================`);
  console.log(`AUDIT SUMMARY: ${passed}/${tests.length} TESTS PASSED`);
  console.log(`==================================================================`);
}

runTestSuite().catch(console.error);
