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

    // Local midnight for a "YYYY-MM-DD" day picker value, or today.
    function dayDate(day) {
        var parts = String(day || "").split("-").map(Number);
        var d = parts.length === 3 && parts[0] && parts[1] && parts[2]
            ? new Date(parts[0], parts[1] - 1, parts[2])
            : new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // Start of the selected period in the user's local time, as an exact ISO instant.
    function rangeFrom(range, day) {
        if (range === "all") return null;
        var d = range === "day" ? dayDate(day) : new Date();
        if (range === "week") d.setDate(d.getDate() - d.getDay());
        if (range === "month") d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
    }

    // The window just before the selected one, so the report can say whether
    // the shop is up or down. It covers the same amount of time as the
    // current window, so a part-finished week is compared with a part-
    // finished week and not with a whole one. A chosen day is compared with
    // the day before it.
    function rangePrevious(range, day) {
        if (range === "all") return null;

        var now = new Date();
        var start = range === "day" ? dayDate(day) : new Date(now);
        if (range === "week") start.setDate(start.getDate() - start.getDay());
        else if (range === "month") start.setDate(1);
        start.setHours(0, 0, 0, 0);

        var prev = new Date(start);
        if (range === "week") prev.setDate(prev.getDate() - 7);
        else if (range === "month") prev.setMonth(prev.getMonth() - 1);
        else prev.setDate(prev.getDate() - 1);

        if (range === "day") {
            return { from: prev.toISOString(), to: start.toISOString() };
        }

        var elapsed = now.getTime() - start.getTime();
        var prevTo = new Date(prev.getTime() + elapsed);

        return { from: prev.toISOString(), to: prevTo.toISOString() };
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
        rangePrevious: rangePrevious,

        login: function (username, password) {
            return request("/api/login", { method: "POST", body: { username: username, password: password } });
        },
        logout: function () {
            return request("/api/logout", { method: "POST" });
        },
        me: function () {
            return request("/api/me");
        },

        getProducts: function (status) {
            return request("/api/products" + (status ? "?status=" + encodeURIComponent(status) : ""))
                .then(function (data) { return data.products; });
        },
        addProduct: function (product) {
            return request("/api/products", { method: "POST", body: product });
        },
        updateProduct: function (id, patch) {
            return request("/api/products/" + id, { method: "PUT", body: patch });
        },
        saveProducts: function (items) {
            return request("/api/products/bulk", { method: "POST", body: { items: items } });
        },
        importSampleCatalog: function () {
            return request("/api/products/import", { method: "POST" });
        },
        getCategories: function () {
            return request("/api/categories").then(function (data) { return data.categories; });
        },
        renameCategory: function (from, to) {
            return request("/api/categories", { method: "POST", body: { action: "rename", from: from, to: to } });
        },
        clearCategory: function (from) {
            return request("/api/categories", { method: "POST", body: { action: "clear", from: from } });
        },
        getMovements: function (limit) {
            return request("/api/movements?limit=" + encodeURIComponent(String(limit || 100)))
                .then(function (data) { return data.movements; });
        },

        checkout: function (payload) {
            return request("/api/sales", { method: "POST", body: payload });
        },
        getStats: function (range, day) {
            var from = rangeFrom(range, day);
            var to = range === "day" && from
                ? new Date(new Date(from).getTime() + 24 * 60 * 60 * 1000).toISOString()
                : null;
            // Minutes ahead of UTC, so the report's buckets follow the shop's clock.
            var tz = -new Date().getTimezoneOffset();
            var previous = rangePrevious(range, day);
            var query = "?range=" + encodeURIComponent(range || "today") +
                (from ? "&from=" + encodeURIComponent(from) : "") +
                (to ? "&to=" + encodeURIComponent(to) : "") +
                "&tz=" + encodeURIComponent(String(tz));
            if (previous) {
                query += "&prevFrom=" + encodeURIComponent(previous.from) +
                    "&prevTo=" + encodeURIComponent(previous.to);
            }
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
        archiveUser: function (id, status) {
            return request("/api/users/" + id, { method: "PUT", body: { status: status } });
        }
    };

    global.Api = Api;
})(window);
