/**
 * StudyReader — Unified Global Search Component
 * 
 * Features:
 * - 300ms debounced input
 * - Role-scoped PostgreSQL search results (classrooms, subjects, materials)
 * - Accessible keyboard navigation (Arrow keys, Enter, Escape)
 * - Loading indicator and empty state
 * - Direct navigation to classrooms, subjects, and study materials
 */

(function () {
  "use strict";

  const API_BASE_URL = window.API_BASE_URL || (
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? (window.location.port === "5500" ? "http://127.0.0.1:3000" : "")
      : ""
  );

  let debounceTimer = null;
  let activeDropdown = null;
  let activeInput = null;
  let selectedIndex = -1;
  let currentResults = [];

  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getFileIcon(type) {
    switch (type) {
      case "docx":
        return "📝";
      case "pptx":
        return "📊";
      case "pdf":
      default:
        return "📄";
    }
  }

  function createDropdown(inputEl) {
    if (activeDropdown && activeInput === inputEl) return activeDropdown;

    if (activeDropdown) {
      activeDropdown.remove();
    }

    const dropdown = document.createElement("div");
    dropdown.id = "sr-search-results-dropdown";
    dropdown.setAttribute("role", "listbox");
    dropdown.setAttribute("aria-label", "Search results");
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 6px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      z-index: 1000;
      max-height: 420px;
      overflow-y: auto;
      display: none;
      font-family: inherit;
    `;

    // Ensure parent search-box is positioned relatively
    const parent = inputEl.closest(".search-box") || inputEl.parentElement;
    if (parent) {
      parent.style.position = "relative";
      parent.appendChild(dropdown);
    } else {
      document.body.appendChild(dropdown);
    }

    activeDropdown = dropdown;
    activeInput = inputEl;
    return dropdown;
  }

  function showLoading(dropdown) {
    dropdown.innerHTML = `
      <div style="padding: 24px; text-align: center; color: #64748b; font-size: 13px;">
        <span style="display: inline-block; animation: sr-spin 1s linear infinite; margin-right: 6px;">⟳</span>
        Searching your spaces...
      </div>
      <style>
        @keyframes sr-spin { 100% { transform: rotate(360deg); } }
      </style>
    `;
    dropdown.style.display = "block";
  }

  function renderResults(dropdown, data, query) {
    const { classrooms = [], subjects = [], documents = [] } = data.results || {};
    const total = (classrooms.length + subjects.length + documents.length);
    selectedIndex = -1;
    currentResults = [];

    if (total === 0) {
      dropdown.innerHTML = `
        <div style="padding: 28px 16px; text-align: center; color: #64748b;">
          <div style="font-size: 28px; margin-bottom: 6px;">🔍</div>
          <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; color: #1e293b;">No results found for "${escapeHTML(query)}"</p>
          <p style="margin: 0; font-size: 11px;">Try searching by classroom name, subject title, or document filename.</p>
        </div>
      `;
      dropdown.style.display = "block";
      return;
    }

    let html = "";

    // 1. Classrooms
    if (classrooms.length > 0) {
      html += `<div style="padding: 8px 14px 4px 14px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; background: #f8fafc; border-bottom: 1px solid #f1f5f9;">🏛 Classrooms (${classrooms.length})</div>`;
      classrooms.forEach((c) => {
        const itemIndex = currentResults.length;
        currentResults.push({
          type: "classroom",
          url: `../library/index.html?classroomId=${c.id}`
        });

        html += `
          <div class="sr-search-item" data-index="${itemIndex}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f8fafc; transition: background 0.15s ease;">
            <div style="min-width: 0;">
              <strong style="font-size: 13px; color: #0f172a; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(c.name)}</strong>
              <span style="font-size: 11px; color: #64748b;">${c.semester ? `Semester ${c.semester}` : ""}${c.section ? ` · Sec ${c.section}` : ""}${c.teacherName ? ` · Prof. ${escapeHTML(c.teacherName)}` : ""}</span>
            </div>
            <span style="font-size: 10px; font-family: monospace; font-weight: 700; background: #eff6ff; color: #2563eb; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; margin-left: 8px;">${escapeHTML(c.code)}</span>
          </div>
        `;
      });
    }

    // 2. Subjects
    if (subjects.length > 0) {
      html += `<div style="padding: 8px 14px 4px 14px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; background: #f8fafc; border-bottom: 1px solid #f1f5f9;">📘 Subjects (${subjects.length})</div>`;
      subjects.forEach((s) => {
        const itemIndex = currentResults.length;
        currentResults.push({
          type: "subject",
          url: `../library/index.html?subjectId=${s.id}`
        });

        html += `
          <div class="sr-search-item" data-index="${itemIndex}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f8fafc; transition: background 0.15s ease;">
            <div style="min-width: 0;">
              <strong style="font-size: 13px; color: #0f172a; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(s.name)}</strong>
              <span style="font-size: 11px; color: #64748b;">${s.classroomName ? `🏛 ${escapeHTML(s.classroomName)}` : "Personal Space"}</span>
            </div>
            <span style="font-size: 11px; color: #2563eb; flex-shrink: 0; margin-left: 8px;">View →</span>
          </div>
        `;
      });
    }

    // 3. Documents & Materials
    if (documents.length > 0) {
      html += `<div style="padding: 8px 14px 4px 14px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; background: #f8fafc; border-bottom: 1px solid #f1f5f9;">📄 Materials & PYQs (${documents.length})</div>`;
      documents.forEach((d) => {
        const itemIndex = currentResults.length;
        currentResults.push({
          type: "document",
          url: `../pdf-study/index.html?id=${d.id}`
        });

        const icon = getFileIcon(d.fileType);
        const tagBg = d.category === "pyq" ? "#fef3c7" : "#dbeafe";
        const tagColor = d.category === "pyq" ? "#b45309" : "#1e40af";
        const tagLabel = d.category === "pyq" ? "PYQ" : (d.fileType ? d.fileType.toUpperCase() : "Doc");

        html += `
          <div class="sr-search-item" data-index="${itemIndex}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f8fafc; transition: background 0.15s ease;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <span style="font-size: 16px; flex-shrink: 0;">${icon}</span>
              <div style="min-width: 0;">
                <strong style="font-size: 13px; color: #0f172a; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(d.originalFilename || d.filename)}</strong>
                <span style="font-size: 11px; color: #64748b;">${d.subjectName ? `${escapeHTML(d.subjectName)} · ` : ""}${d.classroomName ? `🏛 ${escapeHTML(d.classroomName)}` : "Personal"}</span>
              </div>
            </div>
            <span style="font-size: 10px; font-weight: 700; background: ${tagBg}; color: ${tagColor}; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; margin-left: 8px;">${tagLabel}</span>
          </div>
        `;
      });
    }

    dropdown.innerHTML = html;
    dropdown.style.display = "block";

    // Attach item clicks
    dropdown.querySelectorAll(".sr-search-item").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.getAttribute("data-index"));
        const item = currentResults[idx];
        if (item && item.url) {
          window.location.href = item.url;
        }
      });
      el.addEventListener("mouseenter", () => {
        highlightItem(Number(el.getAttribute("data-index")));
      });
    });
  }

  function highlightItem(index) {
    if (!activeDropdown) return;
    const items = activeDropdown.querySelectorAll(".sr-search-item");
    items.forEach((item, i) => {
      if (i === index) {
        item.style.background = "#eff6ff";
      } else {
        item.style.background = "#ffffff";
      }
    });
    selectedIndex = index;
  }

  async function performSearch(query, inputEl) {
    const dropdown = createDropdown(inputEl);
    if (!query || query.length < 2) {
      dropdown.style.display = "none";
      return;
    }

    showLoading(dropdown);

    try {
      const res = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      renderResults(dropdown, data, query);
    } catch (err) {
      dropdown.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ef4444; font-size: 12px;">
          Unable to fetch search results.
        </div>
      `;
    }
  }

  function initSearch() {
    const searchInputs = document.querySelectorAll(
      ".search-box input[type='search'], #topbar-search, .search-box input"
    );

    searchInputs.forEach((input) => {
      input.setAttribute("autocomplete", "off");
      input.addEventListener("input", (e) => {
        const query = e.target.value.trim();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          performSearch(query, input);
        }, 300);
      });

      input.addEventListener("keydown", (e) => {
        if (!activeDropdown || activeDropdown.style.display === "none") return;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (selectedIndex < currentResults.length - 1) {
            highlightItem(selectedIndex + 1);
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (selectedIndex > 0) {
            highlightItem(selectedIndex - 1);
          }
        } else if (e.key === "Enter") {
          if (selectedIndex >= 0 && selectedIndex < currentResults.length) {
            e.preventDefault();
            const item = currentResults[selectedIndex];
            if (item && item.url) {
              window.location.href = item.url;
            }
          }
        } else if (e.key === "Escape") {
          activeDropdown.style.display = "none";
          selectedIndex = -1;
        }
      });

      input.addEventListener("focus", (e) => {
        const query = e.target.value.trim();
        if (query.length >= 2) {
          performSearch(query, input);
        }
      });
    });

    // Dismiss on click outside
    document.addEventListener("click", (e) => {
      if (activeDropdown && !activeDropdown.contains(e.target) && e.target !== activeInput) {
        activeDropdown.style.display = "none";
        selectedIndex = -1;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSearch);
  } else {
    initSearch();
  }
})();
