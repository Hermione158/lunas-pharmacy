// POST /api/logout -> clears the session cookie.
"use strict";

const { clearSessionCookie } = require("./_lib/auth");
const { send, serverError } = require("./_lib/util");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return send(res, 405, { error: "Method not allowed." });
    }

    try {
        clearSessionCookie(res);
        return send(res, 200, { ok: true });
    } catch (err) {
        return serverError(res, err);
    }
};
