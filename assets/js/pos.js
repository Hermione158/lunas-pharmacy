(function () {
    "use strict";

    // --- Session guard: only signed-in staff may use the POS ---
    var role = sessionStorage.getItem("luna_user");
    if (!role) {
        window.location.href = "login.html";
        return;
    }

    var currency = Api.currency;

    var products = [];
    var byId = {};
    var byBarcode = {};
    var cart = {};
    var currentCat = "All";
    var searchTerm = "";

    var listEl = document.getElementById("product-list");
    var cartItemsEl = document.getElementById("cart-items");
    var cartCountEl = document.getElementById("cart-count");
    var subtotalEl = document.getElementById("subtotal");
    var totalEl = document.getElementById("total");
    var discountInput = document.getElementById("discount-input");
    var discountAmountEl = document.getElementById("discount-amount");
    var searchInput = document.getElementById("search-input");
    var scanInput = document.getElementById("scan-input");
    var filtersEl = document.getElementById("cat-filters");

    function handleAuthError(err) {
        if (err && err.status === 401) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return true;
        }
        return false;
    }

    // --- Category filters ---
    function buildFilters() {
        var cats = ["All"];
        var seen = {};
        products.forEach(function (p) {
            if (!seen[p.category]) {
                seen[p.category] = true;
                cats.push(p.category);
            }
        });

        filtersEl.innerHTML = "";
        cats.forEach(function (c) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cat-filter" + (c === currentCat ? " active" : "");
            btn.textContent = c;
            btn.setAttribute("data-cat", c);
            btn.addEventListener("click", function () {
                currentCat = c;
                filtersEl.querySelectorAll(".cat-filter").forEach(function (b) {
                    b.classList.toggle("active", b.getAttribute("data-cat") === c);
                });
                renderList();
            });
            filtersEl.appendChild(btn);
        });
    }

    // --- Product list rendering ---
    function matches(p) {
        var okCat = currentCat === "All" || p.category === currentCat;
        var term = searchTerm.toLowerCase();
        var okSearch = !term || p.name.toLowerCase().indexOf(term) !== -1;
        return okCat && okSearch;
    }

    function stockLeftFor(p) {
        var inCart = cart[p.id] ? cart[p.id].qty : 0;
        return Math.max(0, p.stock - inCart);
    }

    function stockNote(p) {
        if (p.stock <= 0) return { text: "Out of stock", cls: "out" };
        if (stockLeftFor(p) <= 0) return { text: "All " + p.stock + " in cart", cls: "low" };
        if (p.stock < Api.LOW_STOCK) return { text: "Low stock: " + p.stock + " left", cls: "low" };
        return { text: "Stock: " + p.stock, cls: "" };
    }

    function renderList() {
        listEl.innerHTML = "";
        products.filter(matches).forEach(function (p) {
            var card = document.createElement("div");
            card.className = "product-card";

            var img = document.createElement("img");
            img.className = "product-thumb";
            img.src = p.image || "assets/images/logo.png";
            img.alt = p.name;

            var info = document.createElement("div");
            info.className = "product-info";

            var name = document.createElement("span");
            name.className = "product-name";
            name.textContent = p.name;

            var price = document.createElement("span");
            price.className = "product-price";
            price.textContent = currency(p.price);

            var note = stockNote(p);
            var stock = document.createElement("span");
            stock.className = "product-stock " + note.cls;
            stock.textContent = note.text;

            var addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.className = "product-add";
            addBtn.textContent = stockLeftFor(p) > 0 ? "Add to Sale" : "Unavailable";
            addBtn.disabled = stockLeftFor(p) <= 0;
            addBtn.addEventListener("click", function () { addToCart(p); });

            // Clicking the medicine itself shows its barcode big in the
            // middle of the screen, so it is easy to scan or to print.
            img.classList.add("product-thumb-clickable");
            img.title = "Show the barcode of " + p.name;
            img.addEventListener("click", function () { openBarcodeFocus(p); });
            name.classList.add("product-name-clickable");
            name.title = "Show the barcode of " + p.name;
            name.addEventListener("click", function () { openBarcodeFocus(p); });

            info.appendChild(name);
            info.appendChild(price);
            info.appendChild(stock);
            card.appendChild(img);
            card.appendChild(info);
            card.appendChild(addBtn);
            listEl.appendChild(card);
        });

        if (listEl.children.length === 0) {
            listEl.innerHTML = '<p class="cart-empty">No products found.</p>';
        }
    }

    // --- Cart operations ---
    function addToCart(p) {
        if (stockLeftFor(p) <= 0) {
            alert("No more stock available for " + p.name + ".");
            return;
        }
        if (!cart[p.id]) {
            cart[p.id] = { id: p.id, name: p.name, image: p.image, price: p.price, qty: 0 };
        }
        cart[p.id].qty += 1;
        renderCart();
        renderList();
    }

    function changeQty(id, delta) {
        if (!cart[id]) return;
        var next = cart[id].qty + delta;
        var product = byId[id];
        if (product && next > product.stock) {
            alert("Only " + product.stock + " in stock for " + product.name + ".");
            return;
        }
        cart[id].qty = next;
        if (next <= 0) {
            delete cart[id];
        }
        renderCart();
        renderList();
    }

    function removeItem(id) {
        delete cart[id];
        renderCart();
        renderList();
    }

    // The cashier types a percentage; the peso amount is derived from the running gross.
    function readDiscountPct() {
        var value = Number(discountInput.value) || 0;
        if (value < 0) value = 0;
        if (value > 100) value = 100;
        return Api.round2(value);
    }

    function discountAmount(gross, pct) {
        return Api.round2(gross * pct / 100);
    }

    function renderCart() {
        var keys = Object.keys(cart);
        cartItemsEl.innerHTML = "";
        if (keys.length === 0) {
            cartItemsEl.innerHTML = '<p class="cart-empty">No items yet. Tap a product to add it.</p>';
        }

        var count = 0;
        var subtotal = 0;
        keys.forEach(function (k) {
            var it = cart[k];
            count += it.qty;
            subtotal += it.qty * it.price;

            var row = document.createElement("div");
            row.className = "cart-item";

            var img = document.createElement("img");
            img.src = it.image || "assets/images/logo.png";
            img.alt = it.name;

            var info = document.createElement("div");
            info.className = "cart-item-info";

            var nm = document.createElement("div");
            nm.className = "name";
            nm.textContent = it.name;

            var line = document.createElement("div");
            line.className = "line";
            line.textContent = currency(it.qty * it.price) + "  (" + currency(it.price) + " each)";

            var qtyCtrl = document.createElement("div");
            qtyCtrl.className = "qty-control";

            var minus = document.createElement("button");
            minus.type = "button";
            minus.textContent = "−";
            minus.addEventListener("click", function () { changeQty(it.id, -1); });

            var qty = document.createElement("span");
            qty.className = "qty";
            qty.textContent = it.qty;

            var plus = document.createElement("button");
            plus.type = "button";
            plus.textContent = "+";
            plus.addEventListener("click", function () { changeQty(it.id, 1); });

            qtyCtrl.appendChild(minus);
            qtyCtrl.appendChild(qty);
            qtyCtrl.appendChild(plus);
            info.appendChild(nm);
            info.appendChild(line);
            info.appendChild(qtyCtrl);

            var remove = document.createElement("button");
            remove.type = "button";
            remove.className = "cart-remove";
            remove.textContent = "✕";
            remove.addEventListener("click", function () { removeItem(it.id); });

            row.appendChild(img);
            row.appendChild(info);
            row.appendChild(remove);
            cartItemsEl.appendChild(row);
        });

        var gross = Api.round2(subtotal);
        var pct = readDiscountPct();
        var off = discountAmount(gross, pct);

        cartCountEl.textContent = count;
        subtotalEl.textContent = currency(gross);
        totalEl.textContent = currency(Api.round2(gross - off));
        discountAmountEl.textContent = pct > 0 ? Api.round2(pct) + "% off = " + currency(off) : "";
    }

    // --- Checkout / clear ---
    document.getElementById("checkout-btn").addEventListener("click", async function () {
        var keys = Object.keys(cart);
        if (keys.length === 0) {
            alert("The sale is empty. Add a product first.");
            return;
        }

        var gross = Api.round2(keys.reduce(function (sum, k) {
            return sum + cart[k].qty * cart[k].price;
        }, 0));

        var units = keys.reduce(function (sum, k) { return sum + cart[k].qty; }, 0);
        var pct = readDiscountPct();
        var off = discountAmount(gross, pct);
        var total = Api.round2(gross - off);

        var detail = units + " item(s) - Total " + currency(total) +
            (pct > 0 ? " (after " + Api.round2(pct) + "% discount)" : "");
        var goAhead = await showConfirm({
            title: "Checkout this sale?",
            message: detail,
            confirmText: "Yes, Checkout"
        });
        if (!goAhead) return;

        var result;
        try {
            result = await Api.checkout({
                items: keys.map(function (k) {
                    return { id: cart[k].id, qty: cart[k].qty };
                }),
                discountPct: readDiscountPct()
            });
        } catch (err) {
            if (!handleAuthError(err)) alert(err.message);
            return;
        }

        showReceipt(result.sale);

        cart = {};
        discountInput.value = "";
        await loadProducts();
        renderCart();
    });

    document.getElementById("clear-btn").addEventListener("click", async function () {
        if (Object.keys(cart).length > 0) {
            var goAhead = await showConfirm({
                title: "Clear the current sale?",
                message: "All items in the cart will be removed.",
                confirmText: "Yes, Clear"
            });
            if (!goAhead) return;
        }

        cart = {};
        discountInput.value = "";
        renderCart();
        renderList();
    });

    document.getElementById("logout-btn").addEventListener("click", async function () {
        try {
            await Api.logout();
        } catch (err) {
            // still clear the local session below
        }
        sessionStorage.removeItem("luna_user");
        sessionStorage.removeItem("luna_name");
        window.location.href = "login.html";
    });

    discountInput.addEventListener("input", function () { renderCart(); });

    searchInput.addEventListener("input", function () {
        searchTerm = searchInput.value.trim();
        renderList();
    });

    async function loadProducts() {
        products = await Api.getProducts();
        byId = {};
        byBarcode = {};
        products.forEach(function (p) {
            byId[p.id] = p;
            if (p.barcode) byBarcode[p.barcode] = p;
        });
    }

    // --- Receipt ---
    var receiptOverlay = document.getElementById("receipt-overlay");

    // Thermal-style amounts: the peso sign sits right against the digits.
    function receiptMoney(n) {
        return "₱" + Api.round2(n).toFixed(2);
    }

    function pad2(n) {
        return n < 10 ? "0" + n : String(n);
    }

    // "10/19/2026 04:10 PM" - the exact moment the sale was saved.
    function receiptDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) d = new Date();
        var hours = d.getHours();
        var suffix = hours >= 12 ? "PM" : "AM";
        hours = hours % 12 || 12;
        return pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + "/" + d.getFullYear() +
            "  " + pad2(hours) + ":" + pad2(d.getMinutes()) + " " + suffix;
    }

    function showReceipt(sale) {
        if (!receiptOverlay) return;

        document.getElementById("receipt-datetime").textContent = receiptDate(sale.date);
        document.getElementById("receipt-tx").textContent = sale.txNo;

        var itemsEl = document.getElementById("receipt-items");
        itemsEl.innerHTML = "";
        sale.items.forEach(function (it) {
            var row = document.createElement("div");
            row.className = "receipt-item";
            var label = document.createElement("span");
            label.className = "receipt-item-label";
            label.textContent = it.qty + "x " + it.name;
            var amount = document.createElement("span");
            amount.textContent = receiptMoney(it.total);
            row.appendChild(label);
            row.appendChild(amount);
            itemsEl.appendChild(row);
        });

        document.getElementById("receipt-subtotal").textContent = receiptMoney(sale.gross);
        document.getElementById("receipt-discount-label").textContent = sale.discountPct > 0
            ? "Discount (" + Api.round2(sale.discountPct) + "%)"
            : "Discount";
        document.getElementById("receipt-discount").textContent = receiptMoney(sale.discount);
        document.getElementById("receipt-total").textContent = receiptMoney(sale.net);

        receiptOverlay.hidden = false;
    }

    var printBtn = document.getElementById("receipt-print-btn");
    if (printBtn) {
        printBtn.addEventListener("click", function () { window.print(); });
    }

    var closeBtn = document.getElementById("receipt-close-btn");
    if (closeBtn) {
        closeBtn.addEventListener("click", function () {
            receiptOverlay.hidden = true;
            if (scanInput) scanInput.focus();
        });
    }

    // --- Barcode scanning ---
    // USB scanners act like a keyboard: they type the code and press Enter.
    var scanFeedbackEl = document.getElementById("scan-feedback");
    var scanFeedbackTimer = null;
    var audioContext = null;

    // A short message under the scan box, so the cashier sees what happened
    // without having to look away from the items being scanned.
    function scanFeedback(text, kind) {
        if (!scanFeedbackEl) return;
        scanFeedbackEl.textContent = text;
        scanFeedbackEl.className = "scan-feedback" + (kind ? " " + kind : "");
        scanFeedbackEl.hidden = false;
        clearTimeout(scanFeedbackTimer);
        scanFeedbackTimer = setTimeout(function () {
            scanFeedbackEl.textContent = "";
            scanFeedbackEl.hidden = true;
        }, 2500);
    }

    // The sound of a real barcode reader, kept in the project so it plays
    // even without a network. It is loaded once and reused.
    var scanSound = null;
    var scanSoundSrc = "assets/sounds/scan-beep.mp4";

    function preloadScanSound() {
        try {
            if (!window.Audio) return;
            scanSound = new window.Audio(scanSoundSrc);
            scanSound.preload = "auto";
        } catch (e) {
            scanSound = null;
        }
    }

    // Plays the sound of the reader. Returns true when the file started, so
    // the made-up tone is only used when the file cannot play.
    function playScanFile() {
        try {
            if (!scanSound) return false;
            if (scanSound.volume !== undefined) scanSound.volume = 0.9;
            try {
                scanSound.currentTime = 0;
            } catch (e) { /* the sound is not loaded yet */ }
            var started = scanSound.play();
            if (started && typeof started.then === "function") {
                started.catch(function () {
                    playSynthBeep("ok");
                });
                return true;
            }
        } catch (e) {
            // The browser will not play it; the made-up tone takes over.
        }
        return false;
    }

    // The sound a barcode reader makes: a short high "tut" when the code is
    // good, a low double buzz when something is wrong. It is made with the
    // Web Audio API, so no sound file is needed.
    function playSynthBeep(kind) {
        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!audioContext) audioContext = new Ctx();
            if (audioContext.state === "suspended" && audioContext.resume) audioContext.resume();

            var now = audioContext.currentTime;
            var gain = audioContext.createGain();
            gain.connect(audioContext.destination);

            var tone = audioContext.createOscillator();
            tone.connect(gain);

            if (kind === "error") {
                // Two low pulses: "that code did not work".
                tone.type = "square";
                tone.frequency.setValueAtTime(300, now);
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.12, now + 0.16);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
                tone.start(now);
                tone.stop(now + 0.3);
            } else {
                // One short high beep: "code read".
                tone.type = "sine";
                tone.frequency.setValueAtTime(1100, now);
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
                tone.start(now);
                tone.stop(now + 0.14);
            }
        } catch (e) {
            // No sound is better than a broken scan.
        }
    }

    // A good scan plays the sound of a real reader; a wrong code gets the
    // low buzz. If the sound file cannot play, the made-up tone is used.
    function playBeep(kind) {
        if (kind === "error") {
            playSynthBeep("error");
            return;
        }
        if (playScanFile()) return;
        playSynthBeep("ok");
    }

    // One place that decides what a scanned code means. The keyboard reader and
    // the camera both come here, so they behave exactly the same. The answer is
    // returned so the camera window can show it too.
    function handleScanCode(code) {
        var text = String(code || "").trim();
        if (!text) return { ok: false, message: "" };

        var product = byBarcode[text];
        if (!product) {
            var missing = "No product with barcode " + text + ". Check the sticker, or save that code on the item in Update Inventory.";
            scanFeedback(missing, "error");
            playBeep("error");
            return { ok: false, message: missing };
        }
        if (stockLeftFor(product) <= 0) {
            var empty = "No more stock available for " + product.name + ".";
            scanFeedback(empty, "warn");
            playBeep("error");
            return { ok: false, message: empty };
        }

        addToCart(product);
        var qty = cart[product.id] ? cart[product.id].qty : 0;
        var added = "Added " + product.name + " - now " + qty + " in the sale.";
        scanFeedback(added, "ok");
        playBeep("ok");
        return { ok: true, message: added };
    }

    if (scanInput) {
        scanInput.addEventListener("keydown", function (e) {
            if (e.key !== "Enter") return;
            e.preventDefault();
            var code = scanInput.value.trim();
            scanInput.value = "";
            if (!code) return;

            handleScanCode(code);
            scanInput.focus();
        });
    }

    // --- Scanning with the camera ---
    // Works with a laptop camera and with a phone camera. Chrome, Edge and
    // Android have their own scanner, which is the best at reading small
    // barcodes; everywhere else ZXing does the work.
    var cameraOverlay = document.getElementById("camera-overlay");
    var cameraVideo = document.getElementById("camera-video");
    var cameraStatus = document.getElementById("camera-status");
    var cameraBtn = document.getElementById("camera-btn");
    var cameraZoomInBtn = document.getElementById("camera-zoom-in");
    var cameraZoomOutBtn = document.getElementById("camera-zoom-out");
    var cameraReader = null;
    var cameraControls = null;
    var cameraStream = null;
    var cameraTrack = null;
    var cameraZoom = 0;
    var nativeDetector = null;
    var nativeTimer = null;
    var lastCameraCode = "";
    var lastCameraTime = 0;
    var lastCameraResult = null;
    var cameraGoneSince = 0;

    function setCameraStatus(text, kind) {
        if (!cameraStatus) return;
        cameraStatus.textContent = text;
        cameraStatus.className = "camera-status" + (kind ? " " + kind : "");
    }

    // Not every camera can zoom, so the buttons only show when it can.
    function zoomRange() {
        var caps = null;
        try {
            caps = cameraTrack && cameraTrack.getCapabilities ? cameraTrack.getCapabilities() : null;
        } catch (e) {
            caps = null;
        }
        if (!caps || !caps.zoom) return null;
        return {
            min: caps.zoom.min === undefined ? 1 : caps.zoom.min,
            max: caps.zoom.max === undefined ? 1 : caps.zoom.max
        };
    }

    function updateZoomButtons() {
        var has = !!zoomRange();
        [cameraZoomInBtn, cameraZoomOutBtn].forEach(function (btn) {
            if (!btn) return;
            btn.hidden = !has;
            btn.disabled = !has;
        });
    }

    // Level 0 is the widest view, level 1 is as close as the camera allows.
    function applyZoom(level) {
        var range = zoomRange();
        if (!range || !cameraTrack) return false;
        var value = range.min + (range.max - range.min) * level;
        try {
            var done = cameraTrack.applyConstraints({ advanced: [{ zoom: value }] });
            if (done && done.catch) done.catch(function () { });
            cameraZoom = level;
            return true;
        } catch (e) {
            return false;
        }
    }

    function cameraSize() {
        var settings = null;
        try {
            settings = cameraTrack && cameraTrack.getSettings ? cameraTrack.getSettings() : null;
        } catch (e) {
            settings = null;
        }
        var width = settings && settings.width ? settings.width : (cameraVideo && cameraVideo.videoWidth) || 0;
        var height = settings && settings.height ? settings.height : (cameraVideo && cameraVideo.videoHeight) || 0;
        return (width || "?") + "x" + (height || "?");
    }

    function stopCameraScan() {
        if (nativeTimer) {
            clearInterval(nativeTimer);
            nativeTimer = null;
        }
        nativeDetector = null;
        try {
            if (cameraControls && cameraControls.stop) cameraControls.stop();
        } catch (e) { /* the reader is already gone */ }
        try {
            if (cameraReader) cameraReader.reset();
        } catch (e) { /* the reader is already gone */ }
        cameraControls = null;
        cameraReader = null;
        if (cameraStream && cameraStream.getTracks) {
            try {
                cameraStream.getTracks().forEach(function (track) { track.stop(); });
            } catch (e) { /* the stream is already closed */ }
        }
        cameraStream = null;
        cameraTrack = null;
        cameraZoom = 0;
        lastCameraCode = "";
        lastCameraResult = null;
        cameraGoneSince = 0;
        updateZoomButtons();
        if (cameraOverlay) cameraOverlay.hidden = true;
        if (cameraVideo) {
            try {
                cameraVideo.pause();
                cameraVideo.srcObject = null;
            } catch (e) { /* the video never started */ }
        }
        if (scanInput) scanInput.focus();
    }

    // A frame in which no barcode was seen. When the same code comes back
    // after it was gone for a moment, it is a new item.
    function noteFrameWithoutCode() {
        if (!lastCameraCode) return;
        if (!cameraGoneSince) cameraGoneSince = Date.now();
    }

    // A code the camera read. The answer is shown inside the camera window,
    // because the message under the scan box is hidden behind this window.
    function onCameraCode(text) {
        if (!text) return;

        var now = Date.now();
        if (text === lastCameraCode) {
            // The same sticker is read many times a second. A good code is
            // taken once, until the item leaves the frame for a second and a
            // half; a wrong code is only complained about once in a while.
            if (lastCameraResult === "bad") {
                if (now - lastCameraTime < 4000) return;
            } else {
                var wasAway = cameraGoneSince && now - cameraGoneSince >= 1500;
                if (!wasAway) return;
            }
        }
        cameraGoneSince = 0;
        lastCameraCode = text;
        lastCameraTime = now;

        var result = handleScanCode(text);
        lastCameraResult = result.ok ? "ok" : "bad";
        setCameraStatus(result.message, result.ok ? "ok" : "error");
    }

    // The browser's own scanner, when it has one.
    function runNativeDetect() {
        if (!nativeDetector || !cameraVideo || !cameraOverlay || cameraOverlay.hidden) return;
        try {
            var found = nativeDetector.detect(cameraVideo);
            if (found && found.then) {
                found.then(function (codes) {
                    if (!codes || !codes.length) {
                        noteFrameWithoutCode();
                        return;
                    }
                    var value = codes[0].rawValue || codes[0].raw_value;
                    onCameraCode(value);
                }).catch(function () { /* nothing readable in this frame */ });
            }
        } catch (e) { /* the picture is not ready yet */ }
    }

    // Asks the browser what it can read. Chrome on Android and other phones
    // have their own scanner, which is the best at reading small barcodes.
    async function canUseNativeScanner() {
        if (!window.BarcodeDetector) return false;
        var formats = null;
        try {
            formats = await window.BarcodeDetector.getSupportedFormats();
        } catch (e) {
            formats = null;
        }
        if (!formats || formats.indexOf("code_128") === -1) return false;

        var wanted = ["code_128", "ean_13", "ean_8", "upc_a", "upc_e"].filter(function (f) {
            return formats.indexOf(f) !== -1;
        });
        try {
            nativeDetector = new window.BarcodeDetector({ formats: wanted });
        } catch (e) {
            nativeDetector = null;
        }
        return !!nativeDetector;
    }

    // The reading library, used when the browser has no scanner of its own.
    function startZxingScan() {
        if (!window.ZXing || !window.ZXing.BrowserMultiFormatReader) {
            setCameraStatus("The camera scanner could not be loaded. Refresh the page and try again.", "error");
            playBeep("error");
            return;
        }

        var hints = new Map();
        hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
            window.ZXing.BarcodeFormat.CODE_128,
            window.ZXing.BarcodeFormat.EAN_13,
            window.ZXing.BarcodeFormat.EAN_8,
            window.ZXing.BarcodeFormat.UPC_A,
            window.ZXing.BarcodeFormat.UPC_E
        ]);
        hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);

        cameraReader = new window.ZXing.BrowserMultiFormatReader(hints, 120);

        // The library attaches the stream to the video and starts it. It must
        // not be started beforehand, or the library waits for a "canplay" that
        // has already passed and its reading loop never begins.
        var started = cameraReader.decodeFromStream(cameraStream, cameraVideo, function (result) {
            if (!result) {
                noteFrameWithoutCode();
                return;
            }
            onCameraCode(result.getText ? result.getText() : "");
        });

        if (started && started.then) {
            started.then(function (controls) {
                cameraControls = controls;
            }).catch(function () {
                setCameraStatus("The camera could not be started. Allow camera access and try again.", "error");
                playBeep("error");
            });
        }
    }

    async function startCameraScan() {
        if (!cameraOverlay) return;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            cameraOverlay.hidden = false;
            setCameraStatus("This browser cannot use the camera. Please use a barcode reader instead.", "error");
            playBeep("error");
            return;
        }

        cameraOverlay.hidden = false;
        setCameraStatus("Hold the barcode about 15 cm from the camera, inside the frame.", "");

        // Ask for a sharp picture. The camera normally hands over 640x480,
        // which is far too small to read the little sticker on a medicine.
        // "environment" is the back camera of a phone; a laptop only has the
        // webcam, so the browser uses that one instead.
        var constraints = {
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };

        var stream = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            setCameraStatus("The camera could not be started. Allow camera access and try again.", "error");
            playBeep("error");
            return;
        }

        cameraStream = stream;
        cameraTrack = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;

        // The zoom starts where the camera starts, and stays there until the
        // cashier presses + or -.
        updateZoomButtons();
        applyZoom(0);
        setCameraStatus("Camera " + cameraSize() + ". Hold the barcode about 15 cm away, inside the frame.", "");

        // The browser's own scanner is used when it has one. It reads the
        // video by itself, so the video is attached here. Otherwise the
        // reading library attaches it, which is why this happens before the
        // video is started.
        var native = await canUseNativeScanner();
        if (native) {
            if (cameraVideo) {
                cameraVideo.srcObject = stream;
                try {
                    await cameraVideo.play();
                } catch (e) { /* the video starts by itself */ }
            }
            nativeTimer = setInterval(runNativeDetect, 150);
        } else {
            startZxingScan();
        }
    }

    if (cameraZoomInBtn) {
        cameraZoomInBtn.addEventListener("click", function () {
            applyZoom(Math.min(1, cameraZoom + 0.2));
        });
    }

    if (cameraZoomOutBtn) {
        cameraZoomOutBtn.addEventListener("click", function () {
            applyZoom(Math.max(0, cameraZoom - 0.2));
        });
    }

    if (cameraBtn) {
        cameraBtn.addEventListener("click", function () {
            if (cameraOverlay && cameraOverlay.hidden === false) {
                stopCameraScan();
                return;
            }
            startCameraScan();
        });
    }

    var cameraCloseBtn = document.getElementById("camera-close-btn");
    if (cameraCloseBtn) {
        cameraCloseBtn.addEventListener("click", stopCameraScan);
    }

    // Esc closes the camera view.
    document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (cameraOverlay && cameraOverlay.hidden === false) {
            e.preventDefault();
            stopCameraScan();
        }
    });

    // --- The big barcode view ---
    // Clicking a medicine shows its barcode large in the middle of the screen,
    // with everything else dimmed, so the focus is only on the barcode.
    var barcodeOverlay = document.getElementById("barcode-overlay");
    var barcodeNameEl = document.getElementById("barcode-name");
    var barcodeBoxEl = document.getElementById("barcode-box");
    var barcodeCodeEl = document.getElementById("barcode-code");
    var barcodePrintBtn = document.getElementById("barcode-print-btn");
    var barcodeCloseBtn = document.getElementById("barcode-close-btn");
    var barcodePrintArea = document.getElementById("barcode-print-area");
    var focusProduct = null;

    function escText(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function openBarcodeFocus(p) {
        if (!barcodeOverlay) return;
        focusProduct = p;

        if (barcodeNameEl) barcodeNameEl.textContent = p.name;
        if (barcodeBoxEl) {
            barcodeBoxEl.innerHTML = p.barcode
                ? window.LunaBarcode.svg(p.barcode, "barcode-svg")
                : '<p class="barcode-missing">This medicine has no barcode yet. Save one on the item in Update Inventory.</p>';
        }
        if (barcodeCodeEl) barcodeCodeEl.textContent = p.barcode || "No barcode yet";
        if (barcodePrintBtn) barcodePrintBtn.disabled = !p.barcode;

        barcodeOverlay.hidden = false;
        if (barcodeCloseBtn) barcodeCloseBtn.focus();
    }

    function closeBarcodeFocus() {
        if (barcodeOverlay) barcodeOverlay.hidden = true;
        if (scanInput) scanInput.focus();
    }

    // Prints one label, much bigger than the ones on the label sheet, so it
    // is easy to stick on the medicine and easy to read with a scanner.
    function printBarcodeLabel(p) {
        if (!p || !p.barcode || !barcodePrintArea) return;

        barcodePrintArea.innerHTML = '<div class="print-label">' +
            '<div class="print-label-name">' + escText(p.name) + "</div>" +
            '<div class="print-label-price">' + currency(p.price) + "</div>" +
            window.LunaBarcode.svg(p.barcode, "print-label-barcode") +
            '<div class="print-label-code">' + escText(p.barcode) + "</div>" +
            "</div>";

        document.body.classList.add("printing-barcode");

        var clear = function () {
            document.body.classList.remove("printing-barcode");
            barcodePrintArea.innerHTML = "";
        };
        window.addEventListener("afterprint", clear, { once: true });
        try {
            window.print();
        } catch (e) {
            // Printing is not available here; the label stays on the page.
        }
        setTimeout(clear, 1500);
    }

    if (barcodeCloseBtn) {
        barcodeCloseBtn.addEventListener("click", closeBarcodeFocus);
    }

    if (barcodePrintBtn) {
        barcodePrintBtn.addEventListener("click", function () {
            printBarcodeLabel(focusProduct);
        });
    }

    // Clicking the dimmed background also closes the view.
    if (barcodeOverlay) {
        barcodeOverlay.addEventListener("click", function (e) {
            if (e.target === barcodeOverlay) closeBarcodeFocus();
        });
    }

    document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (barcodeOverlay && barcodeOverlay.hidden === false) {
            e.preventDefault();
            closeBarcodeFocus();
        }
    });

    async function init() {
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

        var roleLabel = document.getElementById("role-label");
        if (roleLabel) {
            roleLabel.textContent = role === "admin" ? "Admin" : "Cashier";
        }

        // --- Management links for the admin; the cashier keeps a clean register ---
        document.querySelectorAll(".pos-admin-link").forEach(function (link) {
            if (role === "admin") {
                link.style.display = "";
            } else {
                link.remove();
            }
        });

        try {
            await loadProducts();
        } catch (err) {
            listEl.innerHTML = '<p class="cart-empty">Could not load products. ' + err.message + "</p>";
            return;
        }

        buildFilters();
        renderList();
        renderCart();

        // The sound of the reader is loaded now, so the first scan is not
        // waiting for it.
        preloadScanSound();

        // The scan box is ready right away, so the first item can be scanned
        // without touching the mouse.
        if (scanInput) scanInput.focus();
    }

    init();
})();