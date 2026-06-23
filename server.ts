import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";

dotenv.config();

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_do_not_use_in_prod";

// Generate a random string for state parameter
const generateRandomString = (length: number) => {
  return crypto.randomBytes(60).toString("hex").slice(0, length);
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // API ROUTES
  
  // 1. Spotify Login Authorize Request
  app.get("/api/auth/spotify/login", (req, res) => {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return res.status(500).json({ error: "Spotify credentials are not configured on the server." });
    }

    const state = generateRandomString(16);
    // Determine redirect URI dynamically based on the request host (useful for Dev/Prod compatibility)
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers.host;
    const redirect_uri = `${protocol}://${host}/api/auth/spotify/callback`;

    // Store state in a cookie to verify it in the callback
    res.cookie("spotify_auth_state", state);

    const scope = "user-read-private user-read-email";

    const params = new URLSearchParams({
      response_type: "code",
      client_id: SPOTIFY_CLIENT_ID,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state,
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  });

  // 2. Spotify Callback Handle
  app.get("/api/auth/spotify/callback", async (req, res) => {
    const code = req.query.code as string || null;
    const state = req.query.state as string || null;
    const storedState = req.cookies ? req.cookies["spotify_auth_state"] : null;

    if (state === null || state !== storedState) {
      return res.redirect("/?error=state_mismatch");
    }

    res.clearCookie("spotify_auth_state");

    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers.host;
    const redirect_uri = `${protocol}://${host}/api/auth/spotify/callback`;

    try {
      // Request access token and refresh token
      const tokenResponse = await axios.post("https://accounts.spotify.com/api/token", 
        new URLSearchParams({
          code: code!,
          redirect_uri: redirect_uri,
          grant_type: "authorization_code"
        }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString("base64")
          }
        }
      );

      const access_token = tokenResponse.data.access_token;
      
      // Fetch user profile from Spotify
      const userResponse = await axios.get("https://api.spotify.com/v1/me", {
        headers: { "Authorization": "Bearer " + access_token }
      });
      
      const userProfile = userResponse.data;
      const isPremium = userProfile.product === "premium";

      // Redirect the user back to the frontend with the status
      // Note: Passing data via URL params is for simple demonstration.
      // In a real app, you might issue a JWT here and set it as an HTTP-only cookie.
      res.redirect(`/?spotifyLogin=success&id=${userProfile.id}&isPremium=${isPremium}`);
      
    } catch (error) {
      console.error("Spotify Auth Error:", error);
      res.redirect("/?error=spotify_auth_failed");
    }
  });


  // VITE MIDDLEWARE FOR DEVELOPMENT
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Depending on Express version, it may be "*" or "*all" for catch-all in Express 5
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
