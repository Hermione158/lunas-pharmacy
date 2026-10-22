// Adds a show/hide (eye) toggle to every password field on the page.
(function () {
    "use strict";

    function enhance(input) {
        if (!input || input.dataset.pwToggle === "1") return;
        input.dataset.pwToggle = "1";

        var wrapper = document.createElement("span");
        wrapper.className = "password-field";
        if (input.parentNode) {
            input.parentNode.insertBefore(wrapper, input);
        }
        wrapper.appendChild(input);

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "password-toggle";
        btn.setAttribute("aria-label", "Show password");
        btn.textContent = "\u{1F441}";
        btn.addEventListener("click", function () {
            if (input.type === "password") {
                input.type = "text";
                btn.classList.add("is-visible");
                btn.setAttribute("aria-label", "Hide password");
            } else {
                input.type = "password";
                btn.classList.remove("is-visible");
                btn.setAttribute("aria-label", "Show password");
            }
        });
        wrapper.appendChild(btn);
    }

    function run() {
        document.querySelectorAll('input[type="password"]').forEach(enhance);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
    } else {
        run();
    }
})();
