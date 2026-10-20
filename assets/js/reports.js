(function () {
    "use strict";

    var role = sessionStorage.getItem("luna_user");

    // --- Access guard: sales reports are admin only ---
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

    // --- Statistical analysis: the graphs ---
    // The numbers behind them come from the database as ready-made buckets,
    // so these stay right even when there are millions of transactions.
    var CHART_COLORS = ["#382449", "#7b4fa6", "#d98b9c", "#e6a5b4", "#4a7c59", "#c9a227", "#6d5a75", "#9c6b7d"];

    function compactMoney(n) {
        var v = Number(n) || 0;
        if (Math.abs(v) >= 1000000) return "₱" + (v / 1000000).toFixed(1) + "M";
        if (Math.abs(v) >= 1000) return "₱" + (v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1) + "k";
        return "₱" + v.toFixed(0);
    }

    function localDateKey(d) {
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function monthKey(d) {
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function grainOf(stats) {
        if (stats && stats.grain) return stats.grain;
        if (currentRange === "today") return "hour";
        if (currentRange === "all") return "month";
        return "day";
    }

    // Every bucket the report should show, including the quiet ones, so the
    // graph never skips a day without a sale.
    function seriesBuckets(stats) {
        var series = Array.isArray(stats.series) ? stats.series : [];
        var grain = grainOf(stats);
        var byKey = {};
        series.forEach(function (s) { byKey[String(s.bucket)] = s; });

        function blank(key) {
            return { bucket: key, gross: 0, discount: 0, net: 0, transactions: 0 };
        }

        var out = [];

        if (grain === "hour") {
            for (var h = 0; h < 24; h++) out.push(byKey[String(h)] || blank(String(h)));
            return out;
        }

        if (grain === "day") {
            var start = new Date();
            if (currentRange === "week") start.setDate(start.getDate() - start.getDay());
            else start.setDate(1);
            start.setHours(0, 0, 0, 0);
            var end = new Date();
            end.setHours(0, 0, 0, 0);
            for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                var key = localDateKey(d);
                out.push(byKey[key] || blank(key));
            }
            return out;
        }

        // Months: fill the quiet ones in between.
        var keys = Object.keys(byKey).sort();
        if (!keys.length) return out;
        var first = keys[0];
        var last = keys[keys.length - 1];
        var cursor = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1);
        var stop = new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1, 1);
        while (cursor <= stop) {
            var mkey = monthKey(cursor);
            out.push(byKey[mkey] || blank(mkey));
            cursor.setMonth(cursor.getMonth() + 1);
        }
        return out;
    }

    function bucketLabel(bucket, grain) {
        if (grain === "hour") {
            var h = Number(bucket) || 0;
            return (h < 10 ? "0" : "") + h + ":00";
        }
        if (grain === "month") {
            var m = bucket.split("-");
            return new Date(Number(m[0]), Number(m[1]) - 1, 1)
                .toLocaleDateString(undefined, { year: "numeric", month: "short" });
        }
        var p = bucket.split("-");
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
            .toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function niceMax(value) {
        if (!(value > 0)) return 1;
        var pow = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
        var n = value / pow;
        var mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
        return mult * pow;
    }

    // --- The bar chart: net sales over time ---
    function renderSeriesChart(stats) {
        var wrap = document.getElementById("rep-chart");
        var empty = document.getElementById("rep-chart-empty");
        var note = document.getElementById("rep-series-note");
        var insight = document.getElementById("rep-series-insight");
        if (!wrap) return;

        var grain = grainOf(stats);
        var buckets = seriesBuckets(stats);
        var hasSales = buckets.some(function (b) { return Number(b.net) !== 0 || Number(b.transactions) !== 0; });

        if (note) {
            note.textContent = "Net sales per " + (grain === "hour" ? "hour" : grain === "month" ? "month" : "day");
        }

        if (!hasSales) {
            wrap.innerHTML = "";
            wrap.style.display = "none";
            if (empty) empty.style.display = "block";
            if (insight) insight.textContent = "";
            return;
        }

        if (empty) empty.style.display = "none";
        wrap.style.display = "";

        var W = 720, H = 260;
        var padL = 62, padR = 14, padT = 16, padB = 40;
        var innerW = W - padL - padR;
        var innerH = H - padT - padB;

        var maxNet = 0;
        buckets.forEach(function (b) { if (Number(b.net) > maxNet) maxNet = Number(b.net); });
        var top = niceMax(maxNet);
        var slot = innerW / buckets.length;
        var barW = Math.max(3, Math.min(46, slot * 0.62));

        var parts = [];

        for (var g = 0; g <= 4; g++) {
            var y = padT + innerH - (innerH * g / 4);
            parts.push('<line class="grid-line" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"></line>');
            parts.push('<text class="axis-label" x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' +
                esc(compactMoney(top * g / 4)) + "</text>");
        }

        var labelEvery = buckets.length > 16 ? Math.ceil(buckets.length / 8) : buckets.length > 10 ? 2 : 1;

        buckets.forEach(function (b, i) {
            var net = Number(b.net) || 0;
            var h = Math.max(0, (net / top) * innerH);
            var x = padL + slot * i + (slot - barW) / 2;
            var y = padT + innerH - h;
            var cls = net > 0 ? "bar" : "bar-zero";
            var tip = bucketLabel(b.bucket, grain) + " · Net " + currency(net) +
                " · Gross " + currency(b.gross) + " · " + b.transactions + " transaction(s)";
            parts.push('<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + (net > 0 ? y.toFixed(1) : (padT + innerH - 2).toFixed(1)) +
                '" width="' + barW.toFixed(1) + '" height="' + (net > 0 ? h.toFixed(1) : 2) + '" rx="3"><title>' + esc(tip) + "</title></rect>");
            if (i % labelEvery === 0) {
                parts.push('<text class="axis-label" x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - padB + 20) +
                    '" text-anchor="middle">' + esc(bucketLabel(b.bucket, grain)) + "</text>");
            }
        });

        parts.push('<line class="grid-line" x1="' + padL + '" y1="' + (padT + innerH) + '" x2="' + (W - padR) + '" y2="' + (padT + innerH) + '"></line>');

        wrap.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Net sales over time">' +
            parts.join("") + "</svg>";

        // The one line that says what the graph means.
        var best = null;
        buckets.forEach(function (b) {
            if (!best || Number(b.net) > Number(best.net)) best = b;
        });
        var total = buckets.reduce(function (sum, b) { return sum + Number(b.net || 0); }, 0);
        if (insight) {
            insight.textContent = best && Number(best.net) > 0
                ? "Best " + (grain === "hour" ? "hour" : grain === "month" ? "month" : "day") + ": " +
                  bucketLabel(best.bucket, grain) + " with " + currency(best.net) + " · " + currency(total) + " in total"
                : "Total " + currency(total) + " in this period";
        }
    }

    // --- The pie chart: where the money comes from ---
    function renderCategoryPie(stats) {
        var wrap = document.getElementById("rep-pie");
        var empty = document.getElementById("rep-pie-empty");
        var insight = document.getElementById("rep-pie-insight");
        if (!wrap) return;

        var rows = Array.isArray(stats.categories)
            ? stats.categories.filter(function (c) { return Number(c.revenue) > 0; })
            : [];

        if (!rows.length) {
            wrap.innerHTML = "";
            wrap.style.display = "none";
            if (empty) empty.style.display = "block";
            if (insight) insight.textContent = "";
            return;
        }

        if (empty) empty.style.display = "none";
        wrap.style.display = "";

        var slices = rows.slice(0, 6);
        var rest = rows.slice(6);
        if (rest.length) {
            slices.push({
                category: "Other (" + rest.length + ")",
                revenue: rest.reduce(function (s, c) { return s + Number(c.revenue); }, 0),
                qty: rest.reduce(function (s, c) { return s + Number(c.qty); }, 0)
            });
        }

        var total = slices.reduce(function (s, c) { return s + Number(c.revenue); }, 0);
        var size = 200, radius = 68, thickness = 30;
        var circle = 2 * Math.PI * radius;
        var offset = 0;

        var parts = ['<svg viewBox="0 0 ' + size + " " + size + '" width="' + size + '" height="' + size +
            '" role="img" aria-label="Net sales by category">'];
        parts.push('<circle cx="100" cy="100" r="' + radius + '" fill="none" stroke="#f3e2e8" stroke-width="' + thickness + '"></circle>');

        slices.forEach(function (slice, i) {
            var length = total > 0 ? (Number(slice.revenue) / total) * circle : 0;
            parts.push('<circle cx="100" cy="100" r="' + radius + '" fill="none" stroke="' +
                CHART_COLORS[i % CHART_COLORS.length] + '" stroke-width="' + thickness +
                '" stroke-dasharray="' + length.toFixed(2) + " " + (circle - length).toFixed(2) +
                '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 100 100)"><title>' +
                esc(slice.category + " · " + currency(slice.revenue)) + "</title></circle>");
            offset += length;
        });

        parts.push('<text class="pie-label" x="100" y="94" text-anchor="middle">Net sales</text>');
        parts.push('<text class="pie-total" x="100" y="118" text-anchor="middle">' + esc(currency(total)) + "</text>");
        parts.push("</svg>");

        var legend = '<ul class="rep-pie-legend">';
        slices.forEach(function (slice, i) {
            var pct = total > 0 ? (Number(slice.revenue) / total) * 100 : 0;
            legend += "<li>" +
                '<span class="rep-pie-dot" style="background:' + CHART_COLORS[i % CHART_COLORS.length] + '"></span>' +
                '<span class="rep-pie-name">' + esc(slice.category) + "</span>" +
                '<span class="rep-pie-value">' + esc(currency(slice.revenue)) + "</span>" +
                '<span class="rep-pie-pct">' + pct.toFixed(1) + "%</span>" +
                "</li>";
        });
        legend += "</ul>";

        wrap.innerHTML = parts.join("") + legend;

        if (insight) {
            var first = slices[0];
            var firstPct = total > 0 ? (Number(first.revenue) / total) * 100 : 0;
            insight.textContent = "Biggest share: " + first.category + " at " + firstPct.toFixed(1) + "% of " + currency(total);
        }
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
        renderSeriesChart(stats);
        renderCategoryPie(stats);
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

            // --- Section 2: sales over time ---
            lines.push(["Sales Over Time"].map(csvCell).join(","));
            lines.push(["Bucket", "Gross", "Discount", "Net", "Transactions"].map(csvCell).join(","));
            var buckets = seriesBuckets(stats);
            if (buckets.length) {
                buckets.forEach(function (b) {
                    lines.push([
                        csvCell(bucketLabel(b.bucket, grainOf(stats))),
                        money(b.gross),
                        money(b.discount),
                        money(b.net),
                        b.transactions
                    ].join(","));
                });
            } else {
                lines.push(["-", "No sales recorded in this period.", "", "", ""].join(","));
            }
            lines.push("");

            // --- Section 3: sales by category ---
            lines.push(["Sales by Category"].map(csvCell).join(","));
            lines.push(["Category", "Qty Sold", "Revenue"].map(csvCell).join(","));
            var categories = Array.isArray(stats.categories) ? stats.categories : [];
            if (categories.length) {
                categories.forEach(function (c) {
                    lines.push([csvCell(c.category), c.qty, money(c.revenue)].join(","));
                });
            } else {
                lines.push(["-", "No sales recorded in this period.", ""].join(","));
            }
            lines.push("");

            // --- Section 4: most sold items ---
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

            // --- Section 5: the transactions ---
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
        render();
    }

    bootstrap();
})();