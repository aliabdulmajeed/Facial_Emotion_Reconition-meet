function qs(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
}

const roomName = qs("room");
window.roomName = roomName;
const displayName = qs("name") || "Guest";
const role = qs("role") || "student";

document.getElementById("roomLabel").textContent = roomName || "-";
document.getElementById("youLabel").textContent = displayName;
document.getElementById("roleBadge").textContent = `Role: ${role}`;
setStatus("Preparing...", "pending");

const analyticsWrap = document.getElementById("analyticsWrap");
const studentNote = document.getElementById("studentNote");
const leaveBtn = document.getElementById("leaveBtn");

if (role === "instructor") {
    analyticsWrap.style.display = "block";
    studentNote.style.display = "none";
    leaveBtn.textContent = "End Meeting";
}

const videoGrid = document.getElementById("videoGrid");
const peopleList = document.getElementById("peopleList");
const countLabel = document.getElementById("countLabel");
const chatlog = document.getElementById("chatlog");
const chatMsg = document.getElementById("chatMsg");
const sendChatBtn = document.getElementById("sendChatBtn");
const audioSink = document.getElementById("audioSink");
const enableAudioBtn = document.getElementById("enableAudioBtn");

let lkRoom = null;
let camEnabled = true;
let micEnabled = true;
let audioUnlocked = false;
const remoteAudioEls = new Map();
const CHAT_TOPIC = "fer-chat";

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

function setStatus(text, state = "pending") {
    const statusEl = document.getElementById("status");
    if (!statusEl) return;

    statusEl.textContent = text;
    statusEl.className = `status-pill ${state}`;
}

function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.classList.toggle("is-loading", isLoading);
    button.disabled = isLoading;
}

// ===================== QUESTIONNAIRE =====================
const QUESTIONNAIRES = {
    instructor: [
        "How well prepared were you for this session?",
        "How clearly did you explain the lesson?",
        "How engaged were the students during the session?",
        "How well did students respond to your questions or activities?",
        "How smoothly did the session go overall?",
        "How confident are you that students understood the lesson?",
        "How satisfied are you with this session overall?"
    ],
    student: [
        "How well did you understand the lesson in this session?",
        "How clear was the instructor's explanation?",
        "How engaged were you during the session?",
        "How comfortable did you feel asking or answering questions?",
        "How useful was the session for your learning?",
        "How easy was it to follow the session from start to end?",
        "How satisfied are you with this session overall?"
    ]
};

const questionnaireOverlay = document.getElementById("questionnaireOverlay");
const questionnaireForm = document.getElementById("questionnaireForm");
const questionnaireQuestions = document.getElementById("questionnaireQuestions");
const questionnaireTitle = document.getElementById("questionnaireTitle");
const questionnaireSubtitle = document.getElementById("questionnaireSubtitle");
const closeQuestionnaireBtn = document.getElementById("closeQuestionnaireBtn");
const submitAndStayBtn = document.getElementById("submitAndStayBtn");
const questionnaireProgressText = document.getElementById("questionnaireProgressText");
const questionnaireMoodText = document.getElementById("questionnaireMoodText");
const questionnaireProgressBar = document.getElementById("questionnaireProgressBar");

let questionnaireSubmitted = false;
let leaveAfterSubmit = false;

