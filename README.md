### *Make sure to create a server_settings.json5 file!*

**Format:**
```

{
    default: {},
    youtubeAPIKey: string,
    httpsCredentials: {
        dirName: string,
        keyName: string,
        certName: string,
    },
    port: number,
    corsWhitelist: string[] | string,
    accounts: {
        credentialRequirements: {
            usernameRegExp: string,
            passwordRegExp: string
        }
    },
    ffmpegOptions: string[]
}

```

**What I personally use:**

*Note: **[REDACTED]** is used to hide my private info*

```

{
    default: {}, // Cloned config settings (immutable). Set in ServerConfig.js
    youtubeAPIKey: "[REDACTED]",
    httpsCredentials: {
        dirName: "[REDACTED]", // Located in top-level directory (same as server.js)
        keyName: "[REDACTED]-key.pem",
        certName: "[REDACTED]-cert.pem",
    },
    port: [REDACTED],
    corsWhitelist: [
        "https://[REDACTED]",
        "https://[REDACTED]:[REDACTED-PORT]",
        "https://[REDACTED]:[REDACTED-PORT]"
    ],

    accounts: {
        credentialRequirements: {
            usernameRegExp: [REDACTED-REGEX-STRING],
            passwordRegExp: [REDACTED-REGEX-STRING]
        }
    },

    // Strictly for audio filters
    ffmpegOptions: [
        "-filter_complex",

        // Audio filters
"[0:a]anlmdn=s=0.0021:p=16ms:r=24ms[base]; \
[base]asplit=2[base_0][norm_0]; \
[base_0]acompressor=mode=upward:ratio=3.8:threshold=-26.5dB:attack=150:release=200:knee=3.5[base_1]; \
[base_1]acompressor=mode=downward:ratio=1.2:threshold=-22dB:attack=50:release=250:knee=5[base_2]; \
[base_2]acompressor=mode=downward:ratio=11:threshold=-16dB:attack=1:release=75:knee=3[base_3]; \
[base_3]acompressor=mode=downward:ratio=17:threshold=-10dB:attack=1:release=50:knee=1.5[base_final]; \
[norm_0]loudnorm=i=-18:lra=8:tp=-1.4[norm_final]; \
[norm_final][base_final]amix=inputs=2:weights=2 3[output_0]; \
[output_0]alimiter=limit=-1.4dB:attack=1:release=50[output_final];",

        // Set label to main audio stream
        "-map", "[output_final]",
    ]
}

```