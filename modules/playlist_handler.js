/**
 * @typedef {object} Video
 * @property {string} title
 * @property {string} channelName
 * @property {string} channelUrl
 * @property {string} videoUrl
 * @property {Thumbnails} thumbnails
 */

/**
 * @typedef {object} Thumbnails
 * @property {string} low
 * @property {string} medium
 * @property {string} high
 */

const path = require("path");
const fs = require("fs/promises");

const { v4: uuid } = require("uuid");
const { Decimal } = require("decimal.js");
Decimal.set({ "precision": 500_000 });
const { spawn } = require("child_process");

const { find, update } = require("./database_handler.js");
const { createFolder, createChildProcess } = require("./general_helpers.js");
const ThreadManager = require("./ThreadManager.js");

const PARENT_DIR = require.main.path;
const serverConfig = require("./ServerConfig.js");
const API_KEY = serverConfig.youtubeAPIKey;
const FFmpegThreadManager = new ThreadManager();

/**
 * Perform fetch request for playlist link, then writes essential info about playlist's content into temp file at playlist's file directory
 * @param {string} link URL of YouTube playlist
 * @param {string} tempVideosPath Path of temp file that holds all Video objects
 * @param {number} maxVideoLengthMinutes Max length a video may be
 * @returns {Promise<void>}
 */
