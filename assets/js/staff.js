(function () {
    "use strict";

    // --- Logout ---
    document.querySelectorAll(".inv-logout").forEach(function (btn) {
        btn.addEventListener("click", async function () {
            btn.disabled = true;
            try {
                await Api.logout();
            } catch (err) {
                // Whether or not the server answered, the local session still goes.
            }
            sessionStorage.removeItem("luna_user");
            sessionStorage.removeItem("luna_name");
            window.location.href = "login.html";
        });
    });

    var greeting = document.getElementById("staff-greeting");

    function setStat(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    async function bootstrap() {
        var me;
        try {
            me = await Api.me();
        } catch (err) {
            sessionStorage.removeItem("luna_user");
            sessionStorage.removeItem("luna_name");
            window.location.href = "login.html";
            return;
        }

        var role = me.user.role;
        var name = me.user.username || sessionStorage.getItem("luna_name") || "";
        sessionStorage.setItem("luna_user", role);
        sessionStorage.setItem("luna_name", name);

        var roleLabel = document.getElementById("role-label");
        if (roleLabel) roleLabel.textContent = role === "admin" ? "Administrator" : "Cashier";

        if (greeting) {
            greeting.textContent = name ? "Welcome back, " + name + "." : "Welcome back.";
        }

        // The admin-only shortcuts stay hidden for cashiers.
        document.querySelectorAll(".hub-admin").forEach(function (card) {
            card.style.display = role === "admin" ? "" : "none";
        });

        try {
            var products = await Api.getProducts("active");
            var low = 0;
            var out = 0;

            products.forEach(function (p) {
                var status = Api.statusFor(Number(p.stock) || 0);
                if (status.cls === "badge-out") out++;
                else if (status.cls === "badge-low") low++;
            });

            setStat("hub-total", products.length);
            setStat("hub-low", low);
            setStat("hub-out", out);
        } catch (err) {
            if (err.status === 401) {
                sessionStorage.removeItem("luna_user");
                sessionStorage.removeItem("luna_name");
                window.location.href = "login.html";
                return;
            }
            var hint = document.getElementById("hub-hint");
            if (hint) hint.textContent = "The stock counts could not be loaded right now.";
        }
    }

    bootstrap();
})();
