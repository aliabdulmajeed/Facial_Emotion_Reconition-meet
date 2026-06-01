# backend_feedback.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Optional
from datetime import datetime
import os
import json

from pydantic import BaseModel
from openai import OpenAI

# =========================
# GROQ SETUP
# =========================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1"
) if GROQ_API_KEY else None

# =========================
# FASTAPI APP
# =========================

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session_data: Dict[str, Dict] = {}
questionnaire_data: List[Dict[str, Any]] = []
SESSION_ANALYTICS_WEIGHT = 0.70
QUESTIONNAIRE_WEIGHT = 0.30


class StudentSignal(BaseModel):
    room: str
    studentId: str
    studentName: str
    emotion: Optional[str] = "unknown"
    emotionStatus: Optional[str] = "Unknown"
    headDirection: Optional[str] = "Unknown"
    yaw: Optional[float] = None
    phoneDetected: Optional[bool] = False
    finalStatus: Optional[str] = "Unknown"
    timestamp: Optional[str] = None


@app.get("/")
def root():
    return {"message": "Feedback backend is running with GROQ"}


@app.post("/questionnaire")
async def questionnaire(payload: Dict[str, Any]):
    questionnaire_data.append({
        **payload,
        "receivedAt": datetime.now().isoformat()
    })

    return {"saved": True}


@app.post("/collect")
def collect_signal(signal: StudentSignal):
    room = signal.room
    student_id = signal.studentId

    if room not in session_data:
        session_data[room] = {}

    if student_id not in session_data[room]:
        session_data[room][student_id] = {
            "studentName": signal.studentName,
            "joinedAt": signal.timestamp or datetime.now().isoformat(),
            "leftAt": None,
            "records": [],
            "events": [],
            "lastEventKeys": {},
            "lowAttentionSince": None
        }

    student = session_data[room][student_id]
    timestamp = signal.timestamp or datetime.now().isoformat()

    student["records"].append({
        "emotion": signal.emotion,
        "emotionStatus": signal.emotionStatus,
        "headDirection": signal.headDirection,
        "yaw": signal.yaw,
        "phoneDetected": signal.phoneDetected,
        "finalStatus": signal.finalStatus,
        "timestamp": timestamp
    })

    def save_event(event_type: str, message: str, severity: str = "medium"):
        event_key = f"{event_type}:{message}"
        previous = student["lastEventKeys"].get(event_key)
        if previous:
            try:
                elapsed = (
                    datetime.fromisoformat(timestamp.replace("Z", "+00:00")) -
                    datetime.fromisoformat(previous.replace("Z", "+00:00"))
                ).total_seconds()
                if elapsed < 120:
                    return
            except Exception:
                return

        student["lastEventKeys"][event_key] = timestamp

        try:
            display_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).strftime("%H:%M")
        except Exception:
            display_time = datetime.now().strftime("%H:%M")

        full_message = f"{message} at {display_time}"
        if student["events"] and student["events"][-1].get("message") == full_message:
            return

        student["events"].append({
            "type": event_type,
            "severity": severity,
            "message": full_message,
            "studentName": signal.studentName,
            "timestamp": timestamp,
            "displayTime": display_time
        })
        student["events"] = student["events"][-80:]

    emotion = str(signal.emotion or "unknown").lower()
    if signal.phoneDetected:
        save_event("phone", f"{signal.studentName} used a phone", "high")
    if signal.headDirection in ["Looking Left", "Looking Right", "Looking Away"]:
        save_event("looked_away", f"{signal.studentName} looked away", "medium")
    if signal.headDirection == "No Face":
        save_event("no_face", f"{signal.studentName} left the camera view", "medium")
    if signal.finalStatus == "Not Concentrating":
        student["lowAttentionSince"] = student.get("lowAttentionSince") or timestamp
        try:
            low_attention_seconds = (
                datetime.fromisoformat(timestamp.replace("Z", "+00:00")) -
                datetime.fromisoformat(student["lowAttentionSince"].replace("Z", "+00:00"))
            ).total_seconds()
        except Exception:
            low_attention_seconds = 0

        if low_attention_seconds >= 120:
            save_event("attention", f"{signal.studentName} had low attention for about 2 minutes", "medium")
    else:
        student["lowAttentionSince"] = None

    if emotion in ["angry", "anger", "fear", "sad", "disgust"]:
        save_event("emotion_warning", f"{signal.studentName} showed repeated stress or confusion signals ({emotion})", "medium")

    student["records"] = student["records"][-300:]

    return {"saved": True}


