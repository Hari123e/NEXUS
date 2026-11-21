const adminLogin = document.getElementById("adminLogin");

const adminDashboard =
    document.getElementById("adminDashboard");


function previewDashboard() {

    adminLogin.classList.add("hidden");

    adminDashboard.classList.remove("hidden");

    adminNotice("Dashboard preview mode. Not authenticated.");

}


document.getElementById("adminForm")
.addEventListener("submit", function(event) {

    event.preventDefault();

    adminNotice(
        "Admin authentication is not connected yet."
    );

});


function adminSection(section, button) {

    document.querySelectorAll(".admin-section")
    .forEach(item => item.classList.add("hidden"));

    document.getElementById(section)
    .classList.remove("hidden");

    document.querySelectorAll(".side-link")
    .forEach(item => item.classList.remove("active"));

    button.classList.add("active");

    const titles = {

        overview: "Overview",
        users: "User Management",
        invitations: "Invitations",
        groups: "Groups",
        devices: "Devices",
        security: "Security Centre",
        settings: "System Settings"

    };

    document.getElementById("adminTitle").textContent =
        titles[section];

}


function adminLogout() {

    adminDashboard.classList.add("hidden");

    adminLogin.classList.remove("hidden");

    document.getElementById("adminForm").reset();

    adminNotice("Admin preview closed.");

}


function adminNotice(message) {

    const toast = document.getElementById("adminToast");

    toast.textContent = message;

    toast.style.display = "block";

    setTimeout(() => {

        toast.style.display = "none";

    }, 2500);

}