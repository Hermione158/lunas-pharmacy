-- Normalized schema (3NF) reference for Luna's Pharmacy.
-- This file documents the target design. The live app currently keeps the
-- denormalized columns (products.category, sales.gross/net, sale_items.total,
-- stock_movements.product_name/recorded_by) for backward compatibility.
-- Apply the migrations in db/migrations/ to move toward this design.

CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(60) NOT NULL UNIQUE
);

-- products: category is replaced by category_id (FK)
-- ALTER TABLE products ADD COLUMN category_id INT NULL;
-- ALTER TABLE products ADD CONSTRAINT fk_products_category
--     FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
-- (products.category can be dropped after migration.)

CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(20) NOT NULL UNIQUE
);

-- users: role can reference roles(id) instead of a free-text/enum value.

-- sales: derived totals removed; compute from sale_items
-- gross = SUM(sale_items.qty * sale_items.price)
-- net   = gross - discount
-- ALTER TABLE sales DROP COLUMN gross, DROP COLUMN net;

-- sale_items: derived total removed
-- ALTER TABLE sale_items DROP COLUMN total;

-- stock_movements: replace denormalized names with FKs
-- ALTER TABLE stock_movements ADD COLUMN user_id INT NULL;
-- ALTER TABLE stock_movements ADD CONSTRAINT fk_movements_user
--     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
-- (product_name and recorded_by can be dropped after migration.)

-- Helpful views for reporting without denormalized columns:
CREATE OR REPLACE VIEW v_sale_totals AS
SELECT s.id AS sale_id,
       COALESCE(SUM(si.qty * si.price), 0) AS gross,
       s.discount,
       COALESCE(SUM(si.qty * si.price), 0) - s.discount AS net
FROM sales s
LEFT JOIN sale_items si ON si.sale_id = s.id
GROUP BY s.id, s.discount;