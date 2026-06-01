import os
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from PIL import Image
import io
import cv2
import mediapipe as mp

YOLO_CONFIG_DIR = os.path.join(os.path.dirname(__file__), ".ultralytics")
os.makedirs(YOLO_CONFIG_DIR, exist_ok=True)
os.environ.setdefault("YOLO_CONFIG_DIR", YOLO_CONFIG_DIR)

from ultralytics import YOLO

# =========================
# Settings
# =========================

LEFT_THRESHOLD = -27.0
RIGHT_THRESHOLD = 27.0
YAW_GAIN = 1.0
YAW_OFFSET = 0.0
FLIP_YAW_SIGN = False
PHONE_CONF_THRESHOLD = 0.35
MIN_DETECTION_CONFIDENCE = 0.6
MIN_TRACKING_CONFIDENCE = 0.6

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

mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=MIN_DETECTION_CONFIDENCE,
    min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
)

face_3d = np.array([
    [0.0, 0.0, 0.0],          # Nose tip
    [0.0, -330.0, -65.0],     # Chin
    [-225.0, 170.0, -135.0],  # Left eye corner
    [225.0, 170.0, -135.0],   # Right eye corner
    [-150.0, -150.0, -125.0], # Left mouth corner
    [150.0, -150.0, -125.0],  # Right mouth corner
], dtype=np.float64)

landmark_ids = [1, 152, 33, 263, 61, 291]
print("MediaPipe head pose model loaded successfully!")

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


def estimate_head_pose(img_rgb):
    h, w = img_rgb.shape[:2]
    results = face_mesh.process(img_rgb)

    if not results.multi_face_landmarks:
        return {
            "face_detected": False,
            "yaw": None,
            "pitch": None,
            "roll": None,
            "direction": "No Face",
            "status": "Not Concentrating"
        }

    face_landmarks = results.multi_face_landmarks[0]
    face_2d = []
    all_x = []
    all_y = []

    for landmark in face_landmarks.landmark:
        all_x.append(int(landmark.x * w))
        all_y.append(int(landmark.y * h))

    for idx in landmark_ids:
        landmark = face_landmarks.landmark[idx]
        face_2d.append([int(landmark.x * w), int(landmark.y * h)])

    face_2d = np.array(face_2d, dtype=np.float64)

    focal_length = w
    cam_matrix = np.array([
        [focal_length, 0, w / 2],
        [0, focal_length, h / 2],
        [0, 0, 1],
    ], dtype=np.float64)
    dist_matrix = np.zeros((4, 1), dtype=np.float64)

    success, rot_vec, _ = cv2.solvePnP(
        face_3d,
        face_2d,
        cam_matrix,
        dist_matrix,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )

    if not success:
        return {
            "face_detected": False,
            "yaw": None,
            "pitch": None,
            "roll": None,
            "direction": "No Face",
            "status": "Not Concentrating"
        }

    rmat, _ = cv2.Rodrigues(rot_vec)
    angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)

    pitch = float(angles[0])
    raw_yaw = float(angles[1])
    roll = float(angles[2])

    yaw = (raw_yaw * YAW_GAIN) + YAW_OFFSET
    if FLIP_YAW_SIGN:
        yaw = -yaw

    yaw = float(np.clip(yaw, -90, 90))

    direction, status = classify_head_direction(yaw)
    x1 = max(0, min(all_x))
    y1 = max(0, min(all_y))
    x2 = min(w, max(all_x))
    y2 = min(h, max(all_y))

    return {
        "face_detected": True,
        "yaw": yaw,
        "pitch": pitch,
        "roll": roll,
        "direction": direction,
        "status": status,
        "raw_yaw": raw_yaw,
        "yaw_gain": YAW_GAIN,
        "yaw_offset": YAW_OFFSET,
        "flip_yaw_sign": FLIP_YAW_SIGN,
        "model": "mediapipe_solvepnp",
        "face_box": [int(x1), int(y1), int(x2 - x1), int(y2 - y1)]
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
