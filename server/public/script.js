
"use strict";

// ==========================================
// NEXUS APPLICATION
// ==========================================

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const loginPage = $("#loginPage");
const appPage = $("#appPage");
const loginForm = $("#loginForm");
const usernameInput = $("#username");
const passwordInput = $("#password");

let currentUser = null;
let activeConversation = null;
let conversations = [];
let groups = [];
let groupContacts = [];
let activeGroup = null;
let socket = null;
let reconnectTimer = null;
let intentionalLogout = false;

const displayedMessages = new Set();
const joinedConversations = new Set();
const pendingDelivery = new Map();

function acknowledgeDelivered(conversationId, messageId) {
    if (!conversationId || !messageId) return;

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        !joinedConversations.has(conversationId)
    ) {
        if (!pendingDelivery.has(conversationId)) {
            pendingDelivery.set(conversationId, new Set());
        }
        pendingDelivery.get(conversationId).add(messageId);
        return;
    }

    socket.send(JSON.stringify({
        type: "delivered",
        conversationId,
        messageId
    }));
}

// ==========================================
// API HELPER
// ==========================================

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    let result = {};

    try {
        result = await response.json();
    } catch {
        result = {};
    }

    if (!response.ok) {
        throw new Error(result.error || "Something went wrong.");
    }

    return result;
}

// ==========================================
// NOTIFICATIONS
// ==========================================

let toastTimer;

function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;

    toast.textContent = message;
    toast.style.display = "block";

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.style.display = "none";
    }, 2800);
}

// ==========================================
// LOGIN
// ==========================================

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = loginForm.querySelector("button");
    const errorBox = $("#loginError");

    button.disabled = true;
    button.textContent = "Signing in...";
    errorBox.textContent = "";

    try {
        const result = await apiRequest("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                username: usernameInput.value.trim(),
                password: passwordInput.value
            })
        });

        await handleAuthenticatedUser(result.user);

    } catch (error) {
        errorBox.textContent = error.message;
    } finally {
        button.disabled = false;
        button.textContent = "Sign In";
    }
});

// ==========================================
// SESSION
// ==========================================

async function checkSession() {
    try {
        const result = await apiRequest("/api/auth/me");

        if (result.user) {
            await handleAuthenticatedUser(result.user);
        }
    } catch {
        showLogin();
    }
}

async function handleAuthenticatedUser(user) {
    if (!user || !user.id || !user.username) {
        showLogin();
        return;
    }

    if (user.role === "super_admin") {
        location.href = "/admin.html";
        return;
    }

    if (user.role !== "user") {
        showLogin();
        return;
    }

    currentUser = user;
    intentionalLogout = false;

    loginPage.classList.add("hidden");
    appPage.classList.remove("hidden");

    $("#profileName").textContent = user.username;
    $("#profileAvatar").textContent =
        user.username.charAt(0).toUpperCase();

    $("#topbarAvatar").textContent =
        user.username.charAt(0).toUpperCase();

    $("#settingsUsername").textContent = user.username;

    await Promise.all([
        loadConversations(),
        loadContacts()
    ]);

    connectWebSocket();
}

function showLogin() {
    currentUser = null;
    activeConversation = null;
    activeGroup = null;

    appPage.classList.add("hidden");
    loginPage.classList.remove("hidden");
}

// ==========================================
// NAVIGATION
// ==========================================


// ==========================================
// NAVIGATION
// ==========================================

const sectionTitles = {
    chats: "Messages",
    contacts: "Contacts",
    groups: "Groups",
    settings: "Settings"
};

function showSection(section, button) {
    $$(".content-section").forEach((item) => {
        item.classList.add("hidden");
    });

    const target = document.getElementById(section);

    if (target) {
        target.classList.remove("hidden");
    }

    $$(".nav-btn").forEach((item) => {
        item.classList.remove("active");
    });

    if (button) {
        button.classList.add("active");
    }

    $("#sectionTitle").textContent =
        sectionTitles[section] || "NEXUS";

    if (section === "contacts") {
        loadContacts();
    }

    if (section === "chats") {
        loadConversations();
    }

    if (section === "groups") {
        loadGroups();
        loadGroupContacts();
    }
}

