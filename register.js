const form = document.getElementById("registerForm");

form.addEventListener("submit", function(event) {

    event.preventDefault();

    const invite = document.getElementById("inviteCode").value.trim();

    const username = document.getElementById("newUsername").value.trim();

    const password = document.getElementById("newPassword").value;

    const confirm = document.getElementById("confirmPassword").value;

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        showNotice("Use 3-20 letters, numbers or underscores.");
        return;
    }

    if (password.length < 12) {
        showNotice("Password must contain at least 12 characters.");
        return;
    }

    if (password !== confirm) {
        showNotice("Passwords do not match.");
        return;
    }

    if (!invite) {
        showNotice("Invitation code is required.");
        return;
    }

    showNotice(
        "Registration interface ready. Backend verification is pending."
    );

});

function showNotice(message) {

    const notice = document.getElementById("notice");

    notice.textContent = message;

    notice.style.display = "block";

    setTimeout(() => {
        notice.style.display = "none";
    }, 3000);

}