/* ============================================================
   STUDYREADER — UNIFIED RUNTIME ENVIRONMENT CONFIGURATION
   Dynamically determines API endpoints across Local Development,
   Vercel Previews, and Render Production Web Services.
   ============================================================ */

(function () {
  "use strict";

  // Production Render Backend URL (set when deploying backend)
  const PRODUCTION_BACKEND_URL = "https://studyreader-api.onrender.com";
  const LOCAL_BACKEND_URL = "http://127.0.0.1:3000";

  function determineApiBaseUrl() {
    // 1. Priority: Manual override via localStorage (useful for debugging/testing specific stages)
    const storedOverride = localStorage.getItem("studyreader_api_url");
    if (storedOverride && storedOverride.trim()) {
      return storedOverride.trim().replace(/\/+$/, "");
    }

    // 2. Priority: Explicit window injection if configured in HTML meta/script tag
    if (window.__STUDYREADER_API_URL__ && String(window.__STUDYREADER_API_URL__).trim()) {
      return String(window.__STUDYREADER_API_URL__).trim().replace(/\/+$/, "");
    }

    // 3. Priority: Automatic environment detection based on client hostname
    const hostname = window.location.hostname;
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      window.location.protocol === "file:";

    if (isLocalhost) {
      return LOCAL_BACKEND_URL;
    }

    // Deployed environment (Vercel, custom domain, etc.)
    return PRODUCTION_BACKEND_URL;
  }

  const resolvedApiBaseUrl = determineApiBaseUrl();

  // Expose globally to all scripts
  window.API_BASE_URL = resolvedApiBaseUrl;
  window.getApiBaseUrl = () => window.API_BASE_URL;

  // Developer convenience helper
  window.StudyReaderConfig = {
    apiBaseUrl: resolvedApiBaseUrl,
    setApiOverride: (url) => {
      if (url) {
        localStorage.setItem("studyreader_api_url", url);
      } else {
        localStorage.removeItem("studyreader_api_url");
      }
      window.location.reload();
    },
    resetApiOverride: () => {
      localStorage.removeItem("studyreader_api_url");
      window.location.reload();
    }
  };
})();
