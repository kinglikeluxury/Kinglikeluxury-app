/**
 * QA-only mail adapter. It never loads a mail provider or sends a message.
 */
export async function sendEmail():Promise<{sent:false;error:string}>{
  return {sent:false,error:"Email disabled in isolated VIP QA"};
}
