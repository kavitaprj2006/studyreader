(function () {
  "use strict";

  const API_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:3000";

let currentUser = null;
let allPDFs = [];
let mySubjects = [];
let currentSubject = null;
let activeCategory = "all";

const urlParams = new URLSearchParams(window.location.search);
const paramSubjectId = urlParams.get("subjectId");
const paramClassroomId = urlParams.get("classroomId");

// ============================================================
// HELPERS
// ============================================================

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal && typeof modal.showModal === "function") {
    modal.showModal();
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal && typeof modal.close === "function") {
    modal.close();
  }
}

document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    closeModal(btn.getAttribute("data-close-modal"));
  });
});

// ============================================================
// AUTHENTICATION
// ============================================================

async function loadUser() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: "include" });
    if (!res.ok) {
      window.location.href = "../login/index.html";
      return false;
    }

    const data = await res.json();
    if (!data.user) {
      window.location.href = "../login/index.html";
      return false;
    }

    currentUser = data.user;
    document.getElementById("user-name").textContent = data.user.name;
    document.getElementById("user-avatar").textContent = data.user.name.charAt(0).toUpperCase();

    const roleBadge = document.getElementById("user-role-badge");
    if (roleBadge) {
      roleBadge.textContent = data.user.role === "teacher" ? "Teacher" : (data.user.role === "admin" ? "Admin" : "Student");
    }

    return true;
  } catch (err) {
    console.error("Auth error:", err);
    window.location.href = "../login/index.html";
    return false;
  }
}

// ============================================================
// LOAD SUBJECTS & LIBRARY DATA
// ============================================================

async function initLibrary() {
  const authenticated = await loadUser();
  if (!authenticated) return;

  await loadMySubjects();

  if (paramSubjectId) {
    await loadSubjectWorkspace(paramSubjectId);
  } else {
    await loadAllMaterials();
  }

  connectCategoryTabs();
  connectSearch();
  connectUploadForm();
}

async function loadMySubjects() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/subjects/my-subjects`, { credentials: "include" });
    if (!res.ok) return;

    const data = await res.json();
    mySubjects = data.subjects || [];

    // Populate Subject Filter in toolbar
    const filterSel = document.getElementById("library-subject-filter");
    if (filterSel) {
      filterSel.innerHTML = `<option value="all">All Subjects</option>` +
        mySubjects.map((s) => `<option value="${s.id}" ${paramSubjectId === String(s.id) ? "selected" : ""}>${escapeHTML(s.name)}${s.code ? ` (${escapeHTML(s.code)})` : ""}</option>`).join("");

      filterSel.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val === "all") {
          window.location.href = "index.html";
        } else {
          window.location.href = `index.html?subjectId=${val}`;
        }
      });
    }

    // Populate Upload modal select
    const uploadSel = document.getElementById("select-lib-subject");
    if (uploadSel) {
      uploadSel.innerHTML = `<option value="">General / No specific subject</option>` +
        mySubjects.map((s) => `<option value="${s.id}" ${paramSubjectId === String(s.id) ? "selected" : ""}>${escapeHTML(s.name)}${s.code ? ` (${escapeHTML(s.code)})` : ""}</option>`).join("");
    }

  } catch (err) {
    console.error("Load subjects error:", err);
  }
}

// ============================================================
// SUBJECT-SPECIFIC WORKSPACE
// ============================================================

async function loadSubjectWorkspace(subjectId) {
  const container = document.getElementById("library-container");
  container.innerHTML = `<div class="library-loading">Loading subject space...</div>`;

  try {
    const res = await fetch(`${API_BASE_URL}/api/subjects/${subjectId}`, { credentials: "include" });
    if (!res.ok) throw new Error("Could not load subject details.");

    const data = await res.json();
    currentSubject = data.subject;

    // Combine resources and pyqs into allPDFs
    allPDFs = [...(data.resources || []), ...(data.pyqs || [])];

    renderSubjectHeader(currentSubject, data.resources?.length || 0, data.pyqs?.length || 0);
    renderFilteredPDFs();

  } catch (err) {
    console.error("Subject workspace error:", err);
    container.innerHTML = `<div class="library-error">Unable to load this subject workspace. Please check your permissions or return to library.</div>`;
  }
}

function renderSubjectHeader(subject, resourceCount, pyqCount) {
  const defaultHeader = document.getElementById("default-library-header");
  const subjectContainer = document.getElementById("subject-header-container");

  if (defaultHeader) defaultHeader.style.display = "none";
  if (!subjectContainer) return;

  subjectContainer.style.display = "block";
  const isClassroom = !!subject.classroomName && subject.classroomName !== "Personal Space";
  const pillText = isClassroom ? `🏛 Classroom: ${subject.classroomName}` : "👤 Personal Subject Space";
  const codeBadge = subject.code ? ` · ${subject.code}` : "";
  const teacherText = isClassroom && subject.teacherName ? `Instructor: Prof. ${escapeHTML(subject.teacherName)}` : "Personal Workspace";

  subjectContainer.innerHTML = `
    <div class="subject-header-card">
      <div class="subject-header-top">
        <div>
          <span style="font-size: 11px; font-weight: 700; color: ${isClassroom ? '#2563eb' : '#a855f7'}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${escapeHTML(pillText)}
          </span>
          <h1 class="subject-header-title">${escapeHTML(subject.name)}${escapeHTML(codeBadge)}</h1>
          <div class="subject-header-meta">${escapeHTML(teacherText)} · ${escapeHTML(subject.description || "No description provided.")}</div>
        </div>
        <div>
          <button id="upload-pdf-subject" class="primary-button" style="background: var(--primary);">
            <span>+</span> Upload Material
          </button>
        </div>
      </div>

      <div class="subject-ai-tools">
        <button type="button" id="btn-ai-synthesize" class="ai-tool-btn primary">
          <span>✦</span>
          <span>Synthesize All Resources (${resourceCount})</span>
        </button>
        <button type="button" id="btn-ai-pyqs" class="ai-tool-btn secondary">
          <span>🎯</span>
          <span>PYQ Frequency & Pattern Analyzer (${pyqCount})</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById("upload-pdf-subject")?.addEventListener("click", () => {
    openModal("modal-library-upload");
  });

  // Attach AI buttons
  document.getElementById("btn-ai-synthesize")?.addEventListener("click", () => {
    runSubjectAiAnalysis("resources");
  });

  document.getElementById("btn-ai-pyqs")?.addEventListener("click", () => {
    runSubjectAiAnalysis("pyqs");
  });
}

