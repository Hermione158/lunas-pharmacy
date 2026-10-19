(function () {
    "use strict";

    // One shared confirmation dialog for every important action.
    // Usage: showConfirm({ title, message, confirmText }) -> Promise<boolean>
    // Enter confirms, Esc / Cancel / clicking the backdrop cancels.

    var queue = Promise.resolve();
    var stylesInjected = false;

    function injectStyles() {
        if (stylesInjected || document.getElementById("confirm-styles")) return;

        var style = document.createElement("style");
        style.id = "confirm-styles";
        style.textContent =
            ".confirm-overlay {" +
            " position: fixed; inset: 0; z-index: 100;" +
            " display: flex; align-items: center; justify-content: center;" +
            " padding: 24px; background: rgba(30, 30, 30, 0.55);" +
            "}" +
            ".confirm-card {" +
            " width: 100%; max-width: 380px; border-radius: 18px; overflow: hidden;" +
            " background: #ffffff; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);" +
            " font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;" +
            "}" +
            ".confirm-head {" +
            " background: #382449; color: #ffcad6; padding: 16px 22px;" +
            " font-size: 17px; font-weight: 800; letter-spacing: 0.3px;" +
            "}" +
            ".confirm-body {" +
            " padding: 20px 22px 8px 22px; color: #4a3550;" +
            " font-size: 14.5px; line-height: 1.5;" +
            "}" +
            ".confirm-actions {" +
            " display: flex; gap: 10px; padding: 18px 22px 20px 22px;" +
            "}" +
            ".confirm-btn {" +
            " flex: 1; border: none; border-radius: 12px; padding: 12px 0;" +
            " font-size: 15px; font-weight: 700; cursor: pointer;" +
            " transition: opacity 0.2s ease;" +
            "}" +
            ".confirm-btn:hover { opacity: 0.88; }" +
            ".confirm-btn.cancel { background: #f3e2e8; color: #7a2a3d; }" +
            ".confirm-btn.yes { background: #382449; color: #ffcad6; }";
        document.head.appendChild(style);
        stylesInjected = true;
    }

    function open(opts) {
        return new Promise(function (resolve) {
            injectStyles();

            var overlay = document.createElement("div");
            overlay.className = "confirm-overlay";

            var card = document.createElement("div");
            card.className = "confirm-card";
            card.setAttribute("role", "dialog");
            card.setAttribute("aria-modal", "true");

            var head = document.createElement("div");
            head.className = "confirm-head";
            head.textContent = opts.title || "Are you sure?";

            var body = document.createElement("div");
            body.className = "confirm-body";
            body.textContent = opts.message || "";

            var actions = document.createElement("div");
            actions.className = "confirm-actions";

            var cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "confirm-btn cancel";
            cancel.textContent = opts.cancelText || "Cancel";

            var yes = document.createElement("button");
            yes.type = "button";
            yes.className = "confirm-btn yes";
            yes.textContent = opts.confirmText || "Yes";

            var done = false;

            function finish(value) {
                if (done) return;
                done = true;
                document.removeEventListener("keydown", onKey, true);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(value);
            }

            function onKey(e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    finish(false);
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    finish(true);
                }
            }

            cancel.addEventListener("click", function () { finish(false); });
            yes.addEventListener("click", function () { finish(true); });
            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) finish(false);
            });
            document.addEventListener("keydown", onKey, true);

            actions.appendChild(cancel);
            actions.appendChild(yes);
            card.appendChild(head);
            card.appendChild(body);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
            yes.focus();
        });
    }

    window.showConfirm = function (opts) {
        // Only one dialog at a time: a second request waits for the first.
        var next = queue.then(function () { return open(opts || {}); });
        queue = next.catch(function () { /* the caller handles failures */ });
        return next;
    };
})();
