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

    function labelCard(p) {
        var barcode = p.barcode
            ? window.LunaBarcode.svg(p.barcode) + '<div class="label-code">' + esc(p.barcode) + "</div>"
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
