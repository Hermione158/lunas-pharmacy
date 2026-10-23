// POST /api/products/import -> load the sample medicine catalog (admin only)
// Optional helper: it only fills in names, categories and prices. Everything is
// inserted with stock 0, so nothing can be sold until stock is recorded from the
// Add Stock screen. Items that already exist are skipped, so it is safe to re-run.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { getPool } = require("../_lib/db");
const { requireAdmin } = require("../_lib/auth");
const { recordMovement } = require("../_lib/movements");
const { send, serverError, asMoney } = require("../_lib/util");

const NAME_CHUNK = 200;

// assets/js/products.js is a plain browser file (window.LUNA_PRODUCTS = [...]).
// Run it in a sandbox so it can be read from Node too, the same way the seed
// script does. The literal path keeps the file inside the deployment bundle.
const CATALOG_FILE = path.join(__dirname, "..", "..", "assets", "js", "products.js");

function loadCatalog() {
    const code = fs.readFileSync(CATALOG_FILE, "utf8");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return sandbox.window.LUNA_PRODUCTS || [];
}

function catalogRows(products) {
    const rows = [];
    const seen = new Set();

    for (const item of products) {
        const name = String((item && item.n) || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue; // the catalog file itself lists a name twice
        seen.add(key);

        rows.push([
            name,
            String((item && item.i) || ""),
            String((item && item.c) || "").trim() || "Uncategorized",
            asMoney(item && item.p) === null ? 0 : asMoney(item.p),
            0
        ]);
    }

    return rows;
}

function chunks(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

function placeholders(size) {
    return new Array(size).fill("?").join(", ");
}

async function importCatalog(req, res, session) {
    let rows;
    try {
        rows = catalogRows(loadCatalog());
    } catch (err) {
        return send(res, 503, {
            error: "The sample catalog file could not be read. Add items one by one with + Add Item."
        });
    }

    if (!rows.length) {
        return send(res, 503, { error: "The sample catalog file is empty. Add items one by one with + Add Item." });
    }

    const names = rows.map(function (row) { return row[0]; });

    // Remember which names were already in the inventory, so the log only
    // records the items this import actually created.
    const existing = new Set();
    for (const group of chunks(names, NAME_CHUNK)) {
        const [found] = await getPool().query(
            "SELECT name FROM products WHERE name IN (" + placeholders(group.length) + ")",
            group
        );
        for (const row of found) existing.add(String(row.name));
    }

    // One statement, so the import is atomic. INSERT IGNORE turns a duplicate
    // name into a warning, which makes the row count the number actually added.
    const values = rows.map(() => "(?, ?, ?, ?, ?)").join(", ");
    const params = [].concat(...rows);

    const [result] = await getPool().query(
        "INSERT IGNORE INTO products (name, image, category, price, stock) VALUES " + values,
        params
    );

    const imported = Number(result.affectedRows || 0);

    if (imported > 0) {
        for (const group of chunks(names, NAME_CHUNK)) {
            const [found] = await getPool().query(
                "SELECT id, name FROM products WHERE name IN (" + placeholders(group.length) + ")",
                group
            );
            for (const row of found) {
                if (existing.has(String(row.name))) continue;
                await recordMovement(getPool(), {
                    productId: row.id,
                    delta: 0,
                    type: "added",
                    userId: session.uid
                });
            }
        }
    }

    return send(res, 200, {
        imported,
        skipped: rows.length - imported,
        total: rows.length
    });
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });
        const session = requireAdmin(req, res);
        if (!session) return;
        return await importCatalog(req, res, session);
    } catch (err) {
        return serverError(res, err);
    }
};