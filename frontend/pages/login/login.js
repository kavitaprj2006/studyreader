(function () {
  "use strict";

  const API_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:3000";

const form = document.getElementById("login-form");
const message = document.getElementById("form-message");
const submitButton = document.getElementById("submit-button");

document.getElementById("toggle-password").addEventListener("click", (event) => {
  const input = document.getElementById("password");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  event.target.textContent = visible ? "Show" : "Hide";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    message.textContent = "Enter your email and password.";
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Logging in...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    });

    const data = await response.json();

    if (!response.ok) {
      message.textContent = data.message || "Login failed.";
      return;
    }

    // Role-based dashboard routing
    if (data.user && data.user.role === "teacher") {
      window.location.href = "../teacher-dashboard/index.html";
    } else if (data.user && data.user.role === "admin") {
      window.location.href = "../admin/index.html";
    } else {
      window.location.href = "../dashboard/index.html";
    }

  } catch (error) {
    console.error("Login error:", error);
    message.textContent = "Unable to connect to the StudyReader server.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Log in";
  }
});
})();
