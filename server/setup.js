// First-run setup: lets the very first administrator be created in the browser.
// GET  /api/setup -> { available: true } only while the users table is empty
// POST /api/setup { username, password, confirm } -> creates the first admin
//
// Once any user exists this endpoint refuses to do anything else.
"use strict";

const bcrypt = require("bcryptjs");
const { getPool } = require("./_lib/db");
const { send, readBody, serverError } = require("./_lib/util");

const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;

async function isAvailable() {
    const [[row]] = await getPool().query("SELECT COUNT(*) AS total FROM users");
    return Number(row.total) === 0;
}

module.exports = async function handler(req, res) {
    try {
        if (req.method === "GET") {
            return send(res, 200, { available: await isAvailable() });
        }

        if (req.method === "POST") {
            if (!(await isAvailable())) {
                return send(res, 403, { error: "Setup already completed. Sign in with an existing account." });
            }

            const body = readBody(req);
            const username = String(body.username || "").trim();
            const password = String(body.password || "");

            if (username.length < MIN_USERNAME) {
                return send(res, 400, { error: "Username must be at least " + MIN_USERNAME + " characters." });
            }
            if (password.length < MIN_PASSWORD) {
                return send(res, 400, { error: "Password must be at least " + MIN_PASSWORD + " characters." });
            }
            if (body.confirm !== undefined && String(body.confirm) !== password) {
                return send(res, 400, { error: "Passwords do not match." });
            }

            const hash = await bcrypt.hash(password, 10);

            try {
                const [result] = await getPool().query(
                    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
                    [username, hash]
                );
                return send(res, 201, { user: { id: result.insertId, username: username, role: "admin" } });
            } catch (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return send(res, 409, { error: "\"" + username + "\" already exists." });
                }
                throw err;
            }
        }

        return send(res, 405, { error: "Method not allowed." });
    } catch (err) {
        return serverError(res, err);
    }
};