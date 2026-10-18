// One-off migration: adds the discount_pct column the percentage discount needs.
// Run once. Safe to run twice - the column is only added when it is missing.
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
        const [before] = await conn.query("SHOW COLUMNS FROM sales LIKE 'discount_pct'");
        if (before.length) {
            console.log("discount_pct already exists - nothing to do.");
        } else {
            await conn.query("ALTER TABLE sales ADD COLUMN discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER discount");
            console.log("discount_pct added to sales.");
        }

        const [after] = await conn.query("SHOW COLUMNS FROM sales");
        console.log("sales columns now:");
        for (const c of after) console.log("  " + c.Field + " " + c.Type + (c.Null === "YES" ? "" : " NOT NULL") + " default " + c.Default);

        const [rows] = await conn.query("SELECT COUNT(*) AS total, COALESCE(SUM(discount_pct), 0) AS pct FROM sales");
        console.log("existing sales: " + rows[0].total + " (discount_pct sum " + rows[0].pct + ")");
    } finally {
        conn.release();
        await pool.end();
    }
}

main().catch(function (err) {
    console.error("migration failed:", err.message);
    process.exit(1);
});