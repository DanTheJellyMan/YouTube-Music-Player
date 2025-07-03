/*
    Notes:

    Current user auth in middleware, as well as /login and /signup routes, are vulnerable to SQL injections,
    but do not pose a serious threat, as it would likely only cause access or modification to user_data.db.

    There may or may not be a possibility that if someone passes the user auth middleware,
    could access another user's playlist(s)

    TODO (for the future):
        Add a logger class, which prints to console and stores all logs,
        as well as serves them remotely for remote access to server.
*/

const PARENT_DIR = require.main.path;
const path = require("path");
const fs = require("fs/promises");
const Database = require("better-sqlite3");

const dbHandler = require("./modules/database_handler.js");
const serverHelper = require("./modules/server_helpers.js");
const playlistHandler = require("./modules/playlist_handler.js");

const cookieParser = require("cookie-parser");
const express = require("express");
const generalHelpers = require("./modules/general_helpers.js");
const app = express();
const PORT = 3000;
const { USER_DB } = serverHelper.initServer(
    app,
    PORT,
    path.join(PARENT_DIR, "ssl_cert")
    `danthejellyman.men`
);

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
    /* Allow specific routes to skip auth */
    const p = req.path;

    // Automatically reroutes
    if (p === "/") {
        return next();
    }
    // Files and assets
    if (req.method === "GET") {
        if (p.endsWith(".ico") || p.endsWith(".woff2")) {
            return next();
        }
    }
    // Account login or account creation
    if (req.method === "POST") {
        if (p.startsWith("/login") || p.startsWith("/signup")) {
            return next();
        }
    }

    try {
        const { username, password } = req.cookies;
        const exists = serverHelper.checkLogin(USER_DB, "users", username, password);
        if (!exists) return res.redirect("/login");
    } catch (err) {
        return res.redirect("/login");
    }
    return next();
});
app.use(express.static(path.join(PARENT_DIR, "public"), {
    setHeaders(res, filepath) {
        // Default Headers
        res.setHeader("Cache-Control",
            "no-cache, max-age=0, must-revalidate"
        );

        // Custom headers
        switch (path.extname(filepath).toLowerCase()) {
            case ".js":
            case ".html":
            case ".css":
            case ".ico":
            case ".webp":
            case ".gif":
                res.setHeader("Cache-Control",
                    "no-cache, max-age=0, must-revalidate"
                );
                break;
            case ".woff2":
                res.setHeader("Cache-Control",
                    "public, proxy-revalidate, immutable, s-maxage=604800"
                );
                break;
        }
        if (filepath.toLowerCase().includes("hls")) {
            res.setHeader("Cache-Control",
                "public, proxy-revalidate, immutable, s-maxage=604800"
            );
        }
    }
}));

app.get("/", (req, res) => res.redirect("/home"));

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const exists = serverHelper.checkLogin(USER_DB, "users", username, password);
    if (!exists) {
        res.status(401).send(
            `No user found with given login credentials:\n${JSON.stringify(
                { username, password },
                null,
                4
            )}`
        );
        return;
    }
    
    loginCookies(res, username, password);
    res.status(200).send("Login successful");
});

app.post("/signup", async (req, res) => {
    const { username, password } = req.body;
    const { ok, status, text } = await serverHelper.signUp(USER_DB, "users", username, password);

    if (ok) loginCookies(res, username, password);
    res.status(status).send(text);
});

app.get("/get-playlists", async (req, res) => {
    const { username } = req.cookies;
    const user = dbHandler.find(USER_DB, "users", [
        ["username", username]
    ])[0];

    res.status(200).json(JSON.parse(user["playlists_json"]));
});

app.post("/upload-playlist", async (req, res) => {
    const { username } = req.cookies;
    let url;

    try {
        url = decodeURIComponent(req.query.url).trim();
        if (typeof url !== "string") {
            return res.status(401).send("Invalid URL input type")
        } else if (!url.startsWith("youtube.com/playlist?list=")) {
            return res.status(401).send("Playlist URL must start with 'youtube.com/playlist?list='");
        } else {
            res.status(200).send("Downloading playlist");
        }

        await playlistHandler.downloadPlaylist(USER_DB, "users", username,
            url,
            6,
            10,
            (username.includes("damndaniel")) ? 500 : 50
        );
        console.log(`${username} - Finished downloading playlist from URL:\t${url}`);
    } catch (err) {
        console.error(err);
    }
});

// REMOVE ONCE PLAYLIST STORAGE DESIGN IS FINISHED
app.post("/make-playlist", async (req, res) => {
    const userFolder = dbHandler.find(USER_DB, "users", [
        ["username", req.cookies.username]
    ])[0]["folder_name"];
    const { playerName, playlistName, songNames } = req.body;
    
    try {
        await playlistHandler.makePlaylist(playerName, userFolder, playlistName, songNames);
        return res.status(200).end();
    } catch (err) {
        console.error(err);
        return res.status(401).end();
    }
});

// For obtaining a playlist .m3u8
app.get("/play", (req, res) => {
    const { username } = req.cookies;
    const userFolder = dbHandler.find(USER_DB, "users", [
        ["username", username]
    ])[0]["folder_name"];
    const playlistName = decodeURIComponent(req.query.playlist).trim();
    const playlistPath = path.join(
        PARENT_DIR, "user_playlists", userFolder, playlistName, "playlist.m3u8"
    );
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.sendFile(playlistPath);
});

// For obtaning a playlist .m3u8's chunks (.ts)
app.get("/play/:playlist/:song/:chunk", (req, res) => {
    const userFolder = dbHandler.find(USER_DB, "users", [
        ["username", req.cookies.username]
    ])[0]["folder_name"];
    const { playlist: playlistName, song, chunk } = req.params;
    const chunkPath = path.join(PARENT_DIR, "user_playlists", userFolder, playlistName, song, chunk);
    res.sendFile(chunkPath);
});

// Simple route to allow client to measure latency, to determine
// what quality of assets (currently for thumbnails) to load
// (a bit flawed, since thumbnails are loaded from YouTube and not this server, so latency could be quite different)
app.get("/ping", (req, res) => res.status(200).end());

app.use((req, res) => res.status(404).send("Not found"));



/**
 * Set login credentials in cookies for quick login next time
 * 
 * (Not secure, should ideally create session tokens instead, but idgaf)
 * @param {Response<any, Record<string, any>} res 
 * @param {string} username 
 * @param {string} password 
 */
function loginCookies(res, username, password) {
    res.cookie("username", username, {
        secure: true,
        httpOnly: true,
        maxAge: new Date(Date.now() + Date.now()/10),
        sameSite: "strict"
    });
    res.cookie("password", password, {
        secure: true,
        httpOnly: true,
        expires: new Date(Date.now() + Date.now()/10),
        sameSite: "strict"
    });
}