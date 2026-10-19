// Repairs the product images whose file names were renamed on disk
// (spaces turned into dashes, parentheses removed) while the database still
// stored the old paths. Uses the deployed bulk endpoint, so no database
// credentials are involved: for every product whose image path contains a
// space or a parenthesis, the new name is derived with the same rule that was
// used for the files, checked against assets/images, and saved back.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASE = "https://lunas-pharmacy.vercel.app";

// "assets/images/Acid Mecid (Mefenamic Acid).jpg" -> "assets/images/Acid-Mecid-Mefenamic-Acid.jpg"
function toRenamed(image) {
    const raw = String(image || "").trim();
    if (!raw || !/[ (]/.test(raw)) return null;

    const slash = raw.lastIndexOf("/");
    const dir = slash >= 0 ? raw.slice(0, slash + 1) : "";
    let file = slash >= 0 ? raw.slice(slash + 1) : raw;
    try {
        file = decodeURIComponent(file);
    } catch (e) {
        // leave the raw name as it is
    }
    file = file.replace(/ /g, "-").replace(/[()]/g, "");
    return dir + file;
}

function existsInRepo(relPath) {
    const normalized = relPath.replace(/\//g, path.sep);
    return fs.existsSync(path.join(ROOT, normalized));
}

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

    const repairs = [];
    const unresolved = [];
    for (const p of products) {
        const next = toRenamed(p.image);
        if (!next) continue;
        if (!existsInRepo(next)) {
            unresolved.push(p.name + ": " + p.image + " -> " + next + " (no such file)");
            continue;
        }
        repairs.push({ id: p.id, name: p.name, category: p.category, price: p.price, stock: p.stock, image: next });
    }

    console.log("products with an old renamed image path:", repairs.length + unresolved.length);
    if (unresolved.length) console.log("could not map to an existing file:\n  " + unresolved.join("\n  "));

    if (!repairs.length) {
        console.log("\nnothing to repair");
        return;
    }

    const t0 = Date.now();
    const res = await call("/api/products/bulk", { method: "POST", body: { items: repairs } });
    console.log("repair ->", res.status, JSON.stringify(res.data), "in", Date.now() - t0, "ms");

    const after = (await call("/api/products")).data.products;
    const stillOld = after.filter(function (p) { return /[ (]/.test(String(p.image || "")); });
    const broken = after.filter(function (p) { return p.image && !existsInRepo(String(p.image)); });
    console.log("products still on an old path:", stillOld.length, stillOld.map(function (p) { return p.name; }));
    console.log("products whose image file is missing in the repo:", broken.length, broken.map(function (p) { return p.name + " -> " + p.image; }));
    console.log(stillOld.length === 0 && broken.length === 0 ? "\nALL PRODUCT IMAGES OK" : "\nSTILL NEEDS ATTENTION");
})();
