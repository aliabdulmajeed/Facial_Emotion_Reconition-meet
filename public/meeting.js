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

    const fullSessionData = sessionDataOverride || window.Analysis.getFullSessionData();
    const sessionData = {
        room: roomName,
        requester: {
            name: displayName,
            role: role
        },
        structuredFeedbackData: buildStructuredFeedbackPayload(fullSessionData)
    };

    console.log("Sending structured session data to LLM:", sessionData);

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

function getStoredQuestionnaire() {
    try {
        const saved = JSON.parse(localStorage.getItem("fer-meet-last-questionnaire") || "null");
        if (!saved || saved.room !== roomName || saved.name !== displayName || saved.role !== role) {
            return null;
        }
        return saved;
    } catch {
        return null;
    }
}

function getEmotionPercentages(emotionCounts = {}) {
    const total = Object.values(emotionCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    if (!total) return {};

    return Object.fromEntries(
        Object.entries(emotionCounts).map(([emotion, count]) => [
            emotion,
            Math.round((Number(count || 0) / total) * 100)
        ])
    );
}

function getStudentStructuredSummary(student) {
    const emotionPercentages = getEmotionPercentages(student.emotionCounts || {});
    const records = Array.isArray(student.sessionRecords) ? student.sessionRecords : [];
    const events = Array.isArray(student.events) ? student.events : [];
    const phonePercent = records.length
        ? Math.round((records.filter((item) => item.phoneDetected).length / records.length) * 100)
        : (student.phoneDetected ? 100 : 0);
    const positiveEmotionPercent =
        (emotionPercentages.happy || 0) +
        (emotionPercentages.neutral || 0) +
        Math.round((emotionPercentages.surprise || 0) * 0.5);
    const stressConfusionPercent =
        (emotionPercentages.angry || 0) +
        (emotionPercentages.anger || 0) +
        (emotionPercentages.fear || 0) +
        Math.round((emotionPercentages.disgust || 0) * 0.7) +
        Math.round((emotionPercentages.sad || 0) * 0.4);
    const forwardPercent = records.length
        ? Math.round((records.filter((item) => item.headDirection === "Looking Forward").length / records.length) * 100)
        : 0;
    const noFaceEvents = events.filter((event) => event.type === "no_face").length;
    const participationLevel = Math.max(0, Math.min(100, Math.round(
        ((records.length ? 70 : 35) + (forwardPercent * 0.2) + (phonePercent ? -15 : 10) - (noFaceEvents * 4))
    )));

    return {
        id: student.id,
        name: student.name,
        active: !!student.active,
        joinedAt: student.joinedAt,
        leftAt: student.leftAt,
        engagementScore: Math.max(0, Math.min(100, Math.round(Number(student.engagementScore) || 0))),
        concentrationLevel: Math.max(0, Math.min(100, Math.round(Number(student.engagementScore) || 0))),
        attentionLevel: Math.max(0, Math.min(100, forwardPercent || Number(student.engagementScore) || 0)),
        participationLevel,
        confusionLevel: Math.max(0, Math.min(100, stressConfusionPercent)),
        finalStatus: student.finalStatus || student.currentStatus || "Unknown",
        dominantEmotion: student.dominantEmotion || student.currentEmotion || "unknown",
        emotionPercentages,
        emotionBalance: Math.max(0, Math.min(100, positiveEmotionPercent)),
        headDirection: student.headDirection || "Unknown",
        lookingAwayCount: Number(student.lookingAwayCount) || 0,
        phoneDetected: !!student.phoneDetected,
        phonePercent,
        sampleCount: records.length,
        events: events.map((event) => ({
            type: event.type,
            severity: event.severity,
            message: event.message,
            timestamp: event.timestamp,
            displayTime: event.displayTime
        })).slice(-20),
        questionnaire: null
    };
}

function getOwnStudentSummary(students) {
    const ownName = displayName.toLowerCase();
    return students.find((student) =>
        String(student.name || "").replace(" (You)", "").toLowerCase() === ownName
    ) || students[0] || null;
}

function buildStructuredFeedbackPayload(sessionData) {
    const students = (Array.isArray(sessionData?.students) ? sessionData.students : [])
        .map(getStudentStructuredSummary);
    const averageEngagement = students.length
        ? Math.round(students.reduce((sum, student) => sum + student.engagementScore, 0) / students.length)
        : 0;
    const lookingForwardPercent = students.length
        ? Math.round((students.filter((student) => student.headDirection === "Looking Forward").length / students.length) * 100)
        : 0;
    const phonePercent = students.length
        ? Math.round((students.filter((student) => student.phoneDetected).length / students.length) * 100)
        : 0;
    const eventList = Array.isArray(sessionData?.events)
        ? sessionData.events.map((event) => ({
            type: event.type,
            severity: event.severity,
            message: event.message,
            studentName: event.studentName,
            timestamp: event.timestamp,
            displayTime: event.displayTime
        })).slice(-60)
        : [];
    const needSupport = students.filter((student) =>
        student.engagementScore < 45 ||
        student.confusionLevel > 30 ||
        student.phoneDetected ||
        student.events?.some((event) => event.severity === "high")
    );
    const classEmotionCounts = {};

    students.forEach((student) => {
        Object.entries(student.emotionPercentages || {}).forEach(([emotion, percent]) => {
            classEmotionCounts[emotion] = (classEmotionCounts[emotion] || 0) + percent;
        });
    });

    const classEmotionPercentages = Object.fromEntries(
        Object.entries(classEmotionCounts).map(([emotion, total]) => [
            emotion,
            students.length ? Math.round(total / students.length) : 0
        ])
    );

    const base = {
        room: roomName,
        generatedAt: new Date().toISOString(),
        requester: { name: displayName, role },
        questionnaire: getStoredQuestionnaire(),
        sessionSummary: {
            totalStudents: students.length,
            activeStudents: students.filter((student) => student.active).length,
            attendedAndLeft: students.filter((student) => !student.active && student.leftAt).length,
            averageEngagement,
            lookingForwardPercent,
            phonePercent,
            mostCommonEmotion: sessionData?.summary?.mostCommonEmotion || "-",
            classEmotionPercentages,
            eventCount: eventList.length,
            majorityNeedsAttention: students.length
                ? needSupport.length >= Math.ceil(students.length / 2)
                : false
        },
        events: eventList,
        studentsNeedingSupport: needSupport.map((student) => ({
            name: student.name,
            engagementScore: student.engagementScore,
            confusionLevel: student.confusionLevel,
            keyEvents: (student.events || []).slice(-5)
        }))
    };

    if (role === "instructor") {
        return {
            ...base,
            feedbackType: "instructor",
            students
        };
    }

    return {
        ...base,
        feedbackType: "student",
        student: getOwnStudentSummary(students)
    };
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

function renderInstructorFeedback(feedback, sessionData, visualFeedback = null) {
    const students = getFeedbackStudents(sessionData);
    const averageScore = getAverageScore(sessionData, students);
    const level = getLevel(averageScore);
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
                caption: "Overall class engagement estimate"
            })}

            ${renderFeedbackBars(visualFeedback, "Instructor feedback", {
                role: "instructor",
                sessionData,
                students,
                idPrefix: "instructorFeedback"
            })}

            <div class="ai-feedback-grid">
                <section>
                    <h3>Students Who May Need Support</h3>
                    ${renderSupportList(students)}
                </section>
                <section>
                    <h3>Class Signals</h3>
                    <div class="ai-signal-list">
                        <div><span>Students</span><strong>${students.length}</strong></div>
                        <div><span>Left Session</span><strong>${students.filter((student) => !student.active && student.leftAt).length}</strong></div>
                        <div><span>Top Emotion</span><strong>${escapeHtml(sessionData?.summary?.mostCommonEmotion || "-")}</strong></div>
                        <div><span>Lowest Moment</span><strong>${escapeHtml(sessionData?.summary?.lowestMomentText || "No data")}</strong></div>
                    </div>
                </section>
            </div>

            <section class="ai-feedback-notes">
                <h3>Important Events</h3>
                ${renderEventList(sessionData?.events, "No distraction or support events recorded.")}
            </section>
        </div>
    `;
}

function renderStudentFeedback(feedback, sessionData, visualFeedback = null) {
    const students = getFeedbackStudents(sessionData);
    const ownRecord = students.find((student) =>
        String(student.name || "").replace(" (You)", "").toLowerCase() === displayName.toLowerCase()
    );
    const score = ownRecord ? ownRecord.score : getAverageScore(sessionData, students);
    const level = getLevel(score);
    const headText = ownRecord?.headDirection || "Not recorded";
    const deviceText = ownRecord?.phoneDetected ? "Phone detected" : "Clear";
    const ownEvents = ownRecord?.events || [];

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

            ${renderFeedbackBars(visualFeedback, "Your feedback", {
                role: "student",
                sessionData,
                students,
                ownRecord,
                idPrefix: "studentFeedback"
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
                <h3>Your Session Details</h3>
                ${renderEventList(ownEvents, "No major distraction events recorded.")}
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

function renderAIFeedback(feedback, sessionData, visualFeedback = null) {
    if (role === "instructor") {
        return renderInstructorFeedback(feedback, sessionData, visualFeedback);
    }

    return renderStudentFeedback(feedback, sessionData, visualFeedback);
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
                <h3>Generating session feedback...</h3>
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
        const visualFeedback = result?.visualFeedback || null;
        const renderedSessionData = result?.structuredFeedbackData || sessionData;
        const feedbackTitle = document.getElementById("feedbackTitle");
        if (feedbackTitle) {
            feedbackTitle.textContent = role === "instructor"
                ? "Instructor Session Feedback"
                : "Student Session Feedback";
        }

        if (feedbackContent) {
            feedbackContent.innerHTML = renderAIFeedback(feedback, renderedSessionData, visualFeedback);
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
const ANALYSIS_FRAME_WIDTH = 640;
const HEAD_LEFT_THRESHOLD = -7;
const HEAD_RIGHT_THRESHOLD = 7;
const HEAD_BASELINE_SAMPLES = 3;

const ferCanvas = document.createElement("canvas");
const ferCtx = ferCanvas.getContext("2d", { willReadFrequently: true });

const ferTimers = new Map();
const poseStateByTile = new Map();

function getCameraCaptureOptions() {
    const presetResolution = LivekitClient.VideoPresets?.h720?.resolution;

    return {
        resolution: presetResolution || {
            width: 1280,
            height: 720,
            frameRate: 30
        },
        facingMode: "user"
    };
}

async function enableLocalMedia() {
    try {
        await lkRoom.localParticipant.setCameraEnabled(true, getCameraCaptureOptions());
        await lkRoom.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
        console.warn("Preferred camera quality failed, using browser defaults:", e);
        await lkRoom.localParticipant.enableCameraAndMicrophone();
    }
}

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
                <span>Emotion Status</span>
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

function getToneLevel(score, tone) {
    if (tone === "high" || tone === "medium" || tone === "low") return { className: tone };
    return getLevel(score);
}

function getTopEmotionText(emotionCounts = {}) {
    const entries = Object.entries(emotionCounts)
        .map(([emotion, count]) => [emotion, Number(count) || 0])
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    if (!entries.length) return "No emotion samples were recorded.";

    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    return entries
        .map(([emotion, count]) => `${emotion}: ${Math.round((count / total) * 100)}%`)
        .join(", ");
}

function getQuestionnaireDetail(context = {}) {
    const backendSummary = context.sessionData?.questionnaires;
    if (backendSummary?.averageRating !== undefined && backendSummary?.averageRating !== null) {
        return `Questionnaire average: ${backendSummary.averageRating}/5. This contributes 30% of the feedback score.`;
    }

    const questionnaire = getStoredQuestionnaire();
    if (!questionnaire) return "No questionnaire answers were submitted for this user.";

    const lowest = (questionnaire.ratings || [])
        .filter((item) => Number.isFinite(Number(item.rating)))
        .sort((a, b) => Number(a.rating) - Number(b.rating))[0];
    const lowText = lowest
        ? `Lowest answer: Q${lowest.questionNumber} scored ${lowest.rating}/5.`
        : "No rated questionnaire items were found.";

    return `Questionnaire average: ${questionnaire.averageRating}/5. ${lowText} This contributes 30% of the feedback score.`;
}

function getEventDetail(events = [], emptyText = "No important events were recorded.") {
    const list = Array.isArray(events) ? events.slice(-4).reverse() : [];
    if (!list.length) return emptyText;

    return list
        .map((event) => `${event.displayTime || formatSessionTime(event.timestamp)} - ${event.message || "Session event"}`)
        .join(" | ");
}

function buildFeedbackDetailLines(bar, context = {}) {
    const label = String(bar?.label || "").toLowerCase();
    const score = Math.max(0, Math.min(100, Math.round(Number(bar?.score) || 0)));
    const lines = [];

    if (bar?.detail) {
        lines.push(`Main reason: ${bar.detail}`);
    }

    lines.push(`Score meaning: ${score}% uses 70% live session analytics and 30% questionnaire answers.`);

    if (context.role === "student") {
        const student = context.ownRecord;
        if (!student) {
            lines.push("No personal student record was found for this session.");
            return lines;
        }

        if (label.includes("engagement") || label.includes("overall")) {
            lines.push(`Engagement evidence: ${student.score}% final engagement, ${student.sessionRecords?.length || student.sampleCount || 0} analysis samples, status ${student.finalStatus || student.currentStatus || "unknown"}.`);
        }
        if (label.includes("concentration") || label.includes("attention")) {
            lines.push(`Head-pose evidence: latest position was ${student.headDirection || "unknown"} with ${student.lookingAwayCount || 0} looking-away counts.`);
        }
        if (label.includes("understanding")) {
            lines.push(getQuestionnaireDetail(context));
        }
        if (label.includes("stress") || label.includes("confusion")) {
            lines.push(`Emotion evidence: ${getTopEmotionText(student.emotionCounts || {})}.`);
        }
        if (label.includes("participation")) {
            lines.push(`Presence evidence: joined at ${formatSessionTime(student.joinedAt)}${student.leftAt ? ` and left at ${formatSessionTime(student.leftAt)}` : " and stayed until feedback was generated"}.`);
        }

        lines.push(`Important events: ${getEventDetail(student.events, "No distraction, phone, or camera-away events were recorded for you.")}`);
        return lines;
    }

    const students = Array.isArray(context.students) ? context.students : [];
    const events = Array.isArray(context.sessionData?.events) ? context.sessionData.events : [];
    const supportStudents = students.filter((student) =>
        student.score < 50 ||
        student.phoneDetected ||
        student.finalStatus === "Not Concentrating" ||
        student.finalStatus === "Possibly Not Concentrating"
    );

    lines.push(`Class evidence: ${students.length} students attended, ${students.filter((student) => student.active).length} currently active, ${students.filter((student) => !student.active && student.leftAt).length} left after joining.`);

    if (label.includes("engagement") || label.includes("concentration") || label.includes("overall")) {
        const average = students.length
            ? Math.round(students.reduce((sum, student) => sum + student.score, 0) / students.length)
            : 0;
        lines.push(`Class average: ${average}% engagement across all students who joined the session.`);
    }
    if (label.includes("stress") || label.includes("confusion") || label.includes("support")) {
        lines.push(`Students needing support: ${supportStudents.length ? supportStudents.map((student) => student.name || "Student").join(", ") : "none flagged"}.`);
    }
    if (label.includes("emotion") || label.includes("understanding")) {
        lines.push(`Class emotion trend: ${context.sessionData?.summary?.mostCommonEmotion || "not enough data"} was the most common emotion.`);
    }
    if (label.includes("teaching") || label.includes("clarity") || label.includes("overall") || label.includes("engagement")) {
        lines.push(getQuestionnaireDetail(context));
    }

    lines.push(`Important events: ${getEventDetail(events, "No distraction or support events were recorded for the class.")}`);
    return lines;
}

function renderFeedbackBars(visualFeedback, fallbackTitle, context = {}) {
    const bars = Array.isArray(visualFeedback?.bars) ? visualFeedback.bars : [];
    if (!bars.length) {
        return `<p class="muted">No visual feedback available.</p>`;
    }

    return `
        <div class="visual-feedback">
            <div class="visual-feedback-title">
                <h3>${escapeHtml(visualFeedback?.headline || fallbackTitle)}</h3>
            </div>
            ${bars.map((bar, index) => {
                const score = Math.max(0, Math.min(100, Math.round(Number(bar.score) || 0)));
                const tone = getToneLevel(score, bar.tone);
                const detailId = `${context.idPrefix || "feedbackDetail"}${index}`;
                const detailLines = buildFeedbackDetailLines(bar, context);
                return `
                    <div class="feedback-bar-card">
                        <div class="feedback-bar-head">
                            <div>
                                <span>${escapeHtml(bar.label || "Score")}</span>
                                <strong>${score}%</strong>
                            </div>
                            <button class="detail-toggle" type="button" data-detail-target="${escapeHtml(detailId)}">
                                View Details
                            </button>
                        </div>
                        <div class="ai-bar-track ${tone.className}">
                            <span style="width: ${score}%"></span>
                        </div>
                        <div class="feedback-detail hidden" id="${escapeHtml(detailId)}">
                            <ul>
                                ${detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
                            </ul>
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function formatSessionTime(value) {
    if (!value) return "-";
    try {
        return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
        return "-";
    }
}

function renderEventList(events = [], emptyText = "No key events recorded.") {
    const list = Array.isArray(events) ? events.slice(-8).reverse() : [];
    if (!list.length) {
        return `<p class="muted">${escapeHtml(emptyText)}</p>`;
    }

    return `
        <div class="event-list">
            ${list.map((event) => `
                <div class="event-item ${escapeHtml(event.severity || "medium")}">
                    <span>${escapeHtml(event.displayTime || formatSessionTime(event.timestamp))}</span>
                    <strong>${escapeHtml(event.message || "Session event")}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

function renderSupportList(students = []) {
    const list = students.filter((student) =>
        student.score < 50 ||
        student.phoneDetected ||
        student.finalStatus === "Not Concentrating" ||
        student.finalStatus === "Possibly Not Concentrating"
    ).slice(0, 6);

    if (!list.length) {
        return `<p class="muted">No student support flags recorded.</p>`;
    }

    return `
        <div class="support-list">
            ${list.map((student) => `
                <div>
                    <span>${escapeHtml(student.name || "Student")}</span>
                    <strong>${student.score}%</strong>
                    <small>${escapeHtml(student.finalStatus || student.currentStatus || "Needs review")}</small>
                </div>
            `).join("")}
        </div>
    `;
}

function getSmoothedHeadPose(tileId, headPose) {
    const rawYaw = Number(headPose?.yaw);

    if (!Number.isFinite(rawYaw)) {
        poseStateByTile.delete(tileId);
        return {
            yaw: null,
            direction: headPose?.direction || "No Face"
        };
    }

    const previous = poseStateByTile.get(tileId) || {
        baselineSamples: [],
        baseline: null,
        yaw: rawYaw
    };

    let baseline = previous.baseline;
    const baselineSamples = previous.baselineSamples || [];

    if (baseline === null && baselineSamples.length < HEAD_BASELINE_SAMPLES) {
        baselineSamples.push(rawYaw);
        if (baselineSamples.length === HEAD_BASELINE_SAMPLES) {
            baseline = baselineSamples.reduce((sum, value) => sum + value, 0) / baselineSamples.length;
        }
    }

    const correctedYaw = baseline === null ? 0 : rawYaw - baseline;
    const yaw = previous.yaw === null || previous.yaw === undefined
        ? correctedYaw
        : (previous.yaw * 0.2) + (correctedYaw * 0.8);

    let direction = "Looking Forward";
    if (baseline !== null && yaw < HEAD_LEFT_THRESHOLD) direction = "Looking Left";
    if (baseline !== null && yaw > HEAD_RIGHT_THRESHOLD) direction = "Looking Right";

    poseStateByTile.set(tileId, {
        baselineSamples,
        baseline,
        yaw
    });

    return {
        yaw,
        direction
    };
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

function postStudentSignal(tileId, {
    label,
    engagementState,
    headDirection,
    yaw,
    phoneDetected,
    finalStatus
}) {
    if (!roomName) return;

    const tileName =
        document.getElementById(`tile-${tileId}`)?.querySelector(".name")?.textContent?.replace(" (You)", "") ||
        tileId;

    fetch("/api/collect", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            room: roomName,
            studentId: tileId,
            studentName: tileName,
            emotion: label,
            emotionStatus: engagementState,
            headDirection,
            yaw,
            phoneDetected,
            finalStatus,
            timestamp: new Date().toISOString()
        })
    }).catch((e) => {
        console.warn("Feedback signal collect failed:", e);
    });
}

function captureVideoFrameAsBlob(videoEl) {
    if (!videoEl || videoEl.readyState < 2) return null;

    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (!w || !h) return null;

    const targetW = Math.min(ANALYSIS_FRAME_WIDTH, w);
    const targetH = Math.round((h / w) * targetW);

    ferCanvas.width = targetW;
    ferCanvas.height = targetH;

    ferCtx.drawImage(videoEl, 0, 0, targetW, targetH);

    return new Promise((resolve) => {
        ferCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
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
            const smoothedHeadPose = getSmoothedHeadPose(tileId, headPose);
            const headDirection = smoothedHeadPose.direction || "Unknown";
            const yaw = smoothedHeadPose.yaw;
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

            postStudentSignal(tileId, {
                label,
                engagementState,
                headDirection,
                yaw,
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
    poseStateByTile.delete(tileId);
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
        videoCaptureDefaults: getCameraCaptureOptions(),
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

    await enableLocalMedia();

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
    await lkRoom?.localParticipant.setCameraEnabled(camEnabled, getCameraCaptureOptions());
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

document.addEventListener("click", (event) => {
    const button = event.target.closest(".detail-toggle");
    if (!button) return;

    const targetId = button.dataset.detailTarget;
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;

    const isHidden = target.classList.toggle("hidden");
    button.textContent = isHidden ? "View Details" : "Hide Details";
});



connectLiveKit().catch((e) => {
    console.error("connectLiveKit FAILED:", e);
    setStatus("Failed to connect", "error");
    showToast(e?.message || "LiveKit connection failed.", "error");
});
