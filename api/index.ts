import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "smm-secret-key-123";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Seed default admin user
async function seedAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  
  try {
    const { data: admin, error } = await supabase
      .from("users")
      .select("id")
      .eq("role", "admin")
      .limit(1)
      .single();

    if (error && error.code === 'PGRST116') { // Record not found
      console.log("Seeding default admin user...");
      const hashedPassword = await bcrypt.hash("adminpassword", 10);
      const { error: insertError } = await supabase
        .from("users")
        .insert([{
          username: "admin",
          email: "admin@smm.com",
          password: hashedPassword,
          role: "admin",
          balance: 1000
        }]);
      
      if (insertError) {
        console.error("Failed to seed admin:", insertError.message);
      } else {
        console.log("Admin user seeded: admin@smm.com / adminpassword");
      }
    }
  } catch (err: any) {
    console.error("Seeding check failed:", err.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

async function startServer() {
  await seedAdmin();
  const PORT = process.env.PORT || 3000;

  // --- Health Check ---
  app.get("/api/health", async (req, res) => {
    let supabaseStatus = "disconnected";
    if (SUPABASE_URL) {
      const { error } = await supabase.from("users").select("id").limit(1);
      supabaseStatus = error ? `error: ${error.message}` : "connected";
    }
    res.json({ status: "ok", supabase: supabaseStatus });
  });

  // --- Auth Routes ---

  app.post("/api/auth/register", async (req, res) => {
    const { username, email, password } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const { data: user, error } = await supabase
        .from("users")
        .insert([{ username, email, password: hashedPassword, balance: 0, role: 'user' }])
        .select("id, username, email, balance, role")
        .single();

      if (error) throw error;

      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);
      res.json({ user, token });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Username or email already exists" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user || !(await bcrypt.compare(password, user.password))) {
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

  app.get("/api/auth/me", authenticate, async (req: any, res) => {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, email, balance, role")
      .eq("id", req.user.id)
      .single();
    
    if (error) return res.status(404).json({ error: "User not found" });
    res.json(user);
  });

  // --- Orders ---

  app.get("/api/orders", authenticate, async (req: any, res) => {
    const { data: orders, error } = await supabase
      .from("orders")
      .select(`
        *,
        services (
          name
        )
      `)
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    
    // Flatten the service name
    const formattedOrders = orders.map((o: any) => ({
      ...o,
      service_name: o.services?.name
    }));

    res.json(formattedOrders);
  });

  app.post("/api/orders", authenticate, async (req: any, res) => {
    const { service_id, link, quantity } = req.body;
    
    const { data: service, error: sError } = await supabase
      .from("services")
      .select(`
        *,
        providers (
          url,
          api_key
        )
      `)
      .eq("id", service_id)
      .single();

    if (sError || !service) return res.status(404).json({ error: "Service not found" });
    
    const charge = (service.selling_price * quantity) / 1000;
    
    const { data: user, error: uError } = await supabase
      .from("users")
      .select("balance")
      .eq("id", req.user.id)
      .single();

    if (uError || user.balance < charge) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    try {
      // Call Provider API
      const standardParams = new URLSearchParams({
        key: service.providers.api_key,
        action: "add",
        service: service.service_id,
        link: link,
        quantity: quantity.toString()
      });

      const providerResp = await axios.post(service.providers.url, standardParams.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      if (providerResp.data.error) {
        return res.status(400).json({ error: `Provider Error: ${providerResp.data.error}` });
      }

      const providerOrderId = providerResp.data.order || providerResp.data.orderID;

      // Deduct balance and create order
      const { error: tError } = await supabase.rpc('place_order', {
        p_user_id: req.user.id,
        p_service_id: service_id,
        p_provider_order_id: providerOrderId.toString(),
        p_link: link,
        p_quantity: quantity,
        p_charge: charge,
        p_description: `Order for ${service.name}`
      });

      if (tError) throw tError;

      res.json({ success: true, orderId: providerOrderId });
    } catch (err: any) {
      console.error("Order placement failed:", err.message);
      res.status(500).json({ error: "Failed to place order with provider: " + err.message });
    }
  });

  // --- Balance / Deposits ---

  app.post("/api/deposit", authenticate, async (req: any, res) => {
    const { amount } = req.body;
    if (amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    const { data: user, error } = await supabase.rpc('add_deposit', {
      p_user_id: req.user.id,
      p_amount: amount,
      p_description: 'Manual deposit'
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json(user);
  });

  // Sync Order Statuses
  app.post("/api/orders/sync", authenticate, async (req: any, res) => {
    const { data: pendingOrders, error } = await supabase
      .from("orders")
      .select(`
        *,
        services (
          providers (
            url,
            api_key
          )
        )
      `)
      .in("status", ['pending', 'processing', 'inprogress']);

    if (error) return res.status(500).json({ error: error.message });

    let updatedCount = 0;

    for (const order of pendingOrders) {
      try {
        const params = new URLSearchParams({
          key: order.services.providers.api_key,
          action: "status",
          order: order.provider_order_id
        });

        const statusResp = await axios.post(order.services.providers.url, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (statusResp.data && statusResp.data.status) {
          const newStatus = statusResp.data.status.toLowerCase();
          await supabase
            .from("orders")
            .update({ status: newStatus })
            .eq("id", order.id);
          updatedCount++;
        }
      } catch (err: any) {
        console.error(`Failed to sync status for order ${order.id}:`, err.message);
      }
    }

    res.json({ success: true, updated: updatedCount });
  });

  // --- Providers ---
  app.get("/api/providers", authenticate, async (req, res) => {
    const { data: providers, error } = await supabase.from("providers").select("*");
    if (error) return res.status(500).json({ error: error.message });
    res.json(providers);
  });

  app.post("/api/providers", authenticate, async (req, res) => {
    const { name, url, api_key, margin } = req.body;
    const { data, error } = await supabase
      .from("providers")
      .insert([{ name, url, api_key, margin: parseFloat(margin) || 0 }])
      .select("id")
      .single();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete("/api/providers/:id", authenticate, async (req, res) => {
    // Supabase should handle cascading deletes if configured, or we do it manually
    await supabase.from("services").delete().eq("provider_id", req.params.id);
    const { error } = await supabase.from("providers").delete().eq("id", req.params.id);
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Import Services
  app.post("/api/import/:providerId", async (req, res) => {
    try {
      const { data: provider, error: pError } = await supabase
        .from("providers")
        .select("*")
        .eq("id", req.params.providerId)
        .single();

      if (pError || !provider) return res.status(404).json({ error: "Provider not found" });

      const params = new URLSearchParams({
        key: provider.api_key,
        action: "services"
      });

      const response = await axios.post(provider.url, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      let services = response.data;
      if (!Array.isArray(services)) {
        return res.status(400).json({ error: "Invalid API response from provider" });
      }

      // Clear existing services for this provider
      await supabase.from("services").delete().eq("provider_id", provider.id);

      let importedCount = 0;
      for (const s of services) {
        const serviceId = s.service || s.id;
        const name = s.name || s.title;
        const category = s.category || "Uncategorized";
        const rate = s.rate || s.price;

        if (!serviceId || !name || !rate) continue;

        // Ensure category exists
        const { data: catData, error: cError } = await supabase
          .from("categories")
          .upsert({ name: category }, { onConflict: 'name' })
          .select("id")
          .single();

        if (cError) continue;

        const sellingPrice = parseFloat(rate) * (1 + provider.margin / 100);
        
        await supabase.from("services").insert([{
          service_id: serviceId.toString(),
          provider_id: provider.id,
          name,
          category_id: catData.id,
          provider_rate: parseFloat(rate),
          selling_price: sellingPrice,
          min: parseInt(s.min) || 0,
          max: parseInt(s.max) || 0
        }]);
        importedCount++;
      }

      await supabase
        .from("providers")
        .update({ last_import: new Date().toISOString() })
        .eq("id", provider.id);

      res.json({ success: true, count: importedCount });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to import services: " + error.message });
    }
  });

  // Get Services Grouped by Category
  app.get("/api/services", async (req, res) => {
    const { data: categories, error: cError } = await supabase
      .from("categories")
      .select(`
        *,
        services (
          *,
          providers (
            name
          )
        )
      `)
      .order("name");

    if (cError) return res.status(500).json({ error: cError.message });
    
    const result = categories
      .map((cat: any) => ({
        ...cat,
        services: cat.services.map((s: any) => ({
          ...s,
          provider_name: s.providers?.name
        }))
      }))
      .filter((cat: any) => cat.services.length > 0);
    
    res.json(result);
  });

  // --- Production Serving ---
  // On Vercel, static files are served by the platform.
  // We only use Vite middleware for LOCAL development.
  const isVercel = !!process.env.VERCEL;
  const isProduction = process.env.NODE_ENV === "production" || isVercel;

  if (!isProduction) {
    console.log("Starting in DEVELOPMENT mode (Vite middleware)...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // Error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Express Error:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  });

  if (!isVercel) {
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