function buildQuestionnaire() {
    const questions = QUESTIONNAIRES[role] || QUESTIONNAIRES.student;
    const ratingLabels = {
        1: "Very poor",
        2: "Poor",
        3: "Fair",
        4: "Good",
        5: "Excellent"
    };

    if (role === "instructor") {
        questionnaireTitle.textContent = "Before you end the session";
        questionnaireSubtitle.textContent = "Please answer these short questions from 1 to 5.";
    } else {
        questionnaireTitle.textContent = "Before you leave";
        questionnaireSubtitle.textContent = "Please answer these short questions from 1 to 5.";
    }

    questionnaireQuestions.innerHTML = questions.map((question, index) => {
        const inputName = `q${index}`;
        return `
            <div class="question-row" data-question-index="${index}">
                <label class="question-label">${index + 1}. ${question}</label>
                <div class="rating-group">
                    ${[1, 2, 3, 4, 5].map(value => `
                        <div class="rating-option">
                            <input type="radio" id="${inputName}_${value}" name="${inputName}" value="${value}" required />
                            <label for="${inputName}_${value}">
                                <span class="rating-number">${value}</span>
                                <span class="rating-word">${ratingLabels[value]}</span>
                            </label>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
    }).join("");

    updateQuestionnaireProgress();
    questionnaireQuestions.querySelectorAll("input[type='radio']").forEach((input) => {
        input.addEventListener("change", () => {
            const row = input.closest(".question-row");
            questionnaireQuestions.querySelectorAll(".question-row").forEach((item) => {
                item.classList.remove("is-active");
            });
            row?.classList.add("is-active", "is-answered");
            updateQuestionnaireProgress();
        });
    });
}

function updateQuestionnaireProgress() {
    const questions = QUESTIONNAIRES[role] || QUESTIONNAIRES.student;
    const answered = questions.filter((_, index) =>
        document.querySelector(`input[name="q${index}"]:checked`)
    ).length;
    const total = questions.length;
    const percent = total ? Math.round((answered / total) * 100) : 0;

    if (questionnaireProgressText) {
        questionnaireProgressText.textContent = `${answered} of ${total} answered`;
    }

    if (questionnaireProgressBar) {
        questionnaireProgressBar.style.width = `${percent}%`;
    }

    if (questionnaireMoodText) {
        if (answered === 0) {
            questionnaireMoodText.textContent = "Choose a rating to begin.";
        } else if (answered < total) {
            questionnaireMoodText.textContent = `${percent}% complete. Keep going.`;
        } else {
            questionnaireMoodText.textContent = "All questions answered. Ready to submit.";
        }
    }
}

function openQuestionnaireModal() {
    buildQuestionnaire();
    questionnaireOverlay.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function hideQuestionnaireModal() {
    questionnaireOverlay.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

closeQuestionnaireBtn.addEventListener("click", () => {
    hideQuestionnaireModal();
});

async function saveQuestionnaireAnswers() {
    const questions = QUESTIONNAIRES[role] || QUESTIONNAIRES.student;

    const ratings = questions.map((question, index) => {
        const selected = document.querySelector(`input[name="q${index}"]:checked`);
        return {
            questionNumber: index + 1,
            question,
            rating: selected ? Number(selected.value) : null
        };
    });

    const averageRating =
        ratings.reduce((sum, item) => sum + (item.rating || 0), 0) / ratings.length;

    const submission = {
        room: roomName,
        name: displayName,
        role,
        submittedAt: new Date().toISOString(),
        averageRating: Number(averageRating.toFixed(2)),
        ratings
    };

    localStorage.setItem("fer-meet-last-questionnaire", JSON.stringify(submission));
    console.log("Questionnaire saved locally:", submission);

    // Do not block the button if backend/proxy has a problem
    fetch("/api/questionnaire", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(submission)
    }).catch((e) => {
        console.warn("Questionnaire backend failed, saved locally only:", e);
    });

    return submission;
}


// ===================== QUESTIONNAIRE SUBMIT EVENTS =====================

async function handleQuestionnaireSubmit(shouldLeave) {
    if (!questionnaireForm.reportValidity()) {
        updateQuestionnaireProgress();
        showToast("Please answer all questionnaire items.", "error");
        return;
    }

    saveQuestionnaireAnswers();
    questionnaireSubmitted = true;

    hideQuestionnaireModal();
    questionnaireForm.reset();

    if (shouldLeave) {
        await leaveMeetingNow();
    } else {
        showToast("Thank you. Your feedback was submitted.");
    }
}

if (submitAndStayBtn) {
    submitAndStayBtn.onclick = async () => {
        console.log("Submit and Stay clicked");
        await handleQuestionnaireSubmit(false);
    };
}

if (questionnaireForm) {
    questionnaireForm.onsubmit = async (e) => {
        e.preventDefault();
        console.log("Submit and Leave clicked");
        await handleQuestionnaireSubmit(true);
    };
}


// ===================== SEND SESSION TO LLM =====================

async function sendSessionAnalysisToLLM(sessionDataOverride = null) {
    if (!window.Analysis) return null;

    const sessionData = {
        ...(sessionDataOverride || window.Analysis.getFullSessionData()),
        requester: {
            name: displayName,
            role: role
        }
    };

    console.log("Sending session data to LLM:", sessionData);

    const res = await fetch("/api/session_feedback", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(sessionData)
    });

    if (!res.ok) {
        const text = await res.text();
        console.error("LLM API error:", text);
        throw new Error(text);
    }

    return await res.json();
}

