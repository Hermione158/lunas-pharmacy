// POST /api/products/bulk -> save every edited row in one transaction (admin only)
//
// This is what the "Save All" button on the Update Inventory page uses. Saving
// row by row needed one HTTP request per item, which looked frozen with a full
// catalog, and a failure halfway through left the inventory half-saved. Here
// every item is validated before the first write and the whole batch either
// lands or is rolled back.
//
// The current rows are read once and compared with what was sent: a field the
// form never showed (like the image) is left alone, and rows nobody edited are
// not written back at all, so an untouched 132-item table costs one query.
"use strict";

const { getPool } = require("../_lib/db");
const { requireAdmin } = require("../_lib/auth");
const { guardImmutableFields } = require("../_lib/lock");
const { recordMovement } = require("../_lib/movements");
const { send, readBody, serverError, asMoney, asStock, asBarcode, round2 } = require("../_lib/util");

// A safety net so a runaway page cannot lock up the database.
const MAX_ITEMS = 500;
// MySQL allows far more placeholders than this; the chunk just keeps the
// generated SQL a sensible size.
const ID_CHUNK = 200;

function samePrice(a, b) {
    return round2(Number(a)) === round2(Number(b));
}

function isSame(existing, item) {
    return existing.name === item.name &&
        // An old page may not send a barcode at all - leave it untouched then.
        (item.barcode === undefined || (existing.barcode || null) === (item.barcode || null)) &&
        existing.category === item.category &&
        samePrice(existing.price, item.price) &&
        Number(existing.stock) === Number(item.stock) &&
        // The form never sends an image, so only compare it when one was given.
        (!item.image || existing.image === item.image);
}

// Same rules as products.js (create): the image is only ever set when the caller
// sends one, so saving a row can never wipe the picture on it.
function itemFields(raw) {
    const price = asMoney(raw.price);
    const stock = raw.stock === undefined || raw.stock === null || raw.stock === "" ? 0 : asStock(raw.stock);

    return {
        id: raw.id === undefined || raw.id === null || raw.id === "" ? null : Number(raw.id),
        name: String(raw.name || "").trim(),
        barcode: raw.barcode === undefined ? undefined : asBarcode(raw.barcode),
        category: String(raw.category || "").trim() || "Uncategorized",
        image: raw.image === undefined || raw.image === null ? "" : String(raw.image).trim(),
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
    const barcodes = new Map();
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

        // The same barcode twice in one batch would only fail on the last write.
        if (data.barcode) {
            if (barcodes.has(data.barcode)) {
                return { error: "Barcode " + data.barcode + " is used by both \"" + barcodes.get(data.barcode) + "\" and \"" + data.name + "\"." };
            }
            barcodes.set(data.barcode, data.name);
        }

        items.push(data);
    }

    return { items: items };
}

function chunks(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

async function saveAll(req, res, session) {
    const body = readBody(req);
    const parsed = parseItems(body.items);
    if (parsed.error) return send(res, 400, { error: parsed.error });
    const items = parsed.items;

    const connection = await getPool().getConnection();

    try {
        await connection.beginTransaction();

        // Read the rows being edited once, up front.
        const ids = items.filter(function (i) { return i.id !== null; }).map(function (i) { return i.id; });
        const existing = new Map();
        for (const group of chunks(ids, ID_CHUNK)) {
            const [rows] = await connection.query(
                "SELECT id, name, barcode, category, image, price, stock FROM products WHERE id IN (" + group.map(function () { return "?"; }).join(", ") + ")",
                group
            );
            for (const row of rows) existing.set(Number(row.id), row);
        }

        // An id that is gone (deleted in another tab) must not silently turn an
        // edit into a fresh insert.
        for (const item of items) {
            if (item.id !== null && !existing.has(item.id)) {
                await connection.rollback();
                return send(res, 400, { error: "\"" + item.name + "\" is no longer in the inventory. Refresh the page and try again." });
            }
        }

        // A saved item keeps its name and barcode (a missing barcode may still
        // be filled in). The whole batch is refused up front, so one stale row
        // cannot half-save the rest.
        for (const item of items) {
            if (item.id === null) continue;
            const locked = guardImmutableFields(existing.get(item.id), item);
            if (locked) {
                await connection.rollback();
                return send(res, 400, { error: locked });
            }
        }

        let added = 0;
        let updated = 0;
        let unchanged = 0;

        for (const item of items) {
            if (item.id === null) {
                const [inserted] = await connection.query(
                    "INSERT INTO products (name, barcode, image, category, price, stock) VALUES (?, ?, ?, ?, ?, ?)",
                    [item.name, item.barcode === undefined ? null : item.barcode, item.image, item.category, item.price, item.stock]
                );
                await recordMovement(connection, {
                    productId: inserted.insertId,
                    name: item.name,
                    delta: item.stock,
                    type: "added",
                    user: session.username
                });
                added++;
                continue;
            }

            const before = existing.get(item.id);
            if (isSame(before, item)) {
                unchanged++;
                continue;
            }

            // image stays as it is unless this batch explicitly sets one.
            const image = item.image || before.image || "";
            // barcode follows the same rule: absent means keep, "" means clear.
            const barcode = item.barcode === undefined ? (before.barcode || null) : item.barcode;
            await connection.query(
                "UPDATE products SET name = ?, barcode = ?, category = ?, image = ?, price = ?, stock = ? WHERE id = ?",
                [item.name, barcode, item.category, image, item.price, item.stock, item.id]
            );
            const delta = Number(item.stock) - Number(before.stock);
            if (delta !== 0) {
                await recordMovement(connection, {
                    productId: item.id,
                    name: item.name,
                    delta: delta,
                    type: "bulk",
                    user: session.username
                });
            }
            updated++;
        }

        await connection.commit();
        return send(res, 200, {
            saved: added + updated,
            added: added,
            updated: updated,
            unchanged: unchanged
        });
    } catch (err) {
        try { await connection.rollback(); } catch (e) { /* connection already gone */ }
        if (err.code === "ER_DUP_ENTRY") {
            if (/barcode/i.test(String(err.message || ""))) {
                return send(res, 409, { error: "That barcode is already used by another item." });
            }
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
        const session = requireAdmin(req, res);
        if (!session) return;
        return await saveAll(req, res, session);
    } catch (err) {
        return serverError(res, err);
    }
};