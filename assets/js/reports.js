(function () {
    "use strict";

    var role = sessionStorage.getItem("luna_user");

    // --- Access guard ---
    if (!role) {
        window.location.href = "login.html";
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

    function renderTransactions(stats) {
        var tbody = document.querySelector("#rep-tx-table tbody");

        tbody.innerHTML = stats.sales.map(function (sale) {
            return "<tr>" +
                "<td>" + esc(sale.txNo) + "</td>" +
                "<td>" + esc(formatDate(sale.date)) + "</td>" +
                "<td>" + esc(sale.cashier) + "</td>" +
                "<td>" + sale.units + "</td>" +
                "<td>" + currency(sale.gross) + "</td>" +
                "<td>" + currency(sale.discount) + "</td>" +
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
            if (!handleAuthError(err)) {
                document.getElementById("range-label").textContent = "Could not load reports. " + err.message;
            }
            return;
        }

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

    render();
})();