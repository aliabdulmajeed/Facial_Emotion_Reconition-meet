import os
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from PIL import Image
import io
import cv2
import torch
import torch.nn as nn
from torchvision import models, transforms

YOLO_CONFIG_DIR = os.path.join(os.path.dirname(__file__), ".ultralytics")
os.makedirs(YOLO_CONFIG_DIR, exist_ok=True)
os.environ.setdefault("YOLO_CONFIG_DIR", YOLO_CONFIG_DIR)

from ultralytics import YOLO

# =========================
# Settings
# =========================

LEFT_THRESHOLD = -5
RIGHT_THRESHOLD = 5
YAW_GAIN = 2.2
PHONE_CONF_THRESHOLD = 0.35
IMG_SIZE = 224
YAW_MODEL_PATH = os.path.join(os.path.dirname(__file__), "best_yaw_model.pth")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Load models
# =========================

phone_model = YOLO("yolov8n.pt")
print("YOLO phone model loaded successfully!")

face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

class YawRegressionModel(nn.Module):
    def __init__(self):
        super().__init__()

        self.backbone = models.efficientnet_b0(weights=None)
        in_features = self.backbone.classifier[1].in_features
        self.backbone.classifier = nn.Sequential(
            nn.Dropout(0.4),
            nn.Linear(in_features, 1)
        )

    def forward(self, x):
        return self.backbone(x)


yaw_transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

yaw_model = YawRegressionModel().to(DEVICE)
yaw_model.load_state_dict(torch.load(YAW_MODEL_PATH, map_location=DEVICE))
yaw_model.eval()
print("Yaw model loaded successfully!")
print("Yaw device:", DEVICE)

# =========================
# Helper functions
# =========================

def classify_head_direction(yaw):
    if yaw < LEFT_THRESHOLD:
        return "Looking Left", "Not Concentrating"
    elif yaw > RIGHT_THRESHOLD:
        return "Looking Right", "Not Concentrating"
    else:
        return "Looking Forward", "Concentrating"


def clamp_box(x, y, w, h, img_w, img_h):
    x1 = max(0, int(round(x)))
    y1 = max(0, int(round(y)))
    x2 = min(img_w, int(round(x + w)))
    y2 = min(img_h, int(round(y + h)))
    return x1, y1, max(0, x2 - x1), max(0, y2 - y1)


def pad_box(x, y, w, h, img_w, img_h, pad_ratio=0.28):
    pad_x = w * pad_ratio
    pad_y = h * pad_ratio
    return clamp_box(
        x - pad_x,
        y - pad_y,
        w + (2 * pad_x),
        h + (2 * pad_y),
        img_w,
        img_h
    )


def detect_face_box(img_rgb):
    h, w, _ = img_rgb.shape
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.equalizeHist(gray)

    faces = []
    for scale in (1.0, 1.5, 2.0):
        scaled = gray if scale == 1.0 else cv2.resize(
            gray,
            None,
            fx=scale,
            fy=scale,
            interpolation=cv2.INTER_CUBIC
        )

        detected = face_cascade.detectMultiScale(
            scaled,
            scaleFactor=1.08,
            minNeighbors=4,
            minSize=(28, 28)
        )

        for x, y, face_w, face_h in detected:
            faces.append((x / scale, y / scale, face_w / scale, face_h / scale))

    if len(faces) == 0:
        return None

    x, y, face_w, face_h = max(faces, key=lambda f: f[2] * f[3])
    return pad_box(x, y, face_w, face_h, w, h)


def estimate_head_pose(img_rgb):
    face_box = detect_face_box(img_rgb)

    if face_box is None:
        return {
            "face_detected": False,
            "yaw": None,
            "pitch": None,
            "roll": None,
            "direction": "No Face",
            "status": "Not Concentrating"
        }

    x, y, w, h = face_box
    pil_frame = Image.fromarray(img_rgb)
    x_input = yaw_transform(pil_frame).unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        raw_yaw = float(yaw_model(x_input).item())

    yaw = float(np.clip(raw_yaw * YAW_GAIN, -90, 90))

    direction, status = classify_head_direction(yaw)

    return {
        "face_detected": True,
        "yaw": yaw,
        "pitch": None,
        "roll": None,
        "direction": direction,
        "status": status,
        "raw_yaw": raw_yaw,
        "yaw_gain": YAW_GAIN,
        "face_box": [int(x), int(y), int(w), int(h)]
    }


def detect_phone(img_rgb):
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

    results = phone_model(img_bgr, verbose=False)

    phone_detected = False
    phones = []

    for result in results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            class_name = phone_model.names[cls_id]

            if class_name == "cell phone" and conf >= PHONE_CONF_THRESHOLD:
                phone_detected = True

                x1, y1, x2, y2 = map(int, box.xyxy[0])

                phones.append({
                    "confidence": conf,
                    "box": [x1, y1, x2, y2]
                })

    return phone_detected, phones


def get_pose_phone_status(head_status, phone_detected):
    if phone_detected:
        return "Not Concentrating"

    if head_status == "Not Concentrating":
        return "Not Concentrating"

    return "Concentrating"

# =========================
# Routes
# =========================

@app.get("/")
def root():
    return {"message": "Head pose + phone detection backend is running"}


@app.post("/pose_phone")
async def pose_phone(file: UploadFile = File(...)):
    data = await file.read()

    pil_img = Image.open(io.BytesIO(data)).convert("RGB")
    img_rgb = np.array(pil_img)

    head_pose = estimate_head_pose(img_rgb)
    phone_detected, phones = detect_phone(img_rgb)

    final_status = get_pose_phone_status(
        head_status=head_pose["status"],
        phone_detected=phone_detected
    )

    return {
        "head_pose": head_pose,
        "phone": {
            "detected": phone_detected,
            "phones": phones
        },
        "pose_phone_status": final_status
    }