function getLevel(score) {
    if (score >= 70) return { label: "High", className: "high" };
    if (score >= 40) return { label: "Moderate", className: "medium" };
    return { label: "Low", className: "low" };
}

function cleanFeedbackLines(feedback) {
    return String(feedback || "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
        .filter(Boolean)
        .filter((line) => !/^instructor feedback:?$/i.test(line))
        .filter((line) => !/^student feedback/i.test(line))
        .slice(0, 4);
}

function getStudentScore(student) {
    return Math.max(0, Math.min(100, Math.round(Number(student?.engagementScore) || 0)));
}

function getFeedbackStudents(sessionData) {
    return (Array.isArray(sessionData?.students) ? sessionData.students : [])
        .map((student) => ({
            ...student,
            score: getStudentScore(student)
        }))
        .sort((a, b) => b.score - a.score);
}

function getAverageScore(sessionData, students) {
    const summaryScore = Number(sessionData?.summary?.averageEngagement);
    if (Number.isFinite(summaryScore) && summaryScore > 0) {
        return Math.max(0, Math.min(100, Math.round(summaryScore)));
    }

    if (!students.length) return 0;
    return Math.round(students.reduce((sum, student) => sum + student.score, 0) / students.length);
}

function renderLevelBar({ label, score, level, caption = "" }) {
    return `
        <div class="ai-bar-row">
            <div class="ai-bar-meta">
                <span>${escapeHtml(label)}</span>
                <b>${score}%</b>
            </div>
            <div class="ai-bar-track ${level.className}">
                <span style="width: ${score}%"></span>
            </div>
            ${caption ? `<small>${escapeHtml(caption)}</small>` : ""}
        </div>
    `;
}

function renderInstructorFeedback(feedback, sessionData) {
    const students = getFeedbackStudents(sessionData);
    const averageScore = getAverageScore(sessionData, students);
    const level = getLevel(averageScore);
    const notes = cleanFeedbackLines(feedback);
    const studentBars = students.slice(0, 6).map((student) =>
        renderLevelBar({
            label: student.name || "Student",
            score: student.score,
            level: getLevel(student.score),
            caption: student.finalStatus || student.currentStatus || ""
        })
    ).join("");

    return `
        <div class="ai-feedback-ui instructor-feedback">
            <div class="ai-feedback-hero ${level.className}">
                <div>
                    <span>Class Concentration</span>
                    <h3>${level.label}</h3>
                </div>
                <strong>${averageScore}%</strong>
            </div>

            ${renderLevelBar({
                label: "Class level",
                score: averageScore,
                level,
                caption: "Overall attention estimate"
            })}

            <div class="ai-level-key">
                <span class="low">Low</span>
                <span class="medium">Moderate</span>
                <span class="high">High</span>
            </div>

            <div class="ai-feedback-grid">
                <section>
                    <h3>Student Levels</h3>
                    ${studentBars || `<p class="muted">No student samples available.</p>`}
                </section>
                <section>
                    <h3>Teaching Notes</h3>
                    ${renderFeedbackNotes(notes, "No teaching notes available.")}
                </section>
            </div>
        </div>
    `;
}

function renderStudentFeedback(feedback, sessionData) {
    const students = getFeedbackStudents(sessionData);
    const ownRecord = students.find((student) =>
        String(student.name || "").replace(" (You)", "").toLowerCase() === displayName.toLowerCase()
    );
    const score = ownRecord ? ownRecord.score : getAverageScore(sessionData, students);
    const level = getLevel(score);
    const notes = cleanFeedbackLines(feedback);
    const headText = ownRecord?.headDirection || "Not recorded";
    const deviceText = ownRecord?.phoneDetected ? "Phone detected" : "Clear";

    return `
        <div class="ai-feedback-ui student-feedback">
            <div class="ai-feedback-hero ${level.className}">
                <div>
                    <span>Your Concentration</span>
                    <h3>${level.label}</h3>
                </div>
                <strong>${score}%</strong>
            </div>

            ${renderLevelBar({
                label: "Personal level",
                score,
                level,
                caption: ownRecord?.finalStatus || ownRecord?.currentStatus || "Session estimate"
            })}

            <div class="ai-student-metrics">
                <div>
                    <span>Head Position</span>
                    <strong>${escapeHtml(headText)}</strong>
                </div>
                <div>
                    <span>Device Check</span>
                    <strong>${escapeHtml(deviceText)}</strong>
                </div>
            </div>

            <section class="ai-feedback-notes">
                <h3>Learning Notes</h3>
                ${renderFeedbackNotes(notes, "No learning notes available.")}
            </section>
        </div>
    `;
}

function renderFeedbackNotes(notes, emptyText) {
    if (!notes.length) {
        return `<p class="muted">${escapeHtml(emptyText)}</p>`;
    }

    return `
        <ul>
            ${notes.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
    `;
}

function renderAIFeedback(feedback, sessionData) {
    if (role === "instructor") {
        return renderInstructorFeedback(feedback, sessionData);
    }

    return renderStudentFeedback(feedback, sessionData);
}


// ===================== LEAVE MEETING + SHOW FEEDBACK =====================

async function leaveMeetingNow() {
    const feedbackOverlay = document.getElementById("feedbackOverlay");
    const feedbackContent = document.getElementById("feedbackContent");

    if (feedbackOverlay) {
        feedbackOverlay.classList.remove("hidden");
        document.body.classList.add("modal-open");
    }

    if (feedbackContent) {
        feedbackContent.innerHTML = `
            <div class="feedback-loading">
                <div class="loader"></div>
                <h3>Generating AI feedback...</h3>
                <p class="muted">Please wait while the session analysis is processed.</p>
            </div>
        `;
    }

    try {
        lkRoom?.disconnect();
    } catch (e) {
        console.warn("Disconnect warning:", e);
    }

    try {
        const sessionData = window.Analysis ? window.Analysis.getFullSessionData() : null;
        const result = await sendSessionAnalysisToLLM(sessionData);

        const feedback = result?.feedback || result?.rawFeedback || "No feedback returned.";
        const feedbackTitle = document.getElementById("feedbackTitle");
        if (feedbackTitle) {
            feedbackTitle.textContent = role === "instructor"
                ? "Instructor AI Feedback"
                : "Student AI Feedback";
        }

        if (feedbackContent) {
            feedbackContent.innerHTML = renderAIFeedback(feedback, sessionData);
        }

        setStatus("Meeting ended", "connected");

    } catch (e) {
        console.warn("LLM feedback error:", e);

        if (feedbackContent) {
            feedbackContent.innerHTML = `
                <div class="feedback-section danger-feedback">
                    <h3>Feedback could not be generated</h3>
                    <p>Please make sure the feedback backend is running on port 7001.</p>
                    <p class="muted">${escapeHtml(e.message || e)}</p>
                </div>
            `;
        }
    }
}


// ===================== FER CONFIG =====================
const FER_ENABLED = true;
const FER_API_URL = "/api/predict";
const POSE_PHONE_API_URL = "/api/pose_phone";
const FER_INTERVAL_MS = 2000;
const FER_INSTRUCTOR_ONLY = true;

const ferCanvas = document.createElement("canvas");
const ferCtx = ferCanvas.getContext("2d", { willReadFrequently: true });

const ferTimers = new Map();

// ===================== UI HELPERS =====================
function ensureEmotionBadge(tileEl) {
    let badge = tileEl.querySelector(".emotionBadge");
    if (!badge) {
        badge = document.createElement("div");
        badge.className = "emotionBadge loading";
        badge.textContent = "Analyzing...";
        tileEl.appendChild(badge);
    }
    return badge;
}

function updateEmotionBadge(badge, details) {
    const {
        label,
        engagementState,
        confidence,
        headDirection,
        yawText,
        phoneDetected,
        finalStatus
    } = details;

    badge.className = "emotionBadge";

    if (finalStatus === "Concentrating") {
        badge.classList.add("concentrating");
    } else if (finalStatus === "Possibly Not Concentrating" || engagementState === "Uncertain") {
        badge.classList.add("uncertain");
    } else {
        badge.classList.add("distracted");
    }

    const confidencePercent = Math.round((confidence ?? 0) * 100);
    const participantName =
        badge.closest(".tile")?.querySelector(".name")?.textContent?.replace(" (You)", "") ||
        "Participant";
    const deviceStatus = phoneDetected ? "Phone detected" : "Clear";

    badge.innerHTML = `
        <div class="monitor-card-head">
            <div class="monitor-participant">
                <span class="monitor-label">Participant</span>
                <strong>${escapeHtml(participantName)}</strong>
            </div>
            <div class="monitor-attention">
                <strong>${confidencePercent}%</strong>
                <span>Attention</span>
            </div>
        </div>
        <div class="monitor-progress" aria-hidden="true">
            <span style="width: ${confidencePercent}%"></span>
        </div>
        <div class="monitor-grid">
            <div>
                <span>Focus Status</span>
                <strong>${escapeHtml(finalStatus)}</strong>
            </div>
            <div>
                <span>Attention Level</span>
                <strong>${escapeHtml(label)}</strong>
            </div>
            <div>
                <span>Head Position</span>
                <strong>${escapeHtml(headDirection)} (${escapeHtml(yawText)})</strong>
            </div>
            <div>
                <span>Device Check</span>
                <strong>${escapeHtml(deviceStatus)}</strong>
            </div>
        </div>
    `;
}

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatChatTime(date = new Date()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function appendChatMessage({ name, text, time = formatChatTime(), isLocal = false }) {
    if (!chatlog) return;

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.innerHTML = `
        <b>${escapeHtml(name || "Guest")}${isLocal ? " (You)" : ""}</b>
        <span>${escapeHtml(time)}</span>
        <div>${escapeHtml(text)}</div>
    `;

    chatlog.appendChild(msg);
    chatlog.scrollTop = chatlog.scrollHeight;
}

function decodeChatPayload(payload) {
    try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);
        return data?.type === "chat" ? data : null;
    } catch {
        return null;
    }
}

