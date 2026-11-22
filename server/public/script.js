
"use strict";

const loginPage = document.getElementById("loginPage");
const appPage = document.getElementById("appPage");
const loginForm = document.getElementById("loginForm");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const chatLayout = document.querySelector(".chat-layout");

let currentUser = null;
let activeChat = "Arun";

const chatData = {
    Arun: [
        { text: "Hey! How are you?", type: "received", time: "9:28" },
        { text: "I'm good! What about you?", type: "sent", time: "9:29" },
        { text: "Everything is great!", type: "received", time: "9:30" }
    ],
    Rahul: [
        { text: "See you tomorrow!", type: "received", time: "8:45" }
    ],
    Alex: [
        { text: "Thanks bro.", type: "received", time: "Yesterday" }
    ]
};

// ==========================================
// API HELPER
// ==========================================

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
    }

    return data;
}

// ==========================================
// LOGIN
// ==========================================

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        showToast("Enter your username and password.");
        return;
    }

    const button = loginForm.querySelector('button[type="submit"]');

    if (button) {
        button.disabled = true;
        button.textContent = "Signing in...";
    }

    try {
        const result = await apiRequest("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });

        passwordInput.value = "";

        await handleAuthenticatedUser(result.user);

    } catch (error) {
        showToast(error.message);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Sign In";
        }
    }
});

// ==========================================
// USER ROLE CHECK
// ==========================================

async function handleAuthenticatedUser(user) {
    if (!user || !user.id || !user.role) {
        await logout(false);
        return;
    }

    if (user.role === "super_admin") {
        window.location.replace("/admin.html");
        return;
    }

    if (user.role !== "user") {
        await logout(false);
        showToast("Account access denied.");
        return;
    }

    currentUser = user;

    document.getElementById("profileName").textContent =
        user.username;

    document.querySelectorAll(".avatar").forEach((avatar) => {
        avatar.textContent = user.username.charAt(0).toUpperCase();
    });

    loginPage.classList.add("hidden");
    appPage.classList.remove("hidden");

    showToast("Welcome to NEXUS!");

    openChat("Arun");
}

// ==========================================
// AUTOMATIC SESSION CHECK
// ==========================================

async function checkSession() {
    try {
        const result = await apiRequest("/api/auth/me");

        await handleAuthenticatedUser(result.user);

    } catch {
        currentUser = null;

        loginPage.classList.remove("hidden");
        appPage.classList.add("hidden");
    }
}

// ==========================================
// NAVIGATION
// ==========================================

function showSection(section, button) {
    const selectedSection = document.getElementById(section);

    if (!selectedSection) return;

    document.querySelectorAll(".content-section")
        .forEach((item) => item.classList.add("hidden"));

    selectedSection.classList.remove("hidden");

    document.querySelectorAll(".nav-item")
        .forEach((item) => item.classList.remove("active"));

    if (button) button.classList.add("active");

    const titles = {
        chats: "Chats",
        contacts: "Contacts",
        groups: "Groups",
        calls: "Calls",
        settings: "Settings"
    };

    document.getElementById("sectionTitle").textContent =
        titles[section] || "NEXUS";
}

// ==========================================
// OPEN CONVERSATION
// ==========================================

function openChat(name) {
    activeChat = name;

    document.getElementById("chatName").textContent = name;

    document.getElementById("chatAvatar").textContent =
        name.charAt(0).toUpperCase();

    renderMessages();

    document.querySelectorAll(".conversation")
        .forEach((item) => item.classList.remove("active"));

    const selected = [...document.querySelectorAll(".conversation")]
        .find((item) =>
            item.querySelector("h4")?.textContent === name
        );

    if (selected) selected.classList.add("active");

    if (window.innerWidth <= 700 && chatLayout) {
        chatLayout.classList.add("mobile-chat-open");
    }
}

// ==========================================
// RENDER DEMO MESSAGES
// ==========================================

function renderMessages() {
    const container = document.getElementById("messages");

    container.replaceChildren();

    const dateLabel = document.createElement("div");
    dateLabel.className = "date-label";
    dateLabel.textContent = "DEMO CONVERSATION";

    container.appendChild(dateLabel);

    const messages = chatData[activeChat] || [];

    messages.forEach((message) => {
        const element = document.createElement("div");

        element.className = "message " + message.type;

        element.appendChild(
            document.createTextNode(message.text)
        );

        const time = document.createElement("span");
        time.textContent = message.time;

        element.appendChild(time);
        container.appendChild(element);
    });

    container.scrollTop = container.scrollHeight;
}

// ==========================================
// DEMO MESSAGE INPUT
// ==========================================

document.getElementById("messageForm")
    .addEventListener("submit", (event) => {
        event.preventDefault();

        showToast("Live messaging is not connected yet.");
    });

// ==========================================
// SEARCH CONVERSATIONS
// ==========================================

document.getElementById("searchChat")
    .addEventListener("input", function () {
        const value = this.value.toLowerCase();

        document.querySelectorAll(".conversation")
            .forEach((item) => {
                const name = item.querySelector("h4")
                    .textContent.toLowerCase();

                item.style.display =
                    name.includes(value) ? "flex" : "none";
            });
    });

// ==========================================
// LOGOUT
// ==========================================

async function logout(showMessage = true) {
    try {
        await apiRequest("/api/auth/logout", {
            method: "POST",
            body: JSON.stringify({})
        });
    } catch (error) {
        if (showMessage) {
            showToast(error.message);
            return;
        }
    }

    currentUser = null;

    appPage.classList.add("hidden");
    loginPage.classList.remove("hidden");

    passwordInput.value = "";
    usernameInput.value = "";

    if (showMessage) {
        showToast("Logged out successfully.");
    }
}

// ==========================================
// NOTIFICATIONS
// ==========================================

function showToast(message) {
    const toast = document.getElementById("toast");

    if (!toast) return;

    toast.textContent = message;
    toast.style.display = "block";

    setTimeout(() => {
        toast.style.display = "none";
    }, 2500);
}

function demoNotice() {
    showToast("This feature is coming soon!");
}

// ==========================================
// START APPLICATION
// ==========================================

checkSession();