const backToChats = $("#backToChats");

if (backToChats) {
    backToChats.addEventListener("click", () => {
        $(".chat-layout").classList.remove("mobile-chat-open");
    });
}

$$("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
        showSection(button.dataset.section, button);
    });
});

// ==========================================
// CONVERSATIONS
// ==========================================

async function loadConversations() {
    const container = $("#conversationList");

    if (!container || !currentUser) return;

    try {
        const result = await apiRequest("/api/conversations");
const groupResult = await apiRequest("/api/groups");
groups = groupResult.groups || [];

        conversations = result.conversations || [];

        renderConversations();

    } catch (error) {
        container.replaceChildren();

        const message = document.createElement("p");
        message.className = "empty-state";
        message.textContent = error.message;

        container.appendChild(message);
    }
}


function renderConversations() {
    const container = $("#conversationList");
    container.replaceChildren();

    if (!conversations.length && !groups.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent =
            "No conversations yet. Open a chat with an accepted contact.";
        container.appendChild(empty);
        return;
    }

    // Combine groups and direct conversations.
    const allChats = [
        ...groups.map(group => ({
            ...group,
            isGroup: true
        })),
        ...conversations.map(conversation => ({
            ...conversation,
            isGroup: false
        }))
    ];

    // Sort by latest message activity.
    allChats.sort((a, b) => {
        const dateA = new Date(
            a.last_message_created_at ||
            a.last_message_at ||
            a.created_at
        ).getTime() || 0;

        const dateB = new Date(
            b.last_message_created_at ||
            b.last_message_at ||
            b.created_at
        ).getTime() || 0;

        return dateB - dateA;
    });

    allChats.forEach(chat => {
        const item = document.createElement("div");
        item.className = "conversation-item";

        if (activeConversation?.id === chat.id) {
            item.classList.add("active");
        }

        const avatar = document.createElement("div");
        avatar.className = "avatar";

        const name = document.createElement("strong");
        name.textContent = chat.isGroup
            ? chat.name
            : chat.contact_username;

        if (chat.isGroup) {
            avatar.textContent = "👥";
        } else {
            avatar.textContent =
                (chat.contact_username || "?").charAt(0).toUpperCase();
        }

        const details = document.createElement("div");
        details.className = "conversation-details";

        const nameRow = document.createElement("div");
        nameRow.className = "conversation-name-row";
        nameRow.appendChild(name);

        const unreadCount = Number(chat.unread_count || 0);

        if (unreadCount > 0) {
            const badge = document.createElement("span");
            badge.className = "unread-badge";
            badge.textContent =
                unreadCount > 99 ? "99+" : String(unreadCount);

            nameRow.appendChild(badge);
        }

        const preview = document.createElement("p");

        if (chat.last_message) {
            preview.textContent = chat.isGroup
                ? `${chat.last_message_sender || "Member"}: ${chat.last_message}`
                : chat.last_message;
        } else {
            preview.textContent = chat.isGroup
                ? (chat.description || "Group conversation")
                : "Start a conversation";
        }

        details.append(nameRow, preview);

        if (chat.isGroup) {
            const info = document.createElement("small");
            info.textContent = `${chat.member_count} members`;
            details.insertBefore(info, preview);
        }

        item.append(avatar, details);

        item.addEventListener("click", () => {
            if (chat.isGroup) {
                openGroup(chat);
            } else {
                openConversation(chat);
            }
        });

        container.appendChild(item);
    });
}


// OPEN CHAT BY USERNAME
// ==========================================

