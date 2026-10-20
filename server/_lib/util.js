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

// Returns a trimmed barcode or null when the value is empty.
function asBarcode(value) {
    var text = value === undefined || value === null ? "" : String(value).trim();
    return text || null;
}

// The biggest picture the API accepts, in characters of base64 data.
// The browser shrinks a picture before it is sent, so this is a safety net.
var MAX_IMAGE_LENGTH = 500000;

// A picture is either a small image sent as a data URL, or a file name that
// points at a picture already in the project (how the sample catalog works).
// Returns the stored value, or null when the value is not a usable picture.
function asImage(value) {
    var text = value === undefined || value === null ? "" : String(value).trim();
    if (!text) return "";

    if (/^data:/i.test(text)) {
        if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(text)) return null;
        if (text.length > MAX_IMAGE_LENGTH) return null;
        return text;
    }

    // A plain file name: no spaces, no quotes, short enough for a path.
    if (text.length > 255) return null;
    if (/[\s"'<>]/.test(text)) return null;
    return text;
}

// Friendly message for a UNIQUE violation, whichever column caused it.
function duplicateError(err, name) {
    if (/barcode/i.test(String(err && err.message || ""))) {
        return "That barcode is already used by another item.";
    }
    return "\"" + name + "\" already exists in the inventory.";
}

function txNo(id) {
    return "TX-" + String(id).padStart(4, "0");
}

module.exports = { send, serverError, readBody, round2, asMoney, asStock, asBarcode, asImage, duplicateError, txNo };
