
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
    if (section === "contacts") {
    loadContacts();
}
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
// CONTACTS SYSTEM
// ==========================================

const addContactForm = document.getElementById("addContactForm");

if (addContactForm) {
    addContactForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const input = document.getElementById("contactUsername");
        const username = input.value.trim();

        if (!username) return;

        const button = addContactForm.querySelector("button");
        button.disabled = true;

        try {
            const result = await apiRequest("/api/contacts/requests", {
                method: "POST",
                body: JSON.stringify({ username })
            });

            input.value = "";

            showToast(result.message || "Request sent!");

            await loadContacts();

        } catch (error) {
            showToast(error.message);
        } finally {
            button.disabled = false;
        }
    });
}


// CREATE CONTACT ITEM

function createContactItem(username, subtitle, buttons = []) {
    const item = document.createElement("div");
    item.className = "contact-item";

    const info = document.createElement("div");
    info.className = "contact-info";

    const avatar = document.createElement("div");
    avatar.className = "contact-avatar";
    avatar.textContent = username.charAt(0).toUpperCase();

    const details = document.createElement("div");
    details.className = "contact-details";

    const name = document.createElement("strong");
    name.textContent = username;

    const description = document.createElement("small");
    description.textContent = subtitle;

    details.append(name, description);
    info.append(avatar, details);

    const actions = document.createElement("div");
    actions.className = "contact-actions";

    buttons.forEach((buttonInfo) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className =
            "contact-action-btn " + (buttonInfo.style || "");

        button.textContent = buttonInfo.label;

        button.addEventListener("click", buttonInfo.action);

        actions.appendChild(button);
    });

    item.append(info, actions);

    return item;
}


// SHOW EMPTY MESSAGE

function showContactEmpty(container, message) {
    container.replaceChildren();

    const text = document.createElement("p");
    text.className = "contact-muted";
    text.textContent = message;

    container.appendChild(text);
}


// LOAD ALL CONTACT DATA

async function loadContacts() {
    const contactList = document.getElementById("contactList");
    const incomingList = document.getElementById("incomingRequests");
    const outgoingList = document.getElementById("outgoingRequests");

    if (!contactList || !incomingList || !outgoingList) return;

    try {
        const [contactsData, requestsData] = await Promise.all([
            apiRequest("/api/contacts"),
            apiRequest("/api/contacts/requests")
        ]);

        renderContactList(contactsData.contacts || []);
        renderIncomingRequests(requestsData.incoming || []);
        renderOutgoingRequests(requestsData.outgoing || []);

    } catch (error) {
        showContactEmpty(contactList, error.message);
        showContactEmpty(incomingList, "Could not load requests.");
        showContactEmpty(outgoingList, "Could not load requests.");
    }
}


// RENDER ACCEPTED CONTACTS

function renderContactList(contacts) {
    const container = document.getElementById("contactList");
    container.replaceChildren();

    if (!contacts.length) {
        showContactEmpty(container, "No contacts yet. Add someone using their username.");
        return;
    }

    contacts.forEach((contact) => {
        const item = createContactItem(
            contact.username,
            "NEXUS contact",
            [
                {
                    label: "Remove",
                    style: "danger",
                    action: async () => {
                        const confirmed = confirm(
                            "Remove " + contact.username + " from your contacts?"
                        );

                        if (!confirmed) return;

                        try {
                            const result = await apiRequest(
                                "/api/contacts/" + encodeURIComponent(contact.id),
                                { method: "DELETE" }
                            );

                            showToast(result.message);
                            await loadContacts();

                        } catch (error) {
                            showToast(error.message);
                        }
                    }
                }
            ]
        );

        container.appendChild(item);
    });
}


// RENDER INCOMING REQUESTS

function renderIncomingRequests(requests) {
    const container = document.getElementById("incomingRequests");
    container.replaceChildren();

    if (!requests.length) {
        showContactEmpty(container, "No incoming requests.");
        return;
    }

    requests.forEach((request) => {
        const item = createContactItem(
            request.sender_username,
            "Wants to connect with you",
            [
                {
                    label: "Accept",
                    action: () => handleContactRequest(request.id, "accept")
                },
                {
                    label: "Reject",
                    style: "danger",
                    action: () => handleContactRequest(request.id, "reject")
                }
            ]
        );

        container.appendChild(item);
    });
}


// RENDER OUTGOING REQUESTS

function renderOutgoingRequests(requests) {
    const container = document.getElementById("outgoingRequests");
    container.replaceChildren();

    if (!requests.length) {
        showContactEmpty(container, "No outgoing requests.");
        return;
    }

    requests.forEach((request) => {
        const item = createContactItem(
            request.recipient_username,
            "Request pending",
            [
                {
                    label: "Cancel",
                    style: "secondary",
                    action: () => cancelContactRequest(request.id)
                }
            ]
        );

        container.appendChild(item);
    });
}


// ACCEPT OR REJECT REQUEST

async function handleContactRequest(requestId, action) {
    try {
        const result = await apiRequest(
            "/api/contacts/requests/" +
            encodeURIComponent(requestId) +
            "/" + action,
            {
                method: "POST",
                body: JSON.stringify({})
            }
        );

        showToast(result.message);

        await loadContacts();

    } catch (error) {
        showToast(error.message);
    }
}


// CANCEL OUTGOING REQUEST

async function cancelContactRequest(requestId) {
    try {
        const result = await apiRequest(
            "/api/contacts/requests/" +
            encodeURIComponent(requestId) +
            "/cancel",
            {
                method: "POST",
                body: JSON.stringify({})
            }
        );

        showToast(result.message);

        await loadContacts();

    } catch (error) {
        showToast(error.message);
    }
}


// ==========================================
// START APPLICATION
// ==========================================

document.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
        showSection(button.dataset.section, button);
    });
});

document.querySelector('[data-action="logout"]')
    ?.addEventListener("click", logout);

checkSession();

