require("dotenv").config();
const path = require("path");
const express = require("express");
const { AccessToken } = require("livekit-server-sdk");
const { createProxyMiddleware, fixRequestBody } = require("http-proxy-middleware");

const app = express();

// ===================== API PROXIES FIRST =====================

app.use(
    "/api/predict",
    createProxyMiddleware({
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
        pathRewrite: () => "/predict",
    })
);

app.use(
    "/api/pose_phone",
    createProxyMiddleware({
        target: "http://127.0.0.1:6001",
        changeOrigin: true,
        pathRewrite: () => "/pose_phone",
    })
);

app.use(
    "/api/questionnaire",
    createProxyMiddleware({
        target: "http://127.0.0.1:7001",
        changeOrigin: true,
        pathRewrite: () => "/questionnaire",
        on: {
            proxyReq: fixRequestBody,
        },
    })
);

app.use(
    "/api/collect",
    createProxyMiddleware({
        target: "http://127.0.0.1:7001",
        changeOrigin: true,
        pathRewrite: () => "/collect",
        on: {
            proxyReq: fixRequestBody,
        },
    })
);

app.use(
    "/api/session_feedback",
    createProxyMiddleware({
        target: "http://127.0.0.1:7001",
        changeOrigin: true,
        pathRewrite: () => "/session_feedback",
        on: {
            proxyReq: fixRequestBody,
        },
    })
);

// ===================== NORMAL EXPRESS AFTER PROXIES =====================

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

let { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, PORT = 3000 } = process.env;

LIVEKIT_URL = (LIVEKIT_URL || "").trim();
LIVEKIT_API_KEY = (LIVEKIT_API_KEY || "").trim();
LIVEKIT_API_SECRET = (LIVEKIT_API_SECRET || "").trim();

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.error("Missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET in server/.env");
    process.exit(1);
}

if (!LIVEKIT_URL.startsWith("wss://")) {
    console.error("LIVEKIT_URL must start with wss://, got:", LIVEKIT_URL);
    process.exit(1);
}

app.post("/token", async (req, res) => {
    try {
        const { room, name, role } = req.body || {};

        if (!room || !name || !role) {
            return res.status(400).json({ error: "room, name, role required" });
        }

        const identity = `${name}-${Math.random().toString(36).slice(2, 8)}`;

        const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity,
            name,
        });

        at.addGrant({
            room,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        });

        const token = await at.toJwt();

        return res.json({ token, url: LIVEKIT_URL });
    } catch (e) {
        console.error("Token endpoint error:", e);
        return res.status(500).json({ error: "Token endpoint failed" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
    console.log(`FER proxy: /api/predict -> http://127.0.0.1:5000/predict`);
    console.log(`Pose/Phone proxy: /api/pose_phone -> http://127.0.0.1:6001/pose_phone`);
    console.log(`Questionnaire proxy: /api/questionnaire -> http://127.0.0.1:7001/questionnaire`);
    console.log(`Feedback proxy: /api/session_feedback -> http://127.0.0.1:7001/session_feedback`);
});
