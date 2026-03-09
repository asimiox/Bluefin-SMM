import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Globe, Plus, Trash2, RefreshCw, 
  ChevronDown, ChevronUp, Search, Info, ShoppingCart, 
  History, LogOut, User, DollarSign, Menu, X, 
  ShieldCheck, ExternalLink, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from './contexts/AuthContext';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface Provider {
  id: number;
  name: string;
  url: string;
  api_key: string;
  margin: number | string;
  last_import?: string;
}

interface Service {
  id: number;
  service_id: string;
  name: string;
  provider_rate: number;
  selling_price: number;
  min: number;
  max: number;
  provider_name: string;
  category_name: string;
}

interface Category {
  id: number;
  name: string;
  services: Service[];
}

interface Order {
  id: number;
  service_name: string;
  provider_order_id: string;
  link: string;
  quantity: number;
  charge: number;
  status: string;
  created_at: string;
}

// --- Components ---

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }>(
  ({ className, variant = 'primary', ...props }, ref) => {
    const variants = {
      primary: 'bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20',
      secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
      danger: 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20',
      ghost: 'bg-transparent hover:bg-slate-800 text-slate-400 hover:text-white',
    };
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all',
        className
      )}
      {...props}
    />
  )
);

// --- Main App ---

export default function App() {
  const { user, token, login, logout, refreshUser, loading: authLoading } = useAuth();
  const [view, setView] = useState<'dashboard' | 'new-order' | 'orders' | 'services' | 'admin'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 1024) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Data state
  const [providers, setProviders] = useState<Provider[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Auth form state
  const [isLogin, setIsLogin] = useState(true);
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');

  // Order form state
  const [orderForm, setOrderForm] = useState({ service_id: '', link: '', quantity: 0 });
  const [orderError, setOrderError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState(false);

  // Provider form state
  const [newProvider, setNewProvider] = useState({ name: '', url: '', api_key: '', margin: 0 });

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, view]);

  const fetchData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (view === 'admin' && user?.role === 'admin') {
        const res = await fetch('/api/providers', { headers: { Authorization: `Bearer ${token}` } });
        setProviders(await res.json());
      }
      
      if (view === 'services' || view === 'new-order') {
        const res = await fetch('/api/services');
        setCategories(await res.json());
      }

      if (view === 'orders' || view === 'dashboard') {
        const res = await fetch('/api/orders', { headers: { Authorization: `Bearer ${token}` } });
        setOrders(await res.json());
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();
      if (res.ok) {
        login(data.user, data.token);
      } else {
        setAuthError(data.error);
      }
    } catch (err) {
      setAuthError('Connection failed');
    }
  };

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError('');
    setOrderSuccess(false);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(orderForm)
      });
      const data = await res.json();
      if (res.ok) {
        setOrderSuccess(true);
        setOrderForm({ service_id: '', link: '', quantity: 0 });
        refreshUser();
      } else {
        setOrderError(data.error);
      }
    } catch (err) {
      setOrderError('Failed to place order');
    }
  };

  const addProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProvider)
    });
    setNewProvider({ name: '', url: '', api_key: '', margin: 0 });
    fetchData();
  };

  const importServices = async (providerId: number) => {
    setImporting(providerId);
    try {
      const res = await fetch(`/api/import/${providerId}`, { method: 'POST' });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        alert(`Successfully imported ${data.count} services!`);
        fetchData();
      }
    } catch (err) {
      alert('Failed to import services');
    } finally {
      setImporting(null);
    }
  };

  const addFunds = async () => {
    const amount = prompt("Enter amount to add (Demo):");
    if (!amount || isNaN(Number(amount))) return;
    
    await fetch('/api/deposit', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ amount: Number(amount) })
    });
    refreshUser();
  };

  const syncOrders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/orders/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        alert(`Updated ${data.updated} order statuses!`);
        fetchData();
      }
    } catch (err) {
      alert('Failed to sync orders');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <RefreshCw className="w-8 h-8 text-primary animate-spin" />
    </div>
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Globe className="text-primary w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">SMM <span className="text-primary">Panel</span></h1>
            <p className="text-slate-400 mt-2">The world's fastest social media services.</p>
          </div>

          <div className="glass-card p-8 border border-slate-800">
            <h2 className="text-xl font-semibold mb-6">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
            <form onSubmit={handleAuth} className="space-y-4">
              {!isLogin && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
                  <Input 
                    required
                    placeholder="johndoe"
                    value={authForm.username}
                    onChange={e => setAuthForm({...authForm, username: e.target.value})}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Email Address</label>
                <Input 
                  required
                  type="email"
                  placeholder="john@example.com"
                  value={authForm.email}
                  onChange={e => setAuthForm({...authForm, email: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Password</label>
                <Input 
                  required
                  type="password"
                  placeholder="••••••••"
                  value={authForm.password}
                  onChange={e => setAuthForm({...authForm, password: e.target.value})}
                />
              </div>
              {authError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-3 rounded-xl text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {authError}
                </div>
              )}
              <Button type="submit" className="w-full h-12 text-base">
                {isLogin ? 'Sign In' : 'Create Account'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button 
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-slate-400 hover:text-primary transition-colors"
              >
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const NavItem = ({ icon: Icon, label, id, active }: { icon: any, label: string, id: any, active: boolean }) => (
    <button
      onClick={() => {
        setView(id);
        if (window.innerWidth <= 1024) setIsSidebarOpen(false);
      }}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group',
        active 
          ? 'bg-primary text-white shadow-lg shadow-primary/20' 
          : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
      )}
    >
      <Icon className={cn('w-5 h-5 transition-transform group-hover:scale-110', active ? 'text-white' : 'text-slate-500 group-hover:text-primary')} />
      <span className="font-medium">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex overflow-x-hidden">
      {/* Sidebar Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => window.innerWidth <= 1024 && setIsSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-slate-900/80 backdrop-blur-2xl border-r border-slate-800 transition-all duration-300 ease-in-out lg:relative lg:translate-x-0",
        !isSidebarOpen && "-translate-x-full"
      )}>
        <div className="flex flex-col h-full p-6">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center">
              <Globe className="text-primary w-6 h-6" />
            </div>
            <span className="text-xl font-bold tracking-tight">SMM <span className="text-primary">Panel</span></span>
          </div>

          <nav className="flex-grow space-y-2">
            <NavItem icon={LayoutDashboard} label="Dashboard" id="dashboard" active={view === 'dashboard'} />
            <NavItem icon={ShoppingCart} label="New Order" id="new-order" active={view === 'new-order'} />
            <NavItem icon={History} label="Order History" id="orders" active={view === 'orders'} />
            <NavItem icon={Globe} label="Services" id="services" active={view === 'services'} />
            {user.role === 'admin' && (
              <NavItem icon={ShieldCheck} label="Admin Panel" id="admin" active={view === 'admin'} />
            )}
          </nav>

          <div className="mt-auto pt-6 border-t border-slate-800">
            <div className="flex items-center gap-3 mb-4 p-2">
              <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-slate-400" />
              </div>
              <div className="flex-grow min-w-0">
                <p className="text-sm font-semibold truncate">{user.username}</p>
                <p className="text-xs text-slate-500 truncate">{user.email}</p>
              </div>
            </div>
            <Button variant="ghost" className="w-full justify-start gap-3" onClick={logout}>
              <LogOut className="w-5 h-5" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-grow flex flex-col min-w-0">
        {/* Header */}
        <header className="h-20 border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-40 px-6 flex items-center justify-between">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="lg:hidden p-2 text-slate-400">
            {isSidebarOpen ? <X /> : <Menu />}
          </button>
          
          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-500 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border border-emerald-500/20">
              <DollarSign className="w-3.5 h-3.5 sm:w-4 h-4" />
              <span className="font-bold text-sm sm:text-base">${user.balance.toFixed(2)}</span>
            </div>
            <Button onClick={addFunds} className="h-9 sm:h-10 text-xs sm:text-sm">Add Funds</Button>
          </div>
        </header>

        <div className="p-6 lg:p-10 max-w-7xl mx-auto w-full">
          <AnimatePresence mode="wait">
            {view === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  <div className="glass-card p-5 sm:p-6 border-l-4 border-primary">
                    <p className="text-slate-400 text-xs sm:text-sm font-medium mb-1 uppercase tracking-wider">Total Balance</p>
                    <h3 className="text-2xl sm:text-3xl font-bold">${user.balance.toFixed(2)}</h3>
                  </div>
                  <div className="glass-card p-5 sm:p-6 border-l-4 border-indigo-500">
                    <p className="text-slate-400 text-xs sm:text-sm font-medium mb-1 uppercase tracking-wider">Total Orders</p>
                    <h3 className="text-2xl sm:text-3xl font-bold">{orders.length}</h3>
                  </div>
                  <div className="glass-card p-5 sm:p-6 border-l-4 border-emerald-500">
                    <p className="text-slate-400 text-xs sm:text-sm font-medium mb-1 uppercase tracking-wider">Account Status</p>
                    <h3 className="text-2xl sm:text-3xl font-bold capitalize">{user.role}</h3>
                  </div>
                </div>

                <div className="space-y-4">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <History className="text-primary w-5 h-5" />
                    Recent Orders
                  </h2>
                  <div className="glass-card overflow-hidden">
                    <div className="overflow-x-auto scrollbar-hide">
                      <table className="w-full text-left min-w-[600px]">
                        <thead className="bg-slate-900/50 border-b border-slate-800">
                          <tr>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ID</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Service</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Charge</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {orders.slice(0, 5).map(order => (
                            <tr key={order.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="px-6 py-4 text-sm font-mono text-slate-400">#{order.id}</td>
                              <td className="px-6 py-4 text-sm font-medium">{order.service_name}</td>
                              <td className="px-6 py-4 text-sm font-bold text-emerald-500">${order.charge.toFixed(3)}</td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                                  order.status === 'pending' ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
                                )}>
                                  {order.status}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-500">
                                {new Date(order.created_at).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                          {orders.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-slate-500">No orders found.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'new-order' && (
              <motion.div 
                key="new-order"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="max-w-2xl mx-auto space-y-8"
              >
                <header>
                  <h1 className="text-3xl font-bold">Place New Order</h1>
                  <p className="text-slate-400 mt-1">Select a service and boost your social presence.</p>
                </header>

                <div className="glass-card p-8 border border-slate-800">
                  <form onSubmit={placeOrder} className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-2">Category</label>
                      <select 
                        className="input-field appearance-none bg-slate-900 border-slate-800"
                        onChange={(e) => {
                          const catId = Number(e.target.value);
                          const cat = categories.find(c => c.id === catId);
                          if (cat && cat.services.length > 0) {
                            setOrderForm({...orderForm, service_id: cat.services[0].id.toString()});
                          }
                        }}
                      >
                        <option value="">Select Category</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-2">Service</label>
                      <select 
                        required
                        className="input-field appearance-none bg-slate-900 border-slate-800"
                        value={orderForm.service_id}
                        onChange={e => setOrderForm({...orderForm, service_id: e.target.value})}
                      >
                        <option value="">Select Service</option>
                        {categories.flatMap(c => c.services).map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} - ${s.selling_price.toFixed(2)} per 1000
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-2">Link</label>
                      <Input 
                        required
                        placeholder="https://www.instagram.com/p/..."
                        value={orderForm.link}
                        onChange={e => setOrderForm({...orderForm, link: e.target.value})}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-2">Quantity</label>
                      <Input 
                        required
                        type="number"
                        placeholder="Min: 100, Max: 10000"
                        value={orderForm.quantity || ''}
                        onChange={e => setOrderForm({...orderForm, quantity: Number(e.target.value)})}
                      />
                    </div>

                    {orderError && (
                      <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-xl text-sm flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" />
                        {orderError}
                      </div>
                    )}

                    {orderSuccess && (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 p-4 rounded-xl text-sm flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5" />
                        Order placed successfully!
                      </div>
                    )}

                    <Button type="submit" className="w-full h-12 text-lg">
                      Place Order
                    </Button>
                  </form>
                </div>
              </motion.div>
            )}

            {view === 'orders' && (
              <motion.div 
                key="orders"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Order History</h1>
                    <p className="text-slate-400 mt-1 text-sm sm:text-base">Track and manage all your past orders.</p>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <Button 
                      variant="ghost" 
                      onClick={syncOrders} 
                      disabled={loading}
                      className="h-10 gap-2 border border-slate-800"
                    >
                      <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                      Sync Status
                    </Button>
                    <div className="relative flex-grow sm:w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <Input className="pl-10 h-10" placeholder="Search orders..." />
                    </div>
                  </div>
                </header>

                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto scrollbar-hide">
                    <table className="w-full text-left min-w-[800px]">
                      <thead className="bg-slate-900/50 border-b border-slate-800">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ID</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Service</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Link</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Quantity</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Charge</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {orders.map(order => (
                          <tr key={order.id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-6 py-4 text-sm font-mono text-slate-400">#{order.id}</td>
                            <td className="px-6 py-4 text-sm font-medium">{order.service_name}</td>
                            <td className="px-6 py-4 text-sm text-slate-400">
                              <a href={order.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary">
                                Link <ExternalLink className="w-3 h-3" />
                              </a>
                            </td>
                            <td className="px-6 py-4 text-sm">{order.quantity.toLocaleString()}</td>
                            <td className="px-6 py-4 text-sm font-bold text-emerald-500">${order.charge.toFixed(3)}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                                order.status === 'pending' ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
                              )}>
                                {order.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-500">
                              {new Date(order.created_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'services' && (
              <motion.div 
                key="services"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <header>
                  <h1 className="text-3xl font-bold">Service List</h1>
                  <p className="text-slate-400 mt-1">Browse our high-quality social media services.</p>
                </header>

                <div className="space-y-8">
                  {categories.map(cat => (
                    <div key={cat.id} className="space-y-4">
                      <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                        <div className="w-1.5 h-6 bg-primary rounded-full" />
                        {cat.name}
                      </h2>
                      <div className="glass-card overflow-hidden">
                        <div className="overflow-x-auto scrollbar-hide">
                          <table className="w-full text-left min-w-[700px]">
                          <thead className="bg-slate-900/50 border-b border-slate-800">
                            <tr>
                              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ID</th>
                              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Service</th>
                              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Rate per 1k</th>
                              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Min/Max</th>
                              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {cat.services.map(s => (
                              <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                                <td className="px-6 py-4 text-sm font-mono text-slate-400">{s.service_id}</td>
                                <td className="px-6 py-4 text-sm font-medium">{s.name}</td>
                                <td className="px-6 py-4 text-sm font-bold text-emerald-500">${s.selling_price.toFixed(2)}</td>
                                <td className="px-6 py-4 text-sm text-slate-400">{s.min} / {s.max}</td>
                                <td className="px-6 py-4">
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-8 px-3 text-xs"
                                    onClick={() => {
                                      setOrderForm({...orderForm, service_id: s.id.toString()});
                                      setView('new-order');
                                    }}
                                  >
                                    Order
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

            {view === 'admin' && user.role === 'admin' && (
              <motion.div 
                key="admin"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-8"
              >
                <header>
                  <h1 className="text-3xl font-bold">Admin Dashboard</h1>
                  <p className="text-slate-400 mt-1">Manage providers and system settings.</p>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-1">
                    <div className="glass-card p-6 sticky top-24">
                      <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                        <Plus className="text-primary w-5 h-5" />
                        Add Provider
                      </h2>
                      <form onSubmit={addProvider} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
                          <Input required placeholder="SMM Kings" value={newProvider.name} onChange={e => setNewProvider({...newProvider, name: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-400 mb-1">API URL</label>
                          <Input required placeholder="https://..." value={newProvider.url} onChange={e => setNewProvider({...newProvider, url: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-400 mb-1">API Key</label>
                          <Input required type="password" placeholder="***" value={newProvider.api_key} onChange={e => setNewProvider({...newProvider, api_key: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-400 mb-1">Margin (%)</label>
                          <Input required type="number" value={newProvider.margin} onChange={e => setNewProvider({...newProvider, margin: Number(e.target.value)})} />
                        </div>
                        <Button type="submit" className="w-full">Add Provider</Button>
                      </form>
                    </div>
                  </div>

                  <div className="lg:col-span-2 space-y-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                      <Globe className="text-primary w-5 h-5" />
                      Active Providers
                    </h2>
                    <div className="grid grid-cols-1 gap-4">
                      {providers.map(p => (
                        <div key={p.id} className="glass-card p-6 flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-bold">{p.name}</h3>
                            <p className="text-sm text-slate-500 truncate max-w-xs">{p.url}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded uppercase">{p.margin}% Margin</span>
                              {p.last_import && <span className="text-[10px] text-slate-600">Last: {new Date(p.last_import).toLocaleDateString()}</span>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button 
                              variant="secondary" 
                              className="h-9 px-4 text-xs gap-2"
                              onClick={() => importServices(p.id)}
                              disabled={importing === p.id}
                            >
                              <RefreshCw className={cn("w-3 h-3", importing === p.id && "animate-spin")} />
                              Import
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
