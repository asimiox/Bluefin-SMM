import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import axios from "axios";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const db = new Database("smm.db");
const JWT_SECRET = process.env.JWT_SECRET || "smm-secret-key-123";

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    margin REAL DEFAULT 0,
    last_import TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL,
    provider_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    provider_rate REAL NOT NULL,
    selling_price REAL NOT NULL,
    min INTEGER,
    max INTEGER,
    FOREIGN KEY (provider_id) REFERENCES providers(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    balance REAL DEFAULT 0,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    provider_order_id TEXT,
    link TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    charge REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL, -- 'deposit', 'order'
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Seed default users
async function seedUsers() {
  const adminExists = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash("adminpassword", 10);
    db.prepare("INSERT INTO users (username, email, password, role, balance) VALUES (?, ?, ?, ?, ?)")
      .run("admin", "admin@smm.com", hashedPassword, "admin", 1000);
    console.log("Admin user seeded: admin@smm.com / adminpassword");
  }

  const userExists = db.prepare("SELECT * FROM users WHERE username = 'user'").get();
  if (!userExists) {
    const hashedPassword = await bcrypt.hash("userpassword", 10);
    db.prepare("INSERT INTO users (username, email, password, role, balance) VALUES (?, ?, ?, ?, ?)")
      .run("user", "user@smm.com", hashedPassword, "user", 100);
    console.log("Normal user seeded: user@smm.com / userpassword");
  }
}

seedUsers();

