// GET  /api/categories -> every shelf with its item count.
// POST /api/categories { action: "rename", from, to } -> rename, merging when
//      the target already exists.
// POST /api/categories { action: "clear", from } -> move the shelf's items to
//      Uncategorized.
// Admin only, like the rest of the inventory.
"use strict";

const { getPool } = require("./_lib/db");
const { requireAdmin } = require("./_lib/auth");
const { send, readBody, serverError } = require("./_lib/util");

const MAX_NAME = 80;
const UNCATEGORIZED = "Uncategorized";

async function listCategories(res) {
    const [rows] = await getPool().query(
        "SELECT category AS name, COUNT(*) AS total FROM products GROUP BY category ORDER BY category ASC"
    );
    send(res, 200, {
        categories: rows.map(function (row) {
            return { name: String(row.name || UNCATEGORIZED), count: Number(row.total) };
        })
    });
}

async function updateCategories(req, res) {
    const body = readBody(req);
    const action = String(body.action || "").trim().toLowerCase();
    const from = String(body.from || "").trim();

    if (!from) return send(res, 400, { error: "Choose a category first." });
    if (from.length > MAX_NAME) return send(res, 400, { error: "Category names are limited to " + MAX_NAME + " characters." });

    if (action === "rename") {
        const to = String(body.to || "").trim();
        if (!to) return send(res, 400, { error: "Enter the new category name." });
        if (to.length > MAX_NAME) return send(res, 400, { error: "Category names are limited to " + MAX_NAME + " characters." });

        if (to === from) return send(res, 200, { moved: 0, category: from });

        const [result] = await getPool().query(
            "UPDATE products SET category = ? WHERE category = ?",
            [to, from]
        );
        return send(res, 200, { moved: Number(result.affectedRows) || 0, category: to });
    }

    if (action === "clear") {
        if (from === UNCATEGORIZED) return send(res, 200, { moved: 0, category: UNCATEGORIZED });

        const [result] = await getPool().query(
            "UPDATE products SET category = ? WHERE category = ?",
            [UNCATEGORIZED, from]
        );
        return send(res, 200, { moved: Number(result.affectedRows) || 0, category: UNCATEGORIZED });
    }

    return send(res, 400, { error: "Action must be rename or clear." });
}

module.exports = async function handler(req, res) {
    try {
        const session = requireAdmin(req, res);
        if (!session) return;

        if (req.method === "GET") return await listCategories(res);
        if (req.method === "POST") return await updateCategories(req, res);

        return send(res, 405, { error: "Method not allowed." });
    } catch (err) {
        return serverError(res, err);
    }
};
