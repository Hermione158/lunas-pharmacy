// GET  /api/products  -> list all products (any signed-in staff)
// POST /api/products  -> create a product (admin only)
"use strict";

const { getPool } = require("./_lib/db");
const { requireAuth, requireAdmin } = require("./_lib/auth");
const { recordMovement } = require("./_lib/movements");
const { send, readBody, serverError, asMoney, asStock, asBarcode, asImage, duplicateError } = require("./_lib/util");

function productFields(body) {
    return {
        name: String(body.name || "").trim(),
        barcode: asBarcode(body.barcode),
        category: String(body.category || "").trim() || "Uncategorized",
        image: asImage(body.image),
        price: asMoney(body.price),
        stock: body.stock === undefined || body.stock === null || body.stock === "" ? 0 : asStock(body.stock)
    };
}

async function listProducts(req, res) {
    const status = req.query && req.query.status;
    const filter = status === "active" || status === "archived";

    let rows;
    try {
        const [found] = await getPool().query(
            "SELECT id, name, barcode, image, category, price, stock, status FROM products" +
            (filter ? " WHERE status = ?" : "") + " ORDER BY name ASC",
            filter ? [status] : []
        );
        rows = found;
    } catch (err) {
        // Deployments made before the status column was added keep listing.
        if (!err || (err.errno !== 1054 && err.code !== "ER_BAD_FIELD_ERROR")) throw err;
        if (filter && status === "archived") return send(res, 200, { products: [] });
        const [found] = await getPool().query(
            "SELECT id, name, barcode, image, category, price, stock FROM products ORDER BY name ASC"
        );
        rows = found;
    }

    send(res, 200, {
        products: rows.map(function (row) {
            return Object.assign({}, row, { status: row.status || "active" });
        })
    });
}

async function createProduct(req, res, session) {
    const data = productFields(readBody(req));

    if (!data.name) return send(res, 400, { error: "Item name is required." });
    if (data.price === null) return send(res, 400, { error: "Price must be a non-negative number." });
    if (data.stock === null) return send(res, 400, { error: "Stock must be a non-negative whole number." });
    if (data.image === null) return send(res, 400, { error: "Attach a PNG, JPG, WEBP or GIF picture under 500 KB." });

    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.query(
            "INSERT INTO products (name, barcode, image, category, price, stock) VALUES (?, ?, ?, ?, ?, ?)",
            [data.name, data.barcode, data.image, data.category, data.price, data.stock]
        );
        await recordMovement(connection, {
            productId: result.insertId,
            name: data.name,
            delta: data.stock,
            type: "added",
            user: session.username
        });
        await connection.commit();
        return send(res, 201, {
            product: {
                id: result.insertId,
                name: data.name,
                barcode: data.barcode,
                image: data.image,
                category: data.category,
                price: data.price,
                stock: data.stock
            }
        });
    } catch (err) {
        try { await connection.rollback(); } catch (e) { /* connection already gone */ }
        if (err.code === "ER_DUP_ENTRY") {
            return send(res, 409, { error: duplicateError(err, data.name) });
        }
        throw err;
    } finally {
        connection.release();
    }
}

module.exports = async function handler(req, res) {
    try {
        if (req.method === "GET") {
            if (!requireAuth(req, res)) return;
            return await listProducts(req, res);
        }
        if (req.method === "POST") {
            const session = requireAdmin(req, res);
            if (!session) return;
            return await createProduct(req, res, session);
        }
        return send(res, 405, { error: "Method not allowed." });
    } catch (err) {
        return serverError(res, err);
    }
};
