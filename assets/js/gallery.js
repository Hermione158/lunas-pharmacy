(function () {
    var gallery = document.querySelector('.gallery');
    if (!gallery) return;

    var imgs = gallery.querySelectorAll('img');
    var caption = document.querySelector('.gallery-caption');
    var prev = document.querySelector('.gallery-prev');
    var next = document.querySelector('.gallery-next');
    var index = 0;

    if (imgs.length <= 1) return;

    function show(i) {
        for (var k = 0; k < imgs.length; k++) {
            imgs[k].classList.toggle('active', k === i);
        }
        if (caption && imgs[i]) {
            caption.textContent = imgs[i].getAttribute('data-label');
        }
    }

    if (prev) {
        prev.addEventListener('click', function () {
            index = (index - 1 + imgs.length) % imgs.length;
            show(index);
        });
    }

    if (next) {
        next.addEventListener('click', function () {
            index = (index + 1) % imgs.length;
            show(index);
        });
    }

    show(0);
})();