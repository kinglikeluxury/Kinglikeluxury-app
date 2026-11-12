import React, {useCallback,useEffect,useState} from "react";
import {useLocation} from "wouter";
import {BadgeCheck,LockKeyhole,RefreshCcw,ShieldCheck} from "lucide-react";
import {useAuth} from "@/lib/auth";

type VerificationStatus={
  mode:"employee_verification_only";
  status:"awaiting_company_setup"|"awaiting_meta_verification";
  phoneConnected:false;
  metaEnrollmentVerified:false;
  employeeCanDisconnect:false;
  employeeCanCancelEnrollment:false;
  availableActions:string[];
};

export default function EmployeeWhatsappMetaVerificationPage(){
  const {user,isLoading}=useAuth();
  const [,navigate]=useLocation();
  const [state,setState]=useState<VerificationStatus|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const employee=!!user && user.role==="sub_agent" && user.isAdmin!==true;

  const refresh=useCallback(async()=>{
    if(!employee)return;
    setLoading(true);setError(null);
    try{
      const response=await fetch("/api/employee/whatsapp-meta-verification",{
        credentials:"same-origin",cache:"no-store",
        headers:{Accept:"application/json"},
      });
      if(!response.ok)throw new Error("تعذر قراءة حالة التوثيق.");
      const data=await response.json() as VerificationStatus;
      if(data.mode!=="employee_verification_only" ||
        !["awaiting_company_setup","awaiting_meta_verification"].includes(data.status) ||
        data.phoneConnected!==false || data.metaEnrollmentVerified!==false ||
        data.employeeCanDisconnect!==false || data.employeeCanCancelEnrollment!==false ||
        !Array.isArray(data.availableActions) || data.availableActions.length!==0)
        throw new Error("الحالة غير مؤكدة. لا يمكن المتابعة قبل التحقق.");
      setState(data);
    }catch(e){
      setState(null);
      setError(e instanceof Error?e.message:"تعذر قراءة حالة التوثيق.");
    }finally{setLoading(false);}
  },[employee]);

  useEffect(()=>{
    if(isLoading)return;
    if(!user)navigate("/login?redirect=/employee/whatsapp-meta-verification");
    else if(!employee)navigate("/");
  },[isLoading,user,employee,navigate]);
  useEffect(()=>{if(!isLoading&&employee)void refresh();},[isLoading,employee,refresh]);

  if(isLoading || !employee)return null;
  return (
    <main dir="rtl" className="min-h-[70vh] bg-[#f4f8fa] px-4 py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="rounded-3xl bg-[#005476] p-6 text-white">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#a6e9e4]">
            <BadgeCheck className="h-5 w-5"/> Kinglike Luxury
          </span>
          <h1 className="mt-3 text-2xl font-bold">وثّق رقم الواتساب في ميتا</h1>
          <p className="mt-2 text-sm leading-7 text-white/90">
            هذه الصفحة مخصصة للتحقق من رقم WhatsApp Business المصرّح لك باستخدامه.
            لا تعرض محادثات الموظفين الآخرين أو إعدادات إدارة الأرشيف.
          </p>
        </header>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          aria-label="حالة توثيق واتساب">
          <div className="flex items-center gap-2 font-bold text-[#005476]">
            <ShieldCheck className="h-5 w-5"/> حالة التوثيق
          </div>
          {loading ? (
            <p role="status" className="mt-4 text-sm text-slate-600">جارٍ التحقق من الحالة...</p>
          ) : error ? (
            <p role="alert" className="mt-4 text-sm text-amber-800">{error}</p>
          ) : (
            <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-semibold text-amber-950">
                {state?.status==="awaiting_meta_verification"
                  ?"بانتظار جلسة التوثيق الرسمية من Meta"
                  :"بانتظار تجهيز الربط من إدارة Kinglike"}
              </p>
              <p className="mt-2 text-sm leading-7 text-slate-700">
                لم يثبت بعد اتصال رقمك بمنصة Meta. بعد تجهيز الجلسة الرسمية والموافقات
                المطلوبة، ستظهر هنا خطوة التوثيق المسموح بها فقط.
                لا تضغط Confirm أو تشارك سجل المحادثات في WhatsApp Business قبل ذلك.
              </p>
            </div>
          )}
          <button type="button" onClick={()=>void refresh()} disabled={loading}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            <RefreshCcw className="h-4 w-4"/> تحديث حالة التوثيق
          </button>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-700">
          <div className="flex items-start gap-2">
            <LockKeyhole className="mt-1 h-4 w-4 shrink-0 text-[#005476]"/>
            <p>حساب الموظف مخصص للتوثيق فقط. لا يملك صلاحية إلغاء التسجيل أو فصل رقم الواتساب أو تغيير صلاحيات الشركة.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
