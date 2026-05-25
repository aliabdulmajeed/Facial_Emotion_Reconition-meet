import cv2
import mediapipe as mp
import numpy as np
from collections import deque

# =============================
# Settings
# =============================

LEFT_THRESHOLD = -22
RIGHT_THRESHOLD = 22
SMOOTHING_FRAMES = 10
STABLE_FRAMES = 5

baseline_yaw = 0.0
flip_sign = False

yaw_history = deque(maxlen=SMOOTHING_FRAMES)
last_direction = "Looking Forward"
stable_counter = 0
display_direction = "Looking Forward"
display_status = "Concentrating"
display_color = (0, 255, 0)

mp_face_mesh = mp.solutions.face_mesh

face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.6
)

face_3d = np.array([
    [0.0, 0.0, 0.0],          # Nose tip
    [0.0, -330.0, -65.0],     # Chin
    [-225.0, 170.0, -135.0],  # Left eye corner
    [225.0, 170.0, -135.0],   # Right eye corner
    [-150.0, -150.0, -125.0], # Left mouth corner
    [150.0, -150.0, -125.0]   # Right mouth corner
], dtype=np.float64)

landmark_ids = [1, 152, 33, 263, 61, 291]


def classify_direction(yaw):
    if yaw < LEFT_THRESHOLD:
        return "Looking Left", "Not Concentrating", (0, 0, 255)
    elif yaw > RIGHT_THRESHOLD:
        return "Looking Right", "Not Concentrating", (0, 0, 255)
    else:
        return "Looking Forward", "Concentrating", (0, 255, 0)


def draw_text(frame, text, y, color):
    cv2.putText(
        frame,
        text,
        (30, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        color,
        2
    )


cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Could not open webcam.")
    exit()

print("Press Q to quit.")
print("Press C while looking straight to calibrate.")
print("Press S to flip left/right direction if reversed.")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # Optional mirror view like normal webcam
    frame = cv2.flip(frame, 1)

    h, w, _ = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    results = face_mesh.process(rgb)

    raw_yaw = None
    smooth_yaw = None

    if results.multi_face_landmarks:
        face_landmarks = results.multi_face_landmarks[0]

        face_2d = []

        for idx in landmark_ids:
            lm = face_landmarks.landmark[idx]
            x, y = int(lm.x * w), int(lm.y * h)
            face_2d.append([x, y])
            cv2.circle(frame, (x, y), 3, (255, 255, 0), -1)

        face_2d = np.array(face_2d, dtype=np.float64)

        focal_length = w
        cam_matrix = np.array([
            [focal_length, 0, w / 2],
            [0, focal_length, h / 2],
            [0, 0, 1]
        ], dtype=np.float64)

        dist_matrix = np.zeros((4, 1), dtype=np.float64)

        success, rot_vec, trans_vec = cv2.solvePnP(
            face_3d,
            face_2d,
            cam_matrix,
            dist_matrix,
            flags=cv2.SOLVEPNP_ITERATIVE
        )

        if success:
            rmat, _ = cv2.Rodrigues(rot_vec)
            angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)

            pitch = angles[0]
            raw_yaw = angles[1]
            roll = angles[2]

            corrected_yaw = raw_yaw - baseline_yaw

            if flip_sign:
                corrected_yaw = -corrected_yaw

            corrected_yaw = float(np.clip(corrected_yaw, -90, 90))

            yaw_history.append(corrected_yaw)
            smooth_yaw = sum(yaw_history) / len(yaw_history)

            current_direction, current_status, current_color = classify_direction(smooth_yaw)

            # Stable decision: only update display after same decision repeats
            if current_direction == last_direction:
                stable_counter += 1
            else:
                stable_counter = 0
                last_direction = current_direction

            if stable_counter >= STABLE_FRAMES:
                display_direction = current_direction
                display_status = current_status
                display_color = current_color

            draw_text(frame, f"Raw Yaw: {raw_yaw:.2f} deg", 40, display_color)
            draw_text(frame, f"Smooth Yaw: {smooth_yaw:.2f} deg", 80, display_color)
            draw_text(frame, f"Baseline: {baseline_yaw:.2f}", 120, (255, 255, 255))
            draw_text(frame, f"Direction: {display_direction}", 165, display_color)
            draw_text(frame, f"Status: {display_status}", 210, display_color)

            # Draw nose direction line
            nose_2d = face_2d[0].astype(int)
            end_x = int(nose_2d[0] + smooth_yaw * 4)
            end_y = int(nose_2d[1] - pitch * 4)
            cv2.line(frame, tuple(nose_2d), (end_x, end_y), display_color, 3)

    else:
        yaw_history.clear()
        draw_text(frame, "No face detected", 50, (0, 0, 255))

    draw_text(frame, "C: calibrate forward | S: flip sign | Q: quit", h - 25, (255, 255, 255))

    cv2.imshow("MediaPipe Head Pose - Smooth", frame)

    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break

    elif key == ord("c"):
        if raw_yaw is not None:
            baseline_yaw = raw_yaw
            yaw_history.clear()
            print(f"Calibrated baseline yaw: {baseline_yaw:.2f}")

    elif key == ord("s"):
        flip_sign = not flip_sign
        yaw_history.clear()
        print("Flip sign:", flip_sign)

cap.release()
cv2.destroyAllWindows()