$("#openChatForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = $("#newChatUsername");
    const username = input.value.trim();

    if (!username) return;

    const button = event.currentTarget.querySelector("button");
    button.disabled = true;

    try {
        const result = await apiRequest("/api/conversations", {
            method: "POST",
            body: JSON.stringify({ username })
        });

        input.value = "";

        await loadConversations();

        const conversation = result.conversation;

        await openConversation(conversation);

        showToast("Conversation opened.");

    } catch (error) {
        showToast(error.message);
    } finally {
        button.disabled = false;
    }
});

// ==========================================
// OPEN CONVERSATION
// ==========================================


async function openGroup(group) {
    if (!group || !group.id) return;

    activeGroup = group;

    await openConversation({
        id: group.id,
        contact_username: group.name,
        isGroup: true,
        member_count: group.member_count
    });
}


async function openConversation(conversation) {
    if (!conversation || !conversation.id) return;

    activeConversation = conversation;
    activeGroup = conversation.isGroup ? conversation : null;

    $("#chatPlaceholder").classList.add("hidden");
    $("#activeChat").classList.remove("hidden");

    $("#chatName").textContent =
        conversation.contact_username;

    $("#chatAvatar").textContent =
        conversation.contact_username.charAt(0).toUpperCase();

$("#chatConnection").textContent = conversation.isGroup
    ? `Group · ${conversation.member_count} members`
    : "NEXUS conversation";
    const layout = $(".chat-layout");

    if (window.innerWidth <= 650) {
        layout.classList.add("mobile-chat-open");
    }

    renderConversations();

    joinConversation();

    await loadMessages();
}

// ==========================================
// MESSAGE HISTORY
// ==========================================

async function loadMessages() {
    if (!activeConversation) return;

    const container = $("#messages");

    container.replaceChildren();
    displayedMessages.clear();

    const loading = document.createElement("p");
    loading.className = "empty-state";
    loading.textContent = "Loading messages...";

    container.appendChild(loading);

    try {
        const result = await apiRequest(
            "/api/conversations/" +
            encodeURIComponent(activeConversation.id) +
            "/messages"
        );

        if (!activeConversation) return;

        container.replaceChildren();

        const messages = result.messages || [];

        if (!messages.length) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "No messages yet. Say hello!";

            container.appendChild(empty);
        }

        messages.forEach(renderMessage);

        for (const message of messages) {
            if (
                message.sender_id !== currentUser.id
            ) {
                acknowledgeDelivered(
                    activeConversation.id,
                    message.id
                );
            }
        }

        await loadConversations();

    } catch (error) {
        container.replaceChildren();

        const message = document.createElement("p");
        message.className = "empty-state";
        message.textContent = error.message;

        container.appendChild(message);
    }
}

// ==========================================
// RENDER MESSAGE
// ==========================================

function renderMessage(message) {
    if (!message || !message.id) return;
    if (displayedMessages.has(message.id)) return;

    displayedMessages.add(message.id);

    const container = $("#messages");
    const empty = container.querySelector(".empty-state");
    if (empty) empty.remove();

    const own = message.sender_id === currentUser.id;
    const element = document.createElement("div");
    element.className = "message" + (own ? " own" : "");
    element.dataset.messageId = message.id;
    element.dataset.createdAt = message.created_at;

    const author = document.createElement("div");
    author.className = "message-author";
    author.textContent = own ? "You" : message.sender_username || "Contact";

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = message.body;

    const time = document.createElement("span");
    time.className = "message-time";

    const date = new Date(message.created_at);
    time.textContent = date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });

    element.append(author, body, time);

    if (own) {
        const status = document.createElement("span");
        status.className = "message-status";

if (message.read_at) {
    status.textContent = "✓✓";
    status.classList.add("is-read");
    status.setAttribute("aria-label", "Read");
} else if (message.delivered_at) {
    status.textContent = "✓✓";
    status.classList.add("is-delivered");
    status.setAttribute("aria-label", "Delivered");
} else {
    status.textContent = "✓";
    status.classList.add("is-sent");
    status.setAttribute("aria-label", "Sent");
}

        element.appendChild(status);
    }

    container.appendChild(element);
    container.scrollTop = container.scrollHeight;
}

