// GET  /api/users -> list accounts (admin only, never returns password hashes)
// POST /api/users -> create an account (admin only)
"use strict";

const bcrypt = require("bcryptjs");
const { getPool } = require("./_lib/db");
const { requireAdmin } = require("./_lib/auth");
const { send, readBody, serverError } = require("./_lib/util");

const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;
const ROLES = ["admin", "cashier"];

async function listUsers(res) {
    let rows;
    try {
        const [found] = await getPool().query(
            "SELECT id, username, role, created_at, status FROM users ORDER BY role ASC, username ASC"
        );
        rows = found;
    } catch (err) {
        // Deployments made before the status column was added keep listing.
        if (!err || (err.errno !== 1054 && err.code !== "ER_BAD_FIELD_ERROR")) throw err;
        const [found] = await getPool().query(
            "SELECT id, username, role, created_at FROM users ORDER BY role ASC, username ASC"
        );
        rows = found;
    }

    send(res, 200, {
        users: rows.map(function (u) {
            return {
                id: u.id,
                username: u.username,
                role: u.role,
                status: u.status || "active",
                created_at: new Date(u.created_at).toISOString()
            };
        })
    });
}

async function createUser(req, res) {
    const body = readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const role = String(body.role || "cashier").trim();

    if (username.length < MIN_USERNAME) {
        return send(res, 400, { error: "Username must be at least " + MIN_USERNAME + " characters." });
    }
    if (password.length < MIN_PASSWORD) {
        return send(res, 400, { error: "Password must be at least " + MIN_PASSWORD + " characters." });
    }
    if (!ROLES.includes(role)) {
        return send(res, 400, { error: "Role must be administrator or cashier." });
    }

    const hash = await bcrypt.hash(password, 10);

    try {
        const [result] = await getPool().query(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            [username, hash, role]
        );
        return send(res, 201, { user: { id: result.insertId, username: username, role: role } });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return send(res, 409, { error: "\"" + username + "\" already has an account." });
        }
        throw err;
    }
}

module.exports = async function handler(req, res) {
    try {
        if (!requireAdmin(req, res)) return;

        if (req.method === "GET") return await listUsers(res);
        if (req.method === "POST") return await createUser(req, res);
        return send(res, 405, { error: "Method not allowed." });
    } catch (err) {
        return serverError(res, err);
    }
};