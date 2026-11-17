/* ============================================================
   STUDYREADER — UNIFIED SHELL NAVIGATION & UI UTILITIES
   Shared across Student Dashboard, Teacher Dashboard,
   Library, PDF Study Workspace, and Admin Portal.
   ============================================================ */

(function () {
  "use strict";

  const STORAGE_KEY_SIDEBAR = "studyreader_sidebar_collapsed";

  /* ============================================================
     1. SIDEBAR COLLAPSE / EXPAND WITH PERSISTENCE
     ============================================================ */
  function initSidebar() {
    const sidebar = document.getElementById("app-sidebar");
    const toggleBtn = document.getElementById("sidebar-toggle");
    const brandMark = document.querySelector(".sidebar-brand");

    if (!sidebar) return;

    // Restore saved state
    const savedState = localStorage.getItem(STORAGE_KEY_SIDEBAR);
    if (savedState === "true") {
      sidebar.classList.add("collapsed");
    }

    function toggleSidebar() {
      const isCollapsed = sidebar.classList.toggle("collapsed");
      localStorage.setItem(STORAGE_KEY_SIDEBAR, isCollapsed ? "true" : "false");
    }

    if (toggleBtn) {
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSidebar();
      });
    }

    // Clicking brand mark in collapsed mode expands the sidebar
    if (brandMark) {
      brandMark.addEventListener("click", () => {
        if (sidebar.classList.contains("collapsed")) {
          sidebar.classList.remove("collapsed");
          localStorage.setItem(STORAGE_KEY_SIDEBAR, "false");
        }
      });
    }
  }

  /* ============================================================
     2. UNIFIED TOAST NOTIFICATION SYSTEM
     ============================================================ */
  let toastTimeout = null;

  function showToast(message, type = "info", duration = 3500) {
    let toast = document.getElementById("toast-banner");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast-banner";
      toast.className = "toast-banner";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `toast-banner show toast-${type}`;
    toast.style.display = "block";

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.style.display = "none";
      toast.className = "toast-banner";
    }, duration);
  }

  window.StudyReaderToast = {
    show: showToast,
    success: (msg, dur) => showToast(msg, "success", dur),
    error: (msg, dur) => showToast(msg, "error", dur),
    info: (msg, dur) => showToast(msg, "info", dur)
  };
  window.showToast = showToast;

  /* ============================================================
     3. UNIFIED MODAL DIALOG CONTROLLER
     ============================================================ */
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

  window.StudyReaderModal = {
    open: openModal,
    close: closeModal
  };
  window.openModal = openModal;
  window.closeModal = closeModal;

  function initModals() {
    // Backdrop click-to-close
    document.querySelectorAll("dialog.sr-modal").forEach((dialog) => {
      dialog.addEventListener("click", (e) => {
        const rect = dialog.getBoundingClientRect();
        const isInDialog =
          rect.top <= e.clientY &&
          e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX &&
          e.clientX <= rect.left + rect.width;
        if (!isInDialog) {
          dialog.close();
        }
      });
    });

    // Close buttons
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-close-modal");
        closeModal(targetId);
      });
    });
  }

  /* ============================================================
     4. UNIFIED LOGOUT CONTROLLER WITH CONFIRMATION
     ============================================================ */
  function ensureLogoutModal() {
    let modal = document.getElementById("modal-logout-confirm");
    if (!modal) {
      modal = document.createElement("dialog");
      modal.id = "modal-logout-confirm";
      modal.className = "sr-modal";
      modal.innerHTML = `
        <div class="modal-box" style="max-width: 420px; text-align: center;">
          <div class="modal-head" style="justify-content: flex-end; border-bottom: none; padding-bottom: 0;">
            <button type="button" class="modal-close-btn" data-close-modal="modal-logout-confirm">&times;</button>
          </div>
          <div class="modal-body" style="padding: 0 16px 20px 16px;">
            <div style="font-size: 40px; margin-bottom: 12px;">🚪</div>
            <h3 style="font-size: 19px; font-weight: 700; margin-bottom: 8px; color: var(--text-primary, #0f172a);">Log Out of StudyReader?</h3>
            <p style="font-size: 14px; color: var(--text-secondary, #64748b); line-height: 1.5; margin-bottom: 24px;">Are you sure you want to log out? You will need to sign back in to access your enrolled classrooms and study materials.</p>
            <div style="display: flex; gap: 12px; justify-content: center;">
              <button type="button" class="action-btn" id="btn-cancel-logout" style="width: auto; padding: 10px 22px; cursor: pointer;">Cancel</button>
              <button type="button" class="action-btn" id="btn-confirm-logout" style="width: auto; padding: 10px 22px; background: #dc2626; color: #ffffff; border-color: #dc2626; font-weight: 600; cursor: pointer;">Log Out</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Wire close & cancel
      modal.querySelector("[data-close-modal]").addEventListener("click", () => closeModal("modal-logout-confirm"));
      modal.querySelector("#btn-cancel-logout").addEventListener("click", () => closeModal("modal-logout-confirm"));

      // Click outside backdrop to close
      modal.addEventListener("click", (e) => {
        const rect = modal.getBoundingClientRect();
        const isInDialog =
          rect.top <= e.clientY &&
          e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX &&
          e.clientX <= rect.left + rect.width;
        if (!isInDialog) {
          modal.close();
        }
      });

      // Wire confirm logout
      modal.querySelector("#btn-confirm-logout").addEventListener("click", async () => {
        const btn = modal.querySelector("#btn-confirm-logout");
        btn.disabled = true;
        btn.textContent = "Logging out...";
        try {
          const apiBase = window.API_BASE_URL || (window.location.origin.includes(":5500") ? "http://127.0.0.1:3000" : "");
          await fetch(`${apiBase}/api/auth/logout`, {
            method: "POST",
            credentials: "include"
          });
        } catch (_) {
          // Proceed with redirect regardless of network state
        }
        window.location.href = "../login/index.html";
      });
    }
    return modal;
  }

  function initLogout() {
    const logoutButtons = document.querySelectorAll("#logout, .btn-logout-action, .logout-button");
    logoutButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        ensureLogoutModal();
        openModal("modal-logout-confirm");
      });
    });
  }

  /* ============================================================
     INITIALIZE ON DOM READY
     ============================================================ */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initSidebar();
      initModals();
      initLogout();
    });
  } else {
    initSidebar();
    initModals();
    initLogout();
  }
})();
