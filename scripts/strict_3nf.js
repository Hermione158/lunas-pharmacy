// One-off migration: strict 3NF cleanup for sales and stock movements.
// Run once. Safe to run twice - every step checks whether it is still needed.
"use strict";

const mysql = require("mysql2/promise");
const { sslConfig } = require("../server/_lib/db");
const loadEnv = require("../server/_lib/loadEnv");

function fail(message) {
    throw new Error(message);
}

async function columns(conn, table) {
    const [rows] = await conn.query("SHOW COLUMNS FROM " + table);
    return new Set(rows.map(function (row) { return row.Field; }));
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
        console.log("Checking existing data before dropping anything...");

        let salesCols = await columns(conn, "sales");
        const movementCols = await columns(conn, "stock_movements");

        // The stored totals must agree with the line items before they are removed.
        if (salesCols.has("gross") && salesCols.has("net")) {
            const [bad] = await conn.query(
                "SELECT s.id, s.gross, COALESCE(SUM(si.qty * si.price), 0) AS calc_gross, " +
                "s.net, COALESCE(SUM(si.qty * si.price), 0) - s.discount AS calc_net " +
                "FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id " +
                "GROUP BY s.id, s.gross, s.net, s.discount " +
                "HAVING ABS(s.gross - calc_gross) > 0.01 OR ABS(s.net - calc_net) > 0.01 " +
                "LIMIT 20"
            );
            if (bad.length) {
                console.error("Aborting: these sales do not match their line items:");
                console.table(bad);
                fail("derived totals do not match");
            }
            console.log("OK: every sale's gross/net matches its sale_items.");
        }

        // 1. Stock movements: username -> user_id.
        if (!movementCols.has("user_id")) {
            await conn.query("ALTER TABLE stock_movements ADD COLUMN user_id INT NULL AFTER product_id");
            console.log("Added stock_movements.user_id.");
        } else {
            console.log("stock_movements.user_id already exists.");
        }

        if (movementCols.has("recorded_by")) {
            const [unmatched] = await conn.query(
                "SELECT m.recorded_by, COUNT(*) AS n FROM stock_movements m " +
                "LEFT JOIN users u ON u.username = m.recorded_by " +
                "WHERE u.id IS NULL GROUP BY m.recorded_by"
            );
            if (unmatched.length) {
                console.error("Aborting: these recorded_by usernames have no matching user:");
                console.table(unmatched);
                fail("unmatched stock movement usernames");
            }

            const [updated] = await conn.query(
                "UPDATE stock_movements m JOIN users u ON u.username = m.recorded_by SET m.user_id = u.id"
            );
            console.log("Backfilled user_id for " + updated.affectedRows + " stock movement(s).");
        }

        const [[nullUsers]] = await conn.query(
            "SELECT COUNT(*) AS n FROM stock_movements WHERE user_id IS NULL"
        );
        if (Number(nullUsers.n) > 0) {
            fail("stock_movements still has " + nullUsers.n + " row(s) without user_id");
        }

        const [indexes] = await conn.query(
            "SHOW INDEX FROM stock_movements WHERE Key_name = 'idx_movements_user'"
        );
        if (!indexes.length) {
            await conn.query("CREATE INDEX idx_movements_user ON stock_movements(user_id)");
            console.log("Added index idx_movements_user.");
        }

        const [fks] = await conn.query(
            "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS " +
            "WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_movements' " +
            "AND CONSTRAINT_NAME = 'fk_movements_user'"
        );
        if (!fks.length) {
            await conn.query(
                "ALTER TABLE stock_movements ADD CONSTRAINT fk_movements_user " +
                "FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL"
            );
            console.log("Added fk_movements_user.");
        }

        if (movementCols.has("recorded_by")) {
            await conn.query("ALTER TABLE stock_movements DROP COLUMN recorded_by");
            console.log("Dropped stock_movements.recorded_by.");
        }
        if (movementCols.has("product_name")) {
            await conn.query("ALTER TABLE stock_movements DROP COLUMN product_name");
            console.log("Dropped stock_movements.product_name.");
        }

        // 2. Sales: derive gross/net from sale_items instead of storing them.
        salesCols = await columns(conn, "sales");
        if (salesCols.has("gross")) {
            await conn.query("ALTER TABLE sales DROP COLUMN gross");
            console.log("Dropped sales.gross.");
        }
        if (salesCols.has("net")) {
            await conn.query("ALTER TABLE sales DROP COLUMN net");
            console.log("Dropped sales.net.");
        }

        console.log("\nFinal columns:");
        for (const table of ["sales", "stock_movements"]) {
            const [cols] = await conn.query("SHOW COLUMNS FROM " + table);
            console.log("  " + table + ": " + cols.map(function (c) { return c.Field; }).join(", "));
        }
        console.log("\nStrict 3NF migration complete.");
    } finally {
        conn.release();
        await pool.end();
    }
}

main().catch(function (err) {
    console.error("migration failed:", err.message);
    process.exit(1);
});
