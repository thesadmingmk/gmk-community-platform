import React, { useState } from 'react';
import { CommunityEvent, EventRegistration, EventCommittee, Family, FamilyMember, EventCommitteeExpense } from '../types';
import RegistrationReportingWorkspace from './RegistrationReportingWorkspace';
import { 
  TrendingUp, 
  FileText, 
  Settings, 
  ArrowDownCircle, 
  PieChart, 
  CreditCard, 
  Receipt, 
  Search, 
  AlertCircle, 
  Plus, 
  DollarSign, 
  Calendar, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Trash2, 
  Edit3, 
  Download,
  Info,
  ShieldCheck
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db, functions } from '../context/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

interface FinanceWorkspaceProps {
  activeEvent: CommunityEvent | null;
  events: CommunityEvent[];
  registrations: EventRegistration[];
  eventFinance: any;
  handleUpdateFinance: (updates: any) => Promise<void>;
  profile: any;
  activeCommittees: EventCommittee[];
  setSuccessMsg: (msg: string | null) => void;
  setPaymentModalReg?: (reg: EventRegistration | null) => void;
  setErrorMsg: (msg: string | null) => void;
  families?: Family[];
  familyMembers?: FamilyMember[];
  onDeleteRegistration?: (reg: EventRegistration) => void;
  isSubmitting?: boolean;
}

export function getRegistrationCollectedAmount(r: EventRegistration): number {
  const status = r.paymentStatus || 'pending';
  // Do NOT count: Cancelled, Refunded, Waived amounts as current income
  if (status === 'cancelled' || status === 'refunded' || status === 'waived') {
    return 0;
  }
  if (status === 'paid' || status === 'approved') {
    const due = r.amountDue ?? r.paymentAmount ?? r.paymentSummary?.totalAmount ?? 0;
    return r.amountReceived !== undefined ? r.amountReceived : due;
  }
  if (status === 'partially_paid' || status === 'overpaid' || status === 'refund_due') {
    return r.amountReceived || 0;
  }
  // Pending
  return r.amountReceived || 0;
}

