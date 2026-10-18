// End-to-end smoke test against a running server (local `vercel dev` or the deployed URL).
//
// Usage:
//   node scripts/smoke.js <base-url> [cashier-user cashier-pass] [admin-user admin-pass]
//
// Credentials are never hardcoded. Provide them as arguments or environment variables:
//   node scripts/smoke.js http://localhost:3000 mycashier pass123 myadmin pass456
//   SMOKE_CASHIER_USER=... SMOKE_CASHIER_PASS=... SMOKE_ADMIN_USER=... SMOKE_ADMIN_PASS=... \
//     node scripts/smoke.js https://your-app.vercel.app
//
// With no credentials only the connection/auth-guard checks run.
// Note: the full run records one real test sale and removes the temporary item it creates.
"use strict";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const CASHIER = {
    user: process.argv[3] || process.env.SMOKE_CASHIER_USER,
    pass: process.argv[4] || process.env.SMOKE_CASHIER_PASS
};
const ADMIN = {
    user: process.argv[5] || process.env.SMOKE_ADMIN_USER,
    pass: process.argv[6] || process.env.SMOKE_ADMIN_PASS
};

let failures = 0;

function check(label, condition, detail) {
    const mark = condition ? "PASS" : "FAIL";
    if (!condition) failures++;
    console.log("[" + mark + "] " + label + (detail !== undefined ? " -> " + JSON.stringify(detail) : ""));
}

function makeClient() {
    let cookie = "";

    return async function call(path, options) {
        const opts = options || {};
        const init = { method: opts.method || "GET", headers: {} };
        if (cookie) init.headers["Cookie"] = cookie;
        if (opts.body !== undefined) {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(opts.body);
        }
        const res = await fetch(BASE + path, init);
        const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        if (setCookie.length) cookie = setCookie.map(function (c) { return c.split(";")[0]; }).join("; ");
        let data = null;
        try {
            data = await res.json();
        } catch (e) {
            data = null;
        }
        return { status: res.status, data: data };
    };
}

async function runCashierFlow(cashier, admin) {
    let res = await cashier("/api/me");
    check("unauthenticated /api/me is rejected", res.status === 401, res.status);

    res = await cashier("/api/login", { method: "POST", body: { username: CASHIER.user, password: "definitely-wrong" } });
    check("wrong password is rejected", res.status === 401, res.status);

    res = await cashier("/api/login", { method: "POST", body: { username: CASHIER.user, password: CASHIER.pass } });
    check("cashier can log in", res.status === 200 && res.data.user.role === "cashier", res.data);

    res = await cashier("/api/products");
    check("cashier can list products", res.status === 200 && Array.isArray(res.data.products) && res.data.products.length > 0,
        res.data && res.data.products ? res.data.products.length + " products" : res.data);

    res = await cashier("/api/users");
    check("cashier is blocked from the accounts API", res.status === 403, res.status);

    res = await cashier("/api/products", { method: "POST", body: { name: "Should Fail", category: "Test", price: 1, stock: 1 } });
    check("cashier is blocked from creating products", res.status === 403, res.status);

    res = await cashier("/api/products");
    let product = (res.data.products || []).find(function (p) { return p.stock > 0; });
    let toppedUp = null;

    // A fresh inventory is all at 0 stock, so borrow one item to sell from and put
    // the stock back afterwards. Prices are never touched (the PUT is a partial patch).
    if (!product && admin) {
        const first = (res.data.products || [])[0];
        if (first) {
            const put = await admin("/api/products/" + first.id, { method: "PUT", body: { stock: 5 } });
            if (put.status === 200) {
                toppedUp = { id: first.id, stock: first.stock };
                product = { id: first.id, name: first.name, price: first.price, stock: 5 };
            }
        }
    }

    check("a product with stock exists", !!product, product ? product.name + " (stock " + product.stock + ")" + (toppedUp ? ", temporarily stocked by the test" : "") : "none");

    if (!product) return;

    res = await cashier("/api/sales", { method: "POST", body: { items: [{ id: product.id, qty: 1 }], discount: 1 } });
    check("checkout succeeds", res.status === 201 && res.data.sale, res.data && res.data.sale ? res.data.sale.txNo : res.data);
    const sale = res.data && res.data.sale;

    if (sale) {
        check("receipt math is correct",
            sale.gross === product.price && sale.discount === 1 && sale.net === Math.round((product.price - 1) * 100) / 100,
            { gross: sale.gross, discount: sale.discount, net: sale.net });

        const after = await cashier("/api/products");
        const updated = (after.data.products || []).find(function (p) { return p.id === product.id; });
        check("stock was deducted", updated && updated.stock === product.stock - 1,
            updated ? product.stock + " -> " + updated.stock : "product missing");

        res = await cashier("/api/sales?range=all");
        check("reports include the sale", res.status === 200 && res.data.transactions >= 1 && res.data.sales.length >= 1,
            res.data && { transactions: res.data.transactions, gross: res.data.gross, net: res.data.net, top: res.data.top[0] });

        res = await cashier("/api/sales", { method: "POST", body: { items: [{ id: product.id, qty: 999999 }], discount: 0 } });
        check("overselling is rejected", res.status === 409, res.data);
    }

    if (toppedUp) {
        res = await admin("/api/products/" + toppedUp.id, { method: "PUT", body: { stock: toppedUp.stock } });
        check("temporary stock is put back", res.status === 200, res.data && res.data.product ? res.data.product.stock : res.data);
    }
}

