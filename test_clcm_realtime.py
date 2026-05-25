import cv2
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import load_model

# =========================
# 1) MODEL PATH
# =========================
MODEL_PATH = "C:/Users/aliab/RP_Project/RP_PROJECT_IMPLEMENTATION_VS_CODE/fer-meet/fer-meet/public/models/clcm/final_clcm_model.keras"

IMG_SIZE = (160, 160)

# IMPORTANT: match your model classes EXACTLY
class_names = [
    "Anger",
    "Contempt",
    "Disgust",
    "Fear",
    "Happy",
    "Neutral",
    "Sad",
    "Surprise"
]

# =========================
# 2) LOAD MODEL
# =========================
model = load_model(MODEL_PATH, compile=False)
print("CLCM Model loaded successfully!")

# =========================
# 3) FACE DETECTOR
# =========================
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

# =========================
# 4) PREPROCESS
# =========================
def preprocess_face(face):
    face = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
    face = cv2.resize(face, IMG_SIZE)
    face = face.astype(np.float32)
    face = np.expand_dims(face, axis=0)
    return face

# =========================
# 5) WEBCAM
# =========================
cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
if not cap.isOpened():
    print("Error: Could not open webcam")
    exit()

print("Press Q to exit")

# =========================
# 6) LOOP
# =========================
while True:
    ret, frame = cap.read()
    if not ret:
        break

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.3,
        minNeighbors=5,
        minSize=(60, 60)
    )

    for (x, y, w, h) in faces:
        face = frame[y:y+h, x:x+w]

        try:
            input_face = preprocess_face(face)
            preds = model.predict(input_face, verbose=0)[0]

            pred_id = np.argmax(preds)
            label = class_names[pred_id]
            confidence = preds[pred_id] * 100

            text = f"{label} ({confidence:.1f}%)"

            # Box
            cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 2)

            # Background
            cv2.rectangle(frame, (x, y-30), (x+w, y), (0, 255, 0), -1)

            # Text
            cv2.putText(
                frame,
                text,
                (x+5, y-8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 0, 0),
                2
            )

        except Exception as e:
            print("Prediction error:", e)

    cv2.imshow("CLCM Real-Time FER", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# =========================
# 7) CLEANUP
# =========================
cap.release()
cv2.destroyAllWindows()