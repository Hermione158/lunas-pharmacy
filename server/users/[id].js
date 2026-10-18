// DELETE /api/users/:id -> remove an account (admin only)
// Guards: you cannot delete your own account, and the last administrator must remain.
"use strict";

const { getPool } = require("../_lib/db");
const { requireAdmin } = require("../_lib/auth");
const { send, serverError } = require("../_lib/util");

function parseId(req) {
    const id = Number(req.query.id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function deleteUser(req, res, session) {
    const id = parseId(req);
    if (!id) return send(res, 400, { error: "Invalid account id." });

    if (id === session.uid) {
        return send(res, 400, { error: "You cannot delete the account you are signed in with." });
    }

    const [rows] = await getPool().query("SELECT id, username, role FROM users WHERE id = ? LIMIT 1", [id]);
    const user = rows[0];
    if (!user) return send(res, 404, { error: "Account not found." });

    if (user.role === "admin") {
        const [[count]] = await getPool().query(
            "SELECT COUNT(*) AS total FROM users WHERE role = 'admin'"
        );
        if (Number(count.total) <= 1) {
            return send(res, 400, { error: "This is the only administrator account. Create another one first." });
        }
    }

    try {
        await getPool().query("DELETE FROM users WHERE id = ?", [id]);
        return send(res, 200, { ok: true, id: id });
    } catch (err) {
        if (err.errno === 1451 || err.code === "ER_ROW_IS_REFERENCED_2") {
            return send(res, 409, { error: "\"" + user.username + "\" has recorded sales and cannot be deleted." });
        }
        throw err;
    }
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== "DELETE") {
            return send(res, 405, { error: "Method not allowed." });
        }
        const session = requireAdmin(req, res);
        if (!session) return;
        return await deleteUser(req, res, session);
    } catch (err) {
        return serverError(res, err);
    }
};