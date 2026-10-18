// POST /api/sales  -> checkout: records the sale and deducts stock in one SQL transaction.
// GET  /api/sales?range=today|week|month|all&from=<ISO> -> sales summary + transaction list.
"use strict";

const { getPool } = require("./_lib/db");
const { requireAuth, requireAdmin } = require("./_lib/auth");
const { send, readBody, serverError, round2, txNo } = require("./_lib/util");

const RANGES = ["today", "week", "month", "all"];

function parseRange(req) {
    const range = RANGES.includes(String(req.query.range).toLowerCase())
        ? String(req.query.range).toLowerCase()
        : "today";

    if (range === "all") return { range: range, from: null };

    const raw = req.query.from;
    const from = raw ? new Date(String(raw)) : null;
    if (from && !isNaN(from.getTime())) return { range: range, from: from };

    // Fallback when the client sends nothing: start of today (UTC).
    const now = new Date();
    return { range: range, from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) };
}

async function listSales(req, res) {
    const { range, from } = parseRange(req);
    const pool = getPool();
    const where = from ? "WHERE s.created_at >= ?" : "";
    const params = from ? [from] : [];

    const [[totals]] = await pool.query(
        "SELECT COALESCE(SUM(s.gross), 0) AS gross, COALESCE(SUM(s.discount), 0) AS discount, " +
        "COALESCE(SUM(s.net), 0) AS net, COUNT(*) AS transactions FROM sales s " + where,
        params
    );

    const [[units]] = await pool.query(
        "SELECT COALESCE(SUM(si.qty), 0) AS units FROM sale_items si " +
        "JOIN sales s ON s.id = si.sale_id " + where,
        params
    );

    const [top] = await pool.query(
        "SELECT p.id, p.name, SUM(si.qty) AS qty, SUM(si.total) AS revenue FROM sale_items si " +
        "JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id " + where +
        " GROUP BY p.id, p.name ORDER BY qty DESC, revenue DESC LIMIT 10",
        params
    );

    const [rows] = await pool.query(
        "SELECT s.id, s.gross, s.discount, s.net, s.discount_pct, s.created_at, u.username, " +
        "(SELECT COALESCE(SUM(si.qty), 0) FROM sale_items si WHERE si.sale_id = s.id) AS units " +
        "FROM sales s JOIN users u ON u.id = s.user_id " + where + " ORDER BY s.id DESC LIMIT 200",
        params
    );

    const net = round2(Number(totals.net));
    const transactions = Number(totals.transactions);

    send(res, 200, {
        range: range,
        gross: round2(Number(totals.gross)),
        discount: round2(Number(totals.discount)),
        net: net,
        transactions: transactions,
        units: Number(units.units),
        average: transactions ? round2(net / transactions) : 0,
        top: top.map(function (r) {
            return { id: r.id, name: r.name, qty: Number(r.qty), revenue: round2(Number(r.revenue)) };
        }),
        sales: rows.map(function (r) {
            return {
                id: r.id,
                txNo: txNo(r.id),
                date: new Date(r.created_at).toISOString(),
                cashier: r.username,
                units: Number(r.units),
                gross: round2(Number(r.gross)),
                discount: round2(Number(r.discount)),
                discountPct: round2(Number(r.discount_pct) || 0),
                net: round2(Number(r.net))
            };
        })
    });
}

async function createSale(req, res, session) {
    const body = readBody(req);

    const requested = (Array.isArray(body.items) ? body.items : [])
        .map(function (it) {
            return { id: Number(it.id), qty: Math.floor(Number(it.qty)) };
        })
        .filter(function (it) {
            return Number.isInteger(it.id) && it.id > 0 && Number.isInteger(it.qty) && it.qty > 0;
        });

    if (!requested.length) {
        return send(res, 400, { error: "The sale is empty. Add a product first." });
    }

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        const items = [];
        let gross = 0;

        for (const want of requested) {
            const [rows] = await conn.query(
                "SELECT id, name, price, stock FROM products WHERE id = ? FOR UPDATE",
                [want.id]
            );
            const product = rows[0];

            if (!product) {
                await conn.rollback();
                return send(res, 404, { error: "A product in the cart no longer exists." });
            }
            if (product.stock < want.qty) {
                await conn.rollback();
                return send(res, 409, {
                    error: "Not enough stock for " + product.name + " (" + product.stock + " left)."
                });
            }

            const total = round2(product.price * want.qty);
            gross += total;
            items.push({
                id: product.id,
                name: product.name,
                price: product.price,
                qty: want.qty,
                total: total
            });
        }

        gross = round2(gross);

        // The cashier enters a percentage; the peso amount is derived here so the
        // server stays the one deciding what the customer pays. An older cached
        // page can still send a flat amount, which is honoured as-is.
        let discountPct = Number(body.discountPct);
        let discount;
        if (body.discountPct === undefined || body.discountPct === null || isNaN(discountPct)) {
            discountPct = 0;
            discount = round2(Math.max(0, Number(body.discount) || 0));
        } else {
            if (discountPct < 0) discountPct = 0;
            if (discountPct > 100) discountPct = 100;
            discountPct = round2(discountPct);
            discount = round2(gross * discountPct / 100);
        }
        if (discount > gross) discount = gross;
        const net = round2(gross - discount);

        const [saleResult] = await conn.query(
            "INSERT INTO sales (user_id, gross, discount, net, discount_pct) VALUES (?, ?, ?, ?, ?)",
            [session.uid, gross, discount, net, discountPct]
        );
        const saleId = saleResult.insertId;

        for (const it of items) {
            await conn.query(
                "INSERT INTO sale_items (sale_id, product_id, qty, price, total) VALUES (?, ?, ?, ?, ?)",
                [saleId, it.id, it.qty, it.price, it.total]
            );
            await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [it.qty, it.id]);
        }

        await conn.commit();

        return send(res, 201, {
            sale: {
                id: saleId,
                txNo: txNo(saleId),
                date: new Date().toISOString(),
                cashier: session.username,
                items: items,
                gross: gross,
                discount: discount,
                discountPct: discountPct,
                net: net
            }
        });
    } catch (err) {
        try {
            await conn.rollback();
        } catch (rollbackErr) {
            // connection already closed; nothing more to do
        }
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = async function handler(req, res) {
    try {
        if (req.method === "GET") {
            if (!requireAdmin(req, res)) return;
            return await listSales(req, res);
        }
        if (req.method === "POST") {
            const session = requireAuth(req, res);
            if (!session) return;
            return await createSale(req, res, session);
        }
        return send(res, 405, { error: "Method not allowed." });
    } catch (err) {
        return serverError(res, err);
    }
};
