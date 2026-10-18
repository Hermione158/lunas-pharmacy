(function () {
    "use strict";

    var role = sessionStorage.getItem("luna_user");

    // --- Access guard: sales reports are admin only ---
    if (!role) {
        window.location.href = "login.html";
        return;
    }
    if (role !== "admin") {
        window.location.href = "pos.html";
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

    var currency = Api.currency;
    var currentRange = "all";
    var lastStats = null;

    // --- Status message next to the buttons that produce it ---
    var hint = document.getElementById("rep-hint");
    function flash(message) {
        if (!hint) return;
        hint.textContent = message;
        clearTimeout(flash._t);
        flash._t = setTimeout(function () { hint.textContent = ""; }, 2500);
    }

    var RANGE_TEXT = {
        today: "Today",
        week: "This Week",
        month: "This Month",
        all: "All Time"
    };

    function esc(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "—";
        return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
            " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }

    function handleAuthError(err) {
        if (err && err.status === 401) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return true;
        }
        return false;
    }

    function renderTotals(stats) {
        document.getElementById("rep-gross").textContent = currency(stats.gross);
        document.getElementById("rep-net").textContent = currency(stats.net);
        document.getElementById("rep-discount").textContent = currency(stats.discount);
        document.getElementById("rep-tx").textContent = stats.transactions;
        document.getElementById("rep-units").textContent = stats.units;
        document.getElementById("rep-avg").textContent = currency(stats.average);
        document.getElementById("range-label").textContent =
            "Gross sales, discounts and net sales for " + RANGE_TEXT[currentRange].toLowerCase() + ".";
    }

    function renderTop(stats) {
        var tbody = document.querySelector("#rep-top-table tbody");

        tbody.innerHTML = stats.top.map(function (item, i) {
            var rank = i + 1;
            var cls = rank === 1 ? "badge badge-in" : "badge";
            return "<tr>" +
                '<td><span class="' + cls + '">#' + rank + "</span></td>" +
                "<td>" + esc(item.name) + "</td>" +
                "<td>" + item.qty + "</td>" +
                "<td>" + currency(item.revenue) + "</td>" +
                "</tr>";
        }).join("");

        document.getElementById("rep-top-empty").style.display = stats.top.length ? "none" : "block";
    }

    // A sale shows the rate that was applied next to the money it saved. Sales made
    // before discounts were percentages have no rate, so they show the amount alone.
    function discountLabel(sale) {
        var pct = Number(sale.discountPct) || 0;
        var amount = Number(sale.discount) || 0;
        if (pct > 0) return Api.round2(pct) + "% (" + currency(amount) + ")";
        if (amount > 0) return currency(amount);
        return "—";
    }

    function renderTransactions(stats) {
        var tbody = document.querySelector("#rep-tx-table tbody");

        tbody.innerHTML = stats.sales.map(function (sale) {
            return "<tr>" +
                "<td>" + esc(sale.txNo) + "</td>" +
                "<td>" + esc(formatDate(sale.date)) + "</td>" +
                "<td>" + esc(sale.cashier) + "</td>" +
                "<td>" + sale.units + "</td>" +
                "<td>" + currency(sale.gross) + "</td>" +
                "<td>" + esc(discountLabel(sale)) + "</td>" +
                "<td>" + currency(sale.net) + "</td>" +
                "</tr>";
        }).join("");

        document.getElementById("rep-tx-empty").style.display = stats.sales.length ? "none" : "block";
    }

    async function render() {
        var stats;
        try {
            stats = await Api.getStats(currentRange);
        } catch (err) {
            lastStats = null;
            if (!handleAuthError(err)) {
                document.getElementById("range-label").textContent = "Could not load reports. " + err.message;
            }
            return;
        }

        lastStats = stats;
        renderTotals(stats);
        renderTop(stats);
        renderTransactions(stats);
    }

    document.getElementById("rep-ranges").querySelectorAll(".chip").forEach(function (btn) {
        btn.addEventListener("click", function () {
            currentRange = btn.getAttribute("data-range");
            document.getElementById("rep-ranges").querySelectorAll(".chip").forEach(function (c) {
                c.classList.toggle("active", c === btn);
            });
            render();
        });
    });

    // --- Export the report on screen to a CSV file ---
    var exportBtn = document.getElementById("rep-export-btn");
    if (exportBtn) {
        function csvCell(value) {
            var text = String(value === undefined || value === null ? "" : value);
            return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }

        function money(n) {
            return Api.round2(n).toFixed(2);
        }

        exportBtn.addEventListener("click", function () {
            if (!lastStats || (!lastStats.sales.length && !lastStats.top.length)) {
                flash("There is nothing to export.");
                return;
            }

            var stats = lastStats;
            var lines = [];

            // --- Section 1: the summary tiles ---
            lines.push(["Luna's Pharmacy - Sales Report"].map(csvCell).join(","));
            lines.push(["Range", RANGE_TEXT[currentRange]].map(csvCell).join(","));
            lines.push(["Exported", new Date().toISOString()].map(csvCell).join(","));
            lines.push(["Gross Sales", "Discounts", "Net Sales", "Transactions", "Items Sold", "Average Sale"].map(csvCell).join(","));
            lines.push([money(stats.gross), money(stats.discount), money(stats.net), stats.transactions, stats.units, money(stats.average)].map(csvCell).join(","));
            lines.push("");

            // --- Section 2: most sold items ---
            lines.push(["Most Sold Items"].map(csvCell).join(","));
            lines.push(["Rank", "Item", "Qty Sold", "Revenue"].map(csvCell).join(","));
            if (stats.top.length) {
                stats.top.forEach(function (item, i) {
                    lines.push([i + 1, csvCell(item.name), item.qty, money(item.revenue)].join(","));
                });
            } else {
                lines.push(["-", "No sales recorded in this period.", "", ""].join(","));
            }
            lines.push("");

            // --- Section 3: the transactions ---
            lines.push(["Transactions"].map(csvCell).join(","));
            lines.push(["Sale No.", "Date", "Cashier", "Items", "Gross", "Discount %", "Discount", "Net"].map(csvCell).join(","));
            if (stats.sales.length) {
                stats.sales.forEach(function (sale) {
                    lines.push([
                        csvCell(sale.txNo),
                        csvCell(sale.date),
                        csvCell(sale.cashier),
                        sale.units,
                        money(sale.gross),
                        Api.round2(Number(sale.discountPct) || 0).toFixed(2),
                        money(sale.discount),
                        money(sale.net)
                    ].join(","));
                });
            } else {
                lines.push(["-", "", "", "", "No transactions in this period.", "", ""].join(","));
            }

            // The BOM keeps Excel from mangling accented characters.
            var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = "sales-report-" + currentRange + "-" + new Date().toISOString().slice(0, 10) + ".csv";
            document.body.appendChild(link);
            link.click();
            URL.revokeObjectURL(url);

            flash("Exported " + stats.sales.length + " transaction(s) for " + RANGE_TEXT[currentRange].toLowerCase() + ".");
        });
    }

    render();
})();