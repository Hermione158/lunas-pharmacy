// A saved item keeps its name and its barcode.
//
// A barcode is printed on labels and the name identifies the item on receipts
// and in sales reports, so quietly changing either one rewrites history. Both
// are set once, when the item is added, and a mistake is fixed by removing the
// item and adding it again.
//
// One exception: an item that has no barcode yet (the sample catalog imports
// items without one) may still be given its first barcode. Once it has one,
// the barcode is permanent too.
"use strict";

function cleanBarcode(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

// Returns a message when the change is not allowed, or null when it is.
// Unknown (undefined) fields mean "leave it as it is" and always pass.
function guardImmutableFields(existing, next) {
    if (!existing || !next) return null;

    if (next.name !== undefined && String(next.name).trim() !== String(existing.name).trim()) {
        return "\"" + existing.name + "\" keeps its name. Names of saved items cannot be changed; " +
            "remove the item and add it again instead.";
    }

    if (next.barcode !== undefined) {
        const before = cleanBarcode(existing.barcode);
        const after = cleanBarcode(next.barcode);
        if (before !== after && before !== null) {
            return "\"" + existing.name + "\" keeps its barcode. Saved barcodes cannot be changed; " +
                "remove the item and add it again instead.";
        }
    }

    return null;
}

module.exports = { guardImmutableFields, cleanBarcode };
