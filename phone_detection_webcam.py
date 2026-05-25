import cv2
from ultralytics import YOLO

# Load ready YOLO model
model = YOLO("yolov8n.pt")  # small and fast

PHONE_CLASS_NAME = "cell phone"
CONF_THRESHOLD = 0.35

cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Could not open webcam.")
    exit()

print("Press Q to quit.")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    results = model(frame, verbose=False)

    phone_detected = False

    for result in results:
        boxes = result.boxes

        for box in boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            class_name = model.names[cls_id]

            if class_name == PHONE_CLASS_NAME and conf >= CONF_THRESHOLD:
                phone_detected = True

                x1, y1, x2, y2 = map(int, box.xyxy[0])

                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)

                cv2.putText(
                    frame,
                    f"Phone {conf:.2f}",
                    (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 0, 255),
                    2
                )

    if phone_detected:
        status = "Phone Detected - Not Concentrating"
        color = (0, 0, 255)
    else:
        status = "No Phone - OK"
        color = (0, 255, 0)

    cv2.putText(
        frame,
        status,
        (30, 50),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        color,
        2
    )

    cv2.imshow("Phone Detection", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()