async function sendChatMessage() {
    const text = chatMsg?.value.trim();
    if (!text) return;

    if (!lkRoom?.localParticipant) {
        showToast("Chat is not connected yet.", "error");
        return;
    }

    const message = {
        type: "chat",
        text,
        name: displayName,
        role,
        sentAt: new Date().toISOString()
    };

    const payload = new TextEncoder().encode(JSON.stringify(message));

    try {
        if (typeof lkRoom.localParticipant.publishData !== "function") {
            throw new Error("LiveKit data publishing is unavailable.");
        }

        try {
            await lkRoom.localParticipant.publishData(payload, {
                reliable: true,
                topic: CHAT_TOPIC
            });
        } catch {
            await lkRoom.localParticipant.publishData(
                payload,
                LivekitClient.DataPacket_Kind?.RELIABLE
            );
        }

        appendChatMessage({
            name: displayName,
            text,
            isLocal: true
        });
        chatMsg.value = "";
        chatMsg.focus();
    } catch (e) {
        console.warn("Chat send failed:", e);
        showToast("Message could not be sent.", "error");
    }
}

function attachRemoteAudio(track, participant) {
    if (!audioSink) return;

    const id = `audio-${participant.identity}`;
    remoteAudioEls.get(id)?.remove();

    const audioEl = track.attach();
    audioEl.id = id;
    audioEl.autoplay = true;
    audioEl.controls = false;
    audioEl.muted = false;
    audioEl.playsInline = true;

    audioSink.appendChild(audioEl);
    remoteAudioEls.set(id, audioEl);

    audioEl.play().then(() => {
        audioUnlocked = true;
        if (enableAudioBtn) enableAudioBtn.textContent = "Sound On";
    }).catch(() => {
        showToast("Click Enable Sound to hear participants.");
    });
}

