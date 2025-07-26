const fs = require("fs/promises");
const { spawn } = require("child_process");

/**
 * Generate random integer between two integers
 * @param {number} min Inclusive
 * @param {number} max Inclusive
 * @returns {number}
 */
function randomInt(min, max) {
    min = parseInt(min);
    max = parseInt(max);
    return Math.floor(Math.random() * (max-min+1) + min);
}

/**
 * Generate random float between two numbers
 * @param {number} min Inclusive
 * @param {number} max Exclusive
 * @returns {number}
 */
function randomFloat(min, max) {
    return Math.random() * (max-min) + min;
}

/**
 * @param {string} str 
 * @param {string} target 
 * @param {number} startPos
 * @returns {number}
 */
function reverseIndexOf(str, target, startPos = 0) {
    for (let i = str.length - startPos-1; i >= 0; i--) {
        if (str.substring(i, i+target.length) === target) {
            return i;
        }
    }
    return -1;
}

/**
 * Check for equality among a Set of strings to a target string, with a selectable amount of chars to check from the target string
 * @param {string} str Target string
 * @param {Set<string>|string[]} comparisons Strings to be checked for equality against str chunks
 * @param {number} charsToMatch Amount of characters in str used for comparisons
 * @returns {boolean}
 */
function includes(str, comparisons, charsToMatch = 0) {
    if (typeof str !== "string" || str === "") throw Error(`ERROR: ${str} IS NOT A VALID TARGET STRING`);
    if (typeof charsToMatch !== "number" || !charsToMatch) charsToMatch = str.length;
    if (!(comparisons instanceof Set)) {
        if (comparisons !== null && Symbol.iterator in comparisons) {
            comparisons = new Set(comparisons);
        } else {
            throw Error(`ERROR: ${comparisons} IS NOT A VALID ARRAY/SET/ITERABLE`);
        }
    }
    const iterations = str.length - charsToMatch;
    for (let i=0; i<=iterations; i++) {
        const chunk = str.substring(i, i + charsToMatch);
        if (comparisons.has(chunk)) return true;
    }
    return false;
}

/**
 * Alternate method of creating a folder (non-recursively)
 * @param {string} path Absolute path
 * @returns {Promise<path | null>} Resolves to inputted path, or null if dir creation fails. Never rejects.
 */
async function createFolder(path) {
    try {
        await fs.mkdir(path, { "recursive": false });
        return path;
    } catch (err) {
        return null;
    }
}

/**
 * Creates a child process spawn, with some built in error handling
 * @param {string} command
 * @param {string[]} options
 * @param {SpawnOptionsWithoutStdio} options2 Typically contains { cwd: [PROCESS DIRECTORY] }
 * @returns {{"childProcess": ChildProcessWithoutNullStreams, "done": Promise<string>} | null} "done" promise resolves upon process exit
 */
function createChildProcess(command, options, options2 = { "cwd": PARENT_DIR }) {
    let childProcess = null
    let initSuccess = false;
    try {
        childProcess = spawn(command, options, options2);
        childProcess.stdout.on("data", data => {});
        childProcess.stdout.on("error", err => {});
        childProcess.stdin.on("data", data => {});
        childProcess.stdin.on("error", err => {});
        childProcess.stderr.on("data", err => {});
        childProcess.stderr.on("error", err => {});
        childProcess.on("error", err => {});

        if (!childProcess || !childProcess.stdout || !childProcess.stdin || !childProcess.stdio) {
            throw Error(`ERROR DURING ${command} PROCESS INIT`);
        }
        
        const done = new Promise((resolve, reject) => {
            try {
                childProcess.once("exit", code => {
                    if (code === 0) return resolve(`${code}`);
                    return reject(
                        new Error(`${command} childProcess EXITED WITH ERROR CODE ${code}`)
                    );
                });
            } catch (err) {
                return reject(err);
            }
        });
        done.catch(() => {});

        initSuccess = true;
        return { childProcess, done };
    } catch (err) {
        console.error(err);
        if (childProcess) {
            childProcess.removeAllListeners();
            childProcess.kill();
            childProcess = null;
        }
        if (!initSuccess) {
            initSuccess = null;
            return null;
        }
    }
}

module.exports = {
    randomInt,
    randomFloat,
    reverseIndexOf,
    includes,

    createFolder,
    createChildProcess
}