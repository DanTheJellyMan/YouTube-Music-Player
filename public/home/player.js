class Player extends EventTarget {
    static #pinger = new Pinger();
    static #allPlayers = [];
    #selfref = this;
    #weakref = new WeakRef(this);
    #controller = new AbortController();
    #playerName = `player_${crypto.randomUUID()}`;
    #audio = new Audio();
    #hls = new Hls();

    #el = null;
    parentEl = null;

    #playlist = null;
    #songIndex = 0;

    audioPreferences = null;
    static defaultAudioPreferences = (function() {
        let preferences = JSON.parse(localStorage.getItem("audioPreferences"));
        if (!preferences) {
            preferences = {
                "volume": 0.5,
                "playbackRate": 1,
                "autoplay": true,
                "loop": false,
                "shuffleOnLoop": false,
            }
            localStorage.setItem("audioPreferences", JSON.stringify(preferences));
        }
        return preferences;
    })();

    windowPreferences = null;
    static defaultWindowPreferences = (function() {
        let preferences = JSON.parse(localStorage.getItem("windowPreferences"));
        if (!preferences) {
            /* TODO: find what to add to window preferences */
            localStorage.setItem("windowPreferences", JSON.stringify(preferences));
        }
        return preferences;
    })();

    constructor(playlist = null) {
        super();
        this.audioPreferences = structuredClone(Player.defaultAudioPreferences);
        this.windowPreferences = structuredClone(Player.defaultWindowPreferences);

        this.setPlaylist(playlist);
        this.#audio.volume = 0.3;
        this.#audio.addEventListener("timeupdate", e => {
            this.#handleTimeupdate.call(this, e);
        }, { "signal": this.#controller.signal });
        this.#audio.addEventListener("loadedmetadata", () => {
            this.play();
        }, { "signal": this.#controller.signal });

        this.#el = (
            window.createPlayerComponent ||
            globalThis.createWindowComponent
        )(this.#controller, this.#weakref, this.#deletePlayer);

        Player.#allPlayers.push(this.#weakref);
        return this.#weakref;
    }
    setPlaylist(playlist = null) {
        this.#playlist = structuredClone(playlist);
    }

    play() {
        const imgContainer = this.#el.querySelector(".play-button");
        imgContainer.classList.remove("paused");
        const img = imgContainer.querySelector("img");
        img.src = "./assets/pause-button.png";
        if (!this.#audio.paused) return Promise.resolve(false);
        return this.#audio.play().then(() => true);
    }
    pause() {
        const imgContainer = this.#el.querySelector(".play-button");
        imgContainer.classList.add("paused");
        const img = imgContainer.querySelector("img");
        img.src = "./assets/play-button.png";
        if (this.#audio.paused) return false;
        this.#audio.pause();
        return true;
    }
    toggle() {
        const img = this.#el.querySelector(".play-button > img");
        img.classList.toggle("paused");
        if (this.#audio.paused) return this.play();
        return Promise.resolve(this.pause());
    }
    seek(time) {
        time = parseFloat(time);
        if (typeof time !== "number") return;
        this.#audio.currentTime = (
            this.#songIndex === 0 ? 0 : this.#totalTime(this.#songIndex-1)
        ) + time;
        this.play();
    }

    getTime() {
        return this.#audio.currentTime;
    }
    setTime(time) {
        if (typeof time !== "number" || Number.isNaN(time)) return;
        this.#audio.currentTime = Math.max(0, time);
    }
    getVolume() {
        return this.#audio.volume;
    }
    setVolume(volume) {
        if (typeof volume !== "number" || Number.isNaN(volume)) return;
        this.#audio.volume = Math.max( 0, Math.min(volume, 1) );
    }

    #handleTimeupdate(e) {
        const { songs } = this.#playlist;
        const progress = this.#audio.currentTime - (
            this.#songIndex === 0 ? 0 : this.#totalTime(this.#songIndex-1)
        );
        document.querySelector(".player > .main > .timeline > .time-label.start").textContent =
            this.#formatSeconds(progress);
        document.querySelector(".player > .main > .timeline > .progress").value = progress;

        if (this.#audio.currentTime > this.#totalTime(this.#songIndex)) {
            this.#songIndex++;
        } else if (this.#songIndex !== 0 ||
            document.querySelector(".player > .main > .thumbnail").src !== ""
        ) return;
        const { title, channelName, channelUrl, videoUrl, thumbnails, length } =
            songs[this.#songIndex];
        
        const titleEl = document.querySelector(".player > .main > .title");
        titleEl.href = videoUrl;
        titleEl.textContent = title;

        const thumbnail = document.querySelector(".player > .main > .thumbnail");
        thumbnail.src = thumbnails.medium;

        const author = document.querySelector(".player > .main > .author");
        author.href = channelUrl;
        author.textContent = channelName;

        const max = this.#totalTime(this.#songIndex) - this.#audio.currentTime;
        document.querySelector(
            ".player > .main > .timeline > .time-label.end"
        ).textContent = this.#formatSeconds(max);
        document.querySelector(".player > .main > .timeline > .progress").max = max;
    }

    #totalTime(songIndex) {
        let total = 0;
        for (let i=0; i<=songIndex; i++)
            total += this.#playlist.songs[i].length;
        return total;
    }

    #formatSeconds(seconds) {
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

    async makePlaylist() {
        const playlistUrl = await fetch("/make-playlist", {
            "method": "POST",
            "headers": {
                "Content-Type": "application/json"
            },
            "body": JSON.stringify({
                "playerName": this.#playerName,
                "playlistName": this.#playlist.name,
                "songNames": this.#playlist.songs.map(songObj => songObj.filename)
            })
        });
        if (!playlistUrl.ok) {
            console.error(await playlistUrl.text());
        } else {
            this.loadPlaylist();
        }
    }

    shufflePlaylist(iterations = 1) {
        iterations = Math.max(1, iterations);
        for (let i=0; i<iterations; i++) {
            const tempSongs = Array(this.#playlist.songs.length);
            let nextIndex = 0;
            while (this.#playlist.songs.length > 0) {
                tempSongs[nextIndex++] = this.#playlist.songs.splice(
                    randomInt(0, this.#playlist.songs.length-1), 1
                )[0];
            }
            this.#playlist.songs = tempSongs;
        }
        return this.makePlaylist();
    }

    loadPlaylist() {
        const compatibility = this.#audio.canPlayType("application/vnd.apple.mpegurl");
        if (!Hls.isSupported()) {
            alert(
                "ERROR: Browser doesn't support native HLS or the HLS.js library.\n"+
                "Cannot play audio without one of these."
            );
            return;
        } else if (compatibility === "probably" || compatibility === "maybe") {
            this.#audio.src = m3u8_url;
        } else {
            this.#hls.loadSource(`/play/${this.#playlist.name}/${this.#playerName}`);
            this.#hls.attachMedia(this.#audio);
        }
    }
    
    appendElTo(parentEl = document.body) {
        this.parentEl = parentEl;
        this.parentEl.appendChild(this.#el);
    }

    static getPing() {
        return Player.#pinger.get();
    }

    #deletePlayer = () => {
        this.#hls.destroy();
        this.#audio.pause();
        this.#audio.src = "";
        this.#audio.load();
        this.#audio.remove();
        this.#audio = null;

        this.#el.remove();
        this.#controller.abort("Player deletion initiated");
        this.#selfref = null;
        console.log(`${this.#playerName} eligble for garbage-collection`);
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}