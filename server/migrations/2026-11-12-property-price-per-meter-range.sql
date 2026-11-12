ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS price_per_meter_min INTEGER,
  ADD COLUMN IF NOT EXISTS price_per_meter_max INTEGER;
