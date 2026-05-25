function randomRoomCode() {
    return Math.random().toString(36).slice(2, 8);
}

function getVal(id) {
    return document.getElementById(id).value.trim();
}

function showToast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    region.appendChild(toast);

    window.setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
        window.setTimeout(() => toast.remove(), 180);
    }, 3200);
}

function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.classList.toggle("is-loading", isLoading);
    button.disabled = isLoading;
}

function goMeeting({ roomId, name, role }) {
    const url = new URL(window.location.origin + "/meeting.html");
    url.searchParams.set("room", roomId);
    url.searchParams.set("name", name);
    url.searchParams.set("role", role);
    window.location.href = url.toString();
}

function validateEntry({ requireRoom }) {
    const name = getVal("name");
    const role = document.getElementById("role").value;
    const roomId = getVal("room");
    const consent = document.getElementById("consent").checked;

    if (!name) {
        showToast("Please enter your name.", "error");
        document.getElementById("name").focus();
        return null;
    }

    if (requireRoom && !roomId) {
        showToast("Please enter a room code to join.", "error");
        document.getElementById("room").focus();
        return null;
    }

    if (!consent) {
        showToast("Please accept the FER demo consent.", "error");
        document.getElementById("consent").focus();
        return null;
    }

    return {
        name,
        role,
        roomId: requireRoom ? roomId : randomRoomCode()
    };
}

document.getElementById("createBtn").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const entry = validateEntry({ requireRoom: false });
    if (!entry) return;

    setButtonLoading(button, true);
    showToast("Creating room...");
    window.setTimeout(() => goMeeting(entry), 260);
});

document.getElementById("joinBtn").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const entry = validateEntry({ requireRoom: true });
    if (!entry) return;

    setButtonLoading(button, true);
    showToast("Joining room...");
    window.setTimeout(() => goMeeting(entry), 260);
});
