
function createPlayerComponent(controller = new AbortController(), playerWeakref = new WeakRef(new Object()), deletePlayer = function(){}, allPlayers = []) {
    const player = playerWeakref.deref();
    const signal = controller.signal;
    const defaultZIndex = 10;
    let el, close; // Elements
    let mousedown = false,
        elStartX = 0, elStartY = 0,
        mStartX = 0, mStartY = 0;
    const handleDragStart = e => {
        if (e.button !== 0 || e.target === close) return;
        const elDim = el.getBoundingClientRect();
        elStartX = elDim.x;
        elStartY = elDim.y;
        mStartX = e.pageX;
        mStartY = e.pageY;
        mousedown = true;
        el.style.userSelect = "none";
        el.style.zIndex = defaultZIndex+1;
        el.classList.add("active");
        allPlayers.forEach(pWeakref => {
            const p = pWeakref.deref();
            if (p["el"] !== el) {
                const otherEl = p.el;
                otherEl.style.zIndex = defaultZIndex;
            }
        });
    }
    const handleDragMove = e => {
        if (!mousedown) return;
        const oldLeft = el.style.left, oldTop = el.style.top;
        const { width, height } = el.getBoundingClientRect();
        const changeX = e.pageX - mStartX;
        const changeY = e.pageY - mStartY;
        el.style.left = `${
            Math.min(
                Math.max(0, elStartX + changeX),
                window.innerWidth - width
            )
        }px`;
        el.style.top = `${
            Math.min(
                Math.max(0, elStartY + changeY),
                window.innerHeight - height
            )
        }px`;
        if (oldLeft !== el.style.left || oldTop !== el.style.top) {
            el.style.translate = "none";
        }
    }
    const handleDragEnd = () => {
        mousedown = false;
        el.style.userSelect = "text";
        el.classList.remove("active");
    }

    el = document.createElement("div");
    el.className = "player";
    el.tabIndex = 0;
    // For moving the player
    el.addEventListener("pointermove", handleDragMove, { signal });
    el.addEventListener("pointerup", handleDragEnd, { signal });
    el.addEventListener("pointerleave", handleDragEnd, { signal });
    // General player keyboard-input handler
    el.addEventListener("keydown", e => {
        let volume = player.getVolume();
        let time = player.getTime();
        switch (e.key) {
            case "ArrowUp":
                e.preventDefault();
                volume += 0.05;
                break;
            case "ArrowDown":
                e.preventDefault();
                volume -= 0.05;
                break;
            case "ArrowLeft":
                e.preventDefault();
                time -= 5;
                break;
            case "ArrowRight":
                e.preventDefault();
                time += 5;
                break;
            case " ":
                e.preventDefault();
                player.toggle();
                break;
        }
        if (player.getVolume() !== volume) player.setVolume(volume);
        if (player.getTime() !== time) player.setTime(time);
    }, { "capture": true, signal });

    const header = document.createElement("div");
    header.className = "header grabbable";
    header.addEventListener("pointerdown", handleDragStart, { signal });
    el.appendChild(header);

    close = document.createElement("div");
    close.className = "close";
    close.addEventListener("click", () => {
        deletePlayer.call(player);
    }, { "once": true, signal });
    header.appendChild(document.createElement("div"));
    header.appendChild(close);

    const main = document.createElement("div");
    main.className = "main";
    el.appendChild(main);

    const title = document.createElement("a");
    title.className = "title";
    title.textContent = "(song name)";
    title.target = "_blank";
    main.appendChild(title);

    const thumbnail = document.createElement("img");
    thumbnail.className = "thumbnail";
    thumbnail.alt = "Song thumbnail";
    thumbnail.draggable = false;
    thumbnail.addEventListener("click", e => {
        if (e.detail !== 1) return;
        if (!thumbnail.classList.contains("fully-hidden")) {
            thumbnail.classList.toggle("hidden");
        }
        thumbnail.classList.remove("fully-hidden");
    }, { signal });
    thumbnail.addEventListener("dblclick", e => {
        if (e.detail !== 2) return;
        thumbnail.classList.remove("hidden");
        thumbnail.classList.toggle("fully-hidden")
    }, { signal });
    main.appendChild(thumbnail);

    const author = document.createElement("a");
    author.className = "author";
    author.textContent = "(author)";
    author.target = "_blank";
    main.appendChild(author);

    const timeline = document.createElement("div");
    timeline.className = "timeline";
    main.appendChild(timeline);

    const currentT = document.createElement("p");
    currentT.className = "time-label start";
    currentT.textContent = "0:00";
    timeline.appendChild(currentT);

    let seeking = false;
    const progress = document.createElement("input");
    progress.type = "range";
    progress.className = "progress";
    progress.step = 0.01;
    progress.addEventListener("pointerdown", e => {
        seeking = true;
        const tempT = player.getTime();
        player.pause();
        progress.value = tempT;

        const { width, left } = progress.getBoundingClientRect();
        let padding = getComputedStyle(progress).getPropertyValue("padding").replaceAll("px", "");
        padding = parseFloat(padding.replace(parseFloat(padding), "").trim());
        if (isNaN(padding)) {
            padding = parseFloat(getComputedStyle(progress).getPropertyValue("padding"));
        }
        const relativeX = Math.max(0, e.pageX - left - padding);
        const percent = Math.min(relativeX * 100 / (width-padding), 100);
        const max = parseFloat(progress.max);
        setTimeout(() => {
            if (percent <= 1) {
                progress.value = 0;
            } else {
                progress.value = max * (percent / 100);
            }
            // console.log(max * (percent / 100), e.target.value, "\n");
        }, 0);
    }, { signal });
    const resume = () => {
        if (seeking) {
            seeking = false;
            player.seek(parseFloat(progress.value));
        }
    }
    document.addEventListener("pointerup", resume, { signal });
    // progress.addEventListener("pointerleave", resume, { signal });
    // progress.addEventListener("pointercancel", resume, { signal });
    // progress.addEventListener("pointerout", resume, { signal });
    timeline.appendChild(progress);

    const endT = currentT.cloneNode(true);
    endT.classList.replace("start", "end");
    timeline.appendChild(endT);

    const controls = document.createElement("div");
    controls.className = "controls";
    main.appendChild(controls);

    const previousTrack = document.createElement("div");
    previousTrack.className = "track previous";
    const previousTrackImg = document.createElement("img");
    previousTrackImg.alt = "Previous track";
    previousTrackImg.src = "./assets/new-song-button.png";
    previousTrackImg.draggable = false;
    previousTrack.appendChild(previousTrackImg);
    controls.appendChild(previousTrack);

    const playButtonImg = document.createElement("img");
    playButtonImg.alt = "Play";
    playButtonImg.src = "./assets/play-button.png";
    playButtonImg.draggable = false;
    const playButton = document.createElement("div");
    playButton.className = "play-button paused";
    playButton.addEventListener("click", () => {
        try {
            if (!player.pause()) player.play();
        } catch (err) {
            console.error(err);
            player.pause();
        }
    }, { signal });
    playButton.appendChild(playButtonImg);
    controls.appendChild(playButton);

    const nextTrack = previousTrack.cloneNode(true);
    nextTrack.classList.replace("previous", "next");
    nextTrack.children[0].alt = "Next track";
    nextTrack.children[0].src = "./assets/new-song-button.png";
    controls.appendChild(nextTrack);

    const footer = document.createElement("div");
    footer.className = "footer";
    el.appendChild(footer);


    const settings = document.createElement("div");
    settings.className = "settings";
    const settingsImg = document.createElement("img");
    settingsImg.alt = "Settings";
    settingsImg.src = "./assets/settings.png";
    settingsImg.draggable = false;
    settings.appendChild(settingsImg);
    footer.appendChild(settings);

    return el;
}

// FOR TESTING!
document.onkeydown = e => {
    if (e.key === ",") document.body.appendChild(
        new Player().el
    );
}