"use strict";

/* =========================================
   NEXUS — SUPER ADMIN DASHBOARD
========================================= */

const API = {
    login: "/api/auth/login",
    logout: "/api/auth/logout",
    admin: "/api/admin/me",
    dashboard: "/api/admin/dashboard",
    users: "/api/admin/users",
    invitations: "/api/admin/invitations",
    health: "/api/health"
};

const $ = (id) => document.getElementById(id);

const loginSection = $("adminLogin");
const dashboardSection = $("adminDashboard");
const loginForm = $("adminForm");
const loginButton = $("adminLoginButton");
const logoutButton = $("adminLogoutButton");

let currentAdmin = null;
let usersCache = [];
let invitationsCache = [];

/* =========================================
   API HELPER
========================================= */

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            if (url !== API.login) {
                showLogin();
            }
        }

        throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
}

/* =========================================
   NOTIFICATIONS
========================================= */

function adminNotice(message, type = "success") {
    const toast = $("adminToast");

    if (!toast) {
        alert(message);
        return;
    }

    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove("hidden");

    window.clearTimeout(adminNotice.timer);

    adminNotice.timer = window.setTimeout(() => {
        toast.classList.add("hidden");
    }, 3500);
}

/* =========================================
   LOGIN / LOGOUT
========================================= */

function showLogin() {
    loginSection?.classList.remove("hidden");
    dashboardSection?.classList.add("hidden");

    currentAdmin = null;

    if ($("adminPassword")) {
        $("adminPassword").value = "";
    }
}

function showDashboard(admin) {
    currentAdmin = admin;

    loginSection?.classList.add("hidden");
    dashboardSection?.classList.remove("hidden");

    if ($("adminProfileUsername")) {
        $("adminProfileUsername").textContent = admin.username;
    }

    if ($("overviewAdminUsername")) {
        $("overviewAdminUsername").textContent = admin.username;
    }

    loadDashboard();
}

if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const username = $("adminUsername")?.value.trim();
        const password = $("adminPassword")?.value;

        if (!username || !password) {
            adminNotice("Enter your username and password.", "error");
            return;
        }

        loginButton.disabled = true;
        loginButton.textContent = "Signing in...";

        try {
            await apiRequest(API.login, {
                method: "POST",
                body: JSON.stringify({ username, password })
            });

            const result = await apiRequest(API.admin);

            showDashboard(result.admin);

            adminNotice("Welcome to NEXUS Admin.");
        } catch (error) {
            adminNotice(error.message, "error");
        } finally {
            loginButton.disabled = false;
            loginButton.textContent = "Sign In";
        }
    });
}

if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
        try {
            await apiRequest(API.logout, {
                method: "POST"
            });

            showLogin();
            adminNotice("You have been logged out.");
        } catch (error) {
            adminNotice(error.message, "error");
        }
    });
}

/* =========================================
   SESSION CHECK
========================================= */

async function checkAdminSession() {
    try {
        const result = await apiRequest(API.admin);
        showDashboard(result.admin);
    } catch {
        showLogin();
    }
}

/* =========================================
   NAVIGATION — FIXED
========================================= */

document.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
        const sectionName = button.dataset.section;

        // Update sidebar selection
        document.querySelectorAll("[data-section]").forEach((item) => {
            item.classList.remove("active");
        });

        button.classList.add("active");

        // Hide all dashboard sections
        document.querySelectorAll(".admin-section").forEach((panel) => {
            panel.classList.add("hidden");
        });

        // Show selected section
        const selectedPanel = document.getElementById(sectionName);

        if (selectedPanel) {
            selectedPanel.classList.remove("hidden");
        }

        // Update page heading
        const titles = {
            overview: "Overview",
            users: "User Management",
            invitations: "Invitation Management",
            groups: "Group Management",
            devices: "Device Management",
            security: "Security Centre",
            settings: "System Settings"
        };

        const title = document.getElementById("adminTitle");

        if (title) {
            title.textContent = titles[sectionName] || "NEXUS";
        }

        // Load section data
        if (sectionName === "users") {
            loadUsers();
        }

        if (sectionName === "invitations") {
            loadInvitations();
        }
    });
});
/* =========================================
   DASHBOARD
========================================= */

