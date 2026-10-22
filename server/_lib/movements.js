// Journal of stock changes: one row per added item or adjusted quantity.
"use strict";

function isMissingTable(err) {
    return err && (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146);
}

// `db` is either the pool or a connection inside a transaction.
async function recordMovement(db, entry) {
    try {
        await db.query(
            "INSERT INTO stock_movements (product_id, product_name, delta, type, recorded_by) VALUES (?, ?, ?, ?, ?)",
            [
                entry.productId === undefined ? null : entry.productId,
                String(entry.name || "").slice(0, 120),
                Number(entry.delta) || 0,
                String(entry.type || "adjust"),
                String(entry.user || "unknown").slice(0, 64)
            ]
        );
    } catch (err) {
        // Deployments made before the table was created keep working.
        if (!isMissingTable(err)) throw err;
    }
}

module.exports = { recordMovement };
