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
     4. UNIFIED LOGOUT CONTROLLER
     ============================================================ */
  function initLogout() {
    const logoutButtons = document.querySelectorAll("#logout, .btn-logout-action");
    logoutButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const apiBase = window.API_BASE_URL || "http://127.0.0.1:3000";
          await fetch(`${apiBase}/api/auth/logout`, {
            method: "POST",
            credentials: "include"
          });
        } catch (_) {
          // Proceed with redirect regardless of network state
        }
        window.location.href = "../login/index.html";
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
