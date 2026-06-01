import cv2
import mediapipe as mp
import numpy as np
from collections import deque


# =========================
# Dynamic parameters to edit
# =========================

CAMERA_INDEX = 0
CAMERA_FALLBACKS = [
    (CAMERA_INDEX, cv2.CAP_DSHOW),
    (CAMERA_INDEX, cv2.CAP_MSMF),
    (1, cv2.CAP_DSHOW),
    (1, cv2.CAP_MSMF),
]

LEFT_THRESHOLD = -27.0
RIGHT_THRESHOLD = 27.0
YAW_GAIN = 1.0
YAW_OFFSET = 0.0
FLIP_YAW_SIGN = False

SMOOTHING_FRAMES = 10
STABLE_FRAMES = 5
MIRROR_CAMERA = True

MIN_DETECTION_CONFIDENCE = 0.6
MIN_TRACKING_CONFIDENCE = 0.6

NOSE_LINE_SCALE = 4.0


# =========================
# Runtime state
# =========================

baseline_yaw = 0.0
yaw_history = deque(maxlen=SMOOTHING_FRAMES)
last_direction = "Looking Forward"
stable_counter = 0
display_direction = "Looking Forward"
display_status = "Concentrating"
display_color = (0, 255, 0)


# =========================
# MediaPipe head pose model
# =========================

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


def open_camera():
    for camera_index, backend in CAMERA_FALLBACKS:
        candidate = cv2.VideoCapture(camera_index, backend)
        if candidate.isOpened():
            ok, _ = candidate.read()
            if ok:
                print(f"Camera opened: index={camera_index}, backend={backend}")
                return candidate
        candidate.release()

    raise RuntimeError(
        "Could not read from a webcam. Close other camera apps or change CAMERA_INDEX."
    )


def classify_direction(yaw):
    if yaw < LEFT_THRESHOLD:
        return "Looking Left", "Not Concentrating", (0, 0, 255)
    if yaw > RIGHT_THRESHOLD:
        return "Looking Right", "Not Concentrating", (0, 0, 255)
    return "Looking Forward", "Concentrating", (0, 255, 0)


def draw_text(frame, text, y, color=(255, 255, 255), scale=0.72):
    cv2.putText(
        frame,
        text,
        (24, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        color,
        2,
        cv2.LINE_AA,
    )


def estimate_pose(frame):
    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb)

    if not results.multi_face_landmarks:
        return None

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
        return None

    rmat, _ = cv2.Rodrigues(rot_vec)
    angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)

    raw_pitch = float(angles[0])
    raw_yaw = float(angles[1])
    raw_roll = float(angles[2])

    yaw = (raw_yaw - baseline_yaw) * YAW_GAIN + YAW_OFFSET
    if FLIP_YAW_SIGN:
        yaw = -yaw

    yaw = float(np.clip(yaw, -90, 90))

    return {
        "raw_pitch": raw_pitch,
        "raw_yaw": raw_yaw,
        "raw_roll": raw_roll,
        "yaw": yaw,
        "nose": face_2d[0].astype(int),
    }


def print_settings():
    print(
        "Settings:",
        f"left={LEFT_THRESHOLD}",
        f"right={RIGHT_THRESHOLD}",
        f"gain={YAW_GAIN}",
        f"offset={YAW_OFFSET}",
        f"flip={FLIP_YAW_SIGN}",
        f"smoothing={SMOOTHING_FRAMES}",
        f"stable={STABLE_FRAMES}",
    )


print("New tester: MediaPipe + OpenCV solvePnP head pose.")
print("No .pth yaw model is loaded.")
print("Keys: Q quit | C calibrate | S flip sign | [ ] thresholds | - = gain | 9 0 offset")
print_settings()

cap = open_camera()

while True:
    ok, frame = cap.read()
    if not ok:
        break

    if MIRROR_CAMERA:
        frame = cv2.flip(frame, 1)

    h = frame.shape[0]
    pose = estimate_pose(frame)

    if pose is None:
        yaw_history.clear()
        draw_text(frame, "No face detected", 45, (0, 0, 255))
    else:
        yaw_history.append(pose["yaw"])
        smooth_yaw = sum(yaw_history) / len(yaw_history)

        current_direction, current_status, current_color = classify_direction(smooth_yaw)

        if current_direction == last_direction:
            stable_counter += 1
        else:
            stable_counter = 0
            last_direction = current_direction

        if stable_counter >= STABLE_FRAMES:
            display_direction = current_direction
            display_status = current_status
            display_color = current_color

        nose = pose["nose"]
        end_x = int(nose[0] + smooth_yaw * NOSE_LINE_SCALE)
        end_y = int(nose[1] - pose["raw_pitch"] * NOSE_LINE_SCALE)
        cv2.line(frame, tuple(nose), (end_x, end_y), display_color, 3)

        draw_text(frame, f"Raw yaw: {pose['raw_yaw']:.2f}", 40, display_color)
        draw_text(frame, f"Adjusted yaw: {pose['yaw']:.2f}", 75, display_color)
        draw_text(frame, f"Smooth yaw: {smooth_yaw:.2f}", 110, display_color)
        draw_text(frame, f"Baseline: {baseline_yaw:.2f}", 145)
        draw_text(frame, f"Direction: {display_direction}", 180, display_color)
        draw_text(frame, f"Status: {display_status}", 215, display_color)

    draw_text(
        frame,
        (
            f"L/R={LEFT_THRESHOLD:.0f}/{RIGHT_THRESHOLD:.0f} "
            f"gain={YAW_GAIN:.2f} offset={YAW_OFFSET:.1f} flip={FLIP_YAW_SIGN}"
        ),
        h - 55,
    )
    draw_text(frame, "C calibrate | S flip | [ ] threshold | - = gain | 9 0 offset | Q quit", h - 25)

    cv2.imshow("New Head Pose Tester", frame)
    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break
    if key == ord("c") and pose is not None:
        baseline_yaw = pose["raw_yaw"]
        yaw_history.clear()
        print(f"Calibrated baseline yaw: {baseline_yaw:.2f}")
    elif key == ord("s"):
        FLIP_YAW_SIGN = not FLIP_YAW_SIGN
        yaw_history.clear()
        print("Flip yaw sign:", FLIP_YAW_SIGN)
    elif key == ord("["):
        LEFT_THRESHOLD -= 1
        RIGHT_THRESHOLD += 1
        print_settings()
    elif key == ord("]"):
        LEFT_THRESHOLD += 1
        RIGHT_THRESHOLD -= 1
        print_settings()
    elif key == ord("-"):
        YAW_GAIN = max(0.1, YAW_GAIN - 0.1)
        print_settings()
    elif key == ord("="):
        YAW_GAIN += 0.1
        print_settings()
    elif key == ord("9"):
        YAW_OFFSET -= 1
        print_settings()
    elif key == ord("0"):
        YAW_OFFSET += 1
        print_settings()

cap.release()
cv2.destroyAllWindows()
