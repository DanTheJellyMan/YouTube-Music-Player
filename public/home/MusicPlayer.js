import Pinger from "./Pinger.js";

export default class MusicPlayer extends HTMLElement {
    static #pinger = new Pinger(90);
    static #stylesheet = fetch(`./MusicPlayer.css`)
        .then(res => res.text())
        .then(text => new CSSStyleSheet().replace(text));
    static observedAttributes = ["paused"];

    #controller = new AbortController();
    #hostObserver = null;

    #hls = new Hls();
    #audio = new Audio();
    #volume = 0.5;

    /**
     * @type {Object[] | null}
     */
    #playlist = null;
    #playlistSongIndex = 0;

    /**
     * @type {Object[] | null}
     */
    #playlistTimestamps = null;
    #playlistTimestampsIndex = 0;

    #checkKeysTimeout = setTimeout(() => {});
    #checkKeysDelayMS = 250;
    #keyWasRaised = false;
    
    // Max time for setInterval
    #repeatKeyPressInterval = setInterval(() => {}, 2147483647);
    #heldKeysSet = new Set();

    /*
        IMPORTANT: make sure to add custom attributes to BOTH
        host (music-player) and the container.

        This is so attributeChangedCallback() will trigger while still allowing
        CSS attribute-dependent features to still work
        
        :host[some-attrib='true'] doesn't work
    */
    
    constructor() {
        super();
        const shadow = this.attachShadow({ "mode": "open" });

        // Async load stylesheet 
        MusicPlayer.#stylesheet
        .then(staticStylesheet => {
            // Retrieve rules from the static stylesheet
            let styleText = "";
            for (const rule of staticStylesheet.cssRules) {
                styleText += rule.cssText;
            }

            // Create a new cloned stylesheet for this player
            return (
                new CSSStyleSheet()
                .replace(styleText)
                .then(stylesheet => {
                    shadow.adoptedStyleSheets = [stylesheet];
                })
            );
        })
        .catch(err => {
            const msg =
                `ERROR WHILE SETTING UP PLAYER:\t${err}\n`+
                `RELOAD PAGE`;
            console.error(msg);
            alert(msg);
            window.location.reload();
        });
    }

    // Init after append to DOM
    connectedCallback() {
        // Append content to shadow root
        const shadow = this.shadowRoot;
        shadow.host.tabIndex = "0";
        const template = document.querySelector("#music-player-template");
        shadow.appendChild(template.content.cloneNode(true));

        // Precaution in case attribs were set on host before DOM attachment
        this.#equalizeHostAndContainerAttribs();
        this.#initListeners();
        this.#initAttribs();
    }

    #initListeners() {
        const { signal } = this.#controller;
        const host = this;
        const shadow = host.shadowRoot;
        const container = shadow.querySelector("#container");
        const header = container.querySelector("header");

        const openSettings = header.querySelector("#open-settings");
        const settings = container.querySelector("#settings");
        openSettings.addEventListener("click", () => {
            settings.toggleAttribute("open");
        }, { signal });

        // Ensure element is fully parsed before any resizing
        // Avoids issues of un-initialized CSS properties being used
        waitForStyleInit(handleResizeObserver);

        this.#hostObserver = new ResizeObserver(handleResizeObserver);
        this.#hostObserver.observe(host);

        host.addEventListener("keydown", e => {
            e.preventDefault();
            this.#handleKeyDown(e.key);
        }, { signal });

        document.addEventListener("keyup", e => {
            e.preventDefault();
            this.#handleKeyUp(e.key);
        }, { signal });

        const close = container.querySelector("#close");
        close.addEventListener("click", () => {
            this.remove();
        }, { signal });

        const body = container.querySelector("#body");
        body.addEventListener("wheel", e => {
            e.preventDefault();
            this.#handleScroll(e);
        }, { signal });

        const main = body.querySelector("main");
        const controls = main.querySelector("#controls");
        const playBtn = controls.querySelector("#play-button");
        playBtn.firstElementChild.addEventListener("click", () => {
            this.toggle();
        }, { signal });
        
        const prevTrack = controls.querySelector(".track.previous");
        prevTrack.addEventListener("click", () => {
            this.seekPreviousTrack();
        }, { signal });
        const nextTrack = controls.querySelector(".track.next");
        nextTrack.addEventListener("click", () => {
            this.seekNextTrack();
        }, { signal });

