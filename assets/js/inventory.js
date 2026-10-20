(function () {
    "use strict";

    var page = document.body.getAttribute("data-page") || "inventory";
    var role = sessionStorage.getItem("luna_user");

    // --- Access guard: the whole inventory area is admin only ---
    // The role is confirmed against the server in bootstrap() below.
    if (!role) {
        window.location.href = "login.html";
        return;
    }

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

    // Pictures attached to a new row, kept next to the row until it is saved.
    var rowImages = new WeakMap();

    // A file that is much larger than this is refused before it is read.
    var MAX_ATTACH_BYTES = 3 * 1024 * 1024;
    // The API accepts up to this many characters of picture data.
    var MAX_ATTACH_LENGTH = 500000;

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
            barcode: value("b").trim(),
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
                    '<td><input class="inv-input barcode-input" data-field="b" type="text" value="' + esc(p.barcode || "") + '" placeholder="Scan or type" /></td>' +
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

    // --- Attached pictures ---
    // The picture is stored with the item, so it is shrunk in the browser first
    // and kept as a small image in a data URL.
    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || "")); };
            reader.onerror = function () { reject(new Error("The picture could not be read.")); };
            reader.readAsDataURL(file);
        });
    }

    function canDraw() {
        var canvas = document.createElement("canvas");
        if (!canvas.getContext) return false;
        try {
            return !!canvas.getContext("2d");
        } catch (e) {
            return false;
        }
    }

    // Shrinks the picture to at most 640px on the long side, which keeps the
    // stored picture small enough to load quickly in the POS.
    function shrinkImage(file) {
        return readFileAsDataUrl(file).then(function (dataUrl) {
            if (!canDraw()) return dataUrl;
            return new Promise(function (resolve) {
                var img = new Image();
                img.onload = function () {
                    var w = img.naturalWidth || img.width;
                    var h = img.naturalHeight || img.height;
                    if (!w || !h) { resolve(dataUrl); return; }
                    var scale = Math.min(1, 640 / Math.max(w, h));
                    var canvas = document.createElement("canvas");
                    canvas.width = Math.max(1, Math.round(w * scale));
                    canvas.height = Math.max(1, Math.round(h * scale));
                    var ctx = canvas.getContext("2d");
                    if (!ctx) { resolve(dataUrl); return; }
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    var out = "";
                    try { out = canvas.toDataURL("image/jpeg", 0.82); } catch (e) { out = ""; }
                    resolve(out.indexOf("data:image/") === 0 ? out : dataUrl);
                };
                img.onerror = function () { resolve(dataUrl); };
                img.src = dataUrl;
            });
        });
    }

    function showAttached(row, dataUrl, fileName) {
        rowImages.set(row, dataUrl);
        var preview = row.querySelector(".inv-attach-preview");
        if (preview) preview.src = dataUrl;
        var label = row.querySelector(".inv-attach-name");
        if (label) label.textContent = fileName || "";
        var remove = row.querySelector(".inv-attach-remove");
        if (remove) remove.hidden = false;
    }

    function clearAttached(row) {
        rowImages.delete(row);
        var preview = row.querySelector(".inv-attach-preview");
        if (preview) preview.removeAttribute("src");
        var label = row.querySelector(".inv-attach-name");
        if (label) label.textContent = "";
        var input = row.querySelector('.inv-attach input[type="file"]');
        if (input) input.value = "";
        var remove = row.querySelector(".inv-attach-remove");
        if (remove) remove.hidden = true;
    }

    if (table) {
        table.addEventListener("change", function (e) {
            var input = e.target;
            if (!input || !input.matches || !input.matches('.inv-attach input[type="file"]')) return;
            var row = input.closest ? input.closest("tr") : null;
            if (!row) return;

            var file = input.files && input.files[0];
            if (!file) return;

            if (file.size > MAX_ATTACH_BYTES) {
                flash("That picture is too large. Pick one under 3 MB.");
                input.value = "";
                return;
            }
            if (file.type && file.type.indexOf("image/") !== 0) {
                flash("Pick a picture file (PNG, JPG, WEBP or GIF).");
                input.value = "";
                return;
            }

            shrinkImage(file).then(function (dataUrl) {
                if (!dataUrl) {
                    flash("That picture could not be read.");
                    return;
                }
                if (dataUrl.length > MAX_ATTACH_LENGTH) {
                    flash("That picture is too large to attach. Pick a smaller one.");
                    input.value = "";
                    return;
                }
                showAttached(row, dataUrl, file.name);
                flash("Picture attached. Press Save to keep it.");
            }).catch(function () {
                flash("That picture could not be read.");
            });
        });
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

        var shownName = isNew ? data.name : (row.getAttribute("data-name") || data.name);
        var goAhead = await showConfirm({
            title: isNew ? "Add this item?" : "Save this item?",
            message: isNew
                ? "Add \"" + data.name + "\" to the inventory?"
                : "Save changes to \"" + shownName + "\"?",
            confirmText: isNew ? "Yes, Add" : "Yes, Save"
        });
        if (!goAhead) return;

        try {
            if (isNew) {
                await Api.addProduct({
                    name: data.name,
                    barcode: data.barcode,
                    category: data.category,
                    price: data.price,
                    stock: data.stock,
                    image: rowImages.get(row) || ""
                });
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
            } else if (btn.classList.contains("inv-attach-remove")) {
                clearAttached(row);
                flash("Picture removed.");
            } else if (btn.classList.contains("icon-del")) {
                var id = Number(row.getAttribute("data-id"));
                if (!id) return;
                var name = row.getAttribute("data-name") || readRow(row).name;
                var goAhead = await showConfirm({
                    title: "Remove this item?",
                    message: "Remove \"" + name + "\" from the inventory? This cannot be undone.",
                    confirmText: "Yes, Remove"
                });
                if (!goAhead) return;

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
                // A picture is only sent for a new item. Existing rows keep the
                // picture they already have.
                items.push({
                    id: isNew ? null : Number(row.getAttribute("data-id")),
                    name: data.name,
                    barcode: data.barcode,
                    category: data.category,
                    price: data.price,
                    stock: data.stock,
                    image: isNew ? (rowImages.get(row) || "") : undefined
                });
            }

            if (!items.length) {
                flash("There is nothing to save.");
                return;
            }

            var goAhead = await showConfirm({
                title: "Save all changes?",
                message: "Save " + items.length + " item(s) to the inventory?",
                confirmText: "Yes, Save All"
            });
            if (!goAhead) return;

            var label = saveAllBtn.textContent;
            saveAllBtn.disabled = true;
            saveAllBtn.textContent = "Saving...";
            flash("Saving " + items.length + " item(s)...");

            try {
                var res = await Api.saveProducts(items);
                await reload();
                if (!res.saved) {
                    flash(res.unchanged ? "Nothing changed - " + res.unchanged + " item(s) are already up to date." : "There was nothing to save.");
                } else {
                    flash("Saved " + res.saved + " item(s)" +
                        (res.added ? ", added " + res.added : "") +
                        (res.unchanged ? ", " + res.unchanged + " already up to date" : "") + ".");
                }
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
                "<td>" +
                '<div class="inv-item">' +
                '<input class="inv-input" data-field="n" type="text" placeholder="Item name" /></div>' +
                '<div class="inv-attach">' +
                '<img class="inv-attach-preview" alt="" />' +
                '<label class="inv-attach-btn">Attach picture' +
                '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden /></label>' +
                '<span class="inv-attach-name"></span>' +
                '<button type="button" class="inv-attach-remove" hidden>Remove</button>' +
                "</div></td>" +
                '<td><input class="inv-input barcode-input" data-field="b" type="text" placeholder="Scan or type" /></td>' +
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
            var goAhead = await showConfirm({
                title: "Import the sample catalog?",
                message: "Items you already have are kept, and every imported item starts at 0 stock, so nothing can be sold until you add stock.",
                confirmText: "Yes, Import"
            });
            if (!goAhead) return;

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

        exportBtn.addEventListener("click", async function () {
            // Only the rows the search box and category chip left visible.
            var rows = Array.prototype.slice.call(table.querySelectorAll("tbody tr"))
                .filter(function (row) { return row.style.display !== "none"; });

            if (!rows.length) {
                flash("There is nothing to export.");
                return;
            }

            var goAhead = await showConfirm({
                title: "Export the inventory?",
                message: "Export " + rows.length + " visible item(s) as a CSV file?",
                confirmText: "Yes, Export"
            });
            if (!goAhead) return;

            var lines = ["Item,Barcode,Category,Price,Stock,Status"];

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
                    csvCell(item && item.barcode ? item.barcode : ""),
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

    function revealChrome() {
        // --- Show the signed-in role ---
        var roleLabel = document.getElementById("role-label");
        if (roleLabel) {
            roleLabel.textContent = "Administrator";
        }

        // --- Admin-only nav link ---
        document.querySelectorAll(".inv-admin-link").forEach(function (link) {
            link.style.display = "";
        });
    }

    async function bootstrap() {
        var me;
        try {
            me = await Api.me();
        } catch (err) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return;
        }

        role = me.user.role;
        sessionStorage.setItem("luna_user", role);
        sessionStorage.setItem("luna_name", me.user.username);

        if (role !== "admin") {
            window.location.href = "pos.html";
            return;
        }

        revealChrome();

        try {
            await reload();
            buildChips();
        } catch (err) {
            if (!handleAuthError(err)) {
                tbody.innerHTML = "<tr><td colspan=\"6\">Could not load inventory. " + esc(err.message) + "</td></tr>";
            }
        }
    }

    bootstrap();
})();