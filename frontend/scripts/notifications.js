/**
 * StudyReader — Unified Notification Bell Component
 * 
 * Features:
 * - PostgreSQL backed notifications with unread count badge
 * - Accessible popover panel with real-time mark-as-read
 * - "Mark all as read" bulk action
 * - Relative timestamp formatting
 * - Auto-polling every 30 seconds
 * - Click outside to dismiss
 */

(function () {
  "use strict";

  const API_BASE_URL = window.API_BASE_URL || (
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? (window.location.port === "5500" ? "http://127.0.0.1:3000" : "")
      : ""
  );

  let notifications = [];
  let unreadCount = 0;
  let dropdownEl = null;
  let isOpen = false;

  function timeAgo(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getNotificationIcon(type) {
    switch (type) {
      case "material_added":
        return "📄";
      case "classroom_joined":
      case "classroom_left":
        return "🏛";
      case "announcement":
      default:
        return "📢";
    }
  }

  function createDropdown() {
    if (dropdownEl) return dropdownEl;

    dropdownEl = document.createElement("div");
    dropdownEl.id = "sr-notifications-dropdown";
    dropdownEl.setAttribute("role", "dialog");
    dropdownEl.setAttribute("aria-label", "Notifications panel");
    dropdownEl.style.cssText = `
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 360px;
      max-width: 90vw;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      z-index: 1000;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: inherit;
    `;

    dropdownEl.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; background: #f8fafc;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong style="font-size: 15px; color: #0f172a;">Notifications</strong>
          <span id="sr-notif-count-pill" style="display: none; background: #2563eb; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px;">0</span>
        </div>
        <button type="button" id="sr-notif-mark-all-btn" style="background: none; border: none; font-size: 12px; color: #2563eb; font-weight: 600; cursor: pointer; padding: 4px 6px; border-radius: 4px;">
          Mark all read
        </button>
      </div>
      <div id="sr-notif-list" style="max-height: 380px; overflow-y: auto; display: flex; flex-direction: column;">
        <!-- Notifications rendered here -->
      </div>
    `;

    document.body.appendChild(dropdownEl);

    // Wire "mark all read"
    dropdownEl.querySelector("#sr-notif-mark-all-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      await markAllAsRead();
    });

    return dropdownEl;
  }

  function updateBadge() {
    const badgeElements = document.querySelectorAll(".notification-badge, #notification-badge");
    badgeElements.forEach((badge) => {
      if (unreadCount > 0) {
        badge.style.display = "flex";
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        badge.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          top: -4px;
          right: -4px;
          background: #ef4444;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          min-width: 17px;
          height: 17px;
          padding: 0 4px;
          border-radius: 999px;
          border: 2px solid #ffffff;
          pointer-events: none;
        `;
      } else {
        badge.style.display = "none";
      }
    });

    const pill = document.getElementById("sr-notif-count-pill");
    if (pill) {
      if (unreadCount > 0) {
        pill.style.display = "inline-block";
        pill.textContent = `${unreadCount} new`;
      } else {
        pill.style.display = "none";
      }
    }
  }

  function renderList() {
    const listContainer = document.getElementById("sr-notif-list");
    if (!listContainer) return;

    if (!notifications || notifications.length === 0) {
      listContainer.innerHTML = `
        <div style="padding: 36px 20px; text-align: center; color: #64748b;">
          <div style="font-size: 32px; margin-bottom: 8px;">🔔</div>
          <p style="font-size: 14px; font-weight: 600; margin: 0 0 4px 0; color: #1e293b;">No notifications yet</p>
          <p style="font-size: 12px; margin: 0;">You're all caught up with your classes and materials.</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = notifications.map((n) => {
      const isUnread = !n.isRead;
      const bg = isUnread ? "#f8faff" : "#ffffff";
      const icon = getNotificationIcon(n.type);

      return `
        <div class="sr-notif-item" data-id="${n.id}" style="display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; background: ${bg}; cursor: pointer; transition: background 0.15s ease; position: relative;">
          <div style="font-size: 20px; flex-shrink: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: #eff6ff; border-radius: 8px;">
            ${icon}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 2px;">
              <strong style="font-size: 13px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(n.title)}</strong>
              <span style="font-size: 11px; color: #94a3b8; flex-shrink: 0;">${timeAgo(n.createdAt)}</span>
            </div>
            <p style="font-size: 12px; color: #475569; margin: 0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHTML(n.message)}</p>
            ${n.classroomName ? `<span style="display: inline-block; font-size: 10px; color: #2563eb; font-weight: 600; margin-top: 4px; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">🏛 ${escapeHTML(n.classroomName)}</span>` : ""}
          </div>
          ${isUnread ? `<span style="width: 8px; height: 8px; background: #2563eb; border-radius: 50%; position: absolute; right: 12px; top: 16px;"></span>` : ""}
        </div>
      `;
    }).join("");

    // Wire individual clicks
    listContainer.querySelectorAll(".sr-notif-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const id = el.getAttribute("data-id");
        const notif = notifications.find((item) => String(item.id) === String(id));
        if (notif && !notif.isRead) {
          await markOneAsRead(id);
        }
      });
    });
  }

  async function fetchNotifications() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications`, {
        credentials: "include"
      });
      if (!res.ok) return;

      const data = await res.json();
      if (data.success) {
        notifications = data.notifications || [];
        unreadCount = data.unreadCount || 0;
        updateBadge();
        if (isOpen) {
          renderList();
        }
      }
    } catch (_) {
      // Keep existing state on transient network blip
    }
  }

  async function markOneAsRead(id) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/${id}/read`, {
        method: "PATCH",
        credentials: "include"
      });
      if (res.ok) {
        const notif = notifications.find((n) => String(n.id) === String(id));
        if (notif && !notif.isRead) {
          notif.isRead = true;
          unreadCount = Math.max(0, unreadCount - 1);
          updateBadge();
          renderList();
        }
      }
    } catch (_) {}
  }

  async function markAllAsRead() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/mark-all-read`, {
        method: "POST",
        credentials: "include"
      });
      if (res.ok) {
        notifications.forEach((n) => (n.isRead = true));
        unreadCount = 0;
        updateBadge();
        renderList();
      }
    } catch (_) {}
  }

  function toggleDropdown(btn) {
    createDropdown();

    if (isOpen) {
      dropdownEl.style.display = "none";
      isOpen = false;
      return;
    }

    // Position dropdown relative to the clicked bell button
    const rect = btn.getBoundingClientRect();
    const isMobile = window.innerWidth <= 640;

    if (isMobile) {
      dropdownEl.style.position = "fixed";
      dropdownEl.style.top = "64px";
      dropdownEl.style.left = "16px";
      dropdownEl.style.right = "16px";
      dropdownEl.style.width = "auto";
    } else {
      dropdownEl.style.position = "absolute";
      dropdownEl.style.top = `${rect.bottom + window.scrollY + 8}px`;
      dropdownEl.style.right = `${Math.max(16, window.innerWidth - rect.right)}px`;
      dropdownEl.style.left = "auto";
      dropdownEl.style.width = "360px";
    }

    renderList();
    dropdownEl.style.display = "flex";
    isOpen = true;
  }

  function initBell() {
    const bellButtons = document.querySelectorAll(
      "#btn-notifications, .topbar-icon-btn[aria-label='Notifications'], .topbar-icon-btn"
    );

    let attached = false;
    bellButtons.forEach((btn) => {
      // Find the button with bell emoji or notification aria-label
      if (btn.getAttribute("aria-label") === "Notifications" || btn.textContent.includes("🔔")) {
        btn.style.position = "relative";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleDropdown(btn);
        });
        attached = true;
      }
    });

    // Dismiss when clicking outside
    document.addEventListener("click", (e) => {
      if (isOpen && dropdownEl && !dropdownEl.contains(e.target)) {
        dropdownEl.style.display = "none";
        isOpen = false;
      }
    });

    // Dismiss on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen && dropdownEl) {
        dropdownEl.style.display = "none";
        isOpen = false;
      }
    });

    // Fetch initial notifications
    fetchNotifications();

    // Auto-poll every 30 seconds
    setInterval(fetchNotifications, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBell);
  } else {
    initBell();
  }

  window.StudyReaderNotifications = {
    fetch: fetchNotifications,
    markAllRead: markAllAsRead
  };
})();
