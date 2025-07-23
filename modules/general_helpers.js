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
 * @param {string} path Absolute path
 * @returns {Promise<path | null>} Resolves to inputted path, or null if dir creation fails
 */
async function createFolder(path) {
    try {
        await fs.mkdir(path, { "recursive": false });
        return path;
    } catch (err) {
        // console.error(err, `aborted folder creation of ${path}`);
        return null;
    }
}

/**
 * Creates a child process spawn
 * @param {string} command
 * @param {string[]} options
 * @param {SpawnOptionsWithoutStdio} options2 Typically contains { cwd: [PROCESS DIRECTORY] }
 * @returns {{"cmd": ChildProcessWithoutNullStreams, "done": Promise<string>} | null} Resolve upon process close
 */
function createCMD(command, options, options2 = { "cwd": PARENT_DIR }) {
    let cmd;
    try {
        cmd = spawn(command, options, options2);
    } catch (err) { console.error(err.toString()); return null; }
    cmd.stdout.on("data", data => {});
    cmd.stdout.on("error", err => {});
    cmd.stdin.on("data", data => {});
    cmd.stdin.on("error", err => {});
    cmd.stderr.on("data", err => {});
    cmd.stderr.on("error", err => {});
    cmd.on("error", err => {});
    
    const done = new Promise((resolve, reject) => {
        try {
            cmd.on("exit", code => {
                cmd.removeAllListeners();
                if (code !== 0 && command !== "ffprobe") {
                    return reject(
                        Error(`${command} CMD EXITED WITH ERROR CODE ${code}`)
                    );
                }
                return resolve(`${code}`);
            });
        } catch (err) {
            return reject(err);
        }
    });

    return { cmd, done };
}

module.exports = {
    randomInt,
    randomFloat,
    reverseIndexOf,
    includes,

    createFolder,
    createCMD
}