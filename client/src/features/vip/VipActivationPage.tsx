import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { Crown, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

type Preview={invitation:{projectName:string;unitNumber:string;emailMasked:string;accountExists:boolean;matchesSignedIn:boolean;expiresAt:string}};
const copy: Record<string,Record<string,string>>={
 ar:{title:"تفعيل عضوية KINGLIKE VIP",subtitle:"حسابك العقاري الخاص",unit:"الوحدة",project:"المشروع",email:"البريد",exists:"لديك حساب مسجّل. سجّل الدخول بالبريد الذي وصلته الدعوة، ثم أكد ربط العقار.",login:"تسجيل الدخول بالحساب الحالي",new:"أنشئ كلمة مرور آمنة لحسابك الجديد",password:"كلمة المرور",confirm:"تأكيد كلمة المرور",accept:"تفعيل حسابي",link:"ربط العقار بحسابي",loading:"جاري التحقق من الدعوة...",invalid:"رابط الدعوة غير صالح أو انتهت صلاحيته. يرجى التواصل مع Kinglike Luxury.",error:"تعذر التفعيل. يرجى إعادة المحاولة أو التواصل معنا.",mismatch:"كلمتا المرور غير متطابقتين.",logout:"تسجيل الخروج من الحساب الحالي",done:"تم تفعيل الحساب بنجاح.",notice:"الرابط يستخدم مرة واحدة فقط ولا يجوز مشاركته."},
 en:{title:"Activate KINGLIKE VIP",subtitle:"Your private investment account",unit:"Unit",project:"Project",email:"Email",exists:"You already have an account. Sign in with the invited email, then link your property.",login:"Sign in to your account",new:"Choose a secure password for your new account",password:"Password",confirm:"Confirm password",accept:"Activate account",link:"Link my property",loading:"Checking invitation...",invalid:"Invalid or expired invitation. Contact Kinglike Luxury.",error:"Activation failed. Please try again or contact support.",mismatch:"Passwords do not match.",logout:"Sign out of current account",done:"Account activated.",notice:"This invitation can be used only once. Do not share it."},
 he:{title:"הפעלת KINGLIKE VIP",subtitle:"החשבון הפרטי שלך",unit:"יחידה",project:"פרויקט",email:"דוא״ל",exists:"קיים חשבון. התחבר עם כתובת הדוא״ל שהוזמנה.",login:"כניסה לחשבון",new:"בחר סיסמה מאובטחת",password:"סיסמה",confirm:"אישור סיסמה",accept:"הפעלת חשבון",link:"קישור הנכס",loading:"בודק הזמנה...",invalid:"ההזמנה אינה תקינה או פגה.",error:"ההפעלה נכשלה.",mismatch:"הסיסמאות אינן תואמות.",logout:"התנתק מהחשבון",done:"החשבון הופעל.",notice:"הקישור אישי וחד-פעמי."},
 tr:{title:"KINGLIKE VIP hesabını etkinleştir",subtitle:"Özel yatırım hesabınız",unit:"Ünite",project:"Proje",email:"E-posta",exists:"Hesabınız zaten var. Davet edilen e-posta ile giriş yapın.",login:"Hesaba giriş yap",new:"Güçlü bir şifre oluşturun",password:"Şifre",confirm:"Şifreyi doğrula",accept:"Hesabı etkinleştir",link:"Mülkümü bağla",loading:"Davet kontrol ediliyor...",invalid:"Davet geçersiz veya süresi dolmuş.",error:"Etkinleştirme başarısız.",mismatch:"Şifreler eşleşmiyor.",logout:"Oturumu kapat",done:"Hesap etkinleştirildi.",notice:"Bu bağlantı tek kullanımlıktır."},
 az:{title:"KINGLIKE VIP aktivləşdirmə",subtitle:"Şəxsi investisiya hesabınız",unit:"Mənzil",project:"Layihə",email:"E-poçt",exists:"Hesabınız var. Dəvət edilən e-poçtla daxil olun.",login:"Daxil ol",new:"Güclü şifrə seçin",password:"Şifrə",confirm:"Şifrəni təsdiqlə",accept:"Hesabı aktivləşdir",link:"Mənzilimi bağla",loading:"Dəvət yoxlanılır...",invalid:"Dəvət etibarsızdır və ya vaxtı bitib.",error:"Aktivləşdirmə alınmadı.",mismatch:"Şifrələr fərqlidir.",logout:"Çıxış",done:"Hesab aktivləşdirildi.",notice:"Bu keçid birdəfəlikdir."}
};
export default function VipActivationPage(){
  const {user,isLoading:authLoading,logout}=useAuth();
  const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
  const rtl=/^(ar|he)(-|$)/i.test(i18n.language);
  const [,navigate]=useLocation();
  const [token]=useState(()=>new URLSearchParams(window.location.search).get("token")||"");
  const [preview,setPreview]=useState<Preview|null>(null);
  const [loading,setLoading]=useState(true);
  const [password,setPassword]=useState("");
  const [confirmation,setConfirmation]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [done,setDone]=useState(false);
  useEffect(()=>{
    // Remove the bearer token from browser history after capturing it.
    // Do not log it or persist it to localStorage.
    window.history.replaceState(window.history.state,"","/vip/activate");
    if(!/^[0-9a-f]{64}$/.test(token)){setError(t.invalid);setLoading(false);return;}
    let active=true;
    fetch("/api/vip/invitations/preview?token="+encodeURIComponent(token),{
      credentials:"include",cache:"no-store",referrerPolicy:"no-referrer"
    }).then(async r=>{if(!r.ok)throw Error("Invalid");return r.json()})
      .then(v=>{if(active)setPreview(v)})
      .catch(()=>{if(active)setError(t.invalid)})
      .finally(()=>{if(active)setLoading(false)});
    return ()=>{active=false};
  },[token]);
  async function accept(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!preview||busy)return;
    if(!preview.invitation.accountExists && password!==confirmation){setError(t.mismatch);return;}
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/vip/invitations/accept",{
        method:"POST",credentials:"include",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token,...(!preview.invitation.accountExists?{password}:{})})
      });
      if(!response.ok){
        const message=await response.json().catch(()=>({error:t.error}));
        throw Error(message.error||t.error);
      }
      setDone(true);setPassword("");setConfirmation("");
      window.setTimeout(()=>{window.location.assign("/vip")},600);
    }catch(e){setError(e instanceof Error?e.message:t.error)}
    finally{setBusy(false)}
  }
  const invite=preview?.invitation;
  const loggedInWithInvitedEmail=invite?.matchesSignedIn===true;
  const loginUrl="/login?redirect="+encodeURIComponent("/vip/activate?token="+token);
  return <main dir={rtl?"rtl":"ltr"} className="min-h-[85vh] bg-[#f4f8f8] px-4 py-10 text-[#005476]">
    <div className="mx-auto max-w-lg overflow-hidden rounded-3xl border border-[#d5e8e9] bg-white shadow-xl">
      <div className="bg-gradient-to-br from-[#005476] to-[#007d83] px-7 py-10 text-white">
        <Crown className="mb-4 h-10 w-10 text-[#3BCAC4]"/>
        <h1 className="text-2xl font-bold">{t.title}</h1><p className="mt-2 text-sm text-white/80">{t.subtitle}</p>
      </div>
      <div className="p-7">
        {loading||authLoading?<p>{t.loading}</p>:error&&!invite?<p role="alert" className="text-red-700">{error}</p>:done?
          <p className="text-emerald-800">{t.done}</p>:invite&&
          <>
            <dl className="mb-6 space-y-2 rounded-xl bg-[#f1f8f8] p-4 text-sm">
              <div className="flex justify-between gap-3"><dt>{t.project}</dt><dd className="font-semibold">{invite.projectName}</dd></div>
              <div className="flex justify-between gap-3"><dt>{t.unit}</dt><dd className="font-semibold">{invite.unitNumber}</dd></div>
              <div className="flex justify-between gap-3"><dt>{t.email}</dt><dd className="font-semibold">{invite.emailMasked}</dd></div>
            </dl>
            {invite.accountExists&&!user?<>
              <p className="mb-4 text-sm">{t.exists}</p>
              <Link href={loginUrl} className="inline-block rounded-xl bg-[#005476] px-5 py-3 text-white">{t.login}</Link>
            </>:invite.accountExists&&user&&!loggedInWithInvitedEmail?<>
              <p className="mb-4 text-sm">{t.exists}</p>
              <button type="button" className="rounded-xl border border-[#005476] px-5 py-3" onClick={()=>logout()}>{t.logout}</button>
            </>:<form onSubmit={accept} className="space-y-4">
              {!invite.accountExists&&<>
                <p className="text-sm">{t.new}</p>
                <label className="block text-sm">{t.password}
                  <input className="mt-1 w-full rounded-xl border border-[#c4dcdd] p-3" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={e=>setPassword(e.target.value)}/>
                </label>
                <label className="block text-sm">{t.confirm}
                  <input className="mt-1 w-full rounded-xl border border-[#c4dcdd] p-3" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/>
                </label>
              </>}
              <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#005476] px-5 py-3 font-semibold text-white disabled:opacity-50" type="submit" disabled={busy}>
                <KeyRound className="h-4 w-4"/>{invite.accountExists?t.link:t.accept}
              </button>
            </form>}
            {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
            <p className="mt-5 flex items-center gap-2 text-xs text-[#7a929b]"><ShieldCheck className="h-4 w-4"/>{t.notice}</p>
          </>
        }
      </div>
    </div>
  </main>;
}