export default function FinanceWorkspace({
  activeEvent,
  events,
  registrations,
  eventFinance,
  handleUpdateFinance,
  profile,
  activeCommittees,
  setSuccessMsg,
  setErrorMsg,
  setPaymentModalReg,
  families = [],
  familyMembers = [],
  onDeleteRegistration,
  isSubmitting = false
}: FinanceWorkspaceProps) {
  const [financeTab, setFinanceTab] = useState<'summary' | 'events' | 'income' | 'budgets' | 'expenses' | 'refunds' | 'reports'>('summary');
  const [finSearchQuery, setFinSearchQuery] = useState('');
  const [isFinanceSubmitting, setIsFinanceSubmitting] = useState(false);

  // Modals state
  const [showOpeningBalModal, setShowOpeningBalModal] = useState(false);
  const [openingBalInput, setOpeningBalInput] = useState<string>('');
  
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetCommittee, setBudgetCommittee] = useState<string>('');
  const [budgetAmountInput, setBudgetAmountInput] = useState<string>('');
  const [budgetDescInput, setBudgetDescInput] = useState<string>('');

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseCommittee, setExpenseCommittee] = useState<string>('');
  const [expenseAmountInput, setExpenseAmountInput] = useState<string>('');
  const [expenseDescInput, setExpenseDescInput] = useState<string>('');
  const [expenseDateInput, setExpenseDateInput] = useState<string>(new Date().toISOString().split('T')[0]);
  const [expensePayeeInput, setExpensePayeeInput] = useState<string>('');
  const [selectedCommitteeFilter, setSelectedCommitteeFilter] = useState<string>('all');
  const [isSponsorshipModalOpen, setIsSponsorshipModalOpen] = useState(false);
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false);

  const userEmailLower = profile?.email?.toLowerCase().trim() || '';
  const userGmkIdUpper = profile?.gmkId?.toUpperCase().trim() || '';
  const userRoles = profile?.roles || [];
  const isED = userRoles.some((r: string) => ['event_director', 'admin', 'super_admin', 'president', 'vp', 'vice_president'].includes(r));
  
  const financeComm = activeCommittees.find(c => c.name.toLowerCase().includes('finance'));
  const financeLeads = (financeComm?.members || []).filter(m => m.role === 'Lead');
  const isFinanceLead = financeLeads.some(m => 
    (m.email && m.email.toLowerCase().trim() === userEmailLower) ||
    (m.residentId && m.residentId.toUpperCase().trim() === userGmkIdUpper)
  );

  const isFinanceAuth = isED || isFinanceLead;

  // Derived financial logic
  let totalRegistrationDue = 0;
  let totalRegistrationRec = 0;
  let payingRegistrationsCount = 0;
  
  registrations.forEach(r => {
    const due = r.amountDue ?? r.paymentAmount ?? r.paymentSummary?.totalAmount ?? 0;
    const rec = getRegistrationCollectedAmount(r);
    totalRegistrationDue += due;
    totalRegistrationRec += rec;
    if (rec > 0) payingRegistrationsCount++;
  });

  const sponsorshipIncomeList = (eventFinance?.sponsorshipIncome || []) as Array<{
    id?: string;
    sponsorName: string;
    tier?: string;
    amount: number;
    assuredAmount?: number;
    paymentMode?: string;
    date?: string;
    notes?: string;
  }>;
  const sponsorshipIncome = sponsorshipIncomeList.reduce((acc: number, curr: any) => acc + (Number(curr.amount) || 0), 0);
  const sponsorshipAssuredAmount = sponsorshipIncomeList.reduce((acc: number, curr: any) => acc + (Number(curr.assuredAmount) || Number(curr.amount) || 0), 0);
  
  const openingBalance = eventFinance?.openingBalance !== undefined ? Number(eventFinance.openingBalance) : 0;
  
  // Total Income = Registration Income + Sponsorship Income
  const totalIncome = totalRegistrationRec + sponsorshipIncome;

  // Committee Budgets
  const rawAllocations = eventFinance?.budgetAllocations || {};
  const allocations: Record<string, number> = {};
  Object.keys(rawAllocations).forEach(k => {
    const val = rawAllocations[k];
    allocations[k] = typeof val === 'object' ? Number(val?.amount || 0) : Number(val || 0);
  });
  const totalBudget = Object.values(allocations).reduce((acc: number, curr: number) => acc + curr, 0);

  // Centralized Expenses - aggregate from all active committees
  const centralizedExpenses: Array<EventCommitteeExpense & { committeeId: string; committeeName: string }> = activeCommittees.flatMap(c => 
    (c.expenses || []).map(exp => ({ ...exp, committeeId: c.id, committeeName: c.name }))
  ).sort((a, b) => new Date(b.date || (b as any).createdAt || 0).getTime() - new Date(a.date || (a as any).createdAt || 0).getTime());

  const totalExpenses = centralizedExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  
  // Available Balance = Opening Balance + Registration Income + Sponsorship Income - Total Expenses
  const availableBalance = openingBalance + totalIncome - totalExpenses;

  // Filtered expenses
  const filteredExpenses = centralizedExpenses.filter(exp => {
    const matchesComm = selectedCommitteeFilter === 'all' || exp.committeeName.toLowerCase() === selectedCommitteeFilter.toLowerCase();
    const matchesSearch = !finSearchQuery.trim() || 
      exp.description.toLowerCase().includes(finSearchQuery.toLowerCase()) ||
      exp.committeeName.toLowerCase().includes(finSearchQuery.toLowerCase()) ||
      ((exp as any).payee && (exp as any).payee.toLowerCase().includes(finSearchQuery.toLowerCase())) ||
      (exp.createdBy && exp.createdBy.toLowerCase().includes(finSearchQuery.toLowerCase()));
    return matchesComm && matchesSearch;
  });

  // Filtered income registrations
  const payingRegistrations = registrations.filter(r => {
    const collected = getRegistrationCollectedAmount(r);
    return collected > 0 || r.paymentStatus === 'paid' || r.paymentStatus === 'approved' || r.paymentStatus === 'partially_paid';
  });

  const filteredIncomeRegs = payingRegistrations.filter(r => {
    if (!finSearchQuery.trim()) return true;
    const q = finSearchQuery.toLowerCase();
    return (
      (r.primaryMemberGmkId && r.primaryMemberGmkId.toLowerCase().includes(q)) ||
      (r.primaryMemberEmail && r.primaryMemberEmail.toLowerCase().includes(q)) ||
      (r.participants && r.participants.some(p => p.toLowerCase().includes(q))) ||
      (r.id && r.id.toLowerCase().includes(q))
    );
  });

  // Handlers
  const handleSaveOpeningBalance = async () => {
    const val = parseFloat(openingBalInput);
    if (isNaN(val) || val < 0) {
      setErrorMsg("Please enter a valid positive opening balance amount (OMR).");
      return;
    }
    const rounded = Math.round(val * 1000) / 1000;
    try {
      setIsFinanceSubmitting(true);
      await handleUpdateFinance({ openingBalance: rounded });
      setSuccessMsg(`✓ Opening Balance set to OMR ${rounded.toFixed(3)} successfully.`);
      setShowOpeningBalModal(false);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to update opening balance: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleSaveBudget = async () => {
    if (!budgetCommittee.trim()) {
      setErrorMsg("Please select or specify a committee.");
      return;
    }
    const amt = parseFloat(budgetAmountInput);
    if (isNaN(amt) || amt < 0) {
      setErrorMsg("Please enter a valid budget amount (OMR).");
      return;
    }
    const rounded = Math.round(amt * 1000) / 1000;
    try {
      setIsFinanceSubmitting(true);
      const updatedAllocations = {
        ...rawAllocations,
        [budgetCommittee.trim()]: rounded
      };
      await handleUpdateFinance({ budgetAllocations: updatedAllocations });
      setSuccessMsg(`✓ Budget allocation of OMR ${rounded.toFixed(3)} saved for ${budgetCommittee.trim()}.`);
      setShowBudgetModal(false);
      setBudgetCommittee('');
      setBudgetAmountInput('');
      setBudgetDescInput('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to save budget allocation: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleRemoveBudget = async (committeeName: string) => {
    if (!window.confirm(`Are you sure you want to remove the budget allocation for ${committeeName}?`)) {
      return;
    }
    try {
      setIsFinanceSubmitting(true);
      const updatedAllocations = { ...rawAllocations };
      delete updatedAllocations[committeeName];
      await handleUpdateFinance({ budgetAllocations: updatedAllocations });
      setSuccessMsg(`✓ Budget allocation removed for ${committeeName}.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to remove budget allocation: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleAddExpenseFromFinance = async () => {
    if (!expenseCommittee.trim()) {
      setErrorMsg("Please select an operational committee.");
      return;
    }
    if (!expenseDescInput.trim() || !expenseAmountInput.trim()) {
      setErrorMsg("Please enter both expense description and amount.");
      return;
    }
    const amt = parseFloat(expenseAmountInput);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg("Please enter a valid positive expense amount (OMR).");
      return;
    }
    const committee = activeCommittees.find(c => c.id === expenseCommittee || c.name.toLowerCase() === expenseCommittee.toLowerCase());
    if (!committee) {
      setErrorMsg("Selected committee not found in active gathering committees.");
      return;
    }

    try {
      setIsFinanceSubmitting(true);
      const rounded = Math.round(amt * 1000) / 1000;
      const currentExpenses = committee.expenses || [];
      const newExpense: EventCommitteeExpense = {
        id: `exp_${committee.name.toLowerCase()}_${Date.now()}`,
        date: expenseDateInput || new Date().toISOString().split('T')[0],
        description: expenseDescInput.trim(),
        amount: rounded,
        createdAt: new Date().toISOString(),
        createdBy: profile?.email || 'finance_lead'
      };

      await updateDoc(doc(db, "eventCommittees", committee.id), {
        expenses: [...currentExpenses, newExpense],
        updatedAt: new Date().toISOString()
      });

      setSuccessMsg(`✓ Recorded expense of OMR ${rounded.toFixed(3)} under ${committee.name} committee.`);
      setShowExpenseModal(false);
      setExpenseAmountInput('');
      setExpenseDescInput('');
      setExpensePayeeInput('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to record expense: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleDeleteExpense = async (committeeId: string, expenseId: string, committeeName: string) => {
    if (!window.confirm("Are you sure you want to delete this expense record?")) {
      return;
    }
    const committee = activeCommittees.find(c => c.id === committeeId);
    if (!committee) {
      setErrorMsg("Committee not found.");
      return;
    }
    try {
      setIsFinanceSubmitting(true);
      const updatedExpenses = (committee.expenses || []).filter(e => e.id !== expenseId);
      await updateDoc(doc(db, "eventCommittees", committee.id), {
        expenses: updatedExpenses,
        updatedAt: new Date().toISOString()
      });
      setSuccessMsg(`✓ Expense removed successfully from ${committeeName}.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to delete expense: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleProcessRefund = async (reg: EventRegistration) => {
    try {
      setIsFinanceSubmitting(true);
      const amtRec = reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? 0) : 0);
      const amtDue = reg.amountDue ?? 0;
      const refundAmt = reg.refundDue || Math.max(0, amtRec - amtDue);

      if (refundAmt <= 0) {
        setErrorMsg("No refund is due for this registration.");
        return;
      }

      const processPaymentFn = httpsCallable(functions, 'processEventPayment');
      const response = await processPaymentFn({
        registrationId: reg.id,
        amountReceived: amtDue, // Set received equal to due, processing the refund amount out.
        financeRemarks: 'Refund processed manually by Finance.'
      });
      const data = response.data as any;
      if (data && data.success) {
        setSuccessMsg(`Refund of OMR ${refundAmt.toFixed(3)} processed for ${reg.primaryMemberGmkId}`);
      } else {
        setErrorMsg(data?.error || "Refund processing failed.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to process refund: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  // PDF Generators
  const generateFinancialSummaryPDF = () => {
    const doc = new jsPDF();
    const title = activeEvent?.title || 'Community Gathering';
    
    // Header
    doc.setFontSize(18);
    doc.setTextColor(15, 76, 42); // #0f4c2a
    doc.text('FINANCIAL STATEMENT & STATEMENT OF ACCOUNTS', 14, 20);
    
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text(`Event: ${title}`, 14, 28);
    doc.text(`Generated Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 14, 34);

    // Summary Table
    autoTable(doc, {
      startY: 42,
      head: [['Financial Account', 'Type', 'Amount (OMR)']],
      body: [
        ['Opening Balance (Carried Forward)', 'Asset', `OMR ${openingBalance.toFixed(3)}`],
        ['Registration Income (Collected)', 'Revenue', `OMR ${totalRegistrationRec.toFixed(3)}`],
        ['Sponsorship Income', 'Revenue', `OMR ${sponsorshipIncome.toFixed(3)}`],
        ['TOTAL INCOME', 'Revenue', `OMR ${totalIncome.toFixed(3)}`],
        ['Total Operational Expenses', 'Expense', `OMR ${totalExpenses.toFixed(3)}`],
        ['AVAILABLE CLOSING BALANCE', 'Net Position', `OMR ${availableBalance.toFixed(3)}`]
      ],
      theme: 'grid',
      headStyles: { fillColor: [15, 76, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 4 }
    });

    // Committee Expense Breakdown
    const commRows = activeCommittees.map(c => {
      const cExpenses = (c.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const cBudget = allocations[c.name] || 0;
      const cRemaining = Math.max(0, cBudget - cExpenses);
      const cUtil = cBudget > 0 ? ((cExpenses / cBudget) * 100).toFixed(1) + '%' : 'N/A';
      return [c.name, `OMR ${cBudget.toFixed(3)}`, `OMR ${cExpenses.toFixed(3)}`, `OMR ${cRemaining.toFixed(3)}`, cUtil];
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 12,
      head: [['Committee', 'Budget Allocated', 'Actual Expenses', 'Remaining', 'Utilization']],
      body: commRows.length > 0 ? commRows : [['No operational committees configured', '-', '-', '-', '-']],
      theme: 'striped',
      headStyles: { fillColor: [50, 50, 50], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3 }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Financial_Summary_${title.replace(/\s+/g, '_')}_${dateStr}.pdf`);
    setSuccessMsg("✓ Financial Summary PDF generated successfully.");
  };

  const generateCommitteeBudgetPDF = () => {
    const doc = new jsPDF();
    const title = activeEvent?.title || 'Community Gathering';
    
    doc.setFontSize(16);
    doc.setTextColor(15, 76, 42);
    doc.text('COMMITTEE BUDGET ALLOCATION & UTILIZATION REPORT', 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Event: ${title}`, 14, 28);
    doc.text(`Total Allocated: OMR ${totalBudget.toFixed(3)} | Total Spent: OMR ${totalExpenses.toFixed(3)}`, 14, 34);

    const rows = activeCommittees.map(c => {
      const budget = allocations[c.name] || 0;
      const spent = (c.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const rem = budget - spent;
      const util = budget > 0 ? ((spent / budget) * 100).toFixed(1) + '%' : '0.0%';
      let status = 'On Track';
      if (budget > 0) {
        if (spent > budget) status = 'OVER BUDGET';
        else if (spent === budget) status = 'BUDGET FULL';
        else if (spent / budget >= 0.8) status = 'HIGH UTILIZATION';
      } else if (spent > 0) {
        status = 'NO BUDGET SET';
      }
      return [c.name, `OMR ${budget.toFixed(3)}`, `OMR ${spent.toFixed(3)}`, `OMR ${rem.toFixed(3)}`, util, status];
    });

    autoTable(doc, {
      startY: 42,
      head: [['Committee', 'Allocated Budget', 'Actual Expenses', 'Remaining', 'Utilization %', 'Status']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [15, 76, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 4 }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Committee_Budgets_${title.replace(/\s+/g, '_')}_${dateStr}.pdf`);
    setSuccessMsg("✓ Committee Budgets PDF generated successfully.");
  };

  const pendingRefunds = registrations.filter(r => r.paymentStatus === 'refund_due' || r.paymentStatus === 'overpaid' || (r.refundDue || 0) > 0);
  const processedRefunds = registrations.filter(r => r.paymentStatus === 'refunded' || r.paymentStatus === 'cancelled');

  if (!isFinanceAuth) {
    return (
      <div className="p-8 text-center text-stone-500 font-bold bg-white rounded-2xl border border-stone-200 shadow-sm animate-fadeIn">
        <AlertCircle className="w-8 h-8 mx-auto mb-3 text-rose-500" />
        <p>Access Denied.</p>
        <p className="text-xs mt-1">You must be assigned as a Finance Lead or Event Director to access this workspace.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm flex flex-col animate-fadeIn overflow-hidden h-full">
      {/* Workspace Header */}
      <div className="bg-[#0f4c2a] text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-[#d4af37]/20 rounded-xl flex items-center justify-center">
            <PieChart className="w-5 h-5 text-[#d4af37]" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black uppercase tracking-widest font-heading">Finance Workspace</h2>
            <p className="text-[10px] sm:text-xs text-emerald-200 font-bold">{activeEvent?.title || 'No active event'}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-800/60 text-emerald-100 border border-emerald-700/50">
            <ShieldCheck className="w-3 h-3 mr-1 text-[#d4af37]" />
            Authorized Finance Console
          </span>
        </div>
      </div>
      
      {/* Finance Navigation Tabs (Desktop & Mobile Touch-Friendly Scrollable) */}
      <div className="bg-stone-50 border-b border-stone-200 overflow-x-auto hide-scrollbar shrink-0">
        <div className="flex space-x-1 p-2 min-w-max">
          {[
            { id: 'summary', label: 'Dashboard', icon: TrendingUp },
            { id: 'events', label: 'Events', icon: Calendar },
            { id: 'income', label: 'Income', icon: ArrowDownCircle },
            { id: 'budgets', label: 'Budgets', icon: PieChart },
            { id: 'expenses', label: 'Expenses', icon: CreditCard },
            { id: 'refunds', label: 'Refunds', icon: AlertCircle },
            { id: 'reports', label: 'Reports', icon: FileText }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = financeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setFinanceTab(tab.id as any);
                  setFinSearchQuery('');
                }}
                className={`px-3.5 sm:px-4 py-2 text-[10px] sm:text-xs font-black uppercase tracking-wider rounded-xl flex items-center space-x-1.5 transition-all cursor-pointer ${
                  isSel 
                    ? 'bg-[#0f4c2a] text-white shadow-sm' 
                    : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isSel ? 'text-[#d4af37]' : 'text-stone-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#fafaf9]">
        
        {/* ========================================================================= */}
        {/* 1. DASHBOARD TAB */}
        {/* ========================================================================= */}
        {financeTab === 'summary' && (
          <div className="space-y-6">
            {/* Top 4 Real-time Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* Card 1: Opening Balance */}
              <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs relative flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-black text-stone-500 tracking-widest block">Opening Balance</span>
                    <button
                      onClick={() => {
                        setOpeningBalInput(openingBalance.toString());
                        setShowOpeningBalModal(true);
                      }}
                      className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg transition-colors cursor-pointer flex items-center space-x-1 text-[9px] font-black uppercase tracking-wider"
                      title="Configure Opening Balance"
                    >
                      <Settings className="w-3 h-3 text-[#0f4c2a]" />
                      <span>Set</span>
                    </button>
                  </div>
                  <span className="text-2xl font-black font-mono text-stone-900 block">OMR {openingBalance.toFixed(3)}</span>
                </div>
                <p className="text-[10px] text-stone-400 font-bold mt-2">Carried forward from previous year</p>
              </div>

              {/* Card 2: Registration Income */}
              <div className="p-5 bg-emerald-50/70 border border-emerald-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-black text-emerald-800 tracking-widest block">Registration Income</span>
                    <span className="text-[9px] font-black uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">{payingRegistrationsCount} Paid</span>
                  </div>
                  <span className="text-2xl font-black font-mono text-[#0f4c2a] block">OMR {totalRegistrationRec.toFixed(3)}</span>
                </div>
                <p className="text-[10px] text-emerald-700/80 font-bold mt-2">Collected from confirmed payments</p>
              </div>

              {/* Card 3: Sponsorship Income */}
              <div className="p-5 bg-blue-50/70 border border-blue-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-black text-blue-800 tracking-widest block">Sponsorships</span>
                    <span className="text-[9px] font-black uppercase bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{sponsorshipIncomeList.length} Sponsors</span>
                  </div>
                  <span className="text-2xl font-black font-mono text-blue-700 block">OMR {sponsorshipIncome.toFixed(3)}</span>
                </div>
                <p className="text-[10px] text-blue-700/80 font-bold mt-2">Supplied by Sponsorship Committee</p>
              </div>

              {/* Card 4: Total Expenses */}
              <div className="p-5 bg-rose-50/70 border border-rose-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-black text-rose-800 tracking-widest block">Total Expenses</span>
                    <span className="text-[9px] font-black uppercase bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">{centralizedExpenses.length} Records</span>
                  </div>
                  <span className="text-2xl font-black font-mono text-rose-700 block">OMR {totalExpenses.toFixed(3)}</span>
                </div>
                <p className="text-[10px] text-rose-700/80 font-bold mt-2">Aggregated across all committees</p>
              </div>
            </div>
            
            {/* Total Income & Available Balance Banners */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="p-6 bg-amber-50/80 border border-amber-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div>
                  <span className="text-[10px] uppercase font-black text-amber-900 tracking-widest block mb-1">Total Income</span>
                  <p className="text-[10px] text-amber-800 font-bold mb-2">Registration Income + Sponsorship Income</p>
                  <span className="text-3xl font-black font-mono text-amber-900 block">OMR {totalIncome.toFixed(3)}</span>
                </div>
                <div className="mt-3 pt-3 border-t border-amber-200/60 text-[10px] text-amber-800 flex justify-between font-bold">
                  <span>Reg: OMR {totalRegistrationRec.toFixed(3)}</span>
                  <span>Sponsor: OMR {sponsorshipIncome.toFixed(3)}</span>
                </div>
              </div>

              <div className="lg:col-span-2 p-6 bg-indigo-50/80 border border-indigo-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-black text-indigo-900 tracking-widest block mb-1">Available Balance</span>
                    <p className="text-[10px] text-indigo-800/90 font-bold">Opening Balance + Total Income - Total Expenses</p>
                  </div>
                  <span className="text-3xl sm:text-4xl font-black font-mono text-indigo-800 block">OMR {availableBalance.toFixed(3)}</span>
                </div>
                <div className="mt-4 pt-3 border-t border-indigo-200/60 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-indigo-900 font-bold">
                  <div>Opening: <span className="font-mono font-black">OMR {openingBalance.toFixed(3)}</span></div>
                  <div>Income: <span className="font-mono font-black">OMR {totalIncome.toFixed(3)}</span></div>
                  <div>Expenses: <span className="font-mono font-black">OMR {totalExpenses.toFixed(3)}</span></div>
                  <div className="text-indigo-950 font-black">Net: <span className="font-mono">OMR {availableBalance.toFixed(3)}</span></div>
                </div>
              </div>
            </div>

            {/* Budget Utilization Summary Card */}
            <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <h6 className="font-black text-stone-900 text-xs sm:text-sm uppercase tracking-wider">Committee Budget Utilization Summary</h6>
                <button
                  onClick={() => setFinanceTab('budgets')}
                  className="text-[10px] font-black text-[#0f4c2a] uppercase tracking-wider hover:underline flex items-center space-x-1"
                >
                  <span>Manage Budgets</span>
                </button>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-center">
                  <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Allocated Budget</span>
                  <span className="font-mono font-black text-stone-800 text-xs sm:text-sm">OMR {totalBudget.toFixed(3)}</span>
                </div>
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-center">
                  <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Actual Expenses</span>
                  <span className="font-mono font-black text-rose-700 text-xs sm:text-sm">OMR {totalExpenses.toFixed(3)}</span>
                </div>
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-center">
                  <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Remaining</span>
                  <span className="font-mono font-black text-emerald-700 text-xs sm:text-sm">OMR {Math.max(0, totalBudget - totalExpenses).toFixed(3)}</span>
                </div>
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-center">
                  <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Overall Utilization</span>
                  <span className={`font-mono font-black text-xs sm:text-sm ${
                    totalBudget > 0 && totalExpenses > totalBudget ? 'text-rose-600' : 'text-stone-800'
                  }`}>
                    {totalBudget > 0 ? ((totalExpenses / totalBudget) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-stone-100 rounded-full h-2.5 overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${
                    totalBudget === 0 ? 'bg-stone-300 w-0' :
                    (totalExpenses / totalBudget) > 1 ? 'bg-rose-500 w-full' :
                    (totalExpenses / totalBudget) >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: totalBudget > 0 ? `${Math.min(100, (totalExpenses / totalBudget) * 100)}%` : '0%' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. EVENTS TAB */}
        {/* ========================================================================= */}
        {financeTab === 'events' && (
          <div className="space-y-4">
            <h3 className="font-black text-[#0f4c2a] uppercase tracking-wider mb-2">Registration & Events Reporting</h3>
            <RegistrationReportingWorkspace 
              events={events}
              registrations={registrations}
              families={families}
              familyMembers={familyMembers}
              activeEvent={activeEvent}
              setPaymentModalReg={setPaymentModalReg}
              isSubmitting={isSubmitting}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. INCOME TAB */}
        {/* ========================================================================= */}
        {financeTab === 'income' && (
          <div className="space-y-6">
            {/* Top Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 bg-emerald-50/80 border border-emerald-200 rounded-2xl shadow-xs">
                <span className="text-[10px] uppercase font-black text-emerald-800 tracking-widest block mb-1">Registration Income</span>
                <span className="text-2xl font-black font-mono text-[#0f4c2a] block mb-1">OMR {totalRegistrationRec.toFixed(3)}</span>
                <p className="text-[10px] text-emerald-700/80 font-bold">{payingRegistrationsCount} confirmed paying records</p>
              </div>

              <div className="p-5 bg-blue-50/80 border border-blue-200 rounded-2xl shadow-xs">
                <span className="text-[10px] uppercase font-black text-blue-800 tracking-widest block mb-1">Sponsorship Income</span>
                <span className="text-2xl font-black font-mono text-blue-700 block mb-1">OMR {sponsorshipIncome.toFixed(3)}</span>
                <p className="text-[10px] text-blue-700/80 font-bold">{sponsorshipIncomeList.length} recorded contributions</p>
              </div>

              <div className="p-5 bg-amber-50/80 border border-amber-200 rounded-2xl shadow-xs">
                <span className="text-[10px] uppercase font-black text-amber-900 tracking-widest block mb-1">Total Income</span>
                <span className="text-2xl font-black font-mono text-amber-900 block mb-1">OMR {totalIncome.toFixed(3)}</span>
                <p className="text-[10px] text-amber-800 font-bold">Registration + Sponsorship</p>
              </div>
            </div>
            
            {/* Section A: Registration Income Summary */}
            <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-stone-150 pb-3">
                <div>
                  <h4 className="font-black text-[#0f4c2a] uppercase tracking-wider text-sm">Registration Income</h4>
                  <p className="text-stone-500 text-[10px] font-bold">Summary of collected registration payments.</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <span className="text-[10px] uppercase font-black text-emerald-800 tracking-widest block mb-1">Total Collected Registration Income</span>
                    <span className="text-lg font-black font-mono text-emerald-700">OMR {totalRegistrationRec.toFixed(3)}</span>
                  </div>
                  <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl">
                    <span className="text-[10px] uppercase font-black text-stone-500 tracking-widest block mb-1">Number of Confirmed/Paying Records</span>
                    <span className="text-lg font-black font-mono text-stone-800">{payingRegistrationsCount}</span>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsRegistrationModalOpen(true)}
                    className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                  >
                    VIEW REGISTRATION DETAILS
                  </button>
                </div>
              </div>
            </div>

            {/* Section B: Sponsorship Income (Read-Only) */}
            <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-stone-150 pb-3">
                <div>
                  <h4 className="font-black text-blue-900 uppercase tracking-wider text-sm">Sponsorship Income</h4>
                  <p className="text-stone-500 text-[10px] font-bold">Contributions recorded by the Sponsorship Committee (Read-only).</p>
                </div>
              </div>

              {sponsorshipIncomeList.length === 0 ? (
                <div className="text-center py-10 bg-stone-50 rounded-xl border border-dashed border-stone-200">
                  <DollarSign className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                  <p className="text-stone-600 font-black text-xs uppercase tracking-wider">No Sponsorship Income Recorded</p>
                  <p className="text-[10px] text-stone-400 font-bold mt-1">
                    Sponsorship contributions will be displayed here once confirmed by the Sponsorship Committee.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl">
                      <span className="text-[10px] uppercase font-black text-stone-500 tracking-widest block mb-1">Total Assured</span>
                      <span className="text-lg font-black font-mono text-stone-800">OMR {sponsorshipAssuredAmount.toFixed(3)}</span>
                    </div>
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <span className="text-[10px] uppercase font-black text-blue-800 tracking-widest block mb-1">Total Received</span>
                      <span className="text-lg font-black font-mono text-blue-700">OMR {sponsorshipIncome.toFixed(3)}</span>
                    </div>
                    <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl">
                      <span className="text-[10px] uppercase font-black text-stone-500 tracking-widest block mb-1">Number of Contributions</span>
                      <span className="text-lg font-black font-mono text-stone-800">{sponsorshipIncomeList.length}</span>
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setIsSponsorshipModalOpen(true)}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-black text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                    >
                      VIEW SPONSORSHIP DETAILS
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. BUDGETS TAB */}
        {/* ========================================================================= */}
        {financeTab === 'budgets' && (
          <div className="space-y-6">
            {/* Header & Allocation Trigger */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
              <div>
                <h3 className="font-black text-stone-900 uppercase tracking-wider text-sm">Committee Budget Management</h3>
                <p className="text-xs text-stone-500 font-bold mt-0.5">Allocate and monitor operational budgets for gathering committees.</p>
              </div>

              <button
                onClick={() => {
                  setBudgetCommittee(activeCommittees[0]?.name || '');
                  setBudgetAmountInput('');
                  setBudgetDescInput('');
                  setShowBudgetModal(true);
                }}
                className="px-4 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4 text-[#d4af37]" />
                <span>Allocate Budget</span>
              </button>
            </div>

            {/* Top 4 Budget Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-xs text-center">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Total Allocated</span>
                <span className="font-mono font-black text-stone-900 text-sm sm:text-base">OMR {totalBudget.toFixed(3)}</span>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-xs text-center">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Actual Expenses</span>
                <span className="font-mono font-black text-rose-700 text-sm sm:text-base">OMR {totalExpenses.toFixed(3)}</span>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-xs text-center">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Remaining Budget</span>
                <span className="font-mono font-black text-emerald-700 text-sm sm:text-base">OMR {Math.max(0, totalBudget - totalExpenses).toFixed(3)}</span>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-xs text-center">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Overall Utilization</span>
                <span className={`font-mono font-black text-sm sm:text-base ${
                  totalBudget > 0 && totalExpenses > totalBudget ? 'text-rose-600' : 'text-stone-800'
                }`}>
                  {totalBudget > 0 ? ((totalExpenses / totalBudget) * 100).toFixed(1) : '0.0'}%
                </span>
              </div>
            </div>

            {/* Committee Budgets List / Table */}
            {Object.keys(allocations).length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-stone-300 p-6 space-y-3">
                <PieChart className="w-10 h-10 text-stone-300 mx-auto" />
                <h4 className="font-black text-stone-800 text-sm uppercase tracking-wider">No Committee Budgets Created</h4>
                <p className="text-stone-500 text-xs font-bold max-w-md mx-auto">
                  Assign financial budgets to operational committees (e.g. Food, Program, Sourcing, Logistics) to track real-time utilization.
                </p>
                <button
                  onClick={() => {
                    setBudgetCommittee(activeCommittees[0]?.name || '');
                    setBudgetAmountInput('');
                    setBudgetDescInput('');
                    setShowBudgetModal(true);
                  }}
                  className="mt-2 px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all inline-flex items-center space-x-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4 text-[#d4af37]" />
                  <span>Allocate Budget</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(allocations).map(([commName, budgetAmount]) => {
                    const matchedComm = activeCommittees.find(c => c.name.toLowerCase() === commName.toLowerCase());
                    const commExpenses = (matchedComm?.expenses || []).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                    const remaining = budgetAmount - commExpenses;
                    const utilPercent = budgetAmount > 0 ? (commExpenses / budgetAmount) * 100 : 0;

                    // Warning Status Logic:
                    // < 80%: Normal
                    // >= 80% and < 100%: WARNING — BUDGET UTILIZATION HIGH
                    // == 100%: BUDGET FULL
                    // > 100%: OVER BUDGET
                    let statusLabel = 'ON TRACK';
                    let statusBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                    let progressBarClass = 'bg-emerald-500';

                    if (utilPercent > 100) {
                      statusLabel = 'OVER BUDGET';
                      statusBadgeClass = 'bg-rose-100 text-rose-800 border-rose-200 animate-pulse';
                      progressBarClass = 'bg-rose-500';
                    } else if (utilPercent === 100) {
                      statusLabel = 'BUDGET FULL';
                      statusBadgeClass = 'bg-orange-100 text-orange-800 border-orange-200';
                      progressBarClass = 'bg-orange-500';
                    } else if (utilPercent >= 80) {
                      statusLabel = 'WARNING — BUDGET UTILIZATION HIGH';
                      statusBadgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
                      progressBarClass = 'bg-amber-500';
                    }

                    return (
                      <div key={commName} className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs space-y-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-wider text-stone-400 block">Committee</span>
                            <h5 className="font-black text-stone-900 text-base">{commName}</h5>
                          </div>
                          
                          <div className="flex items-center space-x-1.5">
                            <button
                              onClick={() => {
                                setBudgetCommittee(commName);
                                setBudgetAmountInput(budgetAmount.toString());
                                setShowBudgetModal(true);
                              }}
                              className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg text-xs"
                              title="Edit Budget"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleRemoveBudget(commName)}
                              className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs"
                              title="Remove Allocation"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Status Warning Badge */}
                        <div className="flex items-center justify-between">
                          <span className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider border ${statusBadgeClass}`}>
                            {statusLabel}
                          </span>
                          <span className="font-mono text-xs font-black text-stone-700">
                            {utilPercent.toFixed(1)}% Used
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-stone-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${progressBarClass}`}
                            style={{ width: `${Math.min(100, utilPercent)}%` }}
                          />
                        </div>

                        {/* Numbers Grid */}
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-stone-100 text-[10px]">
                          <div>
                            <span className="text-stone-400 block uppercase font-black">Budget</span>
                            <span className="font-mono font-black text-stone-900 text-xs">OMR {budgetAmount.toFixed(3)}</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block uppercase font-black">Actual</span>
                            <span className="font-mono font-black text-rose-700 text-xs">OMR {commExpenses.toFixed(3)}</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block uppercase font-black">Remaining</span>
                            <span className={`font-mono font-black text-xs ${remaining < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                              OMR {remaining.toFixed(3)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 5. EXPENSES TAB */}
        {/* ========================================================================= */}
        {financeTab === 'expenses' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
              <div>
                <h3 className="font-black text-stone-900 uppercase tracking-wider text-sm">Centralized Expense Ledger</h3>
                <p className="text-xs text-stone-500 font-bold mt-0.5">Consolidated real-time ledger of all committee expenditures.</p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setExpenseCommittee(activeCommittees[0]?.id || '');
                    setExpenseAmountInput('');
                    setExpenseDescInput('');
                    setExpensePayeeInput('');
                    setShowExpenseModal(true);
                  }}
                  className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4 text-[#d4af37]" />
                  <span>Record Expense</span>
                </button>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-stone-100/70 p-3 rounded-2xl border border-stone-200">
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Committee:</span>
                <select
                  value={selectedCommitteeFilter}
                  onChange={(e) => setSelectedCommitteeFilter(e.target.value)}
                  className="bg-white border border-stone-200 rounded-xl px-3 py-1.5 text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                >
                  <option value="all">All Operational Committees</option>
                  {activeCommittees.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={finSearchQuery}
                  onChange={(e) => setFinSearchQuery(e.target.value)}
                  placeholder="Filter expenses..."
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>
            </div>
            
            {filteredExpenses.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-stone-300">
                <CreditCard className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                <p className="text-stone-600 font-black text-xs uppercase tracking-wider">No Expenses Recorded</p>
                <p className="text-[10px] text-stone-400 font-bold mt-1">Expenses logged by any committee automatically flow directly here.</p>
              </div>
            ) : (
              <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto hide-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="bg-stone-50 text-[10px] font-black text-stone-500 uppercase tracking-widest border-b border-stone-200">
                        <th className="p-3">Date</th>
                        <th className="p-3">Committee</th>
                        <th className="p-3">Description</th>
                        <th className="p-3">Entered By</th>
                        <th className="p-3 text-right">Amount (OMR)</th>
                        <th className="p-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs font-bold text-stone-700">
                      {filteredExpenses.map((exp) => (
                        <tr key={exp.id} className="border-b border-stone-100 hover:bg-stone-50/50">
                          <td className="p-3 font-mono text-[10px] text-stone-500">
                            {new Date(exp.date || (exp as any).createdAt || 0).toLocaleDateString()}
                          </td>
                          <td className="p-3">
                            <span className="px-2 py-1 bg-stone-100 text-stone-800 rounded-lg text-[9px] uppercase font-black whitespace-nowrap">
                              {exp.committeeName}
                            </span>
                          </td>
                          <td className="p-3 font-semibold text-stone-900">{exp.description}</td>
                          <td className="p-3 font-mono text-[10px] text-stone-500 truncate max-w-[140px]">
                            {exp.createdBy || 'Authorized Lead'}
                          </td>
                          <td className="p-3 text-right font-mono font-black text-rose-700 whitespace-nowrap">
                            OMR {(Number(exp.amount) || 0).toFixed(3)}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => handleDeleteExpense(exp.committeeId, exp.id, exp.committeeName)}
                              className="p-1 text-stone-400 hover:text-rose-600 transition-colors"
                              title="Delete Expense"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-rose-50/40 font-black text-xs text-rose-900 border-t border-rose-200">
                        <td colSpan={4} className="p-3 text-right uppercase tracking-wider">Total Recorded Expenses:</td>
                        <td className="p-3 text-right font-mono text-sm">OMR {totalExpenses.toFixed(3)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 6. REFUNDS TAB */}
        {/* ========================================================================= */}
        {financeTab === 'refunds' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
              <h3 className="font-black text-stone-900 uppercase tracking-wider text-sm mb-1">Refunds Management</h3>
              <p className="text-xs text-stone-500 font-bold">Process and review pending refunds for cancelled or overpaid registrations.</p>
            </div>
            
            {/* Pending Refunds */}
            <div className="space-y-3">
              <h4 className="font-black text-amber-800 uppercase tracking-wider text-xs px-1">
                Pending Refunds ({pendingRefunds.length})
              </h4>
              {pendingRefunds.length === 0 ? (
                <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-stone-400 font-bold text-xs">
                  No pending refunds.
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingRefunds.map(reg => {
                    const amtRec = reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? 0) : 0);
                    const amtDue = reg.amountDue ?? 0;
                    const refundAmt = reg.refundDue || Math.max(0, amtRec - amtDue);
                    
                    return (
                      <div key={reg.id} className="p-4 bg-white border border-amber-200 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="font-mono text-[10px] font-black bg-stone-100 px-2 py-0.5 rounded-md">{reg.primaryMemberGmkId}</span>
                            <span className="font-black text-stone-800 text-sm">{reg.primaryMemberEmail}</span>
                          </div>
                          <div className="text-[10px] text-stone-500 font-bold flex space-x-4 mt-2">
                            <span>Paid: OMR {amtRec.toFixed(3)}</span>
                            <span>Due: OMR {amtDue.toFixed(3)}</span>
                            <span className="text-amber-700 font-black">Refund Due: OMR {refundAmt.toFixed(3)}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleProcessRefund(reg)}
                          disabled={isFinanceSubmitting}
                          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all w-full md:w-auto text-center disabled:opacity-50"
                        >
                          {isFinanceSubmitting ? 'Processing...' : 'Process Refund'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Processed Refunds */}
            <div className="space-y-3 mt-6">
              <h4 className="font-black text-emerald-800 uppercase tracking-wider text-xs px-1">
                Processed / Resolved Refunds ({processedRefunds.length})
              </h4>
              {processedRefunds.length === 0 ? (
                <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-stone-400 font-bold text-xs">
                  No processed refunds history.
                </div>
              ) : (
                <div className="space-y-2">
                  {processedRefunds.map(reg => (
                    <div key={reg.id} className="p-3.5 bg-white border border-stone-200 rounded-xl shadow-xs flex items-center justify-between opacity-80">
                      <div className="flex items-center space-x-3">
                        <span className="font-mono text-[10px] font-black bg-stone-100 px-2 py-0.5 rounded-md">{reg.primaryMemberGmkId}</span>
                        <span className="font-bold text-stone-800 text-xs">{reg.primaryMemberEmail}</span>
                      </div>
                      <span className="text-[10px] uppercase font-black px-2 py-0.5 bg-stone-100 text-stone-600 rounded">
                        {reg.paymentStatus}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 7. REPORTS TAB */}
        {/* ========================================================================= */}
        {financeTab === 'reports' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
              <h3 className="font-black text-stone-900 uppercase tracking-wider text-sm mb-1">Financial Statements & Exports</h3>
              <p className="text-xs text-stone-500 font-bold">Generate official balance sheets and committee utilization reports.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-6 bg-white border border-stone-200 rounded-2xl shadow-xs flex flex-col justify-between text-center space-y-4">
                <div>
                  <div className="w-12 h-12 bg-emerald-50 text-[#0f4c2a] rounded-2xl flex items-center justify-center mx-auto mb-3 border border-emerald-100">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h4 className="font-black text-stone-900 uppercase text-sm mb-1">Event Financial Statement</h4>
                  <p className="text-xs text-stone-500 font-bold">Comprehensive accounting of opening balance, registration income, sponsorships, and centralized expenditures.</p>
                </div>
                <button 
                  onClick={generateFinancialSummaryPDF}
                  className="px-4 py-2.5 bg-[#0f4c2a] text-white font-black uppercase text-xs tracking-wider rounded-xl hover:bg-[#0c3e22] transition-colors w-full flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Download className="w-4 h-4 text-[#d4af37]" />
                  <span>Download Statement PDF</span>
                </button>
              </div>

              <div className="p-6 bg-white border border-stone-200 rounded-2xl shadow-xs flex flex-col justify-between text-center space-y-4">
                <div>
                  <div className="w-12 h-12 bg-blue-50 text-blue-700 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-blue-100">
                    <PieChart className="w-6 h-6" />
                  </div>
                  <h4 className="font-black text-stone-900 uppercase text-sm mb-1">Committee Budgets Report</h4>
                  <p className="text-xs text-stone-500 font-bold">Detailed breakdown of allocations, actual expense utilization, and remaining margins across all committees.</p>
                </div>
                <button 
                  onClick={generateCommitteeBudgetPDF}
                  className="px-4 py-2.5 bg-blue-700 text-white font-black uppercase text-xs tracking-wider rounded-xl hover:bg-blue-800 transition-colors w-full flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Download className="w-4 h-4 text-[#d4af37]" />
                  <span>Download Budgets PDF</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* 1. SET OPENING BALANCE MODAL */}
      {showOpeningBalModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
              <div className="flex items-center space-x-2">
                <Settings className="w-4 h-4 text-[#0f4c2a]" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Set Opening Balance</h4>
              </div>
              <button 
                onClick={() => setShowOpeningBalModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-stone-600 font-bold">
                Enter the previous year's closing balance carried forward into this event. This amount represents non-income opening funds that directly contribute to the Available Balance.
              </p>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Opening Balance Amount (OMR)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-black text-xs text-stone-400">OMR</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={openingBalInput}
                    onChange={(e) => setOpeningBalInput(e.target.value)}
                    placeholder="0.000"
                    className="w-full pl-12 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-mono text-sm font-black text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-stone-150">
              <button
                type="button"
                onClick={() => setShowOpeningBalModal(false)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveOpeningBalance}
                disabled={isFinanceSubmitting}
                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm disabled:opacity-50"
              >
                {isFinanceSubmitting ? 'Saving...' : 'Save Opening Balance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. ALLOCATE BUDGET MODAL */}
      {showBudgetModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
              <div className="flex items-center space-x-2">
                <PieChart className="w-4 h-4 text-[#0f4c2a]" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Allocate Committee Budget</h4>
              </div>
              <button 
                onClick={() => setShowBudgetModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Select Committee
                </label>
                <select
                  value={budgetCommittee}
                  onChange={(e) => setBudgetCommittee(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                >
                  <option value="">-- Choose Committee --</option>
                  {activeCommittees.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                  <option value="Food">Food Committee</option>
                  <option value="Program">Program Committee</option>
                  <option value="Sourcing">Sourcing Committee</option>
                  <option value="Logistics">Logistics Committee</option>
                  <option value="Attendance">Attendance Committee</option>
                  <option value="Media & Tech">Media & Tech Committee</option>
                  <option value="General">General / Operations</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Budget Allocation Amount (OMR)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-black text-xs text-stone-400">OMR</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={budgetAmountInput}
                    onChange={(e) => setBudgetAmountInput(e.target.value)}
                    placeholder="0.000"
                    className="w-full pl-12 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-mono text-sm font-black text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Purpose / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={budgetDescInput}
                  onChange={(e) => setBudgetDescInput(e.target.value)}
                  placeholder="e.g. Operational funds for gathering supplies"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-stone-150">
              <button
                type="button"
                onClick={() => setShowBudgetModal(false)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBudget}
                disabled={isFinanceSubmitting}
                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm disabled:opacity-50"
              >
                {isFinanceSubmitting ? 'Saving...' : 'Save Allocation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. RECORD EXPENSE MODAL */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
              <div className="flex items-center space-x-2">
                <CreditCard className="w-4 h-4 text-[#0f4c2a]" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Record Committee Expense</h4>
              </div>
              <button 
                onClick={() => setShowExpenseModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Operational Committee
                </label>
                <select
                  value={expenseCommittee}
                  onChange={(e) => setExpenseCommittee(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                >
                  <option value="">-- Choose Committee --</option>
                  {activeCommittees.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Expense Description
                </label>
                <input
                  type="text"
                  value={expenseDescInput}
                  onChange={(e) => setExpenseDescInput(e.target.value)}
                  placeholder="e.g. Catering advance, Sound system rental"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                    Amount (OMR)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={expenseAmountInput}
                    onChange={(e) => setExpenseAmountInput(e.target.value)}
                    placeholder="0.000"
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl font-mono text-xs font-black text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                    Expense Date
                  </label>
                  <input
                    type="date"
                    value={expenseDateInput}
                    onChange={(e) => setExpenseDateInput(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Payee / Vendor (Optional)
                </label>
                <input
                  type="text"
                  value={expensePayeeInput}
                  onChange={(e) => setExpensePayeeInput(e.target.value)}
                  placeholder="e.g. Muscat Catering Services LLC"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-stone-150">
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddExpenseFromFinance}
                disabled={isFinanceSubmitting}
                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm disabled:opacity-50"
              >
                {isFinanceSubmitting ? 'Recording...' : 'Record Expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Registration Details Modal */}
      {isRegistrationModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-5xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3 shrink-0">
              <div className="flex items-center space-x-2">
                <Receipt className="w-5 h-5 text-[#0f4c2a]" />
                <h4 className="font-black text-[#0f4c2a] uppercase tracking-wider text-sm">Registration Income Breakdown</h4>
              </div>
              <button onClick={() => setIsRegistrationModalOpen(false)} className="text-stone-400 hover:text-stone-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex items-center justify-between gap-3 pb-2 shrink-0">
              <p className="text-stone-500 text-[10px] font-bold">Collected registration payments for {activeEvent?.title || 'active event'}.</p>
              <div className="relative max-w-xs w-full">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={finSearchQuery}
                  onChange={(e) => setFinSearchQuery(e.target.value)}
                  placeholder="Search by GMK ID, name, or email..."
                  className="w-full pl-8 pr-3 py-1.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>
            </div>

            <div className="overflow-y-auto hide-scrollbar flex-1">
              {filteredIncomeRegs.length === 0 ? (
                <div className="text-center py-10 bg-stone-50 rounded-xl border border-dashed border-stone-200 h-full flex flex-col items-center justify-center">
                  <Receipt className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                  <p className="text-stone-600 font-black text-xs uppercase tracking-wider">No Collected Registration Payments Yet</p>
                  <p className="text-[10px] text-stone-400 font-bold mt-1">Registration income automatically calculates as residents make payments.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[650px]">
                    <thead className="sticky top-0 bg-stone-50 z-10">
                      <tr className="bg-stone-50 text-[10px] font-black text-stone-500 uppercase tracking-widest border-b border-stone-200">
                        <th className="p-3">Primary Registrant</th>
                        <th className="p-3">GMK ID</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Amount Due</th>
                        <th className="p-3 text-right">Collected (OMR)</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs font-bold text-stone-700">
                      {filteredIncomeRegs.map((reg) => {
                        const collected = getRegistrationCollectedAmount(reg);
                        const due = reg.amountDue ?? reg.paymentAmount ?? reg.paymentSummary?.totalAmount ?? 0;
                        return (
                          <tr key={reg.id} className="border-b border-stone-100 hover:bg-stone-50/50">
                            <td className="p-3 font-semibold text-stone-900">{(reg.participants && reg.participants.length > 0) ? reg.participants[0] : reg.primaryMemberEmail}</td>
                            <td className="p-3 font-mono text-[10px]">{reg.primaryMemberGmkId}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 bg-stone-100 text-stone-700 text-[9px] font-black uppercase rounded-md">
                                {reg.registrationType || 'Family'}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded-md ${collected >= due ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                {collected >= due ? 'PAID' : 'PENDING'}
                              </span>
                            </td>
                            <td className="p-3 text-right font-mono text-[11px] text-stone-500">OMR {due.toFixed(3)}</td>
                            <td className="p-3 text-right font-mono font-black text-[#0f4c2a]">OMR {collected.toFixed(3)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-emerald-50/90 backdrop-blur z-10">
                      <tr className="font-black text-xs text-[#0f4c2a] border-t border-emerald-200">
                        <td colSpan={5} className="p-3 text-right uppercase tracking-wider">Total Registration Income:</td>
                        <td className="p-3 text-right font-mono text-sm">OMR {totalRegistrationRec.toFixed(3)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="pt-4 flex justify-end border-t border-stone-150 shrink-0">
              <button
                type="button"
                onClick={() => setIsRegistrationModalOpen(false)}
                className="px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sponsorship Details Modal */}
      {isSponsorshipModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-4xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3 shrink-0">
              <div className="flex items-center space-x-2">
                <DollarSign className="w-5 h-5 text-blue-700" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Sponsorship Details</h4>
              </div>
              <button 
                onClick={() => setIsSponsorshipModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="overflow-y-auto hide-scrollbar flex-1">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="bg-stone-50 text-[10px] font-black text-stone-500 uppercase tracking-widest border-b border-stone-200">
                      <th className="p-3">Sponsor Name</th>
                      <th className="p-3">Payment Mode</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Notes</th>
                      <th className="p-3 text-right">Assured Amount</th>
                      <th className="p-3 text-right">Received Amount</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-bold text-stone-700">
                    {sponsorshipIncomeList.map((sponsor, idx) => (
                      <tr key={sponsor.id || idx} className="border-b border-stone-100 hover:bg-stone-50/50">
                        <td className="p-3 font-semibold text-stone-900">{sponsor.sponsorName}</td>
                        <td className="p-3"><span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[9px] font-black uppercase">{sponsor.paymentMode || sponsor.tier || 'N/A'}</span></td>
                        <td className="p-3 font-mono text-[10px] text-stone-500">{sponsor.date || '-'}</td>
                        <td className="p-3 text-[10px] text-stone-500">{sponsor.notes || '-'}</td>
                        <td className="p-3 text-right font-mono font-black text-stone-500">{(Number(sponsor.assuredAmount) || Number(sponsor.amount) || 0).toFixed(3)}</td>
                        <td className="p-3 text-right font-mono font-black text-blue-700">{(Number(sponsor.amount) || 0).toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="pt-4 flex justify-end border-t border-stone-150 shrink-0">
              <button
                type="button"
                onClick={() => setIsSponsorshipModalOpen(false)}
                className="px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
