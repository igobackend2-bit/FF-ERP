import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { User, UserRole } from '@/types/igo-chain';
import { format } from 'date-fns';

const LOGIN_AUDIT_THROTTLE_MS = 10 * 60 * 1000;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Map database role string → unified UserRole type
// Handles all IGO Chain roles + Farmers Factory roles
const mapRole = (dbRole: string): UserRole => {
  const normalized = dbRole.toLowerCase().replace(/[\s_-]/g, '');
  const roleMap: Record<string, UserRole> = {
    // ── IGO Chain roles ─────────────────────────────────────
    'employee':                  'employee',
    'hr':                        'hr',
    'admin':                     'admin',
    'ceo':                       'ceo',
    'accounts':                  'accounts',
    // View-only management login (no edit/approve/delete anywhere)
    'overview':                  'overview',
    // Customer sign-ups (mobile-OTP portal / shop) land in profiles with role 'user'. They are NOT
    // staff: mapping them to 'employee' (the unknown-role default) would hand them ERP screens.
    'user':                      'customer',
    'customer':                  'customer',
    'gm':                        'gm',
    'smo':                       'smo',
    'gmo':                       'gmo',
    'boi':                       'boi',
    'nsm':                       'nsm',
    'datateam':                  'datateam',
    'data_team':                 'data_team',
    'data':                      'datateam',
    'farmmanager':               'farmmanager',
    'sitevisitfarmmanager':      'site_visit_farm_manager',
    'svfm':                      'site_visit_farm_manager',
    'purchasehead':              'purchase_head',
    'vendorhead':                'vendor_head',
    'auditor':                   'auditor',
    'director':                  'director',
    'bddata':                    'bd_data',
    'rsh':                       'rsh',
    'cafemanager':               'cafe_manager',
    'palmcafemanager':           'palm_cafe_manager',
    // ── Farmers Factory roles ────────────────────────────────
    'purchasemanager':           'purchase_manager',
    'warehousemanager':          'warehouse_manager',
    'qcmanager':                 'qc_manager',
    'hubmanager':                'hub_manager',
    'hub_manager':               'hub_manager',
    'l1manager':                 'l1_manager',
    'l1_manager':                'l1_manager',
    'fieldexecutive':            'field_executive',
    'telecaller':                'tele_caller',
    'bde':                       'bde',
    'driver':                    'driver',
    'backoffice':                'back_office',
    'shiftemployee':             'shift_employee',
    'ffoperationsmanager':       'ff_operations_manager',
    'ffopsmanager':              'ff_operations_manager',
    'collectionexecutive':       'collection_executive',
    // ── Explicit underscore variants — DB may store roles with underscores ──────
    'ff_operations_manager':     'ff_operations_manager',
    'field_executive':           'field_executive',
    'tele_caller':               'tele_caller',
    'shift_employee':            'shift_employee',
    'warehouse_manager':         'warehouse_manager',
    'qc_manager':                'qc_manager',
    'purchase_manager':          'purchase_manager',
    'purchase_head':             'purchase_head',
    'back_office':               'back_office',
    'bd_data':                   'bd_data',
    'collection_executive':      'collection_executive',
    'site_visit_farm_manager':   'site_visit_farm_manager',
    'cafe_manager':              'cafe_manager',
    'palm_cafe_manager':         'palm_cafe_manager',
    'vendor_head':               'vendor_head',
  };

  const mapped = roleMap[normalized];
  if (!mapped) {
    console.error(`[AuthContext] UNKNOWN ROLE: "${dbRole}" (normalized: "${normalized}") — check profiles table. Defaulting to employee.`);
  }
  return mapped || 'employee';
};

