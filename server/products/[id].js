// PUT    /api/products/:id -> update a product (admin only)
// DELETE /api/products/:id -> remove a product (admin only)
"use strict";

const { getPool } = require("../_lib/db");
const { requireAdmin } = require("../_lib/auth");
const { guardImmutableFields } = require("../_lib/lock");
const { recordMovement } = require("../_lib/movements");
const { send, readBody, serverError, asMoney, asStock, asBarcode, asImage, duplicateError } = require("../_lib/util");

function parseId(req) {
    const id = Number(req.query.id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function findProduct(id) {
    try {
        const [rows] = await getPool().query(
            "SELECT id, name, barcode, image, category, price, stock, status FROM products WHERE id = ? LIMIT 1",
            [id]
        );
        return rows[0] || null;
    } catch (err) {
        if (!err || (err.errno !== 1054 && err.code !== "ER_BAD_FIELD_ERROR")) throw err;
        const [rows] = await getPool().query(
            "SELECT id, name, barcode, image, category, price, stock FROM products WHERE id = ? LIMIT 1",
            [id]
        );
        return rows[0] || null;
    }
}

const STATUSES = ["active", "archived"];

async function updateProduct(req, res, id, session) {
    const existing = await findProduct(id);
    if (!existing) return send(res, 404, { error: "Item not found." });

    const body = readBody(req);
    const image = body.image === undefined ? null : asImage(body.image);
    const next = {
        name: body.name === undefined ? existing.name : String(body.name).trim(),
        barcode: body.barcode === undefined ? existing.barcode : asBarcode(body.barcode),
        category: body.category === undefined ? existing.category : String(body.category).trim() || existing.category,
        image: body.image === undefined ? existing.image : (image === null ? existing.image : image),
        price: body.price === undefined ? existing.price : asMoney(body.price),
        stock: body.stock === undefined ? existing.stock : asStock(body.stock),
        status: body.status === undefined ? (existing.status || "active") : String(body.status)
    };

    if (body.image !== undefined && image === null) {
        return send(res, 400, { error: "Attach a PNG, JPG, WEBP or GIF picture under 500 KB." });
    }

    if (!next.name) return send(res, 400, { error: "Item name is required." });
    if (next.price === null) return send(res, 400, { error: "Price must be a non-negative number." });
    if (next.stock === null) return send(res, 400, { error: "Stock must be a non-negative whole number." });
    if (!STATUSES.includes(next.status)) {
        return send(res, 400, { error: "Status must be active or archived." });
    }

    const locked = guardImmutableFields(existing, next);
    if (locked) return send(res, 400, { error: locked });

    const delta = Number(next.stock) - Number(existing.stock);
    const statusChanged = body.status !== undefined && next.status !== (existing.status || "active");
    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();
        if (body.status === undefined) {
            await connection.query(
                "UPDATE products SET name = ?, barcode = ?, category = ?, image = ?, price = ?, stock = ? WHERE id = ?",
                [next.name, next.barcode, next.category, next.image, next.price, next.stock, id]
            );
        } else {
            await connection.query(
                "UPDATE products SET name = ?, barcode = ?, category = ?, image = ?, price = ?, stock = ?, status = ? WHERE id = ?",
                [next.name, next.barcode, next.category, next.image, next.price, next.stock, next.status, id]
            );
        }
        if (statusChanged) {
            await recordMovement(connection, {
                productId: id,
                name: next.name,
                delta: 0,
                type: next.status === "archived" ? "archive" : "restore",
                user: session.username
            });
        }
        if (delta !== 0) {
            await recordMovement(connection, {
                productId: id,
                name: next.name,
                delta: delta,
                type: delta > 0 ? "restock" : "adjust",
                user: session.username
            });
        }
        await connection.commit();
        return send(res, 200, { product: { id: id, ...next } });
    } catch (err) {
        try { await connection.rollback(); } catch (e) { /* connection already gone */ }
        if (err.code === "ER_DUP_ENTRY") {
            return send(res, 409, { error: duplicateError(err, next.name) });
        }
        throw err;
    } finally {
        connection.release();
    }
}

async function deleteProduct(res, id) {
    const existing = await findProduct(id);
    if (!existing) return send(res, 404, { error: "Item not found." });

    try {
        await getPool().query("DELETE FROM products WHERE id = ?", [id]);
        return send(res, 200, { ok: true, id: id });
    } catch (err) {
        if (err.errno === 1451 || err.code === "ER_ROW_IS_REFERENCED_2") {
            return send(res, 409, { error: "\"" + existing.name + "\" has sales history and cannot be deleted." });
        }
        throw err;
    }
}

module.exports = async function handler(req, res) {
    try {
        const session = requireAdmin(req, res);
        if (!session) return;

        const id = parseId(req);
        if (!id) return send(res, 400, { error: "Invalid item id." });

        if (req.method === "PUT") return await updateProduct(req, res, id, session);
        if (req.method === "DELETE") return await deleteProduct(res, id);
        return send(res, 405, { error: "Method not allowed." });
    } catch (err) {
        return serverError(res, err);
    }
};
