(function () {
  "use strict";

  const API_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:3000";

let studentSubjects = [];
let studentClassrooms = [];
let studentMaterials = [];

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message, duration = 3500) {
  const toast = document.getElementById("toast-banner");
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, duration);
}

// ============================================================
// MODAL HELPERS
// ============================================================

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
    const targetId = btn.getAttribute("data-close-modal");
    closeModal(targetId);
  });
});

// ============================================================
// AUTHENTICATION & LOAD USER
// ============================================================

async function loadStudent() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      credentials: "include"
    });

    if (!response.ok) {
      window.location.href = "../login/index.html";
      return;
    }

    const data = await response.json();
    if (!data.user) {
      window.location.href = "../login/index.html";
      return;
    }

    // Role guard: teachers belong on teacher dashboard
    if (data.user.role === "teacher") {
      window.location.href = "../teacher-dashboard/index.html";
      return;
    }

    const welcomeEl = document.getElementById("welcome");
    if (welcomeEl) {
      welcomeEl.textContent = `Welcome back, ${data.user.name}`;
    }

    const userNameEl = document.getElementById("user-name");
    if (userNameEl) {
      userNameEl.textContent = data.user.name;
    }

    const userAvatarEl = document.getElementById("user-avatar");
    if (userAvatarEl) {
      userAvatarEl.textContent = data.user.name.charAt(0).toUpperCase();
    }

    await loadDashboardData();

  } catch (err) {
    console.error("Student auth check failed:", err);
    window.location.href = "../login/index.html";
  }
}

// ============================================================
// LOAD DASHBOARD DATA
// ============================================================

