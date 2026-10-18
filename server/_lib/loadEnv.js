// Minimal .env reader (no dependency): fills in variables that are not already set.
// On Render the variables come from the service environment and this is a no-op;
// locally it reads the .env file in the project root.
"use strict";

const fs = require("fs");
const path = require("path");

function parse(text) {
    text.split(/\r?\n/).forEach(function (line) {
        const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!match) return;

        let value = match[2].trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        // Real environment variables always win over the file.
        if (!(match[1] in process.env)) process.env[match[1]] = value;
    });
}

function loadEnv() {
    // The .env file lives in the project root, next to .env.example.
    // scripts/.env is still accepted as a fallback for older setups.
    const files = [
        path.join(__dirname, "..", "..", ".env"),
        path.join(__dirname, "..", "..", "scripts", ".env")
    ];

    for (const file of files) {
        if (!fs.existsSync(file)) continue;
        parse(fs.readFileSync(file, "utf8"));
        return file;
    }
    return null;
}

module.exports = loadEnv;