async function loadDashboard() {
    await Promise.allSettled([
        loadUsers(),
        loadInvitations(),
        checkBackend()
    ]);
}

/* =========================================
   BACKEND STATUS
========================================= */

async function checkBackend() {
    try {
        await apiRequest(API.health);

        setText("backendStatus", "Online");
        setText("systemStatus", "Operational");
    } catch {
        setText("backendStatus", "Unavailable");
        setText("systemStatus", "Attention required");
    }
}

/* =========================================
   USERS
========================================= */

async function loadUsers(search = "") {
    const container = $("userList");

    if (!container) return;

    container.textContent = "Loading users...";

    try {
        const url = search
            ? `${API.users}?${new URLSearchParams({ search })}`
            : API.users;

        const result = await apiRequest(url);

        usersCache = Array.isArray(result.users) ? result.users : [];

        renderUsers(usersCache);

        setText("userCount", result.total ?? usersCache.length);
        setText("totalUsers", result.total ?? usersCache.length);

        const activeCount = usersCache.filter(
            (user) => user.is_active
        ).length;

        setText("activeUsers", activeCount);
        setText("databaseStatus", "Connected");

    } catch (error) {
        container.textContent = error.message;
        adminNotice(error.message, "error");
    }
}

function renderUsers(users) {
    const container = $("userList");

    if (!container) return;

    container.replaceChildren();

    if (!users.length) {
        const empty = document.createElement("p");
        empty.textContent = "No users found.";
        container.appendChild(empty);
        return;
    }

    users.forEach((user) => {
        const card = document.createElement("div");
        card.className = "data-card";

        const info = document.createElement("div");
        info.className = "data-info";

        const username = document.createElement("strong");
        username.textContent = user.username;

        const details = document.createElement("p");
        details.textContent =
            `${user.role} • ${user.is_active ? "Active" : "Disabled"}`;

        const sessions = document.createElement("p");
        sessions.textContent =
            `Active sessions: ${user.active_sessions ?? 0}`;

        const devices = document.createElement("p");
        devices.textContent =
            `Verified devices: ${user.verified_devices ?? 0}`;

        info.append(username, details, sessions, devices);
        card.appendChild(info);

        if (user.role !== "super_admin") {
            const actions = document.createElement("div");
            actions.className = "data-actions";

            const statusButton = document.createElement("button");
            statusButton.className = "action-btn";

            statusButton.textContent = user.is_active
                ? "Deactivate"
                : "Activate";

            statusButton.addEventListener("click", () => {
                updateUserStatus(user.id, !user.is_active);
            });

            const revokeButton = document.createElement("button");
            revokeButton.className = "action-btn";
            revokeButton.textContent = "Revoke Sessions";

            revokeButton.addEventListener("click", () => {
                revokeUserSessions(user.id);
            });

            actions.append(statusButton, revokeButton);

            if (user.role === "user") {
                const deleteButton = document.createElement("button");
                deleteButton.className = "action-btn";
                deleteButton.textContent = "Delete Account";

                deleteButton.addEventListener("click", () => {
                    deleteUser(user.id, user.username);
                });

                actions.appendChild(deleteButton);
            }

            card.appendChild(actions);
        }

        container.appendChild(card);
    });
}

async function deleteUser(userId, username) {
    const confirmation = prompt(
        `Permanently delete @${username}? This removes their account, messages, direct conversations, contacts, devices and sessions. This cannot be undone.\n\nType ${username} to confirm:`
    );

    if (confirmation === null) return;

    if (confirmation !== username) {
        adminNotice("Username did not match. Nothing was deleted.", "error");
        return;
    }

    try {
        const result = await apiRequest(
            `${API.users}/${encodeURIComponent(userId)}`,
            { method: "DELETE" }
        );

        adminNotice(result.message || "User permanently deleted.");
        await loadUsers($("userSearch")?.value.trim() || "");
    } catch (error) {
        adminNotice(error.message || "Could not delete user.", "error");
    }
}

