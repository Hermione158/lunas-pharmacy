// GET  /api/products  -> list all products (any signed-in staff)
// POST /api/products  -> create a product (admin only)
"use strict";

const { getPool } = require("./_lib/db");
const { requireAuth, requireAdmin } = require("./_lib/auth");
const { send, readBody, serverError, asMoney, asStock } = require("./_lib/util");

function productFields(body) {
    return {
        name: String(body.name || "").trim(),
        category: String(body.category || "").trim() || "Uncategorized",
        image: String(body.image || "").trim(),
        price: asMoney(body.price),
        stock: body.stock === undefined || body.stock === null || body.stock === "" ? 0 : asStock(body.stock)
    };
}

async function listProducts(res) {
    const [rows] = await getPool().query(
        "SELECT id, name, image, category, price, stock FROM products ORDER BY name ASC"
    );
    send(res, 200, { products: rows });
}

async function createProduct(req, res) {
    const data = productFields(readBody(req));

    if (!data.name) return send(res, 400, { error: "Item name is required." });
    if (data.price === null) return send(res, 400, { error: "Price must be a non-negative number." });
    if (data.stock === null) return send(res, 400, { error: "Stock must be a non-negative whole number." });

    try {
        const [result] = await getPool().query(
            "INSERT INTO products (name, image, category, price, stock) VALUES (?, ?, ?, ?, ?)",
            [data.name, data.image, data.category, data.price, data.stock]
        );
        return send(res, 201, {
            product: {
                id: result.insertId,
                name: data.name,
                image: data.image,
                category: data.category,
                price: data.price,
                stock: data.stock
            }
        });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return send(res, 409, { error: "\"" + data.name + "\" already exists in the inventory." });
        }
        throw err;
    }
}

module.exports = async function handler(req, res) {
    try {
        if (req.method === "GET") {
            if (!requireAuth(req, res)) return;
            return await listProducts(res);
        }
        if (req.method === "POST") {
            if (!requireAdmin(req, res)) return;
            return await createProduct(req, res);
        }
        return send(res, 405, { error: "Method not allowed." });
    } catch (err) {
        return serverError(res, err);
    }
};
