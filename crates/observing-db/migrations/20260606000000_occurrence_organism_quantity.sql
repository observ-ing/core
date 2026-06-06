-- Surface Darwin Core dwc:organismQuantity / dwc:organismQuantityType on
-- occurrences. Both are stored as text: organismQuantity is "generally an
-- integer or float but may be categorical, e.g. 'many' or '10-100'", and
-- organismQuantityType is a small open vocabulary ("individuals",
-- "percent-cover", ...). Nullable — the vast majority of records omit them.
ALTER TABLE occurrences
    ADD COLUMN IF NOT EXISTS organism_quantity TEXT,
    ADD COLUMN IF NOT EXISTS organism_quantity_type TEXT;
