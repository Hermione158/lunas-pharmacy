// GET /api/me -> the signed-in user, or 401.
"use strict";

const { getSession } = require("./_lib/auth");
const { getPool } = require("./_lib/db");
const { send, serverError } = require("./_lib/util");

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        return send(res, 405, { error: "Method not allowed." });
    }

    try {
        const session = getSession(req);
        if (!session) {
            return send(res, 401, { error: "Not signed in." });
        }

        let user = null;
        try {
            const [rows] = await getPool().query(
                "SELECT id, username, role, status FROM users WHERE id = ? LIMIT 1",
                [session.uid]
            );
            user = rows[0];
        } catch (err) {
            // Deployments made before the status column was added keep working.
            if (!err || (err.errno !== 1054 && err.code !== "ER_BAD_FIELD_ERROR")) throw err;
            user = { id: session.uid, username: session.username, role: session.role };
        }

        if (!user) {
            return send(res, 401, { error: "Account not found." });
        }
        if (String(user.status || "active") === "archived") {
            return send(res, 401, { error: "This account has been archived." });
        }

        return send(res, 200, { user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        return serverError(res, err);
    }
};
