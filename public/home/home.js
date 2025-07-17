import MusicPlayer from "./MusicPlayer.js";
globalThis["MusicPlayer"] = MusicPlayer;

const FETCH_INTERVAL_SECONDS = 30;
let gettingPlaylists = false;
fetchPlaylists();
setInterval(fetchPlaylists, 1000 * FETCH_INTERVAL_SECONDS);

const playlistListHeader = document.querySelector("#playlist-list-header");
const playlistList = document.querySelector("#playlist-list");

document.querySelector("#toggle-menu").onclick = toggleMenu;
document.querySelector("#add-new-playlist").onclick = toggleForm;
document.querySelector("#playlist-upload-form > abbr.cross").onclick = toggleForm;
document.querySelector("#reload-list").onclick = fetchPlaylists;
document.querySelector("#playlist-upload-form > button").onclick = uploadPlaylist;

async function uploadPlaylist() {
    const inputEl = document.querySelector("#playlist-input");
    let url = inputEl.value.trim()
        .replace("https://", "")
        .replace("www.", "")
        .trim();
    if (!url.startsWith("youtube.com/playlist?list=")) {
        inputEl.value = "";
        alert("Please upload a valid YouTube URL starting with 'youtube.com/playlist?list='");
        return;
    }
    
    const res = await fetch(`/upload-playlist?url=${encodeURIComponent(url)}`, {
        "method": "POST",
        "headers": {
            "Content-Type": "application/json"
        }
    });

    if (!res.ok) {
        alert(await res.text());
    } else {
        const text = await res.text();
        console.log(text);
        alert(`${text}\nPress the "Reload" button to check on download progress`);
        toggleForm(0);
        fetchPlaylists();
    }
}

async function fetchPlaylists() {
    if (gettingPlaylists) return;
    const controller = new AbortController();
    gettingPlaylists = true;
    toggleFetching(1);

    const timeout = setTimeout(() => {
        controller.abort("Playlist fetch timeout");
    }, 1000 * 10);
    let res;
    try {
        res = await fetch("/get-playlists", {
            "method": "GET",
            "headers": { "Content-Type": "application/json" },
            "signal": controller.signal
        });
    } catch (err) {
        clearTimeout(timeout);
        endFetchingMode();
        console.error(err);
        return;
    }
    clearTimeout(timeout);
    if (res && !res.ok) {
        console.error("Playlist fetch failed\n" + res);
        endFetchingMode();
        return;
    }

    if (playlistList.children instanceof HTMLCollection) {
        for (const el of playlistList.children) el.remove();
    }

    const playlists = await res.json();
    for (const playlist of playlists) {
        const el = createPlaylistEl(playlist);
        playlistList.appendChild(el);
    }

    endFetchingMode();
    function endFetchingMode() {
        gettingPlaylists = false;
        toggleFetching(0);
    }
}

function createPlaylistEl(playlist) {
    const { done, name, progress } = playlist;

    const element = document.createElement("div");
    element.className = "playlist";
    if (done) element.classList.add("done");
    else element.inert = true;

    const playlistName = document.createElement("p");
    playlistName.className = "name";
    playlistName.textContent = name;
    playlistName.onclick = e => {
        initPlayer(playlist);
    }
    element.appendChild(playlistName);

    const progressEl = document.createElement("p");
    progressEl.className = "progress";
    progressEl.textContent = `Songs: ${progress}`;
    element.appendChild(progressEl);

    return element;
}

async function initPlayer(playlist = null) {
    const player = new MusicPlayer();
    player.setPlaylist(playlist);
    await player.setPlaylistTimestamps();
    player.initPlayer();
    document.body.appendChild(player);
}

function toggleMenu(e) {
    const main = document.querySelector("main");
    if (getComputedStyle(main).getPropertyValue("display") === "none") {
        main.style.display = "flex";
    } else {
        main.style.display = "none";
    }
}

function toggleForm(forceState = -1) {
    const abbr = document.querySelector("abbr#add-new-playlist");
    const input = document.querySelector("#playlist-upload-form");

    switch (forceState) {
        case 1:
            return enable();
        case 0:
            return disable();
    }
    if (getComputedStyle(input).getPropertyValue("display") === "none") {
        return enable();
    }
    return disable();
    
    function enable() {
        input.style.display = "grid";
        abbr.title = "Close";
    }
    function disable() {
        input.style.display = "none";
        abbr.title = "Upload playlist";
    }
}

/**
 * Switch UI for playlist fetching
 * @param {number} state 1 = fetching / 0 = not fetching
 */
function toggleFetching(state = 1) {
    if (!document) return;
    const menuToggle = document.querySelector("#toggle-menu");
    const main = document.querySelector("main");
    if (!menuToggle || !main) return;
    if (state === 0) {
        document.documentElement.style.cursor = "default";
        menuToggle.inert = false;
        menuToggle.style.filter = "blur(0)";
        main.inert = false;
        main.style.filter = "blur(0)";
    } else {
        document.documentElement.style.cursor = "wait";
        menuToggle.inert = true;
        menuToggle.style.filter = "blur(3px)";
        main.inert = true;
        main.style.filter = "blur(3px)";
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max-min+1)+min);
}