// ============================================================
// SUBJECT-LEVEL AI RUNNERS & MARKDOWN RENDERER
// ============================================================

function formatMarkdown(text) {
  if (!text) return "";
  let html = String(text).replace(/\r\n/g, "\n");
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_, code) => `<pre style="background:#1e293b; color:#f8fafc; padding:12px; border-radius:8px; overflow-x:auto; font-family:monospace; font-size:13px; margin:10px 0;"><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, "<code style='background:#f1f5f9; padding:2px 6px; border-radius:4px; font-family:monospace; font-size:12.5px; color:#4338ca;'>$1</code>");
  html = html.replace(/^### (.*$)/gim, "<h4 style='margin:14px 0 6px; font-size:14px; font-weight:700; color:#0f172a;'>$1</h4>");
  html = html.replace(/^## (.*$)/gim, "<h3 style='margin:16px 0 8px; font-size:15px; font-weight:800; color:#0f172a;'>$1</h3>");
  html = html.replace(/^# (.*$)/gim, "<h2 style='margin:18px 0 10px; font-size:17px; font-weight:800; color:#0f172a;'>$1</h2>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/^>\s?(.*$)/gim, "<blockquote style='border-left:3px solid #6366f1; padding:6px 14px; margin:10px 0; background:#eef2ff; color:#3730a3; font-style:italic; border-radius:0 6px 6px 0;'>$1</blockquote>");

  const lines = html.split("\n");
  const processed = [];
  let inUl = false;
  lines.forEach(l => {
    const trimmed = l.trim();
    if (/^[-*•]\s+(.*)$/.test(trimmed)) {
      if (!inUl) { processed.push("<ul style='padding-left:20px; margin:8px 0;'>"); inUl = true; }
      processed.push(trimmed.replace(/^[-*•]\s+(.*)$/, "<li style='margin-bottom:4px;'>$1</li>"));
    } else {
      if (inUl) { processed.push("</ul>"); inUl = false; }
      if (trimmed.length > 0 && !trimmed.startsWith("<h") && !trimmed.startsWith("<pre") && !trimmed.startsWith("<blockquote") && !trimmed.startsWith("</")) {
        processed.push(`<p style='margin-bottom:8px;'>${trimmed}</p>`);
      } else {
        processed.push(trimmed);
      }
    }
  });
  if (inUl) processed.push("</ul>");
  return processed.join("\n");
}

function renderSubjectAiOutput(contentEl, rawMarkdown) {
  contentEl.innerHTML = formatMarkdown(rawMarkdown);

  const copyBar = document.createElement("div");
  copyBar.style.marginTop = "14px";
  copyBar.style.paddingTop = "10px";
  copyBar.style.borderTop = "1px solid #e2e8f0";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn-sm";
  copyBtn.style.cursor = "pointer";
  copyBtn.innerHTML = "<span>📋</span> Copy Analysis";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(rawMarkdown);
      copyBtn.innerHTML = "<span>✓</span> Copied!";
      setTimeout(() => { copyBtn.innerHTML = "<span>📋</span> Copy Analysis"; }, 2000);
    } catch (_) {}
  });

  copyBar.appendChild(copyBtn);
  contentEl.appendChild(copyBar);
}

async function runSubjectAiAnalysis(type) {
  if (!currentSubject) return;

  const panel = document.getElementById("subject-ai-panel");
  const title = document.getElementById("ai-panel-title");
  const content = document.getElementById("ai-panel-content");

  panel.style.display = "block";
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  if (type === "resources") {
    title.innerHTML = `<span>✦</span> <strong>Multi-Document Resource Synthesis — ${escapeHTML(currentSubject.name)}</strong>`;
    content.innerHTML = "<div style='color: #6366f1; padding: 12px 0;'>Analyzing all uploaded resources in this subject and synthesizing core concepts...</div>";

    try {
      const res = await fetch(`${API_BASE_URL}/api/subjects/${currentSubject.id}/ai/analyze-resources`, {
        method: "POST",
        credentials: "include"
      });
      const data = await res.json();
      if (!res.ok) {
        content.innerHTML = `<span style="color:#ef4444;">${escapeHTML(data.message || "Failed to analyze resources.")}</span>`;
        return;
      }
      renderSubjectAiOutput(content, data.answer || "No synthesis generated.");
    } catch (err) {
      console.error("Resource AI error:", err);
      content.innerHTML = "<span style='color:#ef4444;'>An error occurred during resource analysis.</span>";
    }
  } else {
    title.innerHTML = `<span>🎯</span> <strong>PYQ Frequency & Exam Pattern Analysis — ${escapeHTML(currentSubject.name)}</strong>`;
    content.innerHTML = "<div style='color: #6366f1; padding: 12px 0;'>Analyzing Previous Year Question papers for recurring topics and exam trends...</div>";

    try {
      const res = await fetch(`${API_BASE_URL}/api/subjects/${currentSubject.id}/ai/analyze-pyqs`, {
        method: "POST",
        credentials: "include"
      });
      const data = await res.json();
      if (!res.ok) {
        content.innerHTML = `<span style="color:#ef4444;">${escapeHTML(data.message || "Failed to analyze PYQs.")}</span>`;
        return;
      }
      renderSubjectAiOutput(content, data.answer || "No PYQ analysis generated.");
    } catch (err) {
      console.error("PYQ AI error:", err);
      content.innerHTML = "<span style='color:#ef4444;'>An error occurred during PYQ analysis.</span>";
    }
  }
}

document.getElementById("btn-close-ai")?.addEventListener("click", () => {
  document.getElementById("subject-ai-panel").style.display = "none";
});

// ============================================================
// ALL MATERIALS VIEW
// ============================================================

async function loadAllMaterials() {
  const container = document.getElementById("library-container");
  container.innerHTML = `<div class="library-loading">Loading your PDFs and study materials...</div>`;

  try {
    let url = `${API_BASE_URL}/api/pdfs`;
    if (paramClassroomId) {
      url += `?classroomId=${paramClassroomId}`;
    }

    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("Could not load PDFs.");

    const data = await res.json();
    allPDFs = data.pdfs || [];
    renderFilteredPDFs();

  } catch (err) {
    console.error("Load all materials error:", err);
    container.innerHTML = `<div class="library-error">Unable to load your documents. Please refresh and try again.</div>`;
  }
}

// ============================================================
// CATEGORY TABS & FILTERING
// ============================================================

function connectCategoryTabs() {
  const tabButtons = document.querySelectorAll(".cat-tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeCategory = btn.getAttribute("data-category");
      renderFilteredPDFs();
    });
  });
}

function renderFilteredPDFs() {
  const searchTerm = (document.getElementById("library-search")?.value || "").toLowerCase().trim();

  let filtered = allPDFs;

  // 1. Category filter
  if (activeCategory === "resource") {
    filtered = filtered.filter((p) => (p.category || "resource") === "resource");
  } else if (activeCategory === "pyq") {
    filtered = filtered.filter((p) => p.category === "pyq");
  }

  // 2. Search filter
  if (searchTerm) {
    filtered = filtered.filter((p) => {
      const name = (p.originalFilename || p.filename || "").toLowerCase();
      const subject = (p.subjectName || "").toLowerCase();
      const classroom = (p.classroomName || "").toLowerCase();
      return name.includes(searchTerm) || subject.includes(searchTerm) || classroom.includes(searchTerm);
    });
  }

  renderPDFCards(filtered);
}

function renderPDFCards(pdfs) {
  const container = document.getElementById("library-container");
  const countEl = document.getElementById("library-count");

  if (countEl) {
    countEl.textContent = `${pdfs.length} Document${pdfs.length === 1 ? "" : "s"}`;
  }

  if (pdfs.length === 0) {
    container.innerHTML = `
      <div class="library-empty">
        <div class="library-empty-icon">▤</div>
        <h2>No documents found</h2>
        <p>There are no materials in this view. Upload a resource or Previous Year Question paper to get started.</p>
        <br>
        <button type="button" class="primary-button" id="btn-empty-upload">
          <span>+</span> Upload Document
        </button>
      </div>
    `;
    document.getElementById("btn-empty-upload")?.addEventListener("click", () => {
      openModal("modal-library-upload");
    });
    return;
  }

  container.innerHTML = `
    <div class="library-grid">
      ${pdfs.map(renderPDFCard).join("")}
    </div>
  `;

  connectPDFCardEvents();
}

function renderPDFCard(pdf) {
  const name = pdf.originalFilename || pdf.filename || "Untitled Document";
  const safeName = escapeHTML(name);
  const isPyq = pdf.category === "pyq";
  const categoryLabel = isPyq ? `PYQ ${pdf.academicYear ? `(${escapeHTML(pdf.academicYear)})` : ""}` : "Resource";
  const pages = pdf.pageCount ? `${pdf.pageCount} pages` : "Pages n/a";

  const subjectBadge = pdf.subjectName ? `<span>▣ ${escapeHTML(pdf.subjectName)}</span>` : "";
  const classroomBadge = pdf.classroomName ? `<span>🏛 ${escapeHTML(pdf.classroomName)}</span>` : "";
  const uploaderText = pdf.uploadedBy && !pdf.uploadedBy.isMe ? `<span>By: ${escapeHTML(pdf.uploadedBy.name)}</span>` : "";

  return `
    <article class="library-card" data-pdf-id="${pdf.id}" title="Double-click to open study workspace">
      <div class="library-pdf-icon ${isPyq ? "pyq" : ""}">
        ${isPyq ? "🎯" : "▤"}
      </div>

      <div class="library-file-info">
        <strong class="library-file-name" title="${safeName}">
          ${safeName}
        </strong>

        <div class="library-file-meta">
          <span class="tag-category ${isPyq ? "pyq" : "resource"}">${categoryLabel}</span>
          ${subjectBadge}
          ${classroomBadge}
          ${uploaderText}
          <span>${formatFileSize(pdf.fileSize)}</span>
          <span>${pages}</span>
          <span>${formatDate(pdf.createdAt)}</span>
        </div>
      </div>

      <!-- THREE DOT MENU -->
      <div class="pdf-menu-wrapper">
        <button type="button" class="pdf-menu-button" aria-label="Options" data-menu-button>⋮</button>
        <div class="pdf-context-menu" data-pdf-menu style="display:none; position:absolute; right:0; top:calc(100% + 4px); background:#fff; border:1px solid var(--border); border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.1); z-index:100; min-width:160px; padding:6px;">
          <button type="button" class="pdf-menu-item" data-action="open" data-id="${pdf.id}" style="width:100%; text-align:left; background:none; border:none; padding:8px 12px; cursor:pointer; font-size:13px; border-radius:6px; display:flex; align-items:center; gap:8px;">
            <span>↗</span> <span>Open Document</span>
          </button>
          <button type="button" class="pdf-menu-item" data-action="read-aloud" data-id="${pdf.id}" style="width:100%; text-align:left; background:none; border:none; padding:8px 12px; cursor:pointer; font-size:13px; border-radius:6px; display:flex; align-items:center; gap:8px;">
            <span>🔊</span> <span>Read Aloud</span>
          </button>
          <button type="button" class="pdf-menu-item" data-action="ask-ai" data-id="${pdf.id}" style="width:100%; text-align:left; background:none; border:none; padding:8px 12px; cursor:pointer; font-size:13px; border-radius:6px; display:flex; align-items:center; gap:8px;">
            <span>✦</span> <span>Study with AI</span>
          </button>
          <hr style="border:0; border-top:1px solid var(--border); margin:4px 0;">
          <button type="button" class="pdf-menu-item delete-item" data-action="delete" data-id="${pdf.id}" style="width:100%; text-align:left; background:none; border:none; padding:8px 12px; cursor:pointer; font-size:13px; border-radius:6px; display:flex; align-items:center; gap:8px; color:#dc2626;">
            <span>⌫</span> <span>Delete</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function connectPDFCardEvents() {
  // Double-click or open action
  document.querySelectorAll(".library-card").forEach((card) => {
    card.addEventListener("dblclick", (e) => {
      if (e.target.closest(".pdf-menu-wrapper")) return;
      openDocumentWorkspace(card.dataset.pdfId);
    });

    const menuBtn = card.querySelector("[data-menu-button]");
    const menu = card.querySelector("[data-pdf-menu]");

    if (menuBtn && menu) {
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close all other menus
        document.querySelectorAll("[data-pdf-menu]").forEach((m) => {
          if (m !== menu) m.style.display = "none";
        });
        menu.style.display = menu.style.display === "block" ? "none" : "block";
      });
    }
  });

  // Close menus when clicking outside
  document.addEventListener("click", () => {
    document.querySelectorAll("[data-pdf-menu]").forEach((m) => {
      m.style.display = "none";
    });
  });

  // Action buttons inside menus
  document.querySelectorAll(".pdf-menu-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      const id = item.dataset.id;

      if (action === "open" || action === "read-aloud" || action === "ask-ai") {
        openDocumentWorkspace(id);
      } else if (action === "delete") {
        deleteDocument(id);
      }
    });
  });
}

