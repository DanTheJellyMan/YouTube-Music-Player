const os = require("os");

class ThreadManager {
    static #CPU_THREAD_COUNT = os.cpus().length;
    #limitMaxThreads = true;
    #targetThreadCount = 1;
    #processCount = 0;

    constructor(limitMaxThreads = true, targetThreadCount = ThreadManager.#CPU_THREAD_COUNT) {
        this.#limitMaxThreads = limitMaxThreads;
        this.#setTargetThreadCount(targetThreadCount);
    }

    #setTargetThreadCount(count = 1) {
        if (typeof count !== "number" || isNaN(count) || !isFinite(count)) {
            return console.error(Error(
                `ERROR WHILE SETTING ThreadManager THREAD COUNT:\t${count} is invalid`
            ));
        }
        this.#targetThreadCount = Math.max(1, count);

        if (!this.#limitMaxThreads) return;
        this.#targetThreadCount = Math.min(
            this.#targetThreadCount,
            ThreadManager.#CPU_THREAD_COUNT
        );
    }

    addProcess() {
        this.#processCount++;
    }
    removeProcess() {
        this.#processCount--;
    }

    getAvailableThreadCount() {
        const availableThreads = Math.max(
            1,
            Math.floor(this.#targetThreadCount / this.#processCount)
        );
        return availableThreads;
    }

    static CPU_THREAD_COUNT() {
        return ThreadManager.#CPU_THREAD_COUNT;
    }
}

module.exports = ThreadManager