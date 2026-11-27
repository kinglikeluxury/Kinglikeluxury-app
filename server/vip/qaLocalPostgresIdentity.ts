import {readFileSync} from "node:fs";
import {resolve} from "node:path";

/**
 * Verifies the OS-level PostgreSQL marker for the disposable QA cluster.
 * SQL roles cannot read data_directory on supported PostgreSQL versions, so
 * the private postmaster.pid plus the live process command line bind the
 * expected temp directory to the loopback port before any QA SQL runs.
 */
export function assertTemporaryPostgresProcessIdentity(
  dataDirectory:unknown,
  expectedPort:unknown,
):void{
  if(typeof dataDirectory!=="string"||
    !/^\/tmp\/kinglike-vip-pg-[A-Za-z0-9_-]+$/.test(dataDirectory)||
    typeof expectedPort!=="number"||!Number.isInteger(expectedPort)||
    expectedPort<1||expectedPort>65535){
    throw Error("VIP QA temporary PostgreSQL identity is invalid");
  }
  try{
    const directory=resolve(dataDirectory);
    const lines=readFileSync(resolve(directory,"postmaster.pid"),"utf8").split(/\r?\n/);
    const pid=Number(lines[0]);
    if(!Number.isSafeInteger(pid)||pid<2||
      resolve(lines[1]||"")!==directory||
      Number(lines[3])!==expectedPort||
      (lines[5]||"").trim()!=="127.0.0.1"){
      throw Error();
    }
    process.kill(pid,0);
    const args=readFileSync(`/proc/${pid}/cmdline`,"utf8").split("\0").filter(Boolean);
    const dataArg=args.findIndex((arg)=>arg==="-D");
    if(dataArg<0||resolve(args[dataArg+1]||"")!==directory){
      throw Error();
    }
  }catch{
    throw Error("VIP QA temporary PostgreSQL process identity could not be verified");
  }
}