        const footer = body.querySelector("footer");
        const open = footer.querySelector("#open-queue");
        open.addEventListener("click", this.#handleQueueOpen, { signal });
        this.updateQueueOrder();

        this.#audio.addEventListener("canplay", e => {
            this.#audio.volume = this.#volume;
        }, { signal });
        this.#audio.addEventListener("timeupdate", e => {
            host.handleTimeupdate();
        }, { signal });

        function handleResizeObserver(entries = [], observer = null) {
            host.#detectLandscape();

            // Handle settings resizing
            const transition = getComputedStyle(settings).getPropertyValue("transition");
            const { height: headerHeight } = header.getBoundingClientRect();
            host.style.setProperty("--settings-top", `${headerHeight}px`);

            // Use container's dimensions since they are slightly smaller than host's
            const { width, height } = container.getBoundingClientRect();
            host.#resizeQueue(width, height);
        }

        function waitForStyleInit(callback = function(){}, PAGE_RENDERS_BEFORE_OK = 10) {
            for (let renders = 0; renders < PAGE_RENDERS_BEFORE_OK; renders++) {
                callback = () => requestAnimationFrame(callback);
            }
            callback();
        }
    }

    #initAttribs() {
        const host = this;
        const shadow = host.shadowRoot;
        const container = shadow.querySelector("#container");
        const footer = container.querySelector("footer");

        this.#detectLandscape();
        this.setAttrib("playing", "false");

        if (getComputedStyle(footer).getPropertyValue("translate") === "none") {
            footer.setAttribute("open", "false");
        } else {
            footer.setAttribute("open", "true");
        }
    }

    // Cleanup after removal from DOM
    disconnectedCallback() {
        this.#hls.destroy();
        this.#audio.pause();
        this.#audio.src = "";
        this.#audio.load();
        this.#audio.remove();
        this.#audio = null;

        this.#controller.abort();
        this.#hostObserver.disconnect();
        console.log("music player deleted");
    }

    // Handle changes to element attributes (NOT PROPERTIES! e.g., this.playing)
    attributeChangedCallback(name, oldVal, newVal) {
        switch (name) {

        }
    }

    /*
        NEW SECTION
        =================================
          Handle time-related user input
        =================================
    */

    play() {
        this.setAttrib("playing", "true");
        if (!this.#audio.paused) return Promise.resolve(false);
        return this.#audio.play().then(() => true);
    }
    pause() {
        this.setAttrib("playing", "false");
        if (this.#audio.paused) return false;
        this.#audio.pause();
        return true;
    }
    toggle() {
        if (this.#audio.paused) return this.play();
        return this.pause();
    }

    seek(seconds) {
        const timestamp = this.#playlistTimestamps[this.#playlistTimestampsIndex];
        const startTime = parseFloat(timestamp.startTime);
        const currentTime = this.currentTime(true);

        const minTime = startTime;
        const maxTime = startTime + parseFloat(timestamp.length) - 1;
        const newTime = Math.min( Math.max(minTime, currentTime+seconds), maxTime );
        this.#audio.currentTime = newTime;
    }
    seekNextTrack() {
        const currentIndex = this.#playlistTimestampsIndex;
        const maxIndex = this.#playlistTimestamps.length - 1;
        const nextIndex = Math.min(currentIndex + 1, maxIndex);

        const endTime = parseFloat(
            this.#playlistTimestamps[nextIndex].startTime
        );
        this.#audio.currentTime = endTime;
    }
    seekPreviousTrack() {
        const index = Math.max(0, this.#playlistTimestampsIndex - 1);
        const startTime = parseFloat(
            this.#playlistTimestamps[index].startTime
        );
        this.#audio.currentTime = startTime;
    }

    #handleProgressSeek(e) {
        e.preventDefault();
        const progress = e.target;
        
    }

    /*
        NEW SECTION
        ======================================
          Handle non-time-related user input
        ======================================
    */

    currentTime(absolute = false) {
        if (absolute) return this.#audio.currentTime;

        const startTime = parseFloat(
            this.#playlistTimestamps[this.#playlistTimestampsIndex].startTime
        );
        return this.#audio.currentTime - startTime;
    }
    getVolume() {
        return this.#volume;
    }
    setVolume(level) {
        if (typeof level !== "number" || Number.isNaN(level) || isNaN(level)) {
            return console.error(`'${level}' IS NOT A VALID VOLUME LEVEL`);
        }
        this.#volume = Math.min( Math.max(0, level), 1 );
        this.#audio.volume = this.#volume;
    }

    #handleKeyDown(key) {
        this.#heldKeysSet.add(key);

        clearTimeout(this.#checkKeysTimeout);
        this.#checkKeysTimeout = setTimeout(() => {
            this.#performHotkeyAction();
            this.#keyWasRaised = false;

            this.#repeatKeyPressInterval = setInterval(() => {
                this.#performHotkeyAction();
            }, 100);
        }, this.#checkKeysDelayMS);
    }
    #handleKeyUp(key) {
        if (this.#keyWasRaised) this.#performHotkeyAction();
        this.#heldKeysSet.delete(key);
        clearTimeout(this.#checkKeysTimeout);
        clearInterval(this.#repeatKeyPressInterval);
        this.#keyWasRaised = true;
    }

    /*
        NEW SECTION
        ===================
          Handle playlist
        ===================
    */

    setPlaylist(playlist = null) {
        this.#playlist = playlist;
    }

    async setPlaylistTimestamps() {
        const playlist = this.#playlist;
        if (!playlist) {
            return console.warn(
                `Playlist must be set\n(${JSON.stringify(playlist, null, 4)})`
            );
        }

        const playlistName = playlist.name;
        if (!playlistName ||
            (typeof playlistName === "string" && playlistName.length === 0)
        ) {
            return console.warn(
                `Playlist must have a valid name set (${playlistName})`
            );
        }

        // Fetch playlist folder's "playlist_timestamps.json" file
        const res = await fetch(`/get-playlist-timestamps?name=${playlistName}`, {
            "method": "GET",
            "headers": { "Content-Type": "application/json" }
        });
        if (!res.ok) {
            const status = res.status;
            const text = await res.text();
            const msg =
                `ERROR: Could not retrieve playlist timestamps (code: ${status})\n`+
                `Server message: ${text}`;
            console.error(msg);
            return alert(msg);
        }

        this.#playlistTimestamps = await res.json();
    }

    #alignPlaylistToTimestampsOrder() {
        const sortedPlaylistSongs = Array(this.#playlistTimestamps.length);
        for (let i=0; i < this.#playlistTimestamps.length; i++) {
            const song = this.#playlist.songs.find(song => {
                return song.filename === this.#playlistTimestamps[i].filename;
            });
            if (!song) throw Error(
                `NO MATCHING PLAYLIST ITEM FOR TIMESTAMP:\n`+
                `${this.#playlistTimestamps[i]}`
            );
            sortedPlaylistSongs[i] = song;
        }
        this.#playlist.songs = sortedPlaylistSongs;
    }
    
    initPlayer() {
        if (!this.#playlist) {
            const msg = `ERROR: Playlist must be set (currently: ${JSON.stringify(this.#playlist)})`;
            console.error(msg);
            return alert(msg);
        }
        if (!this.#playlistTimestamps) {
            const msg = `ERROR: Playlist timestamps must be set (currently: ${JSON.stringify(this.#playlistTimestamps)})`;
            console.error(msg);
            return alert(msg);
        }
        if (!this.#hls) {
            const msg = `ERROR: HLS must be set (currently: ${JSON.stringify(this.#hls)})`;
            console.error(msg);
            return alert(msg);
        }
        if (!Hls.isSupported()) {
            const msg =
                "ERROR: Browser doesn't support native HLS or the HLS.js library.\n"+
                "Cannot play audio without one of these.";
            console.error(msg);
            return alert(msg);
        }

        const compatibility = this.#audio.canPlayType("application/vnd.apple.mpegurl");
        if (compatibility === "probably" || compatibility === "maybe") {
            this.#audio.src = "";
        } else {
            const encodedPlayistName = encodeURIComponent(this.#playlist.name);
            this.#hls.loadSource(`/play/${encodedPlayistName}/`);
            this.#hls.attachMedia(this.#audio);
        }
    }

    // Optional
    async setSession(sessionName = "") {
        if (typeof sessionName !== "string" || sessionName.length === 0) {
            return console.warn(`Invalid session name (${sessionName})`);
        }
    }

    shufflePlaylist(iterations = 1) {
        iterations = Math.max(1, iterations);

        for (let i=0; i<iterations; i++) {
            const timestamps = this.#playlistTimestamps;
            const tempTimestamps = Array(timestamps.length);

            for (let i=0; i<tempTimestamps.length; i++) {
                const randomIndex = randomInt(0, timestamps.length-1);
                tempTimestamps[i] = timestamps.splice(randomIndex, 1)[0];
            }
            this.#playlistTimestamps = tempTimestamps;
        }

        this.#audio.currentTime = parseFloat(
            this.#playlistTimestamps[this.#playlistTimestampsIndex].startTime
        );
        
        this.#alignPlaylistToTimestampsOrder();
        this.updateQueueOrder();
    }

    #performHotkeyAction() {
        const keys = this.#heldKeysSet;
        const held = {
            "left": keys.has("ArrowLeft"),
            "right": keys.has("ArrowRight"),
            "up": keys.has("ArrowUp"),
            "down": keys.has("ArrowDown"),
            "space": keys.has(" ")
        }

        if (held["left"]) {
            this.seek(-5);
        } else if (held["right"]) {
            this.seek(+5);
        } else if (held["space"]) {
            this.toggle();
        } else if (held["down"]) {
            this.setVolume(this.getVolume() - 0.05);
        } else if (held["up"]) {
            this.setVolume(this.getVolume() + 0.05);
        }
    }

    /*
        NEW SECTION
        ===========================================================
          Handle UI and UI/element interactions (visuals/styling)
        ===========================================================
    */
   
    /**
     * To be called with host.handleTimeupdate()
     */
    handleTimeupdate() {
        const { songs } = this.#playlist;
        const timestamps = this.#playlistTimestamps;

        const CURRENT_RELATIVE_TIME = this.currentTime(false);
        const CURRENT_ABSOLUTE_TIME = this.currentTime(true);
        const songLength = parseFloat(
            timestamps[this.#playlistTimestampsIndex].length
        );
        const songStartTime = parseFloat(
            timestamps[this.#playlistTimestampsIndex].startTime
        );
        if (CURRENT_RELATIVE_TIME >= songLength || CURRENT_ABSOLUTE_TIME < songStartTime) {
            // NOTE: it may be wise to put a "return" here for a performance boost
            this.#playlistTimestampsIndex = this.#findCurrentTimestampIndex();
        }

        const timestamp = timestamps[this.#playlistTimestampsIndex];
        const length = parseFloat(timestamp.length);
        const { title, channelName, channelUrl, videoUrl, thumbnails } = songs.find(
            item => item.filename === timestamp.filename
        );

        const host = this;
        const shadow = host.shadowRoot;
        const progress = shadow.querySelector("#progress");
        const startTimeLabel = shadow.querySelector(".time-label.start");
        startTimeLabel.textContent = MusicPlayer.formatSeconds(CURRENT_RELATIVE_TIME);
        progress.value = CURRENT_RELATIVE_TIME;

        const titleAnchor = shadow.querySelector("#title > a");
        if (titleAnchor.textContent === title) return;
        titleAnchor.textContent = title;
        titleAnchor.href = videoUrl;

        const thumbnail_img = shadow.querySelector("#thumbnail > img");
        thumbnail_img.src = "";
        let thumbnailSrc = "";
        const ping = MusicPlayer.getPing();
        if (ping < 75) {
            thumbnailSrc = thumbnails.high;
        } else if (ping < 200) {
            thumbnailSrc = thumbnails.medium;
        } else {
            thumbnailSrc = thumbnails.low;
        }
        thumbnail_img.src = thumbnailSrc;

        const authorAnchor = shadow.querySelector("#author > a");
        authorAnchor.textContent = channelName;
        authorAnchor.href = channelUrl;

        progress.max = length;
        const endTimeLabel = shadow.querySelector(".time-label.end");
        endTimeLabel.textContent = MusicPlayer.formatSeconds(length);
    }
    
    #findCurrentTimestampIndex() {
        const currentAbsoluteTime = this.currentTime(true);

        for (let i=0; i<this.#playlistTimestamps.length; i++) {
            const timestamp = this.#playlistTimestamps[i];
            const startTime = parseFloat(timestamp.startTime);
            const length = parseFloat(timestamp.length);

            if (currentAbsoluteTime >= startTime &&
                currentAbsoluteTime < startTime+length) {
                return i;
            }
        }

        return -1;
    }

    updateQueueOrder() {
        const queue = this.shadowRoot.querySelector("#queue");
        if (!queue) return console.warn("No queue element found");
        for (const child of queue.children) this.#removeQueueItem(child);

        const { songs } = this.#playlist;
        for (let i=0; i<songs.length; i++) {
            const timestamp = this.#playlistTimestamps[i];
            
            const item = createQueueItem(songs[i], timestamp, () => {
                this.#audio.currentTime = parseFloat(timestamp.startTime);
            }, this.#controller.signal);
            queue.appendChild(item);
        }
    }
    #removeQueueItem(item) {
        item.remove();
    }

    #detectLandscape() {
        const aspectRatio = 1.12;
        const { width, height } = this.shadowRoot.host.getBoundingClientRect();

        if (width / height > aspectRatio) {
            this.setAttrib("landscape", "true");
        } else {
            this.setAttrib("landscape", "false");
        }
    }

    #resizeQueue(containerWidth, containerHeight) {
        const host = this;
        const container = this.shadowRoot.firstElementChild;
        const header = container.querySelector("header");
        const footer = container.querySelector("footer");
        const open = footer.querySelector("#open-queue");
        const queue = footer.querySelector("#queue");

        const { height: headerHeight } = header.getBoundingClientRect();
        const { height: openHeight } = open.getBoundingClientRect();
        const totalWidth = containerWidth;
        const totalHeight = containerHeight - headerHeight - openHeight;

        if (host.getAttrib("landscape") === "true") return;
        queue.style.width = `${totalWidth}px`;
        queue.style.height = `${totalHeight}px`;

        // Do not readjust footer if it's not expanded
        if (footer.getAttribute("open") === "false") return;

        let currentYTranslate = getComputedStyle(host).getPropertyValue("--footer-translate");
        if (currentYTranslate.length === 0 || parseFloat(currentYTranslate) === 0) {
            currentYTranslate = 0;
        } else {
            currentYTranslate = parseFloat(
                currentYTranslate.substring(0, currentYTranslate.indexOf("px"))
            );
        }

        const transitionProp = host.#stopActiveFooterTransition();

        // Readjust footer translation
        const headerBottom = header.getBoundingClientRect().bottom;
        const footerTop = footer.getBoundingClientRect().top;
        const yTranslate = footerTop - headerBottom;
        host.style.setProperty("--footer-translate", `-${-1 * currentYTranslate + yTranslate}px`);
        footer.setAttribute("open", "true");

        footer.style.transition = transitionProp;
    }

    #handleScroll(e) {
        if (this.getAttrib("landscape") === "true") {
            console.warn("scroll not allowed for landscape mode");
            return;
        }
        const host = this;
        const container = host.shadowRoot.querySelector("#container");
        const header = container.querySelector("header");
        const body = container.querySelector("#body");
        const footer = body.querySelector("footer");

        // Set transition style incase a resize happened while footer was expanded
        const hostCompStyle = getComputedStyle(host);
        const footerTransitionDur = hostCompStyle.getPropertyValue("--footer-transition-duration");
        const footerTransitionTiming = hostCompStyle.getPropertyValue("--footer-transition-timing-function");
        footer.style.transition = `transform ${footerTransitionDur} ${footerTransitionTiming}`;

        const transitionProp = host.#stopActiveFooterTransition();

        if (footer.getAttribute("open") === "false" && e.deltaY > 0) {
            // Expand footer
            this.#handleQueueOpen(e, true);
        } else {
            // Manually handle scrolling
            const bodyTop = body.scrollTop;
            body.scrollTo(0, bodyTop + (e.deltaY / 2));

            if (body.scrollTop === 0 && e.deltaY < 0) {
                // Shrink footer
                footer.setAttribute("open", "false");
            }
        }
        footer.style.transition = transitionProp;
    }

    // Expand footer
    #handleQueueOpen(e, forceTransitionReset = false) {
        const shadow = this.parentNode.parentNode.parentNode.parentNode || this.shadowRoot;
        const host = shadow.host;
        const header = shadow.querySelector("header");
        const body = shadow.querySelector("#body");
        const footer = body.querySelector("footer");

        // Ensure footer transition property is set
        const hostCompStyle = getComputedStyle(host);
        const transDur = hostCompStyle.getPropertyValue("--footer-transition-duration");
        const transTimingFunc = hostCompStyle.getPropertyValue("--footer-transition-timing-function");

        // This check avoids issues of the transition property being reset when clicking #open-queue
        if (forceTransitionReset) {
            footer.style.transition = `translate ${transDur} ${transTimingFunc}`;
        }

        if (host.getAttrib("landscape") === "true" && footer.getAttribute("open") === "false") {
            footer.setAttribute("open", "true");
            const queue = footer.querySelector("#queue");
            return;
        }

        const headerBottom = header.getBoundingClientRect().bottom;
        const footerTop = footer.getBoundingClientRect().top;
        const yTranslate = footerTop - headerBottom;

        // Set new translate value even if footer won't be open to combat
        // issues with footer translate not resetting when it's supposed to
        host.style.setProperty("--footer-translate", `-${yTranslate}px`);
        if (yTranslate === 0) {
            footer.setAttribute("open", "false");
        } else {
            footer.setAttribute("open", "true");
        }
    }

    // Stop any active transitions
    #stopActiveFooterTransition() {
        const footer = this.shadowRoot.querySelector("footer");
        const transitionProp = getComputedStyle(footer).getPropertyValue("transition");
        footer.style.transition = "none";
        return transitionProp;
    }

    /**
     * Set the attributes of container equal to the host element's
     * @returns {void}
     **/
    #equalizeHostAndContainerAttribs() {
        const shadow = this.shadowRoot;
        const container = shadow.querySelector("#container");
        for (const attribName of shadow.host.getAttributeNames()) {
            const attribVal = shadow.host.getAttribute(attribName);
            container.setAttribute(attribName, attribVal);
        }
    }

    getAttrib(name) {
        const hostAttrib = this.shadowRoot.host.getAttribute(name);
        const container = this.shadowRoot.querySelector("#container");
        if (!container) {
            console.warn(`Player has not yet been appended to the DOM`);
            return hostAttrib;
        }

        const containerAttrib = container.getAttribute(name);
        if (hostAttrib !== containerAttrib) throw Error(
            `HOST AND CONTAINER HAVE INCONSISTENT ATTRIBUTES\n`+
            `Attribute: ${name},  Values: (${hostAttrib}, ${container})`
        );
        return hostAttrib;
    }
    
    /**
     * @param {string} name
     * @param {string} value
     * @param {boolean | null} onlyHostOrContainer True to set only Host, False for only container, null (or leave empty) for both
     * @returns {boolean} Whether or not the host was assigned a NEW attribute value
     **/
    setAttrib(name, value, onlyHostOrContainer = null) {
        const host = this.shadowRoot.host;
        let oldHostAttrib = host.getAttribute(name);
        if (onlyHostOrContainer === true || onlyHostOrContainer !== false) {
            host.setAttribute(name, value);
        }

        let oldContainerAttrib = null;
        const container = this.shadowRoot.querySelector("#container");
        if (container &&
            (onlyHostOrContainer === false || onlyHostOrContainer !== true)
        ) {
            oldContainerAttrib = container.getAttribute(name);
            container.setAttribute(name, value);
        }

        if (oldHostAttrib !== host.getAttribute(name) ||
            (container && oldContainerAttrib !== container.getAttribute(name))
        ) return true;
        return false;
    }

    /**
     * Formats time in seconds to the standard format (e.g., 70 seconds -> 1:10)
     */
    static formatSeconds(seconds) {
        const minutes = parseInt(seconds/60);
        seconds %= 60;
        const hours = parseInt(seconds/60);
        seconds %= 60;
        if (hours === 0) {
            return String(minutes).padStart(1, "0") +":"+
            String(parseInt(seconds)).padStart(2, "0");
        } else {
            return String(hours).padStart(1, "0") +":"+
            String(minutes).padStart(2, "0") +":"+
            String(parseInt(seconds)).padStart(2, "0");
        }
    }
    static getPing() {
        return MusicPlayer.#pinger.get();
    }
    static pingServer() {
        MusicPlayer.#pinger.pingServer();
    }
}
customElements.define("music-player", MusicPlayer);

function createQueueItem(song, timestamp, clickCallback, abortSignal) {
    const item = document.createElement("div");
    const miniThumbnail = document.createElement("img");
    miniThumbnail.src = song.thumbnails.low;
    item.appendChild(miniThumbnail);

    const songInfo = document.createElement("div");
    songInfo.addEventListener("click", clickCallback, { "signal": abortSignal });
    item.appendChild(songInfo);
    
    const title = document.createElement("p");
    title.textContent = song["title"];
    songInfo.appendChild(title);
    const author = document.createElement("p");
    author.textContent = song["channelName"];
    songInfo.appendChild(author);

    const lengthLabel = document.createElement("p");
    const songLength = parseFloat(timestamp.length);
    lengthLabel.textContent = MusicPlayer.formatSeconds(songLength);
    item.appendChild(lengthLabel);

    return item;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}