export default class Pinger {
    #ping = 100; // Measured in ms
    #intervalTime; // In seconds
    #controller = new AbortController();
    #timeout = setTimeout(() => {}, 0);
    
    /**
     * @param {number} interval Time in seconds to do a ping
     */
    constructor(interval = 60) {
        this.#intervalTime = interval;
        this.#pingServer();

        setInterval(() => {
            this.#pingServer();
        }, 1000 * this.#intervalTime + 2);
    }

    #pingServer() {
        this.#timeout = setTimeout(() => {
            this.#controller.abort(`PINGER TIMEOUT AFTER ${this.#intervalTime} SECONDS`);
        }, 1000 * this.#intervalTime + 1);

        const start = performance.now();
        fetch("/ping", { "signal": this.#controller.signal })
        .then(() => {
            clearTimeout(this.#timeout);
            this.#ping = performance.now() - start;
        })
        .catch(err => console.error(err));
    }

    get() {
        return this.#ping;
    }
    pingServer() {
        this.#pingServer();
    }
}