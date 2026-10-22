(function () {
    "use strict";

    var role = sessionStorage.getItem("luna_user");

    // --- Access guard: accounts are admin only ---
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

    var table = document.getElementById("users-table");
    var tbody = table.querySelector("tbody");
    var hint = document.getElementById("user-hint");

    var users = [];
    var currentUserId = null;
    var statusFilter = "active";

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
        tbody.innerHTML = users.filter(function (u) {
            return statusFilter === "all" || (u.status || "active") === statusFilter;
        }).map(function (u) {
            var isSelf = currentUserId !== null && u.id === currentUserId;
            var archived = (u.status || "active") === "archived";
            var roleCls = u.role === "admin" ? "badge badge-in" : "badge";
            return '<tr data-id="' + u.id + '"' + (archived ? ' class="inv-row-archived"' : "") + ">" +
                "<td>" + esc(u.username) + (isSelf ? ' <span class="inv-item-sub">(you)</span>' : "") + "</td>" +
                '<td><span class="' + roleCls + '">' + (u.role === "admin" ? "Administrator" : "Cashier") + "</span>" +
                (archived ? ' <span class="badge badge-archived">Archived</span>' : "") + "</td>" +
                "<td>" + esc(formatDate(u.created_at)) + "</td>" +
                '<td><div class="row-actions">' +
                (archived
                    ? '<button type="button" class="icon-btn icon-restore">Restore</button>'
                    : '<button type="button" class="icon-btn icon-archive"' + (isSelf ? " disabled" : "") + ">Archive</button>") +
                "</div></td></tr>";
        }).join("");

        var active = users.filter(function (u) { return (u.status || "active") === "active"; });
        var admins = active.filter(function (u) { return u.role === "admin"; }).length;
        document.getElementById("total-users").textContent = active.length;
        document.getElementById("admin-count").textContent = admins;
        document.getElementById("cashier-count").textContent = active.length - admins;
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

    // --- Active / Archived filter ---
    var statusChips = document.getElementById("user-status-chips");
    if (statusChips) {
        statusChips.querySelectorAll(".chip").forEach(function (chip) {
            chip.addEventListener("click", function () {
                statusFilter = chip.getAttribute("data-status") || "active";
                statusChips.querySelectorAll(".chip").forEach(function (x) {
                    x.classList.remove("active");
                });
                chip.classList.add("active");
                render();
            });
        });
    }

    // --- Archive / restore account ---
    table.addEventListener("click", async function (e) {
        var btn = e.target;
        if (!btn.classList) return;
        var archiving = btn.classList.contains("icon-archive");
        if (!archiving && !btn.classList.contains("icon-restore")) return;

        var row = btn.closest ? btn.closest("tr") : null;
        if (!row) return;

        var user = users.find(function (u) { return String(u.id) === row.getAttribute("data-id"); });
        if (!user) return;

        var goAhead = await showConfirm({
            title: archiving ? "Archive this account?" : "Restore this account?",
            message: archiving
                ? "Archive \"" + user.username + "\"? They can no longer sign in until restored."
                : "Restore \"" + user.username + "\"? They will be able to sign in again.",
            confirmText: archiving ? "Yes, Archive" : "Yes, Restore"
        });
        if (!goAhead) return;

        try {
            await Api.archiveUser(user.id, archiving ? "archived" : "active");
            await load();
            flash("\"" + user.username + "\" " + (archiving ? "archived." : "restored."));
        } catch (err) {
            if (!handleAuthError(err)) alert(err.message);
        }
    });

    function revealChrome() {
        var roleLabel = document.getElementById("role-label");
        if (roleLabel) {
            roleLabel.textContent = "Administrator";
        }
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
            window.location.href = "inventory.html";
            return;
        }

        revealChrome();
        currentUserId = me.user.id;
        await load();
    }

    bootstrap();
})();