function openDocumentWorkspace(pdfId) {
  window.location.href = `../pdf-study/index.html?id=${encodeURIComponent(pdfId)}`;
}

async function deleteDocument(pdfId) {
  if (!confirm("Are you sure you want to delete this document?")) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/pdfs/${pdfId}`, {
      method: "DELETE",
      credentials: "include"
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.message || "Failed to delete document.");
      return;
    }

    allPDFs = allPDFs.filter((p) => String(p.id) !== String(pdfId));
    renderFilteredPDFs();
  } catch (err) {
    console.error("Delete document error:", err);
    alert("An error occurred while deleting the document.");
  }
}

// ============================================================
// SEARCH & UPLOAD
// ============================================================

function connectSearch() {
  const searchInput = document.getElementById("library-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderFilteredPDFs();
    });
  }
}

function connectUploadForm() {
  document.getElementById("upload-pdf")?.addEventListener("click", () => {
    openModal("modal-library-upload");
  });

  const categorySelect = document.getElementById("select-lib-category");
  const yearGroup = document.getElementById("group-lib-academic-year");

  if (categorySelect && yearGroup) {
    categorySelect.addEventListener("change", (e) => {
      yearGroup.style.display = e.target.value === "pyq" ? "block" : "none";
    });
  }

  const uploadForm = document.getElementById("form-library-upload");
  if (uploadForm) {
    uploadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById("input-lib-file");
      const subjectId = document.getElementById("select-lib-subject").value;
      const category = document.getElementById("select-lib-category").value;
      const academicYear = document.getElementById("input-lib-academic-year").value.trim();

      if (!fileInput.files || fileInput.files.length === 0) {
        alert("Please select a file to upload.");
        return;
      }

      const formData = new FormData();
      formData.append("pdf", fileInput.files[0]);
      if (subjectId) formData.append("subjectId", subjectId);
      if (category) formData.append("category", category);
      if (academicYear) formData.append("academicYear", academicYear);

      const submitBtn = document.getElementById("btn-submit-lib-upload");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Uploading...";
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/pdfs/upload`, {
          method: "POST",
          credentials: "include",
          body: formData
        });

        const data = await res.json();

        if (res.status === 409 && data.duplicate) {
          if (window.StudyReaderDuplicateUpload) {
            window.StudyReaderDuplicateUpload.show({
              pendingUpload: data.pendingUpload,
              existingPdf: data.existingPdf,
              onSuccess: async () => {
                closeModal("modal-library-upload");
                uploadForm.reset();
                if (paramSubjectId) await loadSubjectWorkspace(paramSubjectId);
                else await loadAllMaterials();
              }
            });
          } else {
            alert("File already exists.");
          }
          return;
        }

        if (!res.ok) {
          alert(data.message || "Failed to upload document.");
          return;
        }

        closeModal("modal-library-upload");
        uploadForm.reset();
        if (paramSubjectId) await loadSubjectWorkspace(paramSubjectId);
        else await loadAllMaterials();

      } catch (err) {
        console.error("Upload error:", err);
        alert("An error occurred during upload.");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Upload & Save";
        }
      }
    });
  }
}

initLibrary();
})();
