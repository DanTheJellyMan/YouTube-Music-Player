/**
 * @typedef {object} ServerConfig
 * @property {string} youtubeAPIKey
 * @property {HTTPSCredentials} httpsCredentials
 * @property {number} port
 * @property {string[]} corsWhitelist
 * @property {ServerConfigAccounts} accounts
 */

/**
 * @typedef {object} ServerConfigHTTPSCredentials
 * @property {string} dirName
 * @property {string} keyName
 * @property {string} certName
 */

/**
 * @typedef {object} ServerConfigAccounts
 * @property {{usernameRegExp: string, passwordRegExp: string}} credentialRequirements
 */

const PARENT_DIR = require.main.path;
const { readFileSync } = require("fs");
const path = require("path");
const JSON5 = require("json5");

const configPath = path.join(PARENT_DIR, "server_config.json5");
const json = readFileSync(configPath, { "encoding": "utf8" });

/**
 * @type {ServerConfig}
 */
const config = JSON5.parse(json);
console.log(`SERVER CONFIG:\n${JSON.stringify(config, null, 4)}`);

module.exports = config;