(function () {
  "use strict";

  const API_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:3000";

let teacherClassrooms = [];

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
// LOAD TEACHER USER & VERIFY ROLE
// ============================================================

async function loadTeacher() {
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

    if (data.user.role !== "teacher" && data.user.role !== "admin") {
      console.warn("Non-teacher user redirected to student dashboard.");
      window.location.href = "../dashboard/index.html";
      return;
    }

    const welcomeEl = document.getElementById("welcome");
    if (welcomeEl) {
      welcomeEl.textContent = `Welcome, Prof. ${data.user.name}`;
    }

    const userNameEl = document.getElementById("user-name");
    if (userNameEl) {
      userNameEl.textContent = data.user.name;
    }

    const userAvatarEl = document.getElementById("user-avatar");
    if (userAvatarEl) {
      userAvatarEl.textContent = data.user.name.charAt(0).toUpperCase();
    }

    await loadClassrooms();
    initClassroomNavigation();
    handleViewRouting();

  } catch (error) {
    console.error("Teacher authentication check failed:", error);
    window.location.href = "../login/index.html";
  }
}

// ============================================================
// LOAD & RENDER CLASSROOMS
// ============================================================

async function loadClassrooms() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/classrooms`, {
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error("Unable to fetch classrooms.");
    }

    const data = await response.json();
    teacherClassrooms = data.classrooms || [];

    // Calculate aggregated stats
    let totalSubjects = 0;
    let totalStudents = 0;
    let totalResources = 0;

    teacherClassrooms.forEach((c) => {
      totalSubjects += (c.subjectCount || 0);
      totalStudents += (c.studentCount || 0);
      totalResources += (c.resourceCount || 0);
    });

    document.getElementById("classroom-count").textContent = teacherClassrooms.length;
    document.getElementById("subject-count").textContent = totalSubjects;
    document.getElementById("student-count").textContent = totalStudents;
    document.getElementById("resource-count").textContent = totalResources;

    const emptyState = document.getElementById("classrooms-empty-state");
    const classroomsList = document.getElementById("classrooms-list");

    if (teacherClassrooms.length === 0) {
      if (emptyState) emptyState.style.display = "block";
      if (classroomsList) classroomsList.style.display = "none";
      return;
    }

    if (emptyState) emptyState.style.display = "none";
    if (classroomsList) {
      classroomsList.style.display = "flex";
      renderClassroomsList(teacherClassrooms);
    }

    populateClassroomSelects();

  } catch (error) {
    console.error("Error loading classrooms:", error);
  }
}

function renderClassroomsList(classrooms) {
  const container = document.getElementById("classrooms-list");
  if (!container) return;

  container.innerHTML = classrooms.map((c) => {
    const semInfo = [
      c.semester ? `Semester ${c.semester}` : "",
      c.section ? `Section ${c.section}` : ""
    ].filter(Boolean).join(" · ");

    return `
      <article class="classroom-card" data-id="${c.id}">
        <div class="classroom-card-header">
          <div>
            <h3 class="classroom-card-title">${escapeHTML(c.name)}</h3>
            <div class="classroom-card-meta">${escapeHTML(semInfo || "General Section")}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="classroom-code-pill" data-copy-code="${escapeHTML(c.code)}" title="Click to copy join code">
              <span>Code: ${escapeHTML(c.code)}</span>
              <span class="copy-icon">📋</span>
            </button>

            <!-- 3-DOT CONTEXT MENU -->
            <div class="classroom-menu-wrapper">
              <button type="button" class="btn-classroom-menu-toggle" data-menu-target="menu-${c.id}" aria-label="Classroom options" title="More options">
                ⋮
              </button>
              <div id="menu-${c.id}" class="classroom-menu-dropdown">
                <button type="button" class="classroom-menu-item btn-add-subject" data-class-id="${c.id}">
                  <span>➕</span> Add Subject
                </button>
                <button type="button" class="classroom-menu-item btn-upload-mat" data-class-id="${c.id}">
                  <span>📤</span> Upload Material
                </button>
                <button type="button" class="classroom-menu-item btn-view-roster" data-class-id="${c.id}" data-class-name="${escapeHTML(c.name)}" data-class-code="${escapeHTML(c.code)}">
                  <span>👥</span> View Roster
                </button>
                <button type="button" class="classroom-menu-item btn-rename-classroom" data-class-id="${c.id}" data-class-name="${escapeHTML(c.name)}">
                  <span>✏️</span> Rename Classroom
                </button>
                <div class="classroom-menu-divider"></div>
                <button type="button" class="classroom-menu-item danger-item btn-delete-classroom" data-class-id="${c.id}" data-class-name="${escapeHTML(c.name)}">
                  <span>🗑️</span> Delete Classroom
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="classroom-stats-row">
          <div class="classroom-stat-item">
            <span>👥</span>
            <span>${c.studentCount} Students</span>
          </div>
          <div class="classroom-stat-item">
            <span>▣</span>
            <span>${c.subjectCount} Subjects</span>
          </div>
          <div class="classroom-stat-item">
            <span>▤</span>
            <span>${c.resourceCount} Materials</span>
          </div>
        </div>

        <div class="classroom-actions-row" style="margin-top: 14px;">
          <button type="button" class="btn-sm primary-button" style="background: #2563eb; color: #fff; width: 100%; justify-content: center; padding: 9px 16px; font-weight: 600; font-size: 13px;" onclick="window.location.href='../library/index.html?classroomId=${c.id}'">
            Open Space →
          </button>
        </div>
      </article>
    `;
  }).join("");

  connectClassroomCardActions();
}

function connectClassroomCardActions() {
  // 1. Copy code buttons
  document.querySelectorAll("[data-copy-code]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-copy-code");
      navigator.clipboard.writeText(code).then(() => {
        showToast(`Classroom Code '${code}' copied to clipboard! Share with your students.`);
      }).catch(() => {
        prompt("Classroom Join Code (copy manually):", code);
      });
    });
  });

  // 2. Add subject buttons
  document.querySelectorAll(".btn-add-subject").forEach((btn) => {
    btn.addEventListener("click", () => {
      const classId = btn.getAttribute("data-class-id");
      const sel = document.getElementById("select-subject-classroom");
      if (sel) sel.value = classId;
      openModal("modal-add-subject");
    });
  });

  // 3. Upload material buttons
  document.querySelectorAll(".btn-upload-mat").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const classId = btn.getAttribute("data-class-id");
      const sel = document.getElementById("select-upload-classroom");
      if (sel) {
        sel.value = classId;
        await loadSubjectsForUpload(classId);
      }
      openModal("modal-upload-resource");
    });
  });

  // 4. View roster buttons
  document.querySelectorAll(".btn-view-roster").forEach((btn) => {
    btn.addEventListener("click", () => {
      const classId = btn.getAttribute("data-class-id");
      const className = btn.getAttribute("data-class-name");
      const classCode = btn.getAttribute("data-class-code");
      openRosterModal(classId, className, classCode);
    });
  });

  // 5. Rename classroom buttons
  document.querySelectorAll(".btn-rename-classroom").forEach((btn) => {
    btn.addEventListener("click", () => {
      const classId = btn.getAttribute("data-class-id");
      const className = btn.getAttribute("data-class-name");
      const idInput = document.getElementById("input-rename-class-id");
      const nameInput = document.getElementById("input-rename-class-name");
      if (idInput) idInput.value = classId;
      if (nameInput) {
        nameInput.value = className;
        setTimeout(() => nameInput.focus(), 100);
      }
      openModal("modal-rename-classroom");
    });
  });

  // 6. Delete classroom buttons
  document.querySelectorAll(".btn-delete-classroom").forEach((btn) => {
    btn.addEventListener("click", () => {
      const classId = btn.getAttribute("data-class-id");
      const className = btn.getAttribute("data-class-name");
      const idInput = document.getElementById("delete-classroom-target-id");
      const nameEl = document.getElementById("delete-classroom-target-name");
      if (idInput) idInput.value = classId;
      if (nameEl) nameEl.textContent = `"${className}"`;
      openModal("modal-delete-classroom-confirm");
    });
  });

  // 7. 3-dot menu toggle
  document.querySelectorAll(".btn-classroom-menu-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute("data-menu-target");
      const dropdown = document.getElementById(targetId);

      // Close other open menus
      document.querySelectorAll(".classroom-menu-dropdown.show").forEach((d) => {
        if (d !== dropdown) d.classList.remove("show");
      });

      if (dropdown) {
        dropdown.classList.toggle("show");
      }
    });
  });

  // Close dropdown menu when clicking any menu action
  document.querySelectorAll(".classroom-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".classroom-menu-dropdown.show").forEach((d) => {
        d.classList.remove("show");
      });
    });
  });
}

// Global click to close 3-dot menus
document.addEventListener("click", () => {
  document.querySelectorAll(".classroom-menu-dropdown.show").forEach((d) => {
    d.classList.remove("show");
  });
});

function populateClassroomSelects() {
  const subjectClassSel = document.getElementById("select-subject-classroom");
  const uploadClassSel = document.getElementById("select-upload-classroom");

  const options = teacherClassrooms.map((c) =>
    `<option value="${c.id}">${escapeHTML(c.name)} (${escapeHTML(c.code)})</option>`
  ).join("");

  if (subjectClassSel) subjectClassSel.innerHTML = options;
  if (uploadClassSel) {
    uploadClassSel.innerHTML = options;
    if (teacherClassrooms.length > 0) {
      loadSubjectsForUpload(teacherClassrooms[0].id);
    }
  }
}

async function loadSubjectsForUpload(classroomId) {
  const subjectSel = document.getElementById("select-upload-subject");
  if (!subjectSel || !classroomId) return;

  subjectSel.innerHTML = "<option>Loading subjects...</option>";

  try {
    const res = await fetch(`${API_BASE_URL}/api/classrooms/${classroomId}`, {
      credentials: "include"
    });
    if (!res.ok) throw new Error("Could not load classroom subjects.");

    const data = await res.json();
    const subjects = data.subjects || [];

    if (subjects.length === 0) {
      subjectSel.innerHTML = "<option value=''>No subjects in this classroom yet (create one first)</option>";
      return;
    }

    subjectSel.innerHTML = subjects.map((s) =>
      `<option value="${s.id}">${escapeHTML(s.name)}${s.code ? ` (${escapeHTML(s.code)})` : ""}</option>`
    ).join("");
  } catch (err) {
    console.error("Error loading subjects for upload:", err);
    subjectSel.innerHTML = "<option value=''>Failed to load subjects</option>";
  }
}

// When classroom selection changes in upload modal:
const uploadClassSelect = document.getElementById("select-upload-classroom");
if (uploadClassSelect) {
  uploadClassSelect.addEventListener("change", (e) => {
    loadSubjectsForUpload(e.target.value);
  });
}

// ============================================================
// CREATE CLASSROOM FORM
// ============================================================

const createClassForm = document.getElementById("form-create-classroom");
if (createClassForm) {
  createClassForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("input-class-name").value.trim();
    const semester = document.getElementById("input-class-semester").value.trim();
    const section = document.getElementById("input-class-section").value.trim();
    const description = document.getElementById("input-class-desc").value.trim();

    if (!name) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/classrooms`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, semester, section, description })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "Failed to create classroom.");
        return;
      }

      closeModal("modal-create-classroom");
      createClassForm.reset();
      showToast(`Classroom created! Share code: ${data.classroom.code}`);
      await loadClassrooms();

    } catch (err) {
      console.error("Create classroom error:", err);
      alert("An error occurred while creating the classroom.");
    }
  });
}

