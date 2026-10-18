// MySQL (TiDB Cloud) connection pool.
// The pool is cached on the module so warm serverless invocations reuse it.
"use strict";

const fs = require("fs");
const mysql = require("mysql2/promise");

let pool = null;

function sslConfig() {
    const raw = process.env.DB_SSL;
    if (raw !== undefined && ["disable", "false", "off", "0"].includes(String(raw).toLowerCase())) {
        return undefined;
    }

    const caPem = process.env.DB_SSL_CA_PEM;
    if (caPem) {
        return { ca: String(caPem).replace(/\\n/g, "\n"), minVersion: "TLSv1.2", rejectUnauthorized: true };
    }

    const caPath = process.env.DB_SSL_CA;
    if (caPath) {
        return { ca: fs.readFileSync(caPath, "utf8"), minVersion: "TLSv1.2", rejectUnauthorized: true };
    }

    return { minVersion: "TLSv1.2" };
}

function missingEnv() {
    return ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"].filter(function (key) {
        return !process.env[key];
    });
}

function getPool() {
    const missing = missingEnv();
    if (missing.length) {
        throw new Error("Missing environment variables: " + missing.join(", ") + ". Copy .env.example to .env.");
    }

    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT || 4000),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: sslConfig(),
            waitForConnections: true,
            connectionLimit: 4,
            decimalNumbers: true,
            timezone: "Z"
        });
    }
    return pool;
}

module.exports = { getPool, sslConfig };
