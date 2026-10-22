// GET /api/movements?limit=100 -> newest stock changes first (admin only)
"use strict";

const { getPool } = require("./_lib/db");
const { requireAdmin } = require("./_lib/auth");
const { send, serverError } = require("./_lib/util");
const { isMissingTable } = require("./_lib/movements");

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseLimit(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
}

async function listMovements(req, res) {
    const limit = parseLimit(req.query && req.query.limit);
    const [rows] = await getPool().query(
        "SELECT id, product_id, product_name, delta, type, recorded_by, created_at " +
        "FROM stock_movements ORDER BY id DESC LIMIT ?",
        [limit]
    );
    send(res, 200, {
        movements: rows.map(function (row) {
            return {
                id: row.id,
                product_id: row.product_id,
                product_name: row.product_name,
                delta: Number(row.delta) || 0,
                type: row.type,
                recorded_by: row.recorded_by,
                created_at: new Date(row.created_at).toISOString()
            };
        })
    });
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== "GET") return send(res, 405, { error: "Method not allowed." });
        if (!requireAdmin(req, res)) return;
        return await listMovements(req, res);
    } catch (err) {
        // Before the SQL migration runs there is no history to read: show an
        // empty log instead of an error the owner cannot act on.
        if (isMissingTable(err)) return send(res, 200, { movements: [] });
        return serverError(res, err);
    }
};
