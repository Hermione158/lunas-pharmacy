// HTTP server for Render: serves the /api/* handlers plus the whole static site
// (so the Render URL is a complete working copy as well as the API backend).
//
// Zero dependencies: plain node:http plus a small file-based router.
//   npm start              -> http://localhost:3000
//   PORT=5050 npm start    -> custom port
//
// The Vercel deployment serves the static files and rewrites /api/* here, so the
// browser always talks to a single origin and the session cookie works unchanged.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const loadEnv = require("./_lib/loadEnv");

const envFile = loadEnv();

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 1024 * 1024;

// Never served over HTTP, whatever the request says.
const PRIVATE_SEGMENTS = ["server", "scripts", "db", "node_modules"];

// URL path -> handler file. Fixed routes first.
const FIXED_ROUTES = {
    "/api/login": "login.js",
    "/api/logout": "logout.js",
    "/api/me": "me.js",
    "/api/setup": "setup.js",
    "/api/products": "products.js",
    "/api/categories": "categories.js",
    "/api/sales": "sales.js",
    "/api/movements": "movements.js",
    "/api/users": "users.js"
};

// Parameterised routes, checked in this order (import and bulk win over :id).
const PARAM_ROUTES = [
    { pattern: /^\/api\/products\/import$/, file: "products/import.js", key: null },
    { pattern: /^\/api\/products\/bulk$/, file: "products/bulk.js", key: null },
    { pattern: /^\/api\/products\/([^/]+)$/, file: "products/[id].js", key: "id" },
    { pattern: /^\/api\/users\/([^/]+)$/, file: "users/[id].js", key: "id" }
];

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".pdf": "application/pdf"
};

const handlers = new Map();

function loadHandler(file) {
    if (!handlers.has(file)) handlers.set(file, require(path.join(__dirname, file)));
    return handlers.get(file);
}

function sendJson(res, status, data) {
    if (res.headersSent) return;
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise(function (resolve, reject) {
        if (req.method === "GET" || req.method === "HEAD") return resolve(null);

        const chunks = [];
        let size = 0;

        req.on("data", function (chunk) {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error("Request body is too large."));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on("end", function () {
            const raw = Buffer.concat(chunks).toString("utf8");
            if (!raw) return resolve(null);
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                // Handlers use readBody(), which tolerates a raw string.
                resolve(raw);
            }
        });

        req.on("error", reject);
    });
}

function resolveRoute(pathname) {
    if (FIXED_ROUTES[pathname]) return { file: FIXED_ROUTES[pathname], key: null, param: null };

    for (const route of PARAM_ROUTES) {
        const match = pathname.match(route.pattern);
        // The path is already URL-decoded, so the captured id is usable as is.
        if (match) return { file: route.file, key: route.key, param: route.key ? match[1] : null };
    }
    return null;
}

async function handleApi(req, res, url, pathname) {
    if (pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, service: "luna-pharmacy-api", uptime: Math.round(process.uptime()) });
    }

    const route = resolveRoute(pathname);
    if (!route) return sendJson(res, 404, { error: "Not found." });

    // Freshness first: inventory, stock and sales must never be cached.
    res.setHeader("Cache-Control", "no-store");

    const query = {};
    for (const [key, value] of url.searchParams) query[key] = value;

    const routeQuery = Object.assign({}, query);
    if (route.param !== null && route.key) routeQuery[route.key] = route.param;
    req.query = routeQuery;
    req.body = await readBody(req);

    return await loadHandler(route.file)(req, res);
}

function isPrivate(relativePath) {
    const segments = relativePath.split("/").filter(Boolean);
    // Dotfiles (including .env) and the server-side folders stay unreachable.
    return segments.some(function (segment) {
        return segment.startsWith(".") || PRIVATE_SEGMENTS.includes(segment);
    });
}

function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });

    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");

    let target;
    try {
        target = path.resolve(ROOT, requested);
    } catch (err) {
        return sendJson(res, 404, { error: "Not found." });
    }

    // Never escape the project folder.
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return sendJson(res, 404, { error: "Not found." });
    if (isPrivate(requested)) return sendJson(res, 404, { error: "Not found." });

    let stats;
    try {
        stats = fs.statSync(target);
    } catch (err) {
        return sendJson(res, 404, { error: "Not found." });
    }
    if (!stats.isFile()) return sendJson(res, 404, { error: "Not found." });

    const type = CONTENT_TYPES[path.extname(target).toLowerCase()];
    if (!type) return sendJson(res, 404, { error: "Not found." });

    const body = fs.readFileSync(target);
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", body.length);
    res.setHeader("Cache-Control", type.startsWith("text/html") ? "no-cache" : "public, max-age=3600");

    if (req.method === "HEAD") return res.end();
    res.end(body);
}

const server = http.createServer(function (req, res) {
    let pathname = "/";
    try {
        pathname = decodeURIComponent(new URL(req.url, "http://" + (req.headers.host || "localhost")).pathname);
    } catch (err) {
        return sendJson(res, 400, { error: "Bad request." });
    }

    const isApi = pathname === "/api" || pathname.startsWith("/api/");
    const work = isApi ? handleApi(req, res, new URL(req.url, "http://localhost"), pathname) : null;

    Promise.resolve(work)
        .catch(function (err) {
            console.error(err);
            sendJson(res, 500, { error: "Server error. Please try again." });
        })
        .then(function () {
            if (isApi) console.log(req.method + " " + pathname + " -> " + res.statusCode);
            if (!isApi) serveStatic(req, res, pathname);
        });
});

server.on("error", function (err) {
    console.error("Server error:", err.message);
    process.exit(1);
});

server.listen(PORT, function () {
    console.log("Luna's Pharmacy server listening on http://localhost:" + PORT);
    console.log("API health check: http://localhost:" + PORT + "/api/health");
    if (envFile) console.log("Loaded environment from " + envFile);
});