// ============================================================
// RENAME CLASSROOM FORM
// ============================================================

const renameClassForm = document.getElementById("form-rename-classroom");
if (renameClassForm) {
  renameClassForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("input-rename-class-id").value;
    const name = document.getElementById("input-rename-class-name").value.trim();

    if (!name || name.length < 2) {
      alert("Classroom name must be at least 2 characters long.");
      return;
    }

    const btn = document.getElementById("btn-submit-rename-classroom");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/classrooms/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to rename classroom.");
      }

      closeModal("modal-rename-classroom");
      showToast(data.message || "Classroom renamed successfully!");
      await loadClassrooms();

    } catch (err) {
      console.error("Rename classroom error:", err);
      alert(err.message || "An error occurred while renaming the classroom.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Save Changes";
      }
    }
  });
}

// ============================================================
// DELETE CLASSROOM CONFIRMATION HANDLERS
// ============================================================

const confirmDeleteClassBtn = document.getElementById("btn-confirm-delete-classroom");
if (confirmDeleteClassBtn) {
  confirmDeleteClassBtn.addEventListener("click", async () => {
    const classId = document.getElementById("delete-classroom-target-id")?.value;
    if (!classId) return;

    confirmDeleteClassBtn.disabled = true;
    confirmDeleteClassBtn.textContent = "Deleting...";

    try {
      const res = await fetch(`${API_BASE_URL}/api/classrooms/${encodeURIComponent(classId)}`, {
        method: "DELETE",
        credentials: "include"
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to delete classroom.");
      }

      closeModal("modal-delete-classroom-confirm");
      showToast(data.message || "Classroom deleted successfully!");
      await loadClassrooms();

    } catch (err) {
      console.error("Delete classroom error:", err);
      alert(err.message || "An error occurred while deleting the classroom.");
    } finally {
      confirmDeleteClassBtn.disabled = false;
      confirmDeleteClassBtn.textContent = "Delete Classroom";
    }
  });
}

const cancelDeleteClassBtn = document.getElementById("btn-cancel-delete-classroom");
if (cancelDeleteClassBtn) {
  cancelDeleteClassBtn.addEventListener("click", () => {
    closeModal("modal-delete-classroom-confirm");
  });
}

// ============================================================
// ADD SUBJECT FORM
// ============================================================

const addSubjectForm = document.getElementById("form-add-subject");
if (addSubjectForm) {
  addSubjectForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const classroomId = document.getElementById("select-subject-classroom").value;
    const name = document.getElementById("input-subject-name").value.trim();
    const code = document.getElementById("input-subject-code").value.trim();
    const description = document.getElementById("input-subject-desc").value.trim();

    if (!classroomId || !name) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/classrooms/${classroomId}/subjects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, description })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "Failed to add subject.");
        return;
      }

      closeModal("modal-add-subject");
      addSubjectForm.reset();
      showToast(`Subject '${data.subject.name}' added to classroom!`);
      await loadClassrooms();

    } catch (err) {
      console.error("Add subject error:", err);
      alert("An error occurred while adding the subject.");
    }
  });
}

