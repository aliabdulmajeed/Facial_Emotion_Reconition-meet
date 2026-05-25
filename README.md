# FER Meet

FER Meet is a web-based Facial Emotion Recognition meeting system for online learning sessions. It combines live video meetings with emotion analysis, head-pose estimation, phone-distraction detection, instructor analytics, questionnaires, chat, and AI feedback.

## Features

- Live video meeting rooms with LiveKit.
- Facial emotion recognition from video frames.
- Head-pose and phone-distraction detection.
- Instructor dashboard with concentration and attention analytics.
- Student and instructor questionnaire flow.
- Role-specific AI feedback for instructors and students.
- Responsive web interface for desktop, tablet, and mobile.

## Project Structure

```text
fer-meet/
  backend_api.py          # FER prediction backend
  backend_pose.py         # Head pose and phone detection backend
  backend_feedback.py     # Questionnaire and AI feedback backend
  public/                 # Frontend pages, styles, and client scripts
  server/                 # Express and LiveKit token server
  savedmodel_clcm/        # Saved FER model files
```

## Environment Variables

Create `server/.env` for LiveKit:

```env
LIVEKIT_URL=wss://your-livekit-url
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
PORT=3000
```

Set the feedback API key in the terminal that runs `backend_feedback.py`:

```powershell
$env:GROQ_API_KEY="your_groq_api_key"
```

If you use the OpenAI feedback path in `backend_api.py`, set:

```powershell
$env:OPENAI_API_KEY="your_openai_api_key"
```

Do not commit real API keys. `.env` files are ignored by Git.

## Run The Project

Use separate terminals.

```powershell
# Terminal 1 - FER API
conda activate fer_onnx
cd C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet
python -m uvicorn backend_api:app --host 127.0.0.1 --port 5000

# Terminal 2 - Web server
cd C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\server
npm start

# Terminal 3 - Cloudflare tunnel
cloudflared tunnel --url http://localhost:3000

# Terminal 4 - Pose backend
conda activate fer_backend
cd C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet
python -m uvicorn backend_pose:app --host 127.0.0.1 --port 6001

# Terminal 5 - AI feedback backend
conda activate fer_backend
cd C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet
$env:GROQ_API_KEY="your_groq_api_key"
python -m uvicorn backend_feedback:app --host 127.0.0.1 --port 7001
```

Open the website at:

```text
http://localhost:3000
```

Use the Cloudflare URL from Terminal 3 for public access.

## Academic Scope

This project is designed for research-based online learning analysis. The AI and computer-vision outputs should be treated as supportive indicators, not final judgments about student behavior or learning quality.

## Repository

GitHub: https://github.com/aliabdulmajeed/Facial_Emotion_Reconition-meet

