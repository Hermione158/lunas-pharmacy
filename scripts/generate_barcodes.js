// One-off: gives every medicine an in-store EAN-13 barcode.
// The "20" prefix is the range GS1 reserves for codes a store makes itself, and
// the check digit makes the number valid for every scanner and phone app.
// Run once. Safe to run twice - products that already have a barcode are skipped.
"use strict";

const mysql = require("mysql2/promise");
const { sslConfig } = require("../server/_lib/db");
const loadEnv = require("../server/_lib/loadEnv");

// EAN-13 check digit for the first 12 digits of a code.
function checkDigit(base12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        const digit = Number(base12.charAt(i));
        sum += i % 2 === 0 ? digit : digit * 3;
    }
    return (10 - (sum % 10)) % 10;
}

// Deterministic in-store code: "20" + product id padded to 10 digits + check.
function ean13ForId(id) {
    const base = "20" + String(id).padStart(10, "0");
    return base + checkDigit(base);
}

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
        const [columns] = await conn.query("SHOW COLUMNS FROM products LIKE 'barcode'");
        if (!columns.length) {
            console.error("The barcode column does not exist yet. Run scripts/add_barcode.js first.");
            process.exit(1);
        }

        const [rows] = await conn.query("SELECT id, name, barcode FROM products ORDER BY id");
        const existing = new Set(rows.filter(function (r) { return r.barcode; }).map(function (r) { return r.barcode; }));

        let assigned = 0;
        let skipped = 0;

        for (const row of rows) {
            if (row.barcode) {
                skipped++;
                continue;
            }

            const code = ean13ForId(Number(row.id));
            if (existing.has(code)) {
                throw new Error("Generated code " + code + " for \"" + row.name + "\" is already used by another item.");
            }

            await conn.query("UPDATE products SET barcode = ? WHERE id = ?", [code, row.id]);
            existing.add(code);
            assigned++;
        }

        console.log("barcodes assigned: " + assigned + ", already present: " + skipped);
        const [sample] = await conn.query("SELECT id, name, barcode FROM products ORDER BY id LIMIT 5");
        for (const row of sample) console.log("  " + row.barcode + "  " + row.name);

        const [counts] = await conn.query("SELECT COUNT(*) AS total, COUNT(barcode) AS with_barcode FROM products");
        console.log("products: " + counts[0].total + " (with barcode " + counts[0].with_barcode + ")");
    } finally {
        conn.release();
        await pool.end();
    }
}

module.exports = { checkDigit, ean13ForId };

if (require.main === module) {
    main().catch(function (err) {
        console.error("generation failed:", err.message);
        process.exit(1);
    });
}