async function updateUserStatus(userId, isActive) {
    const confirmed = confirm(
        `Are you sure you want to ${isActive ? "activate" : "deactivate"} this account?`
    );

    if (!confirmed) return;

    try {
        const result = await apiRequest(
            `${API.users}/${encodeURIComponent(userId)}/status`,
            {
                method: "PATCH",
                body: JSON.stringify({ isActive })
            }
        );

        adminNotice(result.message || "User status updated.");
        await loadUsers($("userSearch")?.value.trim() || "");

    } catch (error) {
        adminNotice(error.message, "error");
    }
}

async function revokeUserSessions(userId) {
    if (!confirm("Revoke all sessions for this user?")) return;

    try {
        const result = await apiRequest(
            `${API.users}/${encodeURIComponent(userId)}/revoke-sessions`,
            { method: "POST" }
        );

        adminNotice(result.message || "Sessions revoked.");

        await loadUsers($("userSearch")?.value.trim() || "");

    } catch (error) {
        adminNotice(error.message, "error");
    }
}

/* =========================================
   USER SEARCH
========================================= */

if ($("userSearch")) {
    $("userSearch").addEventListener("input", (event) => {
        loadUsers(event.target.value.trim());
    });
}

/* =========================================
   INVITATIONS
========================================= */

async function loadInvitations() {
    const container = $("invitationList");

    if (!container) return;

    container.textContent = "Loading invitations...";

    try {
        const result = await apiRequest(API.invitations);

        invitationsCache = Array.isArray(result.invitations)
            ? result.invitations
            : [];

        renderInvitations(invitationsCache);

        setText("invitationCount", invitationsCache.length);
        setText("totalInvitations", invitationsCache.length);

        setText("databaseStatus", "Connected");

    } catch (error) {
        container.textContent = error.message;
        adminNotice(error.message, "error");
    }
}

function renderInvitations(invitations) {
    const container = $("invitationList");

    if (!container) return;

    container.replaceChildren();

    if (!invitations.length) {
        const empty = document.createElement("p");
        empty.textContent = "No invitations created yet.";
        container.appendChild(empty);
        return;
    }

    invitations.forEach((invitation) => {
        const card = document.createElement("div");
        card.className = "data-card";

        const info = document.createElement("div");
        info.className = "data-info";

        const title = document.createElement("strong");
        title.textContent = "Invitation";

        const creator = document.createElement("p");
        creator.textContent =
            `Created by: ${invitation.created_by_username || "Unknown user"}`;

        const usage = document.createElement("p");
        usage.textContent =
            `Uses: ${invitation.uses ?? 0} / ${invitation.max_uses ?? 1}`;

        const expiry = document.createElement("p");
        expiry.textContent =
            `Expires: ${formatDate(invitation.expires_at)}`;

        const status = document.createElement("p");

        const expired = invitation.expires_at &&
            new Date(invitation.expires_at).getTime() < Date.now();

        const exhausted =
            Number(invitation.uses) >= Number(invitation.max_uses);

        const revoked = Boolean(invitation.revoked_at);

        status.textContent = revoked
            ? "Status: Revoked"
            : expired
                ? "Status: Expired"
                : exhausted
                    ? "Status: Used up"
                    : "Status: Active";

        info.append(title, creator, usage, expiry, status);
        card.appendChild(info);

        if (!revoked && !expired && !exhausted) {
            const revokeButton = document.createElement("button");
            revokeButton.className = "action-btn";
            revokeButton.textContent = "Revoke";

            revokeButton.addEventListener("click", () => {
                revokeInvitation(invitation.id);
            });

            card.appendChild(revokeButton);
        }

        container.appendChild(card);
    });
}
/* =========================================
   CREATE INVITATION
========================================= */

const createInvitationButton = $("createInvitationButton");

