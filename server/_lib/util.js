// Small helpers shared by the API functions.
"use strict";

function send(res, status, data) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(data === undefined ? "" : JSON.stringify(data));
}

function serverError(res, err) {
    console.error(err);
    send(res, 500, { error: "Server error. Please try again." });
}

function readBody(req) {
    if (!req.body) return {};
    if (typeof req.body === "string") {
        try {
            return JSON.parse(req.body);
        } catch (e) {
            return {};
        }
    }
    return req.body;
}

function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Returns a non-negative price or null when the value is not usable.
function asMoney(value) {
    if (value === undefined || value === null || value === "") return null;
    var n = Number(value);
    return isFinite(n) && n >= 0 ? round2(n) : null;
}

// Returns a non-negative whole number or null when the value is not usable.
function asStock(value) {
    if (value === undefined || value === null || value === "") return null;
    var n = Math.floor(Number(value));
    return isFinite(n) && n >= 0 ? n : null;
}

function txNo(id) {
    return "TX-" + String(id).padStart(4, "0");
}

module.exports = { send, serverError, readBody, round2, asMoney, asStock, txNo };
