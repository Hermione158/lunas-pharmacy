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
            line.textContent = currency(it.qty * it.price) + "  (" + currency(it.price + " each") + ")";

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
    if (scanInput) {
        scanInput.addEventListener("keydown", function (e) {
            if (e.key !== "Enter") return;
            e.preventDefault();
            var code = scanInput.value.trim();
            scanInput.value = "";
            if (!code) return;

            var product = byBarcode[code];
            if (!product) {
                alert("No product with barcode " + code + ".");
                return;
            }
            addToCart(product);
            scanInput.focus();
        });
    }

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
    }

    init();
})();