async function loadDashboardData() {
  try {
    const [subRes, classRes, pdfRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/subjects/my-subjects`, { credentials: "include" }),
      fetch(`${API_BASE_URL}/api/classrooms`, { credentials: "include" }),
      fetch(`${API_BASE_URL}/api/pdfs`, { credentials: "include" })
    ]);

    if (subRes.ok) {
      const subData = await subRes.json();
      studentSubjects = subData.subjects || [];
    }

    if (classRes.ok) {
      const classData = await classRes.json();
      studentClassrooms = classData.classrooms || [];
    }

    if (pdfRes.ok) {
      const pdfData = await pdfRes.json();
      studentMaterials = pdfData.pdfs || [];
    }

    // Stats calculations
    let totalResources = 0;
    let totalPYQs = 0;
    studentMaterials.forEach((m) => {
      if (m.category === "pyq") totalPYQs++;
      else totalResources++;
    });

    document.getElementById("subject-count").textContent = studentSubjects.length;
    document.getElementById("classroom-count").textContent = studentClassrooms.length;
    document.getElementById("resource-count").textContent = totalResources;
    document.getElementById("pyq-count").textContent = totalPYQs;

    // Render Subjects
    renderSubjectsGrid();

    // Render Enrolled Classrooms
    renderEnrolledClassroomsGrid();

    // Render Recent Materials
    renderRecentMaterials();

    // Populate Upload Subject Select
    populateUploadSelect();

  } catch (err) {
    console.error("Dashboard data load error:", err);
  }
}

// ============================================================
// RENDER SUBJECTS GRID (MATCHING FOLDER CARDS VISUAL DIRECTION)
// ============================================================

const FOLDER_COLORS = ["purple", "blue", "green", "orange", "pink"];

function renderSubjectsGrid() {
  const emptyState = document.getElementById("subjects-empty-state");
  const grid = document.getElementById("subjects-grid");

  if (studentSubjects.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    if (grid) grid.style.display = "none";
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (!grid) return;

  grid.style.display = "grid";
  grid.innerHTML = studentSubjects.map((s, idx) => {
    const isClassroom = s.subjectType === "classroom";
    const pillClass = isClassroom ? "classroom" : "personal";
    const pillText = isClassroom ? (s.classroomName || "Classroom") : "Personal Space";
    const codeBadge = s.code ? ` (${escapeHTML(s.code)})` : "";
    const teacherMeta = isClassroom && s.teacherName ? `Prof. ${escapeHTML(s.teacherName)}` : "Personal Space";
    const color = FOLDER_COLORS[idx % FOLDER_COLORS.length];

    return `
      <article class="subject-card" onclick="window.location.href='../library/index.html?subjectId=${s.id}'">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
          <div class="subject-folder-icon ${color}">
            📁
          </div>
          <span class="subject-pill ${pillClass}">
            ${isClassroom ? "🏛" : "👤"} ${escapeHTML(pillText)}
          </span>
        </div>

        <div>
          <h3 class="subject-title">${escapeHTML(s.name)}${codeBadge}</h3>
          <div class="subject-meta">${escapeHTML(teacherMeta)}</div>
        </div>

        <div class="subject-stats-bar">
          <div class="subject-counts">
            <span>📄 ${s.resourceCount || 0} Resources</span>
            <span>•</span>
            <span>📑 ${s.pyqCount || 0} PYQs</span>
          </div>
          <span class="subject-action-link">Open →</span>
        </div>
      </article>
    `;
  }).join("");
}

// ============================================================
// RENDER ENROLLED CLASSROOMS GRID
// ============================================================

function renderEnrolledClassroomsGrid() {
  const emptyState = document.getElementById("classrooms-empty-state");
  const grid = document.getElementById("enrolled-classrooms-grid");

  if (!studentClassrooms || studentClassrooms.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    if (grid) grid.style.display = "none";
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (!grid) return;

  grid.style.display = "grid";
  grid.innerHTML = studentClassrooms.map((c) => {
    const semInfo = [
      c.semester ? `Semester ${c.semester}` : "",
      c.section ? `Section ${c.section}` : ""
    ].filter(Boolean).join(" · ");

    return `
      <article class="subject-card" style="cursor: default;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
          <div class="folder-icon-wrapper blue">
            🏛
          </div>
          <span class="subject-pill classroom">
            ${escapeHTML(c.code)}
          </span>
        </div>

        <div style="margin-top: 8px;">
          <h3 class="subject-title" style="margin: 0 0 4px 0;">${escapeHTML(c.name)}</h3>
          <p class="subject-teacher" style="margin: 0; font-size: 12px; color: var(--text-secondary);">
            ${c.teacherName ? `Instructor: Prof. ${escapeHTML(c.teacherName)}` : "Classroom Group"}
          </p>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
            ${escapeHTML(semInfo || "General Section")}
          </div>
        </div>

        <div class="subject-stats" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-light, #f1f5f9);">
          <span>${c.subjectCount || 0} Subjects</span>
          <span>·</span>
          <span>${c.resourceCount || 0} Materials</span>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button type="button" class="btn-sm primary-button" style="flex: 1; padding: 6px 10px; font-size: 12px; background: #2563eb; color: #fff;" onclick="window.location.href='../library/index.html?classroomId=${c.id}'">
            Open Space →
          </button>
          <button type="button" class="btn-sm secondary-button btn-leave-classroom" data-class-id="${c.id}" data-class-name="${escapeHTML(c.name)}" style="padding: 6px 10px; font-size: 12px; color: #dc2626; border-color: #fecaca; background: #fef2f2; cursor: pointer;">
            Leave
          </button>
        </div>
      </article>
    `;
  }).join("");

  // Attach Leave button handlers
  grid.querySelectorAll(".btn-leave-classroom").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const classId = btn.getAttribute("data-class-id");
      const className = btn.getAttribute("data-class-name");

      const targetIdInput = document.getElementById("leave-classroom-target-id");
      const targetNameEl = document.getElementById("leave-classroom-target-name");
      if (targetIdInput) targetIdInput.value = classId;
      if (targetNameEl) targetNameEl.textContent = `"${className}"`;
      openModal("modal-leave-classroom-confirm");
    });
  });
}

// ============================================================
// RENDER RECENT MATERIALS
// ============================================================

function renderRecentMaterials() {
  const emptyState = document.getElementById("recent-empty-state");
  const list = document.getElementById("recent-materials-list");

  if (studentMaterials.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    if (list) list.style.display = "none";
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (!list) return;

  list.style.display = "flex";
  list.innerHTML = studentMaterials.slice(0, 5).map((m) => {
    const isPyq = m.category === "pyq";
    const tagBg = isPyq ? "#fff5e7" : "#eff6ff";
    const tagColor = isPyq ? "#e39a3b" : "#2563eb";
    const tagText = isPyq ? `PYQ ${m.academicYear ? `(${m.academicYear})` : ""}` : "Resource";

    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: #ffffff; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; transition: background 0.15s ease;"
           onclick="window.location.href='../pdf-study/index.html?id=${m.id}'">
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
          <div style="width: 36px; height: 36px; border-radius: 8px; background: var(--surface-soft); display: flex; align-items: center; justify-content: center; font-size: 16px;">
            ${isPyq ? "📄" : "▤"}
          </div>
          <div style="min-width: 0;">
            <strong style="display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHTML(m.originalFilename || m.filename)}
            </strong>
            <span style="font-size: 11px; color: var(--text-secondary);">
              ${m.subjectName ? `${escapeHTML(m.subjectName)} · ` : ""}${m.classroomName ? `${escapeHTML(m.classroomName)} · ` : ""}Added ${formatDate(m.createdAt)}
            </span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <span style="background: ${tagBg}; color: ${tagColor}; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">
            ${tagText}
          </span>
          <span style="color: var(--primary); font-size: 13px;">↗</span>
        </div>
      </div>
    `;
  }).join("");
}

function populateUploadSelect() {
  const sel = document.getElementById("select-student-subject");
  if (!sel) return;

  if (studentSubjects.length === 0) {
    sel.innerHTML = "<option value=''>General / No subject</option>";
    return;
  }

  sel.innerHTML = "<option value=''>General / No specific subject</option>" +
    studentSubjects.map((s) => `<option value="${s.id}">${escapeHTML(s.name)}${s.code ? ` (${escapeHTML(s.code)})` : ""}</option>`).join("");
}

