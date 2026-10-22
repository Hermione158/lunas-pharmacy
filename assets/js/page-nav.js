(function () {
    "use strict";

    // The "On this page" card: jump straight to a section instead of scrolling
    // through a long inventory or report. Without JS the links are plain anchors.

    var nav = document.querySelector(".page-nav");
    if (!nav) return;

    var links = Array.prototype.slice.call(nav.querySelectorAll(".page-nav-link[href^='#']"));
    if (!links.length) return;

    function setActive(link) {
        links.forEach(function (item) {
            var on = item === link;
            item.classList.toggle("active", on);
            if (on) item.setAttribute("aria-current", "true");
            else item.removeAttribute("aria-current");
        });
    }

    // The markup starts with the first section selected; mirror that for
    // screen readers too.
    var initial = links.filter(function (link) {
        return link.classList.contains("active");
    })[0];
    if (initial) setActive(initial);

    function scrollToTarget(target) {
        var reduceMotion = window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        try {
            target.scrollIntoView({
                behavior: reduceMotion ? "auto" : "smooth",
                block: "start"
            });
        } catch (err) {
            try {
                target.scrollIntoView();
            } catch (err2) {
                // The browser still follows the href as a normal anchor.
            }
        }
    }

    links.forEach(function (link) {
        link.addEventListener("click", function (e) {
            e.preventDefault();

            // "Archived items" shortcuts also switch the page's filter chip.
            var chipSelector = link.getAttribute("data-chip");
            var chip = chipSelector ? document.querySelector(chipSelector) : null;
            if (chip && !chip.classList.contains("active")) chip.click();

            var target = document.querySelector(link.getAttribute("href"));
            if (target) scrollToTarget(target);

            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, "", link.getAttribute("href"));
            }
            setActive(link);
        });
    });

    // Highlight the section in view while the page is scrolled by hand. The
    // filter shortcuts share a target with a section link, so they only light
    // up when clicked (not every time the shared target passes the viewport).
    if (typeof IntersectionObserver !== "function") return;

    var sectionLinks = links.filter(function (link) {
        return !link.hasAttribute("data-chip");
    });

    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var hash = "#" + entry.target.id;
            var match = sectionLinks.filter(function (link) {
                return link.getAttribute("href") === hash;
            })[0];
            if (match) setActive(match);
        });
    }, { rootMargin: "-110px 0px -55% 0px", threshold: 0 });

    sectionLinks.forEach(function (link) {
        var target = document.querySelector(link.getAttribute("href"));
        if (target) observer.observe(target);
    });
})();
