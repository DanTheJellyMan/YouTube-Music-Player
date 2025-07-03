/**
 * @typedef {Object} Video
 * @property {string} title
 * @property {string} channelName
 * @property {string} channelUrl
 * @property {string} videoUrl
 * @property {Thumbnails} thumbnails
 */

/**
 * @typedef {Object} Thumbnails
 * @property {string} low
 * @property {string} medium
 * @property {string} high
 */

const path = require("path");
const fs = require("fs/promises");
const { readFileSync } = require("fs");

const { v4: uuid } = require("uuid");
const Decimal = require("decimal.js");
const { spawn } = require("child_process");

const { find, update } = require("./database_handler.js");
const { createFolder } = require("./general_helpers.js");

const PARENT_DIR = require.main.path;
const API_KEY = readFileSync(path.join(PARENT_DIR, "YouTube_API_key.txt"));

/**
 * Perform fetch request for playlist link, then only
 * return essential info about playlist content
 * @param {string} link URL of YouTube playlist
 * @param {number} maxVideoLength Max length in minutes a video may be
 * @returns {Promise<Video[]>} Promise resovles to array of objects containing each video's info
 */
async function parseYTLink(link, maxVideoLength = 45) {
    link = link.trim().normalize("NFKC");
    if (!link.startsWith("youtube.com/playlist?list=")) {
        throw Error("Invalid playlist link");
    }
    const trackI = link.indexOf("&si="); // Tracking-info index in URL
    link = link.substring(
        link.indexOf("list=")+5,
        (trackI === -1) ? link.length : trackI
    );
    console.log(`Retrieving playlist info...(ID = ${link})`);

    const links = [];
    let nextPageToken = "";
    do {
        const controller = new AbortController();
        let req, res;
        try {
            let timeout = setTimeout(() => controller.abort(), 1500);
            req = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${link}&maxResults=50&pageToken=${nextPageToken}&key=${API_KEY}`,
                { "signal": controller.signal }
            );
            clearTimeout(timeout);
            if (!req.ok) throw Error();
            res = await req.json();

            // Ignore excessively-lengthy items (that's what she said)
            timeout = setTimeout(() => controller.abort(), 3500);
            const ids = res.items.map(vid => vid.snippet.resourceId.videoId).join(",");
            req = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${API_KEY}`,
                { "signal": controller.signal }
            );
            clearTimeout(timeout);
            if (!req.ok) throw Error();
            const badIds = (await req.json()).items.map(vid => {
                if (parseMinutes(vid.contentDetails.duration) > maxVideoLength) {
                    return vid.id;
                }
            });
            badIds.splice(badIds.indexOf(undefined), 1);
            res.items = res.items.filter(vid => {
                return !(new Set(badIds).has(vid.snippet.resourceId.videoId))
            });
        } catch (err) {
            controller.abort();
            continue;
        }

        nextPageToken = res.nextPageToken;
        links.push(...await filterInfo(res.items));
    } while (nextPageToken);

    return links;

    function parseMinutes(str) {
        str = str.toUpperCase();
        let hours, minutes, tempIndex = str.indexOf("H");
        if (tempIndex === -1) {
            hours = "0";
        } else {
            hours = str.substring(
                str.indexOf("PT")+2,
                tempIndex
            );
        }
        tempIndex = str.indexOf("M");
        if (tempIndex === -1) {
            minutes = "0";
        } else {
            minutes = str.substring(
                (hours === "0") ? str.indexOf("PT")+2 : str.indexOf("H")+1,
                tempIndex
            );
        }
        return parseInt(hours) * 60 + parseInt(minutes);
    }
}
/**
 * Returns only important info and removes deleted videos
 * @param {object[]} items 
 * @returns {Promise<Video[]>}
 */
async function filterInfo(items) {
    const videos = [];
    for (let item of items) {
        item = item.snippet;

        // Ignore deleted videos
        if (item.title === "Deleted video" || item.description === "This video is unavailable.") continue;
        
        videos.push({
            "title": item.title.trim().normalize("NFKC"),
            "channelName": item.videoOwnerChannelTitle.normalize("NFKC").trim(),
            "channelUrl": `https://www.youtube.com/channel/${item.videoOwnerChannelId}`,
            "videoUrl": `https://www.youtube.com/watch?v=${item.resourceId.videoId}`,
            "thumbnails": await fetchOptions(item.thumbnails)
        });
    }
    return videos;
}

/**
 * Get a low, medium, and high option for the thumbnail
 * @param {any} options 
 * @returns {Promise<Thumbnails>}
 */