def summarize_student(records: List[Dict[str, Any]]):
    total = len(records)

    if total == 0:
        return {
            "totalSamples": 0,
            "concentrationPercent": 0,
            "phonePercent": 0,
            "lookingForwardPercent": 0,
            "topEmotion": "unknown",
            "emotionCounts": {},
            "finalStatusCounts": {}
        }

    emotion_counts = {}
    final_counts = {
        "Concentrating": 0,
        "Not Concentrating": 0,
        "Possibly Not Concentrating": 0,
        "Unknown": 0
    }

    phone_count = 0
    forward_count = 0

    for r in records:
        emotion = r.get("emotion", "unknown")
        emotion_counts[emotion] = emotion_counts.get(emotion, 0) + 1

        final_status = r.get("finalStatus", "Unknown")
        final_counts[final_status] = final_counts.get(final_status, 0) + 1

        if r.get("phoneDetected"):
            phone_count += 1

        if r.get("headDirection") == "Looking Forward":
            forward_count += 1

    concentration_percent = round((final_counts.get("Concentrating", 0) / total) * 100, 1)
    phone_percent = round((phone_count / total) * 100, 1)
    forward_percent = round((forward_count / total) * 100, 1)

    top_emotion = max(emotion_counts.items(), key=lambda x: x[1])[0] if emotion_counts else "unknown"

    return {
        "totalSamples": total,
        "concentrationPercent": concentration_percent,
        "phonePercent": phone_percent,
        "lookingForwardPercent": forward_percent,
        "topEmotion": top_emotion,
        "emotionCounts": emotion_counts,
        "finalStatusCounts": final_counts
    }


def clamp_score(value: Any, default: int = 50) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return default


def weighted_score(live_score: Any, questionnaire_score: Any) -> int:
    live = clamp_score(live_score, 0)
    questionnaire = clamp_score(questionnaire_score, live)
    return clamp_score(
        (live * SESSION_ANALYTICS_WEIGHT) + (questionnaire * QUESTIONNAIRE_WEIGHT),
        live
    )


