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

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", markActive);
    } else {
        markActive();
    }
})();
