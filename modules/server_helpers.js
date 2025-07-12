const PARENT_DIR = require.main.path;
const path = require("path");
const fs = require("fs/promises");
const { readFileSync } = require("fs");
const JSON5 = require("json5");

const { v4: uuid } = require("uuid");
const Database = require("better-sqlite3");
const { find, addRow, update, deleteRow } = require("./database_handler.js");
const playlistHandler = require("./playlist_handler.js");
const { createFolder } = require("./general_helpers.js");
const serverConfig = require("./server_config.js");

/**
 * @param {Express} app 
 */
function initServer(app) {
    const USER_DB = new Database("user_data.db");
    USER_DB.prepare(
        `CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY NOT NULL,
            password TEXT NOT NULL,
            folder_name TEXT NOT NULL,
            playlists_json TEXT NOT NULL
        )`
    ).run();

    const { httpsCredentials, port } = serverConfig;
    const dir = httpsCredentials.dirName;
    const httpsCred = {
        "key": readFileSync(path.join(dir, httpsCredentials.keyName), { "encoding": "utf8" }),
        "cert": readFileSync(path.join(dir, httpsCredentials.certName), { "encoding": "utf8" })
    }
    const server = require("https").createServer(httpsCred, app);
    server.listen(port, () =>
        console.log(`Server listening on port ${port}`)
    );
    setTerminalListeners(USER_DB);

    return { USER_DB, server };
}

// TODO: rework to make commands feel more like writing javascript (maybe use more eval)
//       to make multi-parameter function calls easier to do
function setTerminalListeners(USER_DB) {
    const commands = {
        "print": console.log,
        "users": () => find(USER_DB, "users"),
        "clear": () => console.clear(),
        "stringify": json => JSON.stringify(json, null, 4),
        "deleteUser": username => {
            
        },
        "eval": str => eval(str),
        "concat": function(separator = "space", ...strs) {
            if (!(strs instanceof Array)) {
                return "";
            }
            try {
                if (separator.startsWith("space") && separator.indexOf("*") === 5) {
                    const count = parseInt(separator.substring(6, separator.length));
                    return strs.join(" ".repeat(count));
                }
            } catch (err) {}
            return strs.join(separator);
        },
        "restart": () => {
            
        },
        "help":  () => {
            console.log(`Available commands:\n${
                JSON.stringify(Object.keys(commands), null, 4)
            }`);
            console.log(
                "To combine multiple commands, use '&&' between each one (spaces or no spaces are valid).\n"+
                "Use '~~' to combine multiple parameters"
            );
        }
    }
    
    process.stdin.on("data", d => {
        const inputs = [];
        d = d.toString("utf8").trim();
        let start = 0;

        while (true) {
            let index = d.indexOf("&&", start); // Exclusive of end of keyword
            if (index === -1) {
                // Handle last argument of input
                if (d.substring(start).trim() !== "") {
                    index = d.length - index;
                } else break;
            }

            const keywords = d.substring(start, index).trim();
            if (typeof commands[keywords] === "function") {
                inputs.push(commands[keywords]);
            } else {
                inputs.push(keywords.split("~~"));
            }
            start = index+2;
        }

        // Final method execution
        inputs.reverse().reduce((prev, curr) => {
            if (typeof curr === "function") {
                try {
                    if (!(prev instanceof Array)) return curr.apply(null, [prev]);
                    return curr.apply(null, prev);
                } catch (err) {
                    return curr;
                }
            }
            return curr;
        }, null);
    });
}



/**
 * Check if user is within the database
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {string} username 
 * @param {string} password 
 * @returns {boolean} True if user's in db, false otherwise
 */
function checkLogin(db, table, username, password) {
    const users = find(db, table, [
        ["username", username],
        ["password", password],
    ]);
    if (users.length === 0) return false;
    if (users.length === 1) return true;

    console.error(`ERROR: Multiple users with the same username & password found!\n${users}`);
    return false;
}

/**
 * Create a new account + table (row) entry for user
 * @param {BetterSQLite3.Database} db Database 
 * @param {string} table Table name 
 * @param {string} username 
 * @param {string} password 
 * @returns 
 */
async function signUp(db, table, username, password) {
    const usernameRegExp = new RegExp(getCredentialRequirements().usernameRegExp);
    const passwordRegExp = new RegExp(getCredentialRequirements().passwordRegExp);
    username = username.trim().normalize("NFKC");
    password = password.trim().normalize("NFKC");

    const usernameOK = usernameRegExp.test(username);
    const passwordOK = passwordRegExp.test(password);
    if (!usernameOK &&
        !passwordOK) return response(false, 401, "Invalid username and password");
    if (!usernameOK) return response(false, 401, "Invalid username");
    if (!passwordOK) return response(false, 401, "Invalid password");

    const matchingUserCount = find(db, table, [
        ["username", username],
    ]).length;
    if (matchingUserCount > 0) return response(false, 401, "Username already taken");

    const folder_name = await createUserFolder();
    addRow(db, table, [
        ["username", username],
        ["password", password],
        ["folder_name", folder_name],
        ["playlists_json", "[]"],
    ]);
    return response(true, 200, "New account created successfully");

    async function createUserFolder() {
        let folder_name = username;
        let success = await createFolder(path.join(PARENT_DIR, "user_playlists", username));

        while (success === null) {
            folder_name = uuid();
            success = await createFolder(path.join(PARENT_DIR, "user_playlists", folder_name));
        }
        return folder_name;
    }
}

function getCredentialRequirements() {
    return serverConfig.accounts.credentialRequirements;
}

/**
 * @param {boolean} ok 
 * @param {number} status 
 * @param {string} text 
 * @returns 
 */
function response(ok, status, text) {
    return { ok, status, text };
}

module.exports = {
    initServer,
    checkLogin,
    signUp,
}