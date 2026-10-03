import { useState, useEffect } from 'react';
import { Loader2, Eye, EyeOff, WifiOff, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [isLoading, setIsLoading]           = useState(false);
  const [showPassword, setShowPassword]     = useState(false);
  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [hasNetworkError, setHasNetworkError]   = useState(false);
  const [isCheckingNetwork, setIsCheckingNetwork] = useState(false);
  const [focused, setFocused]               = useState<'email' | 'password' | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated && user) {
      navigate('/redirect', { replace: true });
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  const handleNetworkCheck = async () => {
    setIsCheckingNetwork(true);
    try {
      const restUrl = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/`;
      const apiKey  = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      let reachable = false;
      try {
        const r = await fetch(restUrl, { method: 'HEAD', headers: { apikey: apiKey } });
        reachable = r.ok || r.status === 400;
      } catch { reachable = false; }

      if (!reachable) {
        toast.error('Still unable to reach the server. Please try again shortly or contact support.', { duration: 6000 });
      } else {
        toast.success('Connection is working! Try signing in again.');
        setHasNetworkError(false);
      }
    } catch {
      toast.error('Network check failed. Your ISP may be blocking the connection.');
    } finally {
      setIsCheckingNetwork(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error('Please enter email and password');
      return;
    }

    setIsLoading(true);
    setHasNetworkError(false);

    const enteredIdentifier = email.trim().toLowerCase();
    let loginEmail = enteredIdentifier;

    if (!EMAIL_REGEX.test(enteredIdentifier)) {
      const { data: matchedProfile } = await (supabase.from('profiles') as any)
        .select('email, login_enabled')
        .or(`username.eq.${enteredIdentifier},office_number.eq.${enteredIdentifier}`)
        .maybeSingle();

      if (!matchedProfile?.email) {
        toast.error('Use your registered email or employee ID');
        setIsLoading(false);
        return;
      }
      if (matchedProfile.login_enabled === false) {
        toast.error('Your login is disabled. Please contact HR.');
        setIsLoading(false);
        return;
      }
      loginEmail = String(matchedProfile.email).toLowerCase();
    }

    let authData = null;
    let authError = null;
    for (let i = 0; i <= 2; i++) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      authData = data; authError = error;
      if (!error || !error.message.toLowerCase().includes('fetch')) break;
      if (i < 2) await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }

    if (authError) {
      const msg = (authError.message || '').toLowerCase();
      if (msg.includes('invalid login credentials')) {
        toast.error('Invalid email or password');
      } else if (msg.includes('fetch') || msg.includes('network')) {
        toast.error('Unable to reach the server. Please try again in a moment.');
        setHasNetworkError(true);
      } else {
        toast.error(authError.message);
      }
      setIsLoading(false);
      return;
    }

    if (authData?.user) {
      const userId = authData.user.id;
      (async () => {
        try {
          const { data: profile } = await supabase.from('profiles').select('name,role').eq('id', userId).maybeSingle();
          await supabase.from('audit_logs').insert({
            action: 'USER_LOGIN',
            performed_by: userId,
            performed_by_name: (profile as any)?.name || 'Unknown',
            performed_by_role: (profile as any)?.role || 'employee',
            record_type: 'auth', record_id: userId,
            after_state: { login_time: new Date().toISOString() },
            remarks: 'User logged in',
          });
        } catch { /* non-critical */ }
      })();
    }

    toast.success('Welcome back!');
    navigate('/redirect', { replace: true });
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── LEFT PANEL ─────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[52%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #050f1a 0%, #0a1f35 40%, #0d2b20 100%)' }}
      >
        {/* Decorative orbs */}
        <div className="absolute top-[-120px] left-[-120px] w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-80px] right-[-80px] w-[400px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)' }} />
        <div className="absolute top-1/2 right-[-60px] w-[250px] h-[250px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)' }} />

        {/* Grid texture overlay */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

        {/* Top: Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <img src="/ff-logo.jpg" alt="Farmers Factory" className="w-11 h-11 rounded-xl object-cover shadow-lg" style={{ boxShadow: '0 8px 24px rgba(16,185,129,0.35)' }} />
            <div>
              <p className="text-white font-bold text-[16px] tracking-tight leading-tight">Farmers Factory</p>
              <p className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: '#10b981' }}>ERP v2.0</p>
            </div>
          </div>
        </div>

        {/* Center: Headline */}
        <div className="relative z-10 flex-1 flex flex-col justify-center py-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 w-fit"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-emerald-400 tracking-wider uppercase">Enterprise Resource Planning</span>
          </div>

          <h1 className="text-[42px] font-black leading-[1.1] mb-4" style={{ color: '#fff', letterSpacing: '-0.02em' }}>
            Manage Everything.<br />
            <span style={{ background: 'linear-gradient(90deg, #10b981, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              In One Place.
            </span>
          </h1>

          <p className="text-[15px] leading-relaxed mb-12" style={{ color: 'rgba(255,255,255,0.45)', maxWidth: '380px' }}>
            A complete ERP built for Farmers Factory — from farm to delivery, every operation in one unified platform.
          </p>

        </div>
      </div>

      {/* ── RIGHT PANEL ────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 relative"
        style={{ background: '#f8fafc' }}>

        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-40"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, rgba(16,185,129,0.06) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(59,130,246,0.04) 0%, transparent 50%)' }} />

        <div className="relative w-full max-w-[420px]">

          {/* Card */}
          <div className="rounded-2xl p-8 shadow-2xl"
            style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 24px 64px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)' }}>

            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-6">
                <img src="/ff-logo.jpg" alt="Farmers Factory"
                  className="w-14 h-14 rounded-2xl object-cover"
                  style={{ boxShadow: '0 8px 24px rgba(16,185,129,0.3)' }} />
                <div>
                  <p className="text-[18px] font-black text-gray-900 leading-tight tracking-tight">FARMERS FACTORY</p>
                  <p className="text-[11px] font-semibold tracking-[0.18em] uppercase mt-0.5" style={{ color: '#10b981' }}>ERP v2.0 · Secure Access</p>
                </div>
              </div>
              <h2 className="text-[24px] font-black text-gray-900 leading-tight tracking-tight">Welcome back</h2>
              <p className="text-sm text-gray-400 mt-1 font-medium">Sign in to continue to your dashboard</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">

              {/* Email field */}
              <div>
                <label className="block text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Email or Employee ID
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onFocus={() => setFocused('email')}
                    onBlur={() => setFocused(null)}
                    placeholder="you@farmersfactory.com"
                    disabled={isLoading}
                    autoComplete="username"
                    className="w-full h-12 px-4 rounded-xl text-sm font-medium text-gray-800 outline-none transition-all duration-200"
                    style={{
                      background: focused === 'email' ? '#fff' : '#f8fafc',
                      border: focused === 'email'
                        ? '2px solid #10b981'
                        : '2px solid #e8ecf0',
                      boxShadow: focused === 'email' ? '0 0 0 4px rgba(16,185,129,0.08)' : 'none',
                    }}
                  />
                </div>
              </div>

              {/* Password field */}
              <div>
                <label className="block text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                    placeholder="Enter your password"
                    disabled={isLoading}
                    autoComplete="current-password"
                    className="w-full h-12 pl-4 pr-12 rounded-xl text-sm font-medium text-gray-800 outline-none transition-all duration-200"
                    style={{
                      background: focused === 'password' ? '#fff' : '#f8fafc',
                      border: focused === 'password'
                        ? '2px solid #10b981'
                        : '2px solid #e8ecf0',
                      boxShadow: focused === 'password' ? '0 0 0 4px rgba(16,185,129,0.08)' : 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-0 h-full w-12 flex items-center justify-center transition-colors"
                    style={{ color: '#9ca3af' }}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Network error */}
              {hasNetworkError && (
                <div className="p-4 rounded-xl" style={{ background: '#fff5f5', border: '1px solid #fecaca' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <WifiOff className="w-4 h-4 text-red-500 shrink-0" />
                    <p className="text-sm text-red-700 font-semibold">Can&apos;t reach the server</p>
                  </div>
                  <p className="text-xs text-red-500 mb-3">
                    This is usually temporary on our end. Please retry, and contact support if it keeps happening.
                  </p>
                  <button
                    type="button"
                    onClick={handleNetworkCheck}
                    disabled={isCheckingNetwork}
                    className="w-full h-8 text-xs font-semibold rounded-lg transition-colors"
                    style={{ background: '#fee2e2', color: '#dc2626' }}
                  >
                    {isCheckingNetwork ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                    Retry Connection
                  </button>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 mt-2"
                style={{
                  background: isLoading
                    ? 'linear-gradient(135deg, #6ee7b7, #34d399)'
                    : 'linear-gradient(135deg, #059669, #10b981)',
                  color: '#fff',
                  boxShadow: isLoading ? 'none' : '0 8px 24px rgba(16,185,129,0.35)',
                  transform: isLoading ? 'none' : 'translateY(0)',
                }}
                onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
                ) : (
                  <>Sign In <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-4 mt-6">
            <div className="h-px flex-1" style={{ background: 'rgba(0,0,0,0.08)' }} />
            <p className="text-[11px] font-semibold tracking-widest uppercase text-gray-400">
              Farmers Factory ERP v2.0
            </p>
            <div className="h-px flex-1" style={{ background: 'rgba(0,0,0,0.08)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
