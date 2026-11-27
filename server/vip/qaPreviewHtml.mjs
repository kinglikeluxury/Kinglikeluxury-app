export function sanitizeQaPreviewHtml(html) {
  let result = html
    .replace(/<link\b(?=[^>]*\bhref=["']https?:\/\/)[^>]*>\s*/gi, "")
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>\s*/gi,(script,attributes)=>{
      const match=attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
      if(!match)return "";
      const source=match[2];
      if(/^(?:https?:)?\/\//i.test(source))return "";
      try{
        const resolved=new URL(source,"http://127.0.0.1");
        return resolved.origin==="http://127.0.0.1"?script:"";
      }catch{
        return "";
      }
    });

  if (/https?:\/\/|serviceWorker\.register|googletagmanager|gtag\(/i.test(result)) {
    throw new Error("External resources remain in the local VIP QA HTML");
  }

  result = result.replace(
    /<\/head>/i,
    '<meta name="robots" content="noindex, nofollow, noarchive" />\n  </head>',
  );
  return result;
}

export function sanitizeQaPreviewCss(css) {
  const result=css
    .replace(/@import\s*(?:url\(\s*)?["']https?:\/\/[^"']+["']\s*\)?\s*;/gi,"")
    .replace(/@import\s*(?:url\(\s*)?https?:\/\/[^;\s)]+\s*\)?\s*;/gi,"")
    .replace(/url\(\s*(["'])https?:\/\/.*?\1\s*\)/gis,'url("")')
    .replace(/url\(\s*https?:\/\/[^)\s]+\s*\)/gi,'url("")');
  if(/@import\s*(?:url\(\s*)?["']?https?:\/\//i.test(result)||
    /url\(\s*["']?https?:\/\//i.test(result)){
    throw new Error("External CSS resources remain in local VIP QA output");
  }
  return result;
}

export function createQaLocalFontFaceCss(fileNames) {
  const faces = [
    ["Regular", 400],
    ["Medium", 500],
    ["Bold", 700],
  ];
  return faces.map(([weightName, weight]) => {
    const fileName = fileNames.find((name) =>
      new RegExp(`^Tajawal-${weightName}-[A-Za-z0-9_-]+\\.woff2$`).test(name),
    );
    if (!fileName) {
      throw new Error(`Local QA font asset is missing: Tajawal ${weightName}`);
    }
    return `@font-face{font-family:"Tajawal";font-style:normal;font-weight:${weight};font-display:swap;src:url("./${fileName}") format("woff2")}`;
  }).join("\n");
}
