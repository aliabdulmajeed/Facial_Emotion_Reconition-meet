# ============================================================
# Webcam FER Test — EfficientNet-B2 + FER-2013
# Matches your training model exactly
# ============================================================

import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as T
import timm
from PIL import Image

# ---------------- CONFIG ----------------
MODEL_PATH = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\public\models\clcm\best_model.pth"

MODEL_NAME = "efficientnet_b2"
IMG_SIZE = 224

EMOTION_CLASSES = [
    "Angry", "Disgust", "Fear", "Happy",
    "Neutral", "Sad", "Surprise"
]

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Using device:", DEVICE)

# ---------------- MODEL ----------------
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
model = EmotionNet(num_classes=len(EMOTION_CLASSES)).to(DEVICE)

state_dict = torch.load(MODEL_PATH, map_location=DEVICE)
model.load_state_dict(state_dict)

model.eval()
print("Model loaded successfully.")

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

if face_cascade.empty():
    print("Error: Haar cascade failed to load.")
    exit()

# ---------------- WEBCAM ----------------
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Error: Could not open webcam.")
    exit()

print("Webcam started.")
print("Press Q to quit.")

while True:
    ret, frame = cap.read()

    if not ret:
        print("Failed to read frame.")
        break

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.2,
        minNeighbors=5,
        minSize=(60, 60)
    )

    for (x, y, w, h) in faces:
        face = frame[y:y+h, x:x+w]

        face_rgb = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(face_rgb)

        input_tensor = transform(pil_img).unsqueeze(0).to(DEVICE)

        with torch.no_grad():
            output = model(input_tensor)
            probs = F.softmax(output, dim=1)
            confidence, pred_idx = torch.max(probs, dim=1)

        emotion = EMOTION_CLASSES[pred_idx.item()]
        conf = confidence.item() * 100

        label = f"{emotion}: {conf:.1f}%"

        cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 2)

        cv2.putText(
            frame,
            label,
            (x, y - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 0),
            2
        )

    cv2.imshow("FER Webcam Test", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
print("Webcam closed.")