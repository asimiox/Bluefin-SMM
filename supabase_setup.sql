-- SQL Setup for SMM Panel

-- 1. Create Users Table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  balance NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create Providers Table
CREATE TABLE IF NOT EXISTS providers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  margin NUMERIC(5, 2) DEFAULT 0,
  last_import TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create Categories Table
CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Create Services Table
CREATE TABLE IF NOT EXISTS services (
  id BIGSERIAL PRIMARY KEY,
  service_id TEXT NOT NULL,
  provider_id BIGINT REFERENCES providers(id),
  name TEXT NOT NULL,
  category_id BIGINT REFERENCES categories(id),
  provider_rate NUMERIC(10, 4) NOT NULL,
  selling_price NUMERIC(10, 4) NOT NULL,
  min INTEGER DEFAULT 0,
  max INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Create Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  service_id BIGINT REFERENCES services(id),
  provider_order_id TEXT,
  link TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  charge NUMERIC(10, 4) NOT NULL,
  status TEXT DEFAULT 'pending',
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Create RPC for placing orders (atomic balance deduction and order creation)
CREATE OR REPLACE FUNCTION place_order(
  p_user_id BIGINT,
  p_service_id BIGINT,
  p_provider_order_id TEXT,
  p_link TEXT,
  p_quantity INTEGER,
  p_charge NUMERIC,
  p_description TEXT
) RETURNS VOID AS $$
BEGIN
  -- Deduct balance
  UPDATE users 
  SET balance = balance - p_charge 
  WHERE id = p_user_id AND balance >= p_charge;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Insert order
  INSERT INTO orders (user_id, service_id, provider_order_id, link, quantity, charge, description)
  VALUES (p_user_id, p_service_id, p_provider_order_id, p_link, p_quantity, p_charge, p_description);
END;
$$ LANGUAGE plpgsql;

-- 7. Create RPC for deposits
CREATE OR REPLACE FUNCTION add_deposit(
  p_user_id BIGINT,
  p_amount NUMERIC,
  p_description TEXT
) RETURNS JSON AS $$
DECLARE
  v_user JSON;
BEGIN
  UPDATE users 
  SET balance = balance + p_amount 
  WHERE id = p_user_id;
  
  SELECT row_to_json(u) INTO v_user 
  FROM (SELECT id, username, email, balance, role FROM users WHERE id = p_user_id) u;
  
  RETURN v_user;
END;
$$ LANGUAGE plpgsql;
