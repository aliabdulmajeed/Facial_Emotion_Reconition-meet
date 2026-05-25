import cv2
import time
import numpy as np
import tensorflow as tf
from tensorflow import keras

# =========================
# CONFIG
# =========================
MODEL_PATH = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\final_clcm_model.keras"

IMG_SIZE = 160

# IMPORTANT:
# This class order is only a guess based on what you showed before.
# Change it if your training label order was different.
CLASS_NAMES = ["Surprise", "Fear", "Disgust", "Happy", "Sad", "Angry", "Neutral"]

# Set this to True if your training used RGB images
USE_RGB = True

# Set this to True if you normalized by dividing by 255
DIVIDE_BY_255 = True

# =========================
# LOAD MODEL
# =========================
print("Loading model...")
model = keras.models.load_model(MODEL_PATH, compile=False)
print("Model loaded successfully.")

# =========================
# FACE DETECTOR
# =========================
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

# =========================
# PREPROCESS FUNCTION
# =========================
def preprocess_face(face_bgr):
    # Convert color if needed
    if USE_RGB:
        face = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)
    else:
        face = face_bgr.copy()

    # Resize
    face = cv2.resize(face, (IMG_SIZE, IMG_SIZE))

    # Convert to float32
    face = face.astype(np.float32)

    if DIVIDE_BY_255:
        face = face / 255.0

    # Add batch dimension
    face = np.expand_dims(face, axis=0)  # (1,160,160,3)

    return face

# =========================
# REALTIME TEST
# =========================
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Error: Could not open webcam.")
    exit()

prev_time = time.time()

while True:
    ret, frame = cap.read()
    if not ret:
        print("Failed to read frame.")
        break

    display = frame.copy()

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60)
    )

    for (x, y, w, h) in faces:
        # Expand box a little
        pad = 10
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(frame.shape[1], x + w + pad)
        y2 = min(frame.shape[0], y + h + pad)

        face_crop = frame[y1:y2, x1:x2]

        if face_crop.size == 0:
            continue

        inp = preprocess_face(face_crop)

        preds = model.predict(inp, verbose=0)[0]
        pred_idx = int(np.argmax(preds))
        pred_label = CLASS_NAMES[pred_idx]
        confidence = float(preds[pred_idx])

        # Draw box
        cv2.rectangle(display, (x1, y1), (x2, y2), (0, 255, 0), 2)

        text = f"{pred_label} ({confidence:.2f})"
        cv2.putText(
            display,
            text,
            (x1, max(30, y1 - 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 0),
            2
        )

    # FPS
    current_time = time.time()
    fps = 1.0 / (current_time - prev_time)
    prev_time = current_time

    cv2.putText(
        display,
        f"FPS: {fps:.1f}",
        (20, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (0, 255, 255),
        2
    )

    cv2.imshow("Real-Time Emotion Test", display)

    key = cv2.waitKey(1) & 0xFF
    if key == 27:  # ESC
        break

cap.release()
cv2.destroyAllWindows()