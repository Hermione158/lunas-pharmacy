// POST /api/login  { username, password } -> sets session cookie.
"use strict";

const bcrypt = require("bcryptjs");
const { getPool } = require("./_lib/db");
const { signSession, setSessionCookie } = require("./_lib/auth");
const { send, readBody, serverError } = require("./_lib/util");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return send(res, 405, { error: "Method not allowed." });
    }

    try {
        const body = readBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");

        if (!username || !password) {
            return send(res, 400, { error: "Enter your username and password." });
        }

        const [rows] = await getPool().query(
            "SELECT id, username, password_hash, role FROM users WHERE username = ? LIMIT 1",
            [username]
        );
        const user = rows[0];

        // Compare against a dummy hash when the user is unknown so the response
        // time does not reveal whether a username exists.
        const hash = user ? user.password_hash : "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
        const ok = await bcrypt.compare(password, hash);

        if (!user || !ok) {
            return send(res, 401, { error: "Incorrect username or password." });
        }

        const token = signSession(user);
        setSessionCookie(req, res, token);
        return send(res, 200, { user: { username: user.username, role: user.role } });
    } catch (err) {
        return serverError(res, err);
    }
};