// ============================================================
// UPLOAD RESOURCE FORM
// ============================================================

const uploadResourceForm = document.getElementById("form-upload-resource");
if (uploadResourceForm) {
  uploadResourceForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const classroomId = document.getElementById("select-upload-classroom").value;
    const subjectId = document.getElementById("select-upload-subject").value;
    const category = document.getElementById("select-upload-category").value;
    const academicYear = document.getElementById("input-upload-year")?.value?.trim() || "";
    const fileInput = document.getElementById("input-upload-file");

    if (!fileInput.files || fileInput.files.length === 0) {
      alert("Please select a file to upload.");
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("pdf", file);
    if (classroomId) formData.append("classroomId", classroomId);
    if (subjectId) formData.append("subjectId", subjectId);
    if (category) formData.append("category", category);
    if (academicYear) formData.append("academicYear", academicYear);

    const submitBtn = document.getElementById("btn-submit-upload");
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
              closeModal("modal-upload-resource");
              uploadResourceForm.reset();
              showToast("Resource replaced / kept successfully!");
              await loadClassrooms();
            },
            onCancel: () => {
              console.log("Duplicate upload canceled.");
            }
          });
        } else {
          alert("A file with this name already exists.");
        }
        return;
      }

      if (!res.ok) {
        alert(data.message || "Failed to upload file.");
        return;
      }

      closeModal("modal-upload-resource");
      uploadResourceForm.reset();
      showToast(`Published '${data.pdf.originalFilename}' successfully!`);
      await loadClassrooms();

    } catch (err) {
      console.error("Upload error:", err);
      alert("An error occurred during file upload.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Upload & Publish";
      }
    }
  });
}

