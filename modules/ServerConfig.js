/**
 * @typedef {object} ServerConfig
 * @property {ServerConfig} default Cloned, immutable version of the config
 * @property {string} youtubeAPIKey
 * @property {HTTPSCredentials} httpsCredentials
 * @property {number} port
 * @property {string[] | string} corsWhitelist
 * @property {ServerConfigAccounts} accounts
 * @property {string[]} ffmpegOptions Only contains audio filters
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
config.default = structuredClone(config);
Object.freeze(config.default);

const printableConfig = structuredClone(config);
printableConfig.default = "{cloned config settings...}";
// console.log(`SERVER CONFIG:\n${JSON.stringify(printableConfig, null, 4)}`);

module.exports = config;