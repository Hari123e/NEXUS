const loginPage = document.getElementById("loginPage");
const appPage = document.getElementById("appPage");

let currentUser = "";

let activeChat = "Arun";

const chatLayout = document.querySelector(".chat-layout");

const chatData = {

    Arun: [
        {text: "Hey! How are you?", type: "received", time: "9:28"},
        {text: "I'm good! What about you?", type: "sent", time: "9:29"},
        {text: "Everything is great!", type: "received", time: "9:30"}
    ],

    Rahul: [
        {text: "See you tomorrow!", type: "received", time: "8:45"}
    ],

    Alex: [
        {text: "Thanks bro.", type: "received", time: "Yesterday"}
    ]

};


// DEMO LOGIN

document.getElementById("loginForm")
.addEventListener("submit", function(event) {

    event.preventDefault();

    currentUser = document.getElementById("username").value.trim();

    if (!currentUser) return;

    document.getElementById("profileName").textContent = currentUser;

    loginPage.classList.add("hidden");
    appPage.classList.remove("hidden");

    showToast("Welcome to NEXUS!");

    openChat("Arun");

});


// NAVIGATION

function showSection(section, button) {

    document.querySelectorAll(".content-section")
    .forEach(item => item.classList.add("hidden"));

    document.getElementById(section)
    .classList.remove("hidden");

    document.querySelectorAll(".nav-item")
    .forEach(item => item.classList.remove("active"));

    if (button) button.classList.add("active");

    const titles = {
        chats: "Chats",
        contacts: "Contacts",
        groups: "Groups",
        calls: "Calls",
        settings: "Settings"
    };

    document.getElementById("sectionTitle").textContent =
        titles[section];

}


// OPEN CONVERSATION

function openChat(name) {

    activeChat = name;

    document.getElementById("chatName").textContent = name;

    document.getElementById("chatAvatar").textContent =
        name.charAt(0).toUpperCase();

    renderMessages();

    document.querySelectorAll(".conversation")
    .forEach(item => item.classList.remove("active"));

    const selected = [...document.querySelectorAll(".conversation")]
    .find(item => item.querySelector("h4")?.textContent === name);

    if (selected) selected.classList.add("active");

    if (window.innerWidth <= 700) {
        chatLayout.classList.add("mobile-chat-open");
    }

}


// RENDER MESSAGES

function renderMessages() {

    const container = document.getElementById("messages");

    container.innerHTML = '<div class="date-label">TODAY</div>';

    const messages = chatData[activeChat] || [];

    messages.forEach(message => {

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


// SEND MESSAGE

document.getElementById("messageForm")
.addEventListener("submit", function(event) {

    event.preventDefault();

    const input = document.getElementById("messageText");

    const text = input.value.trim();

    if (!text) return;

    if (!chatData[activeChat]) {
        chatData[activeChat] = [];
    }

    const now = new Date();

    const time = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });

    chatData[activeChat].push({
        text: text,
        type: "sent",
        time: time
    });

    input.value = "";

    renderMessages();

});


// SEARCH CONVERSATIONS

document.getElementById("searchChat")
.addEventListener("input", function() {

    const value = this.value.toLowerCase();

    document.querySelectorAll(".conversation")
    .forEach(item => {

        const name = item.querySelector("h4")
        .textContent.toLowerCase();

        item.style.display =
            name.includes(value) ? "flex" : "none";

    });

});


// LOGOUT

function logout() {

    loginPage.classList.remove("hidden");
    appPage.classList.add("hidden");

    document.getElementById("password").value = "";

    showToast("Logged out successfully.");

}


// NOTIFICATIONS

function showToast(message) {

    const toast = document.getElementById("toast");

    toast.textContent = message;

    toast.style.display = "block";

    setTimeout(() => {
        toast.style.display = "none";
    }, 2500);

}


function demoNotice() {

    showToast("This feature is coming soon!");

}