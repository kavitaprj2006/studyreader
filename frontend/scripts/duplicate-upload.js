(function () {
  const API_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:3000";

  let pendingData = null;
  let onComplete = null;
  let isBusy = false;

  const dialog = document.createElement("dialog");
  dialog.id = "duplicate-modal";
  dialog.className = "duplicate-modal";
  dialog.setAttribute("aria-labelledby", "duplicate-modal-title");
  dialog.innerHTML = `
    <div class="duplicate-modal-card">
      <div class="duplicate-modal-icon" aria-hidden="true">!</div>
      <div class="duplicate-modal-content">
        <h2 id="duplicate-modal-title">File already exists</h2>
        <p class="duplicate-modal-message">
          A file with this filename is already in your Library.
        </p>
        <div class="duplicate-file-info">
          <span class="duplicate-file-icon" aria-hidden="true">▤</span>
          <div>
            <strong id="duplicate-file-name"></strong>
            <span id="duplicate-file-size"></span>
          </div>
        </div>
        <p class="duplicate-question">What would you like to do?</p>
        <p id="duplicate-modal-status" class="duplicate-modal-status" role="status" aria-live="polite"></p>
        <div class="duplicate-modal-actions">
          <button type="button" class="duplicate-button secondary" data-duplicate-action="cancel">
            Cancel upload
          </button>
          <button type="button" class="duplicate-button secondary" data-duplicate-action="keep-both">
            Keep Both
          </button>
          <button type="button" class="duplicate-button primary" data-duplicate-action="replace">
            Replace Existing
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  const statusElement =
    dialog.querySelector("#duplicate-modal-status");

  const actionButtons =
    Array.from(dialog.querySelectorAll("[data-duplicate-action]"));

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "0 KB";
    }

    const kb = bytes / 1024;

    if (kb < 1024) {
      return `${kb.toFixed(1)} KB`;
    }

    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  function setBusy(busy) {
    isBusy = busy;
    actionButtons.forEach((button) => {
      button.disabled = busy;
    });
  }

  function setStatus(message) {
    statusElement.textContent = message;
  }

  async function readResponse(response) {
    try {
      return await response.json();
    } catch (error) {
      console.error("Invalid duplicate-upload response:", error);
      throw new Error("The server returned an invalid response.");
    }
  }

  async function performAction(action) {
    if (!pendingData || isBusy) {
      return;
    }

    const filename = pendingData.pendingUpload.filename;
    const endpoints = {
      cancel: "/api/pdfs/duplicate/cancel",
      "keep-both": "/api/pdfs/duplicate/keep-both",
      replace: "/api/pdfs/duplicate/replace"
    };
    const body = { filename };

    if (action === "replace") {
      body.existingPdfId = pendingData.existingPdf.id;
    }

    setBusy(true);
    setStatus(
      action === "cancel"
        ? "Cancelling upload..."
        : "Saving your choice..."
    );

    try {
      const response = await fetch(
        `${API_BASE_URL}${endpoints[action]}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      const result = await readResponse(response);

      if (!response.ok) {
        throw new Error(
          result.message || "Unable to complete this action."
        );
      }

      const completion = onComplete;
      const completedAction = action;
      pendingData = null;
      onComplete = null;
      dialog.close();

      if (completion) {
        await completion();
      }

      if (completedAction === "keep-both") {
        window.alert("Both files have been kept.");
      } else if (completedAction === "replace") {
        window.alert("The existing file has been replaced.");
      }
    } catch (error) {
      console.error("Duplicate upload action failed:", error);
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to complete this action. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  actionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      performAction(button.dataset.duplicateAction);
    });
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    setStatus("Choose an option below to finish handling this duplicate.");
  });

  window.StudyReaderDuplicateUpload = {
    open(data, refresh) {
      if (
        !data ||
        !data.pendingUpload ||
        typeof data.pendingUpload.filename !== "string" ||
        !data.pendingUpload.filename ||
        !data.existingPdf ||
        !data.existingPdf.id
      ) {
        throw new Error("The server returned incomplete duplicate-file details.");
      }

      if (dialog.open) {
        throw new Error("Finish handling the current duplicate before uploading another.");
      }

      pendingData = data;
      onComplete = typeof refresh === "function" ? refresh : null;

      dialog.querySelector("#duplicate-file-name").textContent =
        data.pendingUpload.originalFilename || "Unnamed file";
      dialog.querySelector("#duplicate-file-size").textContent =
        formatFileSize(Number(data.pendingUpload.fileSize));
      setStatus("");

      dialog.showModal();
      actionButtons[0].focus();
    }
  };
})();