async function fetchOptions(options) {
    // Sort temp items by height
    const temp = Object.values(options);
    for (let i=0; i<temp.length; i++) {
        for (let j=0; j<temp.length; j++) {
            const controller = new AbortController();
            try {
                const timeout = setTimeout(() => {
                    controller.abort(
                        `TIMEOUT WHILE FETCHING URL: ${temp[j].url}`
                    );
                }, 1500);
                const req = await fetch(temp[j].url, { "signal": controller.signal });

                clearTimeout(timeout);
                if (temp[j].height > temp[i].height && req.ok) {
                    // Swap
                    const other = temp[i];
                    temp[i] = temp[j];
                    temp[j] = other;
                }
            } catch (err) {
                console.error(err);
                controller.abort();
            }
        }
    }
    return {
        "low": temp[0].url,
        "medium": temp[Math.floor((temp.length-1)/2)].url,
        "high": temp[temp.length-1].url
    }
}

/**
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {string} username
 * @param {string} playlistUrl
 * @param {number} quality Overall quality of audio (0 highest - 9 lowest)
 * @param {number} segmentTime Length of audio chunks
 * @param {number} maxVideos Max amount of videos to download from playlist
 * @returns {Promise<string>} Resolves folder name of playlist
 */
async function downloadPlaylist(db, table, username, playlistUrl, quality = 6, segmentTime = 10, maxVideos = 50) {
    const userFolder = find(db, table, [
        ["username", username]
    ])[0]["folder_name"];
    const playlistName = path.basename(await createPlaylistFolder(userFolder));
    addPlaylistToDB();

    const videos = await parseYTLink(playlistUrl);
    logPlaylist(videos);

    // Download songs from YouTube playlist
    for (const song of videos) {
        const filename = uuid();
        
        // Add each song to its own folder
        const playlistDir = path.join(PARENT_DIR, "user_playlists", userFolder, playlistName);

        // Song folder
        const songDir = path.join(playlistDir, filename);

        try {
            await fs.mkdir(songDir, { recursive: false });
            await fs.access(songDir, fs.constants.F_OK); // Test that access to the song directory works
            await downloadVideo(song.videoUrl, playlistDir, filename, quality, segmentTime);

            // Get song length from the m3u8 file
            song["length"] = parseSongLength(
                await fs.readFile(path.join(songDir, `${filename}.m3u8`), { "encoding": "utf8" })
            );
            song["filename"] = filename;
            
            // JSON is read again in case errors happened and folders (aka. songs) were deleted
            // (ultimately done for the simplicity of not having to manage a JSON variable)
            const json = getUserPlaylists(db, table, username);

            /* Update progress */
            let vidCount = 0;
            for (const playlist of json.playlists) {
                if (playlist.name === playlistName) {
                    vidCount = ++json.playlists[i].progress;
                    playlist.songs.push(song);
                    break;
                }
            }
            update(db, table, [
                ["playlists_json", JSON.stringify(json)]
            ], [ ["username", username] ]);

            if (vidCount >= maxVideos) break;

        } catch (err) {
            handleSongDownloadError(songDir, song, err);
        }
    }

    // Set downloaded playlist as done
    const json = getUserPlaylists(db, table, username);
    for (const playlist of json) {
        if (playlist.name === playlistName) {
            playlist.done = true;
            break;
        }
    }
    update(db, table, [
        ["playlists_json", JSON.stringify(json)]
    ], [ ["username", username] ]);

    return playlistName;
}

/**
 * Add playlist to user's JSON DB entry
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {string} username
 * @param {string} playlistName 
 */
function addPlaylistToDB(db, table, username, playlistName) {
    const json = JSON.parse(
        find(db, table, [
            ["username", username]
        ])[0]["playlists_json"]
    );

    json.playlists.push({
        "name": playlistName,
        "progress": 0, // Amt of songs downloaded,
        "done": false,
        "songs": []
    });
    
    update(db, table, [
        ["playlists_json", JSON.stringify(json)]
    ], [ ["username", username] ]);
}

/**
 * Convenience function to get user's playlists_json from DB
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {string} username 
 * @returns {any[]} Array of all playlists
 */
function getUserPlaylists(db, table, username) {
    return JSON.parse(
        find(db, table, [
            ["username", username]
        ])[0]["playlists_json"]
    );
}

/**
 * @param {string} folderToRemove Song's folder directory
 * @param {Video} song 
 * @param {Error} err 
 */
