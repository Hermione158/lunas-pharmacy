// One-off migration: adds the barcode column the register's scanner needs.
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
        const [before] = await conn.query("SHOW COLUMNS FROM products LIKE 'barcode'");
        if (before.length) {
            console.log("barcode already exists - nothing to do.");
        } else {
            // TiDB cannot add a UNIQUE column in one ALTER, so the column and the
            // index are separate statements.
            await conn.query("ALTER TABLE products ADD COLUMN barcode VARCHAR(64) NULL AFTER name");
            console.log("barcode column added to products.");
        }

        const [index] = await conn.query("SHOW INDEX FROM products WHERE Key_name = 'uq_products_barcode'");
        if (index.length) {
            console.log("barcode unique index already exists - nothing to do.");
        } else {
            await conn.query("CREATE UNIQUE INDEX uq_products_barcode ON products (barcode)");
            console.log("barcode unique index added.");
        }

        const [after] = await conn.query("SHOW COLUMNS FROM products");
        console.log("products columns now:");
        for (const c of after) console.log("  " + c.Field + " " + c.Type + (c.Null === "YES" ? "" : " NOT NULL") + " default " + c.Default);

        const [rows] = await conn.query("SELECT COUNT(*) AS total, COUNT(barcode) AS with_barcode FROM products");
        console.log("products: " + rows[0].total + " (with barcode " + rows[0].with_barcode + ")");
    } finally {
        conn.release();
        await pool.end();
    }
}

main().catch(function (err) {
    console.error("migration failed:", err.message);
    process.exit(1);
});