function removeRemoteAudio(participant) {
    const id = `audio-${participant.identity}`;
    const audioEl = remoteAudioEls.get(id);
    if (audioEl) {
        audioEl.remove();
        remoteAudioEls.delete(id);
    }
}

async function enableMeetingAudio() {
    try {
        if (typeof lkRoom?.startAudio === "function") {
            await lkRoom.startAudio();
        }

        await Promise.all(
            Array.from(remoteAudioEls.values()).map((audioEl) =>
                audioEl.play().catch(() => null)
            )
        );

        audioUnlocked = true;
        if (enableAudioBtn) enableAudioBtn.textContent = "Sound On";
        showToast("Sound enabled.");
    } catch (e) {
        console.warn("Enable audio failed:", e);
        showToast("Sound could not be enabled yet.", "error");
    }
}

function renderPeople(participantsMap) {
    peopleList.innerHTML = "";

    const list = [];

    if (lkRoom?.localParticipant) {
        list.push({
            identity: lkRoom.localParticipant.identity,
            name: lkRoom.localParticipant.name,
            isLocal: true,
        });
    }

    if (participantsMap && typeof participantsMap.values === "function") {
        for (const p of participantsMap.values()) {
            list.push({
                identity: p.identity,
                name: p.name,
                isLocal: false,
            });
        }
    }

    list.forEach((p) => {
        const div = document.createElement("div");
        div.className = "person";

        const left = document.createElement("div");
        left.innerHTML = `<b>${escapeHtml(p.name || p.identity)}</b><div class="muted">${escapeHtml(
            p.identity
        )}</div>`;

        const right = document.createElement("small");
        right.className = "muted";

        const status = window.Analysis
            ? window.Analysis.getParticipantStatus(`cam-${p.identity}`)
            : null;

        right.textContent = p.isLocal ? "you" : (status || "live");

        div.appendChild(left);
        div.appendChild(right);
        peopleList.appendChild(div);
    });

    countLabel.textContent = `${list.length} participant${list.length === 1 ? "" : "s"}`;
}

