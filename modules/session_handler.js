const PARENT_DIR = require.main.path;
const { find, update } = require("./database_handler");
const { v4: uuid } = require("uuid");
const generalHelpers = require("./general_helpers");

class Manager {
    #db;
    #table;

    constructor(db, table) {
        this.#db = db;
        this.#table = table;

        this.checkForFlush();
    }

    initSession(username) {
        const json = JSON.parse(find(this.#db, this.#table, [
            ["username", username]
        ])[0]["sessions_json"]);

        let id;
        do {
            id = uuid();
        } while (id in json);

        const session = {
            "save": false,
            "players": {
                "playlist": null,
                "": null
            }
        }
        json[id] = session;

        update(this.#db, this.#table, [
            ["sessions_json", JSON.stringify(json, null, 4)]
        ], [ ["username", username] ]);

        return id;
    }

    async checkForFlush(...usernames) {
        for (const username of usernames) {
            const user = find(this.#db, this.#table, [
                ["username", username]
            ])[0];

            const json = JSON.parse(user["sessions_json"]);
            for (const sessionId of Object.keys(json)) {
                if (!json[sessionId].save) {
                    
                }
            }
        }
    }

    async #flushPlaylist_m3u8(userFolder, playlistName) {
        // const 
    }
}

module.exports = {
    Manager
}