import { LogOut, ShieldOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// Shown to customer sign-ups (profiles.role = 'user' / 'customer'). They signed in through the
// mobile-OTP customer portal or the shop; they are not ERP staff and must never see ERP screens.
export default function NoAccessPage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
          <ShieldOff className="h-6 w-6 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-800">This isn't a staff account</h1>
        <p className="mt-2 text-sm text-slate-500">
          The Farmers Factory ERP is only for our team. You are signed in as a customer, so there is nothing
          for you here. If you are a team member, please ask your admin to set up your staff login.
        </p>
        <button
          onClick={() => { void logout(); }}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
