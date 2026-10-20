(function () {
    "use strict";

    // --- Code 128 (subset B) barcode, rendered as SVG ---
    // Shared by the Labels page and the register, so both show the very same
    // picture. The 107 standard patterns, 11 modules each. Index 106 (stop)
    // is appended separately because it is 13 modules long.
    var PATTERNS = [
        "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
        "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
        "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
        "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
        "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
        "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
        "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
        "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
        "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
        "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
        "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
        "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
        "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
        "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
        "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
        "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
        "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
        "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
        "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
        "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
        "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
        "11010011100"
    ];
    var STOP = "1100011101011";

    function esc(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function code128Bits(text) {
        var data = [104]; // Start B
        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);
            if (code < 32 || code > 126) {
                throw new Error("Cannot draw \"" + text.charAt(i) + "\" as a barcode.");
            }
            data.push(code - 32);
        }

        var sum = 104;
        for (var j = 1; j < data.length; j++) sum += data[j] * j;
        data.push(sum % 103);

        return data.map(function (value) { return PATTERNS[value]; }).join("") + STOP;
    }

    // The barcode picture. The class name can be changed so the label sheet and
    // the register can each give it their own size.
    function barcodeSvg(code, cssClass) {
        var bits = code128Bits(code);
        var bars = [];
        var i = 0;
        while (i < bits.length) {
            if (bits.charAt(i) === "1") {
                var start = i;
                while (i < bits.length && bits.charAt(i) === "1") i++;
                bars.push('<rect x="' + start + '" y="0" width="' + (i - start) + '" height="46"></rect>');
            } else {
                i++;
            }
        }
        return '<svg class="' + (cssClass || "label-barcode") + '" viewBox="0 0 ' + bits.length +
            ' 46" preserveAspectRatio="none" fill="#111111" role="img" aria-label="Barcode ' +
            esc(code) + '">' + bars.join("") + "</svg>";
    }

    window.LunaBarcode = {
        bits: code128Bits,
        svg: barcodeSvg
    };
})();