async function startServer() {
  const app = express();
  app.use(express.json());
  const PORT = 3000;

  // --- Auth Routes ---

  app.post("/api/auth/register", async (req, res) => {
    const { username, email, password } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const info = db.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)")
        .run(username, email, hashedPassword);
      const user = db.prepare("SELECT id, username, email, balance, role FROM users WHERE id = ?").get(info.lastInsertRowid) as any;
      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);
      res.json({ user, token });
    } catch (err: any) {
      res.status(400).json({ error: "Username or email already exists" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  });

  // Middleware to verify JWT
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  app.get("/api/auth/me", authenticate, (req: any, res) => {
    const user = db.prepare("SELECT id, username, email, balance, role FROM users WHERE id = ?").get(req.user.id);
    res.json(user);
  });

  // --- Orders ---

  app.get("/api/orders", authenticate, (req: any, res) => {
    const orders = db.prepare(`
      SELECT o.*, s.name as service_name 
      FROM orders o 
      JOIN services s ON o.service_id = s.id 
      WHERE o.user_id = ? 
      ORDER BY o.created_at DESC
    `).all(req.user.id);
    res.json(orders);
  });

  app.post("/api/orders", authenticate, async (req: any, res) => {
    const { service_id, link, quantity } = req.body;
    const service = db.prepare(`
      SELECT s.*, p.url as provider_url, p.api_key as provider_key 
      FROM services s 
      JOIN providers p ON s.provider_id = p.id 
      WHERE s.id = ?
    `).get(service_id) as any;

    if (!service) return res.status(404).json({ error: "Service not found" });
    
    const charge = (service.selling_price * quantity) / 1000;
    const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(req.user.id) as any;

    if (user.balance < charge) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    try {
      // Call Provider API
      // Try standard parameters first
      const standardParams = new URLSearchParams({
        key: service.provider_key,
        action: "add",
        service: service.service_id,
        link: link,
        quantity: quantity.toString()
      });

      // Try mastpanel.online style parameters as fallback
      const mastpanelParams = new URLSearchParams({
        apiKey: service.provider_key,
        actionType: "add",
        orderType: service.service_id,
        orderUrl: link,
        orderQuantity: quantity.toString()
      });

      let providerResp;
      try {
        providerResp = await axios.post(service.provider_url, standardParams.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        // If standard fails with an error that looks like parameter mismatch, try mastpanel
        if (providerResp.data.error && (
          providerResp.data.error.toLowerCase().includes("key") || 
          providerResp.data.error.toLowerCase().includes("action") ||
          providerResp.data.error.toLowerCase().includes("service")
        )) {
          throw new Error("TRY_MASTPANEL");
        }
      } catch (err) {
        providerResp = await axios.post(service.provider_url, mastpanelParams.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
      }

      if (providerResp.data.error) {
        return res.status(400).json({ error: `Provider Error: ${providerResp.data.error}` });
      }

      const providerOrderId = providerResp.data.order || providerResp.data.orderID;

      // Deduct balance and create order
      db.transaction(() => {
        db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(charge, req.user.id);
        db.prepare("INSERT INTO orders (user_id, service_id, provider_order_id, link, quantity, charge) VALUES (?, ?, ?, ?, ?, ?)")
          .run(req.user.id, service_id, providerOrderId, link, quantity, charge);
        db.prepare("INSERT INTO transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)")
          .run(req.user.id, -charge, 'order', `Order for ${service.name}`);
      })();

      res.json({ success: true, orderId: providerOrderId });
    } catch (err: any) {
      console.error("Order placement failed:", err.message);
      res.status(500).json({ error: "Failed to place order with provider" });
    }
  });

  // --- Balance / Deposits ---

  app.post("/api/deposit", authenticate, (req: any, res) => {
    const { amount } = req.body;
    if (amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    db.transaction(() => {
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, req.user.id);
      db.prepare("INSERT INTO transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)")
        .run(req.user.id, amount, 'deposit', 'Manual deposit');
    })();

    const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(req.user.id);
    res.json(user);
  });

  // Sync Order Statuses
  app.post("/api/orders/sync", authenticate, async (req: any, res) => {
    const pendingOrders = db.prepare(`
      SELECT o.*, p.url as provider_url, p.api_key as provider_key 
      FROM orders o 
      JOIN services s ON o.service_id = s.id 
      JOIN providers p ON s.provider_id = p.id 
      WHERE o.status IN ('pending', 'processing', 'inprogress')
    `).all() as any[];

    let updatedCount = 0;

    for (const order of pendingOrders) {
      try {
        // Try standard status check
        const standardParams = new URLSearchParams({
          key: order.provider_key,
          action: "status",
          order: order.provider_order_id
        });

        // Try mastpanel style status check
        const mastpanelParams = new URLSearchParams({
          apiKey: order.provider_key,
          actionType: "status",
          orderID: order.provider_order_id
        });

        let statusResp;
        try {
          statusResp = await axios.post(order.provider_url, standardParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
          if (statusResp.data.error) throw new Error("TRY_MASTPANEL");
        } catch (err) {
          statusResp = await axios.post(order.provider_url, mastpanelParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
        }

        if (statusResp.data && statusResp.data.status) {
          const newStatus = statusResp.data.status.toLowerCase();
          db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(newStatus, order.id);
          updatedCount++;
        } else if (statusResp.data && statusResp.data.orderStatus) {
          // MastPanel uses orderStatus
          const newStatus = statusResp.data.orderStatus.toLowerCase();
          db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(newStatus, order.id);
          updatedCount++;
        }
      } catch (err: any) {
        console.error(`Failed to sync status for order ${order.id}:`, err.message);
      }
    }

    res.json({ success: true, updated: updatedCount });
  });

  // --- Providers ---
  app.get("/api/providers", (req, res) => {
    const providers = db.prepare("SELECT * FROM providers").all();
    res.json(providers);
  });

  app.post("/api/providers", (req, res) => {
    const { name, url, api_key, margin } = req.body;
    const info = db.prepare("INSERT INTO providers (name, url, api_key, margin) VALUES (?, ?, ?, ?)")
      .run(name, url, api_key, parseFloat(margin) || 0);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/providers/:id", (req, res) => {
    db.prepare("DELETE FROM services WHERE provider_id = ?").run(req.params.id);
    db.prepare("DELETE FROM providers WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Import Services
  app.post("/api/import/:providerId", async (req, res) => {
    try {
      const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(req.params.providerId) as any;
      if (!provider) return res.status(404).json({ error: "Provider not found" });

      console.log(`Attempting import from: ${provider.url}`);

      let response;
      const requestConfig = {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 25000,
        maxRedirects: 5
      };

      const tryRequest = async (url: string, method: 'POST' | 'GET', useJson = false) => {
        const standardParams = {
          key: provider.api_key,
          action: "services"
        };
        
        const mastpanelParams = {
          apiKey: provider.api_key,
          actionType: "services"
        };

        const execute = async (params: any) => {
          if (method === 'POST') {
            if (useJson) {
              return await axios.post(url, params, {
                ...requestConfig,
                headers: { ...requestConfig.headers, 'Content-Type': 'application/json' }
              });
            } else {
              const formData = new URLSearchParams(params);
              return await axios.post(url, formData.toString(), {
                ...requestConfig,
                headers: { ...requestConfig.headers, 'Content-Type': 'application/x-www-form-urlencoded' }
              });
            }
          } else {
            const query = new URLSearchParams(params).toString();
            const separator = url.includes('?') ? '&' : '?';
            return await axios.get(`${url}${separator}${query}`, requestConfig);
          }
        };

        let resp = await execute(standardParams);
        
        // If standard fails with an error that looks like parameter mismatch, try mastpanel
        if (resp.data && typeof resp.data === 'object' && resp.data.error && (
          resp.data.error.toLowerCase().includes("key") || 
          resp.data.error.toLowerCase().includes("action")
        )) {
          resp = await execute(mastpanelParams);
        }
        
        // If it's an empty array or doesn't look like services, try mastpanel anyway
        if (Array.isArray(resp.data) && resp.data.length === 0) {
           const altResp = await execute(mastpanelParams);
           if (Array.isArray(altResp.data) && altResp.data.length > 0) return altResp;
        }

        return resp;
      };

      const runAllAttempts = async (url: string) => {
        let lastResp;
        try {
          console.log(`Attempt 1: Standard POST to ${url}`);
          lastResp = await tryRequest(url, 'POST');
          if (lastResp.data && typeof lastResp.data === 'object' && lastResp.data.error) {
            const errText = lastResp.data.error.toLowerCase();
            if (errText.includes("action") || errText.includes("key")) throw new Error("TRY_NEXT");
          }
          return lastResp;
        } catch (err) {
          try {
            console.log(`Attempt 2: GET to ${url}`);
            lastResp = await tryRequest(url, 'GET');
            if (lastResp.data && typeof lastResp.data === 'object' && lastResp.data.error) {
              const errText = lastResp.data.error.toLowerCase();
              if (errText.includes("action") || errText.includes("key")) throw new Error("TRY_NEXT");
            }
            return lastResp;
          } catch (err2) {
            console.log(`Attempt 3: JSON POST to ${url}`);
            return await tryRequest(url, 'POST', true);
          }
        }
      };

      try {
        response = await runAllAttempts(provider.url);
        
        // If we got HTML, maybe the URL is missing /v2
        const data = response.data;
        if (typeof data === 'string' && (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html'))) {
          if (!provider.url.toLowerCase().endsWith('/v2') && !provider.url.toLowerCase().endsWith('/v1')) {
            console.log("Got HTML, trying with /v2 suffix...");
            const baseUrl = provider.url.endsWith('/') ? provider.url.slice(0, -1) : provider.url;
            const v2Url = `${baseUrl}/v2`;
            const v2Response = await runAllAttempts(v2Url);
            
            // If v2 worked and returned JSON, use it!
            const v2Data = v2Response.data;
            if (v2Data && (typeof v2Data === 'object' || (typeof v2Data === 'string' && !v2Data.trim().startsWith('<html')))) {
              console.log("v2 URL worked!");
              response = v2Response;
            }
          }
        }
      } catch (err: any) {
        console.error("All import attempts failed:", err.message);
        throw err;
      }

      let services = response.data;
      
      // Log the type and a snippet of the response for debugging
      console.log(`Response type: ${typeof services}`);
      if (services && typeof services === 'object') {
        const snippet = JSON.stringify(services).substring(0, 200);
        console.log(`Response snippet: ${snippet}...`);
      }

      // Handle cases where the response is a string that needs parsing
      if (typeof services === 'string') {
        const trimmed = services.trim();
        console.log(`Response string snippet: ${trimmed.substring(0, 200)}`);
        
        if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
          // Try to extract title for better error message
          const titleMatch = trimmed.match(/<title>(.*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1] : 'Unknown Page';
          
          let suggestion = "Please check if your API URL is correct (e.g., ends with /api/v2).";
          if (title.includes("Cloudflare")) {
            suggestion = "The provider is protected by Cloudflare and is blocking the automated request.";
          } else if (title.includes("404")) {
            suggestion = "The API endpoint was not found. Try adding /v2 or /v1 to your URL.";
          }

          return res.status(400).json({ 
            error: `API returned an HTML page ("${title}") instead of data. ${suggestion}` 
          });
        }

        try {
          services = JSON.parse(trimmed);
        } catch (e) {
          return res.status(400).json({ 
            error: `API returned invalid JSON. First 50 chars: ${trimmed.substring(0, 50)}` 
          });
        }
      }

      if (services && typeof services === 'object' && !Array.isArray(services)) {
        if (services.error) {
          return res.status(400).json({ error: `Provider API Error: ${services.error}` });
        }
        // Check for common nested keys
        const possibleKeys = ['services', 'data', 'items'];
        for (const key of possibleKeys) {
          if (services[key] && Array.isArray(services[key])) {
            return processServices(services[key], provider, res);
          }
        }
        
        // If it's an object and none of the keys worked, maybe the object itself contains services as values
        const values = Object.values(services);
        if (values.length > 0 && typeof values[0] === 'object' && (values[0] as any).service_id) {
          return processServices(values, provider, res);
        }

        return res.status(400).json({ error: "Invalid API response format (expected array or nested services array)" });
      }

      if (!Array.isArray(services)) {
        return res.status(400).json({ error: "Invalid API response from provider (not an array)" });
      }

      return processServices(services, provider, res);
    } catch (error: any) {
      console.error("Import error details:", error.message);
      if (error.response) {
        console.error("Response data:", error.response.data);
        console.error("Response status:", error.response.status);
      }
      const errorMsg = error.response?.data?.error || error.message;
      res.status(500).json({ error: "Failed to import services: " + errorMsg });
    }
  });

  function processServices(servicesList: any[], provider: any, res: any) {
    try {
      console.log(`Processing ${servicesList.length} services...`);
      
      // Clear existing services for this provider
      db.prepare("DELETE FROM services WHERE provider_id = ?").run(provider.id);

      const insertCategory = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
      const getCategory = db.prepare("SELECT id FROM categories WHERE name = ?");
      const insertService = db.prepare(`
        INSERT INTO services (service_id, provider_id, name, category_id, provider_rate, selling_price, min, max)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let importedCount = 0;
      const transaction = db.transaction((list) => {
        for (const s of list) {
          // Be more flexible with property names
          const serviceId = s.service || s.id || s.service_id;
          const name = s.name || s.title;
          const category = s.category || s.group || "Uncategorized";
          const rate = s.rate || s.price || s.cost;

          if (!serviceId || !name || !rate) {
            console.log("Skipping invalid service item:", JSON.stringify(s).substring(0, 100));
            continue;
          }

          insertCategory.run(category);
          const cat = getCategory.get(category) as any;
          
          // Handle rates that might have commas or other formatting
          const rateStr = rate.toString().replace(/,/g, '');
          const rateNum = parseFloat(rateStr) || 0;
          const sellingPrice = rateNum * (1 + provider.margin / 100);
          
          insertService.run(
            serviceId.toString(),
            provider.id,
            name,
            cat.id,
            rateNum,
            sellingPrice,
            parseInt(s.min) || 0,
            parseInt(s.max) || 0
          );
          importedCount++;
        }
      });

      transaction(servicesList);
      
      // Update last_import timestamp
      db.prepare("UPDATE providers SET last_import = ? WHERE id = ?").run(new Date().toISOString(), provider.id);
      
      console.log(`Successfully imported ${importedCount} services.`);
      res.json({ success: true, count: importedCount });
    } catch (err: any) {
      console.error("Database error during import:", err.message);
      res.status(500).json({ error: "Database error during import: " + err.message });
    }
  }

  // Get Services Grouped by Category
  app.get("/api/services", (req, res) => {
    const categories = db.prepare("SELECT * FROM categories ORDER BY name ASC").all() as any[];
    const result = categories.map(cat => {
      const services = db.prepare(`
        SELECT s.*, p.name as provider_name 
        FROM services s 
        JOIN providers p ON s.provider_id = p.id 
        WHERE s.category_id = ?
      `).all(cat.id);
      return { ...cat, services };
    }).filter(cat => cat.services.length > 0);
    
    res.json(result);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
