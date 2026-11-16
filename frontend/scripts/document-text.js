/* ============================================================
   STUDYREADER — COMMON DOCUMENT EXTRACTION CLIENT
   ============================================================ */

(function () {
  "use strict";

  async function getExtractedDocumentText(documentId) {
    if (!documentId) {
      throw new Error("A document ID is required for text extraction.");
    }

    const apiBase = window.API_BASE_URL || "http://127.0.0.1:3000";
    const response = await fetch(
      `${apiBase}/api/pdfs/${encodeURIComponent(documentId)}/extracted-text`,
      {
        method: "GET",
        credentials: "include"
      }
    );

    let data;
    try {
      data = await response.json();
    } catch (error) {
      console.error("Invalid extraction response:", error);
      throw new Error("The server returned an invalid extraction response.");
    }

    if (response.status === 401) {
      window.location.href = "../login/index.html";
      throw new Error("Authentication required.");
    }

    if (!response.ok) {
      throw new Error(data.message || "Unable to extract document text.");
    }

    if (!data.content || typeof data.content.text !== "string") {
      throw new Error("The extraction response did not contain text.");
    }

    return data;
  }

  window.getExtractedDocumentText = getExtractedDocumentText;
})();
