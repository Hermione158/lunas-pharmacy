// Optional: seeds the database with the pharmacy's product list (from
// assets/js/products.js). Everything is inserted with stock 0, so nothing can be
// sold until you record real stock yourself from the Add Stock screen.
// Items already in the database are left untouched.
//
// Accounts are NOT created here: open setup.html in the browser to create the first
// administrator, then add the rest of the accounts from the Accounts page.
//
// Usage:
//   1. Copy .env.example to .env in the project root and fill in your TiDB credentials
//   2. node scripts/seed.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const mysql = require("mysql2/promise");
const { sslConfig } = require("../server/_lib/db");
const loadEnv = require("../server/_lib/loadEnv");

function loadSeedProducts() {
    const file = path.join(__dirname, "..", "assets", "js", "products.js");
    const code = fs.readFileSync(file, "utf8");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return sandbox.window.LUNA_PRODUCTS || [];
}

async function main() {
    loadEnv();

    const missing = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"].filter(function (key) {
        return !process.env[key];
    });
    if (missing.length) {
        console.error("Missing environment variables: " + missing.join(", "));
        console.error("Copy .env.example to .env in the project root and fill in your TiDB Cloud credentials first.");
        process.exit(1);
    }

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 4000),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: sslConfig(),
        decimalNumbers: true,
        timezone: "Z"
    });

    console.log("Connected to " + process.env.DB_HOST + "/" + process.env.DB_NAME);

    const [[users]] = await conn.query("SELECT COUNT(*) AS total FROM users");
    if (Number(users.total) === 0) {
        console.log("No accounts yet. Open setup.html in the browser to create the first administrator.");
    } else {
        console.log("Accounts already exist (" + users.total + "). Open the Accounts page to manage them.");
    }

    const products = loadSeedProducts();
    let inserted = 0;

    for (const p of products) {
        const [result] = await conn.query(
            "INSERT INTO products (name, image, category, price, stock) VALUES (?, ?, ?, ?, ?) " +
            "ON DUPLICATE KEY UPDATE name = name",
            [p.n, p.i || "", p.c || "Uncategorized", Number(p.p) || 0, 0]
        );
        if (result.affectedRows === 1) inserted++;
    }

    const [[count]] = await conn.query("SELECT COUNT(*) AS total FROM products");
    console.log("Products inserted: " + inserted + " (skipped existing: " + (products.length - inserted) + ")");
    console.log("Total products in database: " + count.total);
    console.log("All imported items start at 0 stock. Add your real stock from the Add Stock screen.");

    await conn.end();
    console.log("Seed complete.");
}

main().catch(function (err) {
    console.error("Seed failed: " + err.message);
    process.exit(1);
});