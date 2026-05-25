import cv2
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image

# =============================
# Settings
# =============================

MODEL_PATH = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\best_yaw_model.pth"

IMG_SIZE = 224
LEFT_THRESHOLD = -15
RIGHT_THRESHOLD = 15

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Using device:", DEVICE)

# =============================
# Model
# =============================

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


# =============================
# Transform
# =============================

transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

# =============================
# Load model
# =============================

model = YawRegressionModel().to(DEVICE)
model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
model.eval()

print("Model loaded successfully.")

# =============================
# Direction function
# =============================

def classify_direction(yaw):
    if yaw < LEFT_THRESHOLD:
        return "Looking Left", "Not Concentrating", (0, 0, 255)
    elif yaw > RIGHT_THRESHOLD:
        return "Looking Right", "Not Concentrating", (0, 0, 255)
    else:
        return "Looking Forward", "Concentrating", (0, 255, 0)


# =============================
# Webcam
# =============================

cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Could not open webcam.")
    exit()

print("Press Q to quit.")

while True:
    ret, frame = cap.read()

    if not ret:
        print("Failed to read frame.")
        break

    # Convert OpenCV BGR frame to RGB PIL image
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb_frame)

    # Preprocess
    input_tensor = transform(pil_image).unsqueeze(0).to(DEVICE)

    # Predict yaw
    with torch.no_grad():
        predicted_yaw = model(input_tensor).item()

    direction, status, color = classify_direction(predicted_yaw)

    # Display text
    cv2.putText(
        frame,
        f"Yaw: {predicted_yaw:.2f} deg",
        (30, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        color,
        2
    )

    cv2.putText(
        frame,
        f"Direction: {direction}",
        (30, 85),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        color,
        2
    )

    cv2.putText(
        frame,
        f"Status: {status}",
        (30, 130),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        color,
        2
    )

    cv2.imshow("Head Direction Test", frame)

    # Press Q to quit
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()