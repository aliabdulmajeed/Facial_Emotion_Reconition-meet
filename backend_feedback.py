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

client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1"
)

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
            "records": []
        }

    session_data[room][student_id]["records"].append({
        "emotion": signal.emotion,
        "emotionStatus": signal.emotionStatus,
        "headDirection": signal.headDirection,
        "yaw": signal.yaw,
        "phoneDetected": signal.phoneDetected,
        "finalStatus": signal.finalStatus,
        "timestamp": signal.timestamp or datetime.now().isoformat()
    })

    session_data[room][student_id]["records"] = session_data[room][student_id]["records"][-100:]

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


@app.get("/summary/{room}")
def get_summary(room: str):
    if room not in session_data:
        return {"room": room, "students": []}

    students = []

    for student_id, data in session_data[room].items():
        students.append({
            "studentId": student_id,
            "studentName": data["studentName"],
            "summary": summarize_student(data["records"])
        })

    return {
        "room": room,
        "students": students
    }    


@app.post("/session_feedback")
async def session_feedback(payload: Dict[str, Any]):
    room = payload.get("room", "unknown")
    students = payload.get("students", [])
    summary = payload.get("summary", {})

    requester = payload.get("requester", {})
    requester_name = requester.get("name", "User")
    requester_role = requester.get("role", "student")

    room_questionnaires = [
        q for q in questionnaire_data
        if q.get("room") == room
    ]

    if requester_role == "instructor":
        feedback_instruction = """
Generate ONLY instructor feedback.
Do NOT generate individual private student feedback.
Use short academic terms.
Focus on:
- class attention
- concentration variance
- device distraction
- instructional action
"""
    else:
        feedback_instruction = f"""
Generate ONLY feedback for this student: {requester_name}.
Do NOT generate instructor feedback.
Do NOT mention or compare other students.
Use short academic terms.
Focus on:
- individual attention
- concentration level
- device distraction
- learning action
"""

    prompt = f"""
You are an educational AI assistant.

You will receive online learning analytics from one session.

Analytics include:
- Emotion recognition
- Head direction
- Phone detection
- Concentration status
- Questionnaire ratings

Important:
- Be supportive.
- Be professional.
- Do not diagnose students.
- Do not say a student was definitely lazy or distracted.
- Use soft language such as "may have", "seemed to", "could benefit from".
- Mention that AI signals are indicators only, not absolute truth.
- Keep feedback short, precise, and non-verbose.
- Use 3 to 4 bullet points only.
- Each bullet must be one short sentence.
- Avoid long paragraphs and casual wording.

Requester:
Name: {requester_name}
Role: {requester_role}

Feedback instruction:
{feedback_instruction}

Session Summary:
{json.dumps(summary, indent=2)}

Student Analytics:
{json.dumps(students, indent=2)}

Questionnaire Responses:
{json.dumps(room_questionnaires, indent=2)}

Return only concise bullet points.
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
            max_tokens=1200
        )

        feedback_text = response.choices[0].message.content

        return {
            "feedback": feedback_text,
            "role": requester_role
        }

    except Exception as e:
        print("GROQ feedback error:", e)

        if requester_role == "instructor":
            fallback = """
Instructor feedback:
The session analysis was received successfully.

- Review the overall class concentration level.
- Pay attention to repeated phone distraction or looking-away patterns.
- Use short check-in questions when engagement drops.
- Encourage students to ask questions when confused.
- Consider adding short interactive moments during long explanations.
"""
        else:
            fallback = f"""
Student feedback for {requester_name}:
The session analysis was received successfully.

- Try to keep your face visible during the session.
- Look toward the screen when following the lesson.
- Avoid phone distractions during learning time.
- Ask questions when you feel confused or less engaged.
- Remember: these AI signals are only indicators, not a final judgment.
"""

        return {
            "feedback": fallback,
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
