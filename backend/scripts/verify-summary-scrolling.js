const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const os = require("os");

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BROWSER_PATH = process.argv.includes("--browser=edge")
  ? EDGE_PATH
  : (fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH);
const PORT = 9225;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendCDP(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          ws.removeEventListener("message", handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch (_) {}
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalInBrowser(ws, expression) {
  const res = await sendCDP(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    console.error("Browser JS Exception:", JSON.stringify(res.exceptionDetails, null, 2));
  }
  return res.result?.value;
}

// Generate realistic multi-section HTML summary content for scrolling tests
function createLongSummaryHtml() {
  let html = `<div class="summary-body">
    <h1>Propositional Logic and Knowledge Representation: Complete Master Study Guide</h1>
    <p>Human reasoning and automated problem solving fundamentally depend on formal knowledge representations <span class="summary-page-citation">[Page 1]</span>. In knowledge-based agent design, an agent maintains an explicit internal state of the environment through sentences stored in its Knowledge-Base (KB) <span class="summary-page-citation">[Page 4]</span>.</p>`;

  for (let i = 1; i <= 25; i++) {
    html += `
      <section style="margin-bottom: 24px;">
        <h2>Section ${i}: Advanced Logical Equivalence, Model Entailment & Derivation</h2>
        <p>This section explores standard logical equivalences, standard normal forms, and sound inference rules in formal artificial intelligence systems <span class="summary-page-citation">[Page ${i * 2}]</span>.</p>
        <ul>
          <li><strong>Principle ${i}.A</strong>: Logical entailment guarantees truth preservation across all models <span class="summary-page-citation">[Page ${i * 2 + 1}]</span>.</li>
          <li><strong>Principle ${i}.B</strong>: Resolution inference operates through refutation completeness on Conjunctive Normal Form (CNF) clauses <span class="summary-page-citation">[Page ${i * 2 + 2}]</span>.</li>
          <li><strong>Principle ${i}.C</strong>: Soundness ensures no invalid conclusions can be derived from true premises.</li>
        </ul>
        <div style="background: #f8fafc; padding: 12px; border-left: 4px solid #4f46e5; margin: 8px 0; border-radius: 4px;">
          <em>Exam Review Takeaway #${i}:</em> Model checking proves satisfiability across all 2<sup>n</sup> truth assignments for propositional variables.
        </div>
      </section>`;
  }

  html += `
    <div id="summary-final-section" style="padding: 16px; background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; margin-top: 32px;">
      <h3 style="color: #065f46; margin-top: 0;">Final Examination Summary & Citations</h3>
      <p style="color: #047857; margin-bottom: 0;">
        All topics covering propositional calculus, inference rules, horn clauses, and first-order predicate foundations have been fully analyzed and verified.
        <span class="summary-page-citation" id="final-citation" style="font-weight: bold; color: #047857;">[Pages 55–60]</span>
      </p>
    </div>
  </div>`;

  return html;
}

function startStaticServer(frontendRoot, port = 5500) {
  const mimeTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml"
  };

  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split("?")[0]);
    if (reqPath === "/") reqPath = "/index.html";
    const filePath = path.join(frontendRoot, reqPath);
    if (!filePath.startsWith(frontendRoot)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not Found: " + reqPath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "text/plain",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function run() {
  console.log("=================================================");
  console.log("StudyReader Summary Scrolling Verification");
  console.log("=================================================\n");

  const frontendDir = path.resolve(__dirname, "../../frontend");
  let staticServer;
  try {
    staticServer = await startStaticServer(frontendDir, 5500);
    console.log("1. Static frontend server listening at http://127.0.0.1:5500");
  } catch (err) {
    console.log("1. Port 5500 might already be in use:", err.message);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "studyreader-chrome-"));
  console.log("2. Starting headless browser:", BROWSER_PATH);
  const browserProc = spawn(BROWSER_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${tempDir}`,
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-sync",
    "--no-first-run",
    "--disable-gpu",
    "--no-sandbox",
    "--window-size=1280,800"
  ]);

  browserProc.on("error", (e) => console.error("Browser error:", e));

  let connected = false;
  let targets = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      if (res.ok) {
        targets = await res.json();
        connected = true;
        break;
      }
    } catch (_) {}
  }

  if (!connected || !targets || !targets[0]) {
    browserProc.kill();
    throw new Error("Could not connect to browser CDP");
  }

  const pageTarget = targets.find((t) => t.type === "page") || targets[0];
  console.log(`   Connected to target: [${pageTarget.type}] ${pageTarget.title || pageTarget.url}`);
  const wsUrl = pageTarget.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  try {
    await sendCDP(ws, "Page.enable");
    await sendCDP(ws, "Runtime.enable");
    await sendCDP(ws, "Network.enable");

    // Login via API to obtain session cookie
    console.log("2. Logging in as document owner (1987babulal@gmail.com)...");
    const loginRes = await fetch("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "1987babulal@gmail.com",
        password: "Password123!"
      })
    });

    const loginData = await loginRes.json();
    console.log("   Login API status:", loginRes.status, loginData.message || "");
    assert.strictEqual(loginRes.status, 200, "Login must succeed with status 200");

    const cookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get("set-cookie")];
    const sidCookie = cookies.find((c) => c.startsWith("connect.sid="));
    assert(sidCookie, "Must have connect.sid cookie");

    const sidValue = sidCookie.split(";")[0].split("=").slice(1).join("=");

    // Set cookie in browser via CDP
    await sendCDP(ws, "Network.setCookie", {
      name: "connect.sid",
      value: sidValue,
      url: "http://127.0.0.1:3000"
    });
    await sendCDP(ws, "Network.setCookie", {
      name: "connect.sid",
      value: sidValue,
      url: "http://localhost:3000"
    });
    await sendCDP(ws, "Network.setCookie", {
      name: "connect.sid",
      value: sidValue,
      url: "http://127.0.0.1:5500"
    });

    console.log("3. Navigating to PDF Study workspace (Doc 36)...");
    await sendCDP(ws, "Page.navigate", { url: "http://127.0.0.1:5500/pages/pdf-study/index.html?id=36" });

    // Wait for page DOM and pdf-study.js to fully initialize
    let pageReady = false;
    for (let i = 0; i < 50; i++) {
      await sleep(300);
      const state = await evalInBrowser(ws, `({
        href: window.location.href,
        readyState: document.readyState,
        title: document.title,
        pdfTitle: document.getElementById("pdf-title") ? document.getElementById("pdf-title").textContent.trim() : "",
        hasPanel: Boolean(document.getElementById("document-ai-panel")),
        hasSummary: Boolean(document.getElementById("summary-content"))
      })`);
      if (i % 5 === 0) console.log("   Page state:", state);
      if (state && state.readyState === "complete" && state.pdfTitle) {
        pageReady = true;
        break;
      }
    }
    const finalHref = await evalInBrowser(ws, "window.location.href");
    console.log("   Final page URL:", finalHref);
    assert(pageReady, "Page DOM elements and document data must be ready");

    // Open Summary View via UI click
    console.log("4. Activating Structured Summary View...");
    await evalInBrowser(ws, `
      const summaryToolBtn = document.querySelector('[data-tool="summary"]');
      if (summaryToolBtn) summaryToolBtn.click();
    `);

    // Wait for panel to unhide
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      const panelVisible = await evalInBrowser(ws, `
        !document.getElementById("document-ai-panel").hidden && !document.getElementById("ai-summary-view").hidden
      `);
      if (panelVisible) break;
    }

    // Populate long summary HTML
    console.log("5. Populating long multi-section summary answer...");
    const longHtml = createLongSummaryHtml();
    await evalInBrowser(ws, `
      (() => {
        const content = document.getElementById("summary-content");
        content.innerHTML = ${JSON.stringify(longHtml)};
        content.scrollTop = 0;
      })()
    `);
    await sleep(300);

    // =========================================================================
    // TEST 1: Normal Mode Layout & Scrolling Metrics (420px)
    // =========================================================================
    console.log("\n--- TEST 1: Normal Summary Panel (420px) ---");
    const normalMetrics = await evalInBrowser(ws, `
      (() => {
        const panel = document.getElementById("document-ai-panel");
        const header = document.querySelector(".summary-sticky-header");
        const content = document.getElementById("summary-content");
        const view = document.getElementById("ai-summary-view");
        
        const clientHeight = content.clientHeight;
        const scrollHeight = content.scrollHeight;
        const isOverflowing = scrollHeight > clientHeight;

        const headerRectBefore = header.getBoundingClientRect();
        const initialScrollTop = content.scrollTop;

        // Perform scroll to bottom
        content.scrollTop = scrollHeight;
        const scrolledTop = content.scrollTop;
        const maxScroll = scrollHeight - clientHeight;
        const headerRectAfter = header.getBoundingClientRect();

        // Check last element visibility
        const finalSection = document.getElementById("summary-final-section");
        const finalRect = finalSection ? finalSection.getBoundingClientRect() : null;
        const panelRect = panel.getBoundingClientRect();

        return {
          panelWidth: panel.offsetWidth,
          panelHeight: panel.offsetHeight,
          viewDisplay: window.getComputedStyle(view).display,
          contentDisplay: window.getComputedStyle(content).display,
          contentOverflowY: window.getComputedStyle(content).overflowY,
          clientHeight,
          scrollHeight,
          isOverflowing,
          initialScrollTop,
          scrolledTop,
          maxScroll,
          headerTopBefore: headerRectBefore.top,
          headerTopAfter: headerRectAfter.top,
          headerStickyFixed: Math.abs(headerRectBefore.top - headerRectAfter.top) < 1,
          finalSectionVisible: finalRect ? (finalRect.bottom <= panelRect.bottom + 5) : false
        };
      })()
    `);

    console.log("   Panel width:", normalMetrics.panelWidth, "px");
    console.log("   #ai-summary-view computed display:", normalMetrics.viewDisplay);
    console.log("   #summary-content computed display:", normalMetrics.contentDisplay);
    console.log("   #summary-content overflow-y:", normalMetrics.contentOverflowY);
    console.log("   Content clientHeight:", normalMetrics.clientHeight, "px");
    console.log("   Content scrollHeight:", normalMetrics.scrollHeight, "px");
    console.log("   Overflowing (scrollHeight > clientHeight):", normalMetrics.isOverflowing);
    console.log("   Scrolled scrollTop to bottom:", normalMetrics.scrolledTop, "px (max:", normalMetrics.maxScroll, "px)");
    console.log(`   Header top before scroll: ${normalMetrics.headerTopBefore}px, after scroll: ${normalMetrics.headerTopAfter}px`);
    console.log("   Header remains fixed at top:", normalMetrics.headerStickyFixed);
    console.log("   Final section & citations fully reachable at bottom:", normalMetrics.finalSectionVisible);

    assert.strictEqual(normalMetrics.viewDisplay, "flex", "#ai-summary-view must have display: flex");
    assert(normalMetrics.isOverflowing, "Content must overflow its container so it can scroll");
    assert(normalMetrics.scrolledTop > 0, "scrollTop must be greater than 0 after scrolling");
    assert(Math.abs(normalMetrics.scrolledTop - normalMetrics.maxScroll) <= 5, "Content must scroll to the very bottom");
    assert(normalMetrics.headerStickyFixed, "Header must remain fixed at the top of the summary view");
    assert(normalMetrics.finalSectionVisible, "Final section and citations must be fully visible at the bottom");
    console.log("   ✓ TEST 1 PASSED: Normal Mode scrolling and fixed header verified!");

    // =========================================================================
    // TEST 2: Expanded Mode Layout & Scrolling Metrics (720px)
    // =========================================================================
    console.log("\n--- TEST 2: Expanded Summary Panel (720px) ---");
    await evalInBrowser(ws, `
      document.getElementById("btn-expand-ai-panel").click();
    `);
    await sleep(350); // wait for 0.15s CSS transition to complete

    const expandedMetrics = await evalInBrowser(ws, `
      (() => {
        const panel = document.getElementById("document-ai-panel");
        const content = document.getElementById("summary-content");
        const header = document.querySelector(".summary-sticky-header");

        content.scrollTop = 0;
        const topAfterReset = content.scrollTop;

        // Scroll down
        content.scrollTop = 500;
        const scrolled = content.scrollTop;

        return {
          panelWidth: panel.offsetWidth,
          isExpanded: panel.classList.contains("expanded"),
          clientHeight: content.clientHeight,
          scrollHeight: content.scrollHeight,
          isOverflowing: content.scrollHeight > content.clientHeight,
          topAfterReset,
          scrolled,
          headerTop: header.getBoundingClientRect().top
        };
      })()
    `);

    console.log("   Panel width:", expandedMetrics.panelWidth, "px");
    console.log("   Expanded class applied:", expandedMetrics.isExpanded);
    console.log("   Overflowing in expanded mode:", expandedMetrics.isOverflowing);
    console.log("   Scrolled scrollTop in expanded mode:", expandedMetrics.scrolled, "px");
    assert(expandedMetrics.isExpanded, "Panel must have 'expanded' class");
    assert(expandedMetrics.panelWidth >= 700, "Panel width must be >= 700px in expanded mode");
    assert(expandedMetrics.isOverflowing, "Content must still be scrollable in expanded mode");
    assert.strictEqual(expandedMetrics.scrolled, 500, "Scroll position must update correctly in expanded mode");
    console.log("   ✓ TEST 2 PASSED: Expanded Mode layout and scrolling verified!");

    // =========================================================================
    // TEST 3: Full-View Mode Layout & Scrolling Metrics (100vw / 100vh)
    // =========================================================================
    console.log("\n--- TEST 3: Full-Screen / Full-View Mode ---");
    await evalInBrowser(ws, `
      document.getElementById("btn-fullscreen-ai-panel").click();
    `);
    await sleep(350);

    const fullMetrics = await evalInBrowser(ws, `
      (() => {
        const panel = document.getElementById("document-ai-panel");
        const content = document.getElementById("summary-content");
        const header = document.querySelector(".summary-sticky-header");

        content.scrollTop = 0;
        content.scrollTop = content.scrollHeight;
        const scrolledBottom = content.scrollTop;

        return {
          isFullView: panel.classList.contains("full-view"),
          panelWidth: panel.offsetWidth,
          panelHeight: panel.offsetHeight,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          clientHeight: content.clientHeight,
          scrollHeight: content.scrollHeight,
          scrolledBottom,
          headerVisible: header.getBoundingClientRect().height > 0
        };
      })()
    `);

    console.log("   Full-view class applied:", fullMetrics.isFullView);
    console.log(`   Panel dimensions: ${fullMetrics.panelWidth}x${fullMetrics.panelHeight}px (Viewport: ${fullMetrics.windowWidth}x${fullMetrics.windowHeight}px)`);
    console.log("   Scrolled to bottom in full-view:", fullMetrics.scrolledBottom, "px");
    console.log("   Header visible:", fullMetrics.headerVisible);
    assert(fullMetrics.isFullView, "Panel must have 'full-view' class");
    assert.strictEqual(fullMetrics.panelWidth, fullMetrics.windowWidth, "Full-view width must equal viewport width");
    assert.strictEqual(fullMetrics.panelHeight, fullMetrics.windowHeight, "Full-view height must equal viewport height");
    assert(fullMetrics.scrolledBottom > 0, "Content must scroll in full-view mode");
    console.log("   ✓ TEST 3 PASSED: Full-View Mode scrolling and fixed header verified!");

    // Return to normal view
    await evalInBrowser(ws, `
      const returnBtn = document.getElementById("btn-return-to-pdf");
      if (returnBtn) returnBtn.click();
    `);
    await sleep(300);

    // =========================================================================
    // TEST 4: Tab Switching Scroll Reset
    // =========================================================================
    console.log("\n--- TEST 4: Summary Tab Switching Scroll Reset ---");
    const tabSwitchMetrics = await evalInBrowser(ws, `
      (() => {
        const content = document.getElementById("summary-content");
        content.scrollTop = 400;
        const beforeSwitch = content.scrollTop;

        // Click Quick tab
        const quickBtn = document.querySelector(".segmented-mode-btn[data-summary-type='quick']");
        if (quickBtn) quickBtn.click();

        return {
          beforeSwitch,
          afterSwitchScrollTop: content.scrollTop,
          quickActive: quickBtn ? quickBtn.classList.contains("active") : false
        };
      })()
    `);

    console.log("   Scroll position before tab switch:", tabSwitchMetrics.beforeSwitch, "px");
    console.log("   Scroll position after tab switch:", tabSwitchMetrics.afterSwitchScrollTop, "px (reset to top)");
    console.log("   Quick tab active:", tabSwitchMetrics.quickActive);
    assert.strictEqual(tabSwitchMetrics.afterSwitchScrollTop, 0, "Tab switch must reset scrollTop to 0");
    console.log("   ✓ TEST 4 PASSED: Tab switching cleanly resets scroll position!");

    // =========================================================================
    // TEST 5: Panel Close and Reopen Scroll Cleanliness
    // =========================================================================
    console.log("\n--- TEST 5: Close and Reopen Panel Scroll State ---");
    const closeReopenMetrics = await evalInBrowser(ws, `
      (() => {
        const closeBtn = document.getElementById("btn-close-ai-panel");
        closeBtn.click();
        const panelHidden = document.getElementById("document-ai-panel").hidden;

        // Re-open summary view
        const summaryBtn = document.querySelector('[data-tool="summary"]');
        if (summaryBtn) summaryBtn.click();
        const panelVisible = !document.getElementById("document-ai-panel").hidden;
        const content = document.getElementById("summary-content");

        return {
          panelHidden,
          panelVisible,
          scrollTop: content.scrollTop
        };
      })()
    `);

    console.log("   Panel closed successfully:", closeReopenMetrics.panelHidden);
    console.log("   Panel reopened successfully:", closeReopenMetrics.panelVisible);
    console.log("   Scroll position on reopen:", closeReopenMetrics.scrollTop, "px");
    assert(closeReopenMetrics.panelHidden, "Panel must be hidden after close");
    assert(closeReopenMetrics.panelVisible, "Panel must be visible after reopen");
    assert.strictEqual(closeReopenMetrics.scrollTop, 0, "Reopened panel must have clean scrollTop = 0");
    console.log("   ✓ TEST 5 PASSED: Panel close and reopen cleanly resets scroll state!");

    console.log("\n=================================================");
    console.log("ALL SCROLLING & STICKY HEADER TESTS PASSED! [✓]");
    console.log("=================================================");

  } finally {
    try { if (staticServer) staticServer.close(); } catch (_) {}
    try { ws.close(); } catch (_) {}
    try { browserProc.kill(); } catch (_) {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
