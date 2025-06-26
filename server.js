const PARENT_DIR = require.main.path;
const path = require("path");
const fs = require("fs/promises");
const Database = require("better-sqlite3");

const dbHandler = require("./modules/database_handler.js");
const serverHelper = require("./modules/server_helpers.js");
const playlistHandler = require("./modules/playlist_handler.js");
const sessionHandler = require("./modules/session_handler.js");

const cookieParser = require("cookie-parser");
const express = require("express");
const generalHelpers = require("./modules/general_helpers.js");
const PORT = 3000;
const app = express();
const { USER_DB } = serverHelper.initServer(
    app,
    PORT,
    `${__dirname}\\ssl_cert`,
    `danthejellyman.men`
);
const sessionManager = new sessionHandler.Manager(USER_DB, "users");

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
    // Allow login/signup routes to skip auth
    // as well as / since it redirects
    const p = req.path;
    if (p === "/" ||
        p.includes("login") ||
        p.includes("signup") ||
        p.endsWith(".ico") ||
        p.endsWith(".woff2")
    ) return next();

    try {
        const { username, password } = req.cookies;
        const exists = serverHelper.checkLogin(USER_DB, "users", username, password);
        if (!exists) return res.redirect("/login");
    } catch (err) {
        return res.redirect("/login");
    }
    return next();
});
app.use(express.static(path.join(__dirname, "public"), {
    setHeaders(res, filepath) {
        // Default Headers
        res.setHeader("Cache-Control",
            "no-cache, max-age=0, must-revalidate"
        );
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
    const { username, password } = req.cookies;
    const user = dbHandler.find(USER_DB, "users", [
        ["username", username],
        ["password", password]
    ])[0];

    res.status(200).json(JSON.parse(user["playlists_json"]));
});

app.post("/upload-playlist", async (req, res) => {
    const { username } = req.cookies;
    let url;

    try {
        url = req.body.url.trim();
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
        try {
            return res.status(401).send(err);
        } catch (err) {}
    }
});

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

// For obtaining a playlist m3u8
app.get("/play/:playlistName/:playerName", (req, res) => {
    const { username } = req.cookies;
    const userFolder = dbHandler.find(USER_DB, "users", [
        ["username", username]
    ])[0]["folder_name"];
    const { playlistName, playerName } = req.params;

    sessionManager.checkForFlush(username);

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.sendFile(`${PARENT_DIR}\\user_playlists\\${userFolder}\\${playlistName}\\${playerName}.m3u8`);
});
// For obtaning a playlist m3u8's chunks (.ts)
app.get("/play/:playlistName/:songName/:songChunk", (req, res) => {
    const userFolder = dbHandler.find(USER_DB, "users", [
        ["username", req.cookies.username]
    ])[0]["folder_name"];
    const { playlistName, songName, songChunk } = req.params;
    res.sendFile(
        `${PARENT_DIR}\\user_playlists\\${userFolder}\\${playlistName}\\${songName}\\${songChunk}`
    );
});

app.get("/ping", (req, res) => res.status(200).end());

app.use((req, res) => res.status(404).send("Not found"));



/**
 * Send login credentials in cookies for quick login next time
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