// ==========================================
// SEND MESSAGE
// ==========================================

$("#messageForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!activeConversation) {
        showToast("Open a conversation first.");
        return;
    }

    const input = $("#messageText");
    const button = $("#sendMessageBtn");
    const body = input.value.trim();

    if (!body) return;

    const conversationId = activeConversation.id;

    button.disabled = true;

    try {
        await apiRequest(
            "/api/conversations/" +
            encodeURIComponent(conversationId) +
            "/messages",
            {
                method: "POST",
                body: JSON.stringify({ body })
            }
        );

input.value = "";

if (activeGroup) {
    await loadGroups();
} else {
    await loadConversations();
}
     } catch (error) {
        showToast(error.message);
    } finally {
        button.disabled = false;
        input.focus();
    }
});

// ==========================================
// WEBSOCKET REALTIME
// ==========================================

function updateConnectionStatus(status) {
    const label = $("#connectionStatus");
    const dot = $("#connectionDot");

    label.textContent = status;

    dot.classList.remove("connected", "disconnected");

    if (status === "Connected") {
        dot.classList.add("connected");
    } else if (status === "Disconnected") {
        dot.classList.add("disconnected");
    }
}

function connectWebSocket() {
    if (!currentUser || intentionalLogout) return;

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    updateConnectionStatus("Connecting...");

    const protocol =
        location.protocol === "https:" ? "wss:" : "ws:";

    socket = new WebSocket(
        `${protocol}//${location.host}/ws`
    );

    socket.onopen = () => {
        updateConnectionStatus("Connected");
        joinConversation();
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "joined") {
                joinedConversations.add(data.conversationId);

                const pending = pendingDelivery.get(data.conversationId);

                if (pending) {
                    for (const messageId of pending) {
                        acknowledgeDelivered(
                            data.conversationId,
                            messageId
                        );
                    }

                    pendingDelivery.delete(data.conversationId);
                }
            }

            if (data.type === "new_message") {
                if (
                    activeConversation &&
                    data.conversationId === activeConversation.id
                ) {
                    renderMessage(data.message);
                }

                if (
                    data.message &&
                    data.message.sender_id !== currentUser.id
                ) {
                    acknowledgeDelivered(
                        data.conversationId,
                        data.message.id
                    );
                }

loadConversations();
loadGroups();
            }

            if (
                data.type === "message_delivered" &&
                activeConversation &&
                data.conversationId === activeConversation.id
            ) {
                const messageElement = Array.from(
                    document.querySelectorAll(".message")
                ).find(element =>
                    element.dataset.messageId === data.messageId
                );

                const status = messageElement?.querySelector(".message-status");

                if (status && messageElement.classList.contains("own")) {
                    status.textContent = "✓✓";
                    status.className = "message-status is-delivered";
                    status.setAttribute("aria-label", "Delivered");
                }
            }

            if (
                data.type === "messages_read" &&
                activeConversation &&
                data.conversationId === activeConversation.id
            ) {
                const readTime = new Date(data.readAt).getTime();

                document.querySelectorAll(".message.own").forEach(element => {
                    const createdAt = new Date(
                        element.dataset.createdAt
                    ).getTime();

                    const status = element.querySelector(".message-status");

                    if (status && createdAt <= readTime) {
                        status.textContent = "✓✓";
                        status.className = "message-status is-read";
                        status.setAttribute("aria-label", "Read");
                    }
                });
            }

            if (data.type === "error") {
                showToast(data.message);
            }
        } catch {
            console.error("Invalid realtime message.");
        }
    };

    socket.onclose = () => {
        updateConnectionStatus("Disconnected");

        socket = null;
        joinedConversations.clear();

        if (!intentionalLogout && currentUser) {
            clearTimeout(reconnectTimer);

            reconnectTimer = setTimeout(
                connectWebSocket,
                3000
            );
        }
    };

    socket.onerror = () => {
        updateConnectionStatus("Disconnected");
    };
}

