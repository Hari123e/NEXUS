"use strict";

const form = document.getElementById("registerForm");
const inviteCode = document.getElementById("inviteCode");
const username = document.getElementById("newUsername");
const password = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");
const notice = document.getElementById("notice");

function showNotice(message, type = "error") {
    notice.textContent = message;
    notice.className = `notice ${type}`;
}

function setLoading(loading) {
    const button = form.querySelector('button[type="submit"]');

    if (!button) return;

    button.disabled = loading;
    button.textContent = loading ? "Creating account..." : "Create Account";
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const invitation = inviteCode.value.trim();
    const user = username.value.trim();
    const pass = password.value;
    const confirm = confirmPassword.value;

    if (!invitation || !user || !pass || !confirm) {
        showNotice("Please complete all fields.");
        return;
    }

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(user)) {
        showNotice(
            "Username must be 3–30 characters and contain only letters, numbers, and underscores."
        );
        return;
    }

    if (new TextEncoder().encode(pass).length < 12) {
        showNotice("Password must contain at least 12 bytes.");
        return;
    }

    if (new TextEncoder().encode(pass).length > 1024) {
        showNotice("Password is too long.");
        return;
    }

    if (pass !== confirm) {
        showNotice("Passwords do not match.");
        return;
    }

    setLoading(true);

    try {
        const response = await fetch("/api/auth/register", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                invitation,
                username: user,
                password: pass
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                result.error || "Registration failed. Please try again."
            );
        }

        form.reset();

        showNotice(
            "Your NEXUS account has been created successfully! You can now log in.",
            "success"
        );

    } catch (error) {
        showNotice(error.message);
    } finally {
        setLoading(false);
    }
});
