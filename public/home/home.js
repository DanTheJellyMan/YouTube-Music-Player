// 
const playlists = {
    "promise": Promise.resolve(),
    "enqueued": false,
    "list": null,
}
fetchPlaylists();
setInterval(fetchPlaylists, 1000 * 30);

const playlistListHeader = document.querySelector("#playlist-list-header");
const playlistList = document.querySelector("#playlist-list");
document.querySelector("#toggle-menu").onclick = e => {
    const main = document.querySelector("main");
    if (getComputedStyle(main).getPropertyValue("display") === "none") {
        main.style.display = "flex";
    } else {
        main.style.display = "none";
    }
}

async function uploadPlaylist() {
    const inputEl = document.querySelector("#playlist-input");
    let url = inputEl.value.trim()
              .replace("https://", "")
              .replace("www.", "");
    if (!url.startsWith("youtube.com/playlist?list=")) {
        inputEl.value = "";
        alert("Please upload a valid YouTube URL starting with 'youtube.com/playlist?list='");
        return;
    }
    
    const res = await fetch("/upload-playlist", {
        "method": "POST",
        "headers": {
            "Content-Type": "application/json"
        },
        "body": JSON.stringify({ url })
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
    if (playlists.enqueued) return;
    const controller = new AbortController();
    playlists.enqueued = true;
    toggleFetching(1);

    let res;
    const timeout = setTimeout(() => {
        controller.abort("Playlist fetch timeout");
    }, 1000 * 10);
    playlists.promise = fetch("/get-playlists", {
        "method": "GET",
        "headers": {
            "Content-Type": "application/json"
        },
        "signal": controller.signal
    });
    try {
        res = await playlists.promise;
    } catch (err) {
        clearTimeout(timeout);
        playlists.enqueued = false;
        toggleFetching(0);
        console.error(err);
        return;
    }
    clearTimeout(timeout);
    if (!res.ok) {
        console.error("Playlist fetch failed\n" + res);
        playlists.enqueued = false;
        toggleFetching(0);
        return;
    }

    const playlistsInfo = await res.json();
    playlists.list = playlistsInfo["playlists"];
    if (playlistList.children) {
        for (const el of playlistList.children) el.remove();
    }
    for (const playlist of playlists.list) {
        createPlaylistEl(playlist);
    }

    toggleFetching(0);
    playlists.enqueued = false;
}

function createPlaylistEl(playlist) {
    const { done, name, progress, songs } = playlist;

    const element = document.createElement("div");
    element.className = "playlist";
    if (done) element.classList.add("done");
    else element.inert = true;

    const playlistName = document.createElement("p");
    playlistName.className = "name";
    playlistName.textContent = name;
    playlistName.onclick = initPlayer;
    element.appendChild(playlistName);

    const progressEl = document.createElement("p");
    progressEl.className = "progress";
    progressEl.textContent = `Songs: ${progress}`;
    element.appendChild(progressEl);

    playlistList.appendChild(element);

    function initPlayer() {
        const player = new MusicPlayer(playlist);
        document.body.appendChild(player);
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
 * @param {number} state 1 = enable / 0 = disable
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