function handleSongDownloadError(folderToRemove, song, err) {
    try {
        // Timeout before removing failed songs, because errors were happening
        // when trying to do this immediately 
        setTimeout(() => {
            fs.rm(folderToRemove, { "recursive": true, "force": true });
        }, 1000);
    } catch (e) {
        console.error(
            Error(
                `ERROR WHILE TRYING TO REMOVE INVALID SONG FOLDER (${folderToRemove})`+
                `\n${e.message || e}`,
                { "cause": e.cause || err }
            )
        );
    }
    const filename = path.basename(folderToRemove);
    console.error(
        Error(
            `ERROR DURING VIDEO DOWNLOAD (${filename}, ${song.videoUrl})\n${err.message || err}\n`,
            { "cause": err.cause }
        )
    );
}

/**
 * Log playlist details
 * @param {Video[]} videos 
 */
function logPlaylist(videos) {
    const MAX_VIDEOS_TO_LOG = 3;
    console.log(`${username} - Downloading playlist...(Length: ${videos.length})`);
    if (videos.length > MAX_VIDEOS_TO_LOG) {
        const shortened = JSON.stringify(videos.slice(0, MAX_VIDEOS_TO_LOG), null, 4);
        console.log(
            `${shortened.substring(0, shortened.length-2)},\n`+
            `    ${videos.length-MAX_VIDEOS_TO_LOG} more videos...\n]`
        );
    } else {
        console.log(videos);
    }
}

/**
 * @param {string} url YouTube video URL
 * @param {string} playlistDir Playlist folder
 * @param {string} filename Song file/folder name
 * @param {number} quality Overall quality of audio (0 highest - 9 lowest)
 * @param {number} segmentTime Length of audio chunks
 * @returns {Promise<void>}
 */
function downloadVideo(url, playlistDir, filename, quality = 6, segmentTime = 10) {
    return new Promise(async (resolve, reject) => {
        let ytdlp, ffmpeg;
        try {
            ytdlp = createCMD("yt-dlp", [
                `-f`, `bestaudio`,
                `--ignore-errors`, "--geo-bypass",
                `-o`, `-`, // Export to stdout
                `${url}`,
            ], { "cwd": path.join(playlistDir, filename) });
            if (!ytdlp.cmd.stdout) {
                throw Error(`YT-DLP ERROR!\t${JSON.stringify(ytdlp, null, 4)}`)
            }
            
            ffmpeg = createCMD("ffmpeg", [
                `-i`, `pipe:0`,
                `-af`, `anlmdn=s=25`, // Noise reduction
                `-af`, `acompressor=ratio=2:threshold=-50dB:attack=1`, // Acts as an Expander
                `-af`, `acompressor=ratio=4.35:threshold=-36dB:attack=1:release=120`, // Acts as a normal Compressor
                `-af`, `loudnorm=I=-17:LRA=10:TP=-0.5`, // Loudness normalization
                `-c:a`, `libmp3lame`, `-q:a`, `${quality}`,
                `-f`, `hls`,
                `-start_number`, `0`,
                `-hls_list_size`, `0`,
                `-hls_time`, `${segmentTime}`,
                `-hls_segment_filename`, `${filename}_%05d.ts`,
                `${filename}.m3u8`
            ], { "cwd": path.join(playlistDir, filename) });
            if (!ffmpeg.cmd.stdin) {
                throw Error(`FFMPEG ERROR!\t${JSON.stringify(ffmpeg, null, 4)}`)
            }
            ytdlp.cmd.stdout.on("error", err => {
                console.error(err.toString());
            });
            ytdlp.cmd.stderr.on("data", data => {});
            ytdlp.cmd.stderr.on("error", err => {});
            ffmpeg.cmd.stdin.on("error", err => {
                console.error(err.toString());
            });

            ytdlp.cmd.stdout.pipe(ffmpeg.cmd.stdin);
            await ytdlp.done;
            await ffmpeg.done;
            cleanup();
            return resolve(); 
        } catch (err) {
            cleanup();
            return reject(err);
        }
        function cleanup() {
            ytdlp.cmd.removeAllListeners();
            ffmpeg.cmd.removeAllListeners();
            ytdlp.cmd.kill();
            ffmpeg.cmd.kill();
        }
    });
}

/**
 * Adds up lengths from the #EXTINF tags to total up to the song's full length
 * @param {string} m3u8 File contents of playlist file
 * @returns {number} Total length of m3u8 playlist (seconds)
 */
function parseSongLength(m3u8) {
    let total = 0;
    let lastIndex = 0;
    while (true) {
        const index = m3u8.indexOf("#EXTINF", lastIndex);
        if (index === -1) break;

        const timeIndex = m3u8.indexOf(":", index) + 1;
        const commaIndex = m3u8.indexOf(",", timeIndex);
        total += parseFloat(m3u8.substring(timeIndex, commaIndex));
        lastIndex = commaIndex;
    }
    return total;
}