// ============================================================
// ROSTER MODAL
// ============================================================

async function openRosterModal(classroomId, className, classCode) {
  const nameEl = document.getElementById("roster-class-name");
  const codeEl = document.getElementById("roster-class-code");
  const rosterTable = document.getElementById("roster-table");
  const rosterEmpty = document.getElementById("roster-empty");
  const tbody = document.getElementById("roster-students-list");

  if (nameEl) nameEl.textContent = `${className || "Classroom"} — Enrolled Students`;
  if (codeEl) codeEl.textContent = classCode ? `Classroom Code: ${classCode}` : "";

  // Reset visibility to loading state
  if (rosterEmpty) rosterEmpty.style.display = "none";
  if (rosterTable) rosterTable.style.display = "table";
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 24px;">Loading enrolled students...</td></tr>`;
  }

  openModal("modal-roster");

  try {
    const res = await fetch(`${API_BASE_URL}/api/classrooms/${encodeURIComponent(classroomId)}`, {
      credentials: "include"
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || "Could not load roster.");
    }

    const data = await res.json();
    const students = data.students || [];

    if (students.length === 0) {
      if (rosterTable) rosterTable.style.display = "none";
      if (rosterEmpty) {
        rosterEmpty.style.display = "block";
        rosterEmpty.innerHTML = `<p>No students have joined this classroom yet. Share the code <strong>${escapeHTML(classCode)}</strong> to invite students!</p>`;
      }
      return;
    }

    if (rosterEmpty) rosterEmpty.style.display = "none";
    if (rosterTable) rosterTable.style.display = "table";
    if (tbody) {
      tbody.innerHTML = students.map((s) => `
        <tr>
          <td><strong>${escapeHTML(s.name)}</strong></td>
          <td style="color: var(--text-secondary);">${escapeHTML(s.email)}</td>
          <td style="color: var(--text-light);">${formatDate(s.joinedAt)}</td>
          <td style="text-align: right;">
            <button type="button" class="btn-remove-student" data-student-id="${s.id}" data-student-name="${escapeHTML(s.name)}" style="color: #dc2626; border: 1px solid #fecaca; background: #fff; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;">
              Remove
            </button>
          </td>
        </tr>
      `).join("");

      tbody.querySelectorAll(".btn-remove-student").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const studentId = btn.getAttribute("data-student-id");
          const studentName = btn.getAttribute("data-student-name");
          if (!confirm(`Are you sure you want to remove ${studentName} from this classroom?`)) return;

          try {
            btn.disabled = true;
            btn.textContent = "...";
            const delRes = await fetch(`${API_BASE_URL}/api/classrooms/${encodeURIComponent(classroomId)}/members/${encodeURIComponent(studentId)}`, {
              method: "DELETE",
              credentials: "include"
            });
            const delData = await delRes.json();
            if (!delRes.ok) throw new Error(delData.message || "Failed to remove student.");
            showToast(`${studentName} removed from classroom.`);
            await openRosterModal(classroomId, className, classCode);
            await loadClassrooms();
          } catch (removeErr) {
            alert(removeErr.message);
            btn.disabled = false;
            btn.textContent = "Remove";
          }
        });
      });
    }

    const renewBtn = document.getElementById("btn-renew-code");
    if (renewBtn) {
      renewBtn.onclick = async () => {
        if (!confirm("Renewing the join code will invalidate the old code. Proceed?")) return;
        try {
          renewBtn.disabled = true;
          renewBtn.textContent = "Renewing...";
          const renewRes = await fetch(`${API_BASE_URL}/api/classrooms/${encodeURIComponent(classroomId)}/renew-code`, {
            method: "POST",
            credentials: "include"
          });
          const renewData = await renewRes.json();
          if (!renewRes.ok) throw new Error(renewData.message || "Failed to renew code.");
          showToast(`New code generated: ${renewData.code}`);
          if (codeEl) codeEl.textContent = `Classroom Code: ${renewData.code}`;
          await loadClassrooms();
        } catch (renewErr) {
          alert(renewErr.message);
        } finally {
          renewBtn.disabled = false;
          renewBtn.textContent = "🔄 Renew Code";
        }
      };
    }

  } catch (err) {
    console.error("Roster error:", err);
    if (rosterEmpty) rosterEmpty.style.display = "none";
    if (rosterTable) rosterTable.style.display = "table";
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #dc2626; padding: 24px;">Failed to load roster: ${escapeHTML(err.message)}</td></tr>`;
    }
  }
}

