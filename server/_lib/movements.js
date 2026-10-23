// Journal of stock changes: one row per added item or adjusted quantity.
"use strict";

function isMissingTable(err) {
    return err && (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146);
}

// `db` is either the pool or a connection inside a transaction.
// The product and staff names are not copied here: they are read through
// product_id and user_id when the log is displayed.
async function recordMovement(db, entry) {
    try {
        await db.query(
            "INSERT INTO stock_movements (product_id, user_id, delta, type) VALUES (?, ?, ?, ?)",
            [
                entry.productId === undefined ? null : entry.productId,
                entry.userId === undefined ? null : entry.userId,
                Number(entry.delta) || 0,
                String(entry.type || "adjust")
            ]
        );
    } catch (err) {
        // Deployments made before the table was created keep working.
        if (!isMissingTable(err)) throw err;
    }
}

module.exports = { isMissingTable, recordMovement };
