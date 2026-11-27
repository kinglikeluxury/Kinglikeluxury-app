export function validateQaBootstrapIdentity(username:unknown,email:unknown,password:unknown):boolean{
 if(typeof username!=="string"||!/^qa_[a-z0-9_]{4,36}$/.test(username))return false;
 if(typeof email!=="string"||!/^qa_[a-z0-9._+-]{4,70}@[a-z0-9.-]+\.test$/.test(email))return false;
 if(typeof password!=="string"||password.length<16||password.length>72)return false;
 return /[a-z]/.test(password)&&/[A-Z]/.test(password)&&/[0-9]/.test(password)&&/[^a-zA-Z0-9]/.test(password);
}
