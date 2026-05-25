import os
from openai import OpenAI
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from PIL import Image
import io
import cv2

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as T
import timm

# ---------------- MODEL CONFIG ----------------
MODEL_PATH = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\public\models\clcm\best_model.pth"

MODEL_NAME = "efficientnet_b2"
IMG_SIZE = 224

LABELS = [
    "anger",
    "disgust",
    "fear",
    "happy",
    "neutral",
    "sad",
    "surprise"
]

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# ---------------- FASTAPI ----------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- MODEL CLASS ----------------
class EmotionNet(nn.Module):
    def __init__(self, num_classes=7, drop_rate=0.4):
        super().__init__()

        self.backbone = timm.create_model(
            MODEL_NAME,
            pretrained=False,
            num_classes=0,
            global_pool="avg"
        )

        feat_dim = self.backbone.num_features

        self.head = nn.Sequential(
            nn.Dropout(drop_rate),
            nn.Linear(feat_dim, 512),
            nn.SiLU(),
            nn.Dropout(drop_rate / 2),
            nn.Linear(512, num_classes)
        )

    def forward(self, x):
        return self.head(self.backbone(x))

# ---------------- LOAD MODEL ----------------
model = EmotionNet(num_classes=len(LABELS)).to(DEVICE)

state_dict = torch.load(MODEL_PATH, map_location=DEVICE)
model.load_state_dict(state_dict)

model.eval()

print("PyTorch FER model loaded successfully!")
print("Device:", DEVICE)

# ---------------- TRANSFORM ----------------
transform = T.Compose([
    T.Grayscale(num_output_channels=3),
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

# ---------------- FACE DETECTOR ----------------
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

def preprocess_face_from_pil(pil_img: Image.Image):
    img_rgb = np.array(pil_img.convert("RGB"))

    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.3,
        minNeighbors=5,
        minSize=(60, 60)
    )

    if len(faces) == 0:
        return None, None

    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])

    face_rgb = img_rgb[y:y+h, x:x+w]
    pil_face = Image.fromarray(face_rgb)

    x_input = transform(pil_face)
    x_input = x_input.unsqueeze(0).to(DEVICE)

    return x_input, (int(x), int(y), int(w), int(h))

# ---------------- ROUTES ----------------
@app.get("/")
def root():
    return {"message": "PyTorch FER backend is running"}

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    data = await file.read()
    pil_img = Image.open(io.BytesIO(data)).convert("RGB")

    pil_img.save("debug_received.jpg")

    x, face_box = preprocess_face_from_pil(pil_img)

    if x is None:
        return {
            "label": "no_face",
            "index": -1,
            "confidence": 0.0,
            "face_box": None,
            "top3": [],
            "probs": {}
        }

    with torch.no_grad():
        outputs = model(x)
        probs_tensor = F.softmax(outputs, dim=1)[0]

    probs = probs_tensor.cpu().numpy()

    idx = int(np.argmax(probs))
    confidence = float(probs[idx])

    top3_idx = np.argsort(probs)[-3:][::-1]

    top3 = [
        {
            "label": LABELS[i],
            "prob": float(probs[i])
        }
        for i in top3_idx
    ]

    print("Top 3:", top3)
    print("Predicted:", LABELS[idx], confidence)

    return {
        "label": LABELS[idx],
        "index": idx,
        "confidence": confidence,
        "face_box": face_box,
        "top3": top3,
        "probs": {
            LABELS[i]: float(probs[i]) for i in range(len(LABELS))
        }
    }

# ================= LLM FEEDBACK ROUTES =================

questionnaire_store = {}

@app.post("/api/questionnaire")
@app.post("/questionnaire")
async def save_questionnaire(data: dict):
    room = data.get("room", "unknown")

    if room not in questionnaire_store:
        questionnaire_store[room] = []

    questionnaire_store[room].append(data)

    return {
        "ok": True,
        "message": "Questionnaire saved",
        "room": room,
        "count": len(questionnaire_store[room])
    }


@app.post("/api/session_feedback")
@app.post("/session_feedback")
async def session_feedback(data: dict):
    room = data.get("room", "unknown")
    questionnaires = questionnaire_store.get(room, [])

    prompt = f"""
You are an educational feedback assistant for an online learning engagement system.

Analyze this session fairly and carefully.

Important rules:
- Do not judge students harshly from one emotion.
- Mention that emotion recognition may be uncertain.
- Phone detection is a strong sign of not concentrating.
- Looking left/right once should not automatically mean disengagement.
- Focus on helpful feedback for instructor and students.

SESSION ANALYSIS DATA:
{data}

QUESTIONNAIRE ANSWERS:
{questionnaires}

Provide feedback in this structure:

1. Overall Session Summary
2. Instructor Feedback
3. Student Engagement Analysis
4. Possible Reasons for Low Engagement
5. Recommendations for Next Session
"""

    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        return {
            "feedback": "Session data and questionnaire answers were collected successfully, but OPENAI_API_KEY was not found, so AI feedback was not generated."
        }

    client = OpenAI(api_key=api_key)

    response = client.responses.create(
        model="gpt-4.1-mini",
        input=prompt
    )

    return {
        "feedback": response.output_text
    }