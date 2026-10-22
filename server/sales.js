// POST /api/sales  -> checkout: records the sale and deducts stock in one SQL transaction.
// GET  /api/sales?range=today|week|month|day|all&from=<ISO>&to=<ISO> -> sales summary + transaction list.
"use strict";

const { getPool } = require("./_lib/db");
const { requireAuth, requireAdmin } = require("./_lib/auth");
const { recordMovement } = require("./_lib/movements");
const { send, readBody, serverError, round2, txNo } = require("./_lib/util");

const RANGES = ["today", "week", "month", "day", "all"];
const DAY_MS = 24 * 60 * 60 * 1000;

function parseRange(req) {
    const range = RANGES.includes(String(req.query.range).toLowerCase())
        ? String(req.query.range).toLowerCase()
        : "today";

    if (range === "all") return { range: range, from: null, to: null };

    const raw = req.query.from;
    const parsed = raw ? new Date(String(raw)) : null;
    const valid = parsed && !isNaN(parsed.getTime());

    // Fallback when the client sends nothing: start of today (UTC).
    const now = new Date();
    const from = valid
        ? parsed
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    let to = null;
    if (range === "day") {
        const rawTo = req.query.to ? new Date(String(req.query.to)) : null;
        to = rawTo && !isNaN(rawTo.getTime()) ? rawTo : new Date(from.getTime() + DAY_MS);
    }

    return { range: range, from: from, to: to };
}

