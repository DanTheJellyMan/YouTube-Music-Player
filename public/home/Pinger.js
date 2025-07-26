export default class Pinger {
    #pingMS = 500;
    #pingIntervalSeconds = -1;
    #img = new Image();
    
    constructor(intervalSeconds = 60) {
        this.#pingIntervalSeconds = intervalSeconds;
        this.#pingServer();

        setInterval(() => {
            this.#pingServer();
        }, 1000 * this.#pingIntervalSeconds);
    }

    #pingServer() {
        let timeout = null, removeListeners = null;
        
        const handleLoad = () => {
            clearTimeout(timeout);
            this.#pingMS = performance.now() - startMS;
            removeListeners();
        }
        const handleError = () => {
            clearTimeout(timeout);
            console.warn(`PINGER TIMEOUT AFTER ${this.#pingIntervalSeconds} SECONDS`);
            removeListeners();
        }
        removeListeners = () => {
            this.#img.src = "";
            this.#img.removeEventListener("load", handleLoad);
            this.#img.removeEventListener("error", handleError);
        }
        timeout = setTimeout(handleError, 1000 * this.#pingIntervalSeconds);

        const startMS = performance.now();
        this.#img.src = `https://i.ytimg.com?nocache=${crypto.randomUUID()}`;
        this.#img.addEventListener("load", handleLoad, { "once": true });
        this.#img.addEventListener("error", handleError, { "once": true });
    }

    get() {
        return this.#pingMS;
    }
    pingServer() {
        this.#pingServer();
    }
}