function joinConversation() {
    if (
        !activeConversation ||
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {
        return;
    }

    socket.send(JSON.stringify({
        type: "join",
        conversationId: activeConversation.id
    }));
}

// ==========================================
// CHAT SEARCH
// ==========================================

$("#searchChat").addEventListener("input", (event) => {
    const value = event.target.value.toLowerCase();

    $$(".conversation-item").forEach((item) => {
        const name =
            item.querySelector("strong").textContent.toLowerCase();

        item.style.display =
            name.includes(value) ? "flex" : "none";
    });
});

$("#refreshChats").addEventListener("click", async () => {
    await loadConversations();
    await loadGroups();
});

// ==========================================
// CONTACTS
// ==========================================


const addContactForm = $("#addContactForm");

addContactForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = $("#contactUsername");
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
        showToast(result.message || "Request sent.");
        await loadContacts();
    } catch (error) {
        showToast(error.message);
    } finally {
        button.disabled = false;
    }
});


// ==========================================
// USER INVITATIONS
// ==========================================

const generateUserInvitation = $("#generateUserInvitation");
const userInvitationOutput = $("#userInvitationOutput");
const userInvitationLink = $("#userInvitationLink");
const copyUserInvitation = $("#copyUserInvitation");
const shareUserInvitation = $("#shareUserInvitation");

let currentUserInvitationLink = "";

if (generateUserInvitation) {
    generateUserInvitation.addEventListener("click", async () => {
        generateUserInvitation.disabled = true;

        try {
            const result = await apiRequest("/api/invitations", {
                method: "POST",
                body: JSON.stringify({})
            });

            if (!result.token) {
                throw new Error("The server did not return an invitation token.");
            }

            currentUserInvitationLink =
                `${window.location.origin}/register.html?invite=${encodeURIComponent(result.token)}`;

            if (userInvitationLink) {
                userInvitationLink.textContent = currentUserInvitationLink;
            }

            if (userInvitationOutput) {
                userInvitationOutput.classList.remove("hidden");
            }

            showToast("Invitation link created. Share it before it expires.");
        } catch (error) {
            showToast(error.message);
        } finally {
            generateUserInvitation.disabled = false;
        }
    });
}

if (copyUserInvitation) {
    copyUserInvitation.addEventListener("click", async () => {
        if (!currentUserInvitationLink) return;

        try {
            await navigator.clipboard.writeText(currentUserInvitationLink);
            showToast("Invitation link copied.");
        } catch {
            showToast("Copy failed. Please copy the displayed link manually.");
        }
    });
}

if (shareUserInvitation) {
    shareUserInvitation.addEventListener("click", async () => {
        if (!currentUserInvitationLink) return;

        if (!navigator.share) {
            showToast("Sharing is not supported here. Use Copy Link instead.");
            return;
        }

        try {
            await navigator.share({
                title: "Join me on NEXUS",
                text: "Use this link to create your NEXUS account:",
                url: currentUserInvitationLink
            });
        } catch (error) {
            if (error.name !== "AbortError") {
                showToast("Could not share the invitation link.");
            }
        }
    });
}

const createGroupForm = $("#createGroupForm");

createGroupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = $("#groupName").value.trim();
    const description = $("#groupDescription").value.trim();

    const memberIds = Array.from(
        $$('input[name="groupMembers"]:checked')
    ).map((checkbox) => checkbox.value);

    if (!name) {
        showToast("Enter a group name.");
        return;
    }

    if (memberIds.length === 0) {
        showToast("Select at least one group member.");
        return;
    }

    const button = createGroupForm.querySelector(
        'button[type="submit"]'
    );

    button.disabled = true;

    try {
        const result = await apiRequest("/api/groups", {
            method: "POST",
            body: JSON.stringify({
                name,
                description,
                memberIds
            })
        });



        createGroupForm.reset();
        showToast(result.message || "Group created successfully.");

        const newGroup = {
            ...result.group,
            role: "owner"
        };

        showSection("chats", document.querySelector('[data-section="chats"]'));
        await openGroup(newGroup);
        await loadGroups();
        await loadConversations();


    } catch (error) {
        showToast(error.message);
    } finally {
        button.disabled = false;
    }
});

async function loadGroups() {
    if (!currentUser) return;

    const container = $("#groupList");

    try {
        const result = await apiRequest("/api/groups");
        groups = result.groups || [];

        container.replaceChildren();

        if (!groups.length) {
            container.textContent = "No groups yet. Create your first group!";
            return;
        }

        groups.forEach((group) => {
            const item = document.createElement("div");
            item.className = "contact-item";

            const details = document.createElement("div");

            const name = document.createElement("strong");
            name.textContent = group.name;

            const info = document.createElement("p");
            info.textContent =
                `${group.member_count} members · ${group.role}`;

            const description = document.createElement("small");
            description.textContent = group.description || "";

            details.append(name, info, description);
            item.appendChild(details);

            item.addEventListener("click", () => {
                openGroup(group);
            });

            if (group.role === "owner") {
                const deleteButton = document.createElement("button");
                deleteButton.type = "button";
                deleteButton.textContent = "Delete Group";

                deleteButton.addEventListener("click", async (event) => {
                    event.stopPropagation();

                    if (!confirm(`Permanently delete "${group.name}" and all its messages?`)) return;

                    try {
                        await apiRequest(`/api/groups/${group.id}`, {
                            method: "DELETE"
                        });

                        if (activeConversation?.id === group.id) {
                            activeConversation = null;
                            activeGroup = null;
                            $("#activeChat").classList.add("hidden");
                            $("#chatPlaceholder").classList.remove("hidden");
                        }

                        showToast("Group deleted successfully.");
                        await loadGroups();
                        await loadConversations();
                    } catch (error) {
                        showToast(error.message);
                    }
                });

                item.appendChild(deleteButton);
            }

            container.appendChild(item);
        });

    } catch (error) {
        container.textContent = error.message;
    }
}
$("#refreshGroups").addEventListener("click", () => {
    loadGroups();
});

async function loadGroupContacts() {
    if (!currentUser) return;

    const container = $("#groupContactList");

    try {
        const result = await apiRequest("/api/contacts");
        groupContacts = result.contacts || [];

        container.replaceChildren();

        if (!groupContacts.length) {
            container.textContent =
                "Add and accept contacts before creating a group.";
            return;
        }

        groupContacts.forEach((contact) => {
            const label = document.createElement("label");
            label.className = "contact-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = contact.id;
            checkbox.name = "groupMembers";

            const name = document.createElement("span");
            name.textContent = contact.username;

            label.append(checkbox, name);
            container.appendChild(label);
        });

    } catch (error) {
        container.textContent = error.message;
    }
}

async function loadContacts() {
    if (!currentUser) return;

    try {
        const [contactsData, requestsData] = await Promise.all([
            apiRequest("/api/contacts"),
            apiRequest("/api/contacts/requests")
        ]);

        renderContacts(
            contactsData.contacts || [],
            requestsData.incoming || [],
            requestsData.outgoing || []
        );
    } catch (error) {
        showToast(error.message);
    }
}