// The client tells us how far its clock is from UTC, so the buckets land on
// the shop's own day and hour instead of the server's. Minutes ahead of UTC.
function parseTz(req) {
    let minutes = Number(req.query.tz);
    if (!isFinite(minutes)) minutes = 480; // Asia/Manila
    minutes = Math.max(-720, Math.min(840, Math.round(minutes)));
    const sign = minutes < 0 ? "-" : "+";
    const abs = Math.abs(minutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return sign + hh + ":" + mm;
}

// How finely the sales are grouped: by the hour for today or a chosen day,
// by the day for a week or a month, by the month for everything.
function grainFor(range) {
    if (range === "today" || range === "day") return "hour";
    if (range === "all") return "month";
    return "day";
}

function bucketExpression(grain, tz) {
    const shifted = "CONVERT_TZ(s.created_at, '+00:00', '" + tz + "')";
    if (grain === "hour") return "HOUR(" + shifted + ")";
    if (grain === "month") return "DATE_FORMAT(" + shifted + ", '%Y-%m')";
    return "DATE_FORMAT(" + shifted + ", '%Y-%m-%d')";
}

// One row per time bucket, worked out by the database so the numbers stay
// right no matter how many millions of sales there are.
async function salesSeries(pool, grain, tz, where, params) {
    const bucket = bucketExpression(grain, tz);
    const [rows] = await pool.query(
        "SELECT " + bucket + " AS bucket, COALESCE(SUM(s.gross), 0) AS gross, " +
        "COALESCE(SUM(s.discount), 0) AS discount, COALESCE(SUM(s.net), 0) AS net, " +
        "COUNT(*) AS transactions FROM sales s " + where +
        " GROUP BY bucket ORDER BY bucket LIMIT 240",
        params
    );
    return rows.map(function (r) {
        return {
            bucket: String(r.bucket),
            gross: round2(Number(r.gross)),
            discount: round2(Number(r.discount)),
            net: round2(Number(r.net)),
            transactions: Number(r.transactions)
        };
    });
}

// How the money is split across the product categories.
async function salesByCategory(pool, where, params) {
    const [rows] = await pool.query(
        "SELECT p.category AS category, COALESCE(SUM(si.qty), 0) AS qty, " +
        "COALESCE(SUM(si.total), 0) AS revenue " +
        "FROM sale_items si JOIN sales s ON s.id = si.sale_id " +
        "JOIN products p ON p.id = si.product_id " + where +
        " GROUP BY p.category ORDER BY revenue DESC",
        params
    );
    return rows.map(function (r) {
        return {
            category: String(r.category || "Uncategorized"),
            qty: Number(r.qty),
            revenue: round2(Number(r.revenue))
        };
    });
}

// The same numbers for the window before this one, so the page can say
// whether the shop is up or down.
async function previousPeriod(pool, from, to) {
    if (!from || !to) return null;

    const where = "WHERE s.created_at >= ? AND s.created_at < ?";
    const params = [from, to];

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

    return {
        gross: round2(Number(totals.gross)),
        discount: round2(Number(totals.discount)),
        net: round2(Number(totals.net)),
        transactions: Number(totals.transactions),
        units: Number(units.units)
    };
}

// The shop's rhythm: the hours and the days that people actually shop.
// This one always looks at the whole history, because that is the pattern
// the business runs on.
async function busyPeriods(pool, tz) {
    const shifted = "CONVERT_TZ(s.created_at, '+00:00', '" + tz + "')";

    const [hours] = await pool.query(
        "SELECT HOUR(" + shifted + ") AS bucket, COALESCE(SUM(s.net), 0) AS net, " +
        "COUNT(*) AS transactions FROM sales s GROUP BY bucket ORDER BY bucket",
        []
    );

    const [weekdays] = await pool.query(
        "SELECT DAYOFWEEK(" + shifted + ") AS bucket, COALESCE(SUM(s.net), 0) AS net, " +
        "COUNT(*) AS transactions FROM sales s GROUP BY bucket ORDER BY bucket",
        []
    );

    function clean(rows) {
        return rows.map(function (r) {
            return {
                bucket: String(r.bucket),
                net: round2(Number(r.net)),
                transactions: Number(r.transactions)
            };
        });
    }

    return { byHour: clean(hours), byWeekday: clean(weekdays) };
}

// The items that did not move at all in this period.
async function deadStock(pool, where, params) {
    const inner = where ? where.replace("WHERE s.created_at", "AND s.created_at") : "";

    async function run(filter) {
        const [rows] = await pool.query(
            "SELECT p.id, p.name, p.category, p.stock FROM products p " +
            "WHERE " + filter + "NOT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id " +
            "WHERE si.product_id = p.id " + inner + ") ORDER BY p.name LIMIT 100",
            params
        );

        const [[count]] = await pool.query(
            "SELECT COUNT(*) AS total FROM products p " +
            "WHERE " + filter + "NOT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id " +
            "WHERE si.product_id = p.id " + inner + ")",
            params
        );

        return { rows: rows, count: count };
    }

    let found;
    try {
        found = await run("p.status = 'active' AND ");
    } catch (err) {
        // Deployments made before the status column was added keep reporting.
        if (!err || (err.errno !== 1054 && err.code !== "ER_BAD_FIELD_ERROR")) throw err;
        found = await run("");
    }

    return {
        total: Number(found.count.total),
        items: found.rows.map(function (r) {
            return {
                id: r.id,
                name: String(r.name),
                category: String(r.category || "Uncategorized"),
                stock: Number(r.stock)
            };
        })
    };
}

// A shelf with fewer of these on it (or less than this) is worth restocking
// even when the item sells slowly. This is the same number the product list
// calls "low stock".
const LOW_STOCK = 20;

// How fast each item is selling, next to the stock that is left. The days of
// cover are worked out on the page. Only the shelves that need attention come
// back: the ones that will empty within a month, and the ones with little
// stock left whatever their speed.
async function salesVelocity(pool) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [rows] = await pool.query(
        "SELECT * FROM (" +
        "SELECT p.id, p.name, p.category, p.stock, " +
        "COALESCE(SUM(CASE WHEN s.id IS NOT NULL THEN si.qty ELSE 0 END), 0) AS sold30, " +
        "COALESCE(SUM(CASE WHEN s.id IS NOT NULL AND s.created_at >= ? THEN si.qty ELSE 0 END), 0) AS sold7 " +
        "FROM products p LEFT JOIN sale_items si ON si.product_id = p.id " +
        "LEFT JOIN sales s ON s.id = si.sale_id AND s.created_at >= ? " +
        "GROUP BY p.id, p.name, p.category, p.stock" +
        ") t WHERE t.stock < ? OR " +
        "(GREATEST(t.sold30 / 30.0, t.sold7 / 7.0) > 0 AND t.stock / GREATEST(t.sold30 / 30.0, t.sold7 / 7.0) < 31) " +
        "ORDER BY CASE WHEN GREATEST(t.sold30 / 30.0, t.sold7 / 7.0) > 0 " +
        "THEN t.stock / GREATEST(t.sold30 / 30.0, t.sold7 / 7.0) ELSE 999999 END, t.stock ASC " +
        "LIMIT 200",
        [week, since, LOW_STOCK]
    );

    return rows.map(function (r) {
        return {
            id: r.id,
            name: String(r.name),
            category: String(r.category || "Uncategorized"),
            stock: Number(r.stock),
            sold30: Number(r.sold30),
            sold7: Number(r.sold7)
        };
    });
}

