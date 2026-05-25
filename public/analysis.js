// ===================== ANALYSIS ENGINE =====================
(function () {

    const EMOTION_SCORES = {
        happy: 0.85,
        neutral: 0.65,
        surprise: 0.50,
        fear: 0.35,
        sad: 0.30,
        disgust: 0.25,
        angry: 0.20,
        unknown: 0.50,
        no_face: 0.20
    };

    const CONFIDENCE_THRESHOLD = 0.55;
    const HISTORY_LIMIT = 15;
    const LOOKING_AWAY_LIMIT = 3;
    const CONFUSION_EMOTIONS = ["fear", "surprise", "disgust"];

    const participantState = {};
    const classSnapshots = [];
    const alerts = [];
    const cooldowns = {};

    let sessionStartedAt = Date.now();

    function now() {
        return Date.now();
    }

    function normalizeEmotion(emotion) {
        return String(emotion || "unknown").toLowerCase().trim();
    }

    function getEngagementState(emotion, confidence = 1.0) {
        const e = normalizeEmotion(emotion);
        const baseScore = EMOTION_SCORES[e] ?? 0.50;

        if (confidence < CONFIDENCE_THRESHOLD) {
            return "Uncertain";
        }

        if (baseScore >= 0.60) return "Engaged";
        if (baseScore <= 0.35) return "Not Engaged";
        return "Uncertain";
    }

    function getMajorEmotion(history) {
        if (!history.length) return null;

        const counts = {};
        history.forEach(item => {
            const key = normalizeEmotion(item.emotion || item);
            counts[key] = (counts[key] || 0) + 1;
        });

        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }

    function setParticipant(tileId, displayName, isLocal = false) {
        if (!participantState[tileId]) {
            participantState[tileId] = {
                name: displayName || tileId,
                isLocal,
                history: [],
                currentEmotion: null,
                currentStatus: null,
                currentHeadDirection: null,
                currentYaw: null,
                phoneDetected: false,
                finalStatus: null,
                emotionCounts: {},
                engagementScore: 50,
                lookingAwayCount: 0
            };
        } else {
            participantState[tileId].name = displayName || participantState[tileId].name;
            participantState[tileId].isLocal = isLocal;
        }
    }

    function removeParticipant(tileId) {
        delete participantState[tileId];
        updateDashboard();
    }

    function getTrackedStudents() {
        return Object.entries(participantState)
            .filter(([_, state]) => !state.isLocal);
    }

    function addAlert(message, key = "general") {
        const current = now();
        const cooldownMs = 12000;

        if (cooldowns[key] && current - cooldowns[key] < cooldownMs) return;
        cooldowns[key] = current;

        alerts.unshift({
            message,
            at: new Date().toLocaleTimeString()
        });

        if (alerts.length > 8) alerts.pop();
        renderAlerts();
    }

    function renderAlerts() {
        const alertList = document.getElementById("alertList");
        if (!alertList) return;

        if (!alerts.length) {
            alertList.innerHTML = "No alerts yet.";
            return;
        }

        alertList.innerHTML = alerts
            .map(a => `<div class="alert-item"><b>Alert</b> ${a.message} <span class="muted">(${a.at})</span></div>`)
            .join("");
    }

    function renderDistribution(stats) {
        const distText = document.getElementById("distText");
        if (!distText) return;

        const emotionLine = Object.entries(stats.emotionCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([emotion, count]) => `${emotion}: ${count}`)
            .join(" | ");

        const pct = (value) => stats.total ? Math.round((value / stats.total) * 100) : 0;

        distText.innerHTML = `
            <div class="dist-row"><span>Concentrating</span><b>${stats.concentrating}/${stats.total}</b></div>
            <div class="dist-bar"><span style="--value:${pct(stats.concentrating)}%"></span></div>
            <div class="dist-row"><span>Not concentrating</span><b>${stats.notConcentrating}/${stats.total}</b></div>
            <div class="dist-bar"><span style="--value:${pct(stats.notConcentrating)}%"></span></div>
            <div class="dist-row"><span>Possibly not concentrating</span><b>${stats.possiblyNot}/${stats.total}</b></div>
            <div class="dist-bar"><span style="--value:${pct(stats.possiblyNot)}%"></span></div>
            <div class="dist-row"><span>Looking forward</span><b>${stats.lookingForward}/${stats.total}</b></div>
            <div class="dist-bar"><span style="--value:${pct(stats.lookingForward)}%"></span></div>
            <div class="dist-row"><span>Phone detected</span><b>${stats.phoneDetected}/${stats.total}</b></div>
            <div class="dist-bar"><span style="--value:${pct(stats.phoneDetected)}%"></span></div>
            <span class="muted">${emotionLine || "No emotion data yet."}</span>
        `;
    }

    function renderSummaryText(text) {
        const el = document.getElementById("sessionSummaryText");
        if (el) el.innerHTML = text;
    }

    function updateTrend(currentEngagement) {
        const currentTime = now();

        classSnapshots.push({
            time: currentTime,
            engagement: currentEngagement
        });

        const cutoff = currentTime - 30000;
        while (classSnapshots.length && classSnapshots[0].time < cutoff) {
            classSnapshots.shift();
        }

        const kpiRate = document.getElementById("kpiRate");
        if (!kpiRate) return;

        if (classSnapshots.length < 2) {
            kpiRate.textContent = `${currentEngagement}% now`;
            return;
        }

        const first = classSnapshots[0].engagement;
        const last = classSnapshots[classSnapshots.length - 1].engagement;
        const diff = last - first;

        let trendText = `${first}% to ${last}%`;
        if (diff > 0) trendText += " up";
        else if (diff < 0) trendText += " down";

        kpiRate.textContent = trendText;
    }

    function checkSuddenDrop(tileId, state) {
        if (state.history.length < 6) return;

        const previousChunk = state.history.slice(-6, -3);
        const currentChunk = state.history.slice(-3);

        const prevMajor = getMajorEmotion(previousChunk);
        const currMajor = getMajorEmotion(currentChunk);

        if (!prevMajor || !currMajor) return;

        const prevState = getEngagementState(prevMajor);
        const currState = getEngagementState(currMajor);

        if (prevState === "Engaged" && currState === "Not Engaged") {
            addAlert(`${state.name} lost engagement`, `drop-${tileId}`);
        }
    }

    function checkMultipleConfusion() {
        const students = getTrackedStudents();
        const confused = students.filter(([_, state]) =>
            CONFUSION_EMOTIONS.includes(normalizeEmotion(state.currentEmotion))
        );

        if (confused.length >= 2) {
            addAlert(`Multiple students may be confused`, "multi-confusion");
        }
    }

    function updateDashboard() {
        const students = getTrackedStudents();
        const total = students.length;

        const kpiEng = document.getElementById("kpiEng");
        const kpiTop = document.getElementById("kpiTop");
        const kpiPhone = document.getElementById("kpiPhone");
        const kpiForward = document.getElementById("kpiForward");
        const kpiDistracted = document.getElementById("kpiDistracted");
        if (!total) {
            if (kpiEng) kpiEng.textContent = "-";
            if (kpiTop) kpiTop.textContent = "-";
            if (kpiPhone) kpiPhone.textContent = "-";
            if (kpiForward) kpiForward.textContent = "-";
            if (kpiDistracted) kpiDistracted.textContent = "-";

            const kpiRate = document.getElementById("kpiRate");
            if (kpiRate) kpiRate.textContent = "-";

            renderDistribution({
                total: 0,
                concentrating: 0,
                notConcentrating: 0,
                possiblyNot: 0,
                lookingForward: 0,
                phoneDetected: 0,
                emotionCounts: {}
            });
            return;
        }

        let concentrating = 0;
        let notConcentrating = 0;
        let possiblyNot = 0;
        let lookingForward = 0;
        let phoneDetected = 0;

        const emotionCounts = {};

        students.forEach(([_, state]) => {
            const emotion = normalizeEmotion(state.currentEmotion);
            emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;

            const finalStatus = state.finalStatus || state.currentStatus || "Unknown";

            if (finalStatus === "Concentrating") concentrating++;
            else if (finalStatus === "Possibly Not Concentrating") possiblyNot++;
            else notConcentrating++;

            if (state.currentHeadDirection === "Looking Forward") lookingForward++;
            if (state.phoneDetected) phoneDetected++;
        });

        const concentrationPercent = Math.round((concentrating / total) * 100);
        const distractedCount = notConcentrating + possiblyNot;
        const topEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

        if (kpiEng) kpiEng.textContent = `${concentrationPercent}%`;
        if (kpiTop) kpiTop.textContent = topEmotion;
        if (kpiPhone) kpiPhone.textContent = `${phoneDetected}`;
        if (kpiForward) kpiForward.textContent = `${lookingForward}/${total}`;
        if (kpiDistracted) kpiDistracted.textContent = `${distractedCount}/${total}`;

        updateTrend(concentrationPercent);

        renderDistribution({
            total,
            concentrating,
            notConcentrating,
            possiblyNot,
            lookingForward,
            phoneDetected,
            emotionCounts
        });

        if (phoneDetected > 0) {
            addAlert(`${phoneDetected} student(s) may be using a phone`, "phone-detected");
        }

        if (distractedCount >= Math.ceil(total / 2)) {
            addAlert(`Many students may not be concentrating`, "many-distracted");
        }

        checkMultipleConfusion();
    }


    function calculateSmoothedEngagement(state) {
        if (!state.history.length) {
            return {
                score: 50,
                status: "Uncertain"
            };
        }

        const recent = state.history.slice(-HISTORY_LIMIT);

        let totalWeight = 0;
        let weightedScore = 0;

        recent.forEach((item, index) => {
            const emotion = normalizeEmotion(item.emotion);
            const confidence = item.confidence ?? 1.0;
            const baseScore = EMOTION_SCORES[emotion] ?? 0.50;

            const recencyWeight = index + 1;
            const confidenceWeight = Math.max(confidence, 0.25);
            const weight = recencyWeight * confidenceWeight;

            weightedScore += baseScore * weight;
            totalWeight += weight;
        });

        let score = totalWeight > 0 ? weightedScore / totalWeight : 0.50;

        // Phone = definitely not concentrating
        if (state.phoneDetected) {
            return {
                score: 0,
                status: "Not Concentrating"
            };
        }

        // Looking away should NOT instantly mean not engaged.
        // It only reduces score if repeated several times.
        if (state.lookingAwayCount >= LOOKING_AWAY_LIMIT) {
            score -= 0.20;
        }

        score = Math.max(0, Math.min(1, score));

        let status = "Uncertain";

        if (score >= 0.60) {
            status = "Concentrating";
        } else if (score >= 0.40) {
            status = "Possibly Not Concentrating";
        } else {
            status = "Not Concentrating";
        }

        return {
            score: Math.round(score * 100),
            status
        };
    }


    function recordEmotion(tileId, emotion, confidence = 1.0) {
        const state = participantState[tileId];
        if (!state) return;

        const cleanEmotion = normalizeEmotion(emotion);
        const engagementState = getEngagementState(cleanEmotion, confidence);

        state.currentEmotion = cleanEmotion;

        state.history.push({
            emotion: cleanEmotion,
            confidence,
            status: engagementState,
            time: now()
        });

        if (state.history.length > HISTORY_LIMIT) {
            state.history.shift();
        }

        state.emotionCounts[cleanEmotion] =
            (state.emotionCounts[cleanEmotion] || 0) + 1;

        const result = calculateSmoothedEngagement(state);

        state.engagementScore = result.score;
        state.currentStatus = result.status;
        state.finalStatus = result.status;

        if (!state.isLocal) {
            checkSuddenDrop(tileId, state);
            updateDashboard();
        }
    }



    function recordAttention(tileId, attentionData) {
        const state = participantState[tileId];
        if (!state) return;

        state.currentHeadDirection = attentionData.headDirection || "Unknown";
        state.currentYaw = attentionData.yaw;
        state.phoneDetected = !!attentionData.phoneDetected;

        const dir = state.currentHeadDirection;

        if (
            dir === "Looking Left" ||
            dir === "Looking Right" ||
            dir === "Looking Away"
        ) {
            state.lookingAwayCount = (state.lookingAwayCount || 0) + 1;
        } else if (dir === "Looking Forward") {
            state.lookingAwayCount = 0;
        }

        const result = calculateSmoothedEngagement(state);

        state.engagementScore = result.score;
        state.currentStatus = result.status;
        state.finalStatus = result.status;

        if (!state.isLocal) {
            updateDashboard();
        }
    }


    function getParticipantStatus(tileId) {
        return participantState[tileId]?.currentStatus || null;
    }

    function getFinalSummary() {
        const students = getTrackedStudents();
        if (!students.length) {
            return {
                averageEngagement: 0,
                mostCommonEmotion: "-",
                lowestMomentText: "No data",
                totalStudents: 0
            };
        }

        const snapshotValues = classSnapshots.map(s => s.engagement);
        const averageEngagement = snapshotValues.length
            ? Math.round(snapshotValues.reduce((a, b) => a + b, 0) / snapshotValues.length)
            : 0;

        const overallEmotionCounts = {};
        students.forEach(([_, state]) => {
            Object.entries(state.emotionCounts).forEach(([emotion, count]) => {
                overallEmotionCounts[emotion] = (overallEmotionCounts[emotion] || 0) + count;
            });
        });

        const mostCommonEmotion =
            Object.entries(overallEmotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

        let lowestMomentText = "No data";
        if (classSnapshots.length) {
            const lowest = classSnapshots.reduce((min, s) =>
                s.engagement < min.engagement ? s : min
            );
            const minute = Math.max(
                1,
                Math.round((lowest.time - sessionStartedAt) / 60000)
            );
            lowestMomentText = `Minute ${minute} (${lowest.engagement}%)`;
        }

        return {
            averageEngagement,
            mostCommonEmotion,
            lowestMomentText,
            totalStudents: students.length
        };
    }


    function getFullSessionData() {
        const students = getTrackedStudents().map(([id, state]) => {
            return {
                id,
                name: state.name,
                currentEmotion: state.currentEmotion,
                currentStatus: state.currentStatus,
                finalStatus: state.finalStatus,
                engagementScore: state.engagementScore,
                headDirection: state.currentHeadDirection,
                yaw: state.currentYaw,
                phoneDetected: state.phoneDetected,
                lookingAwayCount: state.lookingAwayCount,
                dominantEmotion: getMajorEmotion(state.history),
                emotionCounts: state.emotionCounts,
                history: state.history
            };
        });

        return {
            room: window.roomName || "",
            generatedAt: new Date().toISOString(),
            summary: getFinalSummary(),
            students
        };
    }




    function finalizeSession() {
        const summary = getFinalSummary();

        const summaryText = `
            Average engagement: <b>${summary.averageEngagement}%</b><br>
            Most common emotion: <b>${summary.mostCommonEmotion}</b><br>
            Lowest engagement moment: <b>${summary.lowestMomentText}</b>
        `;

        renderSummaryText(summaryText);

        const historyKey = "fer-meet-session-summaries";
        const oldHistory = JSON.parse(localStorage.getItem(historyKey) || "[]");
        oldHistory.push({
            createdAt: new Date().toISOString(),
            summary
        });
        localStorage.setItem(historyKey, JSON.stringify(oldHistory));

        return summary;
    }

    window.Analysis = {
        setParticipant,
        removeParticipant,
        recordEmotion,
        recordAttention,
        getParticipantStatus,
        getEngagementState,
        updateDashboard,
        finalizeSession,
        getFullSessionData
    };
})();
