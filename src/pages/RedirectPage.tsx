import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

// ff_ops_access is a delegated-view flag meant only for sales-side staff
// (field_executive / bde / tele_caller) who get loaned ops-manager visibility
// without a role change. It must NEVER hijack the login landing page for
// operational roles that already have their own dashboard (warehouse_manager,
// qc_manager, hub_manager, purchase_manager, etc.) — see App.tsx line ~484.
const FF_OPS_ACCESS_ELIGIBLE_ROLES = new Set(['field_executive', 'bde', 'tele_caller']);

export function RedirectPage() {
  const { user, isLoading, session, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);

  const performRedirect = useCallback(async (userId: string, role: string) => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const roleRoutes: Record<string, string> = {
        // \u2500\u2500 IGO Chain roles \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        employee:                  '/employee-dashboard',
        hr:                        '/hr-dashboard',
        admin:                     '/admin-dashboard',
        ceo:                       '/ceo-dashboard',
        accounts:                  '/accounts-execution',
        overview:                  '/overview',
        gmo:                       '/dashboard/gmo',
        gm:                        '/gm/ff-payments',
        smo:                       '/dashboard/smo',
        boi:                       '/day-start',
        nsm:                       '/nsm-dashboard',
        datateam:                  '/datateam-dashboard',
        data_team:                 '/datateam-dashboard',
        data:                      '/datateam-dashboard',
        purchase:                  '/purchase/dashboard',
        vendor:                    '/vendor-sourcing/dashboard',
        vendor_head:               '/vendor-sourcing/dashboard',
        auditor:                   '/auditor/ff-payments',
        rsh:                       '/rsh/rentals',
        bd_data:                   '/projects',
        site_visit_farm_manager:   '/site-visit-fm-dashboard',
        farmmanager:               '/shift/dashboard',
        cafe_manager:              '/cafe/manager',
        palm_cafe_manager:         '/cafe/manager',
        director:                  '/director/workflow',
        // \u2500\u2500 Farmers Factory roles \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        ff_operations_manager:     '/ff-operations',
        purchase_manager:          '/purchase',
        purchase_head:             '/purchase',
        warehouse_manager:         '/warehouse',
        qc_manager:                '/warehouse/qc',
        hub_manager:               '/shift/dashboard',
        l1_manager:                '/l1/payments',
        field_executive:           '/sales',
        bde:                       '/sales',
        tele_caller:               '/tele-caller',
        driver:                    '/driver',
        back_office:               '/reports',
        shift_employee:            '/purchase',
        collection_executive:      '/collections/entry',
      };

      const normalizedRole = role.toLowerCase();

      // Customer sign-ups are not ERP staff - send them to the dead-end page, never to a dashboard
      if (normalizedRole === 'customer') {
        navigate('/no-access', { replace: true });
        return;
      }
      let destination = roleRoutes[normalizedRole] || '/day-start';

      // Skip Supabase queries for demo users (no real DB record)
      if (userId.startsWith('demo-')) {
        navigate(destination, { replace: true });
        return;
      }

      if (normalizedRole === 'employee') {
        const [shiftCheck, weekOffCheck] = await Promise.all([
          supabase.from('shift_user_assignments')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle(),
          supabase.rpc('is_week_off_day', {
            p_employee_id: userId,
            p_date: format(new Date(), 'yyyy-MM-dd')
          })
        ]);

        if (shiftCheck.data) {
          destination = '/shift/dashboard';
        } else if (weekOffCheck.data) {
          destination = '/my-tasks';
        }
      } else {
        // shift_employee (purchase exec) always lands on /purchase directly
        if (normalizedRole === 'shift_employee') {
          navigate('/purchase', { replace: true });
          return;
        }

        // ONLY purchase-side / hub roles check shift_user_assignments.
        // FF sales roles (field_executive, tele_caller, bde, driver, back_office)
        // have fixed destinations and must NEVER be redirected to /shift/dashboard.
        const SHIFT_ELIGIBLE_ROLES = new Set([
          'hub_manager', 'purchase_manager', 'purchase_head', 'farmmanager',
        ]);

        if (SHIFT_ELIGIBLE_ROLES.has(normalizedRole)) {
          const { data: shiftData } = await (supabase
            .from('shift_user_assignments') as any)
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle();

          if (shiftData) {
            destination = '/shift/dashboard';
          }
        }

        if (normalizedRole === 'smo' || normalizedRole === 'rsh' || normalizedRole === 'site_visit_farm_manager' || normalizedRole === 'farmmanager') {
          const { data: deptProfile } = await supabase
            .from('profiles')
            .select('department')
            .eq('id', userId)
            .maybeSingle();

          const dept = (deptProfile?.department || user?.department || '').toLowerCase();

          if (normalizedRole === 'smo' && (dept === 'site visit' || dept === 'rental sourcing')) {
            destination = '/site-visit-fm-dashboard';
          } else if (normalizedRole === 'rsh') {
            destination = '/site-visit-request/my';
          }
        }
      }

      navigate(destination, { replace: true });
    } catch (error) {
      console.error('Redirect logic failed:', error);
      navigate('/day-start', { replace: true });
    }
  }, [navigate, isProcessing]);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }

    if (user) {
      // ff_ops_access: only sales-side roles get the delegated ops-manager landing.
      // Operational roles (warehouse_manager, qc_manager, hub_manager, etc.) always
      // land on their own dashboard even if this flag is set on their profile.
      if ((user as any).ff_ops_access && FF_OPS_ACCESS_ELIGIBLE_ROLES.has((user.role || '').toLowerCase())) {
        navigate('/ff-operations', { replace: true });
        return;
      }
      performRedirect(user.id, user.role);
    } else if (session) {
      const fetchProfileAndRedirect = async () => {
        try {
          const { data: profile } = await (supabase as any)
            .from('profiles')
            .select('role, ff_ops_access')
            .eq('id', session.user.id)
            .maybeSingle();

          if (profile?.role) {
            if (profile.ff_ops_access && FF_OPS_ACCESS_ELIGIBLE_ROLES.has((profile.role || '').toLowerCase())) {
              navigate('/ff-operations', { replace: true });
              return;
            }
            performRedirect(session.user.id, profile.role);
          } else {
            setTimeout(() => {
              navigate('/login', { replace: true });
            }, 3000);
          }
        } catch (err) {
          navigate('/login', { replace: true });
        }
      };

      fetchProfileAndRedirect();
    }
  }, [user, isLoading, session, performRedirect, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center relative">
        <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full" />
        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-6 relative z-10" />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-zinc-400 font-medium tracking-wide relative z-10"
        >
          Synchronizing Workspace...
        </motion.p>
      </div>
    </div>
  );
}
