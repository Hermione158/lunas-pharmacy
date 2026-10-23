-- Normalized schema (3NF) reference for Luna's Pharmacy.
-- This is the design now applied to the live database.
--
-- Derived values are computed when read, never stored:
--   line total = sale_items.qty * sale_items.price
--   sale gross = SUM(sale_items.qty * sale_items.price)
--   sale net   = sale gross - sales.discount
--
-- Product and staff names are resolved through foreign keys, not copied.
-- The old products.category text column is kept only for backward compatibility.

CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(60) NOT NULL UNIQUE
);

-- products: category_id is the normalized link; category is legacy text.
-- ALTER TABLE products ADD COLUMN category_id INT NULL;
-- ALTER TABLE products ADD CONSTRAINT fk_products_category
--     FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
-- (products.category can be dropped after all pages use category_id.)

-- sale_items: derived total removed (applied)
-- ALTER TABLE sale_items DROP COLUMN total;

-- sales: derived totals removed (applied)
-- ALTER TABLE sales DROP COLUMN gross, DROP COLUMN net;

-- stock_movements: replace denormalized names with FKs (applied)
-- ALTER TABLE stock_movements ADD COLUMN user_id INT NULL;
-- ALTER TABLE stock_movements ADD CONSTRAINT fk_movements_user
--     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
-- (product_name and recorded_by have been dropped.)

-- Helpful view for reporting without denormalized columns:
CREATE OR REPLACE VIEW v_sale_totals AS
SELECT s.id AS sale_id,
       COALESCE(SUM(si.qty * si.price), 0) AS gross,
       s.discount,
       COALESCE(SUM(si.qty * si.price), 0) - s.discount AS net
FROM sales s
LEFT JOIN sale_items si ON si.sale_id = s.id
GROUP BY s.id, s.discount;