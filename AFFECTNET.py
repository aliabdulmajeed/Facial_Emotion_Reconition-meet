import cv2
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import load_model

# =========================
# 1) SETTINGS
# =========================
MODEL_PATH = "/content/drive/MyDrive/FER_checkpoints/last_trained_fer_v5.keras"  
IMG_SIZE = (224, 224)

# Put your class names here in the exact training order
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
# 2) LOAD MODEL``
# =========================
model = load_model(r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\public\models\clcm\last_trained_fer_v5.keras", compile=False)
print("Model loaded successfully.")

# =========================
# 3) LOAD FACE DETECTOR
# =========================
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

# =========================
# 4) PREPROCESS FUNCTION
# =========================
def preprocess_face(face_bgr):
    face_rgb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)
    face_resized = cv2.resize(face_rgb, IMG_SIZE)
    face_array = face_resized.astype(np.float32)
    face_array = np.expand_dims(face_array, axis=0)   # shape: (1, 224, 224, 3)
    return face_array

# =========================
# 5) START WEBCAM
# =========================
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Error: Could not open webcam.")
    exit()

print("Press Q to quit.")

# =========================
# 6) REAL-TIME LOOP
# =========================
while True:
    ret, frame = cap.read()
    if not ret:
        print("Failed to read frame from webcam.")
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

            pred_id = int(np.argmax(preds))
            pred_label = class_names[pred_id]
            confidence = float(preds[pred_id]) * 100

            text = f"{pred_label} ({confidence:.1f}%)"

            # Draw box
            cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 2)

            # Draw label background
            cv2.rectangle(frame, (x, y-30), (x+w, y), (0, 255, 0), -1)

            # Draw text
            cv2.putText(
                frame,
                text,
                (x + 5, y - 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 0, 0),
                2
            )

        except Exception as e:
            print("Prediction error:", e)

    cv2.imshow("Real-Time FER Test", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

# =========================
# 7) CLEAN UP
# =========================
cap.release()
cv2.destroyAllWindows()
