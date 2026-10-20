// Front-end client for the backend API (Vercel serverless functions).
// Replaces the old localStorage-only store with real database calls.
(function (global) {
    "use strict";

    var LOW_STOCK = 20;

    function round2(n) {
        return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    }

    function currency(n) {
        return "₱ " + round2(n).toFixed(2);
    }

    function statusFor(stock) {
        if (stock <= 0) return { cls: "badge-out", label: "Out of stock" };
        if (stock < LOW_STOCK) return { cls: "badge-low", label: "Low stock" };
        return { cls: "badge-in", label: "In stock" };
    }

    // Start of the selected period in the user's local time, as an exact ISO instant.
    function rangeFrom(range) {
        if (range === "all") return null;
        var d = new Date();
        if (range === "week") d.setDate(d.getDate() - d.getDay());
        if (range === "month") d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
    }

    async function request(path, options) {
        var opts = options || {};
        var init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
        if (opts.body !== undefined) {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(opts.body);
        }

        var res = await fetch(path, init);
        var data = {};
        try {
            data = await res.json();
        } catch (e) {
            data = {};
        }

        if (!res.ok) {
            var error = new Error(data.error || "Request failed (" + res.status + ").");
            error.status = res.status;
            throw error;
        }
        return data;
    }

    var Api = {
        LOW_STOCK: LOW_STOCK,
        round2: round2,
        currency: currency,
        statusFor: statusFor,
        rangeFrom: rangeFrom,

        login: function (username, password) {
            return request("/api/login", { method: "POST", body: { username: username, password: password } });
        },
        logout: function () {
            return request("/api/logout", { method: "POST" });
        },
        me: function () {
            return request("/api/me");
        },

        getProducts: function () {
            return request("/api/products").then(function (data) { return data.products; });
        },
        addProduct: function (product) {
            return request("/api/products", { method: "POST", body: product });
        },
        updateProduct: function (id, patch) {
            return request("/api/products/" + id, { method: "PUT", body: patch });
        },
        deleteProduct: function (id) {
            return request("/api/products/" + id, { method: "DELETE" });
        },
        saveProducts: function (items) {
            return request("/api/products/bulk", { method: "POST", body: { items: items } });
        },
        importSampleCatalog: function () {
            return request("/api/products/import", { method: "POST" });
        },

        checkout: function (payload) {
            return request("/api/sales", { method: "POST", body: payload });
        },
        getStats: function (range) {
            var from = rangeFrom(range);
            // Minutes ahead of UTC, so the report's buckets follow the shop's clock.
            var tz = -new Date().getTimezoneOffset();
            var query = "?range=" + encodeURIComponent(range || "today") +
                (from ? "&from=" + encodeURIComponent(from) : "") +
                "&tz=" + encodeURIComponent(String(tz));
            return request("/api/sales" + query);
        },

        setupAvailable: function () {
            return request("/api/setup").then(function (data) { return data.available; });
        },
        runSetup: function (username, password, confirm) {
            return request("/api/setup", { method: "POST", body: { username: username, password: password, confirm: confirm } });
        },

        getUsers: function () {
            return request("/api/users").then(function (data) { return data.users; });
        },
        addUser: function (user) {
            return request("/api/users", { method: "POST", body: user });
        },
        deleteUser: function (id) {
            return request("/api/users/" + id, { method: "DELETE" });
        }
    };

    global.Api = Api;
})(window);
