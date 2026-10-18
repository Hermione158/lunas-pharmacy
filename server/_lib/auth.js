// Session handling: signed JWT inside an httpOnly cookie.
"use strict";

const jwt = require("jsonwebtoken");
const { send } = require("./util");

const COOKIE_NAME = "luna_session";
const MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

function secret() {
    const value = process.env.SESSION_SECRET;
    if (!value) throw new Error("SESSION_SECRET is not set. Copy .env.example to .env.");
    return value;
}

function signSession(user) {
    return jwt.sign(
        { uid: user.id, username: user.username, role: user.role },
        secret(),
        { expiresIn: MAX_AGE_SECONDS }
    );
}

function parseCookies(header) {
    const out = {};
    String(header || "").split(";").forEach(function (part) {
        const i = part.indexOf("=");
        if (i === -1) return;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
}

function getSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    try {
        return jwt.verify(token, secret());
    } catch (e) {
        return null;
    }
}

function isSecureRequest(req) {
    const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    return proto === "https";
}

function setSessionCookie(req, res, token) {
    const parts = [
        COOKIE_NAME + "=" + token,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=" + MAX_AGE_SECONDS
    ];
    if (isSecureRequest(req)) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

// Returns the session or replies 401 and returns null.
function requireAuth(req, res) {
    const session = getSession(req);
    if (!session) {
        send(res, 401, { error: "Not signed in." });
        return null;
    }
    return session;
}

// Returns an admin session or replies 401/403 and returns null.
function requireAdmin(req, res) {
    const session = requireAuth(req, res);
    if (!session) return null;
    if (session.role !== "admin") {
        send(res, 403, { error: "Administrator access required." });
        return null;
    }
    return session;
}

module.exports = {
    signSession,
    getSession,
    setSessionCookie,
    clearSessionCookie,
    requireAuth,
    requireAdmin
};
