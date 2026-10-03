import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, UserPlus, Users, Loader2, Eye, EyeOff, Trash2, Edit, Key, Activity, Calendar, Clock, FileText, AlertCircle, Download, RotateCcw, AlertTriangle, Upload, CheckCircle2, XCircle, Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ROLES, DEPARTMENTS } from '@/constants/departments';
import { format } from 'date-fns';
import { exportToCSV } from '@/lib/exportUtils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';

interface Profile {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  office_number: string | null;
  created_at: string;
}

export function UserManagementPage() {
  const { user: authUser } = useAuth();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Auto-fill a fresh Employee ID whenever the create-user dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      const digits = Math.floor(100000 + Math.random() * 900000);
      setEmployeeId(`EMP-${digits}`);
    }
  }, [isDialogOpen]);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [deletingUser, setDeletingUser] = useState<Profile | null>(null);
  const [viewingUser, setViewingUser] = useState<Profile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [resettingUser, setResettingUser] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Employee');
  const [department, setDepartment] = useState('Farmers Factory');
  const [employeeId, setEmployeeId] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);

  // CSV Import state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [csvData, setCsvData] = useState<Array<{
    name: string;
    email: string;
    password: string;
    role: string;
    department: string;
    employee_id: string;
    isValid: boolean;
    error?: string;
  }>>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] }>({ success: 0, failed: 0, errors: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  // Customer sign-ups (mobile OTP portal / shop) also land in profiles with role 'user'. They are not
  // staff: they are kept out of this list and have their own page (/admin/website-customers).

  // Fetch all active users (soft delete filter)
  const { data: users, isLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('id, name, email, role, department, office_number, created_at, is_active')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Profile[];
    },
  });

  // Fetch departments
  const { data: dbDepartments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('name, code')
        .eq('is_active', true)
        .order('name');

      if (error) {
        console.error('Error fetching departments:', error);
        return [];
      }
      return data;
    },
  });

  const availableDepartments = dbDepartments?.length
    ? dbDepartments.map(d => ({ value: d.name, label: d.name }))
    : DEPARTMENTS.map(d => ({ value: d.value, label: d.label }));

  // Fetch employee activity data
  const { data: employeeActivity, isLoading: isLoadingActivity } = useQuery({
    queryKey: ['employee-activity', viewingUser?.id],
    queryFn: async () => {
      if (!viewingUser) return null;

      const [dayStarts, dayPlans, hourlyReports, eodReports, issues] = await Promise.all([
        supabase.from('day_starts').select('*').eq('user_id', viewingUser.id).order('date', { ascending: false }).limit(30),
        supabase.from('day_plans').select('*').eq('user_id', viewingUser.id).order('date', { ascending: false }).limit(30),
        supabase.from('hourly_reports').select('*').eq('user_id', viewingUser.id).order('date', { ascending: false }).limit(50),
        supabase.from('eod_reports').select('*').eq('user_id', viewingUser.id).order('date', { ascending: false }).limit(30),
        supabase.from('employee_issues').select('*').eq('employee_id', viewingUser.id).order('created_at', { ascending: false }),
      ]);

      return {
        dayStarts: dayStarts.data || [],
        dayPlans: dayPlans.data || [],
        hourlyReports: hourlyReports.data || [],
        eodReports: eodReports.data || [],
        issues: issues.data || [],
      };
    },
    enabled: !!viewingUser,
  });

  const generateEmployeeId = () => {
    const digits = Math.floor(100000 + Math.random() * 900000); // 6 digits
    setEmployeeId(`EMP-${digits}`);
  };

  const generateSecurePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let pass = '';
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(pass);
    toast.success('Secure password generated');
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !email.trim() || !password.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setIsCreating(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('create-user', {
        body: {
          email: email.trim(),
          password,
          name: name.trim(),
          role: role,
          department: department,
          employeeId: employeeId.trim() || null,
        }
      });

      if (functionError || data?.error) {
        const errorMsg = functionError?.message || data?.error || 'Failed to create user';
        if (errorMsg.includes('already registered')) {
          toast.error('This email is already registered');
        } else {
          toast.error(errorMsg);
        }
        return;
      }

      toast.success(`User ${name} created successfully! Credentials have been set.`);
      // Security: Do not display password in toast - it's visible on screen

      setName('');
      setEmail('');
      setPassword('');
      setRole('Employee');
      setDepartment('Farmers Factory');
      setEmployeeId('');
      setIsDialogOpen(false);

      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    } catch (error) {
      toast.error('Failed to create user');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    if (!editName.trim()) {
      toast.error('Name cannot be empty');
      return;
    }

    setIsUpdating(true);
    try {
      const { error } = await (supabase
        .from('profiles') as any)
        .update({
          name: editName.trim(),
          role: editRole,
          department: editDepartment,
          office_number: editEmployeeId.trim() || null,
          is_active: editIsActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingUser.id);

      if (error) throw error;

      toast.success('User updated successfully');
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    } catch (error: any) {
      console.error('Update error:', error);
      toast.error(error.message || 'Failed to update user');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;

    setIsDeleting(true);
    try {
      // Call edge function to permanently delete user from auth.users (cascades to profiles)
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { userId: deletingUser.id }
      });

      if (error) {
        console.error('Delete user error:', error);
        throw new Error(error.message || 'Failed to delete user');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast.success(`User ${deletingUser.name} deleted permanently`);
      setSelectedUserIds((prev) => {
        const next = new Set(prev);
        next.delete(deletingUser.id);
        return next;
      });
      setDeletingUser(null);
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    } catch (error: any) {
      console.error('Delete error:', error);
      toast.error(error.message || 'Failed to delete user.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resettingUser) return;
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setIsResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: { userId: resettingUser.id, newPassword }
      });

      if (error) throw new Error(error.message || 'Failed to reset password');
      if (data?.error) throw new Error(data.error);

      toast.success(`Password updated for ${resettingUser.name}`);
      setResettingUser(null);
      setNewPassword('');
    } catch (error: any) {
      console.error('Reset password error:', error);
      toast.error(error.message || 'Failed to reset password.');
    } finally {
      setIsResetting(false);
    }
  };

  const toggleUserSelection = (userId: string, checked: boolean) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  };

  const handleToggleSelectAllFiltered = (checked: boolean, userIds: string[]) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      userIds.forEach((id) => {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      });
      return next;
    });
  };

  const handleBulkDeleteUsers = async () => {
    const idsToDelete = Array.from(selectedUserIds);
    if (idsToDelete.length === 0) return;

    setIsBulkDeleting(true);
    try {
      let successCount = 0;
      const failedUsers: string[] = [];
      const skippedUsers: string[] = [];

      const deleteUserWithTimeout = async (userId: string, timeoutMs = 15000) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          return await Promise.race([
            supabase.functions.invoke('delete-user', { body: { userId } }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Delete request timed out')), timeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      const deletableIds = idsToDelete.filter((userId) => {
        if (authUser?.id && userId === authUser.id) {
          const me = users?.find((u) => u.id === userId);
          skippedUsers.push(me?.name || 'Current User');
          return false;
        }
        return true;
      });

      const chunkSize = 5;
      for (let i = 0; i < deletableIds.length; i += chunkSize) {
        const chunk = deletableIds.slice(i, i + chunkSize);
        const results = await Promise.all(
          chunk.map(async (userId) => {
            const targetUser = users?.find((u) => u.id === userId);
            try {
              const { data, error } = await deleteUserWithTimeout(userId);
              if (error || (data as any)?.error) {
                failedUsers.push(targetUser?.name || userId);
              } else {
                successCount++;
              }
            } catch {
              failedUsers.push(targetUser?.name || userId);
            }
          })
        );
        void results;
      }

      if (successCount > 0) {
        toast.success(`${successCount} user${successCount > 1 ? 's' : ''} deleted permanently`);
      }

      if (failedUsers.length > 0) {
        toast.error(`Failed to delete ${failedUsers.length} user${failedUsers.length > 1 ? 's' : ''}`);
      }

      if (skippedUsers.length > 0) {
        toast.warning('Skipped current logged-in user from bulk delete');
      }

      setSelectedUserIds(new Set());
      setShowBulkDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    } catch (error: any) {
      console.error('Bulk delete error:', error);
      toast.error(error.message || 'Failed to delete selected users.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const openEditDialog = (user: Profile) => {
    setEditingUser(user);
    setEditName(user.name);
    // Normalize role to match ROLES constant (case-insensitive matching)
    const matchedRole = ROLES.find(r => r.value.toLowerCase() === user.role?.toLowerCase());
    setEditRole(matchedRole?.value || user.role || 'Employee');
    setEditDepartment(user.department);
    setEditEmployeeId(user.office_number || '');
    setEditIsActive((user as any).is_active !== false);
  };

  // Master Reset functionality removed for security - use Supabase dashboard for data management

  const handleExportCSV = () => {
    if (!users || users.length === 0) {
      toast.error('No users to export');
      return;
    }

    exportToCSV(
      users.map(u => ({
        employee_id: u.office_number || 'N/A',
        name: u.name,
        email: u.email,
        role: u.role,
        department: u.department,
        created_at: format(new Date(u.created_at), 'yyyy-MM-dd HH:mm'),
      })),
      `employees_${format(new Date(), 'yyyy-MM-dd')}`,
      [
        { key: 'employee_id', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role' },
        { key: 'department', label: 'Department' },
        { key: 'created_at', label: 'Created At' },
      ]
    );
    toast.success('Employee data exported successfully');
  };

  // CSV Import Functions
  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let pass = '';
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  };

  const validateRole = (role: string): string => {
    const validRoles = ROLES.map(r => r.value.toLowerCase());
    const normalizedRole = role.trim();
    const matchedRole = ROLES.find(r => r.value.toLowerCase() === normalizedRole.toLowerCase());
    return matchedRole ? matchedRole.value : 'Employee';
  };

  const validateDepartment = (dept: string): string => {
    const normalizedDept = dept.trim();
    if (!availableDepartments.length) return 'Farmers Factory';

    const matchedDept = availableDepartments.find(d =>
      d.value.toLowerCase() === normalizedDept.toLowerCase() ||
      d.label.toLowerCase() === normalizedDept.toLowerCase()
    );
    return matchedDept ? matchedDept.value : 'Farmers Factory';
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file);
  };

  const parseCSV = (text: string) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      toast.error('CSV file is empty or has no data rows');
      return;
    }

    // Parse header
    const headerLine = lines[0].toLowerCase();
    const headers = headerLine.split(',').map(h => h.trim().replace(/"/g, ''));

    // Find column indexes
    const nameIdx = headers.findIndex(h => h.includes('name'));
    const emailIdx = headers.findIndex(h => h.includes('email'));
    const roleIdx = headers.findIndex(h => h.includes('role'));
    const deptIdx = headers.findIndex(h => h.includes('department') || h.includes('dept'));
    const empIdIdx = headers.findIndex(h => h.includes('employee') && h.includes('id') || h === 'employee_id' || h === 'emp_id');
    const passwordIdx = headers.findIndex(h => h.includes('password'));

    if (nameIdx === -1 || emailIdx === -1) {
      toast.error('CSV must have "Name" and "Email" columns');
      return;
    }

    // Parse data rows
    const existingEmails = users?.map(u => u.email.toLowerCase()) || [];
    const parsedData: typeof csvData = [];
    const seenEmails = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));

      const name = values[nameIdx] || '';
      const email = values[emailIdx] || '';
      const role = roleIdx !== -1 ? validateRole(values[roleIdx] || '') : 'Employee';
      const department = deptIdx !== -1 ? validateDepartment(values[deptIdx] || '') : 'Farmers Factory';
      const employee_id = empIdIdx !== -1 ? (values[empIdIdx] || '') : '';
      const password = passwordIdx !== -1 && values[passwordIdx] ? values[passwordIdx] : generateRandomPassword();

      let isValid = true;
      let error = '';

      if (!name.trim()) {
        isValid = false;
        error = 'Name is required';
      } else if (!email.trim()) {
        isValid = false;
        error = 'Email is required';
      } else if (!validateEmail(email)) {
        isValid = false;
        error = 'Invalid email format';
      } else if (existingEmails.includes(email.toLowerCase())) {
        isValid = false;
        error = 'Email already exists';
      } else if (seenEmails.has(email.toLowerCase())) {
        isValid = false;
        error = 'Duplicate email in CSV';
      } else if (password.length < 8) {
        isValid = false;
        error = 'Password must be at least 8 characters';
      }

      seenEmails.add(email.toLowerCase());

      parsedData.push({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        department,
        employee_id: employee_id.trim(),
        isValid,
        error,
      });
    }

    setCsvData(parsedData);
    setImportResults({ success: 0, failed: 0, errors: [] });
    setImportProgress(0);
  };

  const handleImportUsers = async () => {
    const validUsers = csvData.filter(u => u.isValid);
    if (validUsers.length === 0) {
      toast.error('No valid users to import');
      return;
    }

    setIsImporting(true);
    setImportProgress(0);
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < validUsers.length; i++) {
      const user = validUsers[i];
      setImportProgress(Math.round(((i + 1) / validUsers.length) * 100));

      try {
        const { data, error: functionError } = await supabase.functions.invoke('create-user', {
          body: {
            email: user.email,
            password: user.password,
            name: user.name,
            role: user.role,
            department: user.department,
            employeeId: user.employee_id || null,
          }
        });

        if (functionError || data?.error) {
          results.failed++;
          results.errors.push(`${user.email}: ${functionError?.message || data?.error || 'Unknown error'}`);
        } else {
          results.success++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`${user.email}: Unexpected error`);
      }
    }

    setImportResults(results);
    setIsImporting(false);

    if (results.success > 0) {
      toast.success(`Successfully imported ${results.success} user(s)`);
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    }
    if (results.failed > 0) {
      toast.error(`Failed to import ${results.failed} user(s)`);
    }
  };

  const downloadSampleCSV = () => {
    const sampleData = `name,email,password,role,department,employee_id
John Doe,john.doe@example.com,SecurePass123!,Employee,Engineering,EMP001
Jane Smith,jane.smith@example.com,SecurePass456!,HR,HR,EMP002
Bob Wilson,bob.wilson@example.com,,Admin,Admin,EMP003`;

    const blob = new Blob([sampleData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_users_import.csv';
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Sample CSV downloaded');
  };

  const resetImportState = () => {
    setCsvData([]);
    setImportResults({ success: 0, failed: 0, errors: [] });
    setImportProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      CEO: 'bg-authority-ceo/10 text-authority-ceo border-authority-ceo/30',
      Admin: 'bg-authority-admin/5 text-authority-admin border-authority-admin/20',
      HR: 'bg-authority-hr/10 text-authority-hr border-authority-hr/30',
      Accounts: 'bg-primary/10 text-primary border-primary/30',
      Auditor: 'bg-authority-admin/5 text-authority-admin border-authority-admin/20',
      Director: 'bg-primary/20 text-primary border-primary/40',
      RSH: 'bg-authority-rsh/10 text-authority-rsh border-authority-rsh/30',
      BD_Data: 'bg-indigo-100/10 text-indigo-600 border-indigo-200/30',
      purchase_head: 'bg-teal-500/10 text-teal-600 border-teal-500/30',
      palm_cafe_manager: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
      Employee: 'bg-muted/50 text-muted-foreground border-border',
    };
    return colors[role] || colors.Employee;
  };

  const isCustomerAccount = (u: Profile) => ['user', 'customer'].includes((u.role || '').toLowerCase());
  const customerCount = users?.filter(isCustomerAccount).length || 0;
  const poolCount = (users?.length || 0) - customerCount;

  // Filter users by search and department
  const filteredUsers = users?.filter(user => {
    if (isCustomerAccount(user)) return false;
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      (user.name?.toLowerCase().includes(query) || false) ||
      (user.email?.toLowerCase().includes(query) || false) ||
      (user.office_number?.toLowerCase().includes(query) || false) ||
      (user.role?.toLowerCase().includes(query) || false) ||
      (user.department?.toLowerCase().includes(query) || false)
    );
    const matchesDepartment = departmentFilter === 'all' || user.department === departmentFilter;
    return matchesSearch && matchesDepartment;
  }) || [];

  // Get unique departments for filter
  const uniqueDepartments = [...new Set(users?.map(u => u.department) || [])].sort();
  const filteredUserIds = filteredUsers.map((u) => u.id);
  const selectedFilteredCount = filteredUserIds.filter((id) => selectedUserIds.has(id)).length;
  const allFilteredSelected = filteredUserIds.length > 0 && selectedFilteredCount === filteredUserIds.length;

  const usersByRole = users?.reduce((acc, user) => {
    const role = user.role || 'Employee';
    if (!acc[role]) acc[role] = [];
    acc[role].push(user);
    return acc;
  }, {} as Record<string, Profile[]>) || {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-authority-admin/20 flex items-center justify-center">
            <Shield className="w-7 h-7 text-authority-admin" />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-1">Admin Panel</h1>
            <p className="text-muted-foreground">Manage users, roles, and view employee activity</p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={handleExportCSV}>
            <Download className="w-4 h-4" />
            Export CSV
          </Button>

          {/* Import CSV Button & Dialog */}
          <Dialog open={isImportDialogOpen} onOpenChange={(open) => {
            setIsImportDialogOpen(open);
            if (!open) resetImportState();
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Upload className="w-4 h-4" />
                Import CSV
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Upload className="w-5 h-5" />
                  Import Users from CSV
                </DialogTitle>
                <DialogDescription>
                  Upload a CSV file with user data. Required columns: Name, Email. Optional: Password, Role, Department, Employee ID
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {/* File Upload Section */}
                <div className="flex gap-4 items-center">
                  <div className="flex-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="csv-upload"
                    />
                    <Label
                      htmlFor="csv-upload"
                      className="flex items-center justify-center gap-2 h-20 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Upload className="w-5 h-5 text-muted-foreground" />
                      <span className="text-muted-foreground">Click to upload CSV file</span>
                    </Label>
                  </div>
                  <Button variant="outline" onClick={downloadSampleCSV} className="gap-2">
                    <Download className="w-4 h-4" />
                    Sample CSV
                  </Button>
                </div>

                {/* CSV Preview Table */}
                {csvData.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1 text-status-live">
                          <CheckCircle2 className="w-4 h-4" />
                          Valid: {csvData.filter(u => u.isValid).length}
                        </span>
                        <span className="flex items-center gap-1 text-status-missed">
                          <XCircle className="w-4 h-4" />
                          Invalid: {csvData.filter(u => !u.isValid).length}
                        </span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={resetImportState}>
                        Clear
                      </Button>
                    </div>

                    <ScrollArea className="h-[300px] border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">Status</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Password</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Department</TableHead>
                            <TableHead>Emp ID</TableHead>
                            <TableHead>Error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {csvData.map((user, idx) => (
                            <TableRow key={idx} className={!user.isValid ? 'bg-status-missed/5' : ''}>
                              <TableCell>
                                {user.isValid ? (
                                  <CheckCircle2 className="w-4 h-4 text-status-live" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-status-missed" />
                                )}
                              </TableCell>
                              <TableCell className="font-medium">{user.name || '-'}</TableCell>
                              <TableCell>{user.email || '-'}</TableCell>
                              <TableCell className="font-mono text-xs">{user.password.slice(0, 8)}...</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={getRoleBadgeColor(user.role)}>
                                  {user.role}
                                </Badge>
                              </TableCell>
                              <TableCell>{user.department}</TableCell>
                              <TableCell>{user.employee_id || '-'}</TableCell>
                              <TableCell className="text-status-missed text-xs">{user.error || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>

                    {/* Import Progress */}
                    {isImporting && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span>Importing users...</span>
                          <span>{importProgress}%</span>
                        </div>
                        <Progress value={importProgress} className="h-2" />
                      </div>
                    )}

                    {/* Import Results */}
                    {importResults.success > 0 || importResults.failed > 0 ? (
                      <Alert className={importResults.failed > 0 ? 'border-status-late' : 'border-status-live'}>
                        <AlertDescription>
                          <div className="flex items-center gap-4">
                            <span className="text-status-live">✓ {importResults.success} imported</span>
                            {importResults.failed > 0 && (
                              <span className="text-status-missed">✗ {importResults.failed} failed</span>
                            )}
                          </div>
                          {importResults.errors.length > 0 && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              {importResults.errors.slice(0, 5).map((err, i) => (
                                <div key={i}>• {err}</div>
                              ))}
                              {importResults.errors.length > 5 && (
                                <div>...and {importResults.errors.length - 5} more errors</div>
                              )}
                            </div>
                          )}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </>
                )}
              </div>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImportUsers}
                  disabled={isImporting || csvData.filter(u => u.isValid).length === 0}
                  className="gap-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Import {csvData.filter(u => u.isValid).length} Users
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <UserPlus className="w-4 h-4" />
                Create New User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5" />
                  Create New User
                </DialogTitle>
              </DialogHeader>

              <form onSubmit={handleCreateUser} className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter full name"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter email address"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="password">Password</Label>
                  <div className="flex gap-2 mt-1">
                    <div className="relative flex-1">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <Button type="button" variant="outline" size="icon" onClick={generateSecurePassword}>
                      <Key className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Min 8 characters. Click key icon to generate.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="role">Role</Label>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map(r => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="department">Department</Label>
                    <Select value={department} onValueChange={setDepartment}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableDepartments.length > 0 ? (
                          availableDepartments.map(d => (
                            <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                          ))
                        ) : (
                          <SelectItem value="Engineering">Engineering</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="employeeId">Employee ID</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="employeeId"
                      value={employeeId}
                      onChange={(e) => setEmployeeId(e.target.value)}
                      placeholder="e.g., EMP-123456"
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={generateEmployeeId}>
                      <Key className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Auto-generated. Click key icon for a new one, or edit manually.</p>
                </div>

                <Button type="submit" className="w-full" disabled={isCreating}>
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create User'
                  )}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {
          ['CEO', 'Admin', 'HR', 'Accounts', 'Auditor', 'Employee'].map((role) => (
            <Card key={role}>
              <CardContent className="pt-4 px-4 pb-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{role}</span>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">{usersByRole[role]?.length || 0}</span>
                    <Badge variant="outline" className={getRoleBadgeColor(role)}>
                      {role.charAt(0)}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        }
      </div>

      {/* User List */}
      {
        isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Staff Users ({filteredUsers.length}{filteredUsers.length !== poolCount ? ` of ${poolCount}` : ''})
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredUsers.length === 0}
                    onClick={() => handleToggleSelectAllFiltered(!allFilteredSelected, filteredUserIds)}
                  >
                    {allFilteredSelected ? 'Clear Selection' : 'Select All Visible'}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selectedUserIds.size === 0}
                    onClick={() => setShowBulkDeleteConfirm(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete Selected ({selectedUserIds.size})
                  </Button>
                </div>
                <div className="flex gap-3">
                  <div className="relative flex-1 md:w-[250px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search by name, email, ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                    <SelectTrigger className="w-[180px]">
                      <Filter className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {uniqueDepartments.map(dept => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button asChild variant="outline" className="whitespace-nowrap">
                    <Link to="/admin/website-customers" title="Customers who signed up on the website or customer portal are listed on their own page">
                      Website customers ({customerCount}) →
                    </Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <Checkbox
                        checked={selectedUserIds.has(user.id)}
                        onCheckedChange={(checked) => toggleUserSelection(user.id, checked === true)}
                        aria-label={`Select ${user.name}`}
                      />
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-semibold text-primary">
                          {user.name?.charAt(0)?.toUpperCase() || 'U'}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{user.name}</p>
                          {user.office_number && (
                            <Badge variant="secondary" className="text-xs font-mono">
                              {user.office_number}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">
                        {user.department}
                      </Badge>
                      <Badge variant="outline" className={getRoleBadgeColor(user.role)}>
                        {user.role}
                      </Badge>
                      {(user as any).is_active === false ? (
                        <Badge variant="outline" className="bg-status-missed/10 text-status-missed border-status-missed/30">
                          Inactive
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-status-live/10 text-status-live border-status-live/30">
                          Active
                        </Badge>
                      )}
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            const newStatus = (user as any).is_active === false;
                            const { error } = await (supabase
                              .from('profiles') as any)
                              .update({ is_active: newStatus })
                              .eq('id', user.id);
                            if (!error) {
                              toast.success(`User marked as ${newStatus ? 'Active' : 'Inactive'}`);
                              queryClient.invalidateQueries({ queryKey: ['all-users'] });
                            }
                          }}
                          title={(user as any).is_active === false ? "Activate User" : "Deactivate User"}
                        >
                          {(user as any).is_active === false ? <CheckCircle2 className="w-4 h-4 text-status-live" /> : <XCircle className="w-4 h-4 text-status-missed" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setViewingUser(user)}
                          title="View Activity"
                        >
                          <Activity className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(user)}
                          title="Edit Role"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setResettingUser(user); setNewPassword(''); }}
                          title="Reset Password"
                        >
                          <Key className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeletingUser(user)}
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredUsers.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    {users?.length === 0 ? 'No users found. Create your first user above.' : 'No users match your search criteria.'}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )
      }

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5" />
              Edit User: {editingUser?.name}
            </DialogTitle>
            <DialogDescription>
              Update role, department, and employee ID for this user
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div>
              <Label>Full Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Full Name"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Employee ID</Label>
              <Input
                value={editEmployeeId}
                onChange={(e) => setEditEmployeeId(e.target.value)}
                placeholder="e.g., EMP001"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={editDepartment} onValueChange={setEditDepartment}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {availableDepartments.length > 0 ? (
                    availableDepartments.map(d => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))
                  ) : (
                    <SelectItem value="Engineering">Engineering</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
              <div className="space-y-0.5">
                <Label>Account Status</Label>
                <p className="text-xs text-muted-foreground">Inactive users can still login but are marked separately</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={editIsActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEditIsActive(true)}
                  className={editIsActive ? "bg-status-live hover:bg-status-live" : ""}
                >
                  Active
                </Button>
                <Button
                  type="button"
                  variant={!editIsActive ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => setEditIsActive(false)}
                >
                  Inactive
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
            <Button onClick={handleUpdateUser} disabled={isUpdating}>
              {isUpdating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete Selected Users
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selectedUserIds.size}</strong> selected user{selectedUserIds.size !== 1 ? 's' : ''}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowBulkDeleteConfirm(false)} disabled={isBulkDeleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDeleteUsers} disabled={isBulkDeleting || selectedUserIds.size === 0}>
              {isBulkDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Delete Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete User
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deletingUser?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeletingUser(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resettingUser} onOpenChange={(open) => { if (!open) { setResettingUser(null); setNewPassword(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Reset Password
            </DialogTitle>
            <DialogDescription>
              Set a new password for <strong>{resettingUser?.name}</strong> ({resettingUser?.email}).
              This takes effect immediately — no email is sent.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Input
              type="text"
              placeholder="New password (min 8 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => { setResettingUser(null); setNewPassword(''); }}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={isResetting || newPassword.length < 8}>
              {isResetting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Set Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Employee Activity Dialog */}
      <Dialog open={!!viewingUser} onOpenChange={(open) => !open && setViewingUser(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Employee Activity: {viewingUser?.name}
            </DialogTitle>
            <DialogDescription>
              {viewingUser?.email} • {viewingUser?.department} • {viewingUser?.role}
            </DialogDescription>
          </DialogHeader>

          {isLoadingActivity ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <Tabs defaultValue="daylogin" className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="daylogin" className="text-xs">Day Login</TabsTrigger>
                <TabsTrigger value="dayplan" className="text-xs">Day Plans</TabsTrigger>
                <TabsTrigger value="hourly" className="text-xs">Hourly Reports</TabsTrigger>
                <TabsTrigger value="eod" className="text-xs">EOD</TabsTrigger>
                <TabsTrigger value="issues" className="text-xs">Issues</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto mt-4">
                <TabsContent value="daylogin" className="mt-0 space-y-2">
                  {employeeActivity?.dayStarts.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No day login records</p>
                  ) : (
                    employeeActivity?.dayStarts.map((record: any) => (
                      <div key={record.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">{format(new Date(record.date), 'PPP')}</span>
                          </div>
                          <Badge variant="outline">{record.location_zone}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">{record.day_plan}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Submitted: {record.submitted_at ? format(new Date(record.submitted_at), 'p') : 'N/A'}
                        </p>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="dayplan" className="mt-0 space-y-2">
                  {employeeActivity?.dayPlans.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No day plans</p>
                  ) : (
                    employeeActivity?.dayPlans.map((record: any) => (
                      <div key={record.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">{format(new Date(record.date), 'PPP')}</span>
                          </div>
                          <Badge variant={record.is_project_work ? 'default' : 'secondary'}>
                            {record.is_project_work ? 'Project' : 'Non-Project'}
                          </Badge>
                        </div>
                        <div className="mt-2 space-y-1">
                          <p className="text-sm"><strong>Tasks:</strong> {record.tasks?.join(', ') || 'None'}</p>
                          <p className="text-sm"><strong>Expected Output:</strong> {record.expected_output}</p>
                          {record.dependency && <p className="text-sm"><strong>Dependencies:</strong> {record.dependency}</p>}
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="hourly" className="mt-0 space-y-2">
                  {employeeActivity?.hourlyReports.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No hourly reports</p>
                  ) : (
                    employeeActivity?.hourlyReports.map((record: any) => (
                      <div key={record.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">{format(new Date(record.date), 'PPP')} - {record.time_slot}</span>
                          </div>
                          <div className="flex gap-2">
                            {record.is_late && (
                              <Badge variant="destructive" className="text-xs">
                                Late ({record.delay_minutes}min)
                              </Badge>
                            )}
                            <Badge variant="outline">{record.status}</Badge>
                          </div>
                        </div>
                        <p className="text-sm mt-2">{record.report_text}</p>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="eod" className="mt-0 space-y-2">
                  {employeeActivity?.eodReports.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No EOD reports</p>
                  ) : (
                    employeeActivity?.eodReports.map((record: any) => (
                      <div key={record.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">{format(new Date(record.date), 'PPP')}</span>
                          </div>
                          <Badge variant="outline">{record.completion_percentage}% Complete</Badge>
                        </div>
                        <div className="mt-2 space-y-1">
                          <p className="text-sm"><strong>Planned:</strong> {record.planned_work}</p>
                          <p className="text-sm"><strong>Completed:</strong> {record.completed_work}</p>
                          {record.pending_items && <p className="text-sm"><strong>Pending:</strong> {record.pending_items}</p>}
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="issues" className="mt-0 space-y-2">
                  {employeeActivity?.issues.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No issues reported</p>
                  ) : (
                    employeeActivity?.issues.map((record: any) => (
                      <div key={record.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">{record.issue_title}</span>
                          </div>
                          <Badge variant={record.status === 'Open' ? 'destructive' : 'secondary'}>
                            {record.status}
                          </Badge>
                        </div>
                        <p className="text-sm mt-2">{record.issue_description}</p>
                        {record.hr_remark && <p className="text-sm mt-1 text-muted-foreground"><strong>HR:</strong> {record.hr_remark}</p>}
                        {record.admin_remark && <p className="text-sm mt-1 text-muted-foreground"><strong>Admin:</strong> {record.admin_remark}</p>}
                      </div>
                    ))
                  )}
                </TabsContent>
              </div>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Master Reset functionality removed for security */}
    </motion.div >
  );
}