function upsertVideoTile(id, label, mediaEl) {
    const existing = document.getElementById(`tile-${id}`);
    if (existing) existing.remove();

    videoGrid.querySelector(".empty-state")?.remove();

    const tile = document.createElement("div");
    tile.className = "tile";
    tile.id = `tile-${id}`;

    mediaEl.style.width = "100%";
    mediaEl.style.height = "100%";
    mediaEl.style.objectFit = "cover";
    mediaEl.playsInline = true;
    mediaEl.autoplay = true;
    mediaEl.muted = true;

    const nameTag = document.createElement("div");
    nameTag.className = "name";
    nameTag.textContent = label;

    tile.appendChild(mediaEl);
    tile.appendChild(nameTag);

    if (window.Analysis) {
        window.Analysis.setParticipant(id, label, id === "local");
    }

    videoGrid.appendChild(tile);

    if (mediaEl && mediaEl.tagName === "VIDEO") {
        startEmotionLoopForTile(id, mediaEl);
    }
}

function removeTile(id) {
    stopEmotionLoopForTile(id);

    if (window.Analysis) {
        window.Analysis.removeParticipant(id);
    }

    const t = document.getElementById(`tile-${id}`);
    if (t) t.remove();
}

async function postFrameToFER(blob) {
    const form = new FormData();
    form.append("file", blob, "frame.jpg");

    const res = await fetch(FER_API_URL, { method: "POST", body: form });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`FER API error ${res.status}: ${t}`);
    }
    return await res.json();
}


