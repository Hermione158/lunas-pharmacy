(function () {
    "use strict";

    var role = sessionStorage.getItem("luna_user");

    // --- Access guard: labels are an admin tool ---
    // The role is confirmed against the server in bootstrap() below.
    if (!role) {
        window.location.href = "login.html";
        return;
    }

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
    var grid = document.getElementById("label-grid");
    var search = document.getElementById("label-search");
    var hint = document.getElementById("label-hint");
    var empty = document.getElementById("label-empty");
    var countEl = document.getElementById("label-count");
    var printBtn = document.getElementById("label-print-btn");

    function esc(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function money(n) {
        return "₱" + Number(n).toFixed(2);
    }

    function handleAuthError(err) {
        if (err && err.status === 401) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return true;
        }
        return false;
    }

    // --- Code 128 (subset B) barcode, rendered as SVG ---
    // The 107 standard patterns, 11 modules each. Index 106 (stop) is appended
    // separately because it is 13 modules long.
    var PATTERNS = [
        "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
        "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
        "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
        "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
        "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
        "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
        "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
        "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
        "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
        "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
        "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
        "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
        "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
        "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
        "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
        "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
        "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
        "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
        "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
        "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
        "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
        "11010011100"
    ];
    var STOP = "1100011101011";

    function code128Bits(text) {
        var data = [104]; // Start B
        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);
            if (code < 32 || code > 126) {
                throw new Error("Cannot draw \"" + text.charAt(i) + "\" as a barcode.");
            }
            data.push(code - 32);
        }

        var sum = 104;
        for (var j = 1; j < data.length; j++) sum += data[j] * j;
        data.push(sum % 103);

        return data.map(function (value) { return PATTERNS[value]; }).join("") + STOP;
    }

    function barcodeSvg(code) {
        var bits = code128Bits(code);
        var bars = [];
        var i = 0;
        while (i < bits.length) {
            if (bits.charAt(i) === "1") {
                var start = i;
                while (i < bits.length && bits.charAt(i) === "1") i++;
                bars.push('<rect x="' + start + '" y="0" width="' + (i - start) + '" height="46"></rect>');
            } else {
                i++;
            }
        }
        return '<svg class="label-barcode" viewBox="0 0 ' + bits.length + ' 46" preserveAspectRatio="none" ' +
            'fill="#111111" role="img" aria-label="Barcode ' + esc(code) + '">' + bars.join("") + "</svg>";
    }

    function labelCard(p) {
        var barcode = p.barcode
            ? barcodeSvg(p.barcode) + '<div class="label-code">' + esc(p.barcode) + "</div>"
            : '<div class="label-code">No barcode yet</div>';

        return '<div class="label-card" data-id="' + p.id + '">' +
            '<div class="label-name">' + esc(p.name) + "</div>" +
            '<div class="label-price">' + money(p.price) + "</div>" +
            barcode +
            "</div>";
    }

    function render() {
        var term = (search ? search.value : "").trim().toLowerCase();
        var visible = products.filter(function (p) {
            if (!term) return true;
            return (p.name || "").toLowerCase().indexOf(term) !== -1 ||
                (p.barcode || "").indexOf(term) !== -1;
        });

        grid.innerHTML = visible.map(labelCard).join("");
        if (countEl) countEl.textContent = visible.length;
        if (empty) empty.style.display = visible.length ? "none" : "block";
        if (hint) {
            hint.textContent = visible.length
                ? "Showing " + visible.length + " label(s). Print the sheet and cut along the dashed lines."
                : "";
        }
    }

    if (printBtn) {
        printBtn.addEventListener("click", function () {
            if (!products.length) {
                alert("There are no labels to print.");
                return;
            }
            window.print();
        });
    }

    if (search) search.addEventListener("input", render);

    function revealChrome() {
        var roleLabel = document.getElementById("role-label");
        if (roleLabel) roleLabel.textContent = "Administrator";

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
            products = await Api.getProducts();
        } catch (err) {
            if (handleAuthError(err)) return;
            if (hint) hint.textContent = "Could not load the inventory: " + err.message;
            return;
        }

        render();
    }

    bootstrap();
})();
