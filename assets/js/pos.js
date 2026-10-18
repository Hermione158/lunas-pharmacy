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
    var cart = {};
    var currentCat = "All";
    var searchTerm = "";
    var currentRange = "today";

    var listEl = document.getElementById("product-list");
    var cartItemsEl = document.getElementById("cart-items");
    var cartCountEl = document.getElementById("cart-count");
    var subtotalEl = document.getElementById("subtotal");
    var totalEl = document.getElementById("total");
    var discountInput = document.getElementById("discount-input");
    var searchInput = document.getElementById("search-input");
    var filtersEl = document.getElementById("cat-filters");

    // --- Admin-only nav link ---
    document.querySelectorAll(".pos-admin-link").forEach(function (link) {
        if (role === "admin") {
            link.style.display = "";
        } else {
            link.remove();
        }
    });

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

    function readDiscount(gross) {
        var value = Api.round2(Number(discountInput.value) || 0);
        if (value < 0) value = 0;
        if (value > gross) value = gross;
        return value;
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
        var discount = readDiscount(gross);
        discountInput.value = discount ? discount : "";

        cartCountEl.textContent = count;
        subtotalEl.textContent = currency(gross);
        totalEl.textContent = currency(gross - discount);
    }

    // --- Sales summary ---
    async function renderStats() {
        var stats;
        try {
            stats = await Api.getStats(currentRange);
        } catch (err) {
            handleAuthError(err);
            return;
        }

        document.getElementById("stat-gross").textContent = currency(stats.gross);
        document.getElementById("stat-net").textContent = currency(stats.net);
        document.getElementById("stat-tx").textContent = stats.transactions;

        var topEl = document.getElementById("stat-top");
        if (stats.top.length) {
            topEl.textContent = stats.top[0].name;
            topEl.title = stats.top[0].qty + " sold · " + currency(stats.top[0].revenue);
        } else {
            topEl.textContent = "No sales yet";
            topEl.title = "";
        }
    }

    document.querySelectorAll(".pos-range").forEach(function (btn) {
        btn.addEventListener("click", function () {
            currentRange = btn.getAttribute("data-range");
            document.querySelectorAll(".pos-range").forEach(function (b) {
                b.classList.toggle("active", b === btn);
            });
            renderStats();
        });
    });

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

        var result;
        try {
            result = await Api.checkout({
                items: keys.map(function (k) {
                    return { id: cart[k].id, qty: cart[k].qty };
                }),
                discount: readDiscount(gross)
            });
        } catch (err) {
            if (!handleAuthError(err)) alert(err.message);
            return;
        }

        var sale = result.sale;
        var lines = sale.items.map(function (it) {
            return it.name + "  x" + it.qty + "  =  " + currency(it.total);
        }).join("\n");

        alert("RECEIPT\nLuna's Pharmacy\n" + sale.txNo + "\n\n" + lines +
            "\n\nGROSS SALES: " + currency(sale.gross) +
            "\nDISCOUNT: " + currency(sale.discount) +
            "\nNET SALES: " + currency(sale.net));

        cart = {};
        discountInput.value = "";
        await loadProducts();
        renderCart();
        renderStats();
    });

    document.getElementById("clear-btn").addEventListener("click", function () {
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
        products.forEach(function (p) { byId[p.id] = p; });
    }

    async function init() {
        try {
            await Api.me();
        } catch (err) {
            sessionStorage.removeItem("luna_user");
            window.location.href = "login.html";
            return;
        }

        try {
            await loadProducts();
        } catch (err) {
            listEl.innerHTML = '<p class="cart-empty">Could not load products. ' + err.message + "</p>";
            return;
        }

        buildFilters();
        renderList();
        renderCart();
        renderStats();
    }

    init();
})();