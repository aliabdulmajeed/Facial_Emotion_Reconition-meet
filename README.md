# FER Meet

FER Meet is a web-based online learning meeting platform with real-time facial emotion recognition, head-pose analysis, phone-distraction detection, instructor analytics, questionnaires, and Groq-powered session feedback.

The system is designed for research and academic use. Its computer-vision and LLM outputs should be treated as supportive learning indicators, not as final judgments about a student.

## Core Features

- Live online meeting rooms using LiveKit.
- Role-based entry for instructors and students.
- Real-time facial emotion recognition from webcam frames.
- Head-pose detection for looking forward, left, right, or leaving camera view.
- Phone-distraction detection with YOLO.
- Instructor dashboard with class engagement, emotion trends, attention status, and alerts.
- Session history that keeps students in the analysis even after they leave.
- Questionnaire flow for students and instructors.
- Groq LLM feedback for both students and instructors.
- Feedback bars with expandable "View Details" evidence.
- Questionnaire answers and live analytics are combined internally for feedback scoring.
- Clean responsive GUI for desktop, tablet, and mobile.

## System Architecture

```text
Browser UI
  |
  |  LiveKit video/audio + frontend analysis workflow
  v
Express Server :3000
  |-- /token                  -> LiveKit access token
  |-- /api/predict            -> FER backend :5000
  |-- /api/pose_phone         -> pose/phone backend :6001
  |-- /api/questionnaire      -> feedback backend :7001
  |-- /api/collect            -> feedback backend :7001
  |-- /api/session_feedback   -> feedback backend :7001

Python Backends
  |-- backend_api.py          -> emotion recognition
  |-- backend_pose.py         -> head pose + phone detection
  |-- backend_feedback.py     -> questionnaire/session history + Groq feedback
```

## Project Structure

```text
fer-meet/
  README.md
  package.json
  package-lock.json

  backend_api.py
    Facial emotion recognition FastAPI service.
    Endpoint: POST /predict
    Default port: 5000
    Model: public/models/clcm/best_model.pth

  backend_pose.py
    Head-pose and phone-distraction FastAPI service.
    Endpoint: POST /pose_phone
    Default port: 6001
    Models: MediaPipe FaceMesh/OpenCV solvePnP head pose, yolov8n.pt

  backend_feedback.py
    Questionnaire storage, session event collection, and Groq feedback service.
    Endpoints: POST /questionnaire, POST /collect, POST /session_feedback, GET /summary/{room}
    Default port: 7001

  server/
    package.json
    package-lock.json
    server.js
      Express static server, LiveKit token endpoint, and API proxy layer.

  public/
    index.html
      Landing page for creating or joining a meeting.

    app.js
      Room creation/join form logic.

    meeting.html
      Main meeting page, video grid, instructor dashboard, questionnaire modal,
      and feedback modal.

    meeting.js
      LiveKit client integration, frame capture, API calls, questionnaire submit,
      session feedback rendering, and head-pose smoothing.

    analysis.js
      Instructor-side session analytics, student state tracking, engagement
      scoring, event history, alerts, and final session data generation.

    styles.css
      Complete application styling and responsive layout.

    models/clcm/
      Browser/model assets and trained FER model files.

  savedmodel_clcm/
    TensorFlow SavedModel export of the FER model.

  yolov8n.pt
    YOLO model used for phone detection.

  Utility and experiment scripts:
    AFFECTNET.py
    FER_MODEL_TEST.py
    convert_to_h5.py
    export_onnx.py
    k2o_convert.py
    mediapipe_head_pose_webcam.py
    phone_detection_webcam.py
    test_clcm_realtime.py
    test_head_direction_webcam.py
    test_realtime_clcm.py
    tf2onnx_convert.py
```

## Runtime Services

Run the project with separate terminals.

| Service | File | Port | Purpose |
| --- | --- | ---: | --- |
| Web server | `server/server.js` | `3000` | Serves frontend, creates LiveKit tokens, proxies APIs |
| FER backend | `backend_api.py` | `5000` | Predicts facial emotion |
| Pose backend | `backend_pose.py` | `6001` | Detects head direction and phone use |
| Feedback backend | `backend_feedback.py` | `7001` | Stores session data and generates feedback |

## Environment Variables

Create `server/.env`:

```env
LIVEKIT_URL=wss://your-livekit-url
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
PORT=3000
```

Set the Groq API key in the terminal that runs `backend_feedback.py`:

```powershell
$env:GROQ_API_KEY="your_groq_api_key"
```

Optional legacy OpenAI feedback support exists in `backend_api.py`:

```powershell
$env:OPENAI_API_KEY="your_openai_api_key"
```

Do not commit real API keys. `.env`, logs, cache folders, and local runtime files are ignored by Git.

## Installation

Install Node dependencies:

```powershell
cd fer-meet\fer-meet\server
npm install
```

Install Python dependencies in the environment used for the backends. The project has been run with a Conda environment named `fer_onnx`.

Typical Python packages include:

```text
fastapi
uvicorn
python-multipart
numpy
opencv-python
pillow
torch
torchvision
timm
ultralytics
openai
pydantic
```

## Running Locally

From the project root, use separate terminals.

