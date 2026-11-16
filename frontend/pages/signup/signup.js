(function () {
  "use strict";

  const API_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:3000";

const form = document.getElementById("signup-form");
const message = document.getElementById("form-message");
const submitButton = document.getElementById("submit-button");
const roleOptions = document.querySelectorAll(".role-option");
const selectedRoleInput = document.getElementById("selected-role");

let selectedRole = "student";

function selectRole(role) {
  selectedRole = role;
  if (selectedRoleInput) {
    selectedRoleInput.value = role;
  }
  roleOptions.forEach((btn) => {
    const isTarget = btn.getAttribute("data-role") === role;
    btn.classList.toggle("active", isTarget);
    btn.setAttribute("aria-checked", isTarget ? "true" : "false");
  });
}

// Role switcher handling
roleOptions.forEach((option) => {
  option.addEventListener("click", (event) => {
    event.preventDefault();
    const role = option.getAttribute("data-role");
    if (role) {
      selectRole(role);
    }
  });
});

document.getElementById("toggle-password").addEventListener("click", (event) => {
  const input = document.getElementById("password");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  event.target.textContent = visible ? "Show" : "Hide";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  // Read role reliably from active UI state
  const activeBtn = document.querySelector(".role-option.active");
  const finalRole = (activeBtn && activeBtn.getAttribute("data-role")) ||
                    (selectedRoleInput && selectedRoleInput.value) ||
                    selectedRole ||
                    "student";

  if (!name) {
    message.textContent = "Enter your name.";
    return;
  }

  if (name.length < 2) {
    message.textContent = "Name must be at least 2 characters.";
    return;
  }

  if (!email) {
    message.textContent = "Enter your email.";
    return;
  }

  if (password.length < 8) {
    message.textContent = "Password must be at least 8 characters.";
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Creating account...";

  try {
    const payload = {
      name,
      email,
      password,
      role: finalRole
    };

    console.log("Submitting registration with payload:", payload);

    const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      message.textContent = data.message || "Could not create account.";
      return;
    }

    console.log("Registration successful. Assigned role:", data.user && data.user.role);

    // Role-based dashboard routing
    if (data.user && data.user.role === "teacher") {
      window.location.href = "../teacher-dashboard/index.html";
    } else {
      window.location.href = "../dashboard/index.html";
    }

  } catch (error) {
    console.error("Signup error:", error);
    message.textContent = "Unable to connect to the StudyReader server.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Create account";
  }
});
})();
