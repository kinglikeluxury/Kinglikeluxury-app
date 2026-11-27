// Type declaration for bundled MIT-licensed qrcode-generator ESM build.
interface VipQRCode {
  addData(data:string,mode?:"Byte"|"Alphanumeric"|"Numeric"):void;
  make():void;
  isDark(row:number,column:number):boolean;
  getModuleCount():number;
}
export default function qrcode(typeNumber:number,errorCorrectionLevel:"L"|"M"|"Q"|"H"):VipQRCode;
