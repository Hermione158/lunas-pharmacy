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
    var currentDay = null;
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
        day: "the chosen day",
        all: "All Time"
    };

    function inputDay(date) {
        return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") +
            "-" + String(date.getDate()).padStart(2, "0");
    }

    function dayPhrase() {
        if (currentRange !== "day" || !currentDay) return RANGE_TEXT[currentRange].toLowerCase();
        var parts = currentDay.split("-");
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
            .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    }

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
            "Gross sales, discounts and net sales for " + dayPhrase() + ".";
    }

    // --- Compared with the window before this one ---
    // More money is good, so it shows green going up. More discount is not
    // good, so that card turns the other way round.
    function renderChange(id, current, previous, options) {
        var el = document.getElementById(id);
        if (!el) return;
        var opts = options || {};

        if (!previous) {
            el.textContent = "";
            el.className = "stat-change";
            return;
        }

        var cur = Number(current) || 0;
        var prev = Number(previous) || 0;

        if (prev === 0) {
            if (cur === 0) {
                el.textContent = "same as before";
                el.className = "stat-change flat";
            } else {
                el.textContent = "▲ new";
                el.className = "stat-change up";
            }
            return;
        }

        var pct = ((cur - prev) / Math.abs(prev)) * 100;
        var arrow = pct > 0.05 ? "▲" : pct < -0.05 ? "▼" : "—";
        el.textContent = arrow + " " + Math.abs(pct).toFixed(1) + "% vs previous";

        var cls = "stat-change";
        if (opts.neutral) {
            cls += " flat";
        } else if (opts.reverse) {
            cls += pct > 0.05 ? " down" : pct < -0.05 ? " up" : " flat";
        } else {
            cls += pct > 0.05 ? " up" : pct < -0.05 ? " down" : " flat";
        }
        el.className = cls;
    }

    function renderComparisons(stats) {
        var previous = stats.previous || null;
        renderChange("rep-gross-change", stats.gross, previous ? previous.gross : null);
        renderChange("rep-net-change", stats.net, previous ? previous.net : null);
        renderChange("rep-discount-change", stats.discount, previous ? previous.discount : null, { reverse: true });
        renderChange("rep-tx-change", stats.transactions, previous ? previous.transactions : null);
        renderChange("rep-units-change", stats.units, previous ? previous.units : null);
        renderChange("rep-avg-change", stats.average, previous ? previous.average : null, { neutral: true });
    }

    // --- How much went out in discounts, and on how many receipts ---
    function renderDiscountNote(stats) {
        var note = document.getElementById("rep-discount-note");
        if (!note) return;

        var gross = Number(stats.gross) || 0;
        var discount = Number(stats.discount) || 0;
        var receipts = Number(stats.discounted) || 0;

        if (!discount && !receipts) {
            note.textContent = "No discounts given";
            return;
        }

        var share = gross > 0 ? (discount / gross) * 100 : 0;
        note.textContent = share.toFixed(1) + "% of gross · " + receipts + " receipt" + (receipts === 1 ? "" : "s");
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

    // What one receipt was for: "Biogesic 500mg, Alnix 10mg". The quantity
    // has its own column, so the names stay uncluttered.
    function itemsLabel(sale) {
        var list = (Array.isArray(sale.items) ? sale.items : []).map(function (item) {
            var name = String(item.name || "").trim();
            return name;
        }).filter(Boolean);
        return list.length ? list.join(", ") : "—";
    }

    function renderTransactions(stats) {
        var tbody = document.querySelector("#rep-tx-table tbody");

        tbody.innerHTML = stats.sales.map(function (sale) {
            return "<tr>" +
                "<td>" + esc(sale.txNo) + "</td>" +
                "<td>" + esc(formatDate(sale.date)) + "</td>" +
                "<td>" + esc(sale.cashier) + "</td>" +
                "<td>" + esc(itemsLabel(sale)) + "</td>" +
                "<td>" + (Number(sale.units) || 0) + "</td>" +
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
        if (currentRange === "today" || currentRange === "day") return "hour";
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

    // Hours of the day in the shop's own wording: "5p" on the axis, "5:00 PM"
    // in a sentence.
    function hour12Label(h) {
        var n = h % 12;
        return (n === 0 ? 12 : n) + (h < 12 ? "a" : "p");
    }

    function hour12Full(h) {
        var n = h % 12;
        return (n === 0 ? 12 : n) + ":00 " + (h < 12 ? "AM" : "PM");
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
            var label = bucketLabel(b.bucket, grain);
            var gross = Number(b.gross) || 0;
            var tip = label + " · Net " + currency(net) +
                " · Gross " + currency(gross) + " · " + b.transactions + " transaction(s)";
            parts.push('<rect class="' + cls + '" data-label="' + esc(label) + '" data-net="' + net +
                '" data-gross="' + gross + '" data-tx="' + (Number(b.transactions) || 0) +
                '" aria-label="' + esc(tip) + '" x="' + x.toFixed(1) + '" y="' +
                (net > 0 ? y.toFixed(1) : (padT + innerH - 2).toFixed(1)) +
                '" width="' + barW.toFixed(1) + '" height="' + (net > 0 ? h.toFixed(1) : 2) +
                '" rx="3"></rect>');
            if (i % labelEvery === 0) {
                parts.push('<text class="axis-label" x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - padB + 20) +
                    '" text-anchor="middle">' + esc(label) + "</text>");
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
            var revenue = Number(slice.revenue) || 0;
            var pct = total > 0 ? (revenue / total) * 100 : 0;
            var length = total > 0 ? (revenue / total) * circle : 0;
            parts.push('<circle class="rep-slice" data-i="' + i + '" data-name="' + esc(slice.category) +
                '" data-revenue="' + revenue + '" data-pct="' + pct.toFixed(1) +
                '" cx="100" cy="100" r="' + radius + '" fill="none" stroke="' +
                CHART_COLORS[i % CHART_COLORS.length] + '" stroke-width="' + thickness +
                '" stroke-dasharray="' + length.toFixed(2) + " " + (circle - length).toFixed(2) +
                '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 100 100)" aria-label="' +
                esc(slice.category + " · " + currency(slice.revenue)) + '"></circle>');
            offset += length;
        });

        parts.push('<text class="pie-label" id="rep-pie-center-label" x="100" y="94" text-anchor="middle">Net sales</text>');
        parts.push('<text class="pie-total" id="rep-pie-center-total" x="100" y="118" text-anchor="middle">' + esc(currency(total)) + "</text>");
        parts.push("</svg>");

        var legend = '<ul class="rep-pie-legend">';
        slices.forEach(function (slice, i) {
            var pct = total > 0 ? (Number(slice.revenue) / total) * 100 : 0;
            legend += '<li data-i="' + i + '">' +
                '<span class="rep-pie-dot" style="background:' + CHART_COLORS[i % CHART_COLORS.length] + '"></span>' +
                '<span class="rep-pie-name">' + esc(slice.category) + "</span>" +
                '<span class="rep-pie-value">' + esc(currency(slice.revenue)) + "</span>" +
                '<span class="rep-pie-pct">' + pct.toFixed(1) + "%</span>" +
                "</li>";
        });
        legend += "</ul>";

        wrap.setAttribute("data-total", currency(total));
        wrap.innerHTML = parts.join("") + legend;

        if (insight) {
            var first = slices[0];
            var firstPct = total > 0 ? (Number(first.revenue) / total) * 100 : 0;
            insight.textContent = "Biggest share: " + first.category + " at " + firstPct.toFixed(1) + "% of " + currency(total);
        }
    }

    // --- Hovering the charts: a bubble on the bars, a spotlight on the slices ---
    // One listener for the whole page: the charts are redrawn on every range
    // change, so binding to the drawings themselves would pile up handlers.
    var SVG_NS = "http://www.w3.org/2000/svg";

    function svgSize(svg) {
        var box = (svg.getAttribute("viewBox") || "0 0 320 116").split(/[\s,]+/);
        return { w: Number(box[2]) || 320, h: Number(box[3]) || 116 };
    }

    function clearBarTip(svg) {
        if (!svg) return;
        svg.classList.remove("spot");
        var hot = svg.querySelector("rect[data-label].hot");
        if (hot) hot.classList.remove("hot");
        var tip = svg.querySelector(".mini-tip");
        if (tip) tip.remove();
    }

    function showBarTip(rect) {
        var svg = rect.closest("svg");
        if (!svg) return;
        clearBarTip(svg);

        rect.classList.add("hot");
        svg.classList.add("spot");

        var size = svgSize(svg);
        var x = Number(rect.getAttribute("x")) || 0;
        var y = Number(rect.getAttribute("y")) || 0;
        var w = Number(rect.getAttribute("width")) || 0;

        var label = (rect.getAttribute("data-label") || "").trim();
        var net = Number(rect.getAttribute("data-net")) || 0;
        var gross = Number(rect.getAttribute("data-gross")) || 0;
        var sales = Number(rect.getAttribute("data-tx")) || 0;
        var value = label + " · " + currency(net) +
            (gross > 0 ? " · gross " + currency(gross) : "") +
            " · " + sales + " sale" + (sales === 1 ? "" : "s");

        var g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("class", "mini-tip");
        g.setAttribute("pointer-events", "none");

        var bg = document.createElementNS(SVG_NS, "rect");
        bg.setAttribute("class", "mini-tip-bg");
        bg.setAttribute("rx", "5");
        bg.setAttribute("height", "20");

        var text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("class", "mini-tip-text");
        text.setAttribute("text-anchor", "middle");
        text.textContent = value;

        g.appendChild(bg);
        g.appendChild(text);
        svg.appendChild(g);

        // The browser knows the text's real width; the fallback keeps the
        // chart readable in environments that cannot measure SVG text.
        var textW = 0;
        try { textW = text.getComputedTextLength(); } catch (err) { textW = 0; }
        if (!(textW > 0)) textW = value.length * 6.2;

        var bubbleW = textW + 16;
        var bubbleX = Math.max(3, Math.min(size.w - bubbleW - 3, x + w / 2 - bubbleW / 2));
        var bubbleY = Math.max(2, Math.min(size.h - 22, y - 26));

        bg.setAttribute("x", bubbleX.toFixed(1));
        bg.setAttribute("y", bubbleY.toFixed(1));
        bg.setAttribute("width", bubbleW.toFixed(1));
        text.setAttribute("x", (bubbleX + bubbleW / 2).toFixed(1));
        text.setAttribute("y", (bubbleY + 14).toFixed(1));
    }

    function clearPie(wrap) {
        if (!wrap) return;
        var svg = wrap.querySelector("svg");
        if (svg) svg.classList.remove("spot");
        wrap.querySelectorAll("circle.rep-slice").forEach(function (slice) { slice.classList.remove("hot"); });

        var legend = wrap.querySelector(".rep-pie-legend");
        if (legend) {
            legend.classList.remove("spot");
            legend.querySelectorAll("li").forEach(function (li) { li.classList.remove("hot"); });
        }

        var label = document.getElementById("rep-pie-center-label");
        var total = document.getElementById("rep-pie-center-total");
        if (label) label.textContent = "Net sales";
        if (total) total.textContent = wrap.getAttribute("data-total") || total.textContent;
    }

    function highlightPie(wrap, index) {
        if (!wrap) return;
        clearPie(wrap);

        var slice = wrap.querySelector('circle.rep-slice[data-i="' + index + '"]');
        if (!slice) return;

        var svg = wrap.querySelector("svg");
        if (svg) svg.classList.add("spot");
        wrap.querySelectorAll("circle.rep-slice").forEach(function (other) {
            other.classList.toggle("hot", other === slice);
        });

        var legend = wrap.querySelector(".rep-pie-legend");
        if (legend) {
            legend.classList.add("spot");
            legend.querySelectorAll("li").forEach(function (li) {
                li.classList.toggle("hot", li.getAttribute("data-i") === index);
            });
        }

        var name = slice.getAttribute("data-name") || "";
        var revenue = Number(slice.getAttribute("data-revenue")) || 0;
        var pct = Number(slice.getAttribute("data-pct")) || 0;
        var label = document.getElementById("rep-pie-center-label");
        var total = document.getElementById("rep-pie-center-total");
        if (label) label.textContent = name.length > 16 ? name.slice(0, 15) + "…" : name;
        if (total) total.textContent = currency(revenue) + " · " + pct.toFixed(1) + "%";
    }

    document.addEventListener("mouseover", function (e) {
        var target = e.target;
        if (!target || !target.closest) return;

        var rect = target.closest("svg rect[data-label]");
        if (rect) { showBarTip(rect); return; }

        var slice = target.closest("#rep-pie circle.rep-slice");
        var legendRow = target.closest("#rep-pie .rep-pie-legend li[data-i]");
        if (slice || legendRow) {
            highlightPie(target.closest("#rep-pie"), slice ? slice.getAttribute("data-i") : legendRow.getAttribute("data-i"));
        }
    });

    document.addEventListener("mouseout", function (e) {
        var target = e.target;
        if (!target || !target.closest) return;

        var rect = target.closest("svg rect[data-label]");
        if (rect) {
            var svg = rect.closest("svg");
            var to = e.relatedTarget;
            if (to && to.closest && to.closest("svg rect[data-label]") && to.closest("svg") === svg) return;
            clearBarTip(svg);
            return;
        }

        var inPie = target.closest("#rep-pie circle.rep-slice, #rep-pie .rep-pie-legend li[data-i]");
        if (!inPie) return;

        var next = e.relatedTarget;
        if (next && next.closest && next.closest("#rep-pie circle.rep-slice, #rep-pie .rep-pie-legend li[data-i]")) return;
        clearPie(target.closest("#rep-pie"));
    });

    // A small bar chart: many bars, little space, just enough to see the shape.
    function renderMiniBars(el, buckets, options) {
        if (!el) return;
        var opts = options || {};
        var W = 320, H = 116, padT = 8, padB = 20;
        var innerH = H - padT - padB;

        var max = 0;
        var best = 0;
        buckets.forEach(function (b, i) {
            var net = Number(b.net) || 0;
            if (net > max) { max = net; best = i; }
        });
        var top = niceMax(max);

        var slot = W / buckets.length;
        var barW = Math.max(3, Math.min(30, slot * 0.62));
        var labelEvery = opts.labelEvery || 1;

        var parts = [];
        buckets.forEach(function (b, i) {
            var net = Number(b.net) || 0;
            var h = max > 0 ? (net / top) * innerH : 0;
            var x = slot * i + (slot - barW) / 2;
            var y = padT + innerH - h;
            var cls = i === best ? "mini-bar best" : net > 0 ? "mini-bar" : "mini-bar zero";
            var tip = b.label + " · " + currency(net) + " · " + b.transactions + " transaction(s)";
            parts.push('<rect class="' + cls + '" data-label="' + esc(b.label) + '" data-net="' + net +
                '" data-tx="' + (Number(b.transactions) || 0) + '" aria-label="' + esc(tip) + '" x="' + x.toFixed(1) + '" y="' +
                (net > 0 ? y.toFixed(1) : (padT + innerH - 2).toFixed(1)) + '" width="' + barW.toFixed(1) +
                '" height="' + (net > 0 ? h.toFixed(1) : 2) + '" rx="2"></rect>');
            if (i % labelEvery === 0) {
                parts.push('<text class="axis-label" x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 6) +
                    '" text-anchor="middle">' + esc(b.label) + "</text>");
            }
        });

        parts.push('<line class="mini-baseline" x1="2" y1="' + (padT + innerH) +
            '" x2="' + (W - 2) + '" y2="' + (padT + innerH) + '"></line>');

        el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(opts.aria || "Sales") + '">' +
            parts.join("") + "</svg>";
    }

    // --- When the shop is busy: all time, the pattern of the business ---
    var WEEKDAY_NAMES = {
        "1": "Sunday", "2": "Monday", "3": "Tuesday", "4": "Wednesday",
        "5": "Thursday", "6": "Friday", "7": "Saturday"
    };

    function renderBusy(stats) {
        var hoursEl = document.getElementById("rep-hours");
        var daysEl = document.getElementById("rep-weekdays");
        var insight = document.getElementById("rep-busy-insight");
        var empty = document.getElementById("rep-busy-empty");
        if (!hoursEl) return;

        var busy = stats.busy || {};
        var byHour = Array.isArray(busy.byHour) ? busy.byHour : [];
        var byWeekday = Array.isArray(busy.byWeekday) ? busy.byWeekday : [];

        if (!byHour.length && !byWeekday.length) {
            hoursEl.innerHTML = "";
            daysEl.innerHTML = "";
            if (empty) empty.style.display = "block";
            if (insight) insight.textContent = "";
            return;
        }
        if (empty) empty.style.display = "none";

        // Every hour of the day, even the quiet ones.
        var hourLookup = {};
        byHour.forEach(function (b) { hourLookup[String(b.bucket)] = b; });
        var hours = [];
        for (var h = 0; h < 24; h++) {
            var key = String(h);
            var found = hourLookup[key] || { bucket: key, net: 0, transactions: 0 };
            hours.push({
                hour: h,
                label: hour12Label(h),
                full: hour12Full(h),
                net: Number(found.net) || 0,
                transactions: Number(found.transactions) || 0
            });
        }

        // Monday first, the way a week is read.
        var dayLookup = {};
        byWeekday.forEach(function (b) { dayLookup[String(b.bucket)] = b; });
        var days = [];
        ["2", "3", "4", "5", "6", "7", "1"].forEach(function (key) {
            var found = dayLookup[key] || { bucket: key, net: 0, transactions: 0 };
            days.push({
                label: WEEKDAY_NAMES[key].slice(0, 3),
                full: WEEKDAY_NAMES[key],
                net: Number(found.net) || 0,
                transactions: Number(found.transactions) || 0
            });
        });

        renderMiniBars(hoursEl, hours, { labelEvery: 3, aria: "Net sales by hour of the day" });
        renderMiniBars(daysEl, days, { labelEvery: 1, aria: "Net sales by day of the week" });

        var bestHour = hours.reduce(function (a, b) { return Number(b.net) > Number(a.net) ? b : a; }, hours[0]);
        var bestDay = days.reduce(function (a, b) { return Number(b.net) > Number(a.net) ? b : a; }, days[0]);
        if (insight) {
            insight.innerHTML = "Rush hour: <strong>" + esc(bestHour.full) + "</strong> · Biggest day: <strong>" +
                esc(bestDay.full) + "</strong>";
        }
    }

    // --- The items that did not move ---
    // The list takes room, so the card stays a one-line summary until the
    // admin asks for it. The choice survives a change of period.
    var deadCollapsed = true;
    var deadCount = 0;

    function syncDeadCollapse() {
        var body = document.getElementById("rep-dead-body");
        var toggle = document.getElementById("rep-dead-toggle");
        if (body) body.hidden = deadCollapsed || !deadCount;
        if (toggle) {
            var hasList = deadCount > 0;
            toggle.style.display = hasList ? "" : "none";
            toggle.textContent = deadCollapsed ? "Show list" : "Hide list";
            toggle.setAttribute("aria-expanded", deadCollapsed ? "false" : "true");
        }
    }

    function renderDeadStock(stats) {
        var tbody = document.querySelector("#rep-dead-table tbody");
        var empty = document.getElementById("rep-dead-empty");
        var note = document.getElementById("rep-dead-note");
        if (!tbody) return;

        var dead = stats.dead && Array.isArray(stats.dead.items) ? stats.dead.items : [];
        var total = stats.dead && Number(stats.dead.total) || dead.length;

        tbody.innerHTML = dead.map(function (d) {
            return "<tr>" +
                "<td>" + esc(d.name) + "</td>" +
                "<td>" + esc(d.category) + "</td>" +
                "<td>" + d.stock + "</td>" +
                "</tr>";
        }).join("");

        if (empty) empty.style.display = dead.length ? "none" : "block";
        if (note) {
            note.textContent = total
                ? total + " item" + (total === 1 ? "" : "s") + " did not sell in this period" +
                  (total > dead.length ? " (showing " + dead.length + ")" : "")
                : "Everything sold in this period.";
        }

        deadCount = total;
        syncDeadCollapse();
    }

    // --- What will run out, and when ---
    // A shelf is worth watching when it holds very little, or when it will
    // empty within a month at the speed it is selling right now. The speed is
    // the faster of the last 7 days and the last 30, so a busy week is never
    // hidden by a quiet month.

    // One number for the whole app: the shelves the product list calls "low
    // stock" are the same shelves this card watches.
    function lowStockLimit() {
        return (typeof Api !== "undefined" && Api.LOW_STOCK) ? Api.LOW_STOCK : 20;
    }

    function runningOutRows(stats) {
        var velocity = Array.isArray(stats.velocity) ? stats.velocity : [];
        var low = lowStockLimit();

        return velocity.map(function (v) {
            var stock = Number(v.stock) || 0;
            var sold30 = Number(v.sold30) || 0;
            var sold7 = Number(v.sold7) || 0;
            var rate = Math.max(sold30 / 30, sold7 / 7);
            return {
                name: v.name,
                stock: stock,
                sold30: sold30,
                sold7: sold7,
                rate: rate,
                days: rate > 0 ? stock / rate : Infinity
            };
        }).filter(function (v) {
            return v.stock < low || (v.rate > 0 && v.days < 31);
        }).sort(function (a, b) {
            // Soonest to empty first. The ones that never sell come last.
            var ka = a.rate > 0 ? Math.min(a.days, 100000) : 100000;
            var kb = b.rate > 0 ? Math.min(b.days, 100000) : 100000;
            if (ka !== kb) return ka - kb;
            if (a.stock !== b.stock) return a.stock - b.stock;
            return String(a.name).localeCompare(String(b.name));
        });
    }

    function runningOutStatus(v) {
        if (v.rate <= 0) return { cls: "badge badge-flat", label: "not selling", days: "" };
        if (v.days < 1) return { cls: "badge badge-out", label: "gone", days: "0.0" };
        if (v.days < 7) return { cls: "badge badge-out", label: "~" + Math.round(v.days) + " days", days: v.days.toFixed(1) };
        if (v.days < 31) return { cls: "badge badge-low", label: "~" + Math.round(v.days) + " days", days: v.days.toFixed(1) };
        return { cls: "badge badge-low", label: "low stock", days: v.days.toFixed(1) };
    }

    function renderRunningOut(stats) {
        var tbody = document.querySelector("#rep-cover-table tbody");
        var empty = document.getElementById("rep-cover-empty");
        var note = document.getElementById("rep-cover-note");
        if (!tbody) return;

        var rows = runningOutRows(stats);

        tbody.innerHTML = rows.slice(0, 20).map(function (v) {
            var st = runningOutStatus(v);
            return "<tr>" +
                "<td>" + esc(v.name) + "</td>" +
                "<td>" + v.stock + "</td>" +
                "<td>" + v.sold7 + "</td>" +
                "<td>" + v.sold30 + "</td>" +
                '<td><span class="' + st.cls + '">' + st.label + "</span></td>" +
                "</tr>";
        }).join("");

        if (empty) empty.style.display = rows.length ? "none" : "block";
        if (note) {
            note.textContent = rows.length
                ? "Shelves with less than " + lowStockLimit() + ", or that empty within a month at the faster of the last 7 days and the last 30" +
                  (rows.length > 20 ? " (showing the 20 soonest of " + rows.length + ")" : "")
                : "No shelf is running low.";
        }
    }

    async function render() {
        var stats;
        try {
            stats = await Api.getStats(currentRange, currentDay);
        } catch (err) {
            lastStats = null;
            if (!handleAuthError(err)) {
                document.getElementById("range-label").textContent = "Could not load reports. " + err.message;
            }
            return;
        }

        lastStats = stats;
        renderTotals(stats);
        renderComparisons(stats);
        renderDiscountNote(stats);
        renderTop(stats);
        renderTransactions(stats);
        renderSeriesChart(stats);
        renderCategoryPie(stats);
        renderBusy(stats);
        renderDeadStock(stats);
        renderRunningOut(stats);
        applyTableFilters();
    }

    // --- Search boxes on the tables ---
    // Each box filters the table it names as the admin types, so a sale or a
    // record can be found by any word that appears in its row.
    function applyTableFilters() {
        document.querySelectorAll("input[data-filter-table]").forEach(function (input) {
            var table = document.getElementById(input.getAttribute("data-filter-table"));
            var tbody = table ? table.querySelector("tbody") : null;
            if (!tbody) return;

            var term = input.value.trim().toLowerCase();
            var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr"));
            var shown = 0;

            rows.forEach(function (row) {
                var show = !term || row.textContent.toLowerCase().indexOf(term) !== -1;
                row.style.display = show ? "" : "none";
                if (show) shown++;
            });

            var empty = document.getElementById(input.getAttribute("data-filter-table").replace(/-table$/, "") + "-filter-empty");
            if (empty) empty.style.display = term && rows.length && !shown ? "block" : "none";
        });
    }

    document.querySelectorAll("input[data-filter-table]").forEach(function (input) {
        input.addEventListener("input", applyTableFilters);
    });

    var deadToggle = document.getElementById("rep-dead-toggle");
    if (deadToggle) {
        deadToggle.addEventListener("click", function () {
            deadCollapsed = !deadCollapsed;
            syncDeadCollapse();
        });
    }

    document.getElementById("rep-ranges").querySelectorAll(".chip").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var next = btn.getAttribute("data-range");
            var dayInput = document.getElementById("rep-day");
            if (next === "day") {
                if (!currentDay) currentDay = inputDay(new Date());
                if (dayInput) {
                    dayInput.value = currentDay;
                    try { dayInput.showPicker(); } catch (err) { dayInput.focus(); }
                }
            }
            currentRange = next;
            document.getElementById("rep-ranges").querySelectorAll(".chip").forEach(function (c) {
                c.classList.toggle("active", c === btn);
            });
            render();
        });
    });

    var dayPicker = document.getElementById("rep-day");
    if (dayPicker) {
        dayPicker.addEventListener("change", function () {
            if (!dayPicker.value) return;
            currentDay = dayPicker.value;
            currentRange = "day";
            document.getElementById("rep-ranges").querySelectorAll(".chip").forEach(function (c) {
                c.classList.toggle("active", c.getAttribute("data-range") === "day");
            });
            render();
        });
    }

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

            // --- Section 2: compared with the window before ---
            lines.push(["Compared With Previous Period"].map(csvCell).join(","));
            lines.push(["Gross Sales", "Discounts", "Net Sales", "Transactions", "Items Sold"].map(csvCell).join(","));
            if (stats.previous) {
                lines.push([
                    money(stats.previous.gross),
                    money(stats.previous.discount),
                    money(stats.previous.net),
                    stats.previous.transactions,
                    stats.previous.units
                ].join(","));
            } else {
                lines.push(["-", "No earlier period to compare with.", "", "", ""].join(","));
            }
            lines.push("");

            // --- Section 3: the discounts ---
            lines.push(["Discounts"].map(csvCell).join(","));
            lines.push(["Discounted Amount", "% of Gross", "Discounted Receipts"].map(csvCell).join(","));
            lines.push([
                money(stats.discount),
                (Number(stats.gross) > 0 ? ((Number(stats.discount) / Number(stats.gross)) * 100).toFixed(2) : "0.00"),
                stats.discounted || 0
            ].join(","));
            lines.push("");

            // --- Section 4: when the shop is busy ---
            lines.push(["When We're Busy (All Time)"].map(csvCell).join(","));
            lines.push(["Hour", "Net Sales", "Transactions"].map(csvCell).join(","));
            var busy = stats.busy || {};
            var hourRows = Array.isArray(busy.byHour) ? busy.byHour : [];
            if (hourRows.length) {
                hourRows.forEach(function (b) {
                    lines.push([(String(b.bucket).length < 2 ? "0" : "") + b.bucket + ":00", money(b.net), b.transactions].join(","));
                });
            } else {
                lines.push(["-", "No sales recorded yet.", ""].join(","));
            }
            lines.push("");
            lines.push(["Day", "Net Sales", "Transactions"].map(csvCell).join(","));
            var dayRows = Array.isArray(busy.byWeekday) ? busy.byWeekday : [];
            if (dayRows.length) {
                dayRows.forEach(function (b) {
                    lines.push([WEEKDAY_NAMES[String(b.bucket)] || b.bucket, money(b.net), b.transactions].join(","));
                });
            } else {
                lines.push(["-", "No sales recorded yet.", ""].join(","));
            }
            lines.push("");

            // --- Section 5: the dead stock ---
            lines.push(["Dead Stock"].map(csvCell).join(","));
            lines.push(["Item", "Category", "Stock"].map(csvCell).join(","));
            var deadItems = stats.dead && Array.isArray(stats.dead.items) ? stats.dead.items : [];
            if (deadItems.length) {
                deadItems.forEach(function (d) {
                    lines.push([csvCell(d.name), csvCell(d.category), d.stock].join(","));
                });
            } else {
                lines.push(["-", "Everything sold in this period.", ""].join(","));
            }
            lines.push("");

            // --- Section 6: what is running out ---
            lines.push(["Running Out Soon"].map(csvCell).join(","));
            lines.push(["Item", "Stock", "Sold (7 days)", "Sold (30 days)", "Days of Cover", "Status"].map(csvCell).join(","));
            var cover = runningOutRows(stats);
            if (cover.length) {
                cover.forEach(function (v) {
                    var st = runningOutStatus(v);
                    lines.push([csvCell(v.name), v.stock, v.sold7, v.sold30, st.days, st.label].join(","));
                });
            } else {
                lines.push(["-", "Nothing is running out.", "", "", "", ""].join(","));
            }
            lines.push("");

            // --- Section 7: sales over time ---
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

            // --- Section 8: sales by category ---
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

            // --- Section 9: most sold items ---
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

            // --- Section 10: the transactions ---
            lines.push(["Transactions"].map(csvCell).join(","));
            lines.push(["Sale No.", "Date", "Cashier", "Items", "Quantity", "Gross", "Discount %", "Discount", "Net"].map(csvCell).join(","));
            if (stats.sales.length) {
                stats.sales.forEach(function (sale) {
                    lines.push([
                        csvCell(sale.txNo),
                        csvCell(sale.date),
                        csvCell(sale.cashier),
                        csvCell(itemsLabel(sale)),
                        Number(sale.units) || 0,
                        money(sale.gross),
                        Api.round2(Number(sale.discountPct) || 0).toFixed(2),
                        money(sale.discount),
                        money(sale.net)
                    ].join(","));
                });
            } else {
                lines.push(["-", "", "", "", "", "No transactions in this period.", "", "", ""].join(","));
            }

            // The BOM keeps Excel from mangling accented characters.
            var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = "sales-report-" +
                (currentRange === "day" && currentDay ? "day-" + currentDay : currentRange) + "-" +
                new Date().toISOString().slice(0, 10) + ".csv";
            document.body.appendChild(link);
            link.click();
            URL.revokeObjectURL(url);

            flash("Exported " + stats.sales.length + " transaction(s) for " + dayPhrase() + ".");
        });
    }

    var printBtn = document.getElementById("rep-print-btn");
    if (printBtn) {
        printBtn.addEventListener("click", function () {
            window.print();
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