async function listSales(req, res) {
    const { range, from, to } = parseRange(req);
    const tz = parseTz(req);
    const grain = grainFor(range);
    const pool = getPool();
    const where = from
        ? "WHERE s.created_at >= ?" + (to ? " AND s.created_at < ?" : "")
        : "";
    const params = from ? (to ? [from, to] : [from]) : [];

    const [[totals]] = await pool.query(
        "SELECT COALESCE(SUM(s.gross), 0) AS gross, COALESCE(SUM(s.discount), 0) AS discount, " +
        "COALESCE(SUM(s.net), 0) AS net, COUNT(*) AS transactions, " +
        "COALESCE(SUM(CASE WHEN s.discount > 0 THEN 1 ELSE 0 END), 0) AS discounted " +
        "FROM sales s " + where,
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

    // What each receipt was for, so the report can name every item that was
    // bought. This is an extra like the analysis below: a failure here leaves
    // the names empty but never takes the transaction list down.
    try {
        if (rows.length) {
            const ids = rows.map(function (r) { return r.id; });
            const [itemRows] = await pool.query(
                "SELECT si.sale_id, si.qty, p.name FROM sale_items si JOIN products p ON p.id = si.product_id " +
                "WHERE si.sale_id IN (" + ids.map(function () { return "?"; }).join(", ") + ") ORDER BY si.id",
                ids
            );
            const bySale = {};
            itemRows.forEach(function (r) {
                const list = bySale[r.sale_id] || (bySale[r.sale_id] = []);
                list.push({ name: String(r.name), qty: Number(r.qty) });
            });
            rows.forEach(function (r) { r.items = bySale[r.id] || []; });
        }
    } catch (err) {
        // The list still goes out; the item cells simply read empty.
    }

    // The extra analysis. Each one is on its own, so a failure in one of
    // them never takes the whole report down with it.
    let series = [];
    let categories = [];
    let previous = null;
    let discounted = Number(totals.discounted) || 0;
    let busy = { byHour: [], byWeekday: [] };
    let dead = { total: 0, items: [] };
    let velocity = [];

    try { series = await salesSeries(pool, grain, tz, where, params); } catch (err) { series = []; }
    try { categories = await salesByCategory(pool, where, params); } catch (err) { categories = []; }

    try {
        const prevFrom = req.query.prevFrom ? new Date(String(req.query.prevFrom)) : null;
        const prevTo = req.query.prevTo ? new Date(String(req.query.prevTo)) : null;
        if (prevFrom && prevTo && !isNaN(prevFrom.getTime()) && !isNaN(prevTo.getTime())) {
            previous = await previousPeriod(pool, prevFrom, prevTo);
        }
    } catch (err) { previous = null; }

    try { busy = await busyPeriods(pool, tz); } catch (err) { busy = { byHour: [], byWeekday: [] }; }
    try { dead = await deadStock(pool, where, params); } catch (err) { dead = { total: 0, items: [] }; }
    try { velocity = await salesVelocity(pool); } catch (err) { velocity = []; }

    const net = round2(Number(totals.net));
    const transactions = Number(totals.transactions);

    send(res, 200, {
        range: range,
        grain: grain,
        gross: round2(Number(totals.gross)),
        discount: round2(Number(totals.discount)),
        net: net,
        transactions: transactions,
        units: Number(units.units),
        average: transactions ? round2(net / transactions) : 0,
        discounted: discounted,
        previous: previous,
        busy: busy,
        dead: dead,
        velocity: velocity,
        series: series,
        categories: categories,
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
                items: r.items || [],
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
            if (discount > round2(gross * 0.20)) discount = round2(gross * 0.20);
        } else {
            if (discountPct < 0) discountPct = 0;
            if (discountPct > 20) discountPct = 20;
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
            await recordMovement(conn, {
                productId: it.id,
                name: it.name,
                delta: -it.qty,
                type: "sale",
                user: session.username
            });
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
