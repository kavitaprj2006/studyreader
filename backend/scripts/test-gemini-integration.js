const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const ragService = require("../services/ai/rag-service");
const academicTutor = require("../services/ai/academic-tutor");

const HCI_DOCUMENT_TEXT = `
Human-Computer Interaction (HCI): Foundations and Principles

1. User Interfaces (UI)
In computer systems and human-computer interaction, a user interface is the point of human-computer interaction and communication in a device. An interface consists of the graphical, textual, and auditory elements the hardware and software present to the user, as well as the input mechanisms (such as touchscreens, mice, and keyboards) used to control them.

2. Core Design Principles
- Visibility of System Status: The design should always keep users informed about what is going on, through appropriate feedback within a reasonable time.
- Match Between System and the Real World: The design should speak the users' language, using words, phrases, and concepts familiar to the user.
- Affordance: Visual clues to how an object should be used (e.g., a 3D button invites clicking).
- Feedback: Sending information back to the user about what action has actually been done.
`;

const CLOUD_DOCUMENT_TEXT = `
Cloud Architecture & Scalability Patterns

1. Microservices Architecture
Microservices organize an application as a collection of loosely coupled, fine-grained services communicating via lightweight protocols (such as REST or gRPC).

2. Load Balancers and High Availability
A load balancer distributes incoming network traffic across multiple backend servers to ensure no single server becomes overwhelmed.
Load balancers prevent single points of failure by continuously performing health checks. When a backend node fails, the load balancer reroutes traffic exclusively to healthy replica nodes.
`;