def questionnaire_summary(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not items:
        return {
            "count": 0,
            "averageRating": None,
            "byRole": {},
            "answers": []
        }

    role_totals: Dict[str, List[float]] = {}
    answers = []
    all_ratings: List[float] = []

    for item in items:
        role = item.get("role", "unknown")
        rating = item.get("averageRating")
        if isinstance(rating, (int, float)):
            all_ratings.append(float(rating))
            role_totals.setdefault(role, []).append(float(rating))

        answers.append({
            "name": item.get("name"),
            "role": role,
            "averageRating": rating,
            "ratings": [
                {
                    "questionNumber": r.get("questionNumber"),
                    "rating": r.get("rating")
                }
                for r in item.get("ratings", [])
            ]
        })

    return {
        "count": len(items),
        "averageRating": round(sum(all_ratings) / len(all_ratings), 2) if all_ratings else None,
        "byRole": {
            role: round(sum(values) / len(values), 2)
            for role, values in role_totals.items()
            if values
        },
        "answers": answers[-20:]
    }


def emotion_percentages(emotion_counts: Dict[str, Any]) -> Dict[str, int]:
    total = sum(float(value or 0) for value in emotion_counts.values())
    if total <= 0:
        return {}

    return {
        emotion: round((float(count or 0) / total) * 100)
        for emotion, count in emotion_counts.items()
    }


def collected_student_summary(student_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    records = data.get("records", [])
    events = data.get("events", [])
    summary = summarize_student(records)
    emotion_percents = emotion_percentages(summary.get("emotionCounts", {}))
    last_record = records[-1] if records else {}
    stress_level = sum(
        emotion_percents.get(emotion, 0)
        for emotion in ["angry", "anger", "fear", "sad", "disgust"]
    )
    emotion_balance = (
        emotion_percents.get("happy", 0) +
        emotion_percents.get("neutral", 0) +
        round(emotion_percents.get("surprise", 0) * 0.5)
    )
    concentration = clamp_score(summary.get("concentrationPercent"), 0)
    forward = clamp_score(summary.get("lookingForwardPercent"), concentration)
    phone_percent = clamp_score(summary.get("phonePercent"), 0)
    engagement = clamp_score(
        (concentration * 0.45) +
        (forward * 0.25) +
        (emotion_balance * 0.20) +
        ((100 - phone_percent) * 0.10),
        concentration
    )
    participation = clamp_score(
        65 + (forward * 0.2) - (phone_percent * 0.25) - (len(events) * 2),
        engagement
    )

    return {
        "id": student_id,
        "name": data.get("studentName", "Student"),
        "active": data.get("leftAt") is None,
        "joinedAt": data.get("joinedAt"),
        "leftAt": data.get("leftAt"),
        "engagementScore": engagement,
        "concentrationLevel": concentration,
        "attentionLevel": forward,
        "participationLevel": participation,
        "confusionLevel": clamp_score(stress_level, 0),
        "finalStatus": last_record.get("finalStatus", "Unknown"),
        "dominantEmotion": summary.get("topEmotion", "unknown"),
        "emotionPercentages": emotion_percents,
        "emotionBalance": clamp_score(emotion_balance, engagement),
        "headDirection": last_record.get("headDirection", "Unknown"),
        "lookingAwayCount": len([event for event in events if event.get("type") == "looked_away"]),
        "phoneDetected": phone_percent > 0,
        "phonePercent": phone_percent,
        "sampleCount": summary.get("totalSamples", 0),
        "events": events[-20:],
        "questionnaire": None
    }


def collected_room_students(room: str) -> List[Dict[str, Any]]:
    if room not in session_data:
        return []

    return [
        collected_student_summary(student_id, data)
        for student_id, data in session_data[room].items()
    ]


def find_student_by_requester(students: List[Dict[str, Any]], requester_name: str) -> Optional[Dict[str, Any]]:
    clean_requester = str(requester_name or "").replace(" (You)", "").strip().lower()
    if not clean_requester:
        return students[0] if students else None

    for student in students:
        clean_name = str(student.get("name", "")).replace(" (You)", "").strip().lower()
        if clean_name == clean_requester:
            return student

    for student in students:
        clean_name = str(student.get("name", "")).replace(" (You)", "").strip().lower()
        if clean_requester in clean_name or clean_name in clean_requester:
            return student

    return students[0] if students else None


def ensure_structured_has_recorded_data(
    structured: Dict[str, Any],
    room: str,
    requester_name: str,
    requester_role: str
) -> Dict[str, Any]:
    recorded_students = collected_room_students(room)
    if not recorded_students:
        return structured

    students = structured.get("students")
    if not isinstance(students, list) or not students:
        structured["students"] = recorded_students

    if requester_role != "instructor":
        student = structured.get("student")
        sample_count = 0
        if isinstance(student, dict):
            sample_count = int(student.get("sampleCount") or 0)

        if not isinstance(student, dict) or sample_count == 0:
            structured["student"] = find_student_by_requester(recorded_students, requester_name)

    return structured


def score_from_questionnaire(data: Dict[str, Any], fallback: int) -> int:
    avg_rating = (data.get("questionnaires", {}) or {}).get("averageRating")
    if avg_rating is None:
        return fallback
    return clamp_score(float(avg_rating) * 20, fallback)


def add_questionnaire_weighting(structured: Dict[str, Any], role: str) -> Dict[str, Any]:
    questionnaire_score = score_from_questionnaire(structured, None)
    questionnaire_available = questionnaire_score is not None

    structured["feedbackWeights"] = {
        "liveSessionAnalytics": SESSION_ANALYTICS_WEIGHT,
        "questionnaire": QUESTIONNAIRE_WEIGHT,
        "questionnaireAvailable": questionnaire_available,
        "questionnaireScore": questionnaire_score
    }

    if role == "instructor":
        summary = structured.get("sessionSummary", {})
        live_engagement = clamp_score(summary.get("averageEngagement"), 0)
        live_concentration = clamp_score(summary.get("lookingForwardPercent"), live_engagement)
        live_attention = live_concentration
        q_score = questionnaire_score if questionnaire_available else live_engagement

        summary["weightedEngagement"] = weighted_score(live_engagement, q_score)
        summary["weightedConcentration"] = weighted_score(live_concentration, q_score)
        summary["weightedAttention"] = weighted_score(live_attention, q_score)
        summary["questionnaireImpactPercent"] = int(QUESTIONNAIRE_WEIGHT * 100)
        structured["sessionSummary"] = summary
        return structured

    student = structured.get("student")
    if isinstance(student, dict):
        live_engagement = clamp_score(student.get("engagementScore"), 0)
        live_concentration = clamp_score(student.get("concentrationLevel"), live_engagement)
        live_attention = clamp_score(student.get("attentionLevel"), live_concentration)
        live_participation = clamp_score(student.get("participationLevel"), live_engagement)
        live_stress_control = 100 - clamp_score(student.get("confusionLevel"), 0)
        q_score = questionnaire_score if questionnaire_available else live_engagement

        student["weightedEngagement"] = weighted_score(live_engagement, q_score)
        student["weightedConcentration"] = weighted_score(live_concentration, q_score)
        student["weightedAttention"] = weighted_score(live_attention, q_score)
        student["weightedParticipation"] = weighted_score(live_participation, q_score)
        student["weightedStressControl"] = weighted_score(live_stress_control, q_score)
        student["weightedUnderstanding"] = weighted_score(
            round((live_engagement + live_concentration) / 2),
            q_score
        )
        student["overallPerformance"] = clamp_score(
            (student["weightedEngagement"] * 0.25) +
            (student["weightedConcentration"] * 0.25) +
            (student["weightedUnderstanding"] * 0.20) +
            (student["weightedParticipation"] * 0.15) +
            (student["weightedStressControl"] * 0.15),
            student["weightedEngagement"]
        )
        student["questionnaireImpactPercent"] = int(QUESTIONNAIRE_WEIGHT * 100)
        structured["student"] = student

    return structured


def normalize_visual_scores(visual: Dict[str, Any], role: str, data: Dict[str, Any]) -> Dict[str, Any]:
    bars = visual.get("bars", [])
    if not isinstance(bars, list):
        return visual

    if role == "instructor":
        summary = data.get("sessionSummary", {})
        support_count = len(data.get("studentsNeedingSupport", []) or [])
        engagement = clamp_score(summary.get("weightedEngagement"), summary.get("averageEngagement", 0))
        concentration = clamp_score(summary.get("weightedConcentration"), summary.get("lookingForwardPercent", engagement))
        attention = clamp_score(summary.get("weightedAttention"), summary.get("lookingForwardPercent", concentration))
        score_by_key = {
            "engagement": engagement,
            "concentration": concentration,
            "attention": attention,
            "support": 100 - clamp_score(support_count * 20, 0),
            "distraction": 100 - clamp_score(summary.get("phonePercent"), 0),
            "teaching": weighted_score(summary.get("averageEngagement"), score_from_questionnaire(data, engagement)),
            "overall": engagement,
        }
    else:
        student = data.get("student", {}) if isinstance(data.get("student"), dict) else {}
        engagement = clamp_score(student.get("weightedEngagement"), student.get("engagementScore", 0))
        concentration = clamp_score(student.get("weightedConcentration"), student.get("concentrationLevel", engagement))
        attention = clamp_score(student.get("weightedAttention"), student.get("attentionLevel", concentration))
        stress_control = clamp_score(student.get("weightedStressControl"), 100 - clamp_score(student.get("confusionLevel"), 0))
        habits = 100 - clamp_score(student.get("phonePercent"), 0)
        understanding = clamp_score(student.get("weightedUnderstanding"), score_from_questionnaire(data, engagement))
        participation = clamp_score(student.get("weightedParticipation"), student.get("participationLevel", engagement))
        overall = clamp_score(student.get("overallPerformance"), engagement)
        score_by_key = {
            "engagement": engagement,
            "concentration": concentration,
            "attention": attention,
            "understanding": understanding,
            "stress": stress_control,
            "confusion": stress_control,
            "participation": participation,
            "habit": habits,
            "overall": overall,
            "performance": overall,
        }

    for bar in bars:
        label = str(bar.get("label", "")).lower()
        for key, score in score_by_key.items():
            if key in label:
                bar["score"] = score
                bar["tone"] = "high" if score >= 70 else "medium" if score >= 45 else "low"
                break

    visual["bars"] = bars
    return visual


def parse_visual_feedback(raw_text: str, role: str, fallback_data: Dict[str, Any]) -> Dict[str, Any]:
    try:
        parsed = json.loads(raw_text)
        bars = parsed.get("bars", [])
        clean_bars = []

        for item in bars[:6]:
            detail = str(item.get("detail", "No detail available."))[:180]
            if "70%" in detail or "30%" in detail or "weighted" in detail.lower():
                detail = "Based on the combined session signals and submitted feedback."

            clean_bars.append({
                "label": str(item.get("label", "Score"))[:40],
                "score": clamp_score(item.get("score")),
                "tone": item.get("tone", "medium") if item.get("tone") in ["low", "medium", "high"] else "medium",
                "detail": detail
            })

        if clean_bars:
            return {
                "role": role,
                "headline": str(parsed.get("headline", "Session feedback"))[:80],
                "bars": clean_bars
            }
    except Exception:
        pass

    return build_fallback_visual_feedback(role, fallback_data)


def build_fallback_visual_feedback(role: str, data: Dict[str, Any]) -> Dict[str, Any]:
    if role == "instructor":
        summary = data.get("sessionSummary", {})
        engagement = clamp_score(summary.get("weightedEngagement"), summary.get("averageEngagement", 50))
        forward = clamp_score(summary.get("weightedAttention"), summary.get("lookingForwardPercent", 70))
        clarity = clamp_score(summary.get("weightedConcentration"), forward)
        return {
            "role": "instructor",
            "headline": "Class session overview",
            "bars": [
                {
                    "label": "Class Engagement",
                    "score": engagement,
                    "tone": "high" if engagement >= 70 else "medium" if engagement >= 45 else "low",
                    "detail": "Based on the average engagement score across tracked students."
                },
                {
                    "label": "Concentration",
                    "score": clarity,
                    "tone": "high" if clarity >= 70 else "medium" if clarity >= 45 else "low",
                    "detail": "Based on combined attention signals and submitted feedback."
                },
                {
                    "label": "Attention Stability",
                    "score": forward,
                    "tone": "high" if forward >= 70 else "medium" if forward >= 45 else "low",
                    "detail": "Based on how often students appeared to remain oriented toward the session."
                },
                {
                    "label": "Support Needed",
                    "score": 100 - clamp_score(len(data.get("studentsNeedingSupport", [])) * 20, 0),
                    "tone": "medium",
                    "detail": "Highlights students with repeated low attention, stress, or distraction events."
                }
            ]
        }

    student = data.get("student", {})
    engagement = clamp_score(student.get("weightedEngagement"), student.get("engagementScore", 55))
    concentration = clamp_score(student.get("weightedConcentration"), engagement)
    habits = 100 - clamp_score(student.get("phonePercent"), 0)
    confusion = clamp_score(student.get("weightedStressControl"), 100 - clamp_score(student.get("confusionLevel"), 0))
    participation = clamp_score(student.get("weightedParticipation"), student.get("participationLevel", engagement))
    understanding = clamp_score(student.get("weightedUnderstanding"), engagement)
    overall = clamp_score(student.get("overallPerformance"), engagement)
    return {
        "role": "student",
        "headline": "Your session snapshot",
        "bars": [
            {
                "label": "Engagement",
                "score": engagement,
                "tone": "high" if engagement >= 70 else "medium" if engagement >= 45 else "low",
                "detail": "Based on your overall engagement estimate during the session."
            },
                {
                    "label": "Concentration",
                    "score": concentration,
                    "tone": "high" if concentration >= 70 else "medium" if concentration >= 45 else "low",
                    "detail": "Based on your attention signals and submitted feedback."
                },
            {
                "label": "Understanding",
                "score": understanding,
                "tone": "high" if understanding >= 70 else "medium" if understanding >= 45 else "low",
                "detail": "Uses your session behavior and your questionnaire answers together."
            },
            {
                "label": "Stress Control",
                "score": confusion,
                "tone": "high" if confusion >= 70 else "medium" if confusion >= 45 else "low",
                "detail": "Lower stress or confusion signals usually mean the session felt easier to follow."
            },
            {
                "label": "Participation",
                "score": participation,
                "tone": "high" if participation >= 70 else "medium" if participation >= 45 else "low",
                "detail": "Based on presence, camera visibility, attention signals, and session activity."
            },
                {
                    "label": "Overall Performance",
                    "score": overall,
                    "tone": "high" if overall >= 70 else "medium" if overall >= 45 else "low",
                    "detail": f"Overall score reflects attention, participation, feedback, and device habits."
                }
        ]
    }


@app.get("/summary/{room}")
def get_summary(room: str):
    if room not in session_data:
        return {"room": room, "students": []}

    students = []

    for student_id, data in session_data[room].items():
        students.append({
            "studentId": student_id,
            "studentName": data["studentName"],
            "joinedAt": data.get("joinedAt"),
            "leftAt": data.get("leftAt"),
            "events": data.get("events", []),
            "summary": summarize_student(data["records"])
        })

    return {
        "room": room,
        "students": students
    }    


@app.post("/session_feedback")
async def session_feedback(payload: Dict[str, Any]):
    room = payload.get("room", "unknown")
    requester = payload.get("requester", {})
    requester_name = requester.get("name", "User")
    requester_role = requester.get("role", "student")
    structured = payload.get("structuredFeedbackData") or payload
    structured = ensure_structured_has_recorded_data(
        structured,
        room,
        requester_name,
        requester_role
    )
    room_questionnaires = [
        q for q in questionnaire_data
        if q.get("room") == room
    ]
    local_questionnaire = structured.get("questionnaire")
    if isinstance(local_questionnaire, dict):
        local_name = str(local_questionnaire.get("name", "")).lower()
        local_role = str(local_questionnaire.get("role", "")).lower()
        already_saved = any(
            str(q.get("name", "")).lower() == local_name and
            str(q.get("role", "")).lower() == local_role and
            q.get("submittedAt") == local_questionnaire.get("submittedAt")
            for q in room_questionnaires
        )
        if not already_saved:
            room_questionnaires.append(local_questionnaire)

    if requester_role == "instructor":
        feedback_questionnaires = room_questionnaires
        feedback_instruction = (
            "Create instructor-only, class-level feedback. Focus on teaching pace, clarity, "
            "interaction, common difficulties, questionnaire trends, and class engagement."
        )
    else:
        feedback_questionnaires = [
            q for q in room_questionnaires
            if str(q.get("name", "")).lower() == str(requester_name).lower()
        ]
        feedback_instruction = (
            f"Create personal feedback only for {requester_name}. Do not compare with classmates. "
            "Keep it encouraging, simple, and action-oriented."
        )

    structured["questionnaires"] = questionnaire_summary(feedback_questionnaires)
    structured = add_questionnaire_weighting(structured, requester_role)

    prompt = f"""
You are an educational feedback assistant.

Use ONLY the structured analytics JSON below.
Return ONLY valid JSON with this exact shape:
{{
  "headline": "short title",
  "bars": [
    {{
      "label": "2 to 4 words",
      "score": 0,
      "tone": "low|medium|high",
      "detail": "one short explanation, max 22 words"
    }}
  ]
}}

Rules:
- Return 5 or 6 bars only.
- Student feedback must be personal, simple, encouraging.
- Instructor feedback must be class-level, analytical, and improvement-focused.
- Do not write paragraphs.
- Do not include raw student names in instructor details.
- Treat neutral emotion as normal concentration, not a problem.
- Use the weighted scores from the structured JSON internally, but do not mention weighting percentages or formulas to users.
- The structured JSON includes feedbackWeights and weighted scores. Prefer those weighted scores when choosing bar values.
- Mention uncertainty only briefly if useful.
- Student bars should cover: engagement, concentration, understanding, stress/confusion, participation, overall performance.
- Instructor bars should cover: class engagement, average concentration, support needed, emotion trends, distraction events, teaching improvement.
- Use event timestamps in detail text when relevant.

Requester:
{json.dumps({"name": requester_name, "role": requester_role})}

Feedback instruction:
{feedback_instruction}

Structured analytics:
{json.dumps(structured, indent=2)}
"""

    try:
        if client is None:
            raise RuntimeError("GROQ_API_KEY is not set")

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a supportive educational AI assistant."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.7,
            max_tokens=700
        )

        feedback_text = response.choices[0].message.content
        visual_feedback = parse_visual_feedback(feedback_text, requester_role, structured)
        visual_feedback = normalize_visual_scores(visual_feedback, requester_role, structured)

        return {
            "feedback": feedback_text,
            "visualFeedback": visual_feedback,
            "structuredFeedbackData": structured,
            "role": requester_role
        }

    except Exception as e:
        print("GROQ feedback error:", e)

        fallback_visual = build_fallback_visual_feedback(requester_role, structured)
        fallback_visual = normalize_visual_scores(fallback_visual, requester_role, structured)

        return {
            "feedback": json.dumps(fallback_visual),
            "visualFeedback": fallback_visual,
            "structuredFeedbackData": structured,
            "role": requester_role
        }


@app.get("/feedback/{room}")
def generate_feedback(room: str):
    if room not in session_data:
        return {"error": "No session data found."}

    students = []

    for student_id, data in session_data[room].items():
        students.append({
            "studentId": student_id,
            "studentName": data["studentName"],
            "summary": summarize_student(data["records"])
        })

    prompt = f"""
You are an educational AI assistant.

Session analytics:
{json.dumps(students, indent=2)}

Provide general instructor feedback and general student recommendations.
Use supportive language.
"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a supportive educational AI assistant."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.7,
            max_tokens=1000
        )

        feedback_text = response.choices[0].message.content

        return {
            "feedback": feedback_text
        }

    except Exception as e:
        print("GROQ feedback error:", e)

        return {
            "feedback": f"Fallback feedback because GROQ failed: {str(e)}"
        }