async function runAdminFlow(admin) {
    let res = await admin("/api/login", { method: "POST", body: { username: ADMIN.user, password: ADMIN.pass } });
    check("admin can log in", res.status === 200 && res.data.user.role === "admin", res.data);
    if (res.status !== 200) return;

    res = await admin("/api/users");
    check("admin can list accounts", res.status === 200 && Array.isArray(res.data.users), res.data && res.data.users ? res.data.users.length + " accounts" : res.data);

    res = await admin("/api/setup");
    check("setup stays closed once accounts exist", res.status === 200 && res.data.available === false, res.data);

    const username = "Smoke Test Item";
    res = await admin("/api/products", { method: "POST", body: { name: username, category: "Test", price: 9.99, stock: 5 } });
    check("admin can create a product", res.status === 201 && res.data.product.id, res.data);
    const temp = res.data && res.data.product;

    if (temp) {
        res = await admin("/api/products/" + temp.id, { method: "PUT", body: { price: 12.5, stock: 8 } });
        check("admin can update a product", res.status === 200 && res.data.product.price === 12.5 && res.data.product.stock === 8,
            res.data && res.data.product);

        // The duplicate name has to be tried while temp still exists, so this
        // check runs before the delete below.
        res = await admin("/api/products", { method: "POST", body: { name: username, category: "Test", price: 1, stock: 1 } });
        const duplicate = res.status;
        if (res.status === 201) await admin("/api/products/" + res.data.product.id, { method: "DELETE" });
        check("duplicate names are rejected", duplicate === 409, duplicate);

        res = await admin("/api/products/" + temp.id, { method: "DELETE" });
        check("admin can delete an unsold product", res.status === 200, res.data);
    }

    // account management
    const newUser = "smoke_account_" + Date.now();
    res = await admin("/api/users", { method: "POST", body: { username: newUser, password: "smokepass", role: "cashier" } });
    check("admin can create an account", res.status === 201 && res.data.user.id, res.data);
    const created = res.data && res.data.user;

    if (created) {
        res = await admin("/api/users", { method: "POST", body: { username: newUser, password: "smokepass", role: "cashier" } });
        check("duplicate usernames are rejected", res.status === 409, res.status);

        res = await admin("/api/users/" + created.id, { method: "DELETE" });
        check("admin can delete an unused account", res.status === 200, res.data);

        res = await admin("/api/users", { method: "POST", body: { username: newUser, password: "short", role: "cashier" } });
        check("short passwords are rejected", res.status === 400, res.data);

        res = await admin("/api/users", { method: "POST", body: { username: newUser, password: "smokepass", role: "superuser" } });
        check("invalid roles are rejected", res.status === 400, res.data);
    }

    const me = await admin("/api/me");
    res = await admin("/api/users/" + me.data.user.id, { method: "DELETE" });
    check("you cannot delete your own account", res.status === 400, res.data);

    res = await admin("/api/logout", { method: "POST" });
    check("logout succeeds", res.status === 200, res.status);
    res = await admin("/api/me");
    check("session is cleared after logout", res.status === 401, res.status);
}

// Returns a logged-in admin client, or null when admin credentials are missing
// or rejected. The cashier flow needs it to borrow stock for the sale checks.
async function adminClient() {
    if (!ADMIN.user || !ADMIN.pass) return null;
    const client = makeClient();
    const res = await client("/api/login", { method: "POST", body: { username: ADMIN.user, password: ADMIN.pass } });
    return res.status === 200 ? client : null;
}

async function main() {
    console.log("Smoke testing " + BASE + "\n");

    if (!CASHIER.user || !CASHIER.pass) {
        console.log("No cashier credentials supplied - running connection checks only.");
        const client = makeClient();
        let res = await client("/api/me");
        check("server is reachable and /api/me works", res.status === 401 || res.status === 200, res.status);
        console.log("\nProvide cashier and admin credentials to run the full test.");
        console.log(process.exitCode ? "SOME CHECKS FAILED" : "CONNECTION OK");
        return;
    }

    await runCashierFlow(makeClient(), await adminClient());

    if (ADMIN.user && ADMIN.pass) {
        await runAdminFlow(makeClient());
    } else {
        console.log("\nNo admin credentials supplied - skipped the admin checks.");
    }

    console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(function (err) {
    console.error("Smoke test could not run:", err.message);
    process.exit(1);
});