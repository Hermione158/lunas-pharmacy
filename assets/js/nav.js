(function () {
    "use strict";

    function currentFile() {
        var parts = window.location.pathname.split("/");
        var file = parts[parts.length - 1] || "";
        return file.toLowerCase();
    }

    var file = currentFile();

    // Pages that are not the home page but still belong to the "Categories" area.
    var categoryArea = [
        "products.html", "cardiovascular.html", "painrelief.html", "cough.html",
        "gastrointestinal.html", "antivertigo.html", "vitamins.html", "others.html",
        "amlodipine.html", "amlodipinelosartan.html", "apixaban.html", "aspirin.html",
        "paracetamol.html", "paracetamol_combi.html", "mefenamic.html", "celcoxib.html",
        "diclofenac.html", "tramadol.html", "piroxicam.html", "musclerelaxant.html",
        "decongestant.html", "symdex.html", "cetirizine.html", "lotradine.html",
        "montelukast.html", "diphenhydramine.html", "lagundi.html", "sinupret.html",
        "hyoscine.html", "bisacodyl.html", "loperamide.html", "domperidone.html",
        "gaviscon.html", "kremils.html", "maalox.html", "meclizine.html",
        "betahistine.html", "cinnarizine.html", "rebamipide.html", "vitaminC.html",
        "vitaminB.html", "iron.html", "vitaminE.html", "calcium.html", "sleep.html",
        "multivitamins.html", "rehydration.html", "probiotics.html", "lozenges.html",
        "purification.html", "centralnervous.html"
    ];

    function markActive() {
        var links = document.querySelectorAll(".nav-links a, .quick-links a");
        var target = file;

        if (file === "" || file === "index.html") {
            target = "home.html";
        } else if (categoryArea.indexOf(file) !== -1 && file !== "products.html") {
            target = "products.html";
        }

        var matched = false;
        links.forEach(function (a) {
            var href = (a.getAttribute("href") || "").split("#")[0].toLowerCase();
            if (href && href === target) {
                a.classList.add("active");
                a.setAttribute("aria-current", "page");
                matched = true;
            }
        });

        return matched;
    }

    // --- Store search ---
    // The header search box is shared by every public page. On pages that list
    // products it filters the cards in place; everywhere else it jumps to the
    // full catalog with the term already applied.

    function setupSearch() {
        var bars = document.querySelectorAll(".search-bar");
        if (!bars.length) return;

        var grid = document.querySelector(".product-grid");

        var initial = "";
        try {
            initial = new URLSearchParams(window.location.search).get("search") || "";
        } catch (e) {
            initial = "";
        }

        function injectStyles() {
            if (document.getElementById("store-search-styles")) return;
            var style = document.createElement("style");
            style.id = "store-search-styles";
            style.textContent =
                ".search-hidden { display: none !important; }" +
                ".search-empty {" +
                " width: 100%; margin: 10px 0 40px 0; text-align: center;" +
                " font-size: 16px; color: #7a5c86;" +
                "}";
            document.head.appendChild(style);
        }

        function matches(card, query) {
            var name = card.querySelector(".product-name");
            var dosage = card.querySelector(".product-dosage");
            var section = card.closest ? card.closest(".category-section") : null;
            var title = section ? section.querySelector(".category-title") : null;

            var haystack = [
                name ? name.textContent : "",
                dosage ? dosage.textContent : "",
                title ? title.textContent : ""
            ].join(" ").toLowerCase();

            return haystack.indexOf(query) !== -1;
        }

        function apply(query) {
            if (!grid) return;

            injectStyles();

            var q = String(query || "").trim().toLowerCase();
            var cards = document.querySelectorAll(".product-grid .product-card");
            var shown = 0;

            cards.forEach(function (card) {
                var ok = !q || matches(card, q);
                card.classList.toggle("search-hidden", !ok);
                if (ok) shown++;
            });

            document.querySelectorAll(".category-section").forEach(function (section) {
                var any = section.querySelectorAll(".product-card:not(.search-hidden)").length > 0;
                section.classList.toggle("search-hidden", !any);
            });

            var empty = document.getElementById("search-empty");
            if (!empty) {
                empty = document.createElement("p");
                empty.id = "search-empty";
                empty.className = "search-empty";
                var main = document.querySelector(".main-content") || document.querySelector("main") || document.body;
                main.appendChild(empty);
            }

            var noMatches = !!q && shown === 0;
            empty.textContent = noMatches ? "No medicines found for \"" + query.trim() + "\"." : "";
            empty.classList.toggle("search-hidden", !noMatches);
        }

        function goToCatalog(query) {
            var q = String(query || "").trim();
            window.location.href = "products.html" + (q ? "?search=" + encodeURIComponent(q) : "");
        }

        bars.forEach(function (bar) {
            var input = bar.querySelector(".search-input");
            var button = bar.querySelector(".search-button");
            if (!input) return;

            if (grid) {
                input.addEventListener("input", function () { apply(input.value); });
                input.addEventListener("keydown", function (e) {
                    if (e.key === "Escape") {
                        input.value = "";
                        apply("");
                        input.blur();
                    } else if (e.key === "Enter") {
                        e.preventDefault();
                        apply(input.value);
                    }
                });
                if (button) {
                    button.addEventListener("click", function () {
                        apply(input.value);
                        input.focus();
                    });
                }
            } else {
                input.addEventListener("keydown", function (e) {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        goToCatalog(input.value);
                    } else if (e.key === "Escape") {
                        input.value = "";
                        input.blur();
                    }
                });
                if (button) {
                    button.addEventListener("click", function () {
                        goToCatalog(input.value);
                    });
                }
            }
        });

        if (grid && initial) {
            bars.forEach(function (bar) {
                var input = bar.querySelector(".search-input");
                if (input) input.value = initial;
            });
            apply(initial);
        }
    }

    function init() {
        markActive();
        setupSearch();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