function renderContacts(contacts, incoming, outgoing) {
    const contactList = $("#contactList");
    const incomingList = $("#incomingRequests");
    const outgoingList = $("#outgoingRequests");

    contactList.replaceChildren();
    incomingList.replaceChildren();
    outgoingList.replaceChildren();

    if (!contacts.length) {
        contactList.textContent = "No contacts yet.";
    }

    contacts.forEach((contact) => {
        const item = document.createElement("div");
        item.className = "contact-item";

        const name = document.createElement("strong");
        name.textContent = contact.username;

        const chatButton = document.createElement("button");
        chatButton.textContent = "Message";
        chatButton.addEventListener("click", () => {
            openChatForContact(contact.username);
        });

        const removeButton = document.createElement("button");
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => {
            removeContact(contact.id);
        });

        item.append(name, chatButton, removeButton);
        contactList.appendChild(item);
    });

    if (!incoming.length) {
        incomingList.textContent = "No incoming requests.";
    }

    incoming.forEach((request) => {
        const item = document.createElement("div");
        item.className = "contact-item";

        const name = document.createElement("strong");
name.textContent = request.sender_username || "Unknown user";

        const acceptButton = document.createElement("button");
        acceptButton.textContent = "Accept";
        acceptButton.addEventListener("click", () => {
            respondToRequest(request.id, "accept");
        });

        const rejectButton = document.createElement("button");
        rejectButton.textContent = "Reject";
        rejectButton.addEventListener("click", () => {
            respondToRequest(request.id, "reject");
        });

        item.append(name, acceptButton, rejectButton);
        incomingList.appendChild(item);
    });

    if (!outgoing.length) {
        outgoingList.textContent = "No outgoing requests.";
    }

    outgoing.forEach((request) => {
        const item = document.createElement("div");
        item.className = "contact-item";

        const name = document.createElement("strong");
name.textContent = request.recipient_username || "Unknown user";

        const cancelButton = document.createElement("button");
        cancelButton.textContent = "Cancel";
        cancelButton.addEventListener("click", () => {
            cancelRequest(request.id);
        });

        item.append(name, cancelButton);
        outgoingList.appendChild(item);
    });
}

async function respondToRequest(id, action) {
    try {
        const result = await apiRequest(
            "/api/contacts/requests/" +
            encodeURIComponent(id) + "/" + action,
            { method: "POST" }
        );

        showToast(result.message || "Request updated.");
        await loadContacts();
    } catch (error) {
        showToast(error.message);
    }
}

async function cancelRequest(id) {
    try {
        await apiRequest(
            "/api/contacts/requests/" +
            encodeURIComponent(id) + "/cancel",
            { method: "POST" }
        );

        showToast("Request cancelled.");
        await loadContacts();
    } catch (error) {
        showToast(error.message);
    }
}

async function removeContact(id) {
    if (!confirm("Remove this contact?")) return;

    try {
        await apiRequest(
            "/api/contacts/" + encodeURIComponent(id),
            { method: "DELETE" }
        );

        showToast("Contact removed.");
        await loadContacts();
        await loadConversations();
    } catch (error) {
        showToast(error.message);
    }
}

async function openChatForContact(username) {
    try {
        const result = await apiRequest("/api/conversations", {
            method: "POST",
            body: JSON.stringify({ username })
        });

        await loadConversations();

        const conversation = conversations.find(
            (item) => item.id === result.conversation.id
        );

        showSection("chats", $('[data-section="chats"]'));
        await openConversation(conversation || result.conversation);
    } catch (error) {
        showToast(error.message);
    }
}

// LOGOUT
// ==========================================

$$('[data-action="logout"]').forEach((button) => {
    button.addEventListener("click", async () => {
        intentionalLogout = true;
        clearTimeout(reconnectTimer);

        if (socket) {
            socket.close();
            socket = null;
        }

        try {
            await apiRequest("/api/auth/logout", {
                method: "POST"
            });
        } catch (error) {
            console.error("Logout error:", error);
        }

        showLogin();
        updateConnectionStatus("Disconnected");
        showToast("Logged out.");
    });
});

// ==========================================
// START APPLICATION
// ==========================================

checkSession();