async function postFrameToPosePhone(blob) {
    const form = new FormData();
    form.append("file", blob, "frame.jpg");

    const res = await fetch(POSE_PHONE_API_URL, { method: "POST", body: form });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Pose/Phone API error ${res.status}: ${t}`);
    }
    return await res.json();
}

function captureVideoFrameAsBlob(videoEl) {
    if (!videoEl || videoEl.readyState < 2) return null;

    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (!w || !h) return null;

    const targetW = 224;
    const targetH = Math.round((h / w) * targetW);

    ferCanvas.width = targetW;
    ferCanvas.height = targetH;

    ferCtx.drawImage(videoEl, 0, 0, targetW, targetH);

    return new Promise((resolve) => {
        ferCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
    });
}

function startEmotionLoopForTile(tileId, videoEl) {
    if (!FER_ENABLED) return;
    if (FER_INSTRUCTOR_ONLY && role !== "instructor") return;

    stopEmotionLoopForTile(tileId);

    const tileEl = document.getElementById(`tile-${tileId}`);
    if (!tileEl) return;

    const badge = ensureEmotionBadge(tileEl);

    const intervalId = setInterval(async () => {
        try {
            const blob = await captureVideoFrameAsBlob(videoEl);
            if (!blob) return;

            const ferData = await postFrameToFER(blob);
            const posePhoneData = await postFrameToPosePhone(blob);

            const label = (ferData?.label || "unknown").toLowerCase();

            const engagementState = window.Analysis
                ? window.Analysis.getEngagementState(label, ferData?.confidence ?? 1.0)
                : "Unknown";

            const headPose = posePhoneData?.head_pose || {};
            const headDirection = headPose?.direction || "Unknown";
            const yaw = headPose?.yaw;
            const yawText = yaw === null || yaw === undefined ? "-" : `${Number(yaw).toFixed(1)} deg`;

            const phoneDetected = posePhoneData?.phone?.detected || false;
            const posePhoneStatus = posePhoneData?.pose_phone_status || "Unknown";

            if (window.Analysis) {
                window.Analysis.recordEmotion(tileId, label, ferData?.confidence ?? 1.0);

                window.Analysis.recordAttention(tileId, {
                    headDirection,
                    yaw,
                    phoneDetected,
                    posePhoneStatus
                });
            }

            let finalStatus = window.Analysis
                ? window.Analysis.getParticipantStatus(tileId) || "Uncertain"
                : "Uncertain";

            if (phoneDetected) {
                finalStatus = "Not Concentrating";
            }

            updateEmotionBadge(badge, {
                label,
                engagementState,
                confidence: ferData?.confidence ?? 1.0,
                headDirection,
                yawText,
                phoneDetected,
                finalStatus
            });

            renderPeople(lkRoom?.participants);
        } catch (e) {
            badge.className = "emotionBadge error";
            badge.textContent = "Detection unavailable";
            console.warn("FER loop error:", e.message || e);
        }
    }, FER_INTERVAL_MS);

    ferTimers.set(tileId, intervalId);
}

function stopEmotionLoopForTile(tileId) {
    const id = ferTimers.get(tileId);
    if (id) clearInterval(id);
    ferTimers.delete(tileId);
}

async function fetchToken() {
    const res = await fetch("/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomName, name: displayName, role }),
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        console.error("NON-JSON /token response:", text);
        throw new Error("/token did not return JSON");
    }

    if (!res.ok) {
        console.error("/token error:", data);
        throw new Error(data.error || "Token request failed");
    }

    if (typeof data.url !== "string") throw new Error("Token response missing url");
    if (typeof data.token !== "string") throw new Error("Token is not a string");

    console.log("Token OK. type:", typeof data.token, "url:", data.url);
    return data;
}

async function connectLiveKit() {
    if (!roomName) {
        showToast("Missing room code. Returning to the room screen.", "error");
        window.location.href = "/";
        return;
    }

    setStatus("Getting token...", "pending");
    const { token, url } = await fetchToken();

    setStatus("Connecting to LiveKit...", "pending");

    lkRoom = new LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
    });

    lkRoom.on(LivekitClient.RoomEvent.ParticipantConnected, () => {
        renderPeople(lkRoom.participants);
    });

    lkRoom.on(LivekitClient.RoomEvent.ParticipantDisconnected, (p) => {
        removeTile(`cam-${p.identity}`);
        removeRemoteAudio(p);
        renderPeople(lkRoom.participants);
    });

    lkRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
        if (track.kind === "video") {
            const vidEl = track.attach();
            upsertVideoTile(`cam-${participant.identity}`, participant.name || participant.identity, vidEl);
        } else if (track.kind === "audio") {
            attachRemoteAudio(track, participant);
        }
    });

    lkRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
        if (track.kind === "video") removeTile(`cam-${participant.identity}`);
        if (track.kind === "audio") removeRemoteAudio(participant);
    });

    lkRoom.on(LivekitClient.RoomEvent.DataReceived, (payload, participant, kind, topic) => {
        if (topic && topic !== CHAT_TOPIC) return;

        const message = decodeChatPayload(payload);
        if (!message) return;

        appendChatMessage({
            name: message.name || participant?.name || participant?.identity || "Guest",
            text: message.text || "",
            time: message.sentAt ? formatChatTime(new Date(message.sentAt)) : formatChatTime(),
            isLocal: false
        });
    });

    await lkRoom.connect(url, token);

    renderPeople(lkRoom.participants);

    await lkRoom.localParticipant.enableCameraAndMicrophone();

    const pubs = Array.from(lkRoom.localParticipant.videoTrackPublications.values());
    const localVideoPub = pubs.find((p) => p.track);
    if (localVideoPub?.track) {
        const el = localVideoPub.track.attach();
        upsertVideoTile("local", `${displayName} (You)`, el);
    }

    renderPeople(lkRoom.participants);

    if (window.Analysis) {
        window.Analysis.updateDashboard();
    }

    setStatus("Connected", "connected");
}

document.getElementById("toggleCamBtn").addEventListener("click", async () => {
    camEnabled = !camEnabled;
    await lkRoom?.localParticipant.setCameraEnabled(camEnabled);
    document.getElementById("toggleCamBtn").textContent = `Camera ${camEnabled ? "On" : "Off"}`;
    showToast(`Camera turned ${camEnabled ? "on" : "off"}.`);
});

document.getElementById("toggleMicBtn").addEventListener("click", async () => {
    micEnabled = !micEnabled;
    await lkRoom?.localParticipant.setMicrophoneEnabled(micEnabled);
    document.getElementById("toggleMicBtn").textContent = `Mic ${micEnabled ? "On" : "Off"}`;
    showToast(`Microphone turned ${micEnabled ? "on" : "off"}.`);
});

if (enableAudioBtn) {
    enableAudioBtn.addEventListener("click", enableMeetingAudio);
}

if (sendChatBtn) {
    sendChatBtn.addEventListener("click", sendChatMessage);
}

if (chatMsg) {
    chatMsg.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
        }
    });
}

document.getElementById("leaveBtn").addEventListener("click", async () => {
    if (questionnaireSubmitted) {
        await leaveMeetingNow();
        return;
    }

    leaveAfterSubmit = true;
    openQuestionnaireModal();
});

document.getElementById("copyLinkBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setButtonLoading(button, true);
    const invite = new URL(window.location.origin + "/meeting.html");
    invite.searchParams.set("room", roomName);
    invite.searchParams.set("name", "Guest");
    invite.searchParams.set("role", "student");
    try {
        await navigator.clipboard.writeText(invite.toString());
        showToast("Invite link copied.");
    } catch (e) {
        showToast("Could not copy the invite link.", "error");
    } finally {
        setButtonLoading(button, false);
    }
});

const finishFeedbackBtn = document.getElementById("finishFeedbackBtn");

if (finishFeedbackBtn) {
    finishFeedbackBtn.addEventListener("click", () => {
        window.location.href = "/";
    });
}



connectLiveKit().catch((e) => {
    console.error("connectLiveKit FAILED:", e);
    setStatus("Failed to connect", "error");
    showToast(e?.message || "LiveKit connection failed.", "error");
});