// ============================================================
// TOP & QUICK ACTIONS ATTACHMENTS
// ============================================================

const createClassroomButtons = document.querySelectorAll(
  "#btn-create-classroom, #create-first-classroom, #quick-create-class, #btn-add-classroom-quick"
);
createClassroomButtons.forEach((btn) => {
  btn.addEventListener("click", () => openModal("modal-create-classroom"));
});

const uploadResourceButtons = document.querySelectorAll(
  "#btn-upload-resource, #quick-publish-resource, #quick-upload-pyq"
);
uploadResourceButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (teacherClassrooms.length === 0) {
      showToast("Please create a classroom and add a subject first before publishing materials.");
      openModal("modal-create-classroom");
      return;
    }
    const catSelect = document.getElementById("select-upload-category");
    if (btn.id === "quick-upload-pyq" && catSelect) {
      catSelect.value = "pyq";
    } else if (catSelect) {
      catSelect.value = "resource";
    }
    openModal("modal-upload-resource");
  });
});

function handleViewRouting() {
  const urlParams = new URLSearchParams(window.location.search);
  const view = urlParams.get("view");
  const hash = window.location.hash;
  const isClassroomsView = view === "classrooms" || hash === "#classrooms" || hash === "#section-classrooms";

  const navDashboard = document.getElementById("nav-dashboard");
  const navClassrooms = document.getElementById("nav-classrooms");
  const classroomsSection = document.getElementById("section-classrooms");

  if (isClassroomsView) {
    if (navDashboard) navDashboard.classList.remove("active");
    if (navClassrooms) navClassrooms.classList.add("active");
    if (classroomsSection) {
      setTimeout(() => {
        classroomsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        classroomsSection.style.transition = "box-shadow 0.4s ease";
        classroomsSection.style.boxShadow = "0 0 0 3px rgba(124, 58, 237, 0.35)";
        setTimeout(() => {
          classroomsSection.style.boxShadow = "";
        }, 1800);
      }, 100);
    }
  } else {
    if (navDashboard) navDashboard.classList.add("active");
    if (navClassrooms) navClassrooms.classList.remove("active");
  }
}

function initClassroomNavigation() {
  const navClassrooms = document.getElementById("nav-classrooms");
  if (navClassrooms) {
    navClassrooms.addEventListener("click", (e) => {
      const currentPath = window.location.pathname;
      if (currentPath.endsWith("teacher-dashboard/index.html") || currentPath.endsWith("/teacher-dashboard")) {
        e.preventDefault();
        window.history.pushState({}, "", "index.html?view=classrooms");
        handleViewRouting();
      }
    });
  }

  const navDashboard = document.getElementById("nav-dashboard");
  if (navDashboard) {
    navDashboard.addEventListener("click", (e) => {
      const currentPath = window.location.pathname;
      if (currentPath.endsWith("teacher-dashboard/index.html") || currentPath.endsWith("/teacher-dashboard")) {
        if (window.location.search.includes("view=classrooms")) {
          e.preventDefault();
          window.history.pushState({}, "", "index.html");
          handleViewRouting();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
    });
  }

  window.addEventListener("popstate", handleViewRouting);
}

// Helpers
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

loadTeacher();
})();
