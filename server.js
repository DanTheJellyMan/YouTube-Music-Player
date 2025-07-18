/*
    Notes:

    Current user auth in middleware, as well as /login and /signup routes, are vulnerable to SQL injections,
    but do not pose a serious threat, as it would likely only cause access or modification to user_data.db.

    There may or may not be a possibility that if someone passes the user auth middleware,
    could access another user's playlist(s)

    TODO:
        Add a logger class, which prints to console and stores all logs,
        as well as serves them remotely for remote access to server.
*/

const path = require("path");
const PARENT_DIR = require.main["path"];
const modulesPath = path.join(PARENT_DIR, "modules");
const fs = require("fs/promises");
const Database = require("better-sqlite3");

/**
 * @type {import("./modules/database_handler.js")}
 */
const dbHandler = require(path.join(modulesPath, "database_handler.js"));

/**
 * @type {import("./modules/server_helpers.js")}
 */
const serverHelper = require(path.join(modulesPath, "server_helpers.js"));

/**
 * @type {import("./modules/playlist_handler.js")}
 */
const playlistHandler = require(path.join(modulesPath, "playlist_handler.js"));

/**
 * @type {import("./modules/general_helpers.js")}
 */
const generalHelpers = require(path.join(modulesPath, "general_helpers.js"));

/**
 * @type {import("./modules/server_config.js")}
 */
const serverConfig = require(path.join(modulesPath, "server_config.js"));

const compression = require("compression");
const cookieParser = require("cookie-parser");
const express = require("express");
const cors = require("cors");

const app = express();
const { USER_DB } = serverHelper.initServer(app);

app.use(cors({
    origin: (origin, callback) => {
        if (serverConfig.corsWhitelist.includes(origin) || origin === undefined) {
            return callback(null, true);
        }
        return callback(`Blocked by CORS [${origin}]`);
    }
}));
app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.use(userAuthMiddleware);
app.use(express.static(path.join(PARENT_DIR, "public"), {
    setHeaders(res, filepath) {
        httpHeaderMiddleware(res, filepath);
    }
}));

app.get("/", (req, res) => res.redirect("/home"));

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const exists = serverHelper.checkLogin(USER_DB, "users", username, password);
    if (!exists) {
        return res.status(401).send(
            `No user found with given login credentials:\n`+
            JSON.stringify({ username, password }, null, 4)
        );
    }
    loginCookies(res, username, password);
    res.status(200).send("Login successful");
});

app.post("/signup", async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    const { ok, status, text } = await serverHelper.signUp(USER_DB, "users", username, password);
    if (ok) loginCookies(res, username, password);
    res.status(status).send(text);
});

app.get("/get-playlists", (req, res) => {
    const { username } = req.cookies;
    const user = dbHandler.find(USER_DB, "users", [
        ["username", username]
    ])[0];
    res.status(200).json(JSON.parse(user["playlists_json"]));
});

app.get("/get-playlist-timestamps", (req, res) => {
    const { username } = req.cookies;
    const userFolder = dbHandler.find(USER_DB, "users", [
        ["username", username]
    ])[0]["folder_name"];
    const playlistName = decodeURIComponent(req.query.name);
    const playlistTimestampsPath = path.join(
        PARENT_DIR, "user_playlists", userFolder, playlistName, "playlistTimestamps.json"
    );
    res.sendFile(playlistTimestampsPath);
});

// For obtaining a playlist .m3u8
app.get("/play/:playlist/", (req, res) => {
    const { username } = req.cookies;
    const userFolder = dbHandler.find(USER_DB, "users", [
        ["username", username]
    ])[0]["folder_name"];

    const playlistName = decodeURIComponent(req.params.playlist).trim();
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

        await playlistHandler.downloadPlaylist(USER_DB, "users", username, url,
            3, 10, username.includes("damndaniel") ? 50 : 50
        );
        console.log(`${username} - Finished downloading playlist from URL:\t${url}`);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(401).end();
    }
});

// Measure client latency to determine quality of thumbnails to load
// (a bit flawed, since thumbnails are loaded from YouTube and not this server, so latency could be quite different)
app.get("/ping", (req, res) => res.status(200).end());

app.use((req, res) => res.status(404).send("Not found"));



function userAuthMiddleware(req, res, next) {
    /* Allow specific routes to skip auth */
    const p = req.path;
    
    if (p === "/") { // Automatically reroutes
        return next();
    }
    if (p.startsWith("/login") || p.startsWith("/signup")) {
        return next();
    }
    
    if (req.method === "GET") { // Files and assets
        if (p.endsWith(".ico") || p.endsWith(".woff2")) {
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
}

function httpHeaderMiddleware(res, filepath) {
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