async function parseYTLink(link, tempVideosPath, maxVideoLengthMinutes = 45) {
    link = link.trim().normalize("NFKC");
    if (!link.startsWith("youtube.com/playlist?list=")) {
        throw new Error("Invalid playlist link");
    }
    const trackI = link.indexOf("&si="); // Unnecessary tracking param
    const playlistId = link.substring(
        link.indexOf("list=")+5,
        (trackI === -1) ? link.length : trackI
    );
    console.log(`Retrieving playlist info...(ID = ${playlistId})`);

    const TIMEOUT_DELAY_MS = 1500;
    let nextPageToken = "";
    do {
        const playlistItemsURL =
            `https://www.googleapis.com/youtube/v3/playlistItems?`+
            `part=snippet&playlistId=${playlistId}&maxResults=50&`+
            `pageToken=${nextPageToken}&key=${API_KEY}`;
        let playlist = null;
        try {
            playlist = await (
                await fetchWithTimeout(playlistItemsURL, TIMEOUT_DELAY_MS)
            ).json();

            const ids = playlist.items.map(vid => {
                return vid.snippet.resourceId.videoId;
            }).join(",");
            const videoDetailsURL =
                `https://www.googleapis.com/youtube/v3/videos?`+
                `part=contentDetails&id=${ids}&key=${API_KEY}`;
            const videoDetails = await (
                await fetchWithTimeout(videoDetailsURL, TIMEOUT_DELAY_MS)
            ).json();

            const badIdsSet = new Set(
                getBadIdArray(videoDetails.items, maxVideoLengthMinutes)
            );
            playlist.items = playlist.items.filter(vid => {
                return !badIdsSet.has(vid.snippet.resourceId.videoId)
            });
        } catch (err) {
            console.error(err);
            continue;
        }

        nextPageToken = playlist.nextPageToken;
        const filteredVideosStr = (await filterInfo(playlist.items))
            .map(Video => JSON.stringify(Video))
            .join("\n");
        await fs.appendFile(tempVideosPath, `${filteredVideosStr}\n`);


    } while (nextPageToken);

    async function fetchWithTimeout(resource = "", timeoutDelayMS = 5000, options = {}) {
        const controller = new AbortController();
        options["signal"] = controller.signal;
        let res = null;
        try {
            const timeout = setTimeout(() => {
                controller.abort(`TIMEOUT WHILE FETCHING RESOUCE: ${resource}`);
            }, timeoutDelayMS);
            res = await fetch(resource, options);
            clearTimeout(timeout);
            if (!res.ok) throw new Error(await res.text());
            return res;
        } catch (err) {
            controller.abort(err);
            throw new Error(`${err}\tResponse: ${res}`);
        }
    }

    function getBadIdArray(items, maxTimeMinutes) {
        return items
        .map(vid => {
            if (parseMinutes(vid["contentDetails"]["duration"]) > maxTimeMinutes) {
                return vid.id;
            }
        })
        .filter(badId => badId !== undefined);
    }

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
 * Returns new Video array with only important info and no deleted videos
 * @param {object[]} items 
 * @returns {Promise<Video[]>}
 */
async function filterInfo(items) {
    const videos = [];
    for (let item of items) {
        item = item.snippet;

        if (item.title === "Deleted video" ||
            item.description === "This video is unavailable."
        ) continue;
        
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
 * @param {object} options 
 * @returns {Promise<Thumbnails>}
 */
async function fetchOptions(options) {
    // Sort temp items by height
    const temp = Object.values(options);
    for (let i=0; i<temp.length; i++) {
        for (let j=0; j<temp.length; j++) {
            if (temp[j] === temp[i]) continue;
            if (temp[j].height > temp[i].height) {
                const other = temp[i];
                temp[i] = temp[j];
                temp[j] = other;
            }
        }
    }
    return {
        "low": temp[0].url,
        "medium": temp[Math.floor((temp.length-1)/2)].url,
        "high": temp[temp.length-1].url
    }
}

class TempVideoFileParser {
    static createReadStream = require("fs").createReadStream;
    static createReadlineInterface = require("readline").createInterface
    #filepath = null;
    #lastByteRead = 0;

    constructor(filepath = "") {
        this.#filepath = filepath;
    }

    /**
     * @param {string} targetVideoUrl 
     * @returns {Promise<Video | null>}
     */
    readNextVideo(targetVideoUrl = null) {
        return new Promise((resolve, reject) => {
            const stream = TempVideoFileParser.createReadStream(this.#filepath, {
                "start": this.#lastByteRead
            });
            const readline = TempVideoFileParser.createReadlineInterface({
                "input": stream,
                "crlfDelay": Infinity
            });
            let settled = false;

            readline.on("line", line => {
                if (settled) return;

                this.#lastByteRead += Buffer.byteLength(line, "utf8") + 1;
                if (targetVideoUrl === null) {
                    settled = true;
                    this.#handleEndOfStream(stream, readline);
                    return resolve(JSON.parse(line));
                }

                const vidUrl = JSON.parse(line)["videoUrl"];
                if (vidUrl !== targetVideoUrl) return;

                settled = true;
                this.#handleEndOfStream(stream, readline);
                return resolve(JSON.parse(line));
            });

            stream.once("error", err => {
                if (settled) return;
                settled = true;
                
                this.#handleEndOfStream(stream, readline);
                return reject(err);
            });

            stream.once("end", () => {
                if (settled) return;
                settled = true;

                this.#handleEndOfStream(stream, readline);
                return resolve(null);
            });
        });
    }

    /**
     * @param {ReadStream} stream 
     * @param {Interface} readline 
     */
    #handleEndOfStream(stream, readline) {
        readline.removeAllListeners();
        stream.removeAllListeners();
        stream.destroy();
    }
}

/**
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {string} username
 * @param {string} playlistUrl
 * @param {number} quality Overall quality of audio (0 highest - 9 lowest)
 * @param {number} segmentTime Length of audio chunks (seconds)
 * @param {number} maxVideos Max amount of videos to download from playlist
 * @returns {Promise<string>} Resolves folder name of playlist
 */
async function downloadPlaylist(db, table, username, playlistUrl, quality = 6, segmentTime = 10, maxVideos = 50) {
    const { folder_name: userFolder } = getUserJSON(db, table, username);
    const playlistName = path.basename(await createPlaylistFolder(userFolder));
    addPlaylistToDB(db, table, username, playlistName);

    const playlistDir = path.join(PARENT_DIR, "user_playlists", userFolder, playlistName);
    const playlistTimestampsPath = path.join(playlistDir, "playlistTimestamps.json");
    await fs.writeFile(playlistTimestampsPath, "[]");

    const tempVideosPath = path.join(playlistDir, "tempVideos.txt");
    await parseYTLink(playlistUrl, tempVideosPath);
    const tempVideosReader = new TempVideoFileParser(tempVideosPath);
    await logPlaylist(username, null, tempVideosPath);

    let song = null;
    while ((song = await tempVideosReader.readNextVideo()) !== null) {
        const filename = uuid();
        song["filename"] = filename;
        const songDir = path.join(playlistDir, filename);

        try {
            await fs.mkdir(songDir, { recursive: false });
            await fs.access(songDir, fs.constants.F_OK);
            await downloadVideo(song.videoUrl, playlistDir, filename, quality, segmentTime);
            await addPlaylistTimestamp(playlistTimestampsPath, path.join(songDir, `${filename}.m3u8`));

            const playlists = JSON.parse(getUserJSON(db, table, username).playlists_json);
            const playlist = playlists.find(item => item.name === playlistName);
            let vidCount = ++playlist.progress;
            playlist.songs.push(song);
            update(db, table, [
                ["playlists_json", JSON.stringify(playlists)]
            ], [ ["username", username] ]);

            if (vidCount >= maxVideos) break;

        } catch (err) {
            handleSongDownloadError(songDir, song, err);
        }

    }

    await setStartTimes(playlistTimestampsPath);
    await makePlaylistFile(playlistDir);

    const playlists_json = JSON.parse(getUserJSON(db, table, username).playlists_json);
    playlists_json.find(item => item.name === playlistName).done = true;
    update(db, table, [
        ["playlists_json", JSON.stringify(playlists_json)]
    ], [ ["username", username] ]);

    return playlistName;
}

/**
 * @param {string} folderToRemove Song's folder directory
 * @param {Video} song 
 * @param {Error} err 
 */
function handleSongDownloadError(folderToRemove, song, err) {
    try {
        fs.rm(folderToRemove, { "recursive": true, "force": true });
    } catch (e) {
        console.error(
            new Error(
                `ERROR WHILE TRYING TO REMOVE INVALID SONG FOLDER (${folderToRemove})`+
                `\n${e.message || e}`,
                { "cause": e.cause || err }
            )
        );
    }

    const filename = path.basename(folderToRemove);
    console.error(
        new Error(
            `ERROR DURING VIDEO DOWNLOAD`+
            `(${filename}, ${song.videoUrl})\n${err.message || err}\n`,
            { "cause": err.cause }
        )
    );
}

/**
 * startTime property must be manually set with setStartTimes()
 * @param {string} playlistTimestampsPath 
 * @param {string} songM3U8Path 
 * @param {number} index Optional, used for inserting timestamp at specific index
 * @returns {Promise<{"filename": string, "startTime": string, "length": string}>} Added timestamp
 */
async function addPlaylistTimestamp(playlistTimestampsPath, songM3U8Path, index = -1) {
    const playlistTimestamps = JSON.parse(
        await fs.readFile(playlistTimestampsPath, { "encoding": "utf8" })
    );
    const timestampInfo = {
        "filename": path.basename(songM3U8Path, ".m3u8"),
        "startTime": "-1",
        "length": await getSongLength(songM3U8Path)
    }

    if (index === -1) {
        playlistTimestamps.push(timestampInfo);
    } else {
        playlistTimestamps.splice(index, 0, timestampInfo);
    }
    await fs.writeFile(playlistTimestampsPath, JSON.stringify(playlistTimestamps, null, 4));
    return timestampInfo;
}

/**
 * @param {string} m3u8_path 
 * @returns {Promise<string>} Length with arbitrary precision
 */
async function getSongLength(m3u8_path) {
    const commands = [
        "-i", path.basename(m3u8_path),
        "-show_entries", "format=duration",
        "-v", "quiet",
        "-of", "csv=p=0"
    ];
    const cwd = path.dirname(m3u8_path);
    const { childProcess, done } = createChildProcess("ffprobe", commands, { cwd });

    let length = "";
    childProcess.stdout.on("data", d => length += d.toString().trim());
    childProcess.stderr.on("error", err => {});
    
    await done;
    childProcess.removeAllListeners();
    childProcess.kill(0);
    return length.trim();
}

/**
 * Writes to playlistTimestamps.json the proper start times for each song
 * @param {string} playlistTimestampsPath 
 * @returns {Promise<{"filename": string, "startTime": string, "length": string}[]>} Array of all timestamps
 */
async function setStartTimes(playlistTimestampsPath) {
    const playlistTimestamps = JSON.parse(
        await fs.readFile(playlistTimestampsPath, { "encoding": "utf8" })
    );

    let totalDuration = new Decimal(0);
    for (const timestamp of playlistTimestamps) {
        timestamp.startTime = totalDuration.toString();
        totalDuration = totalDuration.add(timestamp.length);
    }

    await fs.writeFile(playlistTimestampsPath, JSON.stringify(playlistTimestamps, null, 4));
    return playlistTimestamps;
}

/**
 * Add playlist to user's JSON DB entry
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {string} username
 * @param {string} playlistName 
 */
function addPlaylistToDB(db, table, username, playlistName) {
    const playlists = JSON.parse(getUserJSON(db, table, username)["playlists_json"]);
    playlists.push({
        "name": playlistName,
        "progress": 0, // Amt of songs downloaded,
        "done": false,
        "songs": []
    });
    update(db, table, [
        ["playlists_json", JSON.stringify(playlists)]
    ], [ ["username", username] ]);
}

/**
 * Log playlist details
 * @param {string} username
 * @param {Video[] | null} videos 
 * @param {string} tempVideosPath
 * @returns {Promise<void>}
 */
async function logPlaylist(username = "", videos = null, tempVideosPath = "") {
    if (!videos) {
        videos = [];
        const tempVideosReader = new TempVideoFileParser(tempVideosPath);
        let video = null;

        try {
            while ((video = await tempVideosReader.readNextVideo()) !== null) {
                videos.push(video);
            }
        } catch (err) {
            console.error(err);
        }
    }

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
 * @returns {Promise<string>} Video's folder path
 */
function downloadVideo(url, playlistDir, filename, quality = 6, segmentTime = 10) {
    return new Promise(async (resolve, reject) => {
        const options2 = { "cwd": path.join(playlistDir, filename) };
        let ytdlp = null, filterFFmpeg = null, encodeFFmpeg = null;
        try {
            ytdlp = createChildProcess("yt-dlp", [
                `-f`, `bestaudio[ext=m4a]`,
                `--ignore-errors`, `--geo-bypass`,
                `-o`, `-`,
                `${url}`,
            ], options2);
            if (!ytdlp) throw new Error(`YT-DLP PROCESS FAILED INIT:\t${ytdlp}`);
            ytdlp.childProcess.stdout.on("error", err => {
                throw new Error(`YT-DLP ERR!\t${err.toString()}`);
            });
            ytdlp.childProcess.stderr.on("data", data => {});
            ytdlp.childProcess.stderr.on("error", err => {});
            
            FFmpegThreadManager.addProcess();
            const threads = FFmpegThreadManager.getAvailableThreadCount();
            filterFFmpeg = createChildProcess("ffmpeg", [
                `-threads`, threads,
                `-filter_threads`, threads,
                `-filter_complex_threads`, threads,
                `-i`, `pipe:0`,
                ...serverConfig.ffmpegOptions,
                `-f`, `wav`,
                `-c:a`, `pcm_s16le`,
                `pipe:1`
            ], options2);
            if (!filterFFmpeg) throw new Error(`FILTER-FFMPEG PROCESS FAILED INIT:\t${filterFFmpeg}`);
            filterFFmpeg.childProcess.stderr.on("error", err => {});

            handleStreamPiping(ytdlp.childProcess.stdout, filterFFmpeg.childProcess.stdin);

            encodeFFmpeg = createChildProcess("ffmpeg", [
                `-hide_banner`,
                `-loglevel`, `error`,
                `-threads`, threads,
                `-f`, `wav`,
                `-i`, `pipe:0`,
                `-c:a`, `libmp3lame`,
                `-q:a`, quality,
                `-f`, `hls`,
                `-start_number`, `0`,
                `-hls_list_size`, `0`,
                `-hls_time`, segmentTime,
                `-hls_segment_filename`, `${filename}_%05d.ts`,
                `${filename}.m3u8`
            ], options2);
            if (!encodeFFmpeg) throw new Error(`ENCODE-FFMPEG PROCESS FAILED INIT:\t${encodeFFmpeg}`);
            encodeFFmpeg.childProcess.stderr.on("error", err => {});

            handleStreamPiping(filterFFmpeg.childProcess.stdout, encodeFFmpeg.childProcess.stdin);
            await encodeFFmpeg.done;

            FFmpegThreadManager.removeProcess();
            cleanup(ytdlp.childProcess);
            cleanup(filterFFmpeg.childProcess);
            cleanup(encodeFFmpeg.childProcess);
            resolve(options2["cwd"]);
        } catch (err) {
            FFmpegThreadManager.removeProcess();
            cleanup(ytdlp.childProcess);
            cleanup(filterFFmpeg.childProcess);
            cleanup(encodeFFmpeg.childProcess);
            reject(err);
        }
        function cleanup(childProcess) {
            try {
                childProcess.removeAllListeners();
                childProcess.kill();
            } catch (err) {
                console.error(new Error(
                    `FAILED TRYING TO CLEAN UP PROCESS:\t${childProcess}`,
                    { "cause": err }
                ));
            }
        }
        function handleStreamPiping(readStream, writeStream) {
            readStream.on("data", chunk => {
                if (writeStream.write(chunk)) return;
                readStream.pause();
                writeStream.once("drain", () => readStream.resume());
            });
            readStream.on("end", () => {
                writeStream.end();
            });
        }
    });
}

/**
 * Makes .m3u8 playlist file.
 * 
 * Always named "playlist.m3u8", since there is only one .m3u8 per playlist
 * @param {string} playlistPath 
 * @returns {Promise<string>} Path of .m3u8 playlist file
 */
async function makePlaylistFile(playlistPath) {
    const playlistTimestampsPath = path.join(playlistPath, "playlistTimestamps.json");
    const playlistTimestamps = JSON.parse(
        await fs.readFile(playlistTimestampsPath, { "encoding": "utf8" })
    );
    let playlist_m3u8 = ``;

    for (const item of playlistTimestamps) {
        const { filename } = item;
        const m3u8Path = path.join(playlistPath, filename, `${filename}.m3u8`);
        const m3u8FileContent = await fs.readFile(m3u8Path, { "encoding": "utf8" });
        if (playlist_m3u8 === "") {
            const segmentTime = getM3U8TargetDuration(m3u8FileContent);
            playlist_m3u8 +=
                `#EXTM3U\n#EXT-X-VERSION:3\n`+
                `#EXT-X-TARGETDURATION:${segmentTime}\n#EXT-X-MEDIA-SEQUENCE:0\n`;
        }

        let adjustedM3U8 = adjustSongPaths(filename, m3u8FileContent);
        const startIndex = adjustedM3U8.indexOf("#EXTINF");
        const endIndex = adjustedM3U8.indexOf("#EXT-X-ENDLIST") - 1;
        adjustedM3U8 = adjustedM3U8.substring(startIndex, endIndex);

        playlist_m3u8 += `\n#EXT-X-DISCONTINUITY\n${adjustedM3U8}\n`;
    }
    playlist_m3u8 += "\n#EXT-X-ENDLIST";

    const playlistM3U8Path = path.join(playlistPath, `playlist.m3u8`);
    await fs.writeFile(playlistM3U8Path, playlist_m3u8);
    return playlistM3U8Path;
}

/**
 * @param {string} m3u8 Content from a .m3u8 file
 * @returns {number}
 */
function getM3U8TargetDuration(m3u8) {
    const keyword = "#EXT-X-TARGETDURATION:";
    const keywordLength = keyword.length;
    const startIndex = m3u8.indexOf(keyword) + keywordLength;
    const endIndex = m3u8.indexOf("\n", startIndex);
    return parseFloat(m3u8.substring(startIndex, endIndex));
}

/**
 * Sets all of the paths as children to another directory
 * 
 * Example: "song_01.ts" ---> "parentDir/song_01.ts"
 * @param {string} parentDir 
 * @param {string} m3u8 Content from a .m3u8 file
 * @returns {string} Adjusted .m3u8 file content
 */
function adjustSongPaths(parentDir, m3u8) {
    // NOTE: .m3u8 files DO NOT contain \r characters, even on Windows
    let index = 0;

    while (true) {
        index = m3u8.indexOf(",", index);
        if (index === -1) break;
        index += 2;

        const firstHalf = m3u8.substring(0, index);
        const secondHalf = m3u8.substring(index, m3u8.length);
        m3u8 = `${firstHalf}${parentDir}/${secondHalf}`;
    }
    return m3u8;
}

/**
 * Create a playlist folder 
 * @param {string} userFolder 
 * @returns {Promise<userFolder>} Resolves to created folder's absolute path
 */
async function createPlaylistFolder(userFolder) {
    let folderPath, i = 0;
    do {
        if (i > 100_000) throw new Error("Excessive playlist folder creation attempts");
        const playlistFolderDir = path.join(
            PARENT_DIR, "user_playlists", userFolder, `playlist_${i++}`
        );
        folderPath = await createFolder(playlistFolderDir);
    } while (folderPath === null);
    return folderPath;
}

/**
 * Convenience function to get user entry from DB
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {string} username 
 * @returns {{"username": string, "password": string, "folder_name": string, "playlists_json": string}}
 */
function getUserJSON(db, table, username) {
    return find(db, table, [
        ["username", username]
    ])[0];
}

module.exports = {
    parseYTLink,
    filterInfo,
    downloadPlaylist,
    downloadVideo,
    createPlaylistFolder
}