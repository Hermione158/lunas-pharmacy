// One-off migration: widens products.image so a picture attached to a new item
// can be stored in the database.
//
// The pictures used to be file names like "assets/images/Biogesic.jpg", which
// fit in VARCHAR(255). An attached picture is a small image turned into a data
// URL, so the column needs room for it. MEDIUMTEXT holds 16 MB, which is far
// more than the ~500 KB the API accepts.
//
// Run once. Safe to run twice - the column is only changed when it is still
// the old narrow type.
"use strict";

const mysql = require("mysql2/promise");
const { sslConfig } = require("../server/_lib/db");
const loadEnv = require("../server/_lib/loadEnv");

async function main() {
    loadEnv();

    const missing = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"].filter(function (key) {
        return !process.env[key];
    });
    if (missing.length) {
        console.error("Missing environment variables: " + missing.join(", "));
        process.exit(1);
    }

    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 4000,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: sslConfig(),
        connectTimeout: 20000
    });

    const conn = await pool.getConnection();
    try {
        const [before] = await conn.query("SHOW COLUMNS FROM products LIKE 'image'");
        if (before.length && String(before[0].Type).toLowerCase() === "mediumtext") {
            console.log("products.image is already MEDIUMTEXT - nothing to do.");
        } else {
            await conn.query("ALTER TABLE products MODIFY COLUMN image MEDIUMTEXT NOT NULL");
            console.log("products.image widened to MEDIUMTEXT.");
        }

        const [after] = await conn.query("SHOW COLUMNS FROM products LIKE 'image'");
        console.log("products.image is now: " + after[0].Type + (after[0].Null === "YES" ? " (nullable)" : " NOT NULL"));

        const [rows] = await conn.query("SELECT COUNT(*) AS total FROM products");
        console.log("products in the table: " + rows[0].total);
    } finally {
        conn.release();
        await pool.end();
    }
}

main().catch(function (err) {
    console.error("migration failed:", err.message);
    process.exit(1);
});