/**
 * Create a playlist folder 
 * @param {string} userFolder 
 * @returns {Promise<userFolder>} Resolves to created folder's absolute path
 */
async function createPlaylistFolder(userFolder) {
    let path, i = 0;
    do {
        if (i > 100_000) throw Error("ERROR: excessive playlist folder creation attempts");
        const playlistFolderDir = path.join(PARENT_DIR, "user_playlists", userFolder, `playlist_${i++}`);
        path = await createFolder(playlistFolderDir);
    } while (path === null);
    return path;
}

/**
 * DEPRECATED, REMOVE LATER
 * 
 * Makes M3U8 playlist file
 * @param {*} playerName 
 * @param {*} userFolder 
 * @param {*} playlistName 
 * @param {*} songNames 
 * @returns 
 */
async function makePlaylist(playerName, userFolder, playlistName, songNames) {
    console.error("REMOVE THIS FUNCTION ASAP, IT'S OUTDATED");

    const playlistDir = `${PARENT_DIR}\\user_playlists\\${userFolder}\\${playlistName}`;

    // Find any m3u8 segment length (target duration)
    const segmentTime = calcAvgSegmentTime(
        await fs.readFile(`${playlistDir}\\${songNames[0]}\\${songNames[0]}.m3u8`,
            { "encoding": "utf8" }
        )
    );
    let playlist_m3u8 = `#EXTM3U\n#EXT-X-VERSION:3\n`+
    `#EXT-X-TARGETDURATION:${segmentTime}\n#EXT-X-MEDIA-SEQUENCE:0\n`;

    for (const song of songNames) {
        const m3u8 = await fs.readFile(`${playlistDir}\\${song}\\${song}.m3u8`,
            { "encoding": "utf8" }
        );
        const adjusted = adjustSongPaths(song, m3u8);
        playlist_m3u8 += `\n#EXT-X-DISCONTINUITY\n${
            adjusted.substring(
                adjusted.indexOf("#EXTINF"), adjusted.indexOf("#EXT-X-ENDLIST")-1
            )
        }\n`;
    }

    const m3u8_path = `${playlistDir}\\${playerName}.m3u8`;
    await fs.writeFile(m3u8_path, `${playlist_m3u8}\n#EXT-X-ENDLIST`);
    return m3u8_path;
}
// DEPRECATED, REMOVE LATER
function calcAvgSegmentTime(m3u8) {
    let total = 0, count = 0, index = 0, lastIndex = 0;
    while (true) {
        index = m3u8.indexOf("#EXTINF", lastIndex);
        if (index === -1) break;
        total += parseFloat(m3u8.substring(index+8, m3u8.indexOf(",", index+8)).trim());
        count++;
        lastIndex = index + 1;
    }
    const avg = Math.round(total / count);
    return avg;
}
// DEPRECATED, REMOVE LATER
function adjustSongPaths(parent, m3u8) {
    let index = 0, lastIndex = 0;
    while (true) {
        index = m3u8.indexOf(",", lastIndex);
        if (index === -1) break;
        m3u8 = `${m3u8.substring(0, index+2)}${parent}\\${m3u8.substring(index+2, m3u8.length)}`;
        lastIndex = index+2;
    }
    return m3u8;
}

/**
 * Creates a child process spawn
 * @param {string} command
 * @param {string[]} options
 * @param {SpawnOptionsWithoutStdio} options2 Typically contains { cwd: [PROCESS DIRECTORY] }
 * @returns {{"cmd": ChildProcessWithoutNullStreams, "done": Promise<string>} | null} Resolve upon process close
 */
function createCMD(command, options, options2 = {"cwd": PARENT_DIR}) {
    let cmd;
    try {
        cmd = spawn(command, options, options2);
    } catch (err) { console.error(err.toString()); return null; }
    cmd.stdout.on("data", data => {});
    cmd.stdout.on("error", err => {});
    cmd.stdin.on("data", data => {});
    cmd.stdin.on("error", err => {});
    cmd.stderr.on("data", err => {});
    cmd.stderr.on("error", err => {});
    cmd.on("error", err => {});
    
    const done = new Promise((resolve, reject) => {
        try {
            cmd.on("exit", code => {
                cmd.removeAllListeners();
                if (code !== 0) {
                    return reject(
                        Error(`${command} CMD EXITED WITH ERROR CODE ${code}`)
                    );
                }
                return resolve(`${code}`);
            });
        } catch (err) {
            return reject(err);
        }
    });

    return { cmd, done };
}

module.exports = {
    parseYTLink,
    filterInfo,
    downloadPlaylist,
    downloadVideo,
    parseSongLength,
    
    createPlaylistFolder,
    makePlaylist,
    createCMD,
};