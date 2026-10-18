(function () {
    "use strict";

    var role = sessionStorage.getItem("luna_user");

    // --- Access guard: accounts are admin only ---
    if (!role) {
        window.location.href = "login.html";
        return;
    }
    if (role !== "admin") {
        window.location.href = "inventory.html";
        return;
    }

    var roleLabel = document.getElementById("role-label");
    if (roleLabel) {
        roleLabel.textContent = "Administrator";
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

    var table = document.getElementById("users-table");
    var tbody = table.querySelector("tbody");
    var hint = document.getElementById("user-hint");

    var users = [];
    var currentUserId = null;

    function esc(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function flash(message) {
        hint.textContent = message;
        clearTimeout(flash._t);
        flash._t = setTimeout(function () { hint.textContent = ""; }, 2500);
    }

    function handleAuthError(err) {
        if (err && err.status === 401) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return true;
        }
        return false;
    }

    function formatDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "—";
        return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    }

    function render() {
        tbody.innerHTML = users.map(function (u) {
            var isSelf = currentUserId !== null && u.id === currentUserId;
            var roleCls = u.role === "admin" ? "badge badge-in" : "badge";
            return '<tr data-id="' + u.id + '">' +
                "<td>" + esc(u.username) + (isSelf ? ' <span class="inv-item-sub">(you)</span>' : "") + "</td>" +
                '<td><span class="' + roleCls + '">' + (u.role === "admin" ? "Administrator" : "Cashier") + "</span></td>" +
                "<td>" + esc(formatDate(u.created_at)) + "</td>" +
                '<td><div class="row-actions">' +
                '<button type="button" class="icon-btn icon-del"' + (isSelf ? " disabled" : "") + ">Delete</button>" +
                "</div></td></tr>";
        }).join("");

        var admins = users.filter(function (u) { return u.role === "admin"; }).length;
        document.getElementById("total-users").textContent = users.length;
        document.getElementById("admin-count").textContent = admins;
        document.getElementById("cashier-count").textContent = users.length - admins;
    }

    async function load() {
        try {
            var me = await Api.me();
            currentUserId = me.user.id;
            users = await Api.getUsers();
            render();
        } catch (err) {
            handleAuthError(err);
        }
    }

    // --- Add account ---
    document.getElementById("add-user").addEventListener("click", async function () {
        var username = document.getElementById("new-username").value.trim();
        var password = document.getElementById("new-password").value;
        var newRole = document.getElementById("new-role").value;

        if (!username || !password) {
            flash("Enter a username and a password.");
            return;
        }

        try {
            await Api.addUser({ username: username, password: password, role: newRole });
            document.getElementById("new-username").value = "";
            document.getElementById("new-password").value = "";
            await load();
            flash("Account \"" + username + "\" created.");
        } catch (err) {
            if (!handleAuthError(err)) flash(err.message);
        }
    });

    // --- Delete account ---
    table.addEventListener("click", async function (e) {
        var btn = e.target;
        if (!btn.classList || !btn.classList.contains("icon-del")) return;

        var row = btn.closest ? btn.closest("tr") : null;
        if (!row) return;

        var user = users.find(function (u) { return String(u.id) === row.getAttribute("data-id"); });
        if (!user) return;
        if (!confirm("Delete the account \"" + user.username + "\"?")) return;

        try {
            await Api.deleteUser(user.id);
            await load();
            flash("\"" + user.username + "\" deleted.");
        } catch (err) {
            if (!handleAuthError(err)) alert(err.message);
        }
    });

    async function init() {
        try {
            await Api.me();
        } catch (err) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return;
        }
        await load();
    }

    init();
})();