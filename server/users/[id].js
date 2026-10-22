// PUT /api/users/:id -> update an account (admin only).
//
// Accepts any subset of: username, role, password, status. Archiving keeps the
// account's history; there is no delete. Guards: you cannot archive the account
// you are signed in with, and the last active administrator must remain.
"use strict";

const bcrypt = require("bcryptjs");
const { getPool } = require("../_lib/db");
const { requireAdmin } = require("../_lib/auth");
const { send, readBody, serverError } = require("../_lib/util");

const STATUSES = ["active", "archived"];
const ROLES = ["admin", "cashier"];
const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;

function parseId(req) {
    const id = Number(req.query.id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function updateUser(req, res, session) {
    const id = parseId(req);
    if (!id) return send(res, 400, { error: "Invalid account id." });

    const body = readBody(req);

    const [rows] = await getPool().query(
        "SELECT id, username, role, status FROM users WHERE id = ? LIMIT 1",
        [id]
    );
    const user = rows[0];
    if (!user) return send(res, 404, { error: "Account not found." });

    const currentStatus = user.status || "active";

    const updates = [];
    const params = [];

    // username
    if (body.username !== undefined) {
        const username = String(body.username || "").trim();
        if (username.length < MIN_USERNAME) {
            return send(res, 400, { error: "Username must be at least " + MIN_USERNAME + " characters." });
        }
        const [existing] = await getPool().query(
            "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
            [username, id]
        );
        if (existing.length) {
            return send(res, 409, { error: "\"" + username + "\" already has an account." });
        }
        updates.push("username = ?");
        params.push(username);
    }

    // role
    if (body.role !== undefined) {
        const role = String(body.role || "").trim();
        if (!ROLES.includes(role)) {
            return send(res, 400, { error: "Role must be administrator or cashier." });
        }
        if (user.role === "admin" && role !== "admin") {
            const [[count]] = await getPool().query(
                "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'"
            );
            if (Number(count.total) <= 1) {
                return send(res, 400, { error: "This is the only active administrator account. Create or restore another one first." });
            }
        }
        updates.push("role = ?");
        params.push(role);
    }

    // password
    if (body.password !== undefined && String(body.password).trim() !== "") {
        const password = String(body.password);
        if (password.length < MIN_PASSWORD) {
            return send(res, 400, { error: "Password must be at least " + MIN_PASSWORD + " characters." });
        }
        const hash = await bcrypt.hash(password, 10);
        updates.push("password_hash = ?");
        params.push(hash);
    }

    // status (archive / restore)
    if (body.status !== undefined) {
        const status = String(body.status || "").trim();
        if (!STATUSES.includes(status)) {
            return send(res, 400, { error: "Status must be active or archived." });
        }
        if (status === "archived" && currentStatus !== "archived") {
            if (id === session.uid) {
                return send(res, 400, { error: "You cannot archive the account you are signed in with." });
            }
            if (user.role === "admin") {
                const [[count]] = await getPool().query(
                    "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'"
                );
                if (Number(count.total) <= 1) {
                    return send(res, 400, {
                        error: "This is the only active administrator account. Create or restore another one first."
                    });
                }
            }
        }
        if (status !== currentStatus) {
            updates.push("status = ?");
            params.push(status);
        }
    }

    if (updates.length) {
        params.push(id);
        await getPool().query(
            "UPDATE users SET " + updates.join(", ") + " WHERE id = ?",
            params
        );
    }

    const [updatedRows] = await getPool().query(
        "SELECT id, username, role, status FROM users WHERE id = ? LIMIT 1",
        [id]
    );
    const updated = updatedRows[0] || user;

    return send(res, 200, {
        user: {
            id: updated.id,
            username: updated.username,
            role: updated.role,
            status: updated.status || "active"
        }
    });
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== "PUT") return send(res, 405, { error: "Method not allowed." });
        const session = requireAdmin(req, res);
        if (!session) return;
        return await updateUser(req, res, session);
    } catch (err) {
        if (err && err.code === "ER_DUP_ENTRY") {
            return send(res, 409, { error: "That username is already taken." });
        }
        return serverError(res, err);
    }
};