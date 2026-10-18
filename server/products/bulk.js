// POST /api/products/bulk -> save every edited row in one transaction (admin only)
//
// This is what the "Save All" button on the Update Inventory page uses. Saving
// row by row needed one HTTP request per item, which looked frozen with a full
// catalog, and a failure halfway through left the inventory half-saved. Here
// every item is validated before the first write and the whole batch either
// lands or is rolled back.
"use strict";

const { getPool } = require("../_lib/db");
const { requireAdmin } = require("../_lib/auth");
const { send, readBody, serverError, asMoney, asStock } = require("../_lib/util");

// A safety net so a runaway page cannot lock up the database.
const MAX_ITEMS = 500;

// Same rules as products.js (create) and products/[id].js (update).
function itemFields(raw) {
    const price = asMoney(raw.price);
    const stock = raw.stock === undefined || raw.stock === null || raw.stock === "" ? 0 : asStock(raw.stock);

    return {
        id: raw.id === undefined || raw.id === null || raw.id === "" ? null : Number(raw.id),
        name: String(raw.name || "").trim(),
        category: String(raw.category || "").trim() || "Uncategorized",
        image: String(raw.image || "").trim(),
        price: price,
        stock: stock
    };
}

// Validates the whole batch up front so a bad row cannot leave a partial save.
function parseItems(rawItems) {
    if (!Array.isArray(rawItems)) return { error: "Send the items to save as a list." };
    if (!rawItems.length) return { error: "There is nothing to save." };
    if (rawItems.length > MAX_ITEMS) return { error: "Save at most " + MAX_ITEMS + " items at a time." };

    const items = [];
    for (let i = 0; i < rawItems.length; i++) {
        const raw = rawItems[i];
        if (!raw || typeof raw !== "object") return { error: "Item " + (i + 1) + " is not valid." };

        const data = itemFields(raw);

        if (data.id !== null && !Number.isInteger(data.id)) {
            return { error: "Item " + (i + 1) + " has an invalid id." };
        }
        if (!data.name) return { error: "Item " + (i + 1) + " is missing its name." };
        if (data.price === null) return { error: "\"" + data.name + "\": price must be a non-negative number." };
        if (data.stock === null) return { error: "\"" + data.name + "\": stock must be a non-negative whole number." };

        items.push(data);
    }

    return { items: items };
}

async function saveAll(req, res) {
    const body = readBody(req);
    const parsed = parseItems(body.items);
    if (parsed.error) return send(res, 400, { error: parsed.error });
    const items = parsed.items;

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        let added = 0;
        let updated = 0;

        for (const item of items) {
            if (item.id === null) {
                await connection.query(
                    "INSERT INTO products (name, image, category, price, stock) VALUES (?, ?, ?, ?, ?)",
                    [item.name, item.image, item.category, item.price, item.stock]
                );
                added++;
                continue;
            }

            // The id has to still exist: a row deleted in another tab must not
            // silently turn an edit into a fresh insert.
            const [rows] = await connection.query("SELECT id FROM products WHERE id = ? LIMIT 1", [item.id]);
            if (!rows[0]) {
                await connection.rollback();
                return send(res, 400, { error: "\"" + item.name + "\" is no longer in the inventory. Refresh the page and try again." });
            }

            await connection.query(
                "UPDATE products SET name = ?, category = ?, image = ?, price = ?, stock = ? WHERE id = ?",
                [item.name, item.category, item.image, item.price, item.stock, item.id]
            );
            updated++;
        }

        await connection.commit();
        return send(res, 200, { saved: items.length, added: added, updated: updated });
    } catch (err) {
        try { await connection.rollback(); } catch (e) { /* connection already gone */ }
        if (err.code === "ER_DUP_ENTRY") {
            return send(res, 409, { error: "Two items share a name. Each medicine name must be unique." });
        }
        throw err;
    } finally {
        connection.release();
    }
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });
        if (!requireAdmin(req, res)) return;
        return await saveAll(req, res);
    } catch (err) {
        return serverError(res, err);
    }
};