// PUT /api/users/:id { status } -> archive or restore an account (admin only)
// Guards: you cannot archive the account you are signed in with, and the last
// active administrator must remain.
"use strict";

const { getPool } = require("../_lib/db");
const { requireAdmin } = require("../_lib/auth");
const { send, readBody, serverError } = require("../_lib/util");

const STATUSES = ["active", "archived"];

function parseId(req) {
    const id = Number(req.query.id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function updateUser(req, res, session) {
    const id = parseId(req);
    if (!id) return send(res, 400, { error: "Invalid account id." });

    const body = readBody(req);
    const status = String(body.status || "").trim();
    if (!STATUSES.includes(status)) {
        return send(res, 400, { error: "Status must be active or archived." });
    }

    const [rows] = await getPool().query(
        "SELECT id, username, role, status FROM users WHERE id = ? LIMIT 1",
        [id]
    );
    const user = rows[0];
    if (!user) return send(res, 404, { error: "Account not found." });

    const current = user.status || "active";

    if (status === "archived" && current !== "archived") {
        if (id === session.uid) {
            return send(res, 400, { error: "You cannot archive the account you are signed in with." });
        }

        if (user.role === "admin") {
            const [[count]] = await getPool().query(
                "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'"
            );
            if (Number(count.total) <= 1) {
                return send(res, 400, { error: "This is the only active administrator account. Create or restore another one first." });
            }
        }
    }

    if (status !== current) {
        await getPool().query("UPDATE users SET status = ? WHERE id = ?", [status, id]);
    }

    return send(res, 200, {
        user: { id: user.id, username: user.username, role: user.role, status: status }
    });
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== "PUT") {
            return send(res, 405, { error: "Method not allowed." });
        }
        const session = requireAdmin(req, res);
        if (!session) return;
        return await updateUser(req, res, session);
    } catch (err) {
        return serverError(res, err);
    }
};
