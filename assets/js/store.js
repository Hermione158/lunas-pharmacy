// Shared data layer for the POS and Inventory pages.
// Keeps products (with real stock) and sales in localStorage so both pages
// read and write the same source of truth.
(function (global) {
    "use strict";

    var PRODUCTS_KEY = "luna_products";
    var SALES_KEY = "luna_sales";
    var LOW_STOCK = 20;

    function storage() {
        try {
            return global.localStorage;
        } catch (e) {
            return null;
        }
    }

    function readJSON(key, fallback) {
        var store = storage();
        if (!store) return fallback;
        try {
            var raw = store.getItem(key);
            if (!raw) return fallback;
            var parsed = JSON.parse(raw);
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch (e) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        var store = storage();
        if (!store) return false;
        try {
            store.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    }

    function round2(n) {
        return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    }

    function currency(n) {
        return "₱ " + round2(n).toFixed(2);
    }

    // Opening stock for a brand new item, so the first run matches the
    // quantities the demo pages used to fake with a name hash.
    function seedStock(name) {
        var h = 0;
        for (var i = 0; i < name.length; i++) {
            h = (h * 31 + name.charCodeAt(i)) % 997;
        }
        var pool = [0, 0, 6, 9, 12, 15, 18, 25, 40, 60, 85, 120, 150, 210, 240, 300];
        return pool[h % pool.length];
    }

    function cleanProduct(p) {
        var price = Number(p.p);
        var stock = Math.floor(Number(p.s));
        return {
            n: String(p.n === undefined || p.n === null ? "" : p.n).trim() || "Unnamed item",
            i: String(p.i || ""),
            c: String(p.c || "").trim() || "Uncategorized",
            p: isFinite(price) && price >= 0 ? round2(price) : 0,
            s: isFinite(stock) && stock > 0 ? stock : 0
        };
    }

    function seedProducts() {
        return (global.LUNA_PRODUCTS || []).map(function (p) {
            var name = String(p.n || "");
            return cleanProduct({ n: name, i: p.i, c: p.c, p: p.p, s: seedStock(name) });
        });
    }

    var cache = null;

    function load() {
        var stored = readJSON(PRODUCTS_KEY, null);

        if (!Array.isArray(stored) || !stored.length) {
            cache = seedProducts();
        } else {
            var known = {};
            cache = stored.map(function (p) {
                var clean = cleanProduct(p);
                known[clean.n] = true;
                return clean;
            });

            // Pick up medicines added to products.js after the first run.
            (global.LUNA_PRODUCTS || []).forEach(function (p) {
                var name = String(p.n || "").trim();
                if (!name || known[name]) return;
                known[name] = true;
                cache.push(cleanProduct({ n: name, i: p.i, c: p.c, p: p.p, s: seedStock(name) }));
            });
        }

        writeJSON(PRODUCTS_KEY, cache);
        return cache;
    }

    function getProducts() {
        if (!cache) load();
        return cache;
    }

    function saveProducts(list) {
        cache = (list || []).map(cleanProduct);
        writeJSON(PRODUCTS_KEY, cache);
        return cache;
    }

    function findProduct(name) {
        var list = getProducts();
        for (var i = 0; i < list.length; i++) {
            if (list[i].n === name) return list[i];
        }
        return null;
    }

    // True when another item (not exceptName) already uses this name.
    function nameTaken(name, exceptName) {
        if (!name) return false;
        var list = getProducts();
        for (var i = 0; i < list.length; i++) {
            if (list[i].n === name && list[i].n !== exceptName) return true;
        }
        return false;
    }

    function addProduct(data) {
        var p = cleanProduct(data);
        if (findProduct(p.n)) return null;
        var list = getProducts();
        list.push(p);
        saveProducts(list);
        return p;
    }

    function updateProduct(name, patch) {
        var p = findProduct(name);
        if (!p) return null;
        if (patch.n !== undefined) p.n = String(patch.n).trim() || p.n;
        if (patch.i !== undefined) p.i = patch.i;
        if (patch.c !== undefined) p.c = String(patch.c).trim() || p.c;
        if (patch.p !== undefined) p.p = patch.p;
        if (patch.s !== undefined) p.s = patch.s;
        saveProducts(getProducts());
        return findProduct(p.n);
    }

    function deleteProduct(name) {
        saveProducts(getProducts().filter(function (p) { return p.n !== name; }));
        return cache;
    }

    function stockOf(name) {
        var p = findProduct(name);
        return p ? p.s : 0;
    }

    function setStock(name, qty) {
        var p = findProduct(name);
        if (!p) return 0;
        p.s = Math.max(0, Math.floor(Number(qty) || 0));
        saveProducts(getProducts());
        return p.s;
    }

    // --- Sales ---

    function getSales() {
        var sales = readJSON(SALES_KEY, []);
        return Array.isArray(sales) ? sales : [];
    }

    function saveSales(sales) {
        return writeJSON(SALES_KEY, sales);
    }

    function nextSaleId(sales) {
        var max = 0;
        sales.forEach(function (s) {
            var n = parseInt(String(s.id || "").replace(/[^0-9]/g, ""), 10);
            if (!isNaN(n) && n > max) max = n;
        });
        return "TX-" + ("0000" + (max + 1)).slice(-4);
    }

    // Records the sale and deducts stock in one step.
    function checkout(data) {
        var items = (data.items || []).map(function (it) {
            return {
                name: String(it.name || ""),
                qty: Math.max(1, Math.floor(Number(it.qty) || 0)),
                price: round2(Number(it.price) || 0)
            };
        }).filter(function (it) { return it.name; });

        if (!items.length) {
            return { ok: false, error: "The sale is empty. Add a product first." };
        }

        var list = getProducts();
        for (var i = 0; i < items.length; i++) {
            var found = null;
            for (var j = 0; j < list.length; j++) {
                if (list[j].n === items[i].name) { found = list[j]; break; }
            }
            if (!found) {
                return { ok: false, error: items[i].name + " is no longer in the inventory." };
            }
            if (found.s < items[i].qty) {
                return { ok: false, error: "Not enough stock for " + found.n + " (" + found.s + " left)." };
            }
        }

        var gross = 0;
        items.forEach(function (it) {
            it.total = round2(it.qty * it.price);
            gross += it.total;
        });
        gross = round2(gross);

        var discount = round2(Number(data.discount) || 0);
        if (discount < 0) discount = 0;
        if (discount > gross) discount = gross;

        items.forEach(function (it) {
            var p = findProduct(it.name);
            p.s = Math.max(0, p.s - it.qty);
        });
        saveProducts(getProducts());

        var sales = getSales();
        var sale = {
            id: nextSaleId(sales),
            date: new Date().toISOString(),
            cashier: String(data.cashier || "cashier"),
            items: items,
            gross: gross,
            discount: discount,
            net: round2(gross - discount)
        };
        sales.push(sale);
        saveSales(sales);

        return { ok: true, sale: sale };
    }

    // --- Reporting ---

    function rangeStart(range, now) {
        var d = now ? new Date(now) : new Date();
        if (range === "all") return null;
        if (range === "week") {
            return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
        }
        if (range === "month") {
            return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
        }
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }

    function inRange(dateISO, from) {
        if (from === null) return true;
        var t = new Date(dateISO).getTime();
        return !isNaN(t) && t >= from;
    }

    function stats(range, now) {
        var from = rangeStart(range, now);
        var sales = getSales().filter(function (s) { return inRange(s.date, from); });

        var gross = 0, discount = 0, net = 0, units = 0;
        var byItem = {};

        sales.forEach(function (s) {
            gross += Number(s.gross) || 0;
            discount += Number(s.discount) || 0;
            net += Number(s.net) || 0;
            (s.items || []).forEach(function (it) {
                var qty = Number(it.qty) || 0;
                units += qty;
                var row = byItem[it.name] || { name: it.name, qty: 0, revenue: 0 };
                row.qty += qty;
                row.revenue += qty * (Number(it.price) || 0);
                byItem[it.name] = row;
            });
        });

        var top = Object.keys(byItem).map(function (k) { return byItem[k]; });
        top.sort(function (a, b) { return b.qty - a.qty || b.revenue - a.revenue; });

        return {
            range: range || "today",
            from: from,
            gross: round2(gross),
            discount: round2(discount),
            net: round2(net),
            transactions: sales.length,
            units: units,
            average: sales.length ? round2(net / sales.length) : 0,
            top: top
        };
    }

    function statusFor(stock) {
        if (stock <= 0) return { cls: "badge-out", label: "Out of stock" };
        if (stock < LOW_STOCK) return { cls: "badge-low", label: "Low stock" };
        return { cls: "badge-in", label: "In stock" };
    }

    function resetAll() {
        var store = storage();
        if (store) {
            store.removeItem(PRODUCTS_KEY);
            store.removeItem(SALES_KEY);
        }
        cache = null;
        load();
    }

    var Store = {
        LOW_STOCK: LOW_STOCK,
        PRODUCTS_KEY: PRODUCTS_KEY,
        SALES_KEY: SALES_KEY,
        getProducts: getProducts,
        saveProducts: saveProducts,
        findProduct: findProduct,
        nameTaken: nameTaken,
        addProduct: addProduct,
        updateProduct: updateProduct,
        deleteProduct: deleteProduct,
        stockOf: stockOf,
        setStock: setStock,
        getSales: getSales,
        saveSales: saveSales,
        checkout: checkout,
        stats: stats,
        statusFor: statusFor,
        currency: currency,
        round2: round2,
        resetAll: resetAll
    };

    global.Store = Store;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = Store;
    }
})(typeof window !== "undefined" ? window : globalThis);