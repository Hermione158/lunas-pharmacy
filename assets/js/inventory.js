(function () {
    "use strict";

    var page = document.body.getAttribute("data-page") || "inventory";
    var role = sessionStorage.getItem("luna_user");

    // --- Access guard ---
    if (!role) {
        window.location.href = "login.html";
        return;
    }
    if (page === "inventory-edit" && role !== "admin") {
        window.location.href = "inventory.html";
        return;
    }

    // --- Show the signed-in role ---
    var roleLabel = document.getElementById("role-label");
    if (roleLabel) {
        roleLabel.textContent = role === "admin" ? "Administrator" : "Cashier";
    }

    // --- Admin-only nav link ---
    document.querySelectorAll(".inv-admin-link").forEach(function (link) {
        if (role === "admin") {
            link.style.display = "";
        } else {
            link.remove();
        }
    });

    // --- Logout ---
    document.querySelectorAll(".inv-logout").forEach(function (btn) {
        btn.addEventListener("click", async function () {
            try {
                await Api.logout();
            } catch (err) {
                // still clear the local session below
            }
            sessionStorage.removeItem("luna_user");
            sessionStorage.removeItem("luna_name");
            window.location.href = "login.html";
        });
    });

    var products = [];
    var table = document.getElementById("inv-table");
    var tbody = table ? table.querySelector("tbody") : null;
    var search = document.getElementById("inv-search");
    var chipsBox = document.getElementById("inv-chips");
    var activeCat = "All";

    function esc(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function currency(n) {
        return "₱ " + Number(n).toFixed(2);
    }

    function handleAuthError(err) {
        if (err && err.status === 401) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return true;
        }
        return false;
    }

    function parsePrice(text) {
        var n = Number(String(text === undefined || text === null ? "" : text).replace(/[^0-9.\-]/g, ""));
        return isFinite(n) && n >= 0 ? Api.round2(n) : 0;
    }

    function itemCell(p) {
        return '<div class="inv-item">' +
            '<img class="inv-thumb" src="' + esc(p.image || "assets/images/logo.png") + '" alt="" />' +
            '<div><div class="inv-item-name">' + esc(p.name) + "</div>" +
            '<div class="inv-item-sub">' + esc(p.category) + "</div></div></div>";
    }

    function itemCellEdit(p) {
        return '<div class="inv-item">' +
            '<img class="inv-thumb" src="' + esc(p.image || "assets/images/logo.png") + '" alt="" />' +
            '<input class="inv-input" data-field="n" type="text" value="' + esc(p.name) + '" /></div>';
    }

    // Reads the editable inputs of one row back into product fields.
    function readRow(row) {
        function value(field) {
            var input = row.querySelector('[data-field="' + field + '"]');
            return input ? input.value : "";
        }
        return {
            name: value("n").trim(),
            category: value("c").trim(),
            price: parsePrice(value("p")),
            stock: Math.max(0, parseInt(value("s"), 10) || 0)
        };
    }

    function render() {
        if (!tbody) return;

        if (page === "inventory-edit") {
            tbody.innerHTML = products.map(function (p) {
                var st = Api.statusFor(p.stock);
                return '<tr data-id="' + p.id + '" data-name="' + esc(p.name) + '" data-cat="' + esc(p.category) + '">' +
                    "<td>" + itemCellEdit(p) + "</td>" +
                    '<td><input class="inv-input" data-field="c" type="text" value="' + esc(p.category) + '" /></td>' +
                    '<td><input class="inv-input narrow" data-field="p" type="text" value="' + currency(p.price) + '" /></td>' +
                    '<td><input class="inv-input narrow" data-field="s" type="number" min="0" value="' + p.stock + '" /></td>' +
                    '<td><span class="badge ' + st.cls + '">' + st.label + "</span></td>" +
                    '<td><div class="row-actions">' +
                    '<button type="button" class="icon-btn icon-save">Save</button>' +
                    '<button type="button" class="icon-btn icon-del">Delete</button>' +
                    "</div></td></tr>";
            }).join("");
        } else {
            tbody.innerHTML = products.map(function (p) {
                var st = Api.statusFor(p.stock);
                return '<tr data-id="' + p.id + '" data-cat="' + esc(p.category) + '">' +
                    "<td>" + itemCell(p) + "</td>" +
                    "<td>" + esc(p.category) + "</td>" +
                    "<td>" + currency(p.price) + "</td>" +
                    "<td>" + p.stock + "</td>" +
                    '<td><span class="badge ' + st.cls + '">' + st.label + "</span></td>" +
                    "</tr>";
            }).join("");
        }

        updateStats();
    }

    function updateStats() {
        var rows = table.querySelectorAll("tbody tr");
        var low = 0, out = 0;
        rows.forEach(function (row) {
            var badge = row.querySelector(".badge");
            if (!badge) return;
            if (badge.classList.contains("badge-low")) low++;
            if (badge.classList.contains("badge-out")) out++;
        });
        var totalEl = document.getElementById("total-count");
        var lowEl = document.getElementById("low-count");
        var outEl = document.getElementById("out-count");
        if (totalEl) totalEl.textContent = rows.length;
        if (lowEl) lowEl.textContent = low;
        if (outEl) outEl.textContent = out;
    }

    // --- Category chips built from the product data ---
    function buildChips() {
        if (!chipsBox) return;
        var cats = ["All"];
        var seen = {};
        products.forEach(function (p) {
            if (!seen[p.category]) {
                seen[p.category] = true;
                cats.push(p.category);
            }
        });
        chipsBox.innerHTML = "";
        cats.forEach(function (c) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chip" + (c === activeCat ? " active" : "");
            btn.setAttribute("data-cat", c);
            btn.textContent = c;
            btn.addEventListener("click", function () {
                chipsBox.querySelectorAll(".chip").forEach(function (x) {
                    x.classList.remove("active");
                });
                btn.classList.add("active");
                activeCat = c;
                applyFilters();
            });
            chipsBox.appendChild(btn);
        });
    }

    function applyFilters() {
        var term = (search ? search.value : "").trim().toLowerCase();
        var visible = 0;
        table.querySelectorAll("tbody tr").forEach(function (row) {
            var text = row.textContent.toLowerCase();
            row.querySelectorAll("input").forEach(function (input) {
                text += " " + (input.value || "").toLowerCase();
            });
            var cat = row.getAttribute("data-cat") || "";
            var show = (!term || text.indexOf(term) !== -1) &&
                (activeCat === "All" || cat === activeCat);
            row.style.display = show ? "" : "none";
            if (show) visible++;
        });

        var empty = document.getElementById("no-results");
        if (empty) {
            empty.style.display = visible === 0 ? "block" : "none";
        }
    }

    if (search) {
        search.addEventListener("input", applyFilters);
    }

    // --- Status messages ---
    var hint = document.getElementById("save-hint");
    function flash(message) {
        if (!hint) return;
        hint.textContent = message;
        clearTimeout(flash._t);
        flash._t = setTimeout(function () {
            hint.textContent = "";
        }, 2500);
    }

    async function reload() {
        products = await Api.getProducts();
        render();
        applyFilters();
    }

    // --- Persisting edits ---
    async function commitRow(row) {
        var data = readRow(row);
        var isNew = row.getAttribute("data-new") === "1";
        var id = isNew ? null : Number(row.getAttribute("data-id"));

        if (isNew && !data.name) {
            flash("Enter an item name first.");
            return;
        }
        if (!isNew && !id) return;

        try {
            if (isNew) {
                await Api.addProduct({ name: data.name, category: data.category, price: data.price, stock: data.stock, image: "" });
                flash("\"" + data.name + "\" added to the inventory.");
            } else {
                await Api.updateProduct(id, data);
                flash("Changes saved.");
            }
            await reload();
        } catch (err) {
            if (!handleAuthError(err)) flash(err.message);
        }
    }

    if (table) {
        table.addEventListener("click", async function (e) {
            var btn = e.target;
            if (!btn.classList) return;
            var row = btn.closest ? btn.closest("tr") : null;
            if (!row) return;

            if (btn.classList.contains("icon-save")) {
                await commitRow(row);
            } else if (btn.classList.contains("icon-del")) {
                var id = Number(row.getAttribute("data-id"));
                if (!id) return;
                var name = row.getAttribute("data-name") || readRow(row).name;
                if (!confirm("Remove " + name + " from the inventory?")) return;

                try {
                    await Api.deleteProduct(id);
                    await reload();
                    flash("\"" + name + "\" removed.");
                } catch (err) {
                    if (!handleAuthError(err)) alert(err.message);
                }
            }
        });
    }

    // --- Save All ---
    // One request for the whole table: the old version sent a request per row,
    // which looked frozen with a full catalog and could stop halfway through.
    var saveAllBtn = document.getElementById("save-all-btn");
    if (saveAllBtn && table) {
        saveAllBtn.addEventListener("click", async function () {
            var rows = Array.prototype.slice.call(table.querySelectorAll("tbody tr"));
            var items = [];

            for (const row of rows) {
                var data = readRow(row);
                var isNew = row.getAttribute("data-new") === "1";
                if (isNew && !data.name) continue; // blank new row: nothing to save
                items.push({ id: isNew ? null : Number(row.getAttribute("data-id")), name: data.name, category: data.category, price: data.price, stock: data.stock });
            }

            if (!items.length) {
                flash("There is nothing to save.");
                return;
            }

            var label = saveAllBtn.textContent;
            saveAllBtn.disabled = true;
            saveAllBtn.textContent = "Saving...";
            flash("Saving " + items.length + " item(s)...");

            try {
                var res = await Api.saveProducts(items);
                await reload();
                flash("Saved " + res.saved + " item(s)" + (res.added ? ", added " + res.added : "") + ".");
            } catch (err) {
                if (!handleAuthError(err)) flash(err.message);
            } finally {
                saveAllBtn.disabled = false;
                saveAllBtn.textContent = label;
            }
        });
    }

    // --- Add a blank row to fill in ---
    var addBtn = document.getElementById("add-item");
    if (addBtn && table) {
        addBtn.addEventListener("click", function () {
            var row = document.createElement("tr");
            row.setAttribute("data-new", "1");
            row.setAttribute("data-cat", activeCat === "All" ? "Cardiovascular" : activeCat);
            row.innerHTML =
                '<td><div class="inv-item">' +
                '<input class="inv-input" data-field="n" type="text" placeholder="Item name" /></div></td>' +
                '<td><input class="inv-input" data-field="c" type="text" placeholder="Category" /></td>' +
                '<td><input class="inv-input narrow" data-field="p" type="text" placeholder="0.00" /></td>' +
                '<td><input class="inv-input narrow" data-field="s" type="number" min="0" value="0" /></td>' +
                '<td><span class="badge badge-in">In stock</span></td>' +
                '<td><div class="row-actions">' +
                '<button type="button" class="icon-btn icon-save">Save</button>' +
                '<button type="button" class="icon-btn icon-del">Delete</button>' +
                "</div></td>";
            tbody.insertBefore(row, tbody.firstChild);
            row.querySelector('[data-field="n"]').focus();
            updateStats();
            flash("Fill in the new item, then press Save.");
        });
    }

    // --- Optional: load the sample medicine catalog ---
    // It only fills in names, categories and prices at 0 stock, so nothing can be
    // sold until real stock is added. Items already in the inventory are kept.
    var importBtn = document.getElementById("import-catalog");
    if (importBtn && table) {
        importBtn.addEventListener("click", async function () {
            if (!confirm("Import the sample medicine list?\n\nItems you already have are kept, and every imported item starts at 0 stock, so nothing can be sold until you add stock.")) return;

            var label = importBtn.textContent;
            importBtn.disabled = true;
            importBtn.textContent = "Importing...";

            try {
                var res = await Api.importSampleCatalog();
                await reload();
                flash(res.imported
                    ? "Imported " + res.imported + " item(s) at 0 stock (" + res.skipped + " already in the inventory). Add your stock next."
                    : "Nothing to import: all " + res.total + " sample items are already in your inventory.");
            } catch (err) {
                if (!handleAuthError(err)) flash(err.message);
            } finally {
                importBtn.disabled = false;
                importBtn.textContent = label;
            }
        });
    }

    // --- Export the rows on screen to a CSV file ---
    var exportBtn = document.getElementById("export-btn");
    if (exportBtn && table) {
        function csvCell(value) {
            var text = String(value === undefined || value === null ? "" : value);
            return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }

        exportBtn.addEventListener("click", function () {
            // Only the rows the search box and category chip left visible.
            var rows = Array.prototype.slice.call(table.querySelectorAll("tbody tr"))
                .filter(function (row) { return row.style.display !== "none"; });

            if (!rows.length) {
                flash("There is nothing to export.");
                return;
            }

            var lines = ["Item,Category,Price,Stock,Status"];

            for (const row of rows) {
                // Values come from the loaded products, so this works on both the
                // read-only table (plain text cells) and the edit table (inputs).
                var item = null;
                var id = Number(row.getAttribute("data-id"));
                if (id) {
                    item = products.filter(function (p) { return p.id === id; })[0] || null;
                }
                var badge = row.querySelector(".badge");
                lines.push([
                    csvCell(item ? item.name : row.textContent),
                    csvCell(item ? item.category : row.getAttribute("data-cat")),
                    csvCell(item ? Api.round2(item.price).toFixed(2) : ""),
                    csvCell(item ? item.stock : ""),
                    csvCell(badge ? badge.textContent.trim() : "")
                ].join(","));
            }

            // The BOM keeps Excel from mangling accented characters.
            var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = "inventory-" + new Date().toISOString().slice(0, 10) + ".csv";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            flash("Exported " + rows.length + " item(s).");
        });
    }

    // --- Quick refresh (view page) ---
    var refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async function () {
            if (search) search.value = "";
            activeCat = "All";
            try {
                await reload();
                buildChips();
                flash("Inventory refreshed.");
            } catch (err) {
                handleAuthError(err);
            }
        });
    }

    async function init() {
        try {
            await Api.me();
        } catch (err) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return;
        }

        try {
            await reload();
            buildChips();
        } catch (err) {
            if (!handleAuthError(err)) {
                tbody.innerHTML = "<tr><td colspan=\"6\">Could not load inventory. " + esc(err.message) + "</td></tr>";
            }
        }
    }

    init();
})();