// ── Demo session key ──────────────────────────────────────────────────────────
const DEMO_SESSION_KEY = 'ff_erp_demo_session_v1';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const hasLoggedLoginRef = useRef(false);

  // Demo user loaded from localStorage (bypasses Supabase entirely)
  const [demoUser, setDemoUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(DEMO_SESSION_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch { return null; }
  });

  // If a demo session already exists in localStorage, skip the Supabase loading wait.
  // This prevents the redirect-to-login flash on page reload for demo users.
  const hasDemoSession = (() => {
    try { return !!localStorage.getItem(DEMO_SESSION_KEY); } catch { return false; }
  })();
  const [isLoading, setIsLoading] = useState(!hasDemoSession);

  // Log login event to daily_logs table for attendance tracking
  const logDailyLogin = async (userId: string) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const loginTime = new Date().toISOString();

    try {
      // Check if a day_start already exists for today
      const { data: existingStart } = await supabase
        .from('day_starts')
        .select('id')
        .eq('user_id', userId)
        .eq('date', today)
        .maybeSingle();

      // If no day_start exists, we can track the login time in audit_logs
      // The actual day_start is created when user submits the Day Start form
      if (!existingStart) {
        console.log('No day start yet for today - login tracked');
      }
    } catch (error) {
      console.error('Error checking daily login:', error);
    }
  };

  // Log login event to audit_logs
  const logLoginAudit = async (userId: string, userEmail: string, userName: string, userRole: string) => {
    try {
      const throttleKey = `login-audit:${userId}`;
      const lastLoggedAt = window.localStorage.getItem(throttleKey);
      if (lastLoggedAt && Date.now() - Number(lastLoggedAt) < LOGIN_AUDIT_THROTTLE_MS) return;

      await (supabase.from('audit_logs') as any).insert({
        action: 'USER_LOGIN',
        performed_by: userId,
        performed_by_name: userName,
        performed_by_role: userRole,
        record_type: 'auth',
        record_id: userId,
        after_state: {
          email: userEmail,
          login_time: new Date().toISOString(),
          date: format(new Date(), 'yyyy-MM-dd'),
        },
        remarks: `User ${userName} logged into V2.0 Dashboard`,
      } as any);
      window.localStorage.setItem(throttleKey, String(Date.now()));
      console.log('Login audit logged successfully');

      // Also track daily login
      await logDailyLogin(userId);
    } catch (error) {
      console.error('Error logging login audit:', error);
    }
  };

  const buildFallbackUser = (supabaseUser: SupabaseUser): User => ({
    id: supabaseUser.id,
    employeeId: `EMP-${supabaseUser.id.slice(0, 6).toUpperCase()}`,
    name: supabaseUser.email?.split('@')[0] || 'User',
    email: supabaseUser.email || '',
    role: 'employee',
    department: undefined,
  });

  const fetchUserProfile = async (userId: string, supabaseUser?: SupabaseUser, attempts = 0): Promise<User | null> => {
    try {
      console.log(`[AuthContext] Fetching profile for ${userId} (Attempt ${attempts + 1})`);

      const { data: profile, error } = await (supabase
        .from('profiles') as any)
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error(`[AuthContext] Error fetching profile (Attempt ${attempts + 1}):`, error);

        // Retry logic for transient errors
        if (attempts < 2) {
          const delay = Math.pow(2, attempts) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchUserProfile(userId, supabaseUser, attempts + 1);
        }

        // Return fallback user so user isn't kicked to login after failures
        return supabaseUser ? buildFallbackUser(supabaseUser) : null;
      }

      if (profile) {
        const p = profile as any;
        console.log(`[AuthContext] Profile found: ${p.role} - ${p.name}`);
        const mappedUser: User = {
          id: p.id,
          employeeId: p.office_number || `EMP-${p.id.slice(0, 6).toUpperCase()}`,
          name: p.name || 'Update Required',
          email: p.email,
          role: mapRole(p.role),
          department: p.department,
          ff_ops_access: p.ff_ops_access ?? false,
          ff_payment_access: p.ff_payment_access ?? false,
          ...(p.hub_id ? { hub_id: p.hub_id } : {}),
        } as any;
        return mappedUser;
      }

      // If no profile record exists yet, we should retry briefly in case of replication lag
      if (attempts < 1) {
        await new Promise(resolve => setTimeout(resolve, 800));
        return fetchUserProfile(userId, supabaseUser, attempts + 1);
      }

      console.warn(`[AuthContext] No profile record found for user ${userId} in DB`);
      // Profile not found but user exists in auth
      return supabaseUser ? buildFallbackUser(supabaseUser) : null;
    } catch (error) {
      console.error(`[AuthContext] Unexpected error in fetchUserProfile (Attempt ${attempts + 1}):`, error);
      if (attempts < 2) {
        const delay = Math.pow(2, attempts) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchUserProfile(userId, supabaseUser, attempts + 1);
      }
      return supabaseUser ? buildFallbackUser(supabaseUser) : null;
    }
  };

  useEffect(() => {
    // If demo session is active, Supabase auth is not used — skip the whole flow.
    if (hasDemoSession) return;

    // Safety timeout: Ensure loading state is eventually cleared even if Supabase calls hang
    const safetyTimeout = setTimeout(() => {
      if (isLoading) {
        console.warn('Auth loading safety timeout triggered');
        setIsLoading(false);
      }
    }, 8000);

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);

        if (newSession?.user) {
          // Defer Supabase calls with setTimeout to prevent deadlock
          setTimeout(async () => {
            try {
              const userProfile = await fetchUserProfile(newSession.user.id, newSession.user);
              setUser(userProfile);

              // Log login event on SIGNED_IN event (not on initial session check)
              if (event === 'SIGNED_IN' && userProfile && !hasLoggedLoginRef.current) {
                hasLoggedLoginRef.current = true;
                // Don't await logging to prevent it from blocking the UI
                logLoginAudit(
                  userProfile.id,
                  userProfile.email,
                  userProfile.name,
                  userProfile.role
                ).catch(err => console.error('Silent login audit failed:', err));
              }
            } catch (err) {
              console.error('Error in auth state change handler:', err);
            } finally {
              setIsLoading(false);
              clearTimeout(safetyTimeout);
            }
          }, 0);
        } else {
          setUser(null);
          setIsLoading(false);
          hasLoggedLoginRef.current = false;
          clearTimeout(safetyTimeout);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);

      if (existingSession?.user) {
        fetchUserProfile(existingSession.user.id, existingSession.user).then((userProfile) => {
          setUser(userProfile);
          setIsLoading(false);
          clearTimeout(safetyTimeout);
        }).catch(err => {
          console.error('Initial session fetch failed:', err);
          setIsLoading(false);
          clearTimeout(safetyTimeout);
        });
      } else {
        setIsLoading(false);
        clearTimeout(safetyTimeout);
      }
    }).catch(err => {
      console.error('Get session failed:', err);
      setIsLoading(false);
      clearTimeout(safetyTimeout);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimeout);
    };
  }, []);

  const logout = async () => {
    // Log logout event before signing out
    if (user) {
      try {
        await (supabase.from('audit_logs') as any).insert({
          action: 'USER_LOGOUT',
          performed_by: user.id,
          performed_by_name: user.name,
          performed_by_role: user.role,
          record_type: 'auth',
          record_id: user.id,
          before_state: {
            email: user.email,
            logout_time: new Date().toISOString(),
          },
          remarks: `User ${user.name} logged out`,
        } as any);
      } catch (error) {
        console.error('Error logging logout audit:', error);
      }
    }

    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setDemoUser(null);
    localStorage.removeItem(DEMO_SESSION_KEY);
    hasLoggedLoginRef.current = false;
  };

  // Called directly by LoginPage for demo credentials — updates state immediately
  const loginAsDemo = (u: User) => {
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(u));
    setDemoUser(u);
  };

  // Resolved user: real Supabase user takes priority, then demo user
  const resolvedUser = user ?? demoUser;
  const isAuthenticated = (!!session && !!user) || !!demoUser;

  return (
    <AuthContext.Provider value={{
      user: resolvedUser,
      session,
      isAuthenticated,
      isLoading,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
