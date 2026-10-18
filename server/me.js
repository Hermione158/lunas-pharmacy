// GET /api/me -> the signed-in user, or 401.
"use strict";

const { getSession } = require("./_lib/auth");
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
        return send(res, 200, { user: { id: session.uid, username: session.username, role: session.role } });
    } catch (err) {
        return serverError(res, err);
    }
};