// ============================================================
// JOIN CLASSROOM FORM
// ============================================================

const joinClassForm = document.getElementById("form-join-classroom");
if (joinClassForm) {
  joinClassForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("input-join-code").value.trim().toUpperCase();
    if (!code) return;

    const btn = document.getElementById("btn-submit-join");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Joining...";
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/classrooms/join`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "Failed to join classroom.");
        return;
      }

      closeModal("modal-join-classroom");
      joinClassForm.reset();
      showToast(data.message || "Joined classroom successfully!");
      await loadDashboardData();

    } catch (err) {
      console.error("Join classroom error:", err);
      alert("An error occurred while joining the classroom.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Join Classroom";
      }
    }
  });
}

// ============================================================
// CREATE PERSONAL SUBJECT FORM
// ============================================================

const createSubjectForm = document.getElementById("form-create-subject");
if (createSubjectForm) {
  createSubjectForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("input-pers-subject-name").value.trim();
    const code = document.getElementById("input-pers-subject-code").value.trim();
    const description = document.getElementById("input-pers-subject-desc").value.trim();

    if (!name) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/subjects/personal`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, description })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "Failed to create personal subject.");
        return;
      }

      closeModal("modal-create-subject");
      createSubjectForm.reset();
      showToast(`Subject '${data.subject.name}' created!`);
      await loadDashboardData();

    } catch (err) {
      console.error("Create personal subject error:", err);
      alert("An error occurred while creating the subject.");
    }
  });
}

// ============================================================
// UPLOAD PERSONAL DOCUMENT FORM
// ============================================================

const uploadStudentDocForm = document.getElementById("form-upload-student-doc");
if (uploadStudentDocForm) {
  uploadStudentDocForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const subjectId = document.getElementById("select-student-subject").value;
    const category = document.getElementById("select-student-category").value;
    const fileInput = document.getElementById("input-student-file");

    if (!fileInput.files || fileInput.files.length === 0) {
      alert("Please select a file.");
      return;
    }

    const formData = new FormData();
    formData.append("pdf", fileInput.files[0]);
    if (subjectId) formData.append("subjectId", subjectId);
    if (category) formData.append("category", category);

    const btn = document.getElementById("btn-submit-student-upload");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Uploading...";
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
              closeModal("modal-upload-student-doc");
              uploadStudentDocForm.reset();
              showToast("Uploaded successfully!");
              await loadDashboardData();
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

      closeModal("modal-upload-student-doc");
      uploadStudentDocForm.reset();
      showToast(`Uploaded '${data.pdf.originalFilename}'!`);
      await loadDashboardData();

    } catch (err) {
      console.error("Upload error:", err);
      alert("An error occurred while uploading.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Upload";
      }
    }
  });
}

// ============================================================
// BUTTON ATTACHMENTS
// ============================================================

const joinButtons = document.querySelectorAll(
  "#btn-join-classroom, #btn-quick-join, #btn-empty-join, #quick-join-class, #btn-header-join-class, #btn-empty-join-classroom"
);
joinButtons.forEach((btn) => {
  btn.addEventListener("click", () => openModal("modal-join-classroom"));
});

const addSubjectButtons = document.querySelectorAll("#btn-add-subject, #btn-empty-subject, #quick-add-subject");
addSubjectButtons.forEach((btn) => {
  btn.addEventListener("click", () => openModal("modal-create-subject"));
});

const uploadDocButtons = document.querySelectorAll("#quick-upload-doc");
uploadDocButtons.forEach((btn) => {
  btn.addEventListener("click", () => openModal("modal-upload-student-doc"));
});

// ============================================================
// LEAVE CLASSROOM MODAL HANDLERS
// ============================================================

const confirmLeaveBtn = document.getElementById("btn-confirm-leave");
if (confirmLeaveBtn) {
  confirmLeaveBtn.addEventListener("click", async () => {
    const classId = document.getElementById("leave-classroom-target-id").value;
    if (!classId) return;

    confirmLeaveBtn.disabled = true;
    confirmLeaveBtn.textContent = "Leaving...";

    try {
      const res = await fetch(`${API_BASE_URL}/api/classrooms/${encodeURIComponent(classId)}/leave`, {
        method: "POST",
        credentials: "include"
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to leave classroom.");
      }

      closeModal("modal-leave-classroom-confirm");
      showToast(data.message || "Successfully left the classroom.");
      await loadDashboardData();

    } catch (err) {
      console.error("Leave classroom error:", err);
      alert(err.message || "An error occurred while leaving the classroom.");
    } finally {
      confirmLeaveBtn.disabled = false;
      confirmLeaveBtn.textContent = "Leave Classroom";
    }
  });
}

const cancelLeaveBtn = document.getElementById("btn-cancel-leave");
if (cancelLeaveBtn) {
  cancelLeaveBtn.addEventListener("click", () => {
    closeModal("modal-leave-classroom-confirm");
  });
}

// Helper functions
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatDate(val) {
  if (!val) return "—";
  const d = new Date(val);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

loadStudent();
})();