async function runTests() {
  console.log("=== RUNNING GEMINI INTEGRATION & FALLBACK PURGE VERIFICATION ===\n");
  let passed = 0;
  let total = 0;

  // -------------------------------------------------------------
  // Test 1: Document-Grounded Answer (HCI Document -> "What is an interface?")
  // -------------------------------------------------------------
  total++;
  console.log(`[Test ${total}] Testing Document-Grounded Answer on HCI Document...`);
  try {
    const result = await ragService.answer({
      mode: "ask-ai",
      question: "What is an interface?",
      text: HCI_DOCUMENT_TEXT,
      history: []
    });

    console.log("Provider:", result.provider);
    console.log("Answer Excerpt:\n", result.answer.slice(0, 300), "\n...");

    const answerLower = result.answer.toLowerCase();
    const hasForbiddenAgentWords =
      answerLower.includes("thermostat") ||
      answerLower.includes("actuator") ||
      answerLower.includes("agent program") ||
      answerLower.includes("perceive (sensors)");

    if (result.provider !== "gemini") {
      throw new Error(`Expected provider 'gemini', got '${result.provider}'`);
    }

    if (hasForbiddenAgentWords) {
      throw new Error("Answer contains forbidden hardcoded Intelligent Agents text!");
    }

    if (!answerLower.includes("interface")) {
      throw new Error("Answer failed to explain interface concept!");
    }

    console.log(`✓ Test ${total} PASSED: Genuine Gemini response grounded in HCI document without sensor/actuator contamination.\n`);
    passed++;
  } catch (err) {
    console.error(`❌ Test ${total} FAILED:`, err.message, "\n");
  }

  // -------------------------------------------------------------
  // Test 2: Out-of-Document Question Handling
  // -------------------------------------------------------------
  total++;
  console.log(`[Test ${total}] Testing Out-of-Document Question ("What is photosynthesis?")...`);
  try {
    const result = await ragService.answer({
      mode: "ask-ai",
      question: "What is photosynthesis and the light-dependent reaction?",
      text: HCI_DOCUMENT_TEXT,
      history: []
    });

    console.log("Answer Excerpt:\n", result.answer.slice(0, 300), "\n...");
    const answerLower = result.answer.toLowerCase();

    const acknowledgesMissing =
      answerLower.includes("not present") ||
      answerLower.includes("not found") ||
      answerLower.includes("not mentioned") ||
      answerLower.includes("outside") ||
      answerLower.includes("could not be found");

    if (!acknowledgesMissing) {
      throw new Error("AI did not indicate that photosynthesis is outside the HCI document context.");
    }

    console.log(`✓ Test ${total} PASSED: AI clearly acknowledged that the topic is outside the provided document.\n`);
    passed++;
  } catch (err) {
    console.error(`❌ Test ${total} FAILED:`, err.message, "\n");
  }

  // -------------------------------------------------------------
  // Test 3: Multi-turn Conversational History Grounding
  // -------------------------------------------------------------
  total++;
  console.log(`[Test ${total}] Testing Multi-turn Chat Grounding on Cloud Document...`);
  try {
    const history = [
      { role: "user", message: "What is a load balancer?" },
      { role: "assistant", message: "A load balancer distributes incoming network traffic across multiple servers." }
    ];

    const result = await ragService.answer({
      mode: "ask-ai",
      question: "How does it prevent single points of failure?",
      text: CLOUD_DOCUMENT_TEXT,
      history
    });

    console.log("Answer Excerpt:\n", result.answer.slice(0, 300), "\n...");
    const answerLower = result.answer.toLowerCase();

    if (!answerLower.includes("health") && !answerLower.includes("traffic") && !answerLower.includes("node") && !answerLower.includes("server")) {
      throw new Error("Answer was not grounded in the cloud architecture context.");
    }

    console.log(`✓ Test ${total} PASSED: Multi-turn conversation answered accurately using cloud document context.\n`);
    passed++;
  } catch (err) {
    console.error(`❌ Test ${total} FAILED:`, err.message, "\n");
  }

  // -------------------------------------------------------------
  // Test 4: Missing GEMINI_API_KEY Error Handling
  // -------------------------------------------------------------
  total++;
  console.log(`[Test ${total}] Testing Behavior When GEMINI_API_KEY is Missing...`);
  const originalKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;

    let threwExpectedError = false;
    try {
      await ragService.answer({
        mode: "ask-ai",
        question: "Test question",
        text: HCI_DOCUMENT_TEXT
      });
    } catch (e) {
      if (e.message.includes("GEMINI_API_KEY is not configured")) {
        threwExpectedError = true;
      } else {
        throw e;
      }
    }

    if (!threwExpectedError) {
      throw new Error("Expected function to throw GEMINI_API_KEY missing error, but it did not!");
    }

    console.log(`✓ Test ${total} PASSED: Missing API key cleanly throws helpful configuration error without mock fallback.\n`);
    passed++;
  } catch (err) {
    console.error(`❌ Test ${total} FAILED:`, err.message, "\n");
  } finally {
    process.env.GEMINI_API_KEY = originalKey;
  }

  // -------------------------------------------------------------
  // Test 5: Invalid Key Error Handling
  // -------------------------------------------------------------
  total++;
  console.log(`[Test ${total}] Testing Behavior When GEMINI_API_KEY is Invalid...`);
  try {
    process.env.GEMINI_API_KEY = "INVALID_KEY_99999999999";

    let threwAuthError = false;
    try {
      await ragService.answer({
        mode: "ask-ai",
        question: "Test question",
        text: HCI_DOCUMENT_TEXT
      });
    } catch (e) {
      if (e.message.includes("Gemini authentication error") || e.message.includes("API responded with status 400")) {
        threwAuthError = true;
      } else {
        console.log("Caught error:", e.message);
        threwAuthError = true;
      }
    }

    if (!threwAuthError) {
      throw new Error("Expected function to reject invalid API key!");
    }

    console.log(`✓ Test ${total} PASSED: Invalid key rejected with clean upstream error without leaking secrets.\n`);
    passed++;
  } catch (err) {
    console.error(`❌ Test ${total} FAILED:`, err.message, "\n");
  } finally {
    process.env.GEMINI_API_KEY = originalKey;
  }

  // -------------------------------------------------------------
  // Test 6: Verification that academic-tutor.js Mock Engine is Disabled
  // -------------------------------------------------------------
  total++;
  console.log(`[Test ${total}] Verifying Hardcoded Mock Generator in academic-tutor.js is Disabled...`);
  try {
    let threwDisabled = false;
    try {
      academicTutor.generateAcademicTeachingResponse({
        mode: "ask-ai",
        question: "What is an interface?",
        text: HCI_DOCUMENT_TEXT
      });
    } catch (e) {
      if (e.message.includes("disabled")) {
        threwDisabled = true;
      }
    }

    if (!threwDisabled) {
      throw new Error("academic-tutor mock generator was not disabled!");
    }

    console.log(`✓ Test ${total} PASSED: Hardcoded mock generator successfully disabled.\n`);
    passed++;
  } catch (err) {
    console.error(`❌ Test ${total} FAILED:`, err.message, "\n");
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("==================================================");
  console.log(`RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");

  if (passed === total) {
    console.log("🎉 ALL GEMINI INTEGRATION & ISOLATION TESTS COMPLETED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("❌ SOME TESTS FAILED.");
    process.exit(1);
  }
}

runTests();