### Terminal 1 - FER backend

```powershell
conda activate fer_onnx
cd C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet
python -m uvicorn backend_api:app --host 127.0.0.1 --port 5000
```

### Terminal 2 - Head pose and phone backend

```powershell
conda activate fer_onnx
cd C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet
python -m uvicorn backend_pose:app --host 127.0.0.1 --port 6001
```

### Terminal 3 - Feedback backend

```powershell
conda activate fer_onnx
cd C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet
$env:GROQ_API_KEY="your_groq_api_key"
python -m uvicorn backend_feedback:app --host 127.0.0.1 --port 7001
```

### Terminal 4 - Web server

```powershell
cd C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\server
npm start
```

Open:

```text
http://localhost:3000
```

### Optional public tunnel

```powershell
cloudflared tunnel --url http://localhost:3000
```

Use the generated Cloudflare URL for external participants.

## Application Workflow

1. The instructor creates a room from the landing page.
2. Students join using the shared room code or invite URL.
3. LiveKit handles audio/video communication.
4. The frontend captures periodic webcam frames.
5. Frames are sent through the Express proxy to:
   - `backend_api.py` for emotion prediction.
   - `backend_pose.py` for head-pose and phone detection.
6. `analysis.js` tracks each student over time:
   - presence
   - join and leave time
   - emotion history
   - concentration status
   - head direction
   - phone use
   - no-face events
   - low-attention events
7. Session signals are also sent to `backend_feedback.py` through `/api/collect`.
8. When a user leaves or the instructor ends the session, the questionnaire opens.
9. The feedback backend combines live analytics, questionnaire answers,
   session event history, emotion trends, and engagement/concentration scores.
10. Groq generates short visual feedback bars with expandable details.

## Feedback Design

Student feedback is personal and encouraging. It includes:

- Engagement level
- Concentration level
- Understanding level
- Stress/confusion level
- Participation level
- Overall session performance

Instructor feedback is class-level and improvement-focused. It includes:

- Overall class engagement
- Average concentration
- Students who may need support
- Emotion trends
- Distraction events with timestamps
- Teaching improvement suggestions
- Alerts when most students appear distracted or confused

Each feedback bar has a "View Details" button that shows evidence such as emotion changes, questionnaire score, attention changes, timestamps, and short recommendations.

## API Summary

### Express server

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/token` | Creates a LiveKit access token |
| `POST` | `/api/predict` | Proxy to FER backend |
| `POST` | `/api/pose_phone` | Proxy to pose/phone backend |
| `POST` | `/api/questionnaire` | Proxy to feedback backend |
| `POST` | `/api/collect` | Proxy to feedback backend session recorder |
| `POST` | `/api/session_feedback` | Proxy to Groq feedback generation |

### FER backend

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/` | Health message |
| `POST` | `/predict` | Returns emotion label, confidence, face box, and probabilities |

### Pose backend

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/` | Health message |
| `POST` | `/pose_phone` | Returns head direction, yaw, phone status, and final concentration status |

### Feedback backend

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/` | Health message |
| `POST` | `/questionnaire` | Stores questionnaire answers |
| `POST` | `/collect` | Stores live student analysis signals |
| `GET` | `/summary/{room}` | Returns recorded room summary |
| `POST` | `/session_feedback` | Generates structured student or instructor feedback |
| `GET` | `/feedback/{room}` | Legacy general feedback endpoint |

## Model Notes

### Emotion recognition

`backend_api.py` uses a PyTorch FER classifier with OpenCV face detection. Frames are analyzed at higher resolution for better face detection at normal sitting distance. The backend pads detected face crops before classification to improve stability.

### Head pose

`backend_pose.py` uses a PyTorch yaw-regression model and frontend yaw smoothing. The system classifies:

- `Looking Forward`
- `Looking Left`
- `Looking Right`
- `No Face`

The current thresholds are tuned to be sensitive enough to detect normal left/right head turns.

### Phone detection

Phone detection uses YOLO (`yolov8n.pt`). If a phone is detected, the concentration status is marked as not concentrating and an event is recorded with timestamp.

## Verification Commands

Run these after code changes:

```powershell
python -m py_compile backend_api.py backend_pose.py backend_feedback.py
node --check public\analysis.js
node --check public\meeting.js
node --check server\server.js
```

## Git Workflow

The main development branch used for the model and feedback fixes was:

```text
fix_model
```

The branch has been merged into:

```text
main
```

Repository:

```text
https://github.com/aliabdulmajeed/Facial_Emotion_Reconition-meet
```

## Limitations

- Emotion and attention detection can be affected by lighting, camera angle, face visibility, and hardware quality.
- Head-pose estimation is an approximation and should not be interpreted as proof of attention.
- Phone detection depends on webcam visibility and YOLO confidence.
- Feedback quality depends on the completeness of recorded session data and questionnaire answers.
- LLM feedback requires `GROQ_API_KEY`; without it, the backend returns fallback visual feedback.

## Academic and Ethical Use

FER Meet is intended to support instructor awareness during online learning sessions. It should be used transparently, with participant consent, and with care when interpreting emotional or behavioral signals. The system should support human decision-making rather than replace it.