if (createInvitationButton) {
    createInvitationButton.addEventListener("click", createInvitation);
}

async function createInvitation() {
    const maxUses = Number($("invitationMaxUses")?.value || 1);
    const expiresInHours = Number($("invitationExpiry")?.value || 72);

    if (
        !Number.isInteger(maxUses) ||
        maxUses < 1 ||
        maxUses > 100
    ) {
        adminNotice("Maximum uses must be between 1 and 100.", "error");
        return;
    }

    if (
        !Number.isInteger(expiresInHours) ||
        expiresInHours < 1 ||
        expiresInHours > 720
    ) {
        adminNotice("Expiry must be between 1 and 720 hours.", "error");
        return;
    }

    createInvitationButton.disabled = true;

    try {
        const result = await apiRequest(API.invitations, {
            method: "POST",
            body: JSON.stringify({
                maxUses,
                expiresInHours
            })
        });

        const token =
            result.token ||
            result.invitation?.token;

        if (token) {
            displayInvitationToken(token);
            adminNotice("Invitation created. Save the token now.");
        } else {
            adminNotice("Invitation created, but no token was returned.", "error");
        }

        await loadInvitations();

    } catch (error) {
        adminNotice(error.message, "error");
    } finally {
        createInvitationButton.disabled = false;
    }
}

/* =========================================
   DISPLAY INVITATION TOKEN
========================================= */

function displayInvitationToken(token) {
    const output = $("invitationTokenOutput");
    const tokenElement = $("newInvitationToken");
    const copyButton = $("copyInvitationToken");
    const linkElement = $("newInvitationLink");
    const copyLinkButton = $("copyInvitationLink");
    const shareButton = $("shareInvitation");

    if (!output || !tokenElement) return;

    const invitationLink =
        `${window.location.origin}/register.html?invite=${encodeURIComponent(token)}`;

    tokenElement.textContent = token;
    output.classList.remove("hidden");

    if (linkElement) {
        linkElement.textContent = invitationLink;
    }

    if (copyButton) {
        copyButton.onclick = async () => {
            try {
                await navigator.clipboard.writeText(token);
                adminNotice("Invitation token copied.");
            } catch {
                adminNotice("Copy failed. Select and copy the token manually.", "error");
            }
        };
    }

    if (copyLinkButton) {
        copyLinkButton.onclick = async () => {
            try {
                await navigator.clipboard.writeText(invitationLink);
                adminNotice("Invitation link copied.");
            } catch {
                adminNotice("Could not copy the invitation link.", "error");
            }
        };
    }

    if (shareButton) {
        shareButton.onclick = async () => {
            if (!navigator.share) {
                adminNotice("Sharing is not supported in this browser. Copy the link instead.", "error");
                return;
            }

            try {
                await navigator.share({
                    title: "Join me on NEXUS",
                    text: "Use this invitation link to create your NEXUS account:",
                    url: invitationLink
                });
            } catch (error) {
                if (error.name !== "AbortError") {
                    adminNotice("Could not share the invitation link.", "error");
                }
            }
        };
    }
}
/* =========================================
   REVOKE INVITATION
========================================= */

async function revokeInvitation(invitationId) {
    if (!confirm("Are you sure you want to revoke this invitation?")) {
        return;
    }

    try {
        const result = await apiRequest(
            `${API.invitations}/${encodeURIComponent(invitationId)}/revoke`,
            { method: "POST" }
        );

        adminNotice(result.message || "Invitation revoked.");
        await loadInvitations();

    } catch (error) {
        adminNotice(error.message, "error");
    }
}

/* =========================================
   UTILITIES
========================================= */

function setText(id, value) {
    const element = $(id);

    if (element) {
        element.textContent = String(value);
    }
}

function formatDate(value) {
    if (!value) return "Not available";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Not available";
    }

    return date.toLocaleString();
}

/* =========================================
   START
========================================= */

document.addEventListener("DOMContentLoaded", () => {
    checkAdminSession();
});
