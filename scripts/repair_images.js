// Restores the product images that an earlier bulk-save bug blanked.
// Uses the deployed bulk endpoint, so no database credentials are involved:
// for every product with an empty image, look the name up in the sample
// catalog and send that image back.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require(path.join(process.env.TEMP, "opencode", "lunastest", "node_modules", "jsdom"));

const ROOT = path.join(__dirname, "..");
const BASE = "https://lunas-pharmacy.vercel.app";

// Same trick the server uses: run the browser catalog file in a sandbox.
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "js", "products.js"), "utf8"), sandbox);
const catalog = sandbox.window.LUNA_PRODUCTS || [];

const byName = new Map();
for (const item of catalog) {
    const name = String((item && item.n) || "").trim();
    if (!name) continue;
    byName.set(name.toLowerCase(), String((item && item.i) || "").trim());
}
console.log("catalog entries:", byName.size);

let cookie = "";
async function call(apiPath, options) {
    const opts = options || {};
    const init = { method: opts.method || "GET", headers: {} };
    if (cookie) init.headers["Cookie"] = cookie;
    if (opts.body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(BASE + apiPath, init);
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookie.length) cookie = setCookie.map(function (c) { return c.split(";")[0]; }).join("; ");
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { status: res.status, data: data };
}

(async function () {
    const login = await call("/api/login", { method: "POST", body: { username: "ADMIN", password: "admin123" } });
    if (login.status !== 200) { console.log("login failed", login.status); process.exit(1); }

    const products = (await call("/api/products")).data.products;
    console.log("products in the database:", products.length);

    const broken = products.filter(function (p) { return !p.image || !String(p.image).trim(); });
    console.log("products missing an image:", broken.length);

    const repairs = [];
    const unmatched = [];
    for (const p of broken) {
        const image = byName.get(String(p.name).trim().toLowerCase());
        if (!image) { unmatched.push(p.name); continue; }
        repairs.push({ id: p.id, name: p.name, category: p.category, price: p.price, stock: p.stock, image: image });
    }

    console.log("matched to the catalog:", repairs.length);
    if (unmatched.length) console.log("no catalog match for:", unmatched);

    if (!repairs.length) {
        console.log("\nnothing to repair");
        return;
    }

    const t0 = Date.now();
    const res = await call("/api/products/bulk", { method: "POST", body: { items: repairs } });
    console.log("repair ->", res.status, JSON.stringify(res.data), "in", Date.now() - t0, "ms");

    const after = (await call("/api/products")).data.products;
    const fixed = after.filter(function (p) { return p.image && String(p.image).trim(); });
    console.log("products with an image now:", fixed.length, "of", after.length);
    const stillBroken = after.filter(function (p) { return !p.image || !String(p.image).trim(); });
    console.log("still missing an image:", stillBroken.length, stillBroken.map(function (